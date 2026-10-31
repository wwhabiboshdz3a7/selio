import { ITEM_CATEGORY_LABELS, type InventoryItem, type ItemCategory, type Order } from "@selio/contracts";
import { countsAsRevenue, orderMargin } from "./orders";
import { daysInStock } from "./inventory";
import { ratio, type Cents } from "./money";
import type { Period } from "./analytics";

/**
 * Données des graphiques ajoutables de la vue d'ensemble. Tout est calculé
 * depuis les commandes et le stock : aucun indicateur simulé.
 */

export interface LabeledValue {
  key: string;
  label: string;
  value: number;
  secondary?: number;
}

export interface DashboardData {
  /** Bénéfice (marge brute) cumulé jour après jour sur la période. */
  cumulativeMargin: LabeledValue[];
  /** Taux de marge par pas de temps. */
  marginRateSeries: LabeledValue[];
  /** Panier moyen par pas de temps. */
  basketSeries: LabeledValue[];
  /** Ventes par jour de la semaine (lundi → dimanche). */
  weekday: LabeledValue[];
  /** Ventes par tranche horaire. */
  hours: LabeledValue[];
  /** CA par catégorie (part du total). */
  categoryMix: LabeledValue[];
  /** Marge par marque. */
  brandMargin: LabeledValue[];
  /** Stock actif par ancienneté (jours depuis l'achat). */
  stockAging: LabeledValue[];
  /** Délai de vente des articles vendus sur la période. */
  daysToSell: LabeledValue[];
  /** Valeur d'achat du stock par catégorie. */
  stockValueByCategory: LabeledValue[];
  /** Ventes par tranche de prix. */
  priceBands: LabeledValue[];
  /** Prix d'achat moyen vs prix de vente moyen par catégorie. */
  buyVsSell: LabeledValue[];
  /** Taux d'écoulement par catégorie (vendus / (vendus + actifs)). */
  sellThroughByCategory: LabeledValue[];
  /** Objectif du mois : CA du mois précédent + 10 %, et réalisé à date. */
  monthlyGoal: { targetCents: Cents; achievedCents: Cents; previousMonthCents: Cents; daysElapsed: number; daysInMonth: number };
  /** Commandes par statut sur la période. */
  orderStatus: LabeledValue[];
}

function inPeriod(iso: string, p: Period): boolean {
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t < p.to.getTime();
}

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const HOUR_BANDS = [
  { label: "0 h – 8 h", from: 0, to: 8 },
  { label: "8 h – 12 h", from: 8, to: 12 },
  { label: "12 h – 14 h", from: 12, to: 14 },
  { label: "14 h – 18 h", from: 14, to: 18 },
  { label: "18 h – 21 h", from: 18, to: 21 },
  { label: "21 h – 24 h", from: 21, to: 24 },
];
const AGING = [
  { label: "0 – 7 j", max: 7 },
  { label: "8 – 14 j", max: 14 },
  { label: "15 – 30 j", max: 30 },
  { label: "31 – 60 j", max: 60 },
  { label: "61 – 90 j", max: 90 },
  { label: "+ de 90 j", max: Infinity },
];
const SELL_DAYS = [
  { label: "≤ 7 j", max: 7 },
  { label: "8 – 14 j", max: 14 },
  { label: "15 – 30 j", max: 30 },
  { label: "31 – 60 j", max: 60 },
  { label: "+ de 60 j", max: Infinity },
];
const PRICE_BANDS = [
  { label: "< 20 €", max: 2000 },
  { label: "20 – 40 €", max: 4000 },
  { label: "40 – 70 €", max: 7000 },
  { label: "70 – 100 €", max: 10_000 },
  { label: "100 € et +", max: Infinity },
];

/** Heure locale (Europe/Paris par défaut) d'un instant. */
function localHour(iso: string, timezone: string): number {
  try {
    return Number.parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date(iso)), 10) % 24;
  } catch {
    return new Date(iso).getUTCHours();
  }
}

