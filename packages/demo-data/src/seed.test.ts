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
  it("contre-offres de démo : formule neutre au-dessus du plancher, jamais « meilleur prix », tours de négociation comptés", () => {
    const a = buildDemoState(now);
    const outbound = a.messages.filter((m) => m.direction === "outbound");
    expect(outbound.length).toBeGreaterThan(0);
    for (const m of outbound) expect(m.body).not.toMatch(/meilleur prix/i);
    const counter = outbound.find((m) => /Je peux vous le faire à/.test(m.body));
    expect(counter).toBeDefined();
    expect(counter!.body).toContain("Si cela vous convient, faites l'offre à ce montant.");
    // Le prix proposé en démo reste au-dessus du plancher : la formule « dernier prix » n'y a pas sa place.
    const conv = a.conversations.find((c) => c.id === counter!.conversationId)!;
    const item = a.items.find((i) => i.id === conv.itemId)!;
    const proposed = Math.round(Number.parseFloat(counter!.body.match(/à (\d+(?:,\d+)?) €/)![1]!.replace(",", ".")) * 100);
    expect(proposed).toBeGreaterThan(item.floorPriceCents ?? 0);
    expect(conv.negotiationRounds).toBe(1);
  });
});
