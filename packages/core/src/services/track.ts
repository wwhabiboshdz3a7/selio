import { createHash } from "node:crypto";
import {
  ITEM_CATEGORY_LABELS, TRACK_BRAND_SHARES_MAX, TRACK_DEMO_NOTICE, TRACK_GONE_NOTICE, TRACK_INSUFFICIENT_DATA, TRACK_LEGAL_NOTICE, TRACK_MAX_CONSECUTIVE_ANOMALIES, TRACK_MAX_SLOWDOWN_FACTOR,
  TRACK_PHOTO_UNAVAILABLE, TRACK_READ_INTERVAL_HOURS, TRACK_READ_JITTER_MINUTES, TRACK_SALES_FEED_AGENCY_ONLY, TRACK_SALES_FEED_DAYS, TRACK_SCAN_INSUFFICIENT_PER_DAY, TRACK_SCAN_MIN_REFERENCES, TRACK_SCAN_MIN_SOLD,
  TRACK_SCAN_WEIGHTS, TRACK_SCAN_WINDOW_DAYS, TRACK_SELLER_ANALYSIS_NOTICE, TRACK_SIGNAL_PAUSE_MINUTES, TRACK_TRENDS_DAYS, TRACK_TRENDS_DEFAULT_DAYS, TRACK_UNAVAILABLE_MESSAGE,
  quotasForPlan, trackCriteria, trackFilterCreate, trackFilterUpdate, trackPhotoSearchInput, trackScanInput,
  type ItemCategory, type ItemCondition, type PlanQuotas, type RadarCatalogItem, type RadarCatalogItemInput, type RadarReadOutcome, type TrackBrandShare, type TrackCriteria, type TrackFilter,
  type TrackPhotoSearch, type TrackSalesFeed, type TrackScan, type TrackScanComponents, type TrackSnapshot, type TrackSource, type TrackTrendPoint, type TrackTrends,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";

type TrackClaimedRead = repos.TrackClaimedRead;
type TrackReadState = repos.TrackReadState;
import { AIError, buildPhotoDescriptionRequest, providerCanSeeImages, toAIError, validatePhotoDescription } from "@selio/ai";
import { hashString, seededRandom } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services, type ServicesConfig } from "../context";
import * as cloud from "./cloud";
import { aiQuotaLeftTx, estimate, quantileCents, runStructuredAi } from "./pricing";
import { effectiveSlowdownFactor, slowdownAfterRead } from "./radar";
import { RADAR_SIGNALS, validateCatalogItems, type RadarSignal } from "./radar-sources";

/**
 * Selio Track (prompt §5.9, Pro et Agence) : STATISTIQUES SEULEMENT.
 *
 * - Aucune annonce n'est republiée ; aucune photo d'annonce, aucun pseudo, aucun titre ni aucun identifiant
 *   d'annonce n'est gardé. Les annonces ne sont reconnues d'une lecture à l'autre que par une empreinte
 *   salée calculée par la base (`app_track_ref_keys`).
 * - Les filtres identiques entre clients sont lus UNE seule fois : chaque filtre a une empreinte normalisée
 *   de ses critères (`fingerprintOf`), partagée entre organisations (`track_filter_reads`).
 * - Relecture toutes les 2 h (± 10 min), multipliée par le facteur de ralentissement.
 * - Source par défaut : le simulateur (données de démonstration). La lecture en direct des pages
 *   PUBLIQUES du catalogue (sans session, lecteur `RadarReader` de @selio/cloud fourni par le worker) est
 *   derrière TRACK_LIVE_ENABLED=false, avec les garde-fous de Radar : arrêt au premier signal de Vinted
 *   (pause de toutes les lectures en direct de Track, coupe-circuit de la machine après un blocage ou un
 *   « trop de requêtes »), fenêtre glissante partagée des 1 000 dernières lectures, ralentissement au-delà
 *   de 1 blocage pour 1 000 pages, aucun contournement, rien n'est retenté. L'usage des données issues de
 *   Vinted est à valider juridiquement.
 * - Une annonce disparue entre deux lectures (vendue OU retirée) devient une référence au prix final
 *   ESTIMÉ (dernier prix affiché), marquée comme telle. En direct, la page est jugée sur sa version ENTIÈRE
 *   (avant le filtre local des critères) : une annonce plus ancienne que la plus ancienne de la page n'est
 *   jamais comptée disparue, une lecture où des annonces sont illisibles n'en compte aucune.
 * - Catégorie : la carte d'une annonce ne la montre pas et l'adresse ne la filtre pas encore. En direct,
 *   une annonce sans catégorie lue ne devient PAS une référence (la catégorie du filtre n'est jamais
 *   recopiée) et l'instantané ne compte pour aucune catégorie (`categoriesVerified` faux).
 * - Références : clé calculée par la base avec un sel propre (`app_track_store_references`), dates au jour,
 *   nombre de photos par tranches ; base gardée 24 mois.
 * - Quotas du plan (PLAN_QUOTAS) : filtres suivis, scans de niche et recherches par photo par mois,
 *   historique ; 0 = Track indisponible (402, « Track est compris à partir de Pro »). Chaque contrôle de
 *   quota se fait sous un verrou de l'organisation, dans la transaction qui réserve la place (pas de
 *   dépassement par requêtes simultanées). Une empreinte retirée (filtre supprimé ou critères changés)
 *   garde sa place 2 h : au-delà du quota, la première lecture d'une nouvelle empreinte attend 2 h.
 */

// ---------------------------------------------------------------- lecteur (interface minimale)

/** Lecture d'une page publique du catalogue (critères de l'empreinte), sans session. */
export interface TrackReaderInput {
  fingerprint: string;
  criteria: TrackCriteria;
  /** Domaine Vinted lu (liste fermée) ; www.vinted.fr par défaut. */
  vintedHost: string;
  now: Date;
}

export type TrackReaderOutcome =
  | {
      ok: true;
      /** Annonces retenues (après le filtre local des critères). */
      items: readonly unknown[];
      /** Annonces lisibles sur la page ENTIÈRE, avant le filtre local (journal). */
      seenCount?: number;
      /** Publication la plus ancienne de la page entière (règle des disparitions), null si aucune n'est datée. */
      oldestPublishedAt?: string | null;
      durationMs?: number;
    }
  | {
      ok: false;
      code: RadarSignal | "not_logged_in" | "selector_missing" | "timeout" | "error" | "unavailable";
      message?: string;
      /** Faux : aucun navigateur lancé, rien n'a touché Vinted (rien n'est compté). */
      launched?: boolean;
      durationMs?: number;
    };

/**
 * Implémenté par le worker (`FakeTrackReader` dans les tests) : `RadarReader.readSearch({ session: null,
 * url: buildSearchUrl(…) })` de @selio/cloud, mêmes créneaux de navigateurs (`BrowserSlots`) que le Cloud et
 * Radar, plafond de pages par minute de la machine. Correspondance des résultats du lecteur : `ok` → `ok`
 * (annonces) ; `blocked` → le code du signal (`captcha`, `warning`, `blocked`, `rate_limited`) ;
 * `page_changed` → `selector_missing` ; `timeout`, `error` → tels quels ; `unavailable` → `unavailable` avec
 * `launched: false`. Aucune session, aucun cookie, aucune action sur la page.
 */
export interface TrackReader {
  read(input: TrackReaderInput): Promise<TrackReaderOutcome>;
}

type TrackResponder = TrackReaderOutcome | ((input: TrackReaderInput) => TrackReaderOutcome | Promise<TrackReaderOutcome>);

