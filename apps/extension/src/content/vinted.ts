import { COMPOSER_SELECTORS, detectPage, parseConversationPage, parseItemPage, ADAPTER_VERSION, type MinimalDocument } from "@selio/connectors/vinted-adapter";
import { escapeHtml } from "@selio/domain";
import { toContent, type BackgroundResponse, type CapturedConversation, type CapturedItem, type ToBackground } from "../shared/messages";

/**
 * Content script Selio (monde isolé). Lit la page visible via les adaptateurs
 * DOM versionnés, affiche un panneau dans un shadow DOM (texte uniquement,
 * jamais d'innerHTML avec des données de page) et ne déclenche aucune action
 * sans clic explicite de l'utilisateur. Il ne clique jamais « Envoyer ».
 */
const PANEL_ID = "selio-panel-host";
let open = false;

function send(msg: ToBackground): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res: BackgroundResponse) => {
        if (chrome.runtime.lastError) resolve({ ok: false, code: "runtime", message: chrome.runtime.lastError.message ?? "Erreur d'extension" });
        else resolve(res ?? { ok: false, code: "no_response", message: "Pas de réponse du service worker" });
      });
    } catch (e) {
      resolve({ ok: false, code: "runtime", message: String(e) });
    }
  });
}

const css = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px); color: #0B0B0C; }
.card { background: #FFFFFF; border: 1px solid #E4E4E7; border-radius: 12px; box-shadow: 0 12px 40px rgba(11,11,12,0.10); overflow: hidden; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #E4E4E7; }
.title { font-size: 13px; font-weight: 600; }
.badge { font-size: 11px; font-weight: 500; color: #71717A; background: #F4F4F5; border-radius: 6px; padding: 2px 6px; }
.body { padding: 12px; font-size: 13px; line-height: 18px; max-height: 60vh; overflow: auto; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid #F4F4F5; }
.row span:first-child { color: #71717A; }
.num { font-variant-numeric: tabular-nums; font-weight: 500; }
.btn { appearance: none; border: 1px solid #E4E4E7; background: #FFFFFF; color: #0B0B0C; border-radius: 8px; height: 32px; padding: 0 12px; font-size: 13px; font-weight: 500; cursor: pointer; }
.btn:hover { background: #F4F4F5; }
.btn.primary { background: #0B0B0C; color: #FFFFFF; border-color: #0B0B0C; }
.btn.accent { background: #C4501B; color: #FFFFFF; border-color: #C4501B; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.msg { margin-top: 8px; font-size: 12px; color: #71717A; }
.msg.err { color: #B91C1C; }
.msg.ok { color: #15803D; }
.draft { margin-top: 8px; border: 1px dashed #C4501B; border-radius: 8px; padding: 8px; white-space: pre-wrap; }
.toggle { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; height: 36px; padding: 0 12px; border-radius: 999px; background: #0B0B0C; color: #fff; border: 0; font-size: 13px; font-weight: 600; cursor: pointer; }
input { height: 32px; border: 1px solid #D4D4D8; border-radius: 8px; padding: 0 8px; font-size: 13px; width: 110px; }
label { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: #71717A; font-size: 12px; }
ul { margin: 6px 0 0; padding-left: 16px; color: #71717A; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .wrap { color: #FAFAFA; } .card { background: #18181B; border-color: #27272A; } .head { border-color: #27272A; } .badge { background: #27272A; color: #A1A1AA; }
  .row { border-color: #27272A; } .row span:first-child { color: #A1A1AA; } .btn { background: #18181B; color: #FAFAFA; border-color: #27272A; } .btn:hover { background: #27272A; }
  .btn.primary { background: #FAFAFA; color: #0B0B0C; border-color: #FAFAFA; } input { background: #18181B; color: #FAFAFA; border-color: #3F3F46; } .toggle { background: #FAFAFA; color: #0B0B0C; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { className?: string; text?: string; title?: string } = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

const eur = (c: number | null) => (c === null ? "—" : (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));

function mount(): ShadowRoot {
  let host = document.getElementById(PANEL_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = css;
    shadow.appendChild(style);
    shadowRef = shadow;
  }
  return shadowRef!;
}
let shadowRef: ShadowRoot | null = null;

function clear(shadow: ShadowRoot) {
  for (const n of Array.from(shadow.children)) if (n.tagName !== "STYLE") n.remove();
}

async function render() {
  const shadow = mount();
  clear(shadow);
  const url = location.href;
  const kind = detectPage(url);
  if (!open) {
    const btn = el("button", { className: "toggle", text: kind === "unknown" ? "Selio" : "Selio ·" + (kind === "item" ? " article" : kind === "conversation" ? " conversation" : " page") });
    btn.addEventListener("click", () => { open = true; void render(); });
    shadow.appendChild(btn);
    return;
  }
  const wrap = el("div", { className: "wrap" });
  const card = el("div", { className: "card" });
  const head = el("div", { className: "head" }, [el("span", { className: "title", text: "Selio" }), el("span", { className: "badge", text: `adaptateur ${ADAPTER_VERSION}` })]);
  const close = el("button", { className: "btn", text: "Fermer" });
  close.addEventListener("click", () => { open = false; void render(); });
  head.appendChild(close);
  card.appendChild(head);
  const body = el("div", { className: "body" });
  card.appendChild(body);
  wrap.appendChild(card);
  shadow.appendChild(wrap);

  const status = await send({ type: "status" });
  const paired = status.ok && (status.data as { paired: boolean }).paired;
  if (!paired) {
    body.append(el("p", { text: "Extension non associée. Ouvrez les options de l'extension et collez un jeton créé dans Selio › Paramètres › Connexions." }));
    body.append(el("p", { className: "msg", text: status.ok ? "" : (status as { message: string }).message }));
    return;
  }
  body.append(el("p", { className: "msg", text: `Compte : ${(status.data as { orgName: string | null }).orgName ?? "?"}` }));

  if (kind === "item") renderItem(body, url);
  else if (kind === "conversation") renderConversation(body, url);
  else body.append(el("p", { text: "Page non prise en charge. Ouvrez une page article ou une conversation." }));
}

function renderItem(body: HTMLElement, url: string) {
  const result = parseItemPage(document as unknown as MinimalDocument, url);
  void send({ type: "diagnostic", report: { url, pageKind: "item", adapterVersion: result.adapterVersion, ok: result.ok, missing: result.missing, warnings: result.warnings, at: new Date().toISOString() } });
  if (!result.ok || !result.data) {
    body.append(el("p", { className: "msg err", text: `Structure de page non reconnue (champs manquants : ${result.missing.join(", ")}). Aucune action possible : l'adaptateur doit être mis à jour.` }));
    return;
  }
  const d = result.data;
  const rows: [string, string][] = [["Titre", d.title], ["Marque", d.brand ?? "—"], ["Taille", d.size ?? "—"], ["État", d.condition ?? "non reconnu"], ["Prix affiché", eur(d.priceCents)], ["Photos", String(d.photoUrls.length)], ["Référence", d.externalRef ?? "—"]];
  for (const [k, v] of rows) body.append(el("div", { className: "row" }, [el("span", { text: k }), el("span", { className: "num", text: v })]));
  if (result.warnings.length) body.append(el("ul", {}, result.warnings.map((w) => el("li", { text: w }))));
  const price = el("input");
  price.placeholder = "Prix d'achat (€)";
  price.inputMode = "decimal";
  body.append(el("label", {}, ["Prix d'achat pour le stock :", price]));
  const actions = el("div", { className: "actions" });
  const capture = el("button", { className: "btn accent", text: "Capturer vers le stock" });
  const msg = el("p", { className: "msg" });
  capture.addEventListener("click", async () => {
    capture.disabled = true;
    msg.className = "msg";
    msg.textContent = "Envoi à Selio…";
    const cents = price.value.trim() ? Math.round(Number(price.value.replace(",", ".")) * 100) : null;
    const item: CapturedItem = { externalRef: d.externalRef, url: d.url, title: d.title, brand: d.brand, size: d.size, condition: d.condition, priceCents: d.priceCents, description: d.description, photoUrls: d.photoUrls, sellerHandle: d.sellerHandle };
    const res = await send({ type: "capture", item, adapterVersion: result.adapterVersion, purchasePriceCents: Number.isFinite(cents) ? cents : null });
    if (res.ok) { msg.className = "msg ok"; msg.textContent = "Article ajouté au stock Selio (statut : en stock). Complétez prix plancher et frais dans l'application."; }
    else { msg.className = "msg err"; msg.textContent = res.message; capture.disabled = false; }
  });
  actions.append(capture);
  body.append(actions, msg);
}

function renderConversation(body: HTMLElement, url: string) {
  const result = parseConversationPage(document as unknown as MinimalDocument, url);
  void send({ type: "diagnostic", report: { url, pageKind: "conversation", adapterVersion: result.adapterVersion, ok: result.ok, missing: result.missing, warnings: result.warnings, at: new Date().toISOString() } });
  if (!result.ok || !result.data) {
    body.append(el("p", { className: "msg err", text: `Conversation non reconnue (champs manquants : ${result.missing.join(", ")}).` }));
    return;
  }
  const d = result.data;
  body.append(el("div", { className: "row" }, [el("span", { text: "Acheteur" }), el("span", { text: d.buyerHandle ?? "—" })]));
  body.append(el("div", { className: "row" }, [el("span", { text: "Article" }), el("span", { text: d.itemTitle ?? "—" })]));
  body.append(el("div", { className: "row" }, [el("span", { text: "Prix affiché" }), el("span", { className: "num", text: eur(d.itemPriceCents) })]));
  body.append(el("div", { className: "row" }, [el("span", { text: "Messages lus" }), el("span", { className: "num", text: String(d.messages.length) })]));
  const rulesBox = el("div");
  const draftBox = el("div");
  const msg = el("p", { className: "msg" });
  const actions = el("div", { className: "actions" });
  const rulesBtn = el("button", { className: "btn", text: "Règles de prix" });
  const draftBtn = el("button", { className: "btn primary", text: "Préparer une réponse" });
  const itemRef = new URLSearchParams(location.search).get("item") ?? null;
  const lastInbound = [...d.messages].reverse().find((m) => m.direction === "inbound");
  const offer = lastInbound ? extractOffer(lastInbound.body) : null;
  rulesBtn.addEventListener("click", async () => {
    rulesBtn.disabled = true;
    const res = await send({ type: "rules", externalRef: itemRef, listedPriceCents: d.itemPriceCents, offerCents: offer });
    rulesBtn.disabled = false;
    rulesBox.replaceChildren();
    if (!res.ok) { msg.className = "msg err"; msg.textContent = res.message; return; }
    const r = res.data as { known: boolean; title: string | null; floorPriceCents: number | null; offerCheck: { ok: boolean; marginCents: number; marginRate: number; reason?: string } | null; margin: { minMarginRate: number; maxDiscountRate: number } };
    rulesBox.append(el("div", { className: "row" }, [el("span", { text: "Article connu de Selio" }), el("span", { text: r.known ? r.title ?? "oui" : "non (capturez-le d'abord)" })]));
    rulesBox.append(el("div", { className: "row" }, [el("span", { text: "Prix plancher" }), el("span", { className: "num", text: eur(r.floorPriceCents) })]));
    rulesBox.append(el("div", { className: "row" }, [el("span", { text: "Marge min. / remise max." }), el("span", { className: "num", text: `${Math.round(r.margin.minMarginRate * 100)} % / ${Math.round(r.margin.maxDiscountRate * 100)} %` })]));
    if (r.offerCheck) rulesBox.append(el("div", { className: "row" }, [el("span", { text: `Offre détectée ${eur(offer)}` }), el("span", { className: "num", text: r.offerCheck.ok ? `acceptable · marge ${eur(r.offerCheck.marginCents)}` : `refusée (${r.offerCheck.reason ?? "règles"})` })]));
  });
  draftBtn.addEventListener("click", async () => {
    draftBtn.disabled = true;
    msg.className = "msg";
    msg.textContent = "Demande d'une suggestion à Selio…";
    const conversation: CapturedConversation = { externalRef: d.externalRef, url: d.url, buyerHandle: d.buyerHandle, itemTitle: d.itemTitle, itemPriceCents: d.itemPriceCents, messages: d.messages, composerFound: d.composerFound };
    const res = await send({ type: "draft", conversation, itemExternalRef: itemRef, adapterVersion: result.adapterVersion });
    draftBtn.disabled = false;
    draftBox.replaceChildren();
    if (!res.ok) { msg.className = "msg err"; msg.textContent = res.message; return; }
    const r = res.data as { body: string; source: string; validated: boolean; rejectionReason: string | null; evaluation: { decision: string; reasons: string[] } | null };
    msg.className = "msg";
    msg.textContent = `${r.source === "ai" ? "Suggestion IA" : "Gabarit déterministe"}${r.rejectionReason ? ` · ${r.rejectionReason}` : " · validée par vos règles"}. Relisez avant d'envoyer : rien ne part sans vous.`;
    draftBox.append(el("div", { className: "draft", text: r.body }));
    if (r.evaluation) draftBox.append(el("ul", {}, r.evaluation.reasons.map((x) => el("li", { text: x }))));
    const insert = el("button", { className: "btn primary", text: d.composerFound ? "Insérer dans le champ de réponse" : "Champ de réponse introuvable" });
    insert.disabled = !d.composerFound;
    insert.addEventListener("click", () => {
      const composer = COMPOSER_SELECTORS.map((s) => document.querySelector<HTMLTextAreaElement>(s)).find(Boolean);
      if (!composer) { msg.className = "msg err"; msg.textContent = "Champ de réponse introuvable : copiez le texte manuellement."; return; }
      composer.focus();
      composer.value = r.body;
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      msg.className = "msg ok";
      msg.textContent = "Texte inséré. Vérifiez puis cliquez vous-même sur Envoyer dans la page.";
    });
    const copy = el("button", { className: "btn", text: "Copier" });
    copy.addEventListener("click", () => void navigator.clipboard?.writeText(r.body));
    draftBox.append(el("div", { className: "actions" }, [insert, copy]));
  });
  actions.append(rulesBtn, draftBtn);
  body.append(rulesBox, actions, msg, draftBox);
  if (lastInbound && /ignore (previous|all) instructions|ignore les instructions/i.test(lastInbound.body)) body.append(el("p", { className: "msg err", text: "Attention : ce message contient une tentative d'instruction. Il est traité comme une donnée, jamais comme une consigne." }));
}

function extractOffer(text: string): number | null {
  const m = text.replace(/ | /g, " ").match(/(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b|eur\b)/i);
  if (!m) return null;
  const v = Number.parseFloat(m[1]!.replace(",", "."));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

// Messages du popup (diagnostic, ouverture du panneau).
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  const parsed = toContent.safeParse(raw);
  if (!parsed.success) return;
  if (parsed.data.type === "togglePanel") { open = !open; void render(); sendResponse({ ok: true }); return; }
  if (parsed.data.type === "runDiagnostic") {
    const url = location.href;
    const kind = detectPage(url);
    const result = kind === "item" ? parseItemPage(document as unknown as MinimalDocument, url) : kind === "conversation" ? parseConversationPage(document as unknown as MinimalDocument, url) : null;
    const report = { url, pageKind: kind, adapterVersion: ADAPTER_VERSION, ok: result?.ok ?? false, missing: result?.missing ?? ["page non prise en charge"], warnings: result?.warnings ?? [], at: new Date().toISOString() };
    void send({ type: "diagnostic", report });
    sendResponse({ ok: true, data: report });
  }
});

// Re-rendu sur navigation SPA (Vinted change l'URL sans rechargement).
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) { lastUrl = location.href; void render(); }
}, 1500);
void render();
// Sécurité : le texte affiché passe toujours par textContent ; escapeHtml reste disponible pour un éventuel rendu HTML futur.
void escapeHtml;
