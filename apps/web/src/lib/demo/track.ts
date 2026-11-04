import {
  ITEM_CATEGORY_LABELS, TRACK_BRAND_SHARES_MAX, TRACK_DEMO_NOTICE, TRACK_GONE_NOTICE, TRACK_INSUFFICIENT_DATA, TRACK_LEGAL_NOTICE, TRACK_READ_INTERVAL_HOURS,
  TRACK_SALES_FEED_DAYS, TRACK_SCAN_MIN_REFERENCES, TRACK_SCAN_MIN_SOLD, TRACK_SCAN_WINDOW_DAYS, TRACK_TRENDS_DAYS, TRACK_TRENDS_DEFAULT_DAYS,
  type InventoryItem, type ItemCategory, type MarketObservation, type TrackBrandShare, type TrackCriteria, type TrackFilter, type TrackPhotoSearch, type TrackSalesFeed, type TrackSalesFeedRow, type TrackScan, type TrackTrendPoint,
} from "@selio/contracts";
import { hashString, newId, seededRandom } from "@selio/domain";
import type { TrackTrendsView } from "../data/types";
import { normalizeCriteria, quantileCents, scanComponents } from "../track";
import { demoDelayDays } from "./pricing";

/**
 * Selio Track dans la démonstration : état rangé à côté de l'état partagé (comme Radar et le Cloud), créé
 * au premier accès. Tout vient du SIMULATEUR, toujours marqué « données de démonstration » : aucune page de
 * Vinted n'est lue, aucune annonce n'est gardée, aucun pseudo n'apparaît (le marché simulé n'est utilisé
 * qu'en agrégats par marque et catégorie).
 */
