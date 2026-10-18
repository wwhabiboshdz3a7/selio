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

describe("nouveaux modules (démonstration)", () => {
  it("générateur : photos → annonce simulée, prix issu des comparables, brouillon puis publication", async () => {
    const photo = { id: "p1", url: "data:image/jpeg;base64," + btoa("photo"), alt: "nike-air-max-blanche-42.jpg" };
    const draft = await client.generateListing({ photos: [photo], hints: {} });
    expect(draft.simulated).toBe(true);
    expect(draft.brand).toBe("Nike");
    expect(draft.category).toBe("shoes");
    expect(draft.suggestedPriceCents).toBeGreaterThan(0);
    expect(draft.priceLowCents).toBeLessThanOrEqual(draft.suggestedPriceCents);
    await expect(client.generateListing({ photos: [], hints: {} })).rejects.toMatchObject({ code: "validation" });
    const ai = await client.listAiRequests();
    expect(ai[0]!.kind).toBe("listing_generation");
  });

  it("dressing : filtre « en ligne depuis 7 j+ », republication avec variante marquée utilisée", async () => {
    const due = await client.getDressing({ filter: "due" });
    expect(due.listings.length).toBeGreaterThan(0);
    expect(due.listings.every((l) => l.performance.daysOnline >= due.republishAfterDays)).toBe(true);
    const target = due.listings[0]!;
    expect(target.plan.variants.length).toBeGreaterThanOrEqual(8);
    const next = target.plan.next!;
    const after = await client.republishItem(target.item.id, next.id);
    expect(after.title).toBe(next.title);
    expect(after.republications.at(-1)).toMatchObject({ variantId: next.id, mode: "manual" });
    const again = await client.getDressing({});
    const l = again.listings.find((x) => x.item.id === target.item.id)!;
    expect(l.performance.republishDue).toBe(false);
    expect(l.plan.variants.find((v) => v.id === next.id)!.uses).toBeGreaterThan(0);
    expect(l.plan.next!.id).not.toBe(next.id);
    const sorted = await client.listItems({ sort: "online_desc", minDaysOnline: 7 });
    expect(sorted.items.every((i) => i.status === "listed" || i.status === "reserved")).toBe(true);
  });

  it("bonnes affaires : validation en un clic, achat auto annulable dans le délai", async () => {
    const opps = await client.listOpportunities({ status: "new" });
    const good = opps.find((o) => o.score >= 75)!;
    const p = await client.quickBuy(good.id);
    expect(["simulated", "blocked"]).toContain(p.status);
    expect(p.mode).toBe("manual");
    await expect(client.quickBuy(good.id)).rejects.toMatchObject({ status: 409 });
    const run = await client.runAutoBuy();
    expect(run.evaluated).toBeGreaterThan(0);
    const purchases = await client.listPurchaseRequests();
    const auto = purchases.find((x) => x.mode === "auto" && x.status === "simulated" && x.cancelableUntil)!;
    const cancelled = await client.cancelPurchaseRequest(auto.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("marché : top revendeurs et niches ; vue d'ensemble « ce mois-ci »", async () => {
    const m = await client.getMarketInsights({ windowDays: 30 });
    expect(m.source).toBe("demo_simulator");
    expect(m.sellers.length).toBeGreaterThan(5);
    expect(m.sellers[0]!.revenueCents).toBeGreaterThanOrEqual(m.sellers[1]!.revenueCents);
    expect(m.niches[0]!.demand).toBeGreaterThan(0);
    const ov = await client.getOverview("month");
    expect(ov.periodLabel).toBe("octobre 2026");
    expect(ov.dashboard.weekday).toHaveLength(7);
    expect(ov.dressing.listed).toBeGreaterThan(0);
  });
});

describe("comptes Vinted catégorisés (démonstration)", () => {
  it("plusieurs comptes vente, achat et perso, catégorie modifiable, chiffres par compte", async () => {
    const vinted = (await client.listConnections()).filter((c) => c.provider === "vinted");
    expect(vinted.filter((c) => c.usage === "sale").length).toBeGreaterThanOrEqual(2);
    expect(vinted.filter((c) => c.usage === "purchase")).toHaveLength(1);
    expect(vinted.filter((c) => c.usage === "personal")).toHaveLength(1);
    const stats = await client.getConnectionStats();
    const statOf = (id: string) => stats.find((s) => s.connectionId === id)!;
    expect(vinted.filter((c) => c.usage === "sale").every((c) => statOf(c.id).listedItems > 0)).toBe(true);
    const buyer = vinted.find((c) => c.usage === "purchase")!;
    expect(statOf(buyer.id).purchases).toBeGreaterThan(0);
    const usage = await client.getUsage();
    expect(usage.connectionsCount).toBe(vinted.length);
    expect(usage.connectionsCount).toBeLessThanOrEqual(usage.quotas.connections);
    expect((await client.runAutoBuy()).account?.id).toBe(buyer.id);

    const moved = await client.updateConnection(buyer.id, { usage: "personal", label: "Ancien compte achats", displayHandle: "@marie.ancien" });
    expect(moved).toMatchObject({ usage: "personal", label: "Ancien compte achats", config: { displayHandle: "marie.ancien" } });
    await expect(client.updateConnection(buyer.id, {})).rejects.toThrow(/invalide/);
    expect((await client.runAutoBuy()).account).toBeNull();
  });

  it("n'automatise jamais une conversation d'un compte Perso", async () => {
    const sale = (await client.getConversation("conv-001")).connection!;
    await client.updateConnection(sale.id, { usage: "personal" });
    const rule = (await client.listRules()).find((r) => r.kind === "reply_on_new_message")!;
    const before = new Set((await client.listJobs({ ruleId: rule.id, pageSize: 200 })).items.map((j) => j.id));
    const res = await client.runRuleNow(rule.id);
    expect(res.skipped.some((s) => /Compte Perso/.test(s.reason))).toBe(true);
    const created = (await client.listJobs({ ruleId: rule.id, pageSize: 200 })).items.filter((j) => !before.has(j.id));
    expect(created.some((j) => j.payload.conversationId === "conv-001")).toBe(false);
  });
});

describe("aide et essai Découverte (démonstration)", () => {
  it("inscription : essai d'une semaine par défaut, ou d'un mois, toutes les fonctions du plan Pro", async () => {
    const days = (iso: string | null) => Math.round((new Date(iso!).getTime() - new Date("2026-10-08T12:00:00Z").getTime()) / 86_400_000);
    await client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa" });
    let sub = await client.getSubscription();
    expect(sub).toMatchObject({ plan: "pro", status: "trialing" });
    expect(days(sub.currentPeriodEnd)).toBe(7);
    await client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa", trialDays: 30 });
    sub = await client.getSubscription();
    expect(days(sub.currentPeriodEnd)).toBe(30);
  });
});
