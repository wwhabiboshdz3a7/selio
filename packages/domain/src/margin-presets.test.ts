import { describe, expect, it } from "vitest";
import { marginRules } from "@selio/contracts";
import { MARGIN_PRESETS, applyMarginPreset, matchMarginPreset, negotiationPath } from "./margin-presets";

const defaults = marginRules.parse({});
const item = { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000 };

describe("préréglages de négociation", () => {
  it("« Équilibré » correspond aux réglages par défaut", () => {
    expect(matchMarginPreset(defaults)).toBe("balanced");
  });

  it("appliquer un préréglage garde les frais de l'organisation", () => {
    const withFees = { ...defaults, defaultPlatformFeeRate: 0.05, defaultShippingCostCents: 300 };
    const r = applyMarginPreset(withFees, "careful");
    expect(r.defaultPlatformFeeRate).toBe(0.05);
    expect(r.defaultShippingCostCents).toBe(300);
    expect(r.maxDiscountRate).toBe(0.1);
    expect(matchMarginPreset(r)).toBe("careful");
  });

  it("tout réglage modifié à la main sort des préréglages", () => {
    expect(matchMarginPreset({ ...defaults, maxDiscountRate: 0.21 })).toBeNull();
  });

  it("chaque préréglage est valide pour le schéma", () => {
    for (const p of MARGIN_PRESETS) expect(() => marginRules.parse({ ...defaults, ...p.rules })).not.toThrow();
  });

  it("déroule les contre-propositions jusqu'à l'escalade", () => {
    const path = negotiationPath(item, 2500, defaults);
    expect(path.map((s) => s.decision)).toEqual(["counter", "counter", "escalate"]);
    expect(path.map((s) => s.counterCents)).toEqual([3800, 3600, null]);
  });

  it("s'arrête dès l'acceptation", () => {
    expect(negotiationPath(item, 3600, defaults).map((s) => s.decision)).toEqual(["accept"]);
  });
});
