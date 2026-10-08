import type { InventoryItem, Order } from "@selio/contracts";
import { countsAsRevenue, orderMargin } from "./orders";
import { daysInStock } from "./inventory";
import { ratio, type Cents } from "./money";

export interface Period {
  from: Date;
  to: Date;
}

export interface SalesKpis {
  revenueCents: Cents;
  marginCents: Cents;
  marginRate: number;
  orderCount: number;
  averageBasketCents: Cents;
  feesCents: Cents;
  acquisitionCents: Cents;
}

export const EMPTY_KPIS: SalesKpis = { revenueCents: 0, marginCents: 0, marginRate: 0, orderCount: 0, averageBasketCents: 0, feesCents: 0, acquisitionCents: 0 };

function inPeriod(iso: string, period: Period): boolean {
  const t = new Date(iso).getTime();
  return t >= period.from.getTime() && t < period.to.getTime();
}

/** Les commandes sont datées par leur création (date de vente). */
export function salesKpis(orders: Iterable<Order>, period?: Period): SalesKpis {
  let revenue = 0, margin = 0, fees = 0, acq = 0, count = 0;
  for (const o of orders) {
    if (!countsAsRevenue(o.status)) continue;
    if (period && !inPeriod(o.createdAt, period)) continue;
    const m = orderMargin(o);
    revenue += m.salePriceCents;
    margin += m.marginCents;
    fees += m.feesCents;
    acq += m.acquisitionCents;
    count++;
  }
  return {
    revenueCents: revenue,
    marginCents: margin,
    marginRate: ratio(margin, revenue),
    orderCount: count,
    averageBasketCents: count === 0 ? 0 : Math.round(revenue / count),
    feesCents: fees,
    acquisitionCents: acq,
  };
}

export interface StockKpis {
  activeCount: number;
  listedCount: number;
  stockValueCents: Cents;
  listedValueCents: Cents;
  /** Jours moyens en stock des articles vendus sur la période (rotation). */
  averageDaysToSell: number | null;
  /** Taux d'écoulement : vendus / (vendus + actifs) sur la période. */
  sellThroughRate: number;
  staleCount: number;
}

export function stockKpis(items: Iterable<InventoryItem>, now: Date, opts: { staleAfterDays?: number; period?: Period } = {}): StockKpis {
  const staleAfter = opts.staleAfterDays ?? 45;
  let active = 0, listed = 0, stockValue = 0, listedValue = 0, stale = 0, soldCount = 0, soldDays = 0;
  for (const it of items) {
    if (it.status === "sold") {
      if (opts.period && it.soldAt && !inPeriod(it.soldAt, opts.period)) continue;
      soldCount++;
      soldDays += daysInStock(it, now);
      continue;
    }
    if (it.status === "archived") continue;
    active++;
    stockValue += it.purchasePriceCents + it.purchaseFeesCents;
    if (it.status === "listed" || it.status === "reserved") {
      listed++;
      listedValue += it.listedPriceCents ?? 0;
    }
    if (daysInStock(it, now) > staleAfter) stale++;
  }
  return {
    activeCount: active,
    listedCount: listed,
    stockValueCents: stockValue,
    listedValueCents: listedValue,
    averageDaysToSell: soldCount === 0 ? null : Math.round(soldDays / soldCount),
    sellThroughRate: ratio(soldCount, soldCount + active),
    staleCount: stale,
  };
}

export interface SeriesPoint {
  key: string;
  label: string;
  revenueCents: Cents;
  marginCents: Cents;
  orderCount: number;
}

/** Série temporelle par jour, semaine ou mois (clés ISO, libellés fr). */
export function salesSeries(orders: Iterable<Order>, period: Period, granularity: "day" | "week" | "month"): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>();
  const cursor = new Date(period.from);
  const keyOf = (d: Date) => {
    if (granularity === "month") return d.toISOString().slice(0, 7);
    if (granularity === "week") {
      const w = new Date(d);
      const day = (w.getUTCDay() + 6) % 7;
      w.setUTCDate(w.getUTCDate() - day);
      return w.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 10);
  };
  const labelOf = (key: string) => {
    if (granularity === "month") {
      const [y, m] = key.split("-");
      return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });
    }
    return new Date(key).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  while (cursor < period.to) {
    const k = keyOf(cursor);
    if (!buckets.has(k)) buckets.set(k, { key: k, label: labelOf(k), revenueCents: 0, marginCents: 0, orderCount: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const o of orders) {
    if (!countsAsRevenue(o.status) || !inPeriod(o.createdAt, period)) continue;
    const k = keyOf(new Date(o.createdAt));
    const b = buckets.get(k);
    if (!b) continue;
    const m = orderMargin(o);
    b.revenueCents += m.salePriceCents;
    b.marginCents += m.marginCents;
    b.orderCount++;
  }
  return [...buckets.values()];
}

export interface BreakdownRow {
  key: string;
  revenueCents: Cents;
  marginCents: Cents;
  orderCount: number;
  marginRate: number;
}

export function breakdownBy(orders: Iterable<Order>, keyFn: (o: Order) => string, period?: Period): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const o of orders) {
    if (!countsAsRevenue(o.status)) continue;
    if (period && !inPeriod(o.createdAt, period)) continue;
    const k = keyFn(o);
    const row = map.get(k) ?? { key: k, revenueCents: 0, marginCents: 0, orderCount: 0, marginRate: 0 };
    const m = orderMargin(o);
    row.revenueCents += m.salePriceCents;
    row.marginCents += m.marginCents;
    row.orderCount++;
    map.set(k, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, marginRate: ratio(r.marginCents, r.revenueCents) }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export type PeriodPreset = "7d" | "30d" | "90d" | "12m" | "ytd" | "all";

export function periodFromPreset(preset: PeriodPreset, now: Date): Period {
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  switch (preset) {
    case "7d": from.setUTCDate(from.getUTCDate() - 6); break;
    case "30d": from.setUTCDate(from.getUTCDate() - 29); break;
    case "90d": from.setUTCDate(from.getUTCDate() - 89); break;
    case "12m": from.setUTCMonth(from.getUTCMonth() - 12); from.setUTCDate(1); break;
    case "ytd": from.setUTCMonth(0, 1); break;
    case "all": from.setUTCFullYear(2000, 0, 1); break;
  }
  return { from, to };
}

export function previousPeriod(period: Period): Period {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: new Date(period.from.getTime()) };
}

/** Variation relative (null si la base est nulle). */
export function deltaRate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
