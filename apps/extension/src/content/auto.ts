import {
  COMPOSER_SELECTORS,
  CONVERSATION_WAIT_SELECTORS,
  INBOX_WAIT_SELECTORS,
  inboxPageDiagnostic,
  parseConversationPage,
  parseInboxDocumentLoose,
  selectConversationsToOpen,
  type MinimalDocument,
} from "@selio/connectors/vinted-adapter";
import { SEND_BUTTON_IN_FORM, SEND_BUTTON_NAME, countSentCopies, detectBlock } from "@selio/cloud/browser";
import type { CloudRunCode } from "@selio/contracts";

/**
 * Automatisation complète dans le navigateur du vendeur (D64) — partie « page » : ce que le content script
 * fait dans l'onglet en arrière-plan ouvert par l'extension. Même logique que l'exécuteur du Cloud :
 * - lecture : liste des conversations (adaptateur `v1-inbox`, lecture souple du HTML), conversation
 *   (`parseConversationPage`), sans aucun clic ; aucun cookie lu, aucune requête vers Vinted ;
 * - envoi : conversation reconnue AVANT d'écrire (aucun clic à l'aveugle), texte mis dans le champ de
 *   réponse, clic sur le bouton d'envoi, confirmation quand le message apparaît ; sans confirmation, effets
 *   « inconnus » (le serveur ne renvoie jamais) ;
 * - `detectBlock` sur chaque page : au premier CAPTCHA, avertissement, blocage ou « trop de requêtes », arrêt
 *   avec le code (le serveur met en pause, prévient, ne retente rien).
 * Ne renvoie que des données de conversation (messages lus) et des codes ; jamais rien d'autre de la page.
 */

