import { toBackground, type BackgroundResponse, type ExtensionStatus } from "../shared/messages";
import { clearConfig, readConfig, writeConfig } from "../shared/storage";
import { apiRequest, ExtApiError } from "../shared/api";
import { senderAllowed } from "./sender";
import { comparablesFailure, fetchComparables, isQuietComparablesError } from "./comparables";
import { extensionAutoState, type ExtensionAutoState } from "@selio/contracts";
import { AUTO_ALARM, autoTick, chromeAutoDeps } from "./auto";

/**
 * Service worker : seul détenteur du jeton. Il valide l'expéditeur et le
 * contenu de chaque message, puis parle à l'API Selio. Les content scripts
 * ne reçoivent que des données d'affichage, jamais le jeton.
 */
async function status(): Promise<ExtensionStatus> {
  const c = await readConfig();
  return { paired: Boolean(c.token && c.apiBaseUrl), apiBaseUrl: c.apiBaseUrl, orgName: c.orgName, scopes: c.scopes, lastPingAt: c.lastPingAt, lastError: c.lastError };
}

async function withToken<T>(fn: (base: string, token: string) => Promise<T>, opts: { quiet?: (e: ExtApiError) => boolean } = {}): Promise<T> {
  const c = await readConfig();
  if (!c.token || !c.apiBaseUrl) throw new ExtApiError("unpaired", "Extension non associée : ouvrez les options et collez un jeton Selio.", 401);
  try {
    const out = await fn(c.apiBaseUrl, c.token);
    await writeConfig({ lastPingAt: new Date().toISOString(), lastError: null });
    return out;
  } catch (e) {
    if (e instanceof ExtApiError && e.status === 401) await writeConfig({ lastError: "Jeton refusé (révoqué ou expiré) : créez un nouveau jeton dans Selio." });
    else if (e instanceof ExtApiError && !opts.quiet?.(e)) await writeConfig({ lastError: e.message });
    throw e;
  }
}

// ---------------------------------------------------------------- automatisation complète (D64)

/** Miroir local de l'interrupteur (le serveur reste seul juge) ; réveil programmé ou annulé. */
async function mirrorAuto(state: ExtensionAutoState): Promise<void> {
  const on = state.connections.find((c) => c.enabled) ?? null;
  const c = await readConfig();
  await writeConfig({ auto: { ...c.auto, enabled: on !== null, connectionId: on?.connectionId ?? null, pausedLabel: on?.pausedLabel ?? null } });
  if (on) chrome.alarms.create(AUTO_ALARM, { delayInMinutes: 0.5 });
  else await chrome.alarms.clear(AUTO_ALARM);
}

async function refreshAutoState(): Promise<ExtensionAutoState> {
  const state = extensionAutoState.parse(await withToken((base, token) => apiRequest(base, token, "GET", "/api/ext/auto/state")));
  await mirrorAuto(state);
  return state;
}

let ticking = false;
async function onAutoAlarm(): Promise<void> {
  const c = await readConfig();
  if (!c.auto.enabled || !c.token || !c.apiBaseUrl || ticking) return;
  ticking = true;
  try {
    const deps = chromeAutoDeps(chrome as unknown as Parameters<typeof chromeAutoDeps>[0], (method, path, body) => withToken((base, token) => apiRequest(base, token, method, path, body)));
    const outcome = await autoTick(deps);
    const label = outcome.kind === "wait" ? `attente (${outcome.reason})` : outcome.kind === "error" ? "erreur" : `${outcome.kind === "send" ? "envoi" : "lecture"} : ${outcome.code}`;
    const fresh = await readConfig();
    await writeConfig({ auto: { ...fresh.auto, lastTickAt: new Date().toISOString(), lastOutcome: label, pausedLabel: outcome.kind === "wait" && outcome.reason === "paused" ? fresh.auto.pausedLabel ?? "en pause" : outcome.kind === "wait" ? fresh.auto.pausedLabel : null } });
  } finally {
    ticking = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_ALARM) void onAutoAlarm();
});

/** Au démarrage du navigateur : réveil reprogrammé si l'automatisation complète est active. */
async function ensureAutoAlarm(): Promise<void> {
  const c = await readConfig();
  if (c.auto.enabled && !(await chrome.alarms.get(AUTO_ALARM))) chrome.alarms.create(AUTO_ALARM, { delayInMinutes: 1 });
}
chrome.runtime.onStartup.addListener(() => void ensureAutoAlarm());

async function handle(msg: unknown, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  const parsed = toBackground.safeParse(msg);
  if (!parsed.success) return { ok: false, code: "invalid_message", message: "Message invalide" };
  const m = parsed.data;
  const fromContent = ["capture", "rules", "draft", "diagnostic", "comparables"].includes(m.type);
  if (!senderAllowed(sender, fromContent, { id: chrome.runtime.id, baseUrl: chrome.runtime.getURL("") })) return { ok: false, code: "forbidden", message: "Expéditeur non autorisé" };
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
        await chrome.alarms.clear(AUTO_ALARM);
        await clearConfig();
        return { ok: true, data: await status() };
      case "getDiagnostics":
        return { ok: true, data: (await readConfig()).diagnostics };
      case "autoState":
        return { ok: true, data: { server: await refreshAutoState(), local: (await readConfig()).auto } };
      case "autoSet": {
        const state = extensionAutoState.parse(await withToken((base, token) => apiRequest(base, token, "POST", "/api/ext/auto/enable", { connectionId: m.connectionId, enabled: m.enabled })));
        await mirrorAuto(state);
        return { ok: true, data: { server: state, local: (await readConfig()).auto } };
      }
      case "autoResume": {
        const state = extensionAutoState.parse(await withToken((base, token) => apiRequest(base, token, "POST", "/api/ext/auto/resume", { connectionId: m.connectionId, acknowledge: m.acknowledge })));
        await mirrorAuto(state);
        return { ok: true, data: { server: state, local: (await readConfig()).auto } };
      }
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
      case "comparables": {
        // Lecture seule : aucune action sur la page ni dans Selio ; erreurs normalisées pour le panneau.
        try {
          const data = await withToken((base, token) => fetchComparables(base, token, m.item), { quiet: isQuietComparablesError });
          return { ok: true, data };
        } catch (e) {
          return { ok: false, ...comparablesFailure(e) };
        }
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
  void ensureAutoAlarm();
});
