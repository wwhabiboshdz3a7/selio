import {
  ITEM_CATEGORY_LABELS, TRACK_BRAND_SHARES_MAX, TRACK_DEMO_NOTICE, TRACK_GONE_NOTICE, TRACK_INSUFFICIENT_DATA, TRACK_LEGAL_NOTICE, TRACK_READ_INTERVAL_HOURS,
  TRACK_SALES_FEED_DAYS, TRACK_SCAN_MIN_REFERENCES, TRACK_SCAN_MIN_SOLD, TRACK_SCAN_WINDOW_DAYS, TRACK_TRENDS_DAYS, TRACK_TRENDS_DEFAULT_DAYS,
  type InventoryItem, type ItemCategory, type MarketObservation, type TrackBrandShare, type TrackCriteria, type TrackFilter, type TrackPhotoSearch, type TrackSalesFeed, type TrackSalesFeedRow, type TrackScan, type TrackTrendPoint,
  TRACK_ALERT_COOLDOWN_HOURS, TRACK_ALERT_MIN_REFERENCE_SNAPSHOTS, TRACK_ALERT_NOTICE, TRACK_ALERT_REFERENCE_DAYS, TRACK_SOURCE_LABELS, trackAlertRules,
  type TrackAdminOrgUsage, type TrackAdminRead, type TrackAdminStatus, type TrackAlertEvent, type TrackAlertRules, type TrackFilterAlerts,
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
  /** Pause manuelle posée depuis l'administration (démonstration : aucun worker, aucun effet réel). */
  manualPause?: { paused: boolean; since: string | null; by: string | null; reason: string | null };
}

/** Réglage des alertes par défaut : tout est coupé. */
export const DEFAULT_ALERT_RULES: TrackAlertRules = trackAlertRules.parse({});

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
  return { id: newId(), orgId, name, criteria, fingerprint: demoFingerprint(criteria), enabled: true, alertRules: DEFAULT_ALERT_RULES, lastReadAt: null, nextReadAt: null, createdAt: iso, updatedAt: iso };
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

// ---------------------------------------------------------------- alertes de tendance (démonstration)

const eur = (cents: number) => `${(Math.round(cents) / 100).toFixed(2).replace(".", ",")} €`;
const medianOf = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Alertes d'un filtre en démonstration : les règles allumées sont rejouées sur les 14 derniers jours de la
 * tendance simulée (un point par jour, une alerte par règle et par jour au plus), mêmes textes que le
 * serveur. Le délai de vente n'est pas simulé : sa règle ne déclenche rien ici. Tout est signalé comme
 * données de démonstration ; aucune notification n'est envoyée.
 */
export function demoFilterAlerts(f: TrackFilter, historyMonths: number, now: Date): TrackFilterAlerts {
  const rules = trackAlertRules.parse(f.alertRules ?? {});
  const events: TrackAlertEvent[] = [];
  if (rules.enabled) {
    const points = demoTrends(f, 30, historyMonths, now).points;
    const from = Math.max(TRACK_ALERT_MIN_REFERENCE_SNAPSHOTS, points.length - 14);
    for (let i = from; i < points.length; i++) {
      const p = points[i]!;
      const at = `${p.day}T12:00:00.000Z`;
      const base = { orgId: f.orgId, filterId: f.id, source: "demo" as const, notified: false, readAt: at, createdAt: at };
      const ref = medianOf(points.slice(Math.max(0, i - TRACK_ALERT_REFERENCE_DAYS), i).map((x) => x.medianPriceCents).filter((v): v is number => v !== null));
      if (rules.medianPrice.enabled && p.medianPriceCents !== null && ref) {
        const change = (p.medianPriceCents - ref) / ref;
        if (Math.round(Math.abs(change) * 100) >= rules.medianPrice.percent) {
          events.push({ ...base, id: `demo-${f.id}-prix-${p.day}`, rule: "median_price", value: Math.round(change * 1000) / 1000, reference: Math.round(ref), message: `Prix médian en ${change > 0 ? "hausse" : "baisse"} de ${Math.round(Math.abs(change) * 100)} % : ${eur(p.medianPriceCents)} contre ${eur(ref)} sur les ${TRACK_ALERT_REFERENCE_DAYS} jours précédents.` });
        }
      }
      // Nouvelles annonces d'une lecture (12 lectures par jour) au-dessus du seuil.
      const perRead = Math.round(p.newCount / 12);
      if (rules.newListings.enabled && perRead >= rules.newListings.threshold) {
        events.push({ ...base, id: `demo-${f.id}-nouvelles-${p.day}`, rule: "new_listings", value: perRead, reference: rules.newListings.threshold, message: `${perRead} nouvelles annonces depuis la lecture précédente (seuil : ${rules.newListings.threshold}).` });
      }
    }
  }
  return { filterId: f.id, rules, events: events.reverse().slice(0, 30), cooldownHours: TRACK_ALERT_COOLDOWN_HOURS, notices: [TRACK_ALERT_NOTICE, TRACK_DEMO_NOTICE, "Démonstration : les alertes sont rejouées sur l'historique simulé et aucune notification n'est envoyée."] };
}

