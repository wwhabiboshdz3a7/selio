import type { MarginRules, Schedule } from "@selio/contracts";
import { applyRate, type Cents } from "./money";
import { checkPrice, type ItemPricing } from "./pricing";
import { isWithinSchedule } from "./time";

export type NegotiationDecision = "accept" | "counter" | "decline" | "escalate" | "hold";

export interface NegotiationContext {
  item: ItemPricing;
  offerCents: Cents;
  rules: MarginRules;
  /** Contre-propositions déjà envoyées à cet acheteur pour cet article. */
  roundsSoFar: number;
  /** Nombre d'actions automatiques déjà faites vers cet acheteur aujourd'hui. */
  actionsTodayForCustomer?: number;
  maxActionsPerCustomerPerDay?: number;
  schedule?: Schedule;
  now?: Date;
  /** L'offre a-t-elle été exprimée dans un message non fiable (toujours vrai côté acheteur). */
  untrusted?: boolean;
}

export interface NegotiationResult {
  decision: NegotiationDecision;
  counterCents: Cents | null;
  reasons: string[];
  /** Validation humaine exigée avant toute action (par défaut : toujours pour accept/decline). */
  requiresApproval: boolean;
  floorCents: Cents;
  marginAtOfferCents: Cents;
  marginRateAtOffer: number;
}

/**
 * Politique de négociation déterministe. L'IA peut proposer un texte, mais
 * c'est cette fonction qui décide accept / contre / refus / escalade.
 */
export function evaluateOffer(ctx: NegotiationContext): NegotiationResult {
  const { item, offerCents, rules } = ctx;
  const reasons: string[] = [];
  const listed = item.listedPriceCents;
  const check = checkPrice(item, offerCents, rules);
  const floorCents = check.floorCents;
  const base = {
    floorCents,
    marginAtOfferCents: check.marginCents,
    marginRateAtOffer: check.marginRate,
  };

  if (offerCents <= 0) {
    return { ...base, decision: "decline", counterCents: null, requiresApproval: true, reasons: ["Offre nulle ou invalide."] };
  }

  if (ctx.schedule && !isWithinSchedule(ctx.schedule, ctx.now ?? new Date())) {
    reasons.push("Hors de la plage horaire autorisée : réponse différée.");
    return { ...base, decision: "hold", counterCents: null, requiresApproval: false, reasons };
  }

  if (
    typeof ctx.actionsTodayForCustomer === "number" &&
    typeof ctx.maxActionsPerCustomerPerDay === "number" &&
    ctx.actionsTodayForCustomer >= ctx.maxActionsPerCustomerPerDay
  ) {
    reasons.push("Limite d'actions par acheteur atteinte aujourd'hui : escalade à un humain.");
    return { ...base, decision: "escalate", counterCents: null, requiresApproval: true, reasons };
  }

  if (listed === null) {
    reasons.push("Aucun prix affiché : impossible de négocier automatiquement.");
    return { ...base, decision: "escalate", counterCents: null, requiresApproval: true, reasons };
  }

  if (offerCents >= listed) {
    reasons.push(`Offre (${offerCents}) ≥ prix affiché (${listed}).`);
    return { ...base, decision: "accept", counterCents: null, requiresApproval: false, reasons };
  }

  const discountRate = (listed - offerCents) / listed;
  const maxDiscountCents = listed - applyRate(listed, rules.maxDiscountRate);

  if (check.ok && discountRate <= rules.maxDiscountRate) {
    reasons.push(`Offre au-dessus du plancher (${floorCents}) et remise ${(discountRate * 100).toFixed(0)} % ≤ ${(rules.maxDiscountRate * 100).toFixed(0)} % autorisés.`);
    reasons.push(`Marge conservée : ${check.marginCents} c (${(check.marginRate * 100).toFixed(0)} %).`);
    return { ...base, decision: "accept", counterCents: null, requiresApproval: false, reasons };
  }

  if (!check.ok) {
    const label =
      check.reason === "below_floor"
        ? `Offre sous le prix plancher (${floorCents}).`
        : check.reason === "below_min_margin"
          ? `Marge absolue insuffisante (${check.marginCents} c < ${rules.minMarginCents} c).`
          : check.reason === "below_min_rate"
            ? `Taux de marge insuffisant (${(check.marginRate * 100).toFixed(0)} % < ${(rules.minMarginRate * 100).toFixed(0)} %).`
            : "Aucun prix.";
    reasons.push(label);
  } else {
    reasons.push(`Remise demandée ${(discountRate * 100).toFixed(0)} % > ${(rules.maxDiscountRate * 100).toFixed(0)} % autorisés.`);
  }

  if (ctx.roundsSoFar >= rules.maxRoundsPerCustomer) {
    reasons.push(`Nombre maximal de contre-propositions atteint (${rules.maxRoundsPerCustomer}).`);
    return { ...base, decision: "escalate", counterCents: null, requiresApproval: true, reasons };
  }

  // Contre-proposition : on descend d'un pas depuis le prix affiché, sans
  // passer sous le plancher ni sous la remise max autorisée.
  const step = applyRate(listed, rules.counterStepRate) * (ctx.roundsSoFar + 1);
  const counter = Math.max(floorCents, Math.max(maxDiscountCents, listed - step));
  if (counter <= offerCents) {
    reasons.push("La contre-proposition calculée ne dépasse pas l'offre : acceptation au prix minimal.");
    const acceptCents = Math.max(offerCents, floorCents);
    if (acceptCents > offerCents) {
      return { ...base, decision: "counter", counterCents: acceptCents, requiresApproval: false, reasons };
    }
    return { ...base, decision: "accept", counterCents: null, requiresApproval: false, reasons };
  }
  reasons.push(`Contre-proposition à ${counter} c (plancher ${floorCents} c, remise max ${maxDiscountCents} c).`);
  return { ...base, decision: "counter", counterCents: counter, requiresApproval: false, reasons };
}

/** Détecte une offre de prix dans un message acheteur (données non fiables : extraction seulement). */
export function extractOfferCents(text: string): Cents | null {
  const normalized = text.replace(/ | /g, " ");
  const re = /(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b|eur\b)/i;
  const m = normalized.match(re);
  if (!m) return null;
  const value = Number.parseFloat(m[1]!.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
