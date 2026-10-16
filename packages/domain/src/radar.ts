import type { BuyerFees, InventoryItem, ItemCondition, Opportunity, Order, RadarSearch } from "@selio/contracts";
import { computeMargin } from "./pricing";
import { purchaseCost } from "./buying";
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

/** Comparables issus des ventes observées sur le marché (radar, extension, simulateur). */
export function comparablesFromMarket(observations: Iterable<{ status: string; brand: string | null; category: string | null; priceCents: Cents }>): Comparable[] {
  const out: Comparable[] = [];
  for (const o of observations) if (o.status === "sold") out.push({ brand: o.brand, category: o.category, condition: null, salePriceCents: o.priceCents });
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

export interface ScorePart {
  key: "margin" | "margin_rate" | "condition_photos" | "brand_demand" | "seller" | "shipping_freshness";
  label: string;
  points: number;
  max: number;
}

export interface Scored {
  score: number;
  reasons: string[];
  breakdown: ScorePart[];
  marginCents: Cents;
  marginRate: number;
  /** Coût total d'achat retenu (prix + port + frais acheteur si fournis). */
  costCents: Cents;
}

/** Informations complémentaires observées sur l'annonce (toutes facultatives). */
export interface OpportunitySignals {
  condition?: ItemCondition | null;
  photoCount?: number | null;
  sellerRating?: number | null;
  sellerReviews?: number | null;
  /** Frais acheteur (protection) à ajouter au coût. */
  fees?: BuyerFees | null;
}

const CONDITION_POINTS: Record<ItemCondition, number> = { new_with_tags: 10, new_without_tags: 9, very_good: 8, good: 6, satisfactory: 3 };

/**
 * Note sur 100, expliquée critère par critère :
 * - marge estimée (port et frais acheteur inclus) vs marge cible : 40 pts ;
 * - taux de marge vs taux cible : 15 pts ;
 * - état et qualité des photos : 15 pts ;
 * - marque et demande (ventes comparables) : 15 pts ;
 * - fiabilité du vendeur (note, nombre d'avis) : 10 pts ;
 * - port et fraîcheur de l'annonce : 5 pts.
 * Hors budget : plafonnée à 59 (« affaire faible »). Marge nulle ou négative : plafonnée à 10.
 */
export function scoreOpportunity(
  observed: { priceCents: Cents; shippingCents: number; seenAt: string },
  estimate: Estimate,
  search: Pick<RadarSearch, "budgetCents" | "targetMarginCents" | "targetMarginRate">,
  expectedFeesCents: Cents,
  now: Date,
  signals: OpportunitySignals = {},
): Scored {
  const cost = purchaseCost(observed, signals.fees).totalCents;
  const m = computeMargin({ salePriceCents: estimate.resalePriceCents, platformFeeCents: expectedFeesCents, purchasePriceCents: cost });
  const reasons: string[] = [];
  const breakdown: ScorePart[] = [];
  const add = (part: ScorePart, reason: string) => {
    breakdown.push(part);
    reasons.push(reason);
  };
  const eur = (c: number) => `${(c / 100).toFixed(0)} €`;

  const marginVsTarget = ratio(m.marginCents, Math.max(1, search.targetMarginCents));
  const marginPts = Math.max(0, Math.min(40, Math.round(marginVsTarget * 30)));
  add({ key: "margin", label: "Marge estimée", points: marginPts, max: 40 }, `Marge estimée ${eur(m.marginCents)} (achat ${eur(cost)} tout compris) vs cible ${eur(search.targetMarginCents)} : +${marginPts}/40.`);

  const ratePts = m.marginRate >= search.targetMarginRate ? 15 : Math.max(0, Math.round((m.marginRate / Math.max(0.01, search.targetMarginRate)) * 15));
  add({ key: "margin_rate", label: "Taux de marge", points: ratePts, max: 15 }, `Taux de marge ${(m.marginRate * 100).toFixed(0)} % vs cible ${(search.targetMarginRate * 100).toFixed(0)} % : +${ratePts}/15.`);

  const condPts = signals.condition ? CONDITION_POINTS[signals.condition] : 5;
  const photos = signals.photoCount ?? null;
  const photoPts = photos === null ? 2 : photos >= 5 ? 5 : photos >= 3 ? 3 : photos >= 1 ? 1 : 0;
  add({ key: "condition_photos", label: "État et photos", points: condPts + photoPts, max: 15 }, `État ${signals.condition ? "déclaré" : "non précisé"} (+${condPts}) et ${photos === null ? "photos non comptées" : `${photos} photo(s)`} (+${photoPts}) : +${condPts + photoPts}/15.`);

  const demandPts = estimate.confidence === "high" ? 15 : estimate.confidence === "medium" ? 10 : 4;
  add({ key: "brand_demand", label: "Marque et demande", points: demandPts, max: 15 }, `Demande prouvée par ${estimate.comparableCount} vente(s) comparable(s), confiance ${estimate.confidence} : +${demandPts}/15.`);

  const rating = signals.sellerRating ?? null;
  const reviews = signals.sellerReviews ?? 0;
  const sellerPts = rating === null ? 5 : rating >= 4.8 && reviews >= 20 ? 10 : rating >= 4.5 ? 8 : rating >= 4 ? 5 : 2;
  add({ key: "seller", label: "Fiabilité du vendeur", points: sellerPts, max: 10 }, rating === null ? "Vendeur sans note visible : +5/10." : `Vendeur noté ${rating.toFixed(1)}/5 (${reviews} avis) : +${sellerPts}/10.`);

  const ageH = (now.getTime() - new Date(observed.seenAt).getTime()) / 3_600_000;
  const freshPts = ageH < 6 ? 3 : ageH < 48 ? 2 : 0;
  const shipPts = observed.shippingCents <= 500 ? 2 : observed.shippingCents <= 800 ? 1 : 0;
  add({ key: "shipping_freshness", label: "Port et délai", points: freshPts + shipPts, max: 5 }, `${ageH < 6 ? "Annonce de moins de 6 h" : ageH < 48 ? "Annonce de moins de 48 h" : "Annonce ancienne"}, port ${eur(observed.shippingCents)} : +${freshPts + shipPts}/5.`);

  let score = breakdown.reduce((s, p) => s + p.points, 0);
  if (cost > search.budgetCents) {
    score = Math.min(score, 59);
    reasons.push(`Coût total ${eur(cost)} au-dessus du budget ${eur(search.budgetCents)} : note plafonnée à 59.`);
  }
  if (m.marginCents <= 0) {
    score = Math.min(score, 10);
    reasons.push("Marge estimée nulle ou négative : note plafonnée à 10.");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons, breakdown, marginCents: m.marginCents, marginRate: m.marginRate, costCents: cost };
}

export function rankOpportunities(list: Opportunity[]): Opportunity[] {
  return [...list].sort((a, b) => b.score - a.score || b.estimate.marginCents - a.estimate.marginCents);
}
