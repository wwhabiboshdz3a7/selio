import { describe, expect, it } from "vitest";
import { inventoryItem, order as orderSchema } from "@selio/contracts";
import { breakdownBy, periodFromPreset, salesKpis, salesSeries, stockKpis } from "./analytics";

const mk = (over: Partial<ReturnType<typeof orderSchema.parse>>) =>
  orderSchema.parse({
    id: Math.random().toString(36).slice(2), orgId: "o", itemId: "i", customerId: "c", dedupeKey: Math.random().toString(36), salePriceCents: 4000,
    purchasePriceCents: 1000, status: "completed", createdAt: "2026-10-05T10:00:00.000Z", updatedAt: "2026-10-05T10:00:00.000Z", ...over,
  });

describe("analytics", () => {
  it("calcule CA, marge, panier moyen sans les annulées", () => {
    const k = salesKpis([mk({}), mk({ salePriceCents: 2000, purchasePriceCents: 500 }), mk({ status: "cancelled" })]);
    expect(k.orderCount).toBe(2);
    expect(k.revenueCents).toBe(6000);
    expect(k.marginCents).toBe(4500);
    expect(k.averageBasketCents).toBe(3000);
    expect(k.marginRate).toBeCloseTo(0.75);
  });
  it("respecte la période", () => {
    const period = periodFromPreset("7d", new Date("2026-10-08T12:00:00Z"));
    const k = salesKpis([mk({}), mk({ createdAt: "2026-09-01T10:00:00.000Z" })], period);
    expect(k.orderCount).toBe(1);
  });
  it("produit une série journalière complète", () => {
    const period = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-08T00:00:00Z") };
    const s = salesSeries([mk({})], period, "day");
    expect(s).toHaveLength(7);
    expect(s[4]!.revenueCents).toBe(4000);
  });
  it("ventile par clé", () => {
    const rows = breakdownBy([mk({ provider: "demo" }), mk({ provider: "vinted", salePriceCents: 9000 })], (o) => o.provider);
    expect(rows[0]!.key).toBe("vinted");
  });
  it("calcule les KPI de stock et la rotation", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const items = [
      inventoryItem.parse({ id: "1", orgId: "o", title: "A", status: "listed", listedPriceCents: 3000, purchasePriceCents: 1000, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }),
      inventoryItem.parse({ id: "2", orgId: "o", title: "B", status: "sold", purchasePriceCents: 500, purchasedAt: "2026-09-01T00:00:00.000Z", soldAt: "2026-09-11T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }),
      inventoryItem.parse({ id: "3", orgId: "o", title: "C", status: "archived", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }),
    ];
    const k = stockKpis(items, now);
    expect(k.activeCount).toBe(1);
    expect(k.stockValueCents).toBe(1000);
    expect(k.listedValueCents).toBe(3000);
    expect(k.averageDaysToSell).toBe(10);
    expect(k.staleCount).toBe(1);
    expect(k.sellThroughRate).toBeCloseTo(0.5);
  });
});