export function buildDashboard(items: InventoryItem[], orders: Order[], period: Period, now: Date, opts: { timezone?: string; granularity?: "day" | "week" | "month" } = {}): DashboardData {
  const tz = opts.timezone ?? "Europe/Paris";
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const sold = orders.filter((o) => countsAsRevenue(o.status) && inPeriod(o.createdAt, period)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const granularity = opts.granularity ?? "day";
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    if (granularity === "month") return iso.slice(0, 7);
    if (granularity === "week") {
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      return d.toISOString().slice(0, 10);
    }
    return iso.slice(0, 10);
  };
  const labelOf = (key: string) => (granularity === "month" ? new Date(key + "-01T00:00:00Z").toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }) : new Date(key + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }));

  // Pas de temps couvrant toute la période (même vides).
  const buckets = new Map<string, { revenue: number; margin: number; count: number }>();
  const cursor = new Date(period.from);
  while (cursor < period.to && buckets.size < 400) {
    buckets.set(keyOf(cursor.toISOString()), { revenue: 0, margin: 0, count: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const o of sold) {
    const b = buckets.get(keyOf(o.createdAt));
    if (!b) continue;
    const m = orderMargin(o);
    b.revenue += m.salePriceCents;
    b.margin += m.marginCents;
    b.count++;
  }
  let cumul = 0;
  const cumulativeMargin: LabeledValue[] = [];
  const marginRateSeries: LabeledValue[] = [];
  const basketSeries: LabeledValue[] = [];
  for (const [key, b] of buckets) {
    cumul += b.margin;
    cumulativeMargin.push({ key, label: labelOf(key), value: cumul });
    marginRateSeries.push({ key, label: labelOf(key), value: b.revenue ? ratio(b.margin, b.revenue) : 0 });
    basketSeries.push({ key, label: labelOf(key), value: b.count ? Math.round(b.revenue / b.count) : 0 });
  }

  const weekday = WEEKDAYS.map((label, i) => ({ key: String(i), label, value: 0, secondary: 0 }));
  const hours = HOUR_BANDS.map((h) => ({ key: h.label, label: h.label, value: 0 }));
  const cat = new Map<string, number>();
  const brandMargin = new Map<string, number>();
  const priceBands = PRICE_BANDS.map((p) => ({ key: p.label, label: p.label, value: 0 }));
  const daysToSell = SELL_DAYS.map((d) => ({ key: d.label, label: d.label, value: 0 }));
  const buySell = new Map<string, { buy: number; sell: number; n: number }>();
  for (const o of sold) {
    const m = orderMargin(o);
    const d = new Date(o.createdAt);
    const wd = weekday[(d.getUTCDay() + 6) % 7]!;
    wd.value += m.salePriceCents;
    wd.secondary! += 1;
    const h = localHour(o.createdAt, tz);
    hours[HOUR_BANDS.findIndex((b) => h >= b.from && h < b.to)]!.value += 1;
    const it = itemMap.get(o.itemId);
    const category = it?.category ?? "other";
    cat.set(category, (cat.get(category) ?? 0) + m.salePriceCents);
    const brand = it?.brand ?? "Sans marque";
    brandMargin.set(brand, (brandMargin.get(brand) ?? 0) + m.marginCents);
    priceBands[PRICE_BANDS.findIndex((p) => o.salePriceCents < p.max)]!.value += 1;
    if (it) {
      const days = daysInStock({ purchasedAt: it.purchasedAt, createdAt: it.createdAt, soldAt: it.soldAt ?? o.createdAt }, now);
      daysToSell[SELL_DAYS.findIndex((s) => days <= s.max)]!.value += 1;
    }
    const bs = buySell.get(category) ?? { buy: 0, sell: 0, n: 0 };
    bs.buy += o.purchasePriceCents + o.purchaseFeesCents;
    bs.sell += o.salePriceCents;
    bs.n++;
    buySell.set(category, bs);
  }
  const catLabel = (k: string) => ITEM_CATEGORY_LABELS[k as ItemCategory] ?? k;
  const totalRevenue = [...cat.values()].reduce((s, v) => s + v, 0);

  const active = items.filter((i) => i.status !== "sold" && i.status !== "archived");
  const stockAging = AGING.map((a) => ({ key: a.label, label: a.label, value: 0, secondary: 0 }));
  const stockValue = new Map<string, number>();
  for (const it of active) {
    const days = daysInStock(it, now);
    const b = stockAging[AGING.findIndex((a) => days <= a.max)]!;
    b.value += 1;
    b.secondary! += it.purchasePriceCents + it.purchaseFeesCents;
    stockValue.set(it.category, (stockValue.get(it.category) ?? 0) + it.purchasePriceCents + it.purchaseFeesCents);
  }
  const sellThroughByCategory = [...new Set(items.filter((i) => i.status !== "archived").map((i) => i.category))].map((c) => {
    const soldN = items.filter((i) => i.category === c && i.status === "sold").length;
    const activeN = active.filter((i) => i.category === c).length;
    return { key: c, label: catLabel(c), value: ratio(soldN, soldN + activeN) };
  }).sort((a, b) => b.value - a.value);

  // Objectif mensuel : mois calendaire courant vs mois précédent + 10 %.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const nextStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const revenueBetween = (a: Date, b: Date) => orders.filter((o) => countsAsRevenue(o.status) && inPeriod(o.createdAt, { from: a, to: b })).reduce((s, o) => s + o.salePriceCents, 0);
  const previousMonthCents = revenueBetween(prevStart, monthStart);
  const achievedCents = revenueBetween(monthStart, nextStart);

  const statusCount = new Map<string, number>();
  for (const o of orders.filter((x) => inPeriod(x.createdAt, period))) statusCount.set(o.status, (statusCount.get(o.status) ?? 0) + 1);

  return {
    cumulativeMargin,
    marginRateSeries,
    basketSeries,
    weekday,
    hours,
    categoryMix: [...cat.entries()].map(([k, v]) => ({ key: k, label: catLabel(k), value: v, secondary: ratio(v, totalRevenue) })).sort((a, b) => b.value - a.value),
    brandMargin: [...brandMargin.entries()].map(([k, v]) => ({ key: k, label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8),
    stockAging,
    daysToSell,
    stockValueByCategory: [...stockValue.entries()].map(([k, v]) => ({ key: k, label: catLabel(k), value: v })).sort((a, b) => b.value - a.value),
    priceBands,
    buyVsSell: [...buySell.entries()].map(([k, v]) => ({ key: k, label: catLabel(k), value: Math.round(v.buy / v.n), secondary: Math.round(v.sell / v.n) })).sort((a, b) => b.secondary! - a.secondary!),
    sellThroughByCategory,
    monthlyGoal: { targetCents: Math.max(10_000, Math.round(previousMonthCents * 1.1)), achievedCents, previousMonthCents, daysElapsed: now.getUTCDate(), daysInMonth: Math.round((nextStart.getTime() - monthStart.getTime()) / 86_400_000) },
    orderStatus: [...statusCount.entries()].map(([k, v]) => ({ key: k, label: k, value: v })).sort((a, b) => b.value - a.value),
  };
}
