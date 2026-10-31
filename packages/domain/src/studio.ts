import type { ItemCategory, ListingGenerationOutput } from "@selio/contracts";
import { estimateResale, type Comparable } from "./radar";

/** Prix de départ par catégorie quand le prix d'achat n'est pas indiqué (estimation prudente). */
const CATEGORY_BASE_CENTS: Record<ItemCategory, number> = { shoes: 2500, bags: 3000, men: 1800, women: 1800, kids: 800, accessories: 1500, home: 1200, electronics: 2500, other: 1200 };

export interface DraftPricing {
  suggestedPriceCents: number;
  priceLowCents: number;
  priceHighCents: number;
  priceMethod: string;
  comparableCount: number;
  lowConfidence: boolean;
}

/**
 * Prix conseillé d'une annonce générée : médiane des ventes comparables
 * (marque + catégorie), ajustée à l'état. L'IA ne fixe jamais le prix.
 */
export function priceListingDraft(data: Pick<ListingGenerationOutput, "brand" | "category" | "condition">, comps: Comparable[], purchasePriceCents: number | null): DraftPricing {
  const base = purchasePriceCents && purchasePriceCents > 0 ? purchasePriceCents : CATEGORY_BASE_CENTS[data.category];
  const est = estimateResale({ priceCents: base, brand: data.brand, category: data.category, condition: data.condition }, comps);
  const suggested = Math.max(100, Math.round(est.resalePriceCents / 100) * 100);
  return {
    suggestedPriceCents: suggested,
    priceLowCents: Math.round((suggested * 0.85) / 50) * 50,
    priceHighCents: Math.round((suggested * 1.15) / 50) * 50,
    priceMethod: est.method,
    comparableCount: est.comparableCount,
    lowConfidence: est.confidence === "low",
  };
}
