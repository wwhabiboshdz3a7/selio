import { isVintedHost } from "@selio/contracts";
import { sanitizeUntrustedText } from "@selio/domain";
import { attr, type MinimalDocument, type MinimalElement } from "./dom";
import { parseHtmlDocument } from "./html";
import { extractItemRef, parseCondition, parsePriceCents } from "./v1";
import { CATALOG_GRID_SELECTORS, CATALOG_ITEM_SELECTORS, parseAbsoluteTime, readCatalogCard, type CatalogItem } from "./v1-catalog";

/**
 * Adaptateur « catalog-page » v2 — complément du v1, ajouté après la première lecture réelle de Selio Track
 * (27 novembre 2026) : la vraie page de recherche de Vinted n'avait pas la grille attendue par le v1
 * (`page_changed`, 0 annonce). Le v1 reste essayé en premier ; le v2 prend le relais, dans cet ordre :
 *
 * 1. **Liste d'annonces chargée par la page elle-même** (`/api/v2/catalog/items`, même domaine) : le
 *    navigateur la lit au passage, sans requête supplémentaire. Format le plus stable (prix exact, date).
 * 2. **Lecture souple du HTML** : cartes `product-item-id-<id>` où qu'elles soient, puis, à défaut, liens
 *    d'annonce `/items/<id>` dont l'intitulé (`title`) décrit l'article (« Titre, marque : …, état : …,
 *    taille : …, 12,00 € … »).
 *
 * Lecture seule, valeurs non fiables nettoyées et bornées, rien n'est inventé : un champ absent reste nul.
 */
export const CATALOG_ADAPTER_VERSION_V2 = "vinted-catalog-v2";

/** Éléments supplémentaires à attendre avant de lire le HTML (rendu côté client). */
export const CATALOG_WAIT_SELECTORS_V2 = ['[data-testid^="product-item-id-"]', 'a[href*="/items/"]'];

export interface CatalogV2Options {
  now: Date;
  /** Adresse de la page (base des liens). */
  url: string;
  maxItems?: number;
}

export interface CatalogV2Result {
  adapterVersion: string;
  /** Source de la lecture : liste chargée par la page, ou HTML. */
  source: "api" | "dom";
  items: CatalogItem[];
  skipped: number;
  warnings: string[];
}

const DEFAULT_MAX_ITEMS = 96;
const maxOf = (n?: number) => Math.max(1, Math.min(n ?? DEFAULT_MAX_ITEMS, 500));

function itemUrl(raw: string | null, base: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "" || !isVintedHost(u.hostname)) return null;
  if (!/^\/items\/\d+/.test(u.pathname)) return null;
  return `${u.origin}${u.pathname}`;
}

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? sanitizeUntrustedText(v, max) || null : null);

/** Montant en euros (« 12.5 », 12.5, { amount: "12.5", currency_code: "EUR" }) → centimes ; autre devise : null. */
function amountCents(raw: unknown): number | null {
  let amount: unknown = raw;
  if (raw && typeof raw === "object") {
    const o = raw as { amount?: unknown; currency_code?: unknown; currency?: unknown };
    const currency = o.currency_code ?? o.currency;
    if (typeof currency === "string" && currency.toUpperCase() !== "EUR") return null;
    amount = o.amount;
  }
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number.parseFloat(amount.replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}

/**
 * Liste d'annonces au format JSON chargée par la page de recherche (`{ items: [...] }`). `null` si le texte
 * n'est pas une liste d'annonces reconnue. Le pseudo du vendeur est rendu comme dans le v1 (Radar en a
 * besoin) ; Selio Track le retire avant tout traitement.
 */
export function parseCatalogApiPayload(json: string, options: CatalogV2Options): CatalogV2Result | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const list = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return null;
  const max = maxOf(options.maxItems);
  const warnings: string[] = [];
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of list) {
    if (items.length >= max) {
      warnings.push(`Lecture limitée aux ${max} premières annonces.`);
      break;
    }
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = typeof r.id === "number" ? String(r.id) : typeof r.id === "string" && /^\d+$/.test(r.id) ? r.id : null;
    const url = itemUrl(typeof r.url === "string" ? r.url : typeof r.path === "string" ? r.path : id ? `/items/${id}` : null, options.url);
    const externalRef = url ? extractItemRef(url) : null;
    const title = str(r.title, 200);
    const priceCents = amountCents(r.price);
    if (!url || !externalRef || !title || priceCents === null || seen.has(externalRef)) {
      skipped++;
      continue;
    }
    const photo = (r.photo ?? null) as { url?: unknown; high_resolution?: { timestamp?: unknown } } | null;
    const ts = photo?.high_resolution?.timestamp;
    const published = typeof ts === "number" || typeof ts === "string" ? parseAbsoluteTime(String(ts)) : null;
    const plausible = published && published.getTime() <= options.now.getTime() + 5 * 60_000 ? published : null;
    const user = (r.user ?? null) as { login?: unknown } | null;
    const item: CatalogItem = {
      externalRef,
      url,
      title,
      brand: str(r.brand_title, 80),
      size: str(r.size_title, 40),
      condition: parseCondition(typeof r.status === "string" ? r.status : null),
      priceCents,
      sellerHandle: str(user?.login, 80),
      photoCount: null,
      photoUrl: httpsUrl(photo?.url),
      publishedAt: plausible ? plausible.toISOString() : null,
      publishedAtSource: plausible ? "absolute" : "unknown",
      observedAt: options.now.toISOString(),
    };
    seen.add(externalRef);
    items.push(item);
  }
  return { adapterVersion: CATALOG_ADAPTER_VERSION_V2, source: "api", items, skipped, warnings };
}