export interface AutoEnv {
  doc: Document;
  url: () => string;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

export type AutoFailure = { ok: false; code: CloudRunCode; sideEffects: "none" | "unknown" };

export const AUTO_WAIT_MS = 8_000;
export const AUTO_CONFIRM_MS = 15_000;
/** Messages gardés par conversation (les plus récents) : borne la taille du compte rendu. */
export const AUTO_MAX_MESSAGES = 50;

const minimal = (doc: Document) => doc as unknown as MinimalDocument;

/** Signal de Vinted affiché dans la page (pour s'arrêter, jamais pour contourner). */
export function pageSignal(env: AutoEnv): AutoFailure | null {
  const html = env.doc.documentElement?.outerHTML ?? "";
  const signal = detectBlock(html, env.url());
  return signal ? { ok: false, code: signal.code, sideEffects: "none" } : null;
}

/** Attend qu'un des éléments apparaisse (rendu côté client), au plus `timeoutMs`. */
export async function waitForAny(env: AutoEnv, selectors: readonly string[], timeoutMs: number): Promise<boolean> {
  const until = env.now() + timeoutMs;
  for (;;) {
    for (const s of selectors) {
      try {
        if (env.doc.querySelector(s)) return true;
      } catch {
        // sélecteur refusé par ce moteur : suivant
      }
    }
    if (env.now() >= until) return false;
    await env.wait(300);
  }
}

export type InboxRead = { ok: true; listSource: "dom" | "none"; listed: number; chosen: string[]; diagnostic?: Record<string, string | number> } | AutoFailure;

/** Liste des conversations : celles à ouvrir (non lues, sinon les 3 plus récentes), ou un diagnostic de structure. */
export async function readInbox(env: AutoEnv, max: number): Promise<InboxRead> {
  const first = pageSignal(env);
  if (first) return first;
  await waitForAny(env, INBOX_WAIT_SELECTORS, AUTO_WAIT_MS);
  const again = pageSignal(env);
  if (again) return again;
  const list = parseInboxDocumentLoose(minimal(env.doc), env.url());
  if (!list || list.entries.length === 0) {
    return { ok: true, listSource: "none", listed: 0, chosen: [], diagnostic: inboxPageDiagnostic(env.doc.documentElement?.outerHTML ?? "", 0) };
  }
  return { ok: true, listSource: "dom", listed: list.entries.length, chosen: selectConversationsToOpen(list.entries, max).map((e) => e.ref) };
}

export type ConversationRead =
  | { ok: true; conversation: { ref: string; buyerHandle: string | null; itemExternalRef: null; messages: { direction: "inbound" | "outbound"; body: string; at: string | null; offerCents: null }[] } }
  | AutoFailure;

/** Conversation affichée (adaptateur v1) ; la page doit bien être celle de la conversation demandée. */
export async function readConversation(env: AutoEnv, ref: string): Promise<ConversationRead> {
  const first = pageSignal(env);
  if (first) return first;
  await waitForAny(env, CONVERSATION_WAIT_SELECTORS, AUTO_WAIT_MS);
  const again = pageSignal(env);
  if (again) return again;
  if (!new RegExp(`/inbox/${ref}(?:[/?#]|$)`).test(env.url())) return { ok: false, code: "selector_missing", sideEffects: "none" };
  const parsed = parseConversationPage(minimal(env.doc), env.url());
  if (!parsed.ok || !parsed.data) return { ok: false, code: "selector_missing", sideEffects: "none" };
  return {
    ok: true,
    conversation: { ref, buyerHandle: parsed.data.buyerHandle, itemExternalRef: null, messages: parsed.data.messages.slice(-AUTO_MAX_MESSAGES).map((m) => ({ direction: m.direction, body: m.body, at: m.at, offerCents: null })) },
  };
}

function composerOf(doc: Document): HTMLTextAreaElement | null {
  for (const s of COMPOSER_SELECTORS) {
    const el = doc.querySelector(s);
    if (el && el.tagName === "TEXTAREA" && !(el as HTMLTextAreaElement).disabled) return el as HTMLTextAreaElement;
  }
  return null;
}

function sendButtonOf(doc: Document, composer: HTMLTextAreaElement): HTMLButtonElement | null {
  const inForm = composer.closest("form")?.querySelector(SEND_BUTTON_IN_FORM);
  if (inForm && inForm.tagName === "BUTTON" && !(inForm as HTMLButtonElement).disabled) return inForm as HTMLButtonElement;
  for (const b of Array.from(doc.querySelectorAll("button"))) {
    const name = b.getAttribute("aria-label") ?? b.textContent ?? "";
    if (SEND_BUTTON_NAME.test(name) && !b.disabled) return b;
  }
  return null;
}

/** Valeur d'un champ contrôlé par la page (setter natif, puis événement « input » comme une frappe). */
function fill(composer: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
  if (setter) setter.call(composer, text);
  else composer.value = text;
  composer.dispatchEvent(new Event("input", { bubbles: true }));
}

export type SendResult = { ok: true; code: "ok" } | AutoFailure;

/** Envoie le texte préparé par le serveur dans la conversation affichée, puis vérifie qu'il apparaît. */
export async function sendMessage(env: AutoEnv, text: string, confirmMs = AUTO_CONFIRM_MS): Promise<SendResult> {
  const first = pageSignal(env);
  if (first) return first;
  await waitForAny(env, COMPOSER_SELECTORS, AUTO_WAIT_MS);
  const composer = composerOf(env.doc);
  if (!composer) return pageSignal(env) ?? { ok: false, code: "selector_missing", sideEffects: "none" };
  // Aucun clic à l'aveugle : la conversation doit être reconnue avant d'écrire.
  const before = parseConversationPage(minimal(env.doc), env.url());
  if (!before.ok || !before.data) return { ok: false, code: "selector_missing", sideEffects: "none" };
  const copiesBefore = countSentCopies(before.data, text);
  const button = sendButtonOf(env.doc, composer);
  if (!button) return { ok: false, code: "selector_missing", sideEffects: "none" };
  fill(composer, text);
  const again = pageSignal(env);
  if (again) return again;
  button.click();
  const until = env.now() + confirmMs;
  while (env.now() < until) {
    await env.wait(400);
    const signal = pageSignal(env);
    if (signal) return { ...signal, sideEffects: "unknown" };
    const now = parseConversationPage(minimal(env.doc), env.url());
    if (countSentCopies(now.data, text) > copiesBefore) return { ok: true, code: "ok" };
  }
  return { ok: false, code: "timeout", sideEffects: "unknown" };
}
