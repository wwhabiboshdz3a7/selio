import { describe, expect, it } from "vitest";
import { quotasForPlan } from "@selio/contracts";
import { parsePriceIds, subsidiaryUsageFrom, usageDayStart, usagePeriodStart } from "./billing";

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

  it("identifiants de prix : Starter, Pro et Agence lus depuis l'environnement", () => {
    expect(parsePriceIds({})).toEqual({});
    expect(parsePriceIds({ STRIPE_PRICE_STARTER: "price_s", STRIPE_PRICE_PRO: "price_p", STRIPE_PRICE_AGENCE: "price_a" })).toEqual({ starter: "price_s", pro: "price_p", agence: "price_a" });
    expect(parsePriceIds({ STRIPE_PRICE_AGENCE: "" })).toEqual({});
  });
});
