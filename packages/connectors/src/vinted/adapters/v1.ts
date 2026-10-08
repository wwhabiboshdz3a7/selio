import type { ItemCondition } from "@selio/contracts";
import { sanitizeUntrustedText } from "@selio/domain";
import { all, attr, first, text, type MinimalDocument } from "./dom";

/**
 * Adaptateur DOM Vinted — version 1 (construit sur fixtures, NON VÉRIFIÉ EN RÉEL).
 *
 * Principes : aucun clic aveugle, aucune injection HTML, échec propre quand la
 * structure n'est pas reconnue. Les sélecteurs privilégient les attributs
 * `data-testid`/`itemprop` puis des replis sémantiques. Toute valeur lue est
 * traitée comme donnée non fiable (nettoyée et bornée).
 */
export const ADAPTER_VERSION = "vinted-dom-v1";

export type PageKind = "item" | "conversation" | "wardrobe" | "unknown";

export interface AdapterResult<T> {
  ok: boolean;
  adapterVersion: string;
  pageKind: PageKind;
  data: T | null;
  warnings: string[];
  /** Champs attendus mais introuvables : indique une évolution de la page. */
  missing: string[];
}

export interface CapturedItem {
  externalRef: string | null;
  url: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: ItemCondition | null;
  priceCents: number | null;
  description: string;
  photoUrls: string[];
  sellerHandle: string | null;
}

export interface CapturedConversation {
  externalRef: string | null;
  url: string;
  buyerHandle: string | null;
  itemTitle: string | null;
  itemPriceCents: number | null;
  messages: { direction: "inbound" | "outbound"; body: string; at: string | null }[];
  composerFound: boolean;
}

export const SUPPORTED_HOSTS = ["www.vinted.fr", "vinted.fr", "www.vinted.be", "www.vinted.com"];

export function detectPage(url: string): PageKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "unknown";
  }
  if (!SUPPORTED_HOSTS.includes(u.hostname)) return "unknown";
  if (/^\/items\/\d+/.test(u.pathname)) return "item";
  if (/^\/inbox\/\d+/.test(u.pathname) || /^\/inbox/.test(u.pathname)) return "conversation";
  if (/^\/member\/\d+/.test(u.pathname) || /^\/wardrobe/.test(u.pathname)) return "wardrobe";
  return "unknown";
}

const CONDITION_MAP: Record<string, ItemCondition> = {
  "neuf avec étiquette": "new_with_tags",
  "neuf sans étiquette": "new_without_tags",
  "très bon état": "very_good",
  "bon état": "good",
  satisfaisant: "satisfactory",
};

export function parseCondition(raw: string | null): ItemCondition | null {
  if (!raw) return null;
  const n = raw.trim().toLowerCase();
  for (const [k, v] of Object.entries(CONDITION_MAP)) if (n.includes(k)) return v;
  return null;
}

export function parsePriceCents(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/\u00a0|\u202f/g, " ").replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
  const m = normalized.match(/(\d{1,6})(?:[.,](\d{1,2}))?\s*€/);
  if (!m) return null;
  const whole = Number.parseInt(m[1]!, 10);
  const dec = m[2] ? Number.parseInt((m[2] + "0").slice(0, 2), 10) : 0;
  return whole * 100 + dec;
}

export function extractItemRef(url: string): string | null {
  const m = url.match(/\/items\/(\d+)/);
  return m ? m[1]! : null;
}

