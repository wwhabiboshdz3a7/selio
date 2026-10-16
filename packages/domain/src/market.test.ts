import { describe, expect, it } from "vitest";
import type { MarketObservation } from "@selio/contracts";
import { analyzeMarket } from "./market";

const now = new Date("2026-10-16T12:00:00Z");
let n = 0;
function obs(seller: string, brand: string, category: MarketObservation["category"], price: number, sold: boolean, daysAgo: number): MarketObservation {
  const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return { id: `o${n++}`, sellerHandle: seller, title: `${brand} pièce`, brand, category, priceCents: price, status: sold ? "sold" : "listed", seenAt: at, soldAt: sold ? at : null, favorites: 3, source: "demo_simulator" };
}

describe("analyse des revendeurs", () => {
  const data = [
    ...Array.from({ length: 6 }, (_, i) => obs("sneaker.king", "Nike", "shoes", 6000, true, i * 4 + 1)),
    obs("sneaker.king", "Nike", "shoes", 6500, false, 1),
    obs("sneaker.king", "Adidas", "shoes", 5000, true, 3),
    ...Array.from({ length: 3 }, (_, i) => obs("vintage.lou", "Levi's", "men", 3500, true, i * 6 + 2)),
    ...Array.from({ length: 5 }, () => obs("vintage.lou", "Levi's", "men", 3800, false, 2)),
    obs("old.sale", "Nike", "shoes", 4000, true, 60),
  ];

  it("classe les vendeurs par chiffre d'affaires et identifie leur niche", () => {
    const m = analyzeMarket(data, now, 30);
    expect(m.sellers[0]!.handle).toBe("sneaker.king");
    expect(m.sellers[0]!.sold).toBe(7);
    expect(m.sellers[0]!.niche).toBe("Nike · Chaussures");
    expect(m.sellers[0]!.nicheShare).toBeCloseTo(6 / 7, 3);
    expect(m.sellers[0]!.revenueCents).toBe(41000);
    expect(m.sellers.find((s) => s.handle === "vintage.lou")!.sellThrough).toBeCloseTo(3 / 8, 3);
    expect(m.sellers.some((s) => s.handle === "old.sale")).toBe(false);
  });

  it("note la demande des niches et repère les moins concurrencées", () => {
    const m = analyzeMarket(data, now, 30);
    const nike = m.niches.find((x) => x.label === "Nike · Chaussures")!;
    expect(nike.demand).toBeGreaterThan(m.niches.find((x) => x.label === "Levi's · Hommes")!.demand);
    expect(nike.competition).toBe("faible");
    expect(m.opportunities[0]!.label).toBe("Nike · Chaussures");
    expect(m.totals.sold).toBe(10);
    expect(m.priceBands.reduce((s, b) => s + b.sold, 0)).toBe(10);
  });
});
