import { describe, expect, it } from "vitest";
import { BETA_CODE, BETA_DAYS, BETA_PLAN, betaDateLabel, betaDaysLeft, betaEndDate, betaReminderFor, compactOfferCode, isSameOfferCode } from "./beta";
import { TRIAL_PLAN, effectivePaymentMode, normalizeOfferCode, PAYMENT_MODE_SETTINGS } from "./index";

describe("bêta : normalisation du code", () => {
  it("casse, espaces, tirets et soulignés ignorés", () => {
    for (const raw of ["BETA2026SELIO", "beta2026selio", "BETA-2026-SELIO", " Beta 2026 Selio ", "beta_2026_selio", "bEtA-2026selio"]) {
      expect(compactOfferCode(raw)).toBe("BETA2026SELIO");
      expect(isSameOfferCode(raw)).toBe(true);
    }
  });

  it("un autre code, un code vide ou une valeur non textuelle ne correspondent pas", () => {
    for (const raw of ["BETA2025SELIO", "BETA2026SELI0", "", "   ", "---", null, undefined, 42]) expect(isSameOfferCode(raw)).toBe(false);
    expect(compactOfferCode(undefined)).toBe("");
  });

  it("le format canonique reste celui des offres (la recherche compacte vient en second)", () => {
    expect(normalizeOfferCode("beta 2026 selio")).toBe("BETA-2026-SELIO");
    expect(compactOfferCode(normalizeOfferCode("beta 2026 selio"))).toBe(BETA_CODE);
  });

  it("forfait : celui de l'essai (Pro), 30 jours", () => {
    expect(BETA_PLAN).toBe(TRIAL_PLAN);
    expect(BETA_PLAN).toBe("pro");
    expect(BETA_DAYS).toBe(30);
  });
});

describe("bêta : dates", () => {
  const start = new Date("2026-11-30T09:00:00.000Z");

  it("fin = ouverture + 30 jours (ou la durée réglée), jamais moins d'un jour", () => {
    expect(betaEndDate(start).toISOString()).toBe("2026-12-30T09:00:00.000Z");
    expect(betaEndDate(start, 45).toISOString()).toBe("2027-01-14T09:00:00.000Z");
    expect(betaEndDate(start, 0).toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("jours restants arrondis au jour supérieur, 0 une fois la date passée", () => {
    const end = betaEndDate(start);
    expect(betaDaysLeft(end, start)).toBe(30);
    expect(betaDaysLeft(end.toISOString(), new Date(end.getTime() - 3_600_000))).toBe(1);
    expect(betaDaysLeft(end, new Date(end.getTime() - 7 * 86_400_000 + 1))).toBe(7);
    expect(betaDaysLeft(end, end)).toBe(0);
    expect(betaDaysLeft(end, new Date(end.getTime() + 1))).toBe(0);
  });

  it("rappels : J-7 de 7 à 2 jours, J-1 la veille, rien avant ni après", () => {
    expect([30, 8, 7, 2, 1, 0, null].map((d) => betaReminderFor(d))).toEqual([null, null, 7, 7, 1, null, null]);
  });

  it("date JJ/MM/AAAA à l'heure de Paris", () => {
    expect(betaDateLabel("2026-12-30T09:00:00.000Z")).toBe("30/12/2026");
    expect(betaDateLabel(new Date("2026-12-31T23:30:00.000Z"))).toBe("01/01/2027");
  });
});

describe("paiement : emplacement Stripe", () => {
  it("« stripe » est une valeur connue mais ne débite jamais rien tant que l'adaptateur n'existe pas", () => {
    expect(PAYMENT_MODE_SETTINGS).toContain("stripe");
    expect(effectivePaymentMode("stripe", true)).toBe("simulated");
  });
});
