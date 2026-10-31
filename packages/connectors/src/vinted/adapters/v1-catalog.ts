import { isVintedHost, type ItemCondition } from "@selio/contracts";
import { sanitizeUntrustedText } from "@selio/domain";
import { all, attr, first, text, type MinimalDocument, type MinimalElement } from "./dom";
import { parseHtmlDocument } from "./html";
import { extractItemRef, parseCondition, parsePriceCents } from "./v1";

/**
 * Adaptateur « catalog-page » — page de résultats d'une recherche Vinted
 * (`/catalog?…`), lue par Selio Radar depuis le compte Achat du client.
 *
 * CONSTRUIT SUR FIXTURE SYNTHÉTIQUE (`fixtures/catalog-page.v1.html`), NON
 * VÉRIFIÉ EN RÉEL : les sélecteurs suivent les conventions des autres
 * adaptateurs (`data-testid` d'abord, replis ensuite) et sont à relever sur une
 * vraie page avant toute activation. Un nouvel état de la page se traite dans
 * un fichier `v2-catalog.ts`, jamais en modifiant celui-ci en place.
 *
 * Lecture seule : aucune action sur la page. Toute valeur lue est une donnée
 * non fiable (nettoyée, bornée). Le pseudo et la photo du vendeur sont rendus
 * parce que l'affaire en a besoin ; leur conservation (purge avec
 * l'opportunité) est l'affaire de l'appelant.
 */
export const CATALOG_ADAPTER_VERSION = "vinted-catalog-v1";

/** Conteneur de la grille de résultats (sa présence fait d'une page une page catalogue). */
export const CATALOG_GRID_SELECTORS = ['[data-testid="catalog-grid"]', '[data-testid="feed-grid"]', ".feed-grid"];
/** Une carte d'annonce dans la grille. */
export const CATALOG_ITEM_SELECTORS = ['[data-testid="grid-item"]', ".feed-grid__item"];

/** Champs d'une carte, par suffixe de `data-testid` (`product-item-id-<id>--<champ>`), puis replis. */
const CARD = {
  link: ['[data-testid$="--overlay-link"]', "a[href*='/items/']"],
  title: ['[data-testid$="--title"]'],
  brand: ['[data-testid$="--description-title"]', '[data-testid$="--brand"]'],
  subtitle: ['[data-testid$="--description-subtitle"]'],
  size: ['[data-testid$="--size"]'],
  condition: ['[data-testid$="--condition"]'],
  price: ['[data-testid$="--price-text"]', '[data-testid$="--price"]'],
  shipping: ['[data-testid$="--shipping"]'],
  image: ['[data-testid$="--image--img"]', "img"],
  photoCount: ['[data-testid$="--photo-count"]'],
  uploaded: ['[data-testid$="--upload-date"]', "time"],
  ownerName: ['[data-testid$="--owner-name"]'],
  ownerRating: ['[data-testid$="--owner-rating"]'],
  ownerReviews: ['[data-testid$="--owner-reviews"]'],
};

export type CatalogBlockCode = "captcha" | "rate_limited" | "blocked" | "warning" | "not_logged_in";

/** Signal de Vinted qui oblige à arrêter la lecture (jamais à le contourner). */
export interface CatalogBlock {
  code: CatalogBlockCode;
  /** Identifiant du motif reconnu (diagnostic, aucune donnée de la page). */
  pattern: string;
}

/** Détecteur injectable : Selio Cloud passe `detectBlock` de `@selio/cloud`. */
export type CatalogBlockDetector = (html: string, url: string, options: { status: number | null }) => CatalogBlock | null;

export interface CatalogItem {
  externalRef: string;
  /** Adresse https de l'annonce sur un domaine Vinted (liste fermée), sans paramètres. */
  url: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: ItemCondition | null;
  priceCents: number;
  /** Port affiché sur la carte, quand il l'est. */
  shippingCents?: number;
  sellerHandle: string | null;
  sellerRating?: number;
  sellerReviews?: number;
  photoCount: number | null;
  /** Photo principale (https seulement). */
  photoUrl: string | null;
  /**
   * Date de publication : lue (horodatage absolu de la page) ou ESTIMÉE depuis
   * le texte relatif (« il y a 3 min » → maintenant − 3 min, à la minute près).
   */
  publishedAt: string | null;
  publishedAtSource: "absolute" | "relative" | "unknown";
  /** Instant de la lecture (horloge de l'appelant). */
  observedAt: string;
}

