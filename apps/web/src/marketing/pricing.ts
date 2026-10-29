import { PRICING, annualPriceCents, monthlyPriceCents, type PaidPlan, type StudioPack } from "@selio/demo-data";

/**
 * Calculs d'affichage de la page Tarifs. Les montants viennent de PRICING (@selio/demo-data),
 * jamais d'ici : ces fonctions ne font que les combiner. Montants indicatifs, à confirmer.
 */

export interface StudioPricingConfig {
  packs: readonly StudioPack[];
  /** Plancher par photo, en centimes. */
  floorCentsPerPhoto: number;
  /** Minimum par achat, en centimes. */
  minPurchaseCents: number;
}

/** Bornes du curseur « nombre de photos » de Studio seul. */
export const STUDIO_SLIDER = { min: 20, max: 2000, step: 20 } as const;

export interface StudioQuote {
  photos: number;
  /** Prix total indicatif, en centimes. */
  cents: number;
  /** Prix effectif par photo (centimes, décimal), après plancher et minimum. */
  perPhotoCents: number;
  /** Le minimum par achat a relevé le prix. */
  minimumApplied: boolean;
  /** Le plancher par photo a relevé le tarif du pack. */
  floorApplied: boolean;
}

/**
 * Prix brut (avant plancher et minimum) de `n` photos : les packs sont des points de la grille,
 * le prix est interpolé linéairement entre deux packs. Ainsi le total **croît toujours** avec le
 * nombre de photos (jamais « plus de photos pour moins cher » au passage d'un pack), chaque pack
 * retombe exactement sur son prix, et le tarif marginal baisse avec le volume.
 * - sous le premier pack : tarif à la photo du premier pack ;
 * - entre deux packs : prix du pack inférieur + photos supplémentaires au tarif marginal entre les deux ;
 * - au-delà du plus grand pack : son prix + photos supplémentaires à son tarif moyen à la photo.
 */
function rawStudioCents(n: number, packs: readonly StudioPack[]): number {
  const first = packs[0]!;
  const last = packs[packs.length - 1]!;
  if (n <= first.photos) return (n * first.cents) / first.photos;
  if (n >= last.photos) return last.cents + ((n - last.photos) * last.cents) / last.photos;
  const upper = packs.findIndex((p) => p.photos >= n);
  const b = packs[upper]!;
  const a = packs[upper - 1]!;
  return a.cents + ((n - a.photos) * (b.cents - a.cents)) / (b.photos - a.photos);
}

/**
 * Devis Studio seul pour `photos` photos : interpolation entre les packs (monotone, voir
 * `rawStudioCents`), jamais sous le plancher par photo, jamais sous le minimum par achat.
 */
export function studioQuote(photos: number, cfg: StudioPricingConfig = PRICING.subsidiaries.studio): StudioQuote {
  const n = Math.max(0, Math.round(Number.isFinite(photos) ? photos : 0));
  if (n === 0 || cfg.packs.length === 0) return { photos: n, cents: 0, perPhotoCents: 0, minimumApplied: false, floorApplied: false };
  const packs = [...cfg.packs].sort((a, b) => a.photos - b.photos);
  const raw = rawStudioCents(n, packs);
  const floor = n * cfg.floorCentsPerPhoto;
  const floorApplied = raw < floor;
  const floored = Math.round(Math.max(raw, floor));
  const minimumApplied = floored < cfg.minPurchaseCents;
  const cents = Math.max(floored, cfg.minPurchaseCents);
  return { photos: n, cents, perPhotoCents: cents / n, minimumApplied, floorApplied };
}

/** Ce que l'annuel fait économiser par rapport à douze mensualités (centimes). */
export function annualSavingsCents(plan: PaidPlan): number {
  return monthlyPriceCents(plan) * 12 - annualPriceCents(plan);
}

/** Mensualité équivalente de l'annuel (centimes, arrondie). */
export function annualMonthlyEquivalentCents(plan: PaidPlan): number {
  return Math.round(annualPriceCents(plan) / 12);
}
