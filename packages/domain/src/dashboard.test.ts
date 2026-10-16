import { describe, expect, it } from "vitest";
import { order as orderSchema } from "@selio/contracts";
import { buildDashboard } from "./dashboard";
import { granularityFor, periodFromPreset, periodLabel, previousPeriod } from "./analytics";
import { makeItem } from "./test-fixtures";

const now = new Date("2026-10-16T12:00:00Z");

describe("périodes calendaires", () => {
  it("« ce mois-ci » couvre du 1er à aujourd'hui, comparé au mois précédent", () => {
    const p = periodFromPreset("month", now);
    expect(p.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const prev = previousPeriod(p, "month");
    expect(prev.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(prev.to.getTime()).toBeLessThanOrEqual(new Date("2026-10-01T00:00:00Z").getTime());
    expect(periodLabel("month", now)).toBe("octobre 2026");
    expect(granularityFor("month")).toBe("day");
  });
  it("« mois dernier » couvre le mois complet", () => {
    const p = periodFromPreset("last_month", now);
    expect(p.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("graphiques de la vue d'ensemble", () => {
  const item = makeItem({ status: "sold", soldAt: "2026-10-10T18:30:00Z", purchasedAt: "2026-10-01T10:00:00Z" });
  const o = orderSchema.parse({ id: "o1", orgId: "org", itemId: item.id, customerId: "c1", provider: "demo", dedupeKey: "k", status: "completed", salePriceCents: 6000, purchasePriceCents: 2500, purchaseFeesCents: 0, statusHistory: [], simulated: true, createdAt: "2026-10-10T18:30:00Z", updatedAt: "2026-10-10T18:30:00Z" });
  const stock = makeItem({ id: "it-2", purchasedAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z" });

  it("calcule les séries à partir des commandes et du stock", () => {
    const d = buildDashboard([item, stock], [o], periodFromPreset("month", now), now);
    expect(d.cumulativeMargin.at(-1)!.value).toBe(3500);
    expect(d.weekday[5]!.value).toBe(6000);
    expect(d.hours.find((h) => h.label === "18 h – 21 h")!.value).toBe(1);
    expect(d.categoryMix[0]).toMatchObject({ key: "men", value: 6000, secondary: 1 });
    expect(d.stockAging.find((b) => b.label === "31 – 60 j")!.value).toBe(1);
    expect(d.daysToSell.find((b) => b.label === "≤ 7 j")!.value + d.daysToSell.find((b) => b.label === "8 – 14 j")!.value).toBe(1);
    expect(d.monthlyGoal.achievedCents).toBe(6000);
    expect(d.buyVsSell[0]).toMatchObject({ value: 2500, secondary: 6000 });
  });
});