// ---------------------------------------------------------------- administration (démonstration)

/**
 * Vue « Track » de l'administration en démonstration : simulateur, interrupteur fermé, lectures simulées
 * des filtres de la démo (empreintes abrégées), aucun blocage (aucune page de Vinted n'est jamais lue),
 * usage de l'organisation de la démo et de trois organisations d'exemple. La pause manuelle est gardée
 * dans l'état de la démo (aucun worker).
 */
export function demoAdminTrack(input: { state: DemoTrackState; org: { id: string; name: string; plan: string }; quotas: { filters: number; scans: number; photoSearches: number }; month: { scans: number; photoSearches: number }; canControl: boolean; now: Date }): TrackAdminStatus {
  const { state, now } = input;
  const manual = state.manualPause ?? { paused: false, since: null, by: null, reason: null };
  const reads: TrackAdminRead[] = [];
  for (const f of state.filters.filter((x) => x.enabled)) {
    const t = demoReadTimes(f.fingerprint, f.createdAt, now);
    const trend = demoTrends(f, 7, 12, now).points.at(-1);
    for (let k = 0; k < 3; k++) {
      const at = new Date(new Date(t.lastReadAt).getTime() - k * READ_MS);
      if (at.getTime() < new Date(f.createdAt).getTime()) break;
      if (manual.paused && manual.since && at.toISOString() > manual.since) continue;
      reads.push({ fingerprint: f.fingerprint.slice(0, 12), readAt: at.toISOString(), source: "demo", outcome: "ok", listed: trend?.listedCount ?? 0, newCount: Math.round((trend?.newCount ?? 0) / 12), goneCount: Math.round((trend?.goneCount ?? 0) / 12), factor: 1, message: null });
    }
  }
  reads.sort((a, b) => b.readAt.localeCompare(a.readAt));
  const sample = (orgId: string, name: string, plan: "pro" | "agence", filters: number, enabled: number, scans: number, photoSearches: number, alertFilters: number): TrackAdminOrgUsage => {
    const q = plan === "pro" ? { f: 5, s: 10, p: 30 } : { f: 25, s: 50, p: 150 };
    return { orgId, name, plan, filters: { used: filters, quota: q.f, enabled }, scans: { used: scans, quota: q.s }, photoSearches: { used: photoSearches, quota: q.p }, alertFilters };
  };
  const usage: TrackAdminOrgUsage[] = [
    ...(input.quotas.filters > 0 || state.filters.length > 0 ? [{ orgId: input.org.id, name: input.org.name, plan: input.org.plan, filters: { used: state.filters.length, quota: input.quotas.filters, enabled: state.filters.filter((f) => f.enabled).length }, scans: { used: input.month.scans, quota: input.quotas.scans }, photoSearches: { used: input.month.photoSearches, quota: input.quotas.photoSearches }, alertFilters: state.filters.filter((f) => f.enabled && f.alertRules?.enabled).length }] : []),
    sample("org-exemple-pro", "Atelier Lune (exemple)", "pro", 5, 5, 6, 11, 2),
    sample("org-exemple-agence", "Dressing Nomade (exemple)", "agence", 12, 11, 20, 40, 4),
  ];
  const ratio = (u: TrackAdminOrgUsage) => Math.max(u.filters.quota ? u.filters.used / u.filters.quota : 0, u.scans.quota ? u.scans.used / u.scans.quota : 0, u.photoSearches.quota ? u.photoSearches.used / u.photoSearches.quota : 0);
  usage.sort((a, b) => ratio(b) - ratio(a) || a.name.localeCompare(b.name, "fr"));
  const dayAgo = new Date(now.getTime() - DAY).toISOString();
  const last24 = reads.filter((r) => r.readAt >= dayAgo).length;
  return {
    source: "demo", sourceLabel: TRACK_SOURCE_LABELS.demo, liveEnabled: false,
    manualPause: manual,
    signalPause: { until: null, reason: null, active: false },
    machinePausedUntil: null,
    slowdown: { factor: 1, storedFactor: 1, lastBlockAt: null, windowReads: 0, windowBlocks: 0, blocksPer1000: null },
    fingerprints: { followed: new Set(state.filters.filter((f) => f.enabled).map((f) => f.fingerprint)).size, due: 0, slowed: 0 },
    last24h: { reads: last24, ok: last24, anomalies: 0, blocked: 0, skipped: 0 },
    recentReads: reads.slice(0, 20),
    recentProblems: [],
    usage,
    canControl: input.canControl,
    notices: ["Démonstration : interrupteur fermé (TRACK_LIVE_ENABLED=false), lectures simulées. Aucune page de Vinted n'est lue.", TRACK_DEMO_NOTICE],
  };
}
