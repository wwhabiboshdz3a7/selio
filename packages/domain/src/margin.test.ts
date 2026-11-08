import { describe, expect, it } from "vitest";
import { inventoryItem, order as orderSchema, type InventoryItem, type Order } from "@selio/contracts";
import { endToEndMargin, itemMargins, marginInputFromItem, marginInputFromOpportunity, marginTotals, marginsByPeriod } from "./margin";

const item = (over: Partial<InventoryItem> = {}): InventoryItem =>
  inventoryItem.parse({ id: "it-1", orgId: "org", title: "Veste", purchasePriceCents: 2000, purchaseFeesCents: 300, listedPriceCents: 5000, status: "listed", listedAt: "2026-09-01T10:00:00Z", createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", ...over });
const order = (over: Partial<Order> = {}): Order =>
  orderSchema.parse({ id: "o-1", orgId: "org", itemId: "it-1", customerId: "c-1", dedupeKey: "k", status: "paid", salePriceCents: 4500, platformFeeCents: 0, shippingCostCents: 0, otherCostsCents: 0, purchasePriceCents: 2000, purchaseFeesCents: 300, createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z", ...over });

describe("marge de bout en bout", () => {
  it("projetée : prix affiché moins achat, port, frais acheteur, emballage et autres coûts", () => {
    const m = endToEndMargin({ purchase: { priceCents: 1500, shippingCents: 300, buyerFeesCents: 145 }, listing: { listedPriceCents: 4000 }, costs: { packagingCents: 50, otherCents: 0 } });
    expect(m.status).toBe("projected");
    expect(m.costCents).toBe(1995);
    expect(m.revenueCents).toBe(4000);
    expect(m.marginCents).toBe(2005);
    expect(m.marginRate).toBeCloseTo(2005 / 4000, 6);
    expect(m.priceKnown).toBe(true);
  });
  it("réalisée : prix de vente moins frais vendeur et port à charge vendeur, en plus du coût d'achat", () => {
    const m = endToEndMargin({ purchase: { priceCents: 1500, shippingCents: 300, buyerFeesCents: 145 }, listing: { listedPriceCents: 4000 }, sale: { salePriceCents: 3600, sellerFeesCents: 100, shippingPaidBySellerCents: 400 } });
    expect(m.status).toBe("realized");
    expect(m.revenueCents).toBe(3600);
    expect(m.costCents).toBe(1500 + 300 + 145 + 100 + 400);
    expect(m.marginCents).toBe(3600 - 2445);
    expect(m.breakdown).toMatchObject({ sellerFeesCents: 100, shippingPaidBySellerCents: 400, packagingCents: 0 });
  });
  it("sans prix affiché : marge = − coût, taux 0, prix inconnu signalé", () => {
    const m = endToEndMargin({ purchase: { priceCents: 1200 }, listing: { listedPriceCents: null } });
    expect(m).toMatchObject({ status: "projected", revenueCents: 0, costCents: 1200, marginCents: -1200, marginRate: 0, priceKnown: false });
    const none = endToEndMargin({ purchase: { priceCents: 1200 } });
    expect(none.priceKnown).toBe(false);
  });
  it("refuse les montants non entiers ou négatifs (centimes seulement)", () => {
    expect(() => endToEndMargin({ purchase: { priceCents: 12.5 } })).toThrow(RangeError);
    expect(() => endToEndMargin({ purchase: { priceCents: -5 } })).toThrow(RangeError);
    expect(() => endToEndMargin({ purchase: { priceCents: 100 }, sale: { salePriceCents: 200, sellerFeesCents: -1 } })).toThrow(RangeError);
  });
  it("depuis un article Manager : frais d'acquisition comptés, commande payée = marge réalisée, commande annulée = projetée", () => {
    const projected = endToEndMargin(marginInputFromItem(item()));
    expect(projected).toMatchObject({ status: "projected", costCents: 2300, revenueCents: 5000, marginCents: 2700 });
    const realized = endToEndMargin(marginInputFromItem(item(), order({ salePriceCents: 4500, shippingCostCents: 200, otherCostsCents: 50 })));
    expect(realized).toMatchObject({ status: "realized", revenueCents: 4500, costCents: 2300 + 200 + 50, marginCents: 4500 - 2550 });
    const cancelled = endToEndMargin(marginInputFromItem(item(), order({ status: "cancelled" })));
    expect(cancelled.status).toBe("projected");
  });
  it("depuis une affaire Radar : prix, port et protection acheteurs forment le coût, la revente estimée est le prix affiché", () => {
    const input = marginInputFromOpportunity({ priceCents: 2000, shippingCents: 300 }, 5000, { fixedCents: 70, rate: 0.05 });
    expect(input.purchase).toEqual({ priceCents: 2000, shippingCents: 300, buyerFeesCents: 170 });
    const m = endToEndMargin(input);
    expect(m).toMatchObject({ status: "projected", costCents: 2470, revenueCents: 5000, marginCents: 2530 });
    expect(endToEndMargin(marginInputFromOpportunity({ priceCents: 2000, shippingCents: 0 }, null)).priceKnown).toBe(false);
  });
});

describe("agrégation des marges par période", () => {
  it("totaux : somme des coûts, revenus et marges, taux global, articles sans prix comptés à part", () => {
    const t = marginTotals([
      endToEndMargin({ purchase: { priceCents: 1000 }, listing: { listedPriceCents: 3000 } }),
      endToEndMargin({ purchase: { priceCents: 500 }, listing: { listedPriceCents: null } }),
    ]);
    expect(t).toEqual({ count: 2, pricedCount: 1, costCents: 1500, revenueCents: 3000, marginCents: 1500, marginRate: 0.5 });
  });
  it("vendus sur la période (datés par la vente) / en stock (photographie, jamais filtrée)", () => {
    const items = [item(), item({ id: "it-2", listedPriceCents: 3000, purchasePriceCents: 1000, purchaseFeesCents: 0 }), item({ id: "it-3", status: "sold" }), item({ id: "it-4", status: "archived" })];
    const orders = [
      order({ id: "o-1", itemId: "it-1", createdAt: "2026-10-05T10:00:00Z" }),
      order({ id: "o-old", itemId: "it-1", status: "refunded", createdAt: "2026-09-01T10:00:00Z" }),
      order({ id: "o-3", itemId: "it-3", salePriceCents: 2600, createdAt: "2026-08-15T10:00:00Z" }),
    ];
    const margins = itemMargins(items, orders);
    expect(margins.map((m) => [m.itemId, m.margin.status])).toEqual([["it-1", "realized"], ["it-2", "projected"], ["it-3", "realized"]]);
    const october = marginsByPeriod(margins, { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") });
    expect(october.sold.count).toBe(1);
    expect(october.sold.revenueCents).toBe(4500);
    expect(october.inStock).toMatchObject({ count: 1, revenueCents: 3000, marginCents: 2000 });
    const all = marginsByPeriod(margins);
    expect(all.sold.count).toBe(2);
    expect(all.all.count).toBe(3);
  });
  it("un article vendu sans commande connue n'est pas inventé comme marge réalisée", () => {
    expect(itemMargins([item({ status: "sold" })], [])).toEqual([]);
  });
});
