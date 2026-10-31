import type { BuyerFees, Opportunity, PurchaseRequest } from "@selio/contracts";
import { purchaseCost } from "./buying";

const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";

export interface PurchaseCheckContext {
  opportunity: Opportunity;
  request: Pick<PurchaseRequest, "maxPriceCents" | "budgetCents" | "realPurchaseEnabled" | "confirmedAt">;
  /** Montant déjà engagé aujourd'hui sur les achats. */
  spentTodayCents: number;
  dailyBudgetCents: number;
  /** Une demande déjà exécutée/simulée existe pour cette opportunité. */
  duplicateExists: boolean;
  connectorAllowsPurchase: boolean;
  /** Frais acheteur à inclure dans le coût (protection acheteurs). */
  fees?: BuyerFees | null;
}

export interface PurchaseCheck {
  code: string;
  ok: boolean;
  label: string;
  blocking: boolean;
}

/** Contrôles d'achat assisté : tous doivent passer pour autoriser l'exécution (réelle ou simulée). */
export function runPurchaseChecks(ctx: PurchaseCheckContext): PurchaseCheck[] {
  const cost = purchaseCost(ctx.opportunity.observed, ctx.fees).totalCents;
  const checks: PurchaseCheck[] = [
    { code: "price_within_max", ok: cost <= ctx.request.maxPriceCents, label: `Coût total ${eur(cost)} ≤ prix max ${eur(ctx.request.maxPriceCents)}`, blocking: true },
    { code: "within_request_budget", ok: cost <= ctx.request.budgetCents, label: `Coût ≤ budget de la recherche (${eur(ctx.request.budgetCents)})`, blocking: true },
    { code: "within_daily_budget", ok: ctx.spentTodayCents + cost <= ctx.dailyBudgetCents, label: `Plafond du jour respecté (${eur(ctx.spentTodayCents + cost)} / ${eur(ctx.dailyBudgetCents)})`, blocking: true },
    { code: "no_duplicate", ok: !ctx.duplicateExists, label: "Aucun achat doublon pour cette opportunité", blocking: true },
    { code: "margin_positive", ok: ctx.opportunity.estimate.marginCents > 0, label: "Marge estimée positive", blocking: true },
    { code: "explicit_confirmation", ok: Boolean(ctx.request.confirmedAt), label: "Confirmation explicite de l'utilisateur", blocking: true },
    { code: "connector_authorized", ok: ctx.connectorAllowsPurchase, label: "Connecteur autorisé pour l'achat", blocking: true },
  ];
  return checks;
}

export function purchaseOutcome(checks: PurchaseCheck[], realPurchaseEnabled: boolean): "blocked" | "simulated" | "executed" {
  const blocked = checks.some((c) => c.blocking && !c.ok && c.code !== "connector_authorized");
  if (blocked) return "blocked";
  const connectorOk = checks.find((c) => c.code === "connector_authorized")?.ok ?? false;
  if (!realPurchaseEnabled || !connectorOk) return "simulated";
  return "executed";
}
