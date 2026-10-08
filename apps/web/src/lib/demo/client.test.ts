import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { DemoClient } from "./client";

let client: DemoClient;
beforeEach(async () => {
  client = new DemoClient(new MemoryDemoStorage(), () => new Date("2026-10-08T12:00:00Z"));
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
});

describe("client de démonstration", () => {
  it("applique les règles de marge à la création et au changement de statut", async () => {
    const it = await client.createItem({ title: "Veste", purchasePriceCents: 1500, purchaseFeesCents: 200, listedPriceCents: 4500, floorPriceCents: 3500, status: "listed" });
    expect(it.sku).toMatch(/^OTH-\d{4}$/);
    await expect(client.setItemStatus(it.id, "archived")).resolves.toMatchObject({ status: "archived" });
    await expect(client.setItemStatus(it.id, "sold")).rejects.toThrow(/interdit/);
    const history = await client.itemHistory(it.id);
    expect(history.map((h) => h.kind)).toEqual(["status_changed", "created"]);
  });

  it("suggère une réponse validée, envoie en simulation et signale un échec", async () => {
    const detail = await client.getConversation("conv-001");
    expect(detail.lastOffer?.evaluation.decision).toBe("counter");
    const s = await client.suggestReply("conv-001");
    expect(s.validated).toBe(true);
    expect(s.suggestion.intent).toBe("counter_offer");
    expect(s.draft.status).toBe("draft");
    const sent = await client.sendMessage(s.draft.id);
    expect(sent.status).toBe("sent");
    expect(sent.simulated).toBe(true);
    const fail = await client.createDraft({ conversationId: "conv-001", body: "Test [échec]" });
    const failed = await client.sendMessage(fail.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/refusé/);
    const after = await client.getConversation("conv-001");
    expect(after.messages.some((m) => m.id === fail.id && m.status === "failed")).toBe(true);
  });

  it("ne crée jamais deux commandes pour le même article, client et jour", async () => {
    const d = await client.getConversation("conv-001");
    const a = await client.createOrder({ itemId: d.item!.id, customerId: d.customer.id, salePriceCents: 4000 });
    const b = await client.createOrder({ itemId: d.item!.id, customerId: d.customer.id, salePriceCents: 4000 });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.order.id).toBe(a.order.id);
    expect((await client.getItem(d.item!.id)).status).toBe("reserved");
    await client.transitionOrder(a.order.id, "paid");
    expect((await client.getItem(d.item!.id)).status).toBe("sold");
    await expect(client.transitionOrder(a.order.id, "completed")).rejects.toThrow(/interdite/);
  });

  it("exécute une règle de façon idempotente et respecte l'arrêt global", async () => {
    const r1 = await client.runRuleNow("rule-1");
    expect(r1.created).toBeGreaterThan(0);
    const r2 = await client.runRuleNow("rule-1");
    expect(r2.created).toBe(0);
    await client.setGlobalPause(true);
    await client.simulateIncomingMessage("conv-003", "Toujours dispo ?");
    const r3 = await client.runRuleNow("rule-1");
    expect(r3.created).toBe(0);
    expect(r3.skipped.some((s) => s.reason === "global_pause")).toBe(true);
  });

  it("simule l'achat assisté sans jamais l'exécuter réellement", async () => {
    const opps = await client.listOpportunities({ status: "new" });
    const p = await client.createPurchaseRequest({ opportunityId: opps[0]!.id, maxPriceCents: 10_000, budgetCents: 20_000 });
    await expect(client.createPurchaseRequest({ opportunityId: opps[0]!.id, maxPriceCents: 10_000, budgetCents: 20_000 })).rejects.toThrow(/doublon/);
    const c = await client.confirmPurchaseRequest(p.id);
    expect(c.status).toBe("simulated");
    expect(c.checks.find((x) => x.code === "connector_authorized")?.ok).toBe(false);
  });

  it("réinitialise la démonstration", async () => {
    await client.createItem({ title: "Temporaire" });
    await client.resetDemo();
    const page = await client.listItems({ q: "Temporaire" });
    expect(page.total).toBe(0);
  });
});
