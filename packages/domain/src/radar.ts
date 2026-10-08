import type { InventoryItem, ItemCondition, Opportunity, Order, RadarSearch } from "@selio/contracts";
import { computeMargin } from "./pricing";
import { ratio, type Cents } from "./money";

export interface Comparable {
  brand: string | null;
  category: string | null;
  condition: ItemCondition | null;
  salePriceCents: Cents;
}

/** Comparables issus des ventes réelles/démo de l'organisation. */
export function comparablesFromSales(orders: Iterable<Order>, items: Map<string, InventoryItem>): Comparable[] {
  const out: Comparable[] = [];
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "refunded") continue;
    const it = items.get(o.itemId);
    if (!it) continue;
    out.push({ brand: it.brand, category: it.category, condition: it.condition, salePriceCents: o.salePriceCents });
  }
  return out;
}

export interface Estimate {
  resalePriceCents: Cents;
  confidence: "low" | "medium" | "high";
  method: string;
  comparableCount: number;
}

const CONDITION_FACTOR: Record<ItemCondition, number> = {
  new_with_tags: 1.15,
  new_without_tags: 1.05,
  very_good: 1,
  good: 0.9,
  satisfactory: 0.75,
};

/**
 * Estimation de revente : médiane des comparables (marque + catégorie),
 * sinon marque seule, sinon repli sur un multiple prudent du prix observé.
 * L'estimation est toujours annoncée comme telle, jamais comme une donnée observée.
 */
export function estimateResale(observed: { priceCents: Cents; brand: string | null; category: string | null; condition: ItemCondition | null }, comparables: Comparable[]): Estimate {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const sameBrandCat = comparables.filter((c) => norm(c.brand) === norm(observed.brand) && c.category === observed.category && observed.brand);
  const sameBrand = comparables.filter((c) => norm(c.brand) === norm(observed.brand) && observed.brand);
  const factor = observed.condition ? CONDITION_FACTOR[observed.condition] : 0.95;
  const pick = (set: Comparable[], label: string, confidence: Estimate["confidence"]): Estimate => {
    const prices = set.map((c) => c.salePriceCents).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid]! : Math.round((prices[mid - 1]! + prices[mid]!) / 2);
    return { resalePriceCents: Math.round(median * factor), confidence, method: label, comparableCount: set.length };
  };
  if (sameBrandCat.length >= 3) return pick(sameBrandCat, "Médiane des ventes même marque et catégorie, ajustée à l'état", "high");
  if (sameBrand.length >= 2) return pick(sameBrand, "Médiane des ventes de la marque, ajustée à l'état", "medium");
  return {
    resalePriceCents: Math.round(observed.priceCents * 1.6 * factor),
    confidence: "low",
    method: "Aucun comparable : multiple prudent du prix observé (×1,6), ajusté à l'état",
    comparableCount: 0,
  };
}

export interface Scored {
  score: number;
  reasons: string[];
  marginCents: Cents;
  marginRate: number;
}

/** Score 0–100 expliqué : marge vs cible, budget, confiance, fraîcheur. */
export function scoreOpportunity(
  observed: { priceCents: Cents; shippingCents: number; seenAt: string },
  estimate: Estimate,
  search: Pick<RadarSearch, "budgetCents" | "targetMarginCents" | "targetMarginRate">,
  expectedFeesCents: Cents,
  now: Date,
): Scored {
  const cost = observed.priceCents + observed.shippingCents;
  const m = computeMargin({ salePriceCents: estimate.resalePriceCents, platformFeeCents: expectedFeesCents, purchasePriceCents: cost });
  const reasons: string[] = [];
  let score = 0;
  const marginVsTarget = ratio(m.marginCents, Math.max(1, search.targetMarginCents));
  const marginPts = Math.max(0, Math.min(45, Math.round(marginVsTarget * 30)));
  score += marginPts;
  reasons.push(`Marge estimée ${(m.marginCents / 100).toFixed(0)} € vs cible ${(search.targetMarginCents / 100).toFixed(0)} € (+${marginPts}).`);
  const ratePts = m.marginRate >= search.targetMarginRate ? 20 : Math.max(0, Math.round((m.marginRate / search.targetMarginRate) * 20));
  score += ratePts;
  reasons.push(`Taux de marge estimé ${(m.marginRate * 100).toFixed(0)} % vs cible ${(search.targetMarginRate * 100).toFixed(0)} % (+${ratePts}).`);
  if (cost <= search.budgetCents) {
    score += 15;
    reasons.push("Coût total dans le budget de la recherche (+15).");
  } else reasons.push("Coût total au-dessus du budget (0).");
  const confPts = estimate.confidence === "high" ? 15 : estimate.confidence === "medium" ? 8 : 2;
  score += confPts;
  reasons.push(`Confiance de l'estimation : ${estimate.confidence} (${estimate.comparableCount} comparables, +${confPts}).`);
  const ageH = (now.getTime() - new Date(observed.seenAt).getTime()) / 3_600_000;
  const freshPts = ageH < 6 ? 5 : ageH < 48 ? 3 : 0;
  score += freshPts;
  reasons.push(ageH < 6 ? "Annonce récente (+5)." : ageH < 48 ? "Annonce de moins de 48 h (+3)." : "Annonce ancienne (0).");
  if (m.marginCents <= 0) {
    score = Math.min(score, 10);
    reasons.push("Marge estimée nulle ou négative : score plafonné à 10.");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons, marginCents: m.marginCents, marginRate: m.marginRate };
}

export function rankOpportunities(list: Opportunity[]): Opportunity[] {
  return [...list].sort((a, b) => b.score - a.score || b.estimate.marginCents - a.estimate.marginCents);
}
