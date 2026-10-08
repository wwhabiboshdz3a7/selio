import type { MarginRules } from "@selio/contracts";
import { applyRate, assertCents, ratio, type Cents } from "./money";

/**
 * Conventions financières (voir docs/ARCHITECTURE.md § Calculs) :
 * - Chiffre d'affaires (CA) = somme des prix de vente des commandes non annulées/remboursées.
 * - Coût d'acquisition = prix d'achat + frais d'acquisition.
 * - Marge brute = prix de vente − frais plateforme vendeur − port à charge vendeur − autres coûts − coût d'acquisition.
 * - Taux de marge = marge brute / prix de vente.
 * Il s'agit d'une marge brute opérationnelle, pas d'un bénéfice net comptable
 * (ni impôts, ni cotisations, ni amortissement du matériel).
 */

export interface SaleCosts {
  salePriceCents: Cents;
  platformFeeCents?: Cents;
  shippingCostCents?: Cents;
  otherCostsCents?: Cents;
  purchasePriceCents?: Cents;
  purchaseFeesCents?: Cents;
}

export interface MarginBreakdown {
  salePriceCents: Cents;
  acquisitionCents: Cents;
  feesCents: Cents;
  marginCents: Cents;
  marginRate: number;
}

export function acquisitionCost(purchasePriceCents: Cents = 0, purchaseFeesCents: Cents = 0): Cents {
  return assertCents(purchasePriceCents) + assertCents(purchaseFeesCents);
}

export function computeMargin(sale: SaleCosts): MarginBreakdown {
  const salePriceCents = assertCents(sale.salePriceCents);
  const feesCents = (sale.platformFeeCents ?? 0) + (sale.shippingCostCents ?? 0) + (sale.otherCostsCents ?? 0);
  const acquisitionCents = acquisitionCost(sale.purchasePriceCents ?? 0, sale.purchaseFeesCents ?? 0);
  const marginCents = salePriceCents - feesCents - acquisitionCents;
  return { salePriceCents, acquisitionCents, feesCents, marginCents, marginRate: ratio(marginCents, salePriceCents) };
}

export interface ItemPricing {
  purchasePriceCents: Cents;
  purchaseFeesCents: Cents;
  listedPriceCents: Cents | null;
  floorPriceCents: Cents | null;
}

/**
 * Prix plancher recommandé : le plus grand entre
 * (acquisition + frais attendus + marge mini absolue) et
 * (acquisition + frais attendus) / (1 − taux de marge mini).
 */
export function suggestFloorPrice(item: Pick<ItemPricing, "purchasePriceCents" | "purchaseFeesCents">, rules: MarginRules): Cents {
  const acq = acquisitionCost(item.purchasePriceCents, item.purchaseFeesCents);
  const fixedFees = rules.defaultShippingCostCents;
  const byAbs = acq + fixedFees + rules.minMarginCents;
  const denominator = 1 - rules.minMarginRate - rules.defaultPlatformFeeRate;
  const byRate = denominator <= 0 ? Number.MAX_SAFE_INTEGER : Math.ceil((acq + fixedFees) / denominator);
  return Math.max(byAbs, byRate);
}

/** Marge projetée si l'article part au prix affiché, avec les frais par défaut de l'organisation. */
export function projectedMargin(item: ItemPricing, rules: MarginRules, priceCents: Cents | null = item.listedPriceCents): MarginBreakdown | null {
  if (priceCents === null) return null;
  return computeMargin({
    salePriceCents: priceCents,
    platformFeeCents: applyRate(priceCents, rules.defaultPlatformFeeRate),
    shippingCostCents: rules.defaultShippingCostCents,
    purchasePriceCents: item.purchasePriceCents,
    purchaseFeesCents: item.purchaseFeesCents,
  });
}

export type PriceCheck =
  | { ok: true; marginCents: Cents; marginRate: number; floorCents: Cents }
  | { ok: false; reason: "below_floor" | "below_min_margin" | "below_min_rate" | "no_price"; marginCents: Cents; marginRate: number; floorCents: Cents };

/** Vérifie qu'un prix proposé respecte plancher et marges minimales. */
export function checkPrice(item: ItemPricing, priceCents: Cents | null, rules: MarginRules): PriceCheck {
  const floorCents = item.floorPriceCents ?? suggestFloorPrice(item, rules);
  if (priceCents === null) return { ok: false, reason: "no_price", marginCents: 0, marginRate: 0, floorCents };
  const m = projectedMargin(item, rules, priceCents)!;
  if (priceCents < floorCents) return { ok: false, reason: "below_floor", marginCents: m.marginCents, marginRate: m.marginRate, floorCents };
  if (m.marginCents < rules.minMarginCents) return { ok: false, reason: "below_min_margin", marginCents: m.marginCents, marginRate: m.marginRate, floorCents };
  if (m.marginRate < rules.minMarginRate) return { ok: false, reason: "below_min_rate", marginCents: m.marginCents, marginRate: m.marginRate, floorCents };
  return { ok: true, marginCents: m.marginCents, marginRate: m.marginRate, floorCents };
}

export const PRICE_CHECK_LABELS: Record<Exclude<PriceCheck, { ok: true }>["reason"], string> = {
  below_floor: "Sous le prix plancher",
  below_min_margin: "Marge absolue insuffisante",
  below_min_rate: "Taux de marge insuffisant",
  no_price: "Aucun prix défini",
};