export interface CatalogPageResult {
  adapterVersion: string;
  /** Page reconnue comme une page catalogue lisible (grille trouvée, cartes lues). */
  pageOk: boolean;
  /** Signal de Vinted : la lecture s'arrête, aucune annonce n'est rendue. */
  blocked: CatalogBlock | null;
  items: CatalogItem[];
  /** Cartes vues mais écartées (lien hors Vinted, prix illisible, doublon). */
  skipped: number;
  warnings: string[];
  /** Éléments attendus mais introuvables : la page a changé (adaptateur à revoir). */
  missing: string[];
}

export interface ParseCatalogOptions {
  /** Horloge de lecture (`observedAt`, dates relatives). */
  now: Date;
  /** Adresse de la page (base des liens relatifs). Défaut : https://www.vinted.fr/catalog. */
  url?: string;
  /** Statut HTTP de la réponse principale, s'il est connu (429 → trop de requêtes, 403 → blocage). */
  status?: number | null;
  /** Détecteur de signaux ; défaut : `detectCatalogBlock` (motifs locaux, sous-ensemble de `@selio/cloud`). */
  detectBlock?: CatalogBlockDetector;
  /** Cartes lues au plus (96 par défaut). */
  maxItems?: number;
}

const DEFAULT_CATALOG_URL = "https://www.vinted.fr/catalog";
const DEFAULT_MAX_ITEMS = 96;

// ---------------------------------------------------------------------------
// Signaux de blocage (repli local)

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

/**
 * Repli local quand aucun détecteur n'est injecté (Selio Cloud injecte toujours
 * `detectBlock` de `@selio/cloud`, la référence). Sous-ensemble cohérent de ses
 * motifs, sans les cas « membre » : statut 429 / 403, domaines et cadres de
 * vérification, et titres « en évidence » (titre, h1–h3, alertes, dialogues).
 * Sert uniquement à s'arrêter, jamais à contourner.
 */