export function parseItemPage(doc: MinimalDocument, url: string): AdapterResult<CapturedItem> {
  const warnings: string[] = [];
  const missing: string[] = [];
  const titleEl = first(doc, ['[data-testid="item-page-summary-plugin"] h1', '[data-testid="item-title"]', "h1[itemprop='name']", "main h1", "h1"]);
  const title = sanitizeUntrustedText(text(titleEl), 200);
  if (!title) missing.push("title");
  const priceEl = first(doc, ['[data-testid="item-price"]', '[data-testid="item-page-summary-plugin"] [data-testid*="price"]', "[itemprop='price']", ".item-price"]);
  const priceCents = parsePriceCents(text(priceEl) || attr(priceEl, "content"));
  if (priceCents === null) missing.push("price");
  const detailRows = all(doc, ['[data-testid="item-attributes"] [data-testid$="--content"]', '[data-testid^="item-attributes-"]', ".details-list__item", "[itemprop]"]);
  let brand: string | null = null;
  let size: string | null = null;
  let condition: ItemCondition | null = null;
  const byTestId = (suffix: string) => first(doc, [`[data-testid="item-attributes-${suffix}"] [data-testid$="--content"]`, `[data-testid="item-attributes-${suffix}"]`, `[itemprop="${suffix}"]`]);
  brand = sanitizeUntrustedText(text(byTestId("brand")), 80) || null;
  size = sanitizeUntrustedText(text(byTestId("size")), 40) || null;
  condition = parseCondition(text(byTestId("status")) || text(byTestId("condition")));
  if (!brand || !size || !condition) {
    for (const row of detailRows) {
      const t = text(row);
      if (!brand && /marque/i.test(t)) brand = sanitizeUntrustedText(t.replace(/marque\s*:?/i, ""), 80) || null;
      if (!size && /taille/i.test(t)) size = sanitizeUntrustedText(t.replace(/taille\s*:?/i, ""), 40) || null;
      if (!condition && /état/i.test(t)) condition = parseCondition(t);
    }
  }
  if (!brand) warnings.push("Marque non trouvée");
  if (!size) warnings.push("Taille non trouvée");
  if (!condition) warnings.push("État non reconnu");
  const descEl = first(doc, ['[data-testid="item-description"]', "[itemprop='description']", ".item-description"]);
  const description = sanitizeUntrustedText(text(descEl), 2000);
  const photoEls = all(doc, ['[data-testid^="item-photo-"] img', ".item-photos img", "figure img"]);
  const photoUrls = photoEls
    .map((img) => attr(img, "src") ?? attr(img, "data-src"))
    .filter((u): u is string => Boolean(u) && /^https:\/\//.test(u!))
    .slice(0, 12);
  const sellerEl = first(doc, ['[data-testid="profile-username"]', '[data-testid="item-seller-username"]', ".user-login", "a[href*='/member/']"]);
  const sellerHandle = sanitizeUntrustedText(text(sellerEl), 80) || null;
  const ok = missing.length === 0;
  return {
    ok,
    adapterVersion: ADAPTER_VERSION,
    pageKind: "item",
    data: ok ? { externalRef: extractItemRef(url), url, title, brand, size, condition, priceCents, description, photoUrls, sellerHandle } : null,
    warnings,
    missing,
  };
}

export function parseConversationPage(doc: MinimalDocument, url: string): AdapterResult<CapturedConversation> {
  const warnings: string[] = [];
  const missing: string[] = [];
  const buyerEl = first(doc, ['[data-testid="conversation-header-username"]', '[data-testid="conversation-opposite-user"]', ".conversation-header a[href*='/member/']", "header a[href*='/member/']"]);
  const buyerHandle = sanitizeUntrustedText(text(buyerEl), 80) || null;
  if (!buyerHandle) missing.push("buyer");
  const itemTitleEl = first(doc, ['[data-testid="conversation-item-title"]', ".conversation-item h2", "[data-testid='transaction-item'] h2"]);
  const itemTitle = sanitizeUntrustedText(text(itemTitleEl), 200) || null;
  const itemPriceEl = first(doc, ['[data-testid="conversation-item-price"]', ".conversation-item [data-testid*='price']"]);
  const itemPriceCents = parsePriceCents(text(itemPriceEl));
  const msgEls = all(doc, ["[data-direction]", 'li[data-testid^="message-"]', ".conversation-message"]);
  const messages = msgEls
    .map((el) => {
      const dirAttr = attr(el, "data-direction") ?? attr(el, "data-testid") ?? "";
      const isOutbound = /outbound|own|sent|message-own/i.test(dirAttr) || /is-own|message--own/.test(attr(el, "class") ?? "");
      const bodyEl = first(el, ['[data-testid$="-body"]', ".message-body", "p"]);
      const body = sanitizeUntrustedText(text(bodyEl) || text(el), 2000);
      const timeEl = first(el, ["time"]);
      const at = attr(timeEl, "datetime");
      return { direction: isOutbound ? ("outbound" as const) : ("inbound" as const), body, at };
    })
    .filter((m) => m.body.length > 0);
  if (messages.length === 0) missing.push("messages");
  const composer = first(doc, ['[data-testid="conversation-reply-textarea"]', "textarea[name='message']", "form textarea"]);
  const composerFound = Boolean(composer);
  if (!composerFound) warnings.push("Champ de réponse introuvable : la préparation du message ne sera pas possible.");
  const refMatch = url.match(/\/inbox\/(\d+)/);
  const ok = missing.length === 0;
  return {
    ok,
    adapterVersion: ADAPTER_VERSION,
    pageKind: "conversation",
    data: ok ? { externalRef: refMatch ? refMatch[1]! : null, url, buyerHandle, itemTitle, itemPriceCents, messages, composerFound } : null,
    warnings,
    missing,
  };
}

/** Sélecteur du champ de réponse : utilisé par l'extension pour pré-remplir (jamais pour envoyer). */
export const COMPOSER_SELECTORS = ['[data-testid="conversation-reply-textarea"]', "textarea[name='message']", "form textarea"];
