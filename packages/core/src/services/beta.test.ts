import { describe, expect, it } from "vitest";
import { BETA_INVOICE_LINE_LABEL, quotasForPlan, type Invoice, type Subscription } from "@selio/contracts";
import type { repos } from "@selio/db";
import { computeBetaStatus, emailDeliverable } from "./beta";
import { invoiceView } from "./billing";

const start = "2026-11-30T09:00:00.000Z";
const end = "2026-12-30T09:00:00.000Z";
const access: repos.BetaAccessRecord = { orgId: "o1", offerId: "of1", code: "BETA2026SELIO", plan: "pro", days: 30, startedAt: start, invoiceId: "i1", welcomeSeenAt: null, reminder7For: null, reminder1For: null, endedAt: null, createdAt: start, updatedAt: start };
const sub = (patch: Partial<Subscription> = {}): Subscription => ({
  id: "s1", orgId: "o1", plan: "pro", status: "trialing", provider: "none", externalRef: null, currentPeriodEnd: end, quotas: quotasForPlan("pro"), cardOnFile: false, cancelAtPeriodEnd: false, testMode: true,
  revolutCustomerId: null, paymentMethodId: null, cycle: "monthly", pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, dataRetentionUntil: null, grantedUntil: null, simulatedCheckoutAt: null, awaitingPaymentSince: null,
  createdAt: start, updatedAt: start, ...patch,
});
const at = (days: number) => new Date(new Date(start).getTime() + days * 86_400_000);

describe("état de l'accès bêta (fonction pure)", () => {
  it("en cours : jours restants, aucun rappel avant J-7, écran de bienvenue à voir", () => {
    expect(computeBetaStatus(access, sub(), at(0), { simulated: true, invoiceNumber: "SEL-2026-000001" })).toEqual({
      code: "BETA2026SELIO", plan: "pro", startedAt: start, endsAt: end, state: "running", blocked: false, blockedSince: null, daysLeft: 30, reminder: null, paymentReady: false, welcomeSeen: false, invoiceNumber: "SEL-2026-000001",
    });
  });

  it("rappels J-7 et J-1, sauf si un moyen de paiement est prêt", () => {
    expect(computeBetaStatus(access, sub(), at(23.5), { simulated: true }).reminder).toBe(7);
    expect(computeBetaStatus(access, sub(), at(29.5), { simulated: true }).reminder).toBe(1);
    expect(computeBetaStatus(access, sub({ simulatedCheckoutAt: start }), at(29.5), { simulated: true })).toMatchObject({ reminder: null, paymentReady: true });
    // Forfait retenu en simulé : ne compte pas comme une carte quand Revolut est configuré.
    expect(computeBetaStatus(access, sub({ simulatedCheckoutAt: start }), at(29.5), { simulated: false })).toMatchObject({ reminder: 1, paymentReady: false });
    expect(computeBetaStatus(access, sub({ cardOnFile: true }), at(29.5), { simulated: false })).toMatchObject({ reminder: null, paymentReady: true });
  });

  it("bloqué seulement si le mois est fini ET l'abonnement attend un paiement", () => {
    const ended = { ...access, endedAt: end };
    const waiting = sub({ status: "canceled", plan: "free", awaitingPaymentSince: end });
    expect(computeBetaStatus(ended, waiting, at(31), { simulated: true })).toMatchObject({ state: "ended", blocked: true, blockedSince: end, endsAt: null, daysLeft: null, reminder: null });
    // Prolongation (essai rouvert) ou accès offert : débloqué sans toucher à l'accès bêta.
    expect(computeBetaStatus(ended, sub({ currentPeriodEnd: at(38).toISOString() }), at(31), { simulated: true })).toMatchObject({ state: "running", blocked: false, daysLeft: 7 });
    expect(computeBetaStatus(ended, sub({ status: "active", grantedUntil: at(45).toISOString(), currentPeriodEnd: at(45).toISOString() }), at(31), { simulated: true })).toMatchObject({ state: "running", blocked: false, paymentReady: true, daysLeft: 14 });
    // Paiement réel : actif, plus de bêta en cours.
    expect(computeBetaStatus(ended, sub({ status: "active", provider: "revolut", awaitingPaymentSince: null }), at(31), { simulated: false })).toMatchObject({ state: "converted", blocked: false });
    // Forfait retenu sur la page de paiement (accès bêta débloqué : endedAt effacé), en attente du paiement.
    expect(computeBetaStatus(access, waiting, at(31), { simulated: true })).toMatchObject({ state: "converted", blocked: false });
  });

  it("emails : seulement avec un fournisseur qui envoie réellement", () => {
    expect(emailDeliverable({})).toBe(false);
    expect(emailDeliverable({ email: { delivers: false, send: async () => ({ id: "x" }) } })).toBe(false);
    expect(emailDeliverable({ email: { send: async () => ({ id: "x" }) } })).toBe(true);
  });
});

describe("facture à 0 € de l'ouverture", () => {
  it("ligne d'abonnement au prix du mois, puis « Selio — accès bêta, 1 mois offert » du même montant : total 0,00 €", () => {
    const invoice: Invoice = { id: "i1", orgId: "o1", number: "SEL-2026-000042", plan: "pro", cycle: "monthly", amountCents: 0, vatRate: 20, vatNotice: null, periodStart: start, periodEnd: end, orderId: null, extraLines: [{ kind: "discount", product: "beta_access", label: BETA_INVOICE_LINE_LABEL, quantity: 1, unitCents: 2499, amountCents: 2499 }], issuedAt: start, createdAt: start };
    const view = invoiceView(invoice, { orgName: "Boutique", email: "a@b.fr" });
    expect(view.lines.map((l) => [l.label, l.amountCents])).toEqual([["Abonnement Selio Pro — mensuel", 2499], [BETA_INVOICE_LINE_LABEL, -2499]]);
    expect(view.totals).toMatchObject({ inclVatCents: 0, exclVatCents: 0, vatCents: 0 });
    expect(view.paymentProvider).toBeNull();
  });
});
