import type { BillingCycle, PaidPlan, Subscription } from "@selio/contracts";
import { PRICING } from "@selio/demo-data";

/**
 * Règles d'abonnement partagées par la page Abonnement, la page Factures et le client de
 * démonstration : mêmes calculs que `packages/core/src/services/billing.ts` côté serveur
 * (montant par périodicité, fin de période, jours restants). Aucune donnée de carte ici.
 */

/** Mois offerts par l'annuel (12 mois d'accès, 10 payés). */
export const FREE_MONTHS = 12 - PRICING.annualMonthsCharged;

export const CYCLE_LABELS: Record<BillingCycle, string> = { monthly: "mensuel", yearly: "annuel" };

/** Montant TTC débité pour une offre et une périodicité (centimes, indicatif tant que les tarifs ne sont pas définitifs). */
export function planPriceCents(plan: PaidPlan, cycle: BillingCycle): number {
  const monthly = PRICING.monthlyCents[plan];
  return cycle === "yearly" ? monthly * PRICING.annualMonthsCharged : monthly;
}

/** Ajoute des mois en UTC en gardant le jour quand il existe (31 janvier + 1 mois = 28 ou 29 février). */
export function addMonthsUtc(from: Date, months: number): Date {
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), daysInTarget));
  return target;
}

/** Fin de la période suivante : +1 mois ou +1 an. */
export function addCycle(from: Date, cycle: BillingCycle): Date {
  return addMonthsUtc(from, cycle === "yearly" ? 12 : 1);
}

/** Jours restants jusqu'à une date (arrondis au jour supérieur ; 0 = passée). */
export function daysLeft(iso: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

/** Un abonnement « en cours » : essai, actif ou en retard de paiement (résiliable, offre modifiable). */
export function isRunning(s: Pick<Subscription, "status">): boolean {
  return s.status === "trialing" || s.status === "active" || s.status === "past_due";
}

/** L'essai court encore (statut et date). */
export function inTrial(s: Pick<Subscription, "status" | "currentPeriodEnd">, now = new Date()): boolean {
  return s.status === "trialing" && !!s.currentPeriodEnd && new Date(s.currentPeriodEnd) > now;
}

const longDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

/** « du 1 novembre 2026 au 1 décembre 2026 » (même forme que la facture côté serveur). */
export function periodLabel(startIso: string, endIso: string): string {
  return `du ${longDate.format(new Date(startIso))} au ${longDate.format(new Date(endIso))}`;
}
