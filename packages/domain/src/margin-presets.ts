import type { MarginRules } from "@selio/contracts";
import { evaluateOffer, type NegotiationResult } from "./negotiation";
import type { ItemPricing } from "./pricing";
import type { Cents } from "./money";

/**
 * Préréglages de négociation (page « Négociation et marges »). Ils ne fixent que
 * les règles de négociation : les frais vendeur et le port restent ceux de
 * l'organisation, car ce sont des faits et non des choix de stratégie.
 */
export type MarginPresetId = "careful" | "balanced" | "fast";

export type NegotiationRuleKeys = "minMarginRate" | "minMarginCents" | "maxDiscountRate" | "counterStepRate" | "maxRoundsPerCustomer";

export interface MarginPreset {
  id: MarginPresetId;
  label: string;
  summary: string;
  rules: Pick<MarginRules, NegotiationRuleKeys>;
}

export const MARGIN_PRESETS: MarginPreset[] = [
  {
    id: "careful",
    label: "Prudent",
    summary: "Marge protégée, petites remises : pour les pièces recherchées qui partent seules.",
    rules: { minMarginRate: 0.35, minMarginCents: 800, maxDiscountRate: 0.1, counterStepRate: 0.04, maxRoundsPerCustomer: 1 },
  },
  {
    id: "balanced",
    label: "Équilibré",
    summary: "Les réglages par défaut : souple avec les acheteurs, sans brader.",
    rules: { minMarginRate: 0.25, minMarginCents: 500, maxDiscountRate: 0.2, counterStepRate: 0.05, maxRoundsPerCustomer: 2 },
  },
  {
    id: "fast",
    label: "Écouler vite",
    summary: "Remises plus larges et plus de contre-propositions pour faire tourner le stock.",
    rules: { minMarginRate: 0.15, minMarginCents: 200, maxDiscountRate: 0.3, counterStepRate: 0.08, maxRoundsPerCustomer: 3 },
  },
];

const RATE_KEYS = ["minMarginRate", "maxDiscountRate", "counterStepRate"] as const;

/** Applique un préréglage en conservant les frais de l'organisation. */
export function applyMarginPreset(rules: MarginRules, id: MarginPresetId): MarginRules {
  const preset = MARGIN_PRESETS.find((p) => p.id === id);
  return preset ? { ...rules, ...preset.rules } : rules;
}

/** Préréglage correspondant exactement aux règles (taux comparés au dixième de point), ou null (« personnalisé »). */
export function matchMarginPreset(rules: MarginRules): MarginPresetId | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.0005;
  const hit = MARGIN_PRESETS.find((p) =>
    RATE_KEYS.every((k) => same(rules[k], p.rules[k])) &&
    rules.minMarginCents === p.rules.minMarginCents &&
    rules.maxRoundsPerCustomer === p.rules.maxRoundsPerCustomer);
  return hit?.id ?? null;
}

/**
 * Déroulé d'une négociation face à un acheteur qui maintient la même offre :
 * la décision du moteur à chaque tour, jusqu'à l'acceptation ou l'escalade.
 * Sert au simulateur (aucune règle propre : tout vient d'evaluateOffer).
 */
export function negotiationPath(item: ItemPricing, offerCents: Cents, rules: MarginRules, opts: { fromRound?: number; maxSteps?: number } = {}): NegotiationResult[] {
  const steps: NegotiationResult[] = [];
  const from = Math.max(0, opts.fromRound ?? 0);
  for (let round = from; round < from + (opts.maxSteps ?? 10); round++) {
    const r = evaluateOffer({ item, offerCents, rules, roundsSoFar: round });
    steps.push(r);
    if (r.decision !== "counter") break;
  }
  return steps;
}

/**
 * Plus petite offre acceptée d'office par le moteur (à ce tour de négociation),
 * ou null sans prix affiché. L'ensemble des offres acceptées est croissant
 * (au-dessus du prix affiché, ou plancher + marges + remise respectés, ou au
 * moins la contre-proposition du tour) : une recherche par dichotomie suffit.
 */
export function lowestAcceptedOffer(item: ItemPricing, rules: MarginRules, roundsSoFar = 0): Cents | null {
  const listed = item.listedPriceCents;
  if (listed === null || listed <= 0) return null;
  const accepts = (c: Cents) => evaluateOffer({ item, offerCents: c, rules, roundsSoFar }).decision === "accept";
  let lo = 1;
  let hi = listed;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (accepts(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
