import { describe, expect, it } from "vitest";
import { quotasForPlan } from "@selio/contracts";
import { PRICING } from "@selio/demo-data";
import { addCycle, addMonthsUtc, cycleLabel, formatDateFr, formatEuros, nextChargeDate, planPriceCents, subsidiaryUsageFrom, usageDayStart, usagePeriodStart } from "./billing";

describe("facturation : compteurs par filiale (fonctions pures)", () => {
  it("la période repart du 1er du mois (UTC) et les plafonds journaliers du jour (UTC)", () => {
    const now = new Date("2026-10-28T23:30:00.000Z");
    expect(usagePeriodStart(now)).toBe("2026-10-01T00:00:00.000Z");
    expect(usageDayStart(now)).toBe("2026-10-28T00:00:00.000Z");
    expect(usagePeriodStart(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
  });

  it("Pro : compteurs Studio, Track et Cloud avec pourcentage et alerte à 80 %", () => {
    const u = subsidiaryUsageFrom({ "studio.listing": 16, "studio.worn_photo": 2, "track.scan": 10, "track.photo_search": 3, "ai.request": 900 }, quotasForPlan("pro"), 400);
    expect(u.studio.listings).toEqual({ used: 16, quota: 20, percent: 80, warning: true, exceeded: false });
    expect(u.studio.wornPhotos).toEqual({ used: 2, quota: 10, percent: 20, warning: false, exceeded: false });
    expect(u.track.scans).toEqual({ used: 10, quota: 10, percent: 100, warning: true, exceeded: true });
    expect(u.track.photoSearches).toMatchObject({ used: 3, quota: 30, percent: 10, warning: false });
    expect(u.track.filtersFollowed).toMatchObject({ used: 0, quota: 5 });
    expect(u.cloud).toEqual({ actions: { used: 400, quota: 500, percent: 80, warning: true, exceeded: false }, included: false });
  });

  it("Agence : Cloud inclus ; Starter et accès de base : Studio et Track à zéro, toute utilisation passe à 100 %", () => {
    expect(subsidiaryUsageFrom({}, quotasForPlan("agence")).cloud.included).toBe(true);
    expect(subsidiaryUsageFrom({}, quotasForPlan("agence")).studio.listings).toMatchObject({ used: 0, quota: 60, percent: 0, warning: false });
    const starter = subsidiaryUsageFrom({ "studio.listing": 1 }, quotasForPlan("starter"));
    expect(starter.studio.listings).toEqual({ used: 1, quota: 0, percent: 100, warning: true, exceeded: true });
    expect(starter.track.scans).toEqual({ used: 0, quota: 0, percent: 0, warning: false, exceeded: true });
    expect(starter.cloud.included).toBe(false);
    expect(subsidiaryUsageFrom({}, quotasForPlan("free")).studio.listings.quota).toBe(0);
  });

});

describe("facturation Revolut : tarifs, périodes, relances (fonctions pures)", () => {
  it("montants depuis PRICING : mensuel, annuel = 10 mois", () => {
    expect(planPriceCents("starter", "monthly")).toBe(PRICING.monthlyCents.starter);
    expect(planPriceCents("pro", "monthly")).toBe(2499);
    expect(planPriceCents("agence", "yearly")).toBe(4999 * 10);
    expect(formatEuros(2499).replace(/\s/g, " ")).toBe("24,99 €");
    expect(cycleLabel("monthly")).toBe("mensuel");
    expect(cycleLabel("yearly")).toBe("annuel");
  });

  it("période suivante : +1 mois (jour conservé ou borné), +1 an", () => {
    expect(addCycle(new Date("2026-11-01T10:00:00.000Z"), "monthly").toISOString()).toBe("2026-12-01T10:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonthsUtc(new Date("2028-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-12-15T08:30:00.000Z"), 1).toISOString()).toBe("2027-01-15T08:30:00.000Z");
    expect(addCycle(new Date("2028-02-29T00:00:00.000Z"), "yearly").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });

  it("relances : J+1, J+3, J+7 après l'échéance, puis plus aucune", () => {
    const due = new Date("2026-11-01T00:00:00.000Z");
    expect(nextChargeDate(due, 1)?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(nextChargeDate(due, 2)?.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(nextChargeDate(due, 3)?.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(nextChargeDate(due, 4)).toBeNull();
    expect(formatDateFr(new Date("2026-11-02T00:00:00.000Z"))).toBe("2 novembre 2026");
  });
});
