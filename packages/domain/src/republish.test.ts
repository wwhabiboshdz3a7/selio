import { describe, expect, it } from "vitest";
import { applyVariant, MIN_REPUBLISH_VARIANTS, pieceName, recordRepublication, republicationPlan, variantLeaderboard } from "./republish";
import { makeItem } from "./test-fixtures";

const now = new Date("2026-10-16T12:00:00Z");

describe("republications pré-faites", () => {
  it("prépare au moins 8 variantes distinctes, jamais sous le plancher", () => {
    const item = makeItem();
    const plan = republicationPlan(item, { now });
    expect(plan.variants.length).toBeGreaterThanOrEqual(MIN_REPUBLISH_VARIANTS);
    expect(new Set(plan.variants.map((v) => v.title)).size).toBeGreaterThanOrEqual(MIN_REPUBLISH_VARIANTS);
    for (const v of plan.variants) {
      expect(v.title.length).toBeLessThanOrEqual(100);
      expect(v.priceCents).not.toBeNull();
      expect(v.priceCents!).toBeGreaterThanOrEqual(item.floorPriceCents!);
      expect(v.priceCents!).toBeLessThanOrEqual(item.listedPriceCents!);
      expect(v.photoOrder.slice().sort((a, b) => a - b)).toEqual(item.photos.map((_, i) => i));
    }
    expect(plan.variants.find((v) => v.id === "v10")!.priceCents).toBe(4500);
    expect(new Set(plan.variants.map((v) => v.photoOrder[0])).size).toBeGreaterThan(1);
    expect(plan.next!.id).toBe("v1");
  });

  it("marque les variantes déjà utilisées et propose la suivante", () => {
    const item = makeItem({ republications: [
      { id: "r1", variantId: "v1", at: "2026-10-01T18:00:00Z", mode: "manual", before: { views: 80, favorites: 3 }, after: { views: 140, favorites: 9 } },
      { id: "r2", variantId: "v2", at: "2026-10-08T18:00:00Z", mode: "manual", before: { views: 40, favorites: 2 }, after: { views: 90, favorites: 4 } },
    ] });
    const plan = republicationPlan(item, { now });
    expect(plan.usedCount).toBe(2);
    expect(plan.variants.find((v) => v.id === "v1")!.uses).toBe(1);
    expect(plan.variants.find((v) => v.id === "v1")!.result).toEqual({ views: 140, favorites: 9 });
    expect(plan.next!.id).toBe("v3");
    expect(plan.best!.id).toBe("v1");
  });

  it("applique une variante et enregistre la republication (stats remises à zéro)", () => {
    const item = makeItem();
    const plan = republicationPlan(item, { now });
    const v = plan.variants[1]!;
    const patch = applyVariant(item, v);
    expect(patch.title).toBe(v.title);
    expect(patch.photos![0]!.id).toBe(item.photos[v.photoOrder[0]!]!.id);
    expect(patch.photos!.map((p) => p.position)).toEqual(item.photos.map((_, i) => i));
    const rec = recordRepublication(item, v.id, "manual", now.toISOString(), "rep-1");
    expect(rec.republications.at(-1)).toMatchObject({ variantId: "v2", before: { views: 150, favorites: 15 }, after: null });
    expect(rec.listingStats.views).toBe(0);
  });

  it("gère une annonce sans marque ni taille ni photo", () => {
    const item = makeItem({ brand: null, size: null, photos: [], title: "Robe d'été fleurie" });
    const plan = republicationPlan(item, { now });
    for (const v of plan.variants) {
      expect(v.title).not.toMatch(/^[\s·–-]|\s{2,}|undefined|null/);
      expect(v.photoOrder).toEqual([]);
    }
    expect(pieceName(item)).toBe("Robe d'été fleurie");
  });

  it("classe le rendement moyen des variantes sur le dressing", () => {
    const a = makeItem({ republications: [{ id: "r1", variantId: "v3", at: "2026-10-01T18:00:00Z", mode: "auto", before: { views: 0, favorites: 0 }, after: { views: 100, favorites: 6 } }] });
    const b = makeItem({ id: "it-2", republications: [{ id: "r2", variantId: "v3", at: "2026-10-02T18:00:00Z", mode: "manual", before: { views: 0, favorites: 0 }, after: { views: 50, favorites: 2 } }] });
    const board = variantLeaderboard([a, b]);
    expect(board.find((r) => r.variantId === "v3")).toMatchObject({ uses: 2, measured: 2, avgViews: 75, avgFavorites: 4 });
  });
});
