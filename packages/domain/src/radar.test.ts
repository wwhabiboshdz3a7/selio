import { describe, expect, it } from "vitest";
import { estimateResale, scoreOpportunity } from "./radar";

describe("radar", () => {
  const comps = [
    { brand: "Nike", category: "shoes", condition: "good" as const, salePriceCents: 5000 },
    { brand: "Nike", category: "shoes", condition: "good" as const, salePriceCents: 6000 },
    { brand: "Nike", category: "shoes", condition: "very_good" as const, salePriceCents: 7000 },
  ];
  it("estime par médiane des comparables et annonce la méthode", () => {
    const e = estimateResale({ priceCents: 2000, brand: "nike", category: "shoes", condition: "very_good" }, comps);
    expect(e.resalePriceCents).toBe(6000);
    expect(e.confidence).toBe("high");
    expect(e.comparableCount).toBe(3);
  });
  it("se replie prudemment sans comparables", () => {
    const e = estimateResale({ priceCents: 2000, brand: "Inconnue", category: "bags", condition: null }, comps);
    expect(e.confidence).toBe("low");
    expect(e.comparableCount).toBe(0);
  });
  it("score expliqué, plafonné quand la marge est négative", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const good = scoreOpportunity({ priceCents: 2000, shippingCents: 300, seenAt: "2026-10-08T11:00:00Z" }, { resalePriceCents: 6000, confidence: "high", method: "", comparableCount: 3 }, { budgetCents: 5000, targetMarginCents: 2000, targetMarginRate: 0.4 }, 0, now);
    expect(good.score).toBeGreaterThan(70);
    expect(good.reasons.length).toBeGreaterThan(3);
    const bad = scoreOpportunity({ priceCents: 7000, shippingCents: 0, seenAt: "2026-10-01T11:00:00Z" }, { resalePriceCents: 6000, confidence: "low", method: "", comparableCount: 0 }, { budgetCents: 5000, targetMarginCents: 2000, targetMarginRate: 0.4 }, 0, now);
    expect(bad.score).toBeLessThanOrEqual(10);
  });
});