export interface DemoTrackState {
  version: 1;
  filters: TrackFilter[];
  scans: TrackScan[];
  /** Description et estimation seulement : la photo n'est jamais gardée. */
  photoSearches: TrackPhotoSearch[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const READ_MS = TRACK_READ_INTERVAL_HOURS * HOUR;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (t: number) => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());

/**
 * Empreinte (64 caractères hexadécimaux) des critères normalisés : deux filtres identiques ont la même.
 * Le serveur utilise SHA-256 ; la démonstration, un hachage déterministe sans dépendance.
 */
export function demoFingerprint(criteria: Partial<TrackCriteria>): string {
  const n = normalizeCriteria(criteria);
  const canonical = JSON.stringify({ v: 1, brands: n.brands, categories: n.categories, conditions: n.conditions, keywords: n.keywords, maxPriceCents: n.maxPriceCents, sizes: n.sizes });
  let out = "";
  for (let i = 0; i < 8; i++) out += hashString(`${i}:${canonical}`).toString(16).padStart(8, "0");
  return out;
}

/** Dernière et prochaine lecture (toutes les 2 h, décalage propre à l'empreinte) depuis la création du filtre. */
export function demoReadTimes(fingerprint: string, createdAt: string, now: Date): { lastReadAt: string; nextReadAt: string } {
  const offset = (hashString(`lecture:${fingerprint}`) % 120) * 60_000;
  const created = new Date(createdAt).getTime();
  const k = Math.floor((now.getTime() - offset) / READ_MS);
  const last = Math.min(now.getTime(), Math.max(created, offset + k * READ_MS));
  return { lastReadAt: new Date(last).toISOString(), nextReadAt: new Date(last + READ_MS).toISOString() };
}

export function withReadTimes(f: TrackFilter, now: Date): TrackFilter {
  return { ...f, ...demoReadTimes(f.fingerprint, f.createdAt, now) };
}

/** Critères complétés (valeurs par défaut du contrat), tels que saisis : l'empreinte, elle, est normalisée. */
export function completeCriteria(c: Partial<TrackCriteria>): TrackCriteria {
  return { brands: c.brands ?? [], categories: c.categories ?? [], sizes: c.sizes ?? [], conditions: c.conditions ?? [], maxPriceCents: c.maxPriceCents ?? 5000, keywords: c.keywords ?? [] };
}

function filter(orgId: string, name: string, criteria: TrackCriteria, createdAt: Date): TrackFilter {
  const iso = createdAt.toISOString();
  return { id: newId(), orgId, name, criteria, fingerprint: demoFingerprint(criteria), enabled: true, lastReadAt: null, nextReadAt: null, createdAt: iso, updatedAt: iso };
}

// ---------------------------------------------------------------- simulateur de lectures (déterministe)

const DEMO_EPOCH = Date.UTC(2026, 0, 1);
const DEFAULT_BRANDS = ["Levi's", "Nike", "Zara", "Ralph Lauren", "Sézane", "Carhartt", "Adidas", "Maje"];
const PAGE_SIZE = 96;

interface SimListing { publishedAt: number; endsAt: number; priceCents: number; brand: string }

/**
 * Annonces simulées d'une empreinte : une nouvelle toutes les 80 à 180 min, chacune en ligne de 6 h à
 * 14 jours, prix lentement variable. Même empreinte → mêmes annonces (aucune n'est gardée : seuls les
 * agrégats du jour sont calculés).
 */
function simulateListings(fingerprint: string, criteria: TrackCriteria, fromMs: number, toMs: number): SimListing[] {
  const base = seededRandom(hashString(fingerprint));
  const spacing = (80 + Math.floor(base() * 100)) * 60_000;
  const phase = base() * Math.PI * 2;
  const brands = criteria.brands.length ? criteria.brands : DEFAULT_BRANDS;
  const maxPrice = Math.max(500, criteria.maxPriceCents || 5000);
  const out: SimListing[] = [];
  const kFrom = Math.max(0, Math.floor((fromMs - 15 * DAY - DEMO_EPOCH) / spacing));
  const kTo = Math.floor((toMs - DEMO_EPOCH) / spacing);
  for (let k = kFrom; k <= kTo; k++) {
    const r = seededRandom(hashString(`${fingerprint}:${k}`));
    const publishedAt = DEMO_EPOCH + k * spacing + Math.floor(r() * spacing * 0.5);
    if (publishedAt > toMs) continue;
    const lifetime = (6 + r() * r() * 330) * HOUR;
    const drift = 1 + 0.09 * Math.sin(phase + ((publishedAt - DEMO_EPOCH) / (45 * DAY)) * Math.PI * 2);
    const brand = brands[Math.floor(r() * brands.length)]!;
    const priceCents = Math.max(100, Math.round((maxPrice * (0.3 + r() * 0.6) * drift) / 50) * 50);
    out.push({ publishedAt, endsAt: publishedAt + lifetime, priceCents, brand });
  }
  return out;
}

/**
 * Tendances d'un filtre sur 7, 30 ou 90 jours (bornées à l'historique du plan), depuis sa création : un
 * point par jour (annonces en ligne en fin de journée, prix médian, nouvelles, disparues — estimation).
 */
export function demoTrends(f: TrackFilter, rawDays: number | undefined, historyMonths: number, now: Date): TrackTrendsView {
  const wanted = (TRACK_TRENDS_DAYS as readonly number[]).includes(rawDays ?? -1) ? rawDays! : TRACK_TRENDS_DEFAULT_DAYS;
  const days = Math.min(wanted, Math.max(0, historyMonths) * 30);
  const nowMs = now.getTime();
  const firstDay = Math.max(startOfDay(nowMs - (days - 1) * DAY), startOfDay(new Date(f.createdAt).getTime()));
  // Marques telles que saisies (affichage) ; le reste des critères normalisé.
  const criteria = { ...normalizeCriteria(f.criteria), brands: [...new Set((f.criteria.brands ?? []).map((b) => b.trim()).filter(Boolean))] };
  const listings = days > 0 ? simulateListings(f.fingerprint, criteria, firstDay, nowMs) : [];
  const points: TrackTrendPoint[] = [];
  let lastActive: SimListing[] = [];
  for (let d = firstDay; d <= nowMs && days > 0; d += DAY) {
    const end = Math.min(d + DAY, nowMs);
    const active = listings.filter((l) => l.publishedAt <= end && l.endsAt > end).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, PAGE_SIZE);
    const prices = active.map((l) => l.priceCents);
    points.push({
      day: dayKey(d),
      listedCount: active.length,
      medianPriceCents: quantileCents(prices, 0.5),
      newCount: listings.filter((l) => l.publishedAt >= d && l.publishedAt < end).length,
      goneCount: listings.filter((l) => l.endsAt >= d && l.endsAt < end && l.publishedAt < d).length,
    });
    lastActive = active;
  }
  const priced = points.filter((p) => p.medianPriceCents !== null);
  const first = priced[0]?.medianPriceCents ?? null;
  const last = priced[priced.length - 1]?.medianPriceCents ?? null;
  const counts = new Map<string, number>();
  for (const l of lastActive) counts.set(l.brand, (counts.get(l.brand) ?? 0) + 1);
  const brandShares: TrackBrandShare[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TRACK_BRAND_SHARES_MAX)
    .map(([brand, count]) => ({ brand, count, share: lastActive.length ? Math.round((count / lastActive.length) * 1000) / 1000 : 0 }));
  const snapshots = points.length ? Math.max(1, Math.floor((nowMs - Math.max(firstDay, new Date(f.createdAt).getTime())) / READ_MS) + 1) : 0;
  return {
    filterId: f.id, fingerprint: f.fingerprint, days, points, snapshots,
    medianPriceChange: priced.length >= 2 && first ? Math.round(((last! - first) / first) * 1000) / 1000 : null,
    goneTotal: points.reduce((n, p) => n + p.goneCount, 0),
    source: points.length ? "demo" : null,
    demo: true,
    notices: [TRACK_LEGAL_NOTICE, TRACK_GONE_NOTICE, TRACK_DEMO_NOTICE],
    brandShares,
  };
}

// ---------------------------------------------------------------- scans de niche et flux des ventes

