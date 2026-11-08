import { describe, expect, it } from "vitest";
import { bundleSettings, inventoryItem, marginRules, negotiationAutomation, type InventoryItem } from "@selio/contracts";
import { BUNDLE_REASON_LABELS, boundedBundleDiscount, buildBundle, bundleItemAgeDays, bundlePriceCents, policyBundleRate, suggestBundles, suggestedBundleFloorCents } from "./bundles";
import { bundlePolicyFor, lotFloorCents } from "./negotiation-lots";

const now = new Date("2026-11-07T12:00:00Z");
const rules = marginRules.parse({});
const negotiation = negotiationAutomation.parse({});
const item = (over: Partial<InventoryItem> = {}): InventoryItem =>
  inventoryItem.parse({ id: "it-1", orgId: "org", title: "Pull", brand: "Sézane", size: "M", category: "women", status: "listed", purchasePriceCents: 1000, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000, listedAt: "2026-10-20T10:00:00Z", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z", ...over });

describe("plancher de lot et remise bornée", () => {
  it("le plancher de lot est au moins la somme des planchers réels (explicites ou recommandés)", () => {
    const a = item({ id: "a", floorPriceCents: 3000 });
    const b = item({ id: "b", floorPriceCents: null, purchasePriceCents: 1000 });
    const floorB = suggestedBundleFloorCents([b], rules);
    expect(floorB).toBeGreaterThan(1000);
    expect(suggestedBundleFloorCents([a, b], rules)).toBe(3000 + floorB);
  });
  it("avec une remise maximale de lot, le plancher monte au total affiché moins la remise, jamais sous la somme des planchers", () => {
    const items = [item({ id: "a", listedPriceCents: 4000, floorPriceCents: 1000 }), item({ id: "b", listedPriceCents: 6000, floorPriceCents: 1000 })];
    expect(suggestedBundleFloorCents(items, rules, { maxDiscountRate: 0.25 })).toBe(7500);
    expect(suggestedBundleFloorCents(items, rules, { maxDiscountRate: 0.9 })).toBe(2000);
    expect(suggestedBundleFloorCents([items[0]!, item({ id: "c", listedPriceCents: null, floorPriceCents: 500 })], rules, { maxDiscountRate: 0.25 })).toBe(1500);
  });
  it("la remise de la politique est abaissée quand le plancher de lot l'exige, et le prix ne passe jamais dessous", () => {
    expect(boundedBundleDiscount(10_000, 7000, 0.15)).toEqual({ rate: 0.15, capped: false });
    expect(boundedBundleDiscount(10_000, 9000, 0.15)).toEqual({ rate: 0.1, capped: true });
    expect(boundedBundleDiscount(10_000, 10_000, 0.15)).toEqual({ rate: 0, capped: true });
    expect(boundedBundleDiscount(0, 0, 0.1)).toEqual({ rate: 0, capped: true });
    expect(bundlePriceCents(10_000, 9000, 0.15)).toBe(9000);
    expect(bundlePriceCents(10_000, 7000, 0.15)).toBe(8500);
  });
  it("taux de la politique : 2 articles, 3 et plus, 0 si désactivée", () => {
    expect(policyBundleRate(negotiation.lot, 2)).toBe(0.1);
    expect(policyBundleRate(negotiation.lot, 3)).toBe(0.15);
    expect(policyBundleRate(negotiation.lot, 1)).toBe(0);
    expect(policyBundleRate({ ...negotiation.lot, enabled: false }, 3)).toBe(0);
  });
});

describe("propositions de lots (règles explicites, sans IA)", () => {
  const items = [
    item({ id: "a", brand: "Sézane", size: "M", listedPriceCents: 4000, floorPriceCents: 3000 }),
    item({ id: "b", brand: "Sézane", size: "M", listedPriceCents: 6000, floorPriceCents: 4000 }),
    item({ id: "c", brand: "Levi's", size: "W32", category: "men", listedPriceCents: 3000, floorPriceCents: 2000 }),
    item({ id: "d", brand: "Levi's", size: "W32", category: "men", listedPriceCents: 3500, floorPriceCents: 2500 }),
    item({ id: "e", brand: "Nike", size: "42", category: "shoes", listedPriceCents: 5000, floorPriceCents: 4000, listedAt: "2026-08-01T10:00:00Z" }),
    item({ id: "f", brand: "Adidas", size: "43", category: "shoes", listedPriceCents: 4500, floorPriceCents: 3500, listedAt: "2026-07-15T10:00:00Z" }),
    item({ id: "sold", status: "sold", brand: "Sézane", size: "M" }),
    item({ id: "noprice", listedPriceCents: null, brand: "Sézane", size: "M" }),
  ];
  it("même acheteur intéressé par ≥ 2 articles : lot avec la remise 2 articles et la marge projetée", () => {
    const out = suggestBundles({ items, signals: { buyerInterest: [{ customerId: "cust-1", itemIds: ["a", "c", "sold", "ghost"] }], brandAffinity: false, ageDays: 365 }, negotiation, rules, now });
    expect(out).toHaveLength(1);
    const b = out[0]!;
    expect(b).toMatchObject({ reason: "same_buyer", customerId: "cust-1", itemIds: ["a", "c"], listedTotalCents: 7000, floorCents: 5250, suggestedDiscountRate: 0.1, discountCapped: false, bundlePriceCents: 6300 });
    // Même plancher que l'évaluation d'une offre de lot : max(somme des planchers 5 000, 7 000 × (1 − 25 %)).
    expect(b.floorCents).toBe(lotFloorCents([items[0]!, items[2]!], rules, bundlePolicyFor(negotiation, 2)).floorCents);
    expect(b.projectedMarginCents).toBe(6300 - 2000);
    expect(b.projectedMarginRate).toBeCloseTo(4300 / 6300, 6);
    expect(b.label).toContain(BUNDLE_REASON_LABELS.same_buyer);
    expect(b.id).toMatch(/^bundle-same_buyer-/);
  });
  it("un acheteur intéressé par un seul article en ligne ne donne pas de lot", () => {
    expect(suggestBundles({ items, signals: { buyerInterest: [{ customerId: "cust-2", itemIds: ["a", "sold", "noprice"] }], brandAffinity: false, ageDays: 365 }, negotiation, rules, now })).toEqual([]);
  });
  it("même marque et même taille : un lot par groupe, les articles déjà proposés à un acheteur ne sont pas repris", () => {
    const out = suggestBundles({ items, signals: { buyerInterest: [{ customerId: "cust-1", itemIds: ["a", "b"] }] }, negotiation, rules, now });
    // Les trois règles s'appliquent dans l'ordre ; e et f (anciens, marques différentes) forment le lot « anciens ».
    expect(out.map((b) => [b.reason, b.itemIds])).toEqual([["same_buyer", ["a", "b"]], ["same_brand_size", ["c", "d"]], ["stale", ["f", "e"]]]);
    expect(out[1]!.label).toBe("Même marque et taille : Levi's, W32");
    const brandOnly = suggestBundles({ items: items.filter((i) => i.id !== "a"), signals: { sizeAffinity: false }, negotiation, rules, now });
    expect(brandOnly.find((b) => b.reason === "same_brand_size")?.label).toBe("Même marque : Levi's");
  });
  it("articles anciens (> 60 jours en ligne par défaut, réglable) regroupés par catégorie", () => {
    const out = suggestBundles({ items, signals: { brandAffinity: false }, negotiation, rules, now });
    expect(out.map((b) => b.reason)).toEqual(["stale"]);
    expect(out[0]!.itemIds).toEqual(["f", "e"]);
    expect(out[0]!.label).toContain("plus de 60 jours");
    expect(suggestBundles({ items, signals: { brandAffinity: false, ageDays: 200 }, negotiation, rules, now })).toEqual([]);
    expect(bundleItemAgeDays(items[4]!, now)).toBe(98);
    expect(bundleItemAgeDays(item({ listedAt: null, createdAt: "2026-11-01T10:00:00Z" }), now)).toBe(6);
  });
  it("la remise est bornée par le plancher de lot (politique de lot et planchers réels)", () => {
    const tight = [item({ id: "x", listedPriceCents: 4000, floorPriceCents: 3900 }), item({ id: "y", listedPriceCents: 4000, floorPriceCents: 3900 })];
    const b = buildBundle(tight, "same_buyer", { policy: negotiation.lot, rules })!;
    expect(b.discountCapped).toBe(true);
    expect(b.bundlePriceCents).toBeGreaterThanOrEqual(7800);
    expect(b.suggestedDiscountRate).toBeLessThan(0.1);
    const bounded = buildBundle([item({ id: "x", listedPriceCents: 4000, floorPriceCents: 1000 }), item({ id: "y", listedPriceCents: 4000, floorPriceCents: 1000 }), item({ id: "z", listedPriceCents: 4000, floorPriceCents: 1000 })], "stale", { policy: negotiation.lot, floorPolicy: { maxDiscountRate: 0.1 }, rules })!;
    expect(bounded.floorCents).toBe(10_800);
    expect(bounded.suggestedDiscountRate).toBe(0.1);
    expect(bounded.bundlePriceCents).toBe(10_800);
  });
  it("réglages : désactivé → rien ; nombre d'articles et de propositions bornés", () => {
    expect(suggestBundles({ items, negotiation, rules, settings: bundleSettings.parse({ enabled: false }), now })).toEqual([]);
    const many = Array.from({ length: 6 }, (_, i) => item({ id: `m${i}`, brand: "Uniqlo", size: "L" }));
    const out = suggestBundles({ items: many, signals: { brandAffinity: true }, negotiation, rules, settings: bundleSettings.parse({ maxItems: 3 }), now });
    expect(out).toHaveLength(1);
    expect(out[0]!.itemIds).toHaveLength(3);
    const capped = suggestBundles({ items, signals: { buyerInterest: [{ customerId: "c1", itemIds: ["a", "b"] }, { customerId: "c2", itemIds: ["c", "d"] }] }, negotiation, rules, settings: bundleSettings.parse({ maxSuggestions: 1 }), now });
    expect(capped).toHaveLength(1);
  });
  it("politique de lot désactivée : la proposition existe sans remise", () => {
    const out = suggestBundles({ items, signals: { buyerInterest: [{ customerId: "c1", itemIds: ["a", "b"] }], brandAffinity: false }, negotiation: { lot: { ...negotiation.lot, enabled: false } }, rules, now });
    expect(out[0]).toMatchObject({ suggestedDiscountRate: 0, bundlePriceCents: 10_000 });
  });
});
