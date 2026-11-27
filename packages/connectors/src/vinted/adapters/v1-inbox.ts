import { isVintedHost } from "@selio/contracts";
import { sanitizeUntrustedText } from "@selio/domain";
import { attr, type MinimalDocument, type MinimalElement } from "./dom";
import { parseHtmlDocument } from "./html";

/**
 * Adaptateur « messagerie » v1 (Selio Cloud, lecture de la messagerie) — construit sur des fixtures
 * SYNTHÉTIQUES, NON VÉRIFIÉ EN RÉEL : ni le JSON ni le HTML de la messagerie de Vinted n'ont été observés.
 *
 * Ordre de lecture, du plus stable au plus fragile :
 * 1. **Réponses JSON que la page charge elle-même** (même domaine) : liste des conversations
 *    (`/api/v2/inbox…`) et conversation (`/api/v2/conversations/<id>`). Le navigateur les lit au passage,
 *    sans aucune requête supplémentaire.
 * 2. **Lecture souple du HTML** de la liste : liens `/inbox/<id>` du même site, indices « non lu »
 *    (`aria-label`, `data-testid`, classes, pastilles). Une conversation affichée se lit avec
 *    `parseConversationPage` (adaptateur v1), jamais ici.
 * 3. Rien de reconnu : `inboxPageDiagnostic` rend des COMPTES et des NOMS DE STRUCTURE seulement.
 *
 * Lecture seule, valeurs non fiables nettoyées et bornées, rien n'est inventé : une direction de message
 * impossible à établir fait écarter le message (jamais deviné), une offre dans une autre devise que l'euro
 * est ignorée.
 */
export const INBOX_ADAPTER_VERSION = "vinted-inbox-v1";

/** Conversations ouvertes quand aucune n'est repérable comme « non lue » (la liste ne le dit pas). */
export const INBOX_RECENT_FALLBACK = 3;

/** Éléments à attendre avant de lire la liste en HTML (rendu côté client). */
export const INBOX_WAIT_SELECTORS = ['a[href*="/inbox/"]'];
/** Éléments à attendre avant de lire une conversation affichée (ceux de l'adaptateur v1). */
export const CONVERSATION_WAIT_SELECTORS = ["[data-direction]", 'li[data-testid^="message-"]', ".conversation-message"];

export interface InboxListEntry {
  /** Identifiant de la conversation (`/inbox/<ref>`). */
  ref: string;
  /** Vrai / faux si la page le dit ; null si rien ne permet de le savoir. */
  unread: boolean | null;
  buyerHandle: string | null;
  itemExternalRef: string | null;
  /** Date du dernier message (ISO) si la liste la donne. */
  lastMessageAt: string | null;
}

export interface InboxListResult {
  adapterVersion: string;
  source: "api" | "dom";
  entries: InboxListEntry[];
  skipped: number;
}

export interface InboxMessage {
  direction: "inbound" | "outbound";
  body: string;
  at: string | null;
  offerCents: number | null;
}

export interface InboxConversationData {
  ref: string;
  buyerHandle: string | null;
  itemExternalRef: string | null;
  messages: InboxMessage[];
  /** Messages écartés (direction impossible à établir, corps vide, offre hors euro sans texte). */
  skipped: number;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGES = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});

function refOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^\d{1,20}$/.test(v)) return v;
  return null;
}

/** Pseudo Vinted : lettres, chiffres, « _ », « . », « - » ; toute autre forme est écartée (jamais réécrite). */
const handleOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const h = sanitizeUntrustedText(v, 80).trim();
  return /^[\p{L}\p{N}_.-]{1,80}$/u.test(h) ? h : null;
};

