import { describe, expect, it } from "vitest";
import type { AutoBuySettings } from "@selio/contracts";
import { autoBuyDecision, canStillCancel, cancelableUntil, dealEconomics, purchaseCost, scoreBand } from "./buying";

const settings: AutoBuySettings = { enabled: true, threshold: 85, dailyCapCents: 10_000, maxItemCents: 6_000, cancelWindowMinutes: 30, connectionId: null };
const opp = { id: "o1", score: 90, status: "new" as const, observed: { priceCents: 2000, shippingCents: 450 } as never, estimate: { marginCents: 2500 } as never };

describe("achats", () => {
  it("additionne prix, port et protection acheteurs", () => {
    expect(purchaseCost({ priceCents: 2000, shippingCents: 450 }, { fixedCents: 70, rate: 0.05 })).toEqual({ itemCents: 2000, shippingCents: 450, protectionCents: 170, totalCents: 2620 });
    expect(purchaseCost({ priceCents: 2000, shippingCents: 450 }).totalCents).toBe(2450);
  });

  it("calcule bénéfice, marge et rentabilité entre achat et vente", () => {
    const d = dealEconomics({ priceCents: 2000, shippingCents: 450 }, 6000, { fixedCents: 70, rate: 0.05 });
    expect(d.profitCents).toBe(3380);
    expect(d.marginRate).toBeCloseTo(0.5633, 3);
    expect(d.roi).toBeCloseTo(1.29, 2);
  });

  it("lit la grille de notation", () => {
    expect(scoreBand(40).label).toBe("Affaire faible");
    expect(scoreBand(74).key).toBe("fair");
    expect(scoreBand(80).advice).toBe("À valider à la main");
    expect(scoreBand(85).key).toBe("great");
    expect(scoreBand(97).label).toBe("Exceptionnelle");
  });

  it("achète seul au-dessus du seuil, dans les garde-fous", () => {
    expect(autoBuyDecision({ opportunity: opp, settings, spentTodayCents: 0, alreadyPurchased: false, fees: { fixedCents: 70, rate: 0.05 } })).toMatchObject({ buy: true, totalCents: 2620 });
    expect(autoBuyDecision({ opportunity: { ...opp, score: 80 }, settings, spentTodayCents: 0, alreadyPurchased: false }).buy).toBe(false);
    expect(autoBuyDecision({ opportunity: opp, settings: { ...settings, enabled: false }, spentTodayCents: 0, alreadyPurchased: false }).buy).toBe(false);
    expect(autoBuyDecision({ opportunity: opp, settings, spentTodayCents: 9_000, alreadyPurchased: false })).toMatchObject({ buy: false, reason: "Plafond de dépense du jour atteint" });
    expect(autoBuyDecision({ opportunity: opp, settings, spentTodayCents: 0, alreadyPurchased: true }).buy).toBe(false);
    expect(autoBuyDecision({ opportunity: { ...opp, observed: { priceCents: 7000, shippingCents: 450 } as never }, settings, spentTodayCents: 0, alreadyPurchased: false }).buy).toBe(false);
  });

  it("laisse un délai pour annuler", () => {
    const at = new Date("2026-10-16T12:00:00Z");
    const until = cancelableUntil(at, settings)!;
    expect(until).toBe("2026-10-16T12:30:00.000Z");
    expect(canStillCancel(until, new Date("2026-10-16T12:10:00Z"))).toBe(true);
    expect(canStillCancel(until, new Date("2026-10-16T12:31:00Z"))).toBe(false);
    expect(cancelableUntil(at, { cancelWindowMinutes: 0 })).toBeNull();
  });
});
