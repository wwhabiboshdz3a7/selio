import { ITEM_CATEGORY_LABELS, type ItemCategory, type MarketObservation } from "@selio/contracts";
import { ratio, type Cents } from "./money";

/**
 * Analyse des grands revendeurs et de leurs niches, à partir d'annonces
 * observées (radar, extension, ou simulateur en démonstration). Inspirée
 * des trackers de niches : qui vend le plus, quoi, à quel prix, avec
 * quelle rotation, et quelles niches sont peu concurrencées.
 */

export interface ShareRow {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface SellerInsight {
  handle: string;
  /** Annonces actives observées. */
  listings: number;
  /** Ventes observées dans la fenêtre. */
  sold: number;
  sellThrough: number;
  revenueCents: Cents;
  averagePriceCents: Cents;
  favoritesPerListing: number;
  /** Niche principale (marque × catégorie la plus vendue). */
  niche: string;
  nicheShare: number;
  topBrands: ShareRow[];
  topCategories: ShareRow[];
  /** Ventes de la seconde moitié de la fenêtre vs la première (−1 à +∞, null sans base). */
  growth: number | null;
  /** Ventes par jour de la semaine (lundi = 0). */
  weekdaySales: number[];
}

export interface NicheInsight {
  key: string;
  brand: string;
  category: ItemCategory;
  label: string;
  sellers: number;
  listings: number;
  sold: number;
  sellThrough: number;
  averagePriceCents: Cents;
  medianPriceCents: Cents;
  /** Demande 0–100 : rotation et volume de ventes. */
  demand: number;
  competition: "faible" | "moyenne" | "forte";
  growth: number | null;
}

export interface MarketInsights {
  windowDays: number;
  totals: { sellers: number; listings: number; sold: number; revenueCents: Cents; sellThrough: number; averagePriceCents: Cents };
  sellers: SellerInsight[];
  niches: NicheInsight[];
  /** Niches à forte demande et concurrence faible ou moyenne. */
  opportunities: NicheInsight[];
  brands: { brand: string; sold: number; listings: number; sellThrough: number; averagePriceCents: Cents; sellers: number }[];
  categories: { category: ItemCategory; label: string; sold: number; listings: number; sellThrough: number; averagePriceCents: Cents }[];
  /** Ventes par tranche de prix (tous vendeurs). */
  priceBands: { label: string; sold: number; listings: number }[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function shares(map: Map<string, number>, total: number, label: (k: string) => string, limit = 3): ShareRow[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, label: label(key), count, share: ratio(count, total) }));
}

