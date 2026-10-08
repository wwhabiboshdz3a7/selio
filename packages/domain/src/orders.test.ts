import { describe, expect, it } from "vitest";
import { order as orderSchema } from "@selio/contracts";
import { OrderTransitionError, orderDedupeKey, transitionOrder } from "./orders";

const base = orderSchema.parse({
  id: "o1", orgId: "org", itemId: "i1", customerId: "c1", dedupeKey: "demo:i1:c1:2026-10-01", salePriceCents: 3000,
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z",
});

describe("commandes", () => {
  it("suit les transitions autorisées", () => {
    const paid = transitionOrder(base, "paid", "2026-10-01T11:00:00.000Z");
    const shipped = transitionOrder(paid, "shipped", "2026-10-02T11:00:00.000Z");
    expect(shipped.status).toBe("shipped");
    expect(shipped.statusHistory).toHaveLength(2);
  });
  it("refuse les transitions interdites", () => {
    expect(() => transitionOrder(base, "delivered", "2026-10-01T11:00:00.000Z")).toThrow(OrderTransitionError);
    const cancelled = transitionOrder(base, "cancelled", "2026-10-01T11:00:00.000Z");
    expect(() => transitionOrder(cancelled, "paid", "2026-10-01T12:00:00.000Z")).toThrow();
  });
  it("construit une clé d'idempotence stable", () => {
    expect(orderDedupeKey({ provider: "vinted", externalRef: "TX-1", itemId: "i", customerId: "c", day: "2026-10-01" })).toBe("vinted:TX-1");
    expect(orderDedupeKey({ provider: "demo", itemId: "i", customerId: "c", day: "2026-10-01" })).toBe("demo:i:c:2026-10-01");
  });
});