/** Lecteur factice : rejoue les résultats mis en file, sinon une page vide. Garde les appels. */
export class FakeTrackReader implements TrackReader {
  readonly calls: TrackReaderInput[] = [];
  private readonly queue: TrackResponder[] = [];
  enqueue(...outcomes: TrackResponder[]): this {
    this.queue.push(...outcomes);
    return this;
  }
  async read(input: TrackReaderInput): Promise<TrackReaderOutcome> {
    this.calls.push({ ...input, criteria: structuredClone(input.criteria) });
    const next = this.queue.shift();
    if (next) return typeof next === "function" ? next(input) : next;
    return { ok: true, items: [], durationMs: 700 };
  }
}

// ---------------------------------------------------------------- réglages serveur

const isTrue = (v: unknown): boolean => v === true || (typeof v === "string" && ["1", "true", "yes", "oui"].includes(v.trim().toLowerCase()));

/** Lit TRACK_LIVE_ENABLED et TRACK_SELLER_ANALYSIS_ENABLED (API et worker). Tout est fermé par défaut. */
export function trackConfigFromEnv(env: Record<string, string | undefined> = process.env): Pick<ServicesConfig, "trackLiveEnabled" | "trackSellerAnalysisEnabled"> {
  return { trackLiveEnabled: isTrue(env.TRACK_LIVE_ENABLED), trackSellerAnalysisEnabled: isTrue(env.TRACK_SELLER_ANALYSIS_ENABLED) };
}

export function trackLiveEnabled(services: Pick<Services, "config">): boolean {
  return services.config?.trackLiveEnabled === true;
}

// ---------------------------------------------------------------- empreinte des critères (pure)

