import { describe, expect, it } from "vitest";
import { declarationThresholds, orgSettings, order as orderSchema, type Order } from "@selio/contracts";
import { DEFAULT_THRESHOLDS, THRESHOLD_DISCLAIMER, thresholdStatus, thresholdStatusForOrders, thresholdsFromSettings, yearTotals } from "./thresholds";

const now = new Date("2026-11-07T12:00:00Z");
const order = (over: Partial<Order> = {}): Order =>
  orderSchema.parse({ id: "o", orgId: "org", itemId: "it", customerId: "c", dedupeKey: "k", status: "paid", salePriceCents: 1000, createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-01T10:00:00Z", ...over });

describe("seuils de déclaration : information factuelle, jamais un conseil fiscal", () => {
  it("valeurs 2026 par défaut, paramétrables par les réglages de l'organisation", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ salesCount: 30, revenueCents: 200_000, year: 2026 });
    const settings = orgSettings.parse({}).thresholds;
    expect(settings).toEqual({ enabled: true, salesCount: 30, revenueCents: 200_000, approachingRate: 0.8 });
    expect(thresholdsFromSettings(declarationThresholds.parse({ salesCount: 40, revenueCents: 300_000 }), 2027)).toEqual({ salesCount: 40, revenueCents: 300_000, year: 2027 });
    expect(() => declarationThresholds.parse({ salesCount: 0 })).toThrow();
  });
  it("« none » sous 80 % des deux seuils", () => {
    const s = thresholdStatus({ salesThisYear: 10, revenueThisYearCents: 50_000, now });
    expect(s.level).toBe("none");
    expect(s.year).toBe(2026);
    expect(s.nextThreshold).toMatchObject({ kind: "sales", remaining: 20 });
    expect(s.text).toContain("10 ventes et 500,00 € encaissés");
    expect(s.text).toContain("Vous êtes en dessous des deux seuils.");
  });
  it("« approaching » à partir de 80 % de l'un des seuils, avec ce qu'il reste", () => {
    const bySales = thresholdStatus({ salesThisYear: 24, revenueThisYearCents: 50_000, now });
    expect(bySales.level).toBe("approaching");
    expect(bySales.nextThreshold).toEqual({ kind: "sales", value: 30, remaining: 6, ratio: 0.8 });
    expect(bySales.text).toContain("Vous approchez du seuil de 30 ventes : il reste 6 ventes");
    const byRevenue = thresholdStatus({ salesThisYear: 5, revenueThisYearCents: 170_000, now });
    expect(byRevenue.level).toBe("approaching");
    expect(byRevenue.nextThreshold?.kind).toBe("revenue");
    expect(byRevenue.text).toContain("il reste 300,00 € avant de l'atteindre");
  });
  it("« reached » dès qu'un seuil est atteint ; les deux atteints → plus de prochain seuil", () => {
    const sales = thresholdStatus({ salesThisYear: 30, revenueThisYearCents: 10_000, now });
    expect(sales.level).toBe("reached");
    expect(sales.reached).toEqual(["sales"]);
    expect(sales.nextThreshold?.kind).toBe("revenue");
    expect(sales.text).toContain("Seuil atteint : celui de 30 ventes (30 ventes)");
    const both = thresholdStatus({ salesThisYear: 45, revenueThisYearCents: 250_000, now });
    expect(both.reached).toEqual(["sales", "revenue"]);
    expect(both.nextThreshold).toBeNull();
  });
  it("le texte dit que Selio n'est pas un conseil fiscal et renvoie vers l'administration, sans conseil", () => {
    for (const s of [thresholdStatus({ salesThisYear: 0, revenueThisYearCents: 0, now }), thresholdStatus({ salesThisYear: 29, revenueThisYearCents: 0, now }), thresholdStatus({ salesThisYear: 31, revenueThisYearCents: 0, now })]) {
      expect(s.text).toContain("Selio n'est pas un conseil fiscal");
      expect(s.text).toContain("renseignez-vous auprès de l'administration");
      expect(s.text.endsWith(THRESHOLD_DISCLAIMER)).toBe(true);
      expect(s.text).not.toMatch(/vous devez|il faut|devrez|déclarez|impôt|imposable|recommand|optimis/i);
      // « conseil » n'apparaît que pour dire que ce n'en est pas un.
      expect(s.text.replace(/(n'est )?pas un conseil fiscal/g, "")).not.toMatch(/conseil/i);
    }
  });
  it("seuils personnalisés et taux d'alerte personnalisé", () => {
    const s = thresholdStatus({ salesThisYear: 18, revenueThisYearCents: 0, thresholds: { salesCount: 20, revenueCents: 100_000, year: 2027 }, approachingRate: 0.9, now });
    expect(s.level).toBe("approaching");
    expect(s.text).toContain("20 ventes ou 1 000,00 € sur l'année (valeurs 2027");
    expect(thresholdStatus({ salesThisYear: 17, revenueThisYearCents: 0, thresholds: { salesCount: 20, revenueCents: 100_000, year: 2027 }, approachingRate: 0.9, now }).level).toBe("none");
  });
  it("totaux de l'année civile : commandes qui comptent dans le CA, datées par leur création", () => {
    const orders = [order(), order({ id: "o2", salePriceCents: 2500 }), order({ id: "o3", status: "cancelled" }), order({ id: "o4", createdAt: "2025-12-31T23:00:00Z" }), order({ id: "o5", status: "refunded" })];
    expect(yearTotals(orders, 2026)).toEqual({ salesThisYear: 2, revenueThisYearCents: 3500 });
    const s = thresholdStatusForOrders(orders, declarationThresholds.parse({ salesCount: 2 }), now);
    expect(s.level).toBe("reached");
  });
});
