import { describe, expect, it } from "vitest";
import { ROLES } from "@selio/contracts";
import { FINANCE_FIELDS, isFinanceAuditAction, redactForRole, seesFinances } from "./context";

/** Masquage des finances par rôle (§5.15), fonctions pures. */
describe("redactForRole : finances masquées pour l'exécuteur et le contributeur photos", () => {
  const item = { id: "it-1", title: "Veste en jean", listedPriceCents: 3500, purchasePriceCents: 800, purchaseFeesCents: 150, floorPriceCents: 2800, photos: [{ url: "https://x/1.jpg" }] };
  const order = { id: "o-1", status: "shipped", salePriceCents: 3200, platformFeeCents: 0, shippingCostCents: 250, otherCostsCents: 0, purchasePriceCents: 800, purchaseFeesCents: 150, shipment: { carrier: "Mondial Relay", trackingNumber: "MR123" } };
  const margins = { totals: { revenueCents: 9000, costCents: 3000, marginCents: 6000, marginRate: 0.66 }, rows: [{ itemId: "it-1", title: "Veste", marginCents: 2000, margin: { marginCents: 2000 } }] };

  it("seuls le titulaire, l'administrateur et la lecture seule voient les finances", () => {
    expect(ROLES.filter(seesFinances)).toEqual(["owner", "admin", "viewer"]);
  });

  it("rendu tel quel (même objet) pour qui voit les finances", () => {
    for (const role of ["owner", "admin", "viewer"] as const) {
      expect(redactForRole(role, item)).toBe(item);
      expect(redactForRole(role, [order])[0]).toBe(order);
    }
  });

  it("exécuteur et contributeur photos : prix d'achat, frais, marges et CA à null, à toute profondeur ; le reste intact", () => {
    for (const role of ["operator", "photographer"] as const) {
      const r = redactForRole(role, item);
      expect(r).toEqual({ ...item, purchasePriceCents: null, purchaseFeesCents: null });
      expect(r.listedPriceCents).toBe(3500);
      const [o] = redactForRole(role, [order]);
      expect(o).toEqual({ id: "o-1", status: "shipped", salePriceCents: 3200, platformFeeCents: null, shippingCostCents: null, otherCostsCents: null, purchasePriceCents: null, purchaseFeesCents: null, shipment: { carrier: "Mondial Relay", trackingNumber: "MR123" } });
      expect(redactForRole(role, margins)).toEqual({ totals: { revenueCents: null, costCents: null, marginCents: null, marginRate: null }, rows: [{ itemId: "it-1", title: "Veste", marginCents: null, margin: { marginCents: null } }] });
    }
    // L'objet reçu n'est jamais modifié.
    expect(item.purchasePriceCents).toBe(800);
    expect(order.platformFeeCents).toBe(0);
  });

  it("valeurs simples et absentes inchangées ; liste des champs sans doublon", () => {
    expect(redactForRole("operator", null)).toBeNull();
    expect(redactForRole("operator", 42)).toBe(42);
    expect(redactForRole("operator", "texte")).toBe("texte");
    expect(new Set(FINANCE_FIELDS).size).toBe(FINANCE_FIELDS.length);
    expect(FINANCE_FIELDS).not.toContain("salePriceCents");
    expect(FINANCE_FIELDS).not.toContain("listedPriceCents");
    // Réglages de négociation (minMarginRate…) : pas des finances, jamais masqués.
    const settings = { margin: { minMarginRate: 0.25, minMarginCents: 500, maxDiscountRate: 0.2 } };
    expect(redactForRole("operator", settings)).toEqual(settings);
  });

  it("raisons de négociation réécrites sans marge ; montants de facturation et prix payé Radar masqués", () => {
    const lastOffer = { evaluation: { floorCents: 3000, marginAtOfferCents: 1900, reasons: ["Offre au-dessus du plancher (30,00 €) et remise de 10 % dans la limite autorisée (20 %).", "Marge conservée : 19,00 € (53 %)."] } };
    const r = redactForRole("operator", { lastOffer });
    expect(r.lastOffer.evaluation.floorCents).toBe(3000);
    expect(r.lastOffer.evaluation.marginAtOfferCents).toBeNull();
    expect(r.lastOffer.evaluation.reasons).toEqual(["Offre au-dessus du plancher (30,00 €) et remise de 10 % dans la limite autorisée (20 %)."]);
    expect(redactForRole("owner", { lastOffer }).lastOffer.evaluation.reasons).toHaveLength(2);
    expect(redactForRole("operator", { meta: { amountCents: 2499, planAmountCents: 2499 }, totalCents: 1650, feesCents: 200, targetCents: 10000 })).toEqual({ meta: { amountCents: null, planAmountCents: null }, totalCents: null, feesCents: null, targetCents: null });
  });

  it("journal d'audit : facturation, parrainage et changement d'offre comptent comme finances", () => {
    for (const a of ["billing.payment_completed", "billing.checkout_started", "referral.credit_granted", "admin.plan_changed"]) expect(isFinanceAuditAction(a), a).toBe(true);
    for (const a of ["item.updated", "purchase.confirmed", "member.invited"]) expect(isFinanceAuditAction(a), a).toBe(false);
  });
});