const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** Apostrophes typographiques (’ ‘ ‛ ʼ ` ´) ramenées à l'apostrophe droite. */
const APOSTROPHES = /[\u2018\u2019\u201B\u02BC\u0060\u00B4]/g;
/**
 * Texte « plié » pour l'empreinte : accents retirés (NFD), apostrophes unifiées, espaces réduits,
 * minuscules — comme le filtre local du catalogue (`matchesCatalogCriteria`), qui traite déjà « Sézane » et
 * « Sezane », « Levi's » et « Levi’s » à l'identique.
 */
export const foldText = (s: string) => clean(s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(APOSTROPHES, "'")).toLowerCase();
const uniqSorted = (xs: readonly string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Critères normalisés : marques et mots-clés pliés (minuscules, sans accents, apostrophes unifiées), tailles
 * en majuscules, espaces réduits, listes dédoublonnées et triées. Deux filtres qui ne diffèrent que par la
 * casse, les accents, l'apostrophe, l'ordre ou des espaces ont la même empreinte.
 */
export function normalizeTrackCriteria(raw: unknown): TrackCriteria {
  const c = trackCriteria.parse(raw ?? {});
  return {
    brands: uniqSorted(c.brands.map(foldText)),
    categories: uniqSorted(c.categories) as TrackCriteria["categories"],
    sizes: uniqSorted(c.sizes.map((s) => clean(s).toUpperCase())),
    conditions: uniqSorted(c.conditions) as TrackCriteria["conditions"],
    maxPriceCents: c.maxPriceCents,
    keywords: uniqSorted(c.keywords.map(foldText)),
  };
}

/** Version du calcul de l'empreinte (2 : accents et apostrophes pliés). */
export const TRACK_FINGERPRINT_VERSION = 2;

/** Empreinte (SHA-256 hexadécimal) des critères normalisés, partagée entre organisations. */
export function fingerprintOf(criteria: unknown): string {
  const n = normalizeTrackCriteria(criteria);
  const canonical = JSON.stringify({ v: TRACK_FINGERPRINT_VERSION, brands: n.brands, categories: n.categories, conditions: n.conditions, keywords: n.keywords, maxPriceCents: n.maxPriceCents, sizes: n.sizes });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------- rythme (pur)

/** Prise d'une lecture : la prochaine est repoussée de 10 min le temps de la lecture (un seul passage à la fois). */
export const TRACK_LEASE_MINUTES = 10;
/** Aucun navigateur libre : nouvel essai au plus tôt 5 min plus tard (rien n'a été lu ni compté). */
export const TRACK_UNAVAILABLE_RETRY_MINUTES = 5;
/** Page lue au plus (même borne que l'adaptateur catalogue). */
export const TRACK_PAGE_SIZE = 96;

/** Intervalle de relecture par défaut (2 h), en minutes. */
export const TRACK_DEFAULT_READ_INTERVAL_MINUTES = TRACK_READ_INTERVAL_HOURS * 60;

/** Intervalle de relecture du serveur (TRACK_READ_INTERVAL_MINUTES, 60 min au moins ; 2 h par défaut). */
export function trackReadIntervalMinutes(services: Pick<Services, "config">): number {
  const v = services.config?.trackReadIntervalMinutes;
  return typeof v === "number" && Number.isFinite(v) && v >= 60 ? Math.round(v) : TRACK_DEFAULT_READ_INTERVAL_MINUTES;
}

/** Prochaine lecture : intervalle (2 h par défaut) × facteur, avec un écart déterministe de ± 10 min (empreinte et heure de lecture). */
export function nextTrackReadAt(fingerprint: string, readAt: Date, factor = 1, intervalMinutes = TRACK_DEFAULT_READ_INTERVAL_MINUTES): Date {
  const f = Math.max(1, Math.min(TRACK_MAX_SLOWDOWN_FACTOR, Math.round(factor)));
  const rnd = seededRandom(hashString(`${fingerprint}|${readAt.toISOString()}`));
  const jitter = Math.round((rnd() * 2 - 1) * TRACK_READ_JITTER_MINUTES * 60_000);
  return new Date(readAt.getTime() + intervalMinutes * 60_000 * f + jitter);
}

export interface PlannedTrackRead {
  fingerprint: string;
  nextReadAt: string;
  overdueMs: number;
}

/**
 * Lectures dues : une par empreinte (quelle que soit la quantité de filtres qui la partagent), quand la
 * prochaine lecture est échue ; les plus en retard d'abord.
 */
export function planTrackReads(entries: readonly { fingerprint: string; nextReadAt: string | Date }[], now: Date): PlannedTrackRead[] {
  const byFp = new Map<string, number>();
  for (const e of entries) {
    const t = new Date(e.nextReadAt).getTime();
    if (!Number.isFinite(t)) continue;
    byFp.set(e.fingerprint, Math.min(byFp.get(e.fingerprint) ?? Number.POSITIVE_INFINITY, t));
  }
  return [...byFp.entries()]
    .filter(([, t]) => t <= now.getTime())
    .map(([fingerprint, t]) => ({ fingerprint, nextReadAt: new Date(t).toISOString(), overdueMs: now.getTime() - t }))
    .sort((a, b) => b.overdueMs - a.overdueMs || a.fingerprint.localeCompare(b.fingerprint));
}

// ---------------------------------------------------------------- simulateur (déterministe)

const DEMO_EPOCH = Date.UTC(2026, 0, 1);
const DEMO_BRANDS = ["Levi's", "Nike", "Zara", "Ralph Lauren", "Sézane", "Carhartt", "Adidas", "Maje"];
const DEMO_PIECES: Record<ItemCategory, string> = { men: "veste", women: "robe", kids: "ensemble", shoes: "baskets", bags: "sac", accessories: "ceinture", home: "plaid", electronics: "écouteurs", other: "pièce" };

/**
 * Page de catalogue simulée pour une empreinte : une annonce nouvelle toutes les 25 à 75 min (selon
 * l'empreinte), chacune en ligne de 6 h à 14 jours, page des 96 plus récentes encore en ligne. Même
 * empreinte et même heure → même page. Aucune page de Vinted n'est lue ; les données sont de démonstration.
 */
export function simulateTrackPage(fingerprint: string, criteria: TrackCriteria, now: Date): RadarCatalogItemInput[] {
  const seed = hashString(fingerprint);
  const base = seededRandom(seed);
  const spacing = (25 + Math.floor(base() * 50)) * 60_000;
  const brands = criteria.brands.length ? criteria.brands : DEMO_BRANDS;
  const categories = criteria.categories.length ? criteria.categories : (["men", "women", "shoes"] as ItemCategory[]);
  const conditions = criteria.conditions.length ? criteria.conditions : (["new_without_tags", "very_good", "very_good", "good", "satisfactory"] as ItemCondition[]);
  const sizes = criteria.sizes.length ? criteria.sizes : ["S", "M", "L", "38", "40"];
  const maxPrice = Math.max(500, criteria.maxPriceCents || 5000);
  const prefix = String(10_000 + (seed % 89_999));
  const kNow = Math.floor((now.getTime() - DEMO_EPOCH) / spacing);
  const out: RadarCatalogItemInput[] = [];
  for (let k = kNow; k >= 0 && out.length < TRACK_PAGE_SIZE && kNow - k < 4000; k--) {
    const r = seededRandom(hashString(`${fingerprint}:${k}`));
    const publishedAt = DEMO_EPOCH + k * spacing + Math.floor(r() * spacing * 0.5);
    if (publishedAt > now.getTime()) continue;
    const lifetime = (6 + r() * r() * 330) * 3_600_000;
    if (publishedAt + lifetime <= now.getTime()) continue;
    const brand = brands[Math.floor(r() * brands.length)]!;
    const category = categories[Math.floor(r() * categories.length)]!;
    const condition = conditions[Math.floor(r() * conditions.length)]!;
    const size = sizes[Math.floor(r() * sizes.length)]!;
    const priceCents = Math.max(100, Math.round((maxPrice * (0.3 + r() * 0.7)) / 50) * 50);
    out.push({
      externalRef: `${prefix}${String(k).padStart(7, "0")}`, title: `${brand} ${criteria.keywords[0] ?? DEMO_PIECES[category]} ${size}`, priceCents, shippingCents: null, brand, size, condition, category,
      url: null, photoUrl: null, photoCount: 1 + Math.floor(r() * 8), sellerHandle: null, sellerRating: null, sellerReviews: null, publishedAt: new Date(publishedAt).toISOString(), publishedAtSource: "absolute",
    });
  }
  return out;
}

// ---------------------------------------------------------------- disparitions et instantanés (purs)

/**
 * Annonce active retenue d'une lecture à l'autre : empreinte salée, prix, catégorie LUE (null si la page ne
 * la donne pas), première vue, publication.
 */
export interface TrackListingState {
  k: string;
  p: number;
  c: ItemCategory | null;
  f: string;
  d: string | null;
}

function parseState(raw: unknown): TrackListingState[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackListingState[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    if (typeof e.k !== "string" || typeof e.p !== "number" || typeof e.f !== "string") continue;
    out.push({ k: e.k, p: e.p, c: typeof e.c === "string" && e.c in ITEM_CATEGORY_LABELS ? (e.c as ItemCategory) : null, f: e.f, d: typeof e.d === "string" ? e.d : null });
  }
  return out;
}

const atOf = (s: TrackListingState) => new Date(s.d ?? s.f).getTime();

/**
 * Annonces nouvelles et disparues entre deux lectures. Une page ne montre que les annonces les plus
 * récentes : une annonce absente n'est comptée « disparue » (vendue ou retirée, estimation) que si elle
 * aurait encore dû y figurer — page incomplète, ou annonce publiée après la plus ancienne de la page
 * (`oldestAt` : la page ENTIÈRE, avant le filtre local ; à défaut, les annonces retenues) ; sinon elle est
 * simplement sortie de la page (sort inconnu, oubliée sans être comptée). Page pleine et date de publication
 * inconnue : position inconnue, jamais comptée. `skipGone` (annonces illisibles sur la page) : aucune
 * disparition comptée.
 */
export function diffTrackState(
  prev: readonly TrackListingState[],
  current: readonly TrackListingState[],
  opts: { pageFull: boolean; firstRead: boolean; oldestAt?: number | null; skipGone?: boolean },
): { gone: TrackListingState[]; newCount: number } {
  const currentKeys = new Set(current.map((s) => s.k));
  const prevKeys = new Set(prev.map((s) => s.k));
  if (opts.firstRead) return { gone: [], newCount: 0 };
  const newCount = current.filter((s) => !prevKeys.has(s.k)).length;
  if (opts.skipGone) return { gone: [], newCount };
  const oldest = typeof opts.oldestAt === "number" && Number.isFinite(opts.oldestAt) ? opts.oldestAt : current.length ? Math.min(...current.map(atOf)) : Number.NEGATIVE_INFINITY;
  const gone = prev.filter((s) => !currentKeys.has(s.k) && (!opts.pageFull || (s.d !== null && new Date(s.d).getTime() >= oldest)));
  return { gone, newCount };
}

/** Parts des marques (10 au plus), sans pseudo. */
export function brandShares(items: readonly Pick<RadarCatalogItem, "brand">[]): TrackBrandShare[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const it of items) {
    const label = it.brand?.trim() || "Sans marque";
    const key = label.toLowerCase();
    const cur = counts.get(key) ?? { label, n: 0 };
    cur.n++;
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, TRACK_BRAND_SHARES_MAX).map((x) => ({ brand: x.label.slice(0, 80), count: x.n, share: items.length ? Math.round((x.n / items.length) * 1000) / 1000 : 0 }));
}

function medianOf(values: readonly number[]): number | null {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------------------------------------------------------------- lecture d'une empreinte

export type TrackSkipReason = "not_due" | "paused" | "machine_paused" | "no_reader";

export interface TrackReadResult {
  fingerprint: string;
  source: TrackSource;
  outcome: RadarReadOutcome | null;
  skipped: TrackSkipReason | null;
  listed: number;
  /** Annonces lisibles sur la page entière (avant le filtre local des critères). */
  seen: number;
  newCount: number;
  goneCount: number;
  /** Références écrites (annonces vues et disparues). */
  references: number;
  snapshotId: string | null;
  nextReadAt: string | null;
  factor: number;
  /** Signal de Vinted : toutes les lectures en direct de Track sont en pause. */
  paused: boolean;
  circuitUntil: string | null;
  message?: string;
}

const SIGNAL_OUTCOME: Record<RadarSignal, RadarReadOutcome> = { captcha: "captcha", rate_limited: "rate_limited", blocked: "blocked", warning: "blocked" };
const FAILURE_OUTCOME: Record<"not_logged_in" | "selector_missing" | "timeout" | "error" | "unavailable", RadarReadOutcome> = { not_logged_in: "error", selector_missing: "page_changed", timeout: "timeout", error: "error", unavailable: "error" };

const skip = (fingerprint: string, source: TrackSource, skipped: TrackSkipReason, message?: string): TrackReadResult => ({ fingerprint, source, outcome: null, skipped, listed: 0, seen: 0, newCount: 0, goneCount: 0, references: 0, snapshotId: null, nextReadAt: null, factor: 1, paused: false, circuitUntil: null, message });

/**
 * Lit UNE empreinte (une seule lecture quelle que soit la quantité de clients qui la suivent) et en tire
 * un instantané et des références. `source` : « demo » (simulateur) ou « cloud » (pages publiques, si
 * TRACK_LIVE_ENABLED et un lecteur sont disponibles ; sinon refus).
 */
export async function runTrackRead(services: Services, fingerprint: string, source: TrackSource, opts: { now?: Date } = {}): Promise<TrackReadResult> {
  const now = opts.now ?? services.now();
  const iso = now.toISOString();
  const reader = services.track?.reader;
  const interval = trackReadIntervalMinutes(services);
  let runtimeFactor = 1;
  let runtime: Awaited<ReturnType<typeof repos.trackReads.runtime>> | null = null;
  if (source === "cloud") {
    if (!trackLiveEnabled(services)) throw new AppError("track_live_disabled", "La lecture en direct de Track est désactivée (TRACK_LIVE_ENABLED) : le simulateur est utilisé.", 409);
    if (!reader) return skip(fingerprint, source, "no_reader", "La lecture en direct s'exécute dans le worker (lecteur de Selio Cloud).");
    runtime = await services.db.withGlobal((tx) => repos.trackReads.runtime(tx));
    if (runtime.pausedUntil && new Date(runtime.pausedUntil).getTime() > now.getTime()) return skip(fingerprint, source, "paused", `Track est en pause jusqu'à ${runtime.pausedUntil} après un signal de Vinted.`);
    const machine = await cloud.machinePausedUntil(services, now);
    if (machine) return skip(fingerprint, source, "machine_paused", "Selio Cloud est suspendu sur la machine après un signal de Vinted.");
    runtimeFactor = Math.min(TRACK_MAX_SLOWDOWN_FACTOR, effectiveSlowdownFactor({ slowdownFactor: runtime.slowdownFactor, lastBlockAt: runtime.lastBlockAt }, now));
  }
  const claimed: TrackClaimedRead | null = await services.db.withGlobal((tx) => repos.trackReads.claim(tx, fingerprint, iso, new Date(now.getTime() + TRACK_LEASE_MINUTES * 60_000).toISOString()));
  if (!claimed) return skip(fingerprint, source, "not_due");
  const criteria = trackCriteria.safeParse(claimed.criteria);
  const finish = (input: { outcome: RadarReadOutcome; counted: boolean; blocked: boolean; anomaly: boolean; factor: number; next: Date; state: TrackListingState[] | null }) =>
    services.db.withGlobal((tx) => repos.trackReads.finish(tx, { fingerprint, readAt: iso, nextReadAt: input.next.toISOString(), outcome: input.outcome, counted: input.counted, blocked: input.blocked, anomaly: input.anomaly, factor: input.factor, state: input.state, stateSource: input.state ? source : null }));
  if (!criteria.success) {
    const next = nextTrackReadAt(fingerprint, now, claimed.factor, interval);
    await finish({ outcome: "error", counted: false, blocked: false, anomaly: false, factor: claimed.factor, next, state: null });
    return { ...skip(fingerprint, source, "not_due"), skipped: null, outcome: "error", nextReadAt: next.toISOString(), message: "Critères illisibles." };
  }

  // 1. Lecture : simulateur, ou page publique du catalogue (aucune session, aucune action sur la page).
  let items: RadarCatalogItem[] = [];
  let invalid = 0;
  /** Page entière (avant le filtre local) : nombre d'annonces lisibles et publication la plus ancienne. */
  let page: { seen: number; oldestAt: number | null } = { seen: 0, oldestAt: null };
  let failure: { code: keyof typeof FAILURE_OUTCOME | RadarSignal; launched: boolean; message?: string } | null = null;
  if (source === "demo") {
    const v = validateCatalogItems(simulateTrackPage(fingerprint, criteria.data, now));
    items = v.items;
    invalid = v.invalid;
    page = { seen: items.length, oldestAt: null };
  } else {
    let out: TrackReaderOutcome;
    try {
      out = await reader!.read({ fingerprint, criteria: criteria.data, vintedHost: "www.vinted.fr", now });
    } catch (err) {
      out = { ok: false, code: "error", message: err instanceof Error ? err.name : "Error" };
    }
    if (out.ok) {
      const v = validateCatalogItems(Array.isArray(out.items) ? out.items : []);
      items = v.items;
      invalid = v.invalid;
      const oldest = typeof out.oldestPublishedAt === "string" ? new Date(out.oldestPublishedAt).getTime() : NaN;
      page = { seen: typeof out.seenCount === "number" && out.seenCount >= 0 ? out.seenCount : items.length, oldestAt: Number.isFinite(oldest) ? oldest : null };
    } else {
      const code = ([...RADAR_SIGNALS, ...Object.keys(FAILURE_OUTCOME)] as string[]).includes(out.code) ? out.code : "error";
      failure = { code, launched: (RADAR_SIGNALS as readonly string[]).includes(code) || out.launched !== false, message: typeof out.message === "string" ? out.message.slice(0, 200) : undefined };
    }
  }

  // 2. Signal de Vinted : pause de Track écrite d'abord (fenêtre partagée, ralentissement), puis coupe-circuit.
  if (failure && (RADAR_SIGNALS as readonly string[]).includes(failure.code)) {
    const signal = failure.code as RadarSignal;
    const pauseUntil = new Date(now.getTime() + TRACK_SIGNAL_PAUSE_MINUTES * 60_000);
    const factor = Math.min(TRACK_MAX_SLOWDOWN_FACTOR, slowdownAfterRead(runtimeFactor, true, { reads: (runtime?.windowReads ?? 0) + 1, blocks: (runtime?.windowBlocks ?? 0) + 1 }));
    await services.db.withGlobal((tx) => repos.trackReads.recordRuntime(tx, { blocked: true, factor, blockAt: iso, pauseUntil: pauseUntil.toISOString(), pauseReason: signal }));
    const circuitUntil = signal === "rate_limited" || signal === "blocked" ? await cloud.tripCircuit(services, signal, now) : null;
    const next = new Date(Math.max(pauseUntil.getTime(), nextTrackReadAt(fingerprint, now, factor, interval).getTime()));
    await finish({ outcome: SIGNAL_OUTCOME[signal], counted: true, blocked: true, anomaly: false, factor, next, state: null });
    return { ...skip(fingerprint, source, "not_due"), skipped: null, outcome: SIGNAL_OUTCOME[signal], nextReadAt: next.toISOString(), factor, paused: true, circuitUntil, message: `Signal de Vinted (${signal}) : lecture arrêtée, Track en pause ${TRACK_SIGNAL_PAUSE_MINUTES} min, rien n'est retenté.` };
  }

  // 3. Aucun navigateur lancé : rien n'est lu ni compté, nouvel essai un peu plus tard.
  if (failure && !failure.launched) {
    const next = new Date(now.getTime() + TRACK_UNAVAILABLE_RETRY_MINUTES * 60_000);
    await finish({ outcome: "error", counted: false, blocked: false, anomaly: false, factor: claimed.factor, next, state: null });
    return { ...skip(fingerprint, source, "not_due"), skipped: null, outcome: null, nextReadAt: next.toISOString(), factor: claimed.factor, message: failure.message ?? "Aucun navigateur libre : lecture au prochain passage." };
  }

  // Page reçue sans blocage : mesurée dans la fenêtre partagée ; le facteur stocké et la date du dernier
  // blocage restent tels quels (le facteur redescend d'un cran par 24 h depuis ce blocage, calculé à la lecture).
  if (source === "cloud") await services.db.withGlobal((tx) => repos.trackReads.recordRuntime(tx, { blocked: false, factor: null, blockAt: null, pauseUntil: null, pauseReason: null }));

  // 4. Lecture anormale (page non reconnue, erreur, délai) : comptée ; l'empreinte ralentit après 3 de suite.
  if (failure) {
    const failures = claimed.consecutiveFailures + 1;
    const fpFactor = failures >= TRACK_MAX_CONSECUTIVE_ANOMALIES ? Math.min(TRACK_MAX_SLOWDOWN_FACTOR, Math.max(1, claimed.factor) * 2) : Math.max(1, claimed.factor);
    const factor = Math.max(runtimeFactor, fpFactor);
    const next = nextTrackReadAt(fingerprint, now, factor, interval);
    await finish({ outcome: FAILURE_OUTCOME[failure.code as keyof typeof FAILURE_OUTCOME] ?? "error", counted: true, blocked: false, anomaly: true, factor: fpFactor, next, state: null });
    return { ...skip(fingerprint, source, "not_due"), skipped: null, outcome: FAILURE_OUTCOME[failure.code as keyof typeof FAILURE_OUTCOME] ?? "error", nextReadAt: next.toISOString(), factor, message: failure.message };
  }

  // 5. Annonces : empreintes salées (le sel reste dans la base), disparitions, instantané, références.
  const firstRead = claimed.stateSource !== source;
  const prev = firstRead ? [] : parseState(claimed.state);
  const prevByKey = new Map(prev.map((s) => [s.k, s]));
  // Catégorie : celle LUE sur l'annonce. Le simulateur la tire des critères (il les applique) ; en direct, la
  // carte ne la montre pas : jamais la catégorie du filtre recopiée sur une annonce qui peut être d'une autre.
  const categoryOf = (item: RadarCatalogItem): ItemCategory | null => item.category ?? null;
  // Page pleine : simulateur, 96 annonces ; en direct, la taille réelle d'une page n'est pas relevée sur
  // Vinted, elle est donc TOUJOURS traitée comme pleine (une annonce plus ancienne que la plus ancienne de la
  // page entière n'est jamais comptée disparue : sous-estimation assumée plutôt que des ventes inventées).
  const pageFull = source === "cloud" ? true : page.seen >= TRACK_PAGE_SIZE;
  const factor = runtimeFactor;
  const next = nextTrackReadAt(fingerprint, now, factor, interval);
  const saved = await services.db.withGlobal(async (tx) => {
    const keys = await repos.trackReads.refKeys(tx, items.map((i) => i.externalRef).filter((r): r is string => !!r));
    const keyed = items.filter((i) => i.externalRef && keys.has(i.externalRef)).map((i) => ({ item: i, key: keys.get(i.externalRef!)! }));
    const current: TrackListingState[] = keyed.map(({ item, key }) => ({ k: key, p: item.priceCents, c: categoryOf(item), f: prevByKey.get(key)?.f ?? iso, d: item.publishedAt ?? prevByKey.get(key)?.d ?? null }));
    // Annonces illisibles sur la page (ou sans référence) : l'une d'elles peut être une annonce « manquante ».
    const unreadable = invalid + (items.length - keyed.length);
    const diff = diffTrackState(prev, current, { pageFull, firstRead, oldestAt: page.oldestAt, skipGone: unreadable > 0 });
    const prices = items.map((i) => i.priceCents);
    const daysListed = diff.gone.map((s) => Math.max(0, (now.getTime() - atOf(s)) / 86_400_000));
    const median = medianOf(daysListed);
    const snapshot = await repos.trackSnapshots.add(tx, {
      fingerprint, source, readAt: iso, listedCount: items.length,
      medianPriceCents: quantileCents(prices, 0.5), p25Cents: quantileCents(prices, 0.25), p75Cents: quantileCents(prices, 0.75),
      newCount: diff.newCount, goneCount: diff.gone.length, medianDaysListed: median === null ? null : Math.round(median * 10) / 10,
      brandShares: brandShares(items),
      // Catégories des critères appliquées par le simulateur ; en direct, ni filtrées ni lues : non vérifiées.
      scope: { categories: criteria.data.categories, brands: criteria.data.brands, categoriesVerified: source === "demo" || criteria.data.categories.length === 0 },
    });
    // Références sans donnée personnelle : ni titre, ni pseudo, ni photo, ni identifiant d'annonce ; clé
    // calculée par la base (autre sel), dates au jour, photos par tranches. Sans catégorie lue : aucune.
    const refSource = source === "cloud" ? "track" : "demo";
    const rows: repos.TrackReferenceRow[] = [
      ...keyed.flatMap(({ item, key }, i) => {
        const c = current[i]!.c;
        return c ? [{ key, status: "listed" as const, brand: item.brand?.trim() || null, category: c, size: item.size?.trim() || null, condition: item.condition, listedPriceCents: item.priceCents, finalPriceCents: null, finalPriceEstimated: false, listedAt: current[i]!.d ?? current[i]!.f, soldAt: null, photoCount: item.photoCount }] : [];
      }),
      // Disparue entre deux lectures : vendue OU retirée ; prix final = dernier prix affiché (estimation).
      ...diff.gone.flatMap((g) => (g.c ? [{ key: g.k, status: "gone" as const, category: g.c, listedPriceCents: g.p, finalPriceCents: g.p, finalPriceEstimated: true, listedAt: g.d ?? g.f, soldAt: iso }] : [])),
    ];
    const written = await repos.trackReads.storeReferences(tx, refSource, rows);
    await repos.trackReads.finish(tx, { fingerprint, readAt: iso, nextReadAt: next.toISOString(), outcome: "ok", counted: true, blocked: false, anomaly: false, factor: 1, state: current, stateSource: source });
    return { snapshotId: snapshot?.id ?? null, newCount: diff.newCount, goneCount: diff.gone.length, references: written };
  });
  return { fingerprint, source, outcome: "ok", skipped: null, listed: items.length, seen: page.seen, newCount: saved.newCount, goneCount: saved.goneCount, references: saved.references, snapshotId: saved.snapshotId, nextReadAt: next.toISOString(), factor, paused: false, circuitUntil: null };
}