const sameBrand = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Scan de niche sur le marché simulé (90 derniers jours) : même formule que le serveur. Sous 10 références
 * ou 3 ventes, « données insuffisantes » (aucune note, aucun prix ni délai — seulement les volumes —, rien
 * n'est décompté).
 */
export function demoNicheScan(orgId: string, input: { brand: string | null; category: ItemCategory }, market: readonly MarketObservation[], items: readonly InventoryItem[], now: Date): TrackScan {
  const since = now.getTime() - TRACK_SCAN_WINDOW_DAYS * DAY;
  const refs = market.filter((m) => m.category === input.category && (!input.brand || sameBrand(m.brand, input.brand)) && new Date(m.seenAt).getTime() >= since);
  const sold = refs.filter((m) => m.status === "sold");
  const listed = refs.filter((m) => m.status === "listed");
  const medianDays = quantileCents(sold.map((m) => Math.round(demoDelayDays(m.id) * 10)), 0.5);
  const own = items.filter((i) => i.category === input.category && (!input.brand || sameBrand(i.brand, input.brand)) && i.purchasePriceCents > 0).map((i) => i.purchasePriceCents);
  const details = {
    medianDaysToSell: medianDays === null ? null : medianDays / 10,
    activeListings: listed.length,
    medianResaleCents: quantileCents(sold.map((m) => m.priceCents), 0.5),
    medianBuyCents: own.length ? quantileCents(own, 0.5) : quantileCents(listed.map((m) => m.priceCents), 0.25),
  };
  const basedOn = { references: refs.length, snapshots: 0, sold: sold.length, demo: true };
  const base = { id: newId(), orgId, brand: input.brand, category: input.category, basedOn, details, createdAt: now.toISOString() };
  if (refs.length < TRACK_SCAN_MIN_REFERENCES || sold.length < TRACK_SCAN_MIN_SOLD) {
    // Comme le serveur : une médiane sur une ou deux ventes serait le prix exact d'une vente.
    const volumes = { medianDaysToSell: null, activeListings: listed.length, medianResaleCents: null, medianBuyCents: null };
    return { ...base, details: volumes, status: "insufficient_data", score: null, components: null, message: TRACK_INSUFFICIENT_DATA };
  }
  const { components, score } = scanComponents({ sold: sold.length, active: listed.length, activeListings: listed.length, medianDaysToSell: details.medianDaysToSell, medianResaleCents: details.medianResaleCents, medianBuyCents: details.medianBuyCents });
  return { ...base, status: "ok", score, components, message: TRACK_DEMO_NOTICE };
}

/** Flux des ventes (Agence) : ventes des 30 derniers jours du marché simulé, par marque et catégorie, sans vendeur. */
export function demoSalesFeed(market: readonly MarketObservation[], now: Date): TrackSalesFeed {
  const since = now.getTime() - TRACK_SALES_FEED_DAYS * DAY;
  const groups = new Map<string, MarketObservation[]>();
  for (const m of market) {
    if (m.status !== "sold" || !m.soldAt || new Date(m.soldAt).getTime() < since || !m.brand) continue;
    const key = `${m.brand}|${m.category}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const rows: TrackSalesFeedRow[] = [...groups.values()].map((list) => ({
    brand: list[0]!.brand!,
    category: list[0]!.category,
    sold: list.length,
    // Disparitions (prix final estimé) : la plupart des « ventes » vues par Track en sont.
    estimatedShare: Math.round((list.filter((m) => hashString(`disparue:${m.id}`) % 10 < 7).length / list.length) * 100) / 100,
    medianPriceCents: quantileCents(list.map((m) => m.priceCents), 0.5),
    lastSoldAt: list.map((m) => m.soldAt!).sort().pop() ?? null,
  })).sort((a, b) => b.sold - a.sold || a.brand.localeCompare(b.brand));
  return { days: TRACK_SALES_FEED_DAYS, rows, demo: true, notices: [TRACK_LEGAL_NOTICE, TRACK_GONE_NOTICE, TRACK_DEMO_NOTICE] };
}

/** Premier accès : deux filtres suivis (créés il y a 45 et 38 jours) et un scan de niche. */
export function seedDemoTrack(orgId: string, market: readonly MarketObservation[], items: readonly InventoryItem[], now: Date): DemoTrackState {
  const t = now.getTime();
  const filters = [
    filter(orgId, "Levi's 501 · Homme", completeCriteria({ brands: ["Levi's"], categories: ["men"], keywords: ["501"], maxPriceCents: 4500 }), new Date(t - 45 * DAY)),
    filter(orgId, `Nike · ${ITEM_CATEGORY_LABELS.shoes}`, completeCriteria({ brands: ["Nike"], categories: ["shoes"], maxPriceCents: 9000 }), new Date(t - 38 * DAY)),
  ];
  const scans = [demoNicheScan(orgId, { brand: "Ralph Lauren", category: "men" }, market, items, new Date(t - 3 * DAY))];
  return { version: 1, filters, scans, photoSearches: [] };
}
