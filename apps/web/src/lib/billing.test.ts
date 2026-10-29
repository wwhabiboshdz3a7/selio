import { describe, expect, it } from "vitest";
import { PRICING } from "@selio/demo-data";
import { CYCLE_LABELS, FREE_MONTHS, addCycle, addMonthsUtc, daysLeft, inTrial, isRunning, periodLabel, planPriceCents } from "./billing";

describe("règles d'abonnement partagées (page Abonnement, Factures, démonstration)", () => {
  it("prix par périodicité : mensuel = PRICING, annuel = 10 mois payés pour 12 (2 offerts)", () => {
    expect(planPriceCents("starter", "monthly")).toBe(PRICING.monthlyCents.starter);
    expect(planPriceCents("pro", "monthly")).toBe(PRICING.monthlyCents.pro);
    expect(planPriceCents("agence", "yearly")).toBe(PRICING.monthlyCents.agence * PRICING.annualMonthsCharged);
    expect(FREE_MONTHS).toBe(12 - PRICING.annualMonthsCharged);
    expect(FREE_MONTHS).toBe(2);
    expect(CYCLE_LABELS).toEqual({ monthly: "mensuel", yearly: "annuel" });
  });

  it("ajoute des mois en UTC en gardant le jour quand il existe (31 janvier + 1 mois = fin février)", () => {
    expect(addMonthsUtc(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonthsUtc(new Date("2028-01-31T10:00:00Z"), 1).toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-03-15T10:00:00Z"), 1).toISOString()).toBe("2026-04-15T10:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-12-31T00:00:00Z"), 2).toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(addCycle(new Date("2026-10-29T12:00:00Z"), "monthly").toISOString()).toBe("2026-11-29T12:00:00.000Z");
    expect(addCycle(new Date("2026-10-29T12:00:00Z"), "yearly").toISOString()).toBe("2027-10-29T12:00:00.000Z");
  });

  it("jours restants arrondis au jour supérieur, jamais négatifs", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(daysLeft("2026-11-12T12:00:00Z", now)).toBe(14);
    expect(daysLeft("2026-10-29T13:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-10-29T12:00:00Z", now)).toBe(0);
    expect(daysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
  });

  it("abonnement en cours (essai, actif, en retard) et essai qui court encore", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(isRunning({ status: "trialing" })).toBe(true);
    expect(isRunning({ status: "active" })).toBe(true);
    expect(isRunning({ status: "past_due" })).toBe(true);
    expect(isRunning({ status: "canceled" })).toBe(false);
    expect(isRunning({ status: "none" })).toBe(false);
    expect(inTrial({ status: "trialing", currentPeriodEnd: "2026-11-12T12:00:00Z" }, now)).toBe(true);
    expect(inTrial({ status: "trialing", currentPeriodEnd: "2026-10-01T12:00:00Z" }, now)).toBe(false);
    expect(inTrial({ status: "trialing", currentPeriodEnd: null }, now)).toBe(false);
    expect(inTrial({ status: "active", currentPeriodEnd: "2026-11-12T12:00:00Z" }, now)).toBe(false);
  });

  it("libellé de période en français, comme la facture côté serveur", () => {
    expect(periodLabel("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toBe("du 1 novembre 2026 au 1 décembre 2026");
  });
});