export interface TrackTickSummary {
  due: number;
  read: number;
  source: TrackSource;
  skipped: { reason: TrackSkipReason; count: number }[];
  results: TrackReadResult[];
}

/**
 * Passage du worker : lit les empreintes dues (une lecture par empreinte, toutes organisations confondues).
 * Source : pages publiques si TRACK_LIVE_ENABLED et un lecteur sont là, sinon le simulateur. Un signal de
 * Vinted arrête le passage (aucune autre page lue).
 */
export async function runDueTrackReads(services: Services, opts: { now?: Date; limit?: number; shouldStop?: () => boolean } = {}): Promise<TrackTickSummary> {
  const now = opts.now ?? services.now();
  const source: TrackSource = trackLiveEnabled(services) && services.track?.reader ? "cloud" : "demo";
  const due = await services.db.withGlobal((tx) => repos.trackReads.due(tx, now.toISOString(), opts.limit ?? 50));
  const planned = planTrackReads(due, now);
  const results: TrackReadResult[] = [];
  const skipped = new Map<TrackSkipReason, number>();
  for (const p of planned) {
    if (opts.shouldStop?.()) break;
    const res = await runTrackRead(services, p.fingerprint, source, { now: opts.now ?? services.now() });
    results.push(res);
    if (res.skipped) skipped.set(res.skipped, (skipped.get(res.skipped) ?? 0) + 1);
    if (res.paused || res.skipped === "paused" || res.skipped === "machine_paused") break;
  }
  return { due: planned.length, read: results.filter((r) => r.outcome !== null).length, source, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })), results };
}

