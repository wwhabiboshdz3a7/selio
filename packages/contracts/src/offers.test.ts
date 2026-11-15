import { describe, expect, it } from "vitest";
import { extraLinesTotal, invoiceAmounts } from "./billing";
import {
  discountedPriceCents, normalizeOfferCode, offerAvailability, offerBannerText, offerDiscountCents, offerDiscountLabel, offerInput, offerInvoiceLineLabel, offerPlansLabel, offerUpdate, redemptionDiscountFor,
  type CommercialOffer,
} from "./offers";

const offer = (o: Partial<CommercialOffer> = {}): CommercialOffer => ({
  id: "o1", name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: 3, startsAt: null, endsAt: null, maxRedemptions: null, redemptions: 0,
  bannerEnabled: true, bannerText: null, active: true, createdBy: "u1", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", archivedAt: null, ...o,
});
const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("offres commerciales : calcul de la remise", () => {
  it("pourcentage arrondi au centime, montant fixe, jamais au-delà du prix", () => {
    expect(offerDiscountCents(2499, { discountPercent: 20, discountCents: null })).toBe(500);
    expect(discountedPriceCents(2499, { discountPercent: 20, discountCents: null })).toBe(1999);
    expect(offerDiscountCents(699, { discountPercent: null, discountCents: 500 })).toBe(500);
    // Remise supérieure au prix : l'échéance tombe à 0, jamais en négatif.
    expect(offerDiscountCents(699, { discountPercent: null, discountCents: 1000 })).toBe(699);
    expect(discountedPriceCents(699, { discountPercent: null, discountCents: 1000 })).toBe(0);
    // 100 % : facture à 0 €.
    expect(discountedPriceCents(4999, { discountPercent: 100, discountCents: null })).toBe(0);
    expect(offerDiscountCents(0, { discountPercent: 50, discountCents: null })).toBe(0);
  });

  it("instantané d'une organisation : forfait non concerné, mois épuisés, cycle annuel (une fois, 12 mois consommés)", () => {
    const r = { discountPercent: 20, discountCents: null, plans: ["pro" as const], monthsRemaining: 3 };
    expect(redemptionDiscountFor(r, "pro", "monthly", 2499)).toEqual({ discountCents: 500, monthsRemainingAfter: 2 });
    expect(redemptionDiscountFor(r, "starter", "monthly", 699)).toBeNull();
    expect(redemptionDiscountFor({ ...r, monthsRemaining: 0 }, "pro", "monthly", 2499)).toBeNull();
    // Annuel : 20 % du montant annuel (10 mois payés), une seule fois ; la durée de 3 mois est consommée.
    expect(redemptionDiscountFor(r, "pro", "yearly", 24990)).toEqual({ discountCents: 4998, monthsRemainingAfter: 0 });
    // Montant fixe à l'année : appliqué une fois sur l'échéance annuelle.
    expect(redemptionDiscountFor({ ...r, discountPercent: null, discountCents: 500, plans: [] }, "agence", "yearly", 49990)).toEqual({ discountCents: 500, monthsRemainingAfter: 0 });
    // Sans limite de durée : toujours remisé.
    expect(redemptionDiscountFor({ ...r, plans: [], monthsRemaining: null }, "starter", "monthly", 699)).toEqual({ discountCents: 140, monthsRemainingAfter: null });
  });

  it("ligne de remise : se retranche du total et la TVA est calculée sur le montant remisé", () => {
    const lines = [{ kind: "discount" as const, amountCents: 500 }, { kind: "overage" as const, amountCents: 75 }];
    expect(extraLinesTotal(lines)).toBe(-425);
    expect(invoiceAmounts(2499, 20, [{ kind: "discount", amountCents: 500 }])).toEqual({ exclVatCents: 1666, vatCents: 333, inclVatCents: 1999 });
    expect(invoiceAmounts(699, 20, [{ kind: "discount", amountCents: 699 }])).toEqual({ exclVatCents: 0, vatCents: 0, inclVatCents: 0 });
    // Anciennes lignes sans « kind » : additionnées comme avant.
    expect(extraLinesTotal([{ amountCents: 25 }])).toBe(25);
    expect(offerInvoiceLineLabel("Printemps", "PRINTEMPS")).toBe("Remise : Printemps (PRINTEMPS)");
    expect(offerInvoiceLineLabel("Fidélité", null)).toBe("Remise : Fidélité");
  });
});

