import { describe, expect, it } from "vitest";
import {
  PLAN_QUOTAS, PRICE_REFERENCE_KEYS, TRACK_SCAN_WEIGHTS, photoDescription, priceEstimate, priceEstimateInput, priceReference, trackFilterCreate, trackPhotoSearchInput, trackScanInput, trackSnapshot,
} from "./index";

describe("contrats de Selio Track et de l'estimation des prix", () => {
  it("une référence de prix n'a aucun champ personnel (pseudo, photo, titre, adresse, identifiant d'annonce)", () => {
    expect([...PRICE_REFERENCE_KEYS].sort()).toEqual([
      "brand", "category", "color", "condition", "createdAt", "dedupeKey", "favorites", "finalPriceCents", "finalPriceEstimated", "id", "listedAt", "listedPriceCents",
      "material", "photoCount", "size", "soldAt", "source", "status", "subcategory", "updatedAt", "views",
    ]);
    const parsed = priceReference.parse({ id: "r1", dedupeKey: "track:abcdef12", source: "track", category: "men", createdAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z", sellerHandle: "vendeuse", title: "Jean", photoUrl: "https://x" });
    expect(parsed).not.toHaveProperty("sellerHandle");
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("photoUrl");
  });

  it("filtres : mêmes critères que Radar, quotas de Track par plan", () => {
    expect(trackFilterCreate.parse({ name: "Jeans", criteria: { brands: ["Levi's"] } })).toMatchObject({ enabled: true, criteria: { brands: ["Levi's"], keywords: [], maxPriceCents: 5000 } });
    expect(PLAN_QUOTAS.pro).toMatchObject({ trackFiltersFollowed: 5, trackScansPerMonth: 10, trackPhotoSearchesPerMonth: 30, trackHistoryMonths: 3 });
    expect(PLAN_QUOTAS.agence).toMatchObject({ trackFiltersFollowed: 25, trackScansPerMonth: 50, trackPhotoSearchesPerMonth: 150, trackHistoryMonths: 12 });
    expect(PLAN_QUOTAS.starter.trackFiltersFollowed).toBe(0);
    expect(trackScanInput.parse({ category: "men" })).toEqual({ brand: null, category: "men" });
  });

  it("photo : data URL d'image seulement ; description sans prix ; estimation « none » sans prix", () => {
    expect(trackPhotoSearchInput.safeParse({ photo: "data:image/png;base64,AAAA" }).success).toBe(true);
    expect(trackPhotoSearchInput.safeParse({ photo: "https://exemple.fr/a.png" }).success).toBe(false);
    expect(Object.keys(photoDescription.shape)).not.toContain("priceCents");
    expect(priceEstimate.parse({ p25: null, p50: null, p75: null, delayDays: null, confidence: 0, confidenceLevel: "low", method: "none", strategies: null, comparableCount: 0 })).toMatchObject({ factors: [], demo: false, message: null });
    expect(priceEstimateInput.parse({ category: "shoes" })).toEqual({ category: "shoes", explain: false });
  });

  it("instantané : agrégats seulement ; poids de la note de niche qui somment à 1", () => {
    expect(Object.keys(trackSnapshot.shape).sort()).toEqual(["brandShares", "createdAt", "fingerprint", "goneCount", "id", "listedCount", "medianDaysListed", "medianPriceCents", "newCount", "p25Cents", "p75Cents", "readAt", "scope", "source"]);
    expect(Object.values(TRACK_SCAN_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1);
  });
});