// ---------------------------------------------------------------- filtres suivis

function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function quotasTx(tx: Tx): Promise<PlanQuotas> {
  return (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
}

function unavailable(): AppError {
  return new AppError("track_unavailable", TRACK_UNAVAILABLE_MESSAGE, 402);
}

function withState(f: TrackFilter, state: Map<string, TrackReadState>): TrackFilter {
  const s = state.get(f.fingerprint);
  return { ...f, lastReadAt: s?.lastReadAt ?? null, nextReadAt: s?.nextReadAt ?? null };
}

export function listFilters(ctx: OrgContext): Promise<TrackFilter[]> {
  requireAction(ctx, "analytics.read");
  return withOrg(ctx, async (tx) => {
    const filters = await repos.trackFilters.list(tx);
    const state = await repos.trackReads.state(tx, filters.map((f) => f.fingerprint));
    return filters.map((f) => withState(f, state));
  });
}

/**
 * Première lecture d'une empreinte que l'organisation vient d'introduire (création, ou critères changés) :
 * tout de suite tant que ses filtres et les empreintes qu'elle a retirées depuis moins de 2 h (un filtre
 * supprimé, ou des critères changés, gardent leur place pendant l'intervalle) tiennent dans son quota ;
 * au-delà, dans 2 h — changer de critères en boucle ne lit pas plus de pages que le quota n'en permet.
 */
async function firstReadOf(tx: Tx, ctx: OrgContext, quota: number): Promise<{ at: string; deferred: boolean }> {
  const now = ctx.services.now();
  const interval = trackReadIntervalMinutes(ctx.services);
  const retired = await repos.usage.sumKindSince(tx, "track.filter_change", new Date(now.getTime() - interval * 60_000).toISOString());
  const held = await repos.trackFilters.count(tx);
  const deferred = held + retired > quota;
  return { at: deferred ? new Date(now.getTime() + interval * 60_000).toISOString() : now.toISOString(), deferred };
}

/** Verrou des filtres de l'organisation : quotas contrôlés et écrits dans la même transaction, un appel à la fois. */
const lockFilters = (tx: Tx) => repos.usage.lock(tx, "track.filters");

export function createFilter(ctx: OrgContext, raw: unknown): Promise<TrackFilter> {
  requireAction(ctx, "radar.write");
  const parsed = trackFilterCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Filtre invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    await lockFilters(tx);
    const quota = (await quotasTx(tx)).trackFiltersFollowed;
    if (quota <= 0) throw unavailable();
    if ((await repos.trackFilters.count(tx)) >= quota) throw new AppError("quota_exceeded", `Quota de filtres suivis atteint (${quota}) : retirez un filtre pour en suivre un autre.`, 402);
    const fingerprint = fingerprintOf(parsed.data.criteria);
    if (await repos.trackFilters.byFingerprint(tx, fingerprint)) throw new AppError("conflict", "Un filtre avec les mêmes critères est déjà suivi.", 409);
    const created = await repos.trackFilters.create(tx, { name: parsed.data.name, criteria: parsed.data.criteria, fingerprint, enabled: parsed.data.enabled });
    // Ligne partagée de l'empreinte : créée si aucun autre client ne la suit (lue au prochain passage, ou dans 2 h).
    const first = await firstReadOf(tx, ctx, quota);
    await repos.trackReads.follow(tx, fingerprint, normalizeTrackCriteria(parsed.data.criteria), first.at, first.deferred);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "track.filter_created", targetType: "track_filter", targetId: created.id, meta: { deferred: first.deferred }, ip: ctx.ip });
    return withState(created, await repos.trackReads.state(tx, [fingerprint]));
  });
}

