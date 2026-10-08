import { toBackground, isSupportedUrl, type BackgroundResponse, type ExtensionStatus } from "../shared/messages";
import { clearConfig, readConfig, writeConfig } from "../shared/storage";
import { apiRequest, ExtApiError } from "../shared/api";

/**
 * Service worker : seul détenteur du jeton. Il valide l'expéditeur et le
 * contenu de chaque message, puis parle à l'API Selio. Les content scripts
 * ne reçoivent que des données d'affichage, jamais le jeton.
 */
function senderAllowed(sender: chrome.runtime.MessageSender, requireSupportedTab: boolean): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (requireSupportedTab) return Boolean(sender.tab && isSupportedUrl(sender.tab.url ?? sender.url));
  // Pages de l'extension (popup/options) : pas d'onglet associé, URL chrome-extension://
  return !sender.tab && (sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`) ?? false);
}

async function status(): Promise<ExtensionStatus> {
  const c = await readConfig();
  return { paired: Boolean(c.token && c.apiBaseUrl), apiBaseUrl: c.apiBaseUrl, orgName: c.orgName, scopes: c.scopes, lastPingAt: c.lastPingAt, lastError: c.lastError };
}

async function withToken<T>(fn: (base: string, token: string) => Promise<T>): Promise<T> {
  const c = await readConfig();
  if (!c.token || !c.apiBaseUrl) throw new ExtApiError("unpaired", "Extension non associée : ouvrez les options et collez un jeton Selio.", 401);
  try {
    const out = await fn(c.apiBaseUrl, c.token);
    await writeConfig({ lastPingAt: new Date().toISOString(), lastError: null });
    return out;
  } catch (e) {
    if (e instanceof ExtApiError && e.status === 401) await writeConfig({ lastError: "Jeton refusé (révoqué ou expiré) : créez un nouveau jeton dans Selio." });
    else if (e instanceof ExtApiError) await writeConfig({ lastError: e.message });
    throw e;
  }
}

async function handle(msg: unknown, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  const parsed = toBackground.safeParse(msg);
  if (!parsed.success) return { ok: false, code: "invalid_message", message: "Message invalide" };
  const m = parsed.data;
  const fromContent = ["capture", "rules", "draft", "diagnostic"].includes(m.type);
  if (!senderAllowed(sender, fromContent)) return { ok: false, code: "forbidden", message: "Expéditeur non autorisé" };
  try {
    switch (m.type) {
      case "status":
        return { ok: true, data: await status() };
      case "pair": {
        const origin = new URL(m.apiBaseUrl).origin;
        const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
        if (!granted) return { ok: false, code: "permission", message: `Autorisation refusée pour ${origin}. Sans elle, l'extension ne peut pas joindre l'API.` };
        const ping = await apiRequest<{ orgName: string; scopes: string[] }>(m.apiBaseUrl, m.token, "GET", "/api/ext/ping");
        await writeConfig({ apiBaseUrl: m.apiBaseUrl, token: m.token, orgName: ping.orgName, scopes: ping.scopes, lastPingAt: new Date().toISOString(), lastError: null });
        return { ok: true, data: await status() };
      }
      case "unpair":
        await clearConfig();
        return { ok: true, data: await status() };
      case "getDiagnostics":
        return { ok: true, data: (await readConfig()).diagnostics };
      case "diagnostic": {
        const c = await readConfig();
        await writeConfig({ diagnostics: [m.report, ...c.diagnostics].slice(0, 20) });
        return { ok: true, data: null };
      }
      case "capture": {
        const data = await withToken((base, token) => apiRequest(base, token, "POST", "/api/ext/capture", { ...m.item, adapterVersion: m.adapterVersion, purchasePriceCents: m.purchasePriceCents ?? undefined }));
        return { ok: true, data };
      }
      case "rules": {
        const data = await withToken((base, token) => apiRequest(base, token, "POST", "/api/ext/rules", { externalRef: m.externalRef, listedPriceCents: m.listedPriceCents, offerCents: m.offerCents }));
        return { ok: true, data };
      }
      case "draft": {
        if (!m.conversation.buyerHandle) return { ok: false, code: "validation", message: "Acheteur non identifié sur la page." };
        const data = await withToken((base, token) => apiRequest(base, token, "POST", "/api/ext/draft", { conversationRef: m.conversation.externalRef, buyerHandle: m.conversation.buyerHandle, itemTitle: m.conversation.itemTitle, itemExternalRef: m.itemExternalRef, messages: m.conversation.messages, url: m.conversation.url, adapterVersion: m.adapterVersion }));
        return { ok: true, data };
      }
    }
  } catch (e) {
    if (e instanceof ExtApiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "internal", message: e instanceof Error ? e.message : "Erreur inconnue" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, code: "internal", message: String(e) }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});