export function detectCatalogBlock(html: string, url: string, options: { status: number | null } = { status: null }): CatalogBlock | null {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = `${u.pathname}${u.search}`;
  } catch {
    // adresse illisible : seuls le statut et la page comptent
  }
  const markup = (html ?? "").replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const lower = markup.toLowerCase();
  if (/(^|\.)captcha-delivery\.com$|(^|\.)challenges\.cloudflare\.com$/.test(host) || /^\/(?:captcha|challenge)(?:[/?#]|$)|[?&]__cf_chl_/.test(path)) return { code: "captcha", pattern: "local.captcha.url" };
  if (/captcha-delivery\.com|id\s*=\s*["']?(?:challenge-form|challenge-running|challenge-stage|cf-challenge-running)\b|hcaptcha\.com\/captcha\/|recaptcha\/(?:api2|enterprise)\/anchor\?(?![^"'>]*size=invisible)/.test(lower)) {
    return { code: "captcha", pattern: "local.captcha.markup" };
  }
  const prominent: string[] = [];
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(markup);
  if (title?.[1]) prominent.push(title[1]);
  for (const m of markup.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) prominent.push(m[2] ?? "");
  for (const m of markup.matchAll(/<[a-z][a-z0-9-]*\b[^>]*\brole\s*=\s*["']?(?:alert|alertdialog|dialog)\b[^>]*>([\s\S]{0,600})/gi)) prominent.push(m[1] ?? "");
  const t = norm(prominent.join(" • ").replace(/<[^>]*>/g, " "));
  if (/captcha|verifie[sz]? que (?:vous etes|tu es) (?:un )?humain|pas un robot|not a robot|checking your browser|verification de securite|verification anti-?robot/.test(t)) return { code: "captcha", pattern: "local.captcha.text" };
  if (options.status === 429 || /trop de (?:requetes|demandes)|too many requests|rate limit/.test(t)) return { code: "rate_limited", pattern: "local.rate_limited" };
  if (/acces refuse|access denied|(?:vous avez|tu as) ete bloquee?s?|you have been blocked|compte (?:suspendu|bloque|banni)/.test(t)) return { code: "blocked", pattern: "local.blocked.text" };
  if (options.status === 403) return { code: "blocked", pattern: "local.blocked.http403" };
  if (/avertissement|activite (?:inhabituelle|suspecte)|unusual activity|suspicious activity/.test(t)) return { code: "warning", pattern: "local.warning" };
  return null;
}

// ---------------------------------------------------------------------------
// Dates relatives

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  min: 60_000,
  h: 3_600_000,
  j: 86_400_000,
  sem: 7 * 86_400_000,
  mois: 30 * 86_400_000,
};

function unitOf(raw: string): keyof typeof UNIT_MS | null {
  const u = raw.toLowerCase();
  if (/^(s|sec|secs|seconde|secondes|second|seconds)$/.test(u)) return "s";
  if (/^(m|mn|min|mins|minute|minutes)$/.test(u)) return "min";
  if (/^(h|heure|heures|hour|hours)$/.test(u)) return "h";
  if (/^(j|jour|jours|day|days)$/.test(u)) return "j";
  if (/^(sem|semaine|semaines|week|weeks)$/.test(u)) return "sem";
  if (/^(mois|month|months)$/.test(u)) return "mois";
  return null;
}

/**
 * Date estimée depuis un texte relatif (« il y a 3 min », « il y a une heure »,
 * « à l'instant », « 5 minutes ago »). `null` si le texte n'est pas reconnu.
 * La précision est celle du texte : une minute pour « il y a 3 min », une heure
 * pour « il y a 2 h ».
 */
export function parseRelativeTime(raw: string | null, now: Date): Date | null {
  if (!raw) return null;
  const t = norm(raw);
  if (/^(a l'instant|maintenant|just now|il y a (?:quelques|qq) secondes?)$/.test(t) || /\b(a l'instant|just now)\b/.test(t)) return new Date(now.getTime());
  const fr = /il y a\s+(\d{1,4}|une|un)\s*([a-z]+)/.exec(t);
  const en = /\b(\d{1,4}|an|a|one)\s*([a-z]+)\s+ago\b/.exec(t);
  const m = fr ?? en;
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number.parseInt(m[1]!, 10) : 1;
  const unit = unitOf(m[2]!);
  if (!unit) return null;
  return new Date(now.getTime() - n * UNIT_MS[unit]!);
}

/** Horodatage absolu avec fuseau (ISO avec Z ou décalage, ou secondes Unix). */
export function parseAbsoluteTime(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{9,11}$/.test(s)) {
    const d = new Date(Number.parseInt(s, 10) * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Lecture d'une carte

function itemUrl(href: string | null, base: string): string | null {
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "" || !isVintedHost(u.hostname)) return null;
  if (!/^\/items\/\d+/.test(u.pathname)) return null;
  return `${u.origin}${u.pathname}`;
}

function httpsUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

function parseDecimal(raw: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(raw);
  if (!m) return null;
  const v = Number.parseFloat(m[1]!.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function readCard(card: MinimalElement, base: string, now: Date, warnings: string[]): CatalogItem | null {
  const link = first(card, CARD.link);
  const url = itemUrl(attr(link, "href"), base);
  if (!url) {
    warnings.push("Carte écartée : lien d'annonce absent ou hors des domaines Vinted.");
    return null;
  }
  const externalRef = extractItemRef(url);
  if (!externalRef) return null;
  const priceCents = parsePriceCents(text(first(card, CARD.price)));
  if (priceCents === null) {
    warnings.push(`Annonce ${externalRef} écartée : prix illisible.`);
    return null;
  }
  const img = first(card, CARD.image);
  const linkTitle = (attr(link, "title") ?? "").split(",")[0] ?? "";
  const title = sanitizeUntrustedText(text(first(card, CARD.title)) || linkTitle || attr(img, "alt") || "", 200);
  if (!title) {
    warnings.push(`Annonce ${externalRef} écartée : titre absent.`);
    return null;
  }

  const brand = sanitizeUntrustedText(text(first(card, CARD.brand)), 80) || null;
  // Sous-titre « taille · état » : les deux champs dédiés passent d'abord.
  const parts = text(first(card, CARD.subtitle))
    .split(/\s*[·•|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const conditionText = text(first(card, CARD.condition));
  const condition = parseCondition(conditionText) ?? parts.map((p) => parseCondition(p)).find((c) => c !== null) ?? null;
  const sizeText = text(first(card, CARD.size)) || parts.find((p) => parseCondition(p) === null) || "";
  const size = sanitizeUntrustedText(sizeText, 40) || null;

  const shippingCents = parsePriceCents(text(first(card, CARD.shipping)));
  const photoUrl = httpsUrl(attr(img, "src") ?? attr(img, "data-src"));
  const countEl = first(card, CARD.photoCount);
  const countRaw = attr(card, "data-photo-count") ?? attr(countEl, "data-count") ?? text(countEl);
  const count = countRaw ? Number.parseInt(/\d+/.exec(countRaw)?.[0] ?? "", 10) : Number.NaN;
  const photoCount = Number.isInteger(count) && count >= 0 && count <= 30 ? count : null;

  const sellerHandle = sanitizeUntrustedText(text(first(card, CARD.ownerName)), 80) || null;
  const ratingEl = first(card, CARD.ownerRating);
  const rating = parseDecimal(attr(ratingEl, "data-rating") ?? text(ratingEl));
  const reviewsRaw = /\d+/.exec(text(first(card, CARD.ownerReviews)))?.[0];
  const reviews = reviewsRaw ? Number.parseInt(reviewsRaw, 10) : null;

  // Date : horodatage absolu de la page d'abord, sinon estimation depuis le texte relatif.
  const up = first(card, CARD.uploaded);
  const timeEl = up ? (safeQuery(up, "time") ?? up) : null;
  const absolute = parseAbsoluteTime(attr(timeEl, "datetime") ?? attr(up, "datetime") ?? attr(up, "data-timestamp") ?? attr(up, "title"));
  const plausibleAbsolute = absolute && absolute.getTime() <= now.getTime() + 5 * 60_000 ? absolute : null;
  const relative = plausibleAbsolute ? null : parseRelativeTime(text(up), now);
  const publishedAt = plausibleAbsolute ?? relative;

  const item: CatalogItem = {
    externalRef,
    url,
    title,
    brand,
    size,
    condition,
    priceCents,
    sellerHandle,
    photoCount,
    photoUrl,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    publishedAtSource: plausibleAbsolute ? "absolute" : relative ? "relative" : "unknown",
    observedAt: now.toISOString(),
  };
  if (shippingCents !== null) item.shippingCents = shippingCents;
  if (rating !== null && rating >= 0 && rating <= 5) item.sellerRating = rating;
  if (reviews !== null && Number.isInteger(reviews) && reviews >= 0) item.sellerReviews = reviews;
  return item;
}

function safeQuery(el: MinimalElement, selector: string): MinimalElement | null {
  try {
    return el.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Lit un document déjà construit (DOM d'un navigateur, happy-dom, ou
 * `parseHtmlDocument`). Ne détecte pas les signaux de blocage : voir
 * `parseCatalogPage`, qui part du HTML.
 */
export function parseCatalogDocument(doc: MinimalDocument, options: Omit<ParseCatalogOptions, "status" | "detectBlock">): Omit<CatalogPageResult, "blocked"> {
  const warnings: string[] = [];
  const missing: string[] = [];
  const base = options.url ?? DEFAULT_CATALOG_URL;
  const grid = first(doc, CATALOG_GRID_SELECTORS);
  if (!grid) {
    return { adapterVersion: CATALOG_ADAPTER_VERSION, pageOk: false, items: [], skipped: 0, warnings, missing: ["catalog-grid"] };
  }
  const cards = all(grid, CATALOG_ITEM_SELECTORS);
  const max = Math.max(1, Math.min(options.maxItems ?? DEFAULT_MAX_ITEMS, 500));
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const card of cards) {
    if (items.length >= max) {
      warnings.push(`Lecture limitée aux ${max} premières annonces.`);
      break;
    }
    const item = readCard(card, base, options.now, warnings);
    if (!item || seen.has(item.externalRef)) {
      skipped++;
      continue;
    }
    seen.add(item.externalRef);
    items.push(item);
  }
  // Des cartes sans aucune annonce lisible : la structure a changé.
  if (cards.length > 0 && items.length === 0) missing.push("items");
  return { adapterVersion: CATALOG_ADAPTER_VERSION, pageOk: missing.length === 0, items, skipped, warnings: [...new Set(warnings)].slice(0, 20), missing };
}

/**
 * Lit une page catalogue reçue en HTML. Un signal de Vinted (CAPTCHA, trop de
 * requêtes, blocage, avertissement) l'emporte sur tout : `blocked` est rempli,
 * aucune annonce n'est rendue et `pageOk` est faux. Une page qui n'est pas une
 * page catalogue rend `pageOk: false` avec `missing: ["catalog-grid"]`.
 */
export function parseCatalogPage(html: string, options: ParseCatalogOptions): CatalogPageResult {
  const url = options.url ?? DEFAULT_CATALOG_URL;
  const detect = options.detectBlock ?? detectCatalogBlock;
  const blocked = detect(html, url, { status: options.status ?? null });
  if (blocked) return { adapterVersion: CATALOG_ADAPTER_VERSION, pageOk: false, blocked: { code: blocked.code, pattern: blocked.pattern }, items: [], skipped: 0, warnings: [], missing: [] };
  return { ...parseCatalogDocument(parseHtmlDocument(html), { now: options.now, url, maxItems: options.maxItems }), blocked: null };
}

// ---------------------------------------------------------------------------
// Adresse de recherche

/** Critères d'une recherche Radar (forme de `RadarSearch["criteria"]`, champs facultatifs). */
export interface CatalogSearchCriteria {
  keywords?: readonly string[];
  brands?: readonly string[];
  sizes?: readonly string[];
  conditions?: readonly ItemCondition[];
  categories?: readonly string[];
  maxPriceCents?: number;
}

export interface BuildSearchUrlOptions {
  /** Domaine Vinted (liste fermée) ; défaut www.vinted.fr. */
  host?: string;
}

/**
 * Adresse de la page catalogue d'une recherche Radar, triée des plus récentes
 * aux plus anciennes (`order=newest_first`).
 *
 * Seuls `search_text` et le prix sont passés à Vinted. Les identifiants
 * numériques de Vinted (marques `brand_ids[]`, tailles `size_ids[]`, états
 * `status_ids[]`, catégories `catalog[]`) sont À RELEVER EN RÉEL : rien n'est
 * inventé. En attendant :
 * - les mots-clés vont dans `search_text` ; une marque unique s'y ajoute (une
 *   recherche texte ne sait pas faire « marque A ou marque B ») ;
 * - marques, tailles et états sont filtrés après lecture (`filterCatalogItems`) ;
 * - la catégorie n'est pas visible sur une carte : elle n'est pas filtrée.
 * Le format exact des paramètres (`price_to`, `currency`, `order`) est lui
 * aussi à confirmer sur une vraie page.
 */
export function buildSearchUrl(criteria: CatalogSearchCriteria, options: BuildSearchUrlOptions = {}): string {
  const host = (options.host ?? "www.vinted.fr").toLowerCase();
  if (!isVintedHost(host)) throw new Error("Domaine refusé : seuls les domaines Vinted sont acceptés.");
  const words = [...(criteria.keywords ?? [])];
  const brands = (criteria.brands ?? []).filter((b) => b.trim());
  if (brands.length === 1) words.push(brands[0]!);
  const searchText = words
    .map((w) => w.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 200)
    .trim();
  const params = new URLSearchParams();
  if (searchText) params.set("search_text", searchText);
  const max = criteria.maxPriceCents;
  if (typeof max === "number" && Number.isInteger(max) && max > 0) params.set("price_to", String(max / 100));
  params.set("currency", "EUR");
  params.set("order", "newest_first");
  return `https://${host}/catalog?${params.toString()}`;
}

const looseKey = (s: string) => norm(s).replace(/['’\s.-]+/g, "");

/** Vrai si l'annonce respecte les critères qui ne passent pas dans l'adresse (marques, tailles, états, prix). */
export function matchesCatalogCriteria(item: Pick<CatalogItem, "brand" | "size" | "condition" | "priceCents">, criteria: CatalogSearchCriteria): boolean {
  const brands = (criteria.brands ?? []).map(looseKey).filter(Boolean);
  if (brands.length > 0 && (!item.brand || !brands.includes(looseKey(item.brand)))) return false;
  const sizes = (criteria.sizes ?? []).map((s) => norm(s)).filter(Boolean);
  if (sizes.length > 0) {
    if (!item.size) return false;
    const tokens = norm(item.size)
      .split(/[\s/,|]+/)
      .filter(Boolean);
    const whole = norm(item.size);
    if (!sizes.some((s) => s === whole || tokens.includes(s))) return false;
  }
  const conditions = criteria.conditions ?? [];
  if (conditions.length > 0 && (!item.condition || !conditions.includes(item.condition))) return false;
  const max = criteria.maxPriceCents;
  if (typeof max === "number" && max > 0 && item.priceCents > max) return false;
  return true;
}

export function filterCatalogItems<T extends Pick<CatalogItem, "brand" | "size" | "condition" | "priceCents">>(items: readonly T[], criteria: CatalogSearchCriteria): T[] {
  return items.filter((i) => matchesCatalogCriteria(i, criteria));
}
