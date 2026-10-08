import { describe, expect, it } from "vitest";
import { buildDemoState } from "./seed";
import { checkPrice } from "@selio/domain";

describe("jeu de données de démonstration", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("est déterministe et cohérent", () => {
    const a = buildDemoState(now);
    const b = buildDemoState(now);
    expect(JSON.stringify({ ...a, itemEvents: [], usage: [], audit: [] }).length).toBe(JSON.stringify({ ...b, itemEvents: [], usage: [], audit: [] }).length);
    expect(a.items.length).toBeGreaterThan(20);
    for (const it of a.items) {
      if (it.listedPriceCents !== null && it.floorPriceCents !== null) {
        expect(it.floorPriceCents).toBeLessThanOrEqual(it.listedPriceCents);
        expect(checkPrice(it, it.listedPriceCents, a.org.settings.margin).ok).toBe(true);
      }
    }
    for (const o of a.orders) expect(a.items.some((i) => i.id === o.itemId)).toBe(true);
    for (const c of a.conversations) expect(a.customers.some((x) => x.id === c.customerId)).toBe(true);
    expect(new Set(a.orders.map((o) => o.dedupeKey)).size).toBe(a.orders.length);
  });
});