/**
 * Modifie un filtre : nom, critères (nouvelle empreinte : l'ancienne garde sa place 2 h), activation
 * (réactiver un filtre ne dépasse jamais le quota de filtres actifs : contrôle dans la même transaction).
 */
export function updateFilter(ctx: OrgContext, id: string, raw: unknown): Promise<TrackFilter> {
  requireAction(ctx, "radar.write");
  const parsed = trackFilterUpdate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Filtre invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    await lockFilters(tx);
    const existing = await repos.trackFilters.byId(tx, id).catch(() => null);
    if (!existing) throw new AppError("not_found", "Filtre Track introuvable.", 404);
    const quota = (await quotasTx(tx)).trackFiltersFollowed;
    const patch: { name?: string; criteria?: TrackCriteria; fingerprint?: string; enabled?: boolean } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if ((parsed.data.enabled === true || parsed.data.criteria !== undefined) && quota <= 0) throw unavailable();
    // Actif après la mise à jour : jamais plus de filtres actifs que le quota (offre réduite, filtres coupés).
    if (parsed.data.enabled === true && (await repos.trackFilters.countEnabled(tx, id)) >= quota) {
      throw new AppError("quota_exceeded", `Quota de filtres suivis atteint (${quota}) : coupez un filtre pour en réactiver un autre.`, 402);
    }
    let changed = false;
    if (parsed.data.criteria !== undefined) {
      patch.criteria = parsed.data.criteria;
      patch.fingerprint = fingerprintOf(parsed.data.criteria);
      changed = patch.fingerprint !== existing.fingerprint;
      const clash = changed ? await repos.trackFilters.byFingerprint(tx, patch.fingerprint) : null;
      if (clash) throw new AppError("conflict", "Un filtre avec les mêmes critères est déjà suivi.", 409);
    }
    const updated = await repos.trackFilters.update(tx, id, patch);
    if (changed) {
      // L'ancienne empreinte garde sa place 2 h (compteur jamais facturé) ; la nouvelle est lue dans le quota.
      await repos.usage.record(tx, "track.filter_change", { reason: "criteria_changed" }, 1, nowIso(ctx));
      const first = await firstReadOf(tx, ctx, quota);
      await repos.trackReads.follow(tx, updated.fingerprint, normalizeTrackCriteria(updated.criteria), first.at, first.deferred);
    } else {
      await repos.trackReads.follow(tx, updated.fingerprint, normalizeTrackCriteria(updated.criteria), nowIso(ctx));
    }
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "track.filter_updated", targetType: "track_filter", targetId: id, meta: { fields: Object.keys(patch) }, ip: ctx.ip });
    return withState(updated, await repos.trackReads.state(tx, [updated.fingerprint]));
  });
}

export function deleteFilter(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "radar.write");
  return withOrg(ctx, async (tx) => {
    await lockFilters(tx);
    if (!(await repos.trackFilters.delete(tx, id))) throw new AppError("not_found", "Filtre Track introuvable.", 404);
    // L'empreinte retirée garde sa place 2 h (voir `firstReadOf`).
    await repos.usage.record(tx, "track.filter_change", { reason: "deleted" }, 1, nowIso(ctx));
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "track.filter_deleted", targetType: "track_filter", targetId: id, ip: ctx.ip });
  });
}

// ---------------------------------------------------------------- tendances

/**
 * Tendances d'un filtre sur 7, 30 (par défaut) ou 90 jours, bornées à l'historique du plan, depuis les
 * instantanés de son empreinte : un point par jour (UTC), annonces en ligne, prix médian, nouvelles et
 * disparues (estimation).
 */
export async function trends(ctx: OrgContext, filterId: string, raw: { days?: unknown } = {}): Promise<TrackTrends> {
  requireAction(ctx, "analytics.read");
  const asked = Number(raw.days ?? TRACK_TRENDS_DEFAULT_DAYS);
  const wanted = (TRACK_TRENDS_DAYS as readonly number[]).includes(asked) ? asked : TRACK_TRENDS_DEFAULT_DAYS;
  return withOrg(ctx, async (tx) => {
    const quotas = await quotasTx(tx);
    if (quotas.trackHistoryMonths <= 0) throw unavailable();
    const filter = await repos.trackFilters.byId(tx, filterId).catch(() => null);
    if (!filter) throw new AppError("not_found", "Filtre Track introuvable.", 404);
    const days = Math.min(wanted, quotas.trackHistoryMonths * 30);
    const now = ctx.services.now();
    const snaps = await repos.trackSnapshots.since(tx, filter.fingerprint, new Date(now.getTime() - days * 86_400_000).toISOString());
    const byDay = new Map<string, TrackSnapshot[]>();
    for (const s of snaps) byDay.set(s.readAt.slice(0, 10), [...(byDay.get(s.readAt.slice(0, 10)) ?? []), s]);
    const points: TrackTrendPoint[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({
      day,
      listedCount: list[list.length - 1]!.listedCount,
      medianPriceCents: (() => { const m = medianOf(list.map((s) => s.medianPriceCents).filter((v): v is number => v !== null)); return m === null ? null : Math.round(m); })(),
      newCount: list.reduce((n, s) => n + s.newCount, 0),
      goneCount: list.reduce((n, s) => n + s.goneCount, 0),
    }));
    const priced = points.filter((p) => p.medianPriceCents !== null);
    const first = priced[0]?.medianPriceCents ?? null;
    const last = priced[priced.length - 1]?.medianPriceCents ?? null;
    const latest = snaps[snaps.length - 1] ?? null;
    const demo = snaps.some((s) => s.source === "demo");
    return {
      filterId, fingerprint: filter.fingerprint, days, points, snapshots: snaps.length,
      medianPriceChange: priced.length >= 2 && first ? Math.round(((last! - first) / first) * 1000) / 1000 : null,
      goneTotal: points.reduce((n, p) => n + p.goneCount, 0),
      source: latest?.source ?? null, demo,
      notices: [TRACK_LEGAL_NOTICE, TRACK_GONE_NOTICE, ...(demo ? [TRACK_DEMO_NOTICE] : [])],
    };
  });
}

