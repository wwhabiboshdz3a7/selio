import type { Opportunity, PurchaseRequest } from "@selio/contracts";

export interface PurchaseCheckContext {
  opportunity: Opportunity;
  request: Pick<PurchaseRequest, "maxPriceCents" | "budgetCents" | "realPurchaseEnabled" | "confirmedAt">;
  /** Montant déjà engagé aujourd'hui sur les achats. */
  spentTodayCents: number;
  dailyBudgetCents: number;
  /** Une demande déjà exécutée/simulée existe pour cette opportunité. */
  duplicateExists: boolean;
  connectorAllowsPurchase: boolean;
}

export interface PurchaseCheck {
  code: string;
  ok: boolean;
  label: string;
  blocking: boolean;
}

/** Contrôles d'achat assisté : tous doivent passer pour autoriser l'exécution (réelle ou simulée). */
export function runPurchaseChecks(ctx: PurchaseCheckContext): PurchaseCheck[] {
  const cost = ctx.opportunity.observed.priceCents + ctx.opportunity.observed.shippingCents;
  const checks: PurchaseCheck[] = [
    { code: "price_within_max", ok: cost <= ctx.request.maxPriceCents, label: `Coût ${cost} c ≤ prix max ${ctx.request.maxPriceCents} c`, blocking: true },
    { code: "within_request_budget", ok: cost <= ctx.request.budgetCents, label: `Coût ≤ budget de la demande (${ctx.request.budgetCents} c)`, blocking: true },
    { code: "within_daily_budget", ok: ctx.spentTodayCents + cost <= ctx.dailyBudgetCents, label: `Budget journalier respecté (${ctx.spentTodayCents + cost} / ${ctx.dailyBudgetCents} c)`, blocking: true },
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
