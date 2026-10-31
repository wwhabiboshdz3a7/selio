import { describe, expect, it } from "vitest";
import type { MarketplaceConnection } from "@selio/contracts";
import { computeAccountStats, countByUsage, countsTowardQuota, isAutomatable, listingAccounts, resolvePurchaseAccount } from "./accounts";

type A = Pick<MarketplaceConnection, "id" | "usage" | "status" | "provider">;
const acc = (id: string, usage: A["usage"], status: A["status"] = "connected", provider: A["provider"] = "vinted"): A => ({ id, usage, status, provider });

describe("comptes catégorisés", () => {
  const list = [acc("demo", "sale", "connected", "demo"), acc("v1", "sale"), acc("buy1", "purchase", "disconnected"), acc("buy2", "purchase"), acc("perso", "personal", "ready")];

  it("n'automatise jamais un compte Perso", () => {
    expect(isAutomatable({ usage: "personal" })).toBe(false);
    expect(isAutomatable({ usage: "sale" })).toBe(true);
    expect(isAutomatable({ usage: "purchase" })).toBe(true);
    expect(isAutomatable(null)).toBe(true);
  });

  it("choisit un compte Achat actif, jamais un compte Vente ou Perso", () => {
    expect(resolvePurchaseAccount(list, "buy2")?.id).toBe("buy2");
    expect(resolvePurchaseAccount(list, "buy1")?.id).toBe("buy2");
    expect(resolvePurchaseAccount(list, "perso")?.id).toBe("buy2");
    expect(resolvePurchaseAccount(list, null)?.id).toBe("buy2");
    expect(resolvePurchaseAccount(list.filter((a) => a.usage !== "purchase"), null)).toBeNull();
  });

  it("propose les comptes Vente pour publier, Vinted d'abord, Perso en dernier", () => {
    expect(listingAccounts(list).map((a) => a.id)).toEqual(["v1", "demo", "perso"]);
  });

  it("compte par catégorie et exclut le simulateur du quota", () => {
    expect(countByUsage(list)).toEqual({ all: 5, sale: 2, purchase: 2, personal: 1 });
    expect(countsTowardQuota({ provider: "demo" })).toBe(false);
    expect(countsTowardQuota({ provider: "vinted" })).toBe(true);
  });
});

describe("chiffres par compte", () => {
  it("compte les annonces en ligne, les ventes du mois et les achats du compte", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const stats = computeAccountStats([{ id: "v1" }, { id: "buy" }], {
      items: [{ connectionId: "v1", status: "listed" }, { connectionId: "v1", status: "reserved" }, { connectionId: "v1", status: "sold" }, { connectionId: "buy", status: "in_stock" }],
      orders: [
        { connectionId: "v1", status: "paid", salePriceCents: 2000, createdAt: "2026-10-02T10:00:00Z" },
        { connectionId: "v1", status: "cancelled", salePriceCents: 9000, createdAt: "2026-10-03T10:00:00Z" },
        { connectionId: "v1", status: "completed", salePriceCents: 4000, createdAt: "2026-09-30T23:00:00Z" },
      ],
      purchases: [{ connectionId: "buy", status: "simulated", maxPriceCents: 790 }, { connectionId: "buy", status: "cancelled", maxPriceCents: 500 }],
      conversations: [{ connectionId: "v1", status: "open" }, { connectionId: "v1", status: "archived" }],
    }, now);
    expect(stats[0]).toEqual({ connectionId: "v1", listedItems: 2, salesThisMonth: 1, revenueThisMonthCents: 2000, purchases: 0, purchasesSpentCents: 0, openConversations: 1 });
    expect(stats[1]).toMatchObject({ connectionId: "buy", listedItems: 0, purchases: 1, purchasesSpentCents: 790 });
  });
});