describe("offres commerciales : codes, validation et bandeau", () => {
  it("code normalisé en majuscules (espaces et soulignés en tirets), mauvais formats refusés", () => {
    expect(normalizeOfferCode(" printemps ")).toBe("PRINTEMPS");
    expect(normalizeOfferCode("noel 2026")).toBe("NOEL-2026");
    expect(normalizeOfferCode("ab")).toBeNull();
    expect(normalizeOfferCode("a".repeat(25))).toBeNull();
    expect(normalizeOfferCode("été!")).toBeNull();
    expect(normalizeOfferCode(42)).toBeNull();
  });

  it("une offre a exactement une remise, une période cohérente et des limites bornées", () => {
    expect(offerInput.safeParse({ name: "Printemps", code: "printemps", discountPercent: 20 }).data).toMatchObject({ code: "PRINTEMPS", plans: [], durationMonths: null, active: true, bannerEnabled: false });
    expect(offerInput.safeParse({ name: "Double", discountPercent: 20, discountCents: 500 }).success).toBe(false);
    expect(offerInput.safeParse({ name: "Rien" }).success).toBe(false);
    expect(offerInput.safeParse({ name: "Trop", discountPercent: 101 }).success).toBe(false);
    expect(offerInput.safeParse({ name: "X", discountPercent: 10 }).success).toBe(false);
    expect(offerInput.safeParse({ name: "Bandeau", discountPercent: 10, bannerText: "x".repeat(141) }).success).toBe(false);
    expect(offerInput.safeParse({ name: "Dates", discountPercent: 10, startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" }).success).toBe(false);
    expect(offerInput.safeParse({ name: "Plans", discountPercent: 10, plans: ["free"] }).success).toBe(false);
    expect(offerUpdate.safeParse({ active: false }).data).toEqual({ active: false });
  });

  it("disponibilité : inactive, pas encore commencée, expirée, maximum atteint, forfait non concerné", () => {
    expect(offerAvailability(offer(), { now: NOW, plan: "pro" })).toEqual({ ok: true });
    expect(offerAvailability(offer({ active: false }), { now: NOW })).toMatchObject({ ok: false, reason: "inactive" });
    expect(offerAvailability(offer({ archivedAt: "2026-11-02T00:00:00.000Z" }), { now: NOW })).toMatchObject({ ok: false, reason: "inactive" });
    expect(offerAvailability(offer({ startsAt: "2026-12-01T00:00:00.000Z" }), { now: NOW })).toMatchObject({ ok: false, reason: "not_started" });
    expect(offerAvailability(offer({ endsAt: "2026-11-15T12:00:00.000Z" }), { now: NOW })).toMatchObject({ ok: false, reason: "expired", message: "Ce code promo a expiré." });
    expect(offerAvailability(offer({ maxRedemptions: 5, redemptions: 5 }), { now: NOW })).toMatchObject({ ok: false, reason: "exhausted" });
    expect(offerAvailability(offer({ maxRedemptions: 5, redemptions: 4 }), { now: NOW })).toEqual({ ok: true });
    expect(offerAvailability(offer(), { now: NOW, plan: "starter" })).toMatchObject({ ok: false, reason: "plan_not_covered", message: "Ce code promo est valable sur Pro seulement." });
    // Aucun forfait choisi = tous.
    expect(offerAvailability(offer({ plans: [] }), { now: NOW, plan: "agence" })).toEqual({ ok: true });
  });

  it("texte du bandeau : saisi, sinon construit (« -20 % sur Pro avec le code PRINTEMPS »)", () => {
    expect(offerBannerText(offer({ durationMonths: null }))).toBe("-20 % sur Pro avec le code PRINTEMPS");
    expect(offerBannerText(offer())).toBe("-20 % sur Pro pendant 3 mois avec le code PRINTEMPS");
    expect(offerBannerText(offer({ discountPercent: null, discountCents: 250, plans: [], code: null, durationMonths: null }))).toBe("-2,50 € sur tous les forfaits");
    expect(offerBannerText(offer({ bannerText: "  Black Friday : Pro à -20 %  " }))).toBe("Black Friday : Pro à -20 %");
    expect(offerPlansLabel(["agence", "starter"])).toBe("Starter et Agence");
    expect(offerPlansLabel(["starter", "pro", "agence"])).toBe("tous les forfaits");
    expect(offerDiscountLabel({ discountPercent: null, discountCents: 500 })).toBe("-5 €");
  });
});
