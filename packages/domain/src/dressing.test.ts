import { describe, expect, it } from "vitest";
import { makeItem } from "./test-fixtures";
import { daysOnline, lastOnlineAt, listingBand, marketPriceFor, scoreListing, summarizeDressing } from "./dressing";

const now = new Date("2026-10-16T12:00:00Z");

describe("dressing intelligent", () => {
  it("compte les jours en ligne depuis la dernière republication", () => {
    const it = makeItem({ republications: [{ id: "r1", variantId: "v1", at: "2026-10-14T12:00:00Z", mode: "manual", before: { views: 10, favorites: 1 }, after: null }] });
    expect(lastOnlineAt(it)).toBe("2026-10-14T12:00:00Z");
    expect(daysOnline(it, now)).toBe(2);
    expect(daysOnline(makeItem({ listedAt: null, status: "in_stock" }), now)).toBeNull();
  });

  it("note une bonne annonce au-dessus de 80 et explique chaque critère", () => {
    const perf = scoreListing(makeItem(), { now, marketPriceCents: 6200 });
    expect(perf.score).toBeGreaterThanOrEqual(80);
    expect(perf.band.key).toBe("excellent");
    expect(perf.parts.map((p) => p.max).reduce((a, b) => a + b, 0)).toBe(100);
    expect(perf.republishDue).toBe(false);
  });

  it("signale une annonce faible et propose des améliorations concrètes", () => {
    const weak = makeItem({ title: "Sweat", description: "Sweat", photos: [], attributes: { colors: [], material: null, generatedBy: null }, listedPriceCents: 9000, listedAt: "2026-10-01T12:00:00Z", listingStats: { views: 12, favorites: 0, offers: 0, updatedAt: null } });
    const perf = scoreListing(weak, { now, marketPriceCents: 6000, republishAfterDays: 7 });
    expect(perf.score).toBeLessThan(40);
    const keys = perf.tips.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["republish", "price", "photos", "title_brand", "description"]));
    expect(perf.tips[0]!.impact).toBe("high");
    expect(perf.republishDue).toBe(true);
  });

  it("suggère une offre aux favoris quand l'annonce plaît sans offre", () => {
    const perf = scoreListing(makeItem({ listingStats: { views: 60, favorites: 9, offers: 0, updatedAt: null } }), { now });
    expect(perf.tips.some((t) => t.action === "offer_favorites")).toBe(true);
  });

  it("calcule le prix de marché par médiane (2 ventes minimum)", () => {
    const sales = [{ brand: "the north face", category: "men", salePriceCents: 5000 }, { brand: "The North Face", category: "men", salePriceCents: 7000 }, { brand: "Nike", category: "men", salePriceCents: 1000 }];
    expect(marketPriceFor({ brand: "The North Face", category: "men" }, sales)).toBe(6000);
    expect(marketPriceFor({ brand: "Nike", category: "men" }, sales)).toBeNull();
  });

  it("résume le dressing", () => {
    const a = scoreListing(makeItem(), { now });
    const b = scoreListing(makeItem({ listedAt: "2026-09-01T12:00:00Z" }), { now });
    const s = summarizeDressing([a, b]);
    expect(s.listed).toBe(2);
    expect(s.toRepublish).toBe(1);
    expect(s.totalViews).toBe(300);
    expect(listingBand(59).key).toBe("improve");
  });
});