/** Intitulé d'un lien d'annonce : « Titre, marque : X, état : Y, taille : Z, 12,00 €, 13,40 € inclut … ». */
function fromLinkTitle(link: MinimalElement, base: string, now: Date): CatalogItem | null {
  const url = itemUrl(attr(link, "href"), base);
  const label = attr(link, "title") ?? attr(link, "aria-label") ?? "";
  if (!url || !label) return null;
  const externalRef = extractItemRef(url);
  const parts = label.split(/,\s+/).map((p) => p.trim()).filter(Boolean);
  const title = sanitizeUntrustedText(parts[0] ?? "", 200);
  const field = (names: string[]) => {
    const p = parts.find((x) => names.some((n) => x.toLowerCase().startsWith(`${n}:`) || x.toLowerCase().startsWith(`${n} :`)));
    return p ? p.slice(p.indexOf(":") + 1).trim() : null;
  };
  // Premier montant : le prix de l'article (le suivant inclut la protection acheteurs).
  const priceCents = parts.map((p) => parsePriceCents(p)).find((c) => c !== null) ?? null;
  if (!externalRef || !title || priceCents === null) return null;
  const brand = field(["marque", "brand"]);
  const conditionText = field(["état", "etat", "condition", "status"]);
  const size = field(["taille", "size"]);
  return {
    externalRef,
    url,
    title,
    brand: brand ? sanitizeUntrustedText(brand, 80) || null : null,
    size: size ? sanitizeUntrustedText(size, 40) || null : null,
    condition: parseCondition(conditionText),
    priceCents,
    sellerHandle: null,
    photoCount: null,
    photoUrl: null,
    publishedAt: null,
    publishedAtSource: "unknown",
    observedAt: now.toISOString(),
  };
}

/**
 * Lecture souple du document : cartes `product-item-id-<id>` n'importe où dans la page, puis liens
 * d'annonce décrits par leur intitulé. `null` si rien n'est lisible.
 */
export function parseCatalogDocumentLoose(doc: MinimalDocument, options: CatalogV2Options): CatalogV2Result | null {
  const max = maxOf(options.maxItems);
  const warnings: string[] = [];
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const push = (item: CatalogItem | null) => {
    if (!item || seen.has(item.externalRef)) {
      skipped++;
      return;
    }
    if (items.length >= max) return;
    seen.add(item.externalRef);
    items.push(item);
  };
  const roots = safeAll(doc, '[data-testid^="product-item-id-"]').filter((el) => /^product-item-id-\d+$/.test(attr(el, "data-testid") ?? ""));
  const cards = roots.length > 0 ? roots : CATALOG_ITEM_SELECTORS.flatMap((s) => safeAll(doc, s));
  for (const card of cards) {
    const local: string[] = [];
    const item = readCatalogCard(card, options.url, options.now, local);
    if (item) push(item);
    else {
      const link = safeAll(card, 'a[href*="/items/"]')[0];
      push(link ? fromLinkTitle(link, options.url, options.now) : null);
    }
  }
  if (items.length === 0) {
    for (const link of safeAll(doc, 'a[href*="/items/"]')) {
      if (items.length >= max) break;
      const item = fromLinkTitle(link, options.url, options.now);
      if (item && !seen.has(item.externalRef)) {
        seen.add(item.externalRef);
        items.push(item);
      }
    }
  }
  if (items.length === 0) return null;
  if (items.length >= max) warnings.push(`Lecture limitée aux ${max} premières annonces.`);
  return { adapterVersion: CATALOG_ADAPTER_VERSION_V2, source: "dom", items, skipped, warnings };
}

function safeAll(root: MinimalElement, selector: string): MinimalElement[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Diagnostic d'une page non reconnue, pour corriger l'adaptateur sans relire la page : uniquement des
 * COMPTES et des NOMS DE STRUCTURE (préfixes de `data-testid` sans leurs numéros), jamais de texte de la
 * page, de pseudo, de prix ni d'adresse d'annonce.
 */
export function catalogPageDiagnostic(html: string, payloadCount = 0): Record<string, string | number> {
  const out: Record<string, string | number> = { htmlChars: html.length, payloads: payloadCount };
  let doc: MinimalDocument;
  try {
    doc = parseHtmlDocument(html);
  } catch {
    out.parse = "échec";
    return out;
  }
  out.grids = CATALOG_GRID_SELECTORS.map((s) => `${s}=${safeAll(doc, s).length}`).join(" ");
  out.cardsV1 = CATALOG_ITEM_SELECTORS.map((s) => `${s}=${safeAll(doc, s).length}`).join(" ");
  out.productRoots = safeAll(doc, '[data-testid^="product-item-id-"]').filter((el) => /^product-item-id-\d+$/.test(attr(el, "data-testid") ?? "")).length;
  const ids = new Set<string>();
  let titled = 0;
  for (const a of safeAll(doc, 'a[href*="/items/"]')) {
    const ref = extractItemRef(attr(a, "href") ?? "");
    if (ref) ids.add(ref);
    if ((attr(a, "title") ?? "").length > 0) titled++;
  }
  out.itemLinks = ids.size;
  out.itemLinksWithTitle = titled;
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