function inc(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

const PRICE_BANDS: { label: string; max: number }[] = [
  { label: "< 15 €", max: 1500 },
  { label: "15 – 30 €", max: 3000 },
  { label: "30 – 50 €", max: 5000 },
  { label: "50 – 80 €", max: 8000 },
  { label: "80 € et +", max: Number.MAX_SAFE_INTEGER },
];

export function analyzeMarket(observations: MarketObservation[], now: Date, windowDays = 30): MarketInsights {
  const from = now.getTime() - windowDays * 86_400_000;
  const half = now.getTime() - (windowDays / 2) * 86_400_000;
  const obs = observations.filter((o) => (o.status === "sold" ? new Date(o.soldAt ?? o.seenAt).getTime() >= from : true));
  const brandOf = (o: MarketObservation) => o.brand?.trim() || "Sans marque";
  const nicheKey = (o: MarketObservation) => `${brandOf(o).toLowerCase()}|${o.category}`;

  // ---- Vendeurs ----
  const bySeller = new Map<string, MarketObservation[]>();
  for (const o of obs) bySeller.set(o.sellerHandle, [...(bySeller.get(o.sellerHandle) ?? []), o]);
  const sellers: SellerInsight[] = [...bySeller.entries()].map(([handle, list]) => {
    const sold = list.filter((o) => o.status === "sold");
    const listed = list.filter((o) => o.status === "listed");
    const brands = new Map<string, number>();
    const cats = new Map<string, number>();
    const niches = new Map<string, number>();
    const weekday = [0, 0, 0, 0, 0, 0, 0];
    let early = 0, late = 0;
    for (const o of sold) {
      inc(brands, brandOf(o));
      inc(cats, o.category);
      inc(niches, nicheKey(o));
      const at = new Date(o.soldAt ?? o.seenAt);
      weekday[(at.getUTCDay() + 6) % 7]!++;
      if (at.getTime() >= half) late++;
      else early++;
    }
    const base = sold.length ? sold : listed;
    if (!sold.length) for (const o of listed) { inc(brands, brandOf(o)); inc(cats, o.category); inc(niches, nicheKey(o)); }
    const topNiche = [...niches.entries()].sort((a, b) => b[1] - a[1])[0];
    const nicheLabel = topNiche ? (() => { const [b, c] = topNiche[0].split("|"); const brand = base.find((o) => brandOf(o).toLowerCase() === b)?.brand ?? b!; return `${brand} · ${ITEM_CATEGORY_LABELS[c as ItemCategory] ?? c}`; })() : "—";
    const revenue = sold.reduce((s, o) => s + o.priceCents, 0);
    return {
      handle,
      listings: listed.length,
      sold: sold.length,
      sellThrough: ratio(sold.length, sold.length + listed.length),
      revenueCents: revenue,
      averagePriceCents: base.length ? Math.round(base.reduce((s, o) => s + o.priceCents, 0) / base.length) : 0,
      favoritesPerListing: listed.length ? Math.round((listed.reduce((s, o) => s + o.favorites, 0) / listed.length) * 10) / 10 : 0,
      niche: nicheLabel,
      nicheShare: topNiche ? ratio(topNiche[1], base.length) : 0,
      topBrands: shares(brands, base.length, (k) => k),
      topCategories: shares(cats, base.length, (k) => ITEM_CATEGORY_LABELS[k as ItemCategory] ?? k),
      growth: early === 0 ? null : (late - early) / early,
      weekdaySales: weekday,
    };
  }).sort((a, b) => b.revenueCents - a.revenueCents || b.sold - a.sold);

  // ---- Niches ----
  const byNiche = new Map<string, MarketObservation[]>();
  for (const o of obs) byNiche.set(nicheKey(o), [...(byNiche.get(nicheKey(o)) ?? []), o]);
  const maxSold = Math.max(1, ...[...byNiche.values()].map((l) => l.filter((o) => o.status === "sold").length));
  const niches: NicheInsight[] = [...byNiche.entries()].map(([key, list]) => {
    const sold = list.filter((o) => o.status === "sold");
    const listed = list.filter((o) => o.status === "listed");
    const sellThrough = ratio(sold.length, sold.length + listed.length);
    const demand = Math.round(60 * sellThrough + 40 * Math.min(1, sold.length / maxSold));
    const sellersCount = new Set(list.map((o) => o.sellerHandle)).size;
    const early = sold.filter((o) => new Date(o.soldAt ?? o.seenAt).getTime() < half).length;
    const late = sold.length - early;
    const brand = list[0]!.brand?.trim() || "Sans marque";
    const category = list[0]!.category;
    const prices = (sold.length ? sold : list).map((o) => o.priceCents);
    return {
      key,
      brand,
      category,
      label: `${brand} · ${ITEM_CATEGORY_LABELS[category]}`,
      sellers: sellersCount,
      listings: listed.length,
      sold: sold.length,
      sellThrough,
      averagePriceCents: prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0,
      medianPriceCents: median(prices),
      demand,
      competition: (sellersCount <= 2 && listed.length <= 6 ? "faible" : sellersCount <= 4 ? "moyenne" : "forte") as NicheInsight["competition"],
      growth: early === 0 ? null : (late - early) / early,
    };
  }).sort((a, b) => b.demand - a.demand || b.sold - a.sold);

  // ---- Marques, catégories, tranches de prix ----
  const brandMap = new Map<string, { sold: number; listings: number; sum: number; n: number; sellers: Set<string> }>();
  const catMap = new Map<ItemCategory, { sold: number; listings: number; sum: number; n: number }>();
  const bands = PRICE_BANDS.map((b) => ({ label: b.label, sold: 0, listings: 0 }));
  for (const o of obs) {
    const b = brandMap.get(brandOf(o)) ?? { sold: 0, listings: 0, sum: 0, n: 0, sellers: new Set<string>() };
    const c = catMap.get(o.category) ?? { sold: 0, listings: 0, sum: 0, n: 0 };
    if (o.status === "sold") { b.sold++; c.sold++; b.sum += o.priceCents; b.n++; c.sum += o.priceCents; c.n++; }
    else { b.listings++; c.listings++; }
    b.sellers.add(o.sellerHandle);
    brandMap.set(brandOf(o), b);
    catMap.set(o.category, c);
    const band = bands[PRICE_BANDS.findIndex((pb) => o.priceCents < pb.max)]!;
    if (o.status === "sold") band.sold++;
    else band.listings++;
  }
  const brands = [...brandMap.entries()].map(([brand, v]) => ({ brand, sold: v.sold, listings: v.listings, sellThrough: ratio(v.sold, v.sold + v.listings), averagePriceCents: v.n ? Math.round(v.sum / v.n) : 0, sellers: v.sellers.size })).sort((a, b) => b.sold - a.sold);
  const categories = [...catMap.entries()].map(([category, v]) => ({ category, label: ITEM_CATEGORY_LABELS[category], sold: v.sold, listings: v.listings, sellThrough: ratio(v.sold, v.sold + v.listings), averagePriceCents: v.n ? Math.round(v.sum / v.n) : 0 })).sort((a, b) => b.sold - a.sold);

  const soldAll = obs.filter((o) => o.status === "sold");
  const listedAll = obs.filter((o) => o.status === "listed");
  const revenueCents = soldAll.reduce((s, o) => s + o.priceCents, 0);
  return {
    windowDays,
    totals: { sellers: sellers.length, listings: listedAll.length, sold: soldAll.length, revenueCents, sellThrough: ratio(soldAll.length, obs.length), averagePriceCents: soldAll.length ? Math.round(revenueCents / soldAll.length) : 0 },
    sellers,
    niches,
    opportunities: niches.filter((n) => n.demand >= 50 && n.competition !== "forte" && n.sold >= 2).slice(0, 6),
    brands,
    categories,
    priceBands: bands,
  };
}
