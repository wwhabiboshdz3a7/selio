import { describe, expect, it } from "vitest";
import { marginRules } from "@selio/contracts";
import { checkPrice, computeMargin, suggestFloorPrice } from "./pricing";

const rules = marginRules.parse({ minMarginRate: 0.25, minMarginCents: 500, defaultPlatformFeeRate: 0, defaultShippingCostCents: 0 });

describe("pricing", () => {
  it("calcule une marge brute = vente − frais − acquisition", () => {
    const m = computeMargin({ salePriceCents: 4500, platformFeeCents: 0, shippingCostCents: 300, purchasePriceCents: 1500, purchaseFeesCents: 200 });
    expect(m.marginCents).toBe(2500);
    expect(m.feesCents).toBe(300);
    expect(m.acquisitionCents).toBe(1700);
    expect(m.marginRate).toBeCloseTo(2500 / 4500);
  });
  it("une marge négative reste signée", () => {
    expect(computeMargin({ salePriceCents: 1000, purchasePriceCents: 1500 }).marginCents).toBe(-500);
  });
  it("suggère un plancher qui respecte marge absolue et taux", () => {
    // acquisition 1700 ; par taux : 1700 / 0.75 = 2267 ; par absolu : 2200 → 2267
    expect(suggestFloorPrice({ purchasePriceCents: 1500, purchaseFeesCents: 200 }, rules)).toBe(2267);
    // acquisition 400 : par taux 534, par absolu 900 → 900
    expect(suggestFloorPrice({ purchasePriceCents: 400, purchaseFeesCents: 0 }, rules)).toBe(900);
  });
  it("vérifie un prix contre plancher et marges", () => {
    const item = { purchasePriceCents: 1500, purchaseFeesCents: 200, listedPriceCents: 4500, floorPriceCents: 3000 };
    expect(checkPrice(item, 3200, rules).ok).toBe(true);
    const low = checkPrice(item, 2900, rules);
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.reason).toBe("below_floor");
    const noFloor = { ...item, floorPriceCents: null };
    const r = checkPrice(noFloor, 2100, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("below_floor");
    expect(checkPrice(item, null, rules).ok).toBe(false);
  });
});
