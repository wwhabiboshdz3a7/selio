import { describe, expect, it } from "vitest";
import { marginRules, order as orderSchema } from "@selio/contracts";
import { buildDashboard, dashboardWithoutFinances } from "./dashboard";
import { periodFromPreset } from "./analytics";
import { MARGIN_HIDDEN_REASON, evaluateOffer, reasonsWithoutFinances } from "./negotiation";
import { thresholdStatus, thresholdTextWithoutAmounts } from "./thresholds";
import { makeItem } from "./test-fixtures";

/**
 * Finances masquées pour l'exécuteur et le contributeur photos (§5.15) : vues construites sans montant,
 * indépendamment de la liste de clés masquées à la sortie de l'API.
 */

const now = new Date("2026-10-16T12:00:00Z");

describe("vue d'ensemble sans finances", () => {
  const sold = makeItem({ status: "sold", soldAt: "2026-10-10T18:30:00Z", purchasedAt: "2026-10-01T10:00:00Z" });
  const stock = makeItem({ id: "it-2", purchasePriceCents: 1500, purchaseFeesCents: 100, purchasedAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z" });
  const o = orderSchema.parse({ id: "o1", orgId: "org", itemId: sold.id, customerId: "c1", provider: "demo", dedupeKey: "k", status: "completed", salePriceCents: 3800, purchasePriceCents: 1500, purchaseFeesCents: 100, statusHistory: [], simulated: true, createdAt: "2026-10-10T18:30:00Z", updatedAt: "2026-10-10T18:30:00Z" });
  const full = buildDashboard([sold, stock], [o], periodFromPreset("30d", now), now);

  it("aucun montant connu (achat 1500, coût 1600, vente 3800) dans les agrégats", () => {
    expect(JSON.stringify(full)).toMatch(/3800/);
    const reduced = dashboardWithoutFinances(full);
    expect(JSON.stringify(reduced)).not.toMatch(/\b(1500|1600|3800|2200|2300|4180)\b/);
    expect(reduced).toMatchObject({ cumulativeMargin: [], marginRateSeries: [], basketSeries: [], categoryMix: [], brandMargin: [], stockValueByCategory: [], buyVsSell: [] });
    expect(reduced.monthlyGoal).toMatchObject({ targetCents: 0, achievedCents: 0, previousMonthCents: 0, daysInMonth: full.monthlyGoal.daysInMonth });
  });

  it("garde les comptes : ventes par jour en nombre, ancienneté du stock en articles, heures, statuts", () => {
    const reduced = dashboardWithoutFinances(full);
    expect(reduced.weekday.reduce((n, w) => n + w.value, 0)).toBe(1);
    expect(reduced.weekday.every((w) => w.secondary === undefined)).toBe(true);
    expect(reduced.stockAging.reduce((n, b) => n + b.value, 0)).toBe(1);
    expect(reduced.stockAging.every((b) => b.secondary === undefined)).toBe(true);
    expect(reduced.hours).toEqual(full.hours);
    expect(reduced.orderStatus).toEqual(full.orderStatus);
  });
});

describe("seuils de déclaration sans montant", () => {
  it("le texte ne dit ni le montant encaissé ni ce qu'il reste en euros", () => {
    const s = thresholdStatus({ salesThisYear: 12, revenueThisYearCents: 170_000, now });
    expect(s.text).toMatch(/€ encaissés/);
    const t = thresholdTextWithoutAmounts(s);
    expect(t).not.toMatch(/€/);
    expect(t).toMatch(/12 ventes/);
    expect(t).toMatch(/approche/);
    expect(t).toMatch(/pas un conseil fiscal/);
    expect(thresholdTextWithoutAmounts(thresholdStatus({ salesThisYear: 31, revenueThisYearCents: 10_000, now }))).toMatch(/seuil de 30 ventes est atteint/);
  });
});

describe("raisons de négociation sans marge", () => {
  const rules = marginRules.parse({ minMarginRate: 0.25, minMarginCents: 500, maxDiscountRate: 0.2, counterStepRate: 0.05, maxRoundsPerCustomer: 2 });
  const item = { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 1000 };

  it("« Marge conservée » retirée, plancher et remise gardés", () => {
    const r = evaluateOffer({ item, offerCents: 3500, rules, roundsSoFar: 0 });
    expect(r.reasons.join(" ")).toMatch(/Marge conservée/);
    const hidden = reasonsWithoutFinances(r.reasons);
    expect(hidden.join(" ")).not.toMatch(/Marge conservée/);
    expect(hidden.join(" ")).toMatch(/plancher \(10,00 €\)/);
  });

  it("marge minimale ou taux insuffisant : phrase générique, sans chiffres", () => {
    const low = evaluateOffer({ item, offerCents: 1800, rules, roundsSoFar: 0 });
    expect(low.reasons.join(" ")).toMatch(/Marge absolue insuffisante|Taux de marge insuffisant/);
    const hidden = reasonsWithoutFinances(low.reasons);
    expect(hidden).toContain(MARGIN_HIDDEN_REASON);
    expect(hidden.join(" ")).not.toMatch(/insuffisante \(|insuffisant \(/);
    // Une seule phrase générique, même si plusieurs raisons chiffraient la marge.
    expect(reasonsWithoutFinances(["Marge absolue insuffisante (3,00 € < 5,00 €).", "Taux de marge insuffisant (10 % < 25 %)."])).toEqual([MARGIN_HIDDEN_REASON]);
    // Les raisons sans marge chiffrée passent telles quelles.
    expect(reasonsWithoutFinances(["Marge estimée nulle ou négative : note plafonnée à 10."])).toEqual(["Marge estimée nulle ou négative : note plafonnée à 10."]);
  });
});