/** Date ISO, horodatage Unix (secondes ou millisecondes) → ISO ; null si invraisemblable. */
export function parseVintedTime(v: unknown): string | null {
  let d: Date | null = null;
  if (typeof v === "number" && Number.isFinite(v)) d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    d = /^\d{9,13}$/.test(t) ? new Date(Number(t) < 1e12 ? Number(t) * 1000 : Number(t)) : new Date(t);
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 2008 && y <= 2100 ? d.toISOString() : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/**
 * Montant en euros → centimes. La devise doit être DITE et valoir EUR (objet `{ amount, currency_code }`,
 * ou champ `currency` voisin) : un montant sans devise, ou dans une autre devise, est ignoré.
 */
export function eurAmountCents(raw: unknown, siblingCurrency?: unknown): number | null {
  let amount: unknown = raw;
  let currency: unknown = siblingCurrency;
  if (isObj(raw)) {
    amount = raw.amount;
    currency = raw.currency_code ?? raw.currency ?? siblingCurrency;
  }
  if (typeof currency !== "string" || currency.trim().toUpperCase() !== "EUR") return null;
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number.parseFloat(amount.replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}

function firstArray(data: unknown, paths: string[][]): unknown[] | null {
  for (const path of paths) {
    let cur: unknown = data;
    for (const k of path) cur = isObj(cur) ? cur[k] : undefined;
    if (Array.isArray(cur)) return cur;
  }
  return null;
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Liste des conversations (JSON chargé par la page de messagerie). `null` si le texte n'en est pas une. */
export function parseInboxApiPayload(json: string): InboxListResult | null {
  const list = firstArray(parseJson(json), [["conversations"], ["inbox", "conversations"], ["data", "conversations"]]);
  if (!list) return null;
  const entries: InboxListEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of list) {
    if (entries.length >= MAX_ENTRIES) break;
    const r = obj(raw);
    const ref = refOf(r.id);
    if (!ref || seen.has(ref)) {
      skipped++;
      continue;
    }
    seen.add(ref);
    const count = [r.unread_count, r.unread_messages_count].find((v): v is number => typeof v === "number" && Number.isFinite(v));
    const readFlag = bool(r.read) ?? bool(r.is_read);
    const unread = bool(r.unread) ?? bool(r.is_unread) ?? (count !== undefined ? count > 0 : readFlag !== null ? !readFlag : null);
    const opposite = obj(r.opposite_user ?? r.other_user);
    const last = obj(r.last_message);
    entries.push({
      ref,
      unread,
      buyerHandle: handleOf(opposite.login ?? r.opposite_user_login),
      itemExternalRef: refOf(r.item_id ?? obj(r.item).id ?? obj(r.transaction).item_id),
      lastMessageAt: parseVintedTime(r.updated_at ?? r.last_message_at ?? last.created_at ?? r.updated_at_ts),
    });
  }
  return { adapterVersion: INBOX_ADAPTER_VERSION, source: "api", entries, skipped };
}

/**
 * Conversation au format JSON (`{ conversation: { id, messages: [...], opposite_user, transaction } }`).
 * Direction d'un message : drapeau explicite (`is_own`, `is_current_user`…), sinon auteur comparé à
 * l'interlocuteur ou à l'utilisateur courant ; sinon le message est écarté. `null` si rien n'est reconnu.
 */
export function parseConversationApiPayload(json: string, expectedRef?: string): InboxConversationData | null {
  const data = parseJson(json);
  const c = isObj(data) && isObj(data.conversation) ? data.conversation : obj(data);
  const ref = refOf(c.id);
  const list = Array.isArray(c.messages) ? c.messages : null;
  if (!ref || !list || (expectedRef && ref !== expectedRef)) return null;
  const opposite = obj(c.opposite_user ?? c.other_user);
  const oppositeId = refOf(opposite.id);
  const currentId = refOf(c.current_user_id ?? obj(c.current_user).id ?? (isObj(data) ? data.current_user_id : undefined));
  const transaction = obj(c.transaction);
  const messages: InboxMessage[] = [];
  let skipped = 0;
  for (const raw of list) {
    if (messages.length >= MAX_MESSAGES) break;
    const m = obj(raw);
    const e = isObj(m.entity) ? m.entity : m;
    const flag = bool(m.is_own) ?? bool(e.is_own) ?? bool(m.own) ?? bool(m.is_current_user) ?? bool(e.is_current_user) ?? bool(e.is_sender_current_user);
    const author = refOf(e.user_id ?? m.user_id ?? e.sender_id ?? obj(m.sender).id ?? obj(e.user).id);
    let direction: InboxMessage["direction"] | null = null;
    if (flag !== null) direction = flag ? "outbound" : "inbound";
    else if (author && oppositeId) direction = author === oppositeId ? "inbound" : "outbound";
    else if (author && currentId) direction = author === currentId ? "outbound" : "inbound";
    const type = typeof m.entity_type === "string" ? m.entity_type : typeof m.type === "string" ? m.type : "";
    const offerRaw = e.price ?? e.offer_price ?? (/offer/i.test(type) ? e.amount : undefined);
    const offerCents = offerRaw !== undefined ? eurAmountCents(offerRaw, e.currency ?? e.currency_code) : null;
    let body = typeof e.body === "string" ? sanitizeUntrustedText(e.body, 2000) : typeof e.text === "string" ? sanitizeUntrustedText(e.text, 2000) : "";
    // Offre sans texte : décrite par son montant (donnée lue, pas inventée), en euros seulement.
    if (!body && offerCents !== null) body = `Offre : ${(offerCents / 100).toFixed(2).replace(".", ",")} €`;
    if (!direction || !body) {
      skipped++;
      continue;
    }
    messages.push({ direction, body, at: parseVintedTime(m.created_at_ts ?? m.created_at ?? e.created_at ?? e.created_at_ts), offerCents });
  }
  // Ordre chronologique quand toutes les dates sont connues (tri stable) ; sinon l'ordre de la page.
  if (messages.length > 1 && messages.every((m) => m.at)) messages.sort((a, b) => a.at!.localeCompare(b.at!));
  return {
    ref,
    buyerHandle: handleOf(opposite.login),
    itemExternalRef: refOf(transaction.item_id ?? obj(transaction.item).id ?? c.item_id ?? obj(c.item).id),
    messages,
    skipped,
  };
}

function safeAll(root: MinimalElement, selector: string): MinimalElement[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** Référence d'un lien de conversation du même site (https, domaine Vinted ou même origine que la page). */
export function inboxLinkRef(href: string | null, pageUrl: string): string | null {
  if (!href) return null;
  let u: URL;
  let page: URL;
  try {
    page = new URL(pageUrl);
    u = new URL(href, page);
  } catch {
    return null;
  }
  const sameOrigin = u.origin === page.origin;
  const vinted = u.protocol === "https:" && u.port === "" && isVintedHost(u.hostname);
  if (!sameOrigin && !vinted) return null;
  if (u.username || u.password) return null;
  const m = /^\/inbox\/(\d{1,20})\/?$/.exec(u.pathname);
  return m ? m[1]! : null;
}

const UNREAD_RE = /unread|non[\s_-]?lu/i;
const UNREAD_HINT_SELECTORS = ['[data-testid*="unread"]', '[aria-label*="non lu"]', '[aria-label*="Non lu"]', '[aria-label*="unread"]', '[class*="unread"]', '[data-testid*="badge"]', '[class*="badge"]'];

function hasUnreadHint(el: MinimalElement): boolean {
  for (const a of ["aria-label", "data-testid", "class", "title"]) if (UNREAD_RE.test(attr(el, a) ?? "")) return true;
  return UNREAD_HINT_SELECTORS.some((s) => safeAll(el, s).length > 0);
}

/**
 * Lecture souple de la liste des conversations dans le HTML : lignes (`li`, `[role="listitem"]`,
 * `[data-testid*="conversation"]`) qui contiennent UN SEUL lien de conversation, puis liens restants. Un
 * indice « non lu » n'est retenu que s'il est dans la ligne (ou le lien) de la conversation. Si la page ne
 * porte aucun indice, `unread` reste nul partout (impossible à savoir). `null` si aucun lien n'est trouvé.
 */
export function parseInboxDocumentLoose(doc: MinimalDocument, pageUrl: string): InboxListResult | null {
  const entries = new Map<string, InboxListEntry>();
  let skipped = 0;
  let anyHint = false;
  const add = (ref: string, hint: boolean) => {
    if (entries.has(ref)) return;
    if (entries.size >= MAX_ENTRIES) return;
    if (hint) anyHint = true;
    entries.set(ref, { ref, unread: hint, buyerHandle: null, itemExternalRef: null, lastMessageAt: null });
  };
  for (const row of [...safeAll(doc, "li"), ...safeAll(doc, '[role="listitem"]'), ...safeAll(doc, '[data-testid*="conversation"]')]) {
    const refs = new Set(safeAll(row, 'a[href*="/inbox/"]').map((a) => inboxLinkRef(attr(a, "href"), pageUrl)).filter((r): r is string => r !== null));
    if (refs.size !== 1) continue;
    add([...refs][0]!, hasUnreadHint(row));
  }
  for (const a of safeAll(doc, 'a[href*="/inbox/"]')) {
    const ref = inboxLinkRef(attr(a, "href"), pageUrl);
    if (!ref) {
      skipped++;
      continue;
    }
    add(ref, hasUnreadHint(a));
  }
  if (entries.size === 0) return null;
  const list = [...entries.values()].map((e) => ({ ...e, unread: anyHint ? e.unread : null }));
  return { adapterVersion: INBOX_ADAPTER_VERSION, source: "dom", entries: list, skipped };
}

/**
 * Conversations à ouvrir : celles marquées non lues, au plus `max`, dans l'ordre de la liste. Si la liste
 * ne dit rien du statut « non lu », les `INBOX_RECENT_FALLBACK` plus récentes (date du dernier message,
 * sinon ordre de la liste).
 */
export function selectConversationsToOpen(entries: readonly InboxListEntry[], max: number): InboxListEntry[] {
  const limit = Math.max(0, Math.floor(max));
  if (entries.some((e) => e.unread !== null)) return entries.filter((e) => e.unread === true).slice(0, limit);
  const indexed = entries.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => (a.e.lastMessageAt && b.e.lastMessageAt ? b.e.lastMessageAt.localeCompare(a.e.lastMessageAt) : 0) || a.i - b.i);
  return indexed.slice(0, Math.min(limit, INBOX_RECENT_FALLBACK)).map((x) => x.e);
}

/** Chemin d'une réponse JSON de liste de conversations (lue au passage, même domaine). */
export function isInboxApiPath(pathname: string): boolean {
  return /^\/api\/v2\/inbox(?:\/|$)/.test(pathname);
}

/** Référence d'une réponse JSON de conversation (`/api/v2/conversations/<id>`), ou null. */
export function conversationApiRef(pathname: string): string | null {
  const m = /^\/api\/v2\/conversations\/(\d{1,20})\/?$/.exec(pathname);
  return m ? m[1]! : null;
}

/**
 * Diagnostic d'une messagerie non reconnue : uniquement des COMPTES et des NOMS DE STRUCTURE (préfixes de
 * `data-testid` sans leurs numéros), jamais de texte de la page, de pseudo ni d'adresse.
 */
export function inboxPageDiagnostic(html: string, payloadCount = 0): Record<string, string | number> {
  const out: Record<string, string | number> = { adapter: INBOX_ADAPTER_VERSION, htmlChars: html.length, payloads: payloadCount };
  let doc: MinimalDocument;
  try {
    doc = parseHtmlDocument(html);
  } catch {
    out.parse = "échec";
    return out;
  }
  const refs = new Set<string>();
  let links = 0;
  for (const a of safeAll(doc, 'a[href*="/inbox/"]')) {
    links++;
    const m = /\/inbox\/(\d{1,20})/.exec(attr(a, "href") ?? "");
    if (m) refs.add(m[1]!);
  }
  out.inboxLinks = links;
  out.inboxRefs = refs.size;
  out.unreadHints = UNREAD_HINT_SELECTORS.reduce((n, s) => n + safeAll(doc, s).length, 0);
  out.listItems = safeAll(doc, "li").length;
  const prefixes = new Map<string, number>();
  for (const el of safeAll(doc, "[data-testid]")) {
    const key = (attr(el, "data-testid") ?? "").replace(/\d+/g, "#").slice(0, 60);
    prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
  }
  out.testids = [...prefixes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([k, n]) => `${k}:${n}`)
    .join(" | ");
  out.nextData = /id=["']__NEXT_DATA__["']/.test(html) ? 1 : 0;
  out.rscChunks = (html.match(/self\.__next_f\.push/g) ?? []).length;
  return out;
}
