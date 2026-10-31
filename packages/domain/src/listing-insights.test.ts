import { describe, expect, it } from "vitest";
import type { InventoryItem } from "@selio/contracts";
import { makeItem } from "./test-fixtures";
import { INSIGHT_MIN_SAMPLE, isGenerated, listingInsights, wasListed } from "./listing-insights";

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, url: "data:image/png;base64,AAAA", alt: "", position: i }));
let seq = 0;
function sold(over: Partial<InventoryItem> = {}): InventoryItem {
  seq++;
  return makeItem({ id: `s-${seq}`, status: "sold", listedAt: "2026-09-01T12:00:00Z", soldAt: "2026-09-11T12:00:00Z", ...over });
}
function online(over: Partial<InventoryItem> = {}): InventoryItem {
  seq++;
  return makeItem({ id: `l-${seq}`, status: "listed", listedAt: "2026-09-01T12:00:00Z", ...over });
}

describe("ce qui performe (Selio Studio)", () => {
  it("ne compte que les annonces déjà mises en ligne", () => {
    expect(wasListed(makeItem({ status: "in_stock", listedAt: null }))).toBe(false);
    expect(wasListed(makeItem({ status: "sold", listedAt: "2026-09-01T12:00:00Z" }))).toBe(true);
    const r = listingInsights([makeItem({ status: "in_stock", listedAt: null }), online(), sold()], []);
    expect(r.sample).toEqual({ listed: 2, sold: 1, generated: 0 });
  });

  it("calcule taux de vente, délai médian et taux de favoris par groupe", () => {
    const items = [
      sold({ photos: photos(8), soldAt: "2026-09-05T12:00:00Z", listingStats: { views: 100, favorites: 20, offers: 0, updatedAt: null } }),
      sold({ photos: photos(8), soldAt: "2026-09-09T12:00:00Z", listingStats: { views: 100, favorites: 10, offers: 0, updatedAt: null } }),
      online({ photos: photos(8), listingStats: { views: 200, favorites: 10, offers: 0, updatedAt: null } }),
      online({ photos: photos(1) }),
    ];
    const dim = listingInsights(items, []).dimensions.find((d) => d.key === "photos")!;
    const many = dim.buckets.find((b) => b.key === "8+")!;
    expect(many.count).toBe(3);
    expect(many.sold).toBe(2);
    expect(many.sellRate).toBeCloseTo(2 / 3);
    expect(many.medianDaysToSell).toBe(6); // 4 et 8 jours
    expect(many.favoriteRate).toBeCloseTo(40 / 400);
    // Les groupes vides ne sont pas affichés.
    expect(dim.buckets.map((b) => b.key)).toEqual(["1-2", "8+"]);
  });

  it("ne tire aucun constat d'un échantillon trop petit", () => {
    const items = [sold({ photos: photos(8) }), online({ photos: photos(1) })];
    const r = listingInsights(items, []);
    expect(r.dimensions.find((d) => d.key === "photos")!.finding).toBeNull();
    expect(r.highlights).toEqual([]);
    expect(INSIGHT_MIN_SAMPLE).toBeGreaterThanOrEqual(3);
  });

  it("signale un écart net de taux de vente, en tendance tant que l'échantillon reste modeste", () => {
    const items = [
      ...Array.from({ length: 4 }, () => sold({ photos: photos(8) })),
      online({ photos: photos(8) }),
      ...Array.from({ length: 4 }, () => online({ photos: photos(1) })),
      sold({ photos: photos(1) }),
    ];
    const f = listingInsights(items, []).dimensions.find((d) => d.key === "photos")!.finding!;
    expect(f.metric).toBe("sellRate");
    expect(f.best.key).toBe("8+");
    expect(f.worst.key).toBe("1-2");
    expect(f.strength).toBe("trend");
    expect(f.text).toContain("Les annonces avec 8 photos ou plus se vendent mieux : 80 % vendues, contre 20 %");
  });

  it("compare le prix affiché à la médiane des autres ventes de la même marque et catégorie", () => {
    const items = [online({ id: "cher", listedPriceCents: 8000 }), online({ id: "juste", listedPriceCents: 5000 }), online({ id: "seul", brand: "Inconnue", title: "Sweat Inconnue" })];
    const sales = [{ itemId: "x1", brand: "The North Face", category: "men", salePriceCents: 5000 }, { itemId: "x2", brand: "the north face", category: "men", salePriceCents: 5400 }];
    const dim = listingInsights(items, sales).dimensions.find((d) => d.key === "price")!;
    expect(Object.fromEntries(dim.buckets.map((b) => [b.key, b.count]))).toEqual({ at: 1, above: 1, none: 1 });
  });

  it("distingue les annonces rédigées avec le générateur", () => {
    expect(isGenerated(makeItem({ attributes: { colors: [], material: null, generatedBy: "ai" } }))).toBe(true);
    expect(isGenerated(makeItem({ tags: ["générateur"] }))).toBe(true);
    expect(isGenerated(makeItem())).toBe(false);
  });
});