// ---------------------------------------------------------------- scans de niche

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Composantes d'un scan (0 à 100 chacune) — combinaison documentée (poids TRACK_SCAN_WEIGHTS) :
 * - demande : part des références vendues ou disparues parmi celles de la niche (vendues + en ligne) ;
 * - vitesse : 100 pour une vente le jour même, 0 à partir de 30 jours de délai médian (50 si inconnu) ;
 * - concurrence : 100 / (1 + annonces actives / 50) — moins il y a d'annonces actives, plus c'est haut ;
 * - marge : (P50 de revente − prix d'achat médian observé) / P50 de revente, 100 à partir de 50 %.
 */
export function scanComponents(input: { sold: number; active: number; activeListings: number; medianDaysToSell: number | null; medianResaleCents: number | null; medianBuyCents: number | null }): { components: TrackScanComponents; score: number } {
  const demand = input.sold + input.active > 0 ? clamp100((100 * input.sold) / (input.sold + input.active)) : 0;
  const speed = input.medianDaysToSell === null ? 50 : clamp100(100 * (1 - input.medianDaysToSell / 30));
  const competition = clamp100(100 / (1 + input.activeListings / 50));
  const resale = input.medianResaleCents;
  const margin = resale && resale > 0 && input.medianBuyCents !== null ? clamp100(((resale - input.medianBuyCents) / resale / 0.5) * 100) : 0;
  const components = { demand, speed, competition, margin };
  const score = clamp100((Object.keys(TRACK_SCAN_WEIGHTS) as (keyof TrackScanComponents)[]).reduce((s, k) => s + TRACK_SCAN_WEIGHTS[k] * components[k], 0));
  return { components, score };
}

/**
 * Scan de niche (marque × catégorie) : note de 0 à 100 à partir des références (90 derniers jours) et des
 * derniers instantanés Track limités à la catégorie. Sous TRACK_SCAN_MIN_REFERENCES références ou
 * TRACK_SCAN_MIN_SOLD ventes : « données insuffisantes », aucune note, AUCUN chiffre de prix ni de délai
 * (seulement les volumes), rien n'est décompté du quota — mais TRACK_SCAN_INSUFFICIENT_PER_DAY par jour au
 * plus. Contrôle et décompte du quota dans la même transaction, sous un verrou de l'organisation.
 */
export async function nicheScan(ctx: OrgContext, raw: unknown): Promise<TrackScan> {
  requireAction(ctx, "radar.write");
  const parsed = trackScanInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Niche invalide", 400, parsed.error.flatten());
  const { brand, category } = parsed.data;
  const now = ctx.services.now();
  return withOrg(ctx, async (tx) => {
    await repos.usage.lock(tx, "track.scan");
    const quota = (await quotasTx(tx)).trackScansPerMonth;
    if (quota <= 0) throw unavailable();
    if ((await repos.usage.sumKindSince(tx, "track.scan", monthStartIso(now))) >= quota) throw new AppError("quota_exceeded", `Quota de scans de niche du mois atteint (${quota}).`, 402);
    const since = new Date(now.getTime() - TRACK_SCAN_WINDOW_DAYS * 86_400_000).toISOString();
    // Données réelles d'abord ; le simulateur seulement à défaut, et alors annoncé comme démonstration.
    let stats = await repos.priceReferences.nicheStats(tx, { category, brand, since, includeDemo: false });
    let demo = false;
    if (stats.total < TRACK_SCAN_MIN_REFERENCES) {
      const withDemo = await repos.priceReferences.nicheStats(tx, { category, brand, since, includeDemo: true });
      if (withDemo.total > stats.total) { stats = withDemo; demo = true; }
    }
    const snaps = (await repos.trackSnapshots.latestForCategory(tx, category, new Date(now.getTime() - 7 * 86_400_000).toISOString())).filter((s) => demo || s.source !== "demo");
    const used = snaps.map((s) => ({ s, n: brand ? s.brandShares.find((b) => foldText(b.brand) === foldText(brand))?.count ?? 0 : s.listedCount })).filter((x) => x.n > 0);
    const activeListings = used.length ? used.reduce((n, x) => n + x.n, 0) : stats.active;
    if (used.some((x) => x.s.source === "demo")) demo = true;
    const basedOn = { references: stats.total, snapshots: used.length, sold: stats.sold, demo };
    if (stats.total < TRACK_SCAN_MIN_REFERENCES || stats.sold < TRACK_SCAN_MIN_SOLD) {
      // Gratuit, mais borné : au-delà de TRACK_SCAN_INSUFFICIENT_PER_DAY par jour, refus jusqu'au lendemain.
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      if ((await repos.trackScans.countSince(tx, "insufficient_data", dayStart)) >= TRACK_SCAN_INSUFFICIENT_PER_DAY) {
        throw new AppError("rate_limited", `Trop de scans sans résultat aujourd'hui (${TRACK_SCAN_INSUFFICIENT_PER_DAY}) : réessayez demain, ou choisissez une niche plus large.`, 429);
      }
      // Aucun prix, aucun délai : une médiane sur une ou deux ventes serait le prix exact d'une vente.
      const volumes = { medianDaysToSell: null, activeListings, medianResaleCents: null, medianBuyCents: null };
      return repos.trackScans.create(tx, { brand, category, status: "insufficient_data", score: null, components: null, basedOn, details: volumes, message: TRACK_INSUFFICIENT_DATA, createdAt: now.toISOString() });
    }
    const own = (await repos.items.all(tx)).filter((i) => i.category === category && (!brand || foldText(i.brand ?? "") === foldText(brand)) && i.purchasePriceCents > 0).map((i) => i.purchasePriceCents);
    // Prix d'achat médian observé : vos propres achats de la niche, sinon le quart le moins cher des annonces.
    const medianBuyCents = own.length ? quantileCents(own, 0.5) : stats.p25ListedCents;
    const details = { medianDaysToSell: stats.medianDaysToSell === null ? null : Math.round(stats.medianDaysToSell * 10) / 10, activeListings, medianResaleCents: stats.medianFinalCents, medianBuyCents };
    const { components, score } = scanComponents({ sold: stats.sold, active: stats.active, activeListings, medianDaysToSell: stats.medianDaysToSell, medianResaleCents: stats.medianFinalCents, medianBuyCents });
    const scan = await repos.trackScans.create(tx, { brand, category, status: "ok", score, components, basedOn, details, message: demo ? TRACK_DEMO_NOTICE : null, createdAt: now.toISOString() });
    await repos.usage.record(tx, "track.scan", { scanId: scan.id, demo });
    return scan;
  });
}

export function listScans(ctx: OrgContext): Promise<TrackScan[]> {
  requireAction(ctx, "analytics.read");
  return withOrg(ctx, (tx) => repos.trackScans.list(tx));
}

// ---------------------------------------------------------------- recherche par photo

/**
 * Recherche par photo : le modèle 1 (vision) décrit l'article (marque, catégorie, matière, couleur, état,
 * sans prix), puis l'estimation donne la fourchette et les trois stratégies. LA PHOTO N'EST PAS
 * CONSERVÉE : seules la description et l'estimation sont enregistrées.
 *
 * - Sans modèle de vision (le modèle de texte ne voit pas la photo) : refus 503, rien n'est « décrit ».
 * - Quota : la place est RÉSERVÉE (événement `track.photo_search`) dans la transaction du contrôle, sous un
 *   verrou de l'organisation, avant l'appel au modèle ; elle est rendue si la lecture ou l'estimation échoue.
 */
export async function photoSearch(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<TrackPhotoSearch> {
  requireAction(ctx, "ai.use");
  const parsed = trackPhotoSearchInput.safeParse(raw);
  // Le message d'erreur ne reprend jamais la photo.
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Photo invalide", 400);
  const image = parsed.data.photo.slice(parsed.data.photo.indexOf(",") + 1);
  const hints = parsed.data.hints;
  const now = ctx.services.now();
  const reserved = await withOrg(ctx, async (tx) => {
    await repos.usage.lock(tx, "track.photo_search");
    const quota = (await quotasTx(tx)).trackPhotoSearchesPerMonth;
    if (quota <= 0) throw unavailable();
    if (!providerCanSeeImages(ctx.services.ai.provider)) throw new AppError("ai_vision_unavailable", TRACK_PHOTO_UNAVAILABLE, 503);
    if ((await repos.usage.sumKindSince(tx, "track.photo_search", monthStartIso(now))) >= quota) throw new AppError("quota_exceeded", `Quota de recherches par photo du mois atteint (${quota}).`, 402);
    const ai = await aiQuotaLeftTx(tx, ctx.services, ctx.orgId);
    if (!ai.enabled) throw new AppError("ai_unavailable", "L'assistant IA est désactivé dans les paramètres.", 409);
    if (!ai.left) throw new AppError("quota_exceeded", `Quota IA mensuel atteint (${ai.quota}).`, 402);
    // Lecture d'une photo par le modèle 1, décomptée comme le générateur d'annonces.
    const req = await repos.aiRequests.create(tx, { kind: "listing_generation", provider: ctx.services.ai.provider.name, model: ctx.services.ai.provider.model, status: "running" });
    // Place réservée tout de suite : une requête simultanée la voit et ne dépasse pas le quota.
    const usageId = await repos.usage.record(tx, "track.photo_search", { requestId: req.id });
    return { req, usageId };
  });
  const req = reserved.req;
  const refund = () => withOrg(ctx, (tx) => repos.usage.remove(tx, reserved.usageId)).catch(() => false);
  const started = Date.now();
  let res;
  try {
    res = await runStructuredAi(ctx.services, buildPhotoDescriptionRequest({ images: [image], hints }), signal);
    const v = validatePhotoDescription(res.data);
    if (!v.ok) throw new AIError("invalid_output", v.reason, false);
    res = { ...res, data: v.description };
  } catch (err) {
    const e = toAIError(err);
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: e.code === "timeout" ? "timeout" : e.code === "cancelled" ? "cancelled" : e.code === "invalid_output" ? "rejected" : "failed", error: e.message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) })).catch(() => undefined);
    await refund();
    if (e.code === "quota_exceeded") throw new AppError("quota_exceeded", e.message, 402);
    if (e.code === "invalid_output") throw new AppError("ai_invalid_output", "La description de la photo a été écartée : réessayez avec une autre photo.", 422);
    throw new AppError("ai_unavailable", `Recherche par photo indisponible (${e.code}). Réessayez plus tard.`, 503);
  }
  const ai = res;
  // La lecture de la photo est terminée : la requête IA est close avant l'estimation (jamais laissée « running »).
  await withOrg(ctx, async (tx) => {
    await repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, promptTokens: ai.usage.promptTokens, outputTokens: ai.usage.outputTokens, latencyMs: Math.max(ai.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
    await repos.usage.record(tx, "ai.request", { requestId: req.id, kind: "photo_description" });
  });
  const description = ai.data;
  try {
    const est = await estimate(ctx, { title: description.title, brand: description.brand, category: description.category, subcategory: description.subcategory, material: description.material, color: description.color, condition: description.condition, explain: true }, { signal });
    return await withOrg(ctx, (tx) => repos.trackPhotoSearches.create(tx, { description, estimate: est, simulated: ai.provider === "mock", createdAt: now.toISOString() }));
  } catch (err) {
    await refund();
    if (err instanceof AppError && err.status === 402) throw err;
    throw new AppError("pricing_unavailable", "La photo a été lue, mais l'estimation du prix a échoué : cette recherche n'est pas décomptée, réessayez.", 503);
  }
}

