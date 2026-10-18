import type { NegotiationAutomation, PriceBand } from "@selio/contracts";

/**
 * Négociation automatique par paliers (Automatisation › Négociation
 * automatique). Chaque tranche de prix a sa marge de négociation (remise
 * maximale) ; chaque contre-offre en accorde une part croissante (ex. 60 %,
 * 75 %, puis 100 % = offre finale). L'IA rédige les messages, ces règles
 * décident du prix.
 */

/** Tranche de prix applicable (la première dont le plafond couvre le prix). */
export function bandFor(priceCents: number, bands: readonly PriceBand[]): PriceBand {
  const sorted = [...bands].sort((a, b) => (a.upToCents ?? Infinity) - (b.upToCents ?? Infinity));
  return sorted.find((b) => b.upToCents === null || priceCents <= b.upToCents) ?? sorted[sorted.length - 1]!;
}

/** Arrondi à 50 centimes inférieurs, comme les prix ronds que l'on propose sur Vinted. */
export function roundOffer(cents: number): number {
  return Math.max(0, Math.floor(cents / 50) * 50);
}

export interface StepPrice {
  /** 1 pour la première contre-offre. */
  step: number;
  /** Part de la marge accordée (0,6 → 60 %). */
  share: number;
  /** Remise sur le prix affiché. */
  discountRate: number;
  priceCents: number;
  final: boolean;
}

/** Prix proposé à chaque palier pour un article affiché à `priceCents`. */
export function stepPrices(priceCents: number, rules: Pick<NegotiationAutomation, "bands" | "steps">): StepPrice[] {
  const margin = bandFor(priceCents, rules.bands).marginRate;
  const shares = [...rules.steps].sort((a, b) => a - b);
  return shares.map((share, i) => {
    const discountRate = margin * share;
    return { step: i + 1, share, discountRate, priceCents: roundOffer(priceCents * (1 - discountRate)), final: i === shares.length - 1 };
  });
}

/** Prix le plus bas accepté : prix affiché moins toute la marge de la tranche. */
export function lowestPrice(priceCents: number, rules: Pick<NegotiationAutomation, "bands">): number {
  return roundOffer(priceCents * (1 - bandFor(priceCents, rules.bands).marginRate));
}

export type JourneyReplyKind = "accept" | "counter" | "final" | "fallback";

export interface JourneyReply {
  kind: JourneyReplyKind;
  /** Prix accepté ou proposé (celui de l'offre pour une acceptation). */
  priceCents: number;
  /** Palier utilisé (0 : acceptation sans contre-offre ou repli). */
  step: number;
}

/**
 * Réponse à une offre d'acheteur. `round` = nombre de contre-offres déjà
 * faites à cet acheteur sur cet article (0 à la première offre).
 * - offre au-dessus du palier courant → acceptée ;
 * - sinon contre-offre au palier courant ; au dernier palier, offre finale ;
 * - offre finale déjà faite et offre toujours trop basse → message de repli.
 */
export function replyToOffer(priceCents: number, offerCents: number, round: number, rules: Pick<NegotiationAutomation, "bands" | "steps">): JourneyReply {
  const steps = stepPrices(priceCents, rules);
  if (round >= steps.length) {
    const floor = steps[steps.length - 1]!.priceCents;
    return offerCents >= floor ? { kind: "accept", priceCents: offerCents, step: 0 } : { kind: "fallback", priceCents: floor, step: 0 };
  }
  const current = steps[round]!;
  if (offerCents >= current.priceCents) return { kind: "accept", priceCents: Math.min(offerCents, priceCents), step: 0 };
  return { kind: current.final ? "final" : "counter", priceCents: current.priceCents, step: current.step };
}

/** Remise de lot : deux articles, ou trois et plus. */
export function lotDiscountRate(count: number, lot: NegotiationAutomation["lot"]): number {
  if (!lot.enabled || count < 2) return 0;
  return count >= 3 ? lot.threePlusRate : lot.twoItemsRate;
}

/** Prix après les baisses automatiques, `days` jours après la mise en ligne (jamais sous le plancher). */
export function droppedPrice(priceCents: number, days: number, drops: NegotiationAutomation["priceDrops"]): number {
  if (!drops.enabled || days < drops.afterDays) return priceCents;
  const times = Math.floor(days / drops.afterDays);
  const floor = Math.round(priceCents * drops.floorRate);
  return Math.max(floor, roundOffer(priceCents * Math.pow(1 - drops.rate, times)));
}

/** Variables des modèles de message : {prenom}, {article}, {prix}, {prix_initial}. */
export function fillTemplate(template: string, vars: { prenom?: string; article?: string; prix?: string; prix_initial?: string }): string {
  return template.replace(/\{(prenom|article|prix_initial|prix)\}/g, (_, k: keyof typeof vars) => vars[k] ?? "");
}

/** Bornes des tranches lisibles (« moins de 10 € », « 10 à 19,99 € », « 50 € et plus »). */
export function bandLabels(bands: readonly PriceBand[], format: (cents: number) => string): string[] {
  const sorted = [...bands].sort((a, b) => (a.upToCents ?? Infinity) - (b.upToCents ?? Infinity));
  return sorted.map((b, i) => {
    const from = i === 0 ? 0 : (sorted[i - 1]!.upToCents ?? 0) + 1;
    if (b.upToCents === null) return `${format(from)} et plus`;
    return i === 0 ? `Jusqu'à ${format(b.upToCents)}` : `${format(from)} à ${format(b.upToCents)}`;
  });
}
