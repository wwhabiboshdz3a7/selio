import { describe, expect, it } from "vitest";
import { automationSettings } from "@selio/contracts";
import { bandFor, bandLabels, droppedPrice, fillTemplate, lotDiscountRate, lowestPrice, replyToOffer, stepPrices } from "./negotiation-journey";

const rules = automationSettings.parse({}).negotiation;

describe("négociation par paliers", () => {
  it("choisit la tranche de prix", () => {
    expect(bandFor(800, rules.bands).marginRate).toBe(0.1);
    expect(bandFor(1500, rules.bands).marginRate).toBe(0.15);
    expect(bandFor(20_000, rules.bands).marginRate).toBe(0.25);
  });

  it("calcule les paliers 60 / 75 / 100 % de la marge", () => {
    // 20 € → tranche 20 à 49,99 € : marge 20 % ; paliers 12 %, 15 %, 20 %.
    const steps = stepPrices(2000, rules);
    expect(steps.map((s) => s.priceCents)).toEqual([1750, 1700, 1600]);
    expect(steps.at(-1)!.final).toBe(true);
    expect(lowestPrice(2000, rules)).toBe(1600);
  });

  it("accepte, contre-propose, fait l'offre finale puis se replie", () => {
    expect(replyToOffer(2000, 1800, 0, rules)).toEqual({ kind: "accept", priceCents: 1800, step: 0 });
    expect(replyToOffer(2000, 1200, 0, rules)).toEqual({ kind: "counter", priceCents: 1750, step: 1 });
    expect(replyToOffer(2000, 1300, 2, rules)).toEqual({ kind: "final", priceCents: 1600, step: 3 });
    expect(replyToOffer(2000, 1300, 3, rules).kind).toBe("fallback");
    expect(replyToOffer(2000, 1600, 3, rules).kind).toBe("accept");
  });

  it("lots, baisses de prix et modèles", () => {
    expect(lotDiscountRate(1, rules.lot)).toBe(0);
    expect(lotDiscountRate(2, rules.lot)).toBe(0.1);
    expect(lotDiscountRate(4, rules.lot)).toBe(0.15);
    const drops = { ...rules.priceDrops, enabled: true };
    expect(droppedPrice(2000, 5, drops)).toBe(2000);
    expect(droppedPrice(2000, 10, drops)).toBe(1900);
    expect(droppedPrice(2000, 200, drops)).toBe(1400);
    expect(fillTemplate("Bonjour {prenom}, {article} à {prix}", { prenom: "Léa", article: "Pull", prix: "12 €" })).toBe("Bonjour Léa, Pull à 12 €");
    expect(bandLabels(rules.bands, (c) => `${c / 100} €`)).toEqual(["Jusqu'à 9.99 €", "10 € à 19.99 €", "20 € à 49.99 €", "50 € et plus"]);
  });
});