export function listPhotoSearches(ctx: OrgContext): Promise<TrackPhotoSearch[]> {
  requireAction(ctx, "analytics.read");
  return withOrg(ctx, (tx) => repos.trackPhotoSearches.list(tx));
}

// ---------------------------------------------------------------- Agence : flux des ventes, analyse d'un vendeur

/** Flux des ventes (Agence) : références vendues ou disparues des 30 derniers jours, par marque et catégorie, sans pseudo. */
export async function salesFeed(ctx: OrgContext): Promise<TrackSalesFeed> {
  requireAction(ctx, "analytics.read");
  return withOrg(ctx, async (tx) => {
    const sub = await repos.subscriptions.get(tx);
    if ((sub?.quotas ?? quotasForPlan("free")).trackFiltersFollowed <= 0) throw unavailable();
    if (sub?.plan !== "agence") throw new AppError("plan_required", TRACK_SALES_FEED_AGENCY_ONLY, 402);
    const since = new Date(ctx.services.now().getTime() - TRACK_SALES_FEED_DAYS * 86_400_000).toISOString();
    let rows = await repos.priceReferences.salesByNiche(tx, { since, includeDemo: false });
    let demo = false;
    if (rows.length === 0) {
      rows = await repos.priceReferences.salesByNiche(tx, { since, includeDemo: true });
      demo = rows.length > 0;
    }
    return { days: TRACK_SALES_FEED_DAYS, rows, demo, notices: [TRACK_LEGAL_NOTICE, TRACK_GONE_NOTICE, ...(demo ? [TRACK_DEMO_NOTICE] : [])] };
  });
}

/**
 * Analyse d'un vendeur concurrent (Agence) : NON CONSTRUITE. Refusée (409) tant que
 * TRACK_SELLER_ANALYSIS_ENABLED est faux (à valider juridiquement, RGPD) ; même ouverte, seul l'écran
 * d'explication existe (501). Aucun pseudo n'est lu ni gardé.
 */
export async function sellerAnalysis(ctx: OrgContext): Promise<never> {
  requireAction(ctx, "analytics.read");
  if (ctx.services.config?.trackSellerAnalysisEnabled !== true) throw new AppError("track_seller_analysis_legal_review", TRACK_SELLER_ANALYSIS_NOTICE, 409);
  throw new AppError("track_seller_analysis_not_built", "L'analyse d'un vendeur concurrent n'est pas construite : seul l'écran d'explication existe.", 501);
}

// ---------------------------------------------------------------- rétention (worker)

/** Organisations qui ont des données Track (passage de rétention). */
export function trackOrgIds(services: Services): Promise<string[]> {
  return services.db.withGlobal((tx) => repos.trackOrgs.ids(tx));
}

/**
 * Historique d'une organisation : scans et recherches par photo plus anciens que `trackHistoryMonths`
 * mois (tout, sans offre Track) sont supprimés.
 */
export async function purgeTrackHistory(services: Services, orgId: string, now: Date = services.now()): Promise<{ scans: number; photoSearches: number }> {
  return services.db.withOrg(orgId, async (tx) => {
    const months = Math.max(0, Math.min(12, (await quotasTx(tx)).trackHistoryMonths));
    const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes())).toISOString();
    const cutoff = months === 0 ? new Date(now.getTime() + 1).toISOString() : before;
    return { scans: await repos.trackScans.purgeBefore(tx, cutoff), photoSearches: await repos.trackPhotoSearches.purgeBefore(tx, cutoff) };
  });
}

/** Instantanés partagés : historique du plan le plus long parmi ceux qui suivent l'empreinte (12 mois au plus). */
export function purgeTrackSnapshots(services: Services, now: Date = services.now()): Promise<{ snapshots: number; fingerprints: number }> {
  return services.db.withGlobal((tx) => repos.trackReads.purge(tx, now.toISOString()));
}
