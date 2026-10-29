import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage, PRICING } from "@selio/demo-data";
import { CARD_VERIFICATION_AMOUNT_CENTS } from "@selio/contracts";
import { effectiveAiQuota, isGenerated, listingInsights } from "@selio/domain";
import { addMonthsUtc } from "../billing";
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
    // Le compteur suit la même règle que le serveur : utilisé / quota du plan, pourcentage plafonné à 100.
    expect(usage.counters.connections).toMatchObject({ used: vinted.length, quota: usage.quotas.connections, exceeded: vinted.length >= usage.quotas.connections });
    expect(usage.counters.connections.percent).toBeLessThanOrEqual(100);
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

describe("aide et essai de 14 jours (démonstration)", () => {
  it("répond depuis la FAQ, signale la simulation et cite des sources", async () => {
    const a = await client.askHelp("Selio est-il affilié à Vinted ?");
    expect(a).toMatchObject({ found: true, source: "faq", simulated: true, provider: null });
    expect(a.sources[0]).toMatchObject({ id: "affiliation-vinted", categoryTitle: "Démarrer" });
    expect(a.answer).toMatch(/indépendant/);
    expect(a.fallbackReason).toMatch(/Démonstration/);
    const none = await client.askHelp("Quelle est la météo demain ?");
    expect(none).toMatchObject({ found: false, sources: [] });
    await expect(client.askHelp("?")).rejects.toThrow(/trois caractères/);
  });

  it("inscription : essai de 14 jours, seule durée, toutes les fonctions du plan Pro, carte pas encore demandée", async () => {
    const days = (iso: string | null) => Math.round((new Date(iso!).getTime() - new Date("2026-10-08T12:00:00Z").getTime()) / 86_400_000);
    await client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa" });
    let sub = await client.getSubscription();
    expect(sub).toMatchObject({ plan: "pro", status: "trialing", cardOnFile: false, cancelAtPeriodEnd: false, quotas: { connections: 3, studioListingsPerMonth: 20 } });
    expect(days(sub.currentPeriodEnd)).toBe(14);
    await client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa", trialDays: 14 });
    sub = await client.getSubscription();
    expect(days(sub.currentPeriodEnd)).toBe(14);
    expect((await client.listAuditLogs()).find((a) => a.action === "auth.register")?.meta).toMatchObject({ trialDays: 14 });
  });

  it("paiement : Starter, Pro et Agence sont des offres, aucun formulaire ni débit en démonstration", async () => {
    const r = await client.startCheckout("agence");
    expect(r).toMatchObject({ orderToken: null, simulated: true, mode: "sandbox" });
    expect(r.message).toMatch(/Agence/);
    // La démo a déjà une carte enregistrée : l'offre est retenue pour la fin de l'essai (journalisé comme changement d'offre).
    expect((await client.listAuditLogs()).some((a) => a.action === "billing.plan_change_requested" && a.meta.to === "agence" && a.meta.simulated === true)).toBe(true);
    await expect(client.startCheckout("free" as never)).rejects.toThrow(/Starter, Pro ou Agence/);
  });
});

describe("abonnement, résiliation et factures (démonstration, horloge injectée)", () => {
  let now: Date;
  let c: DemoClient;
  const START = new Date("2026-10-08T12:00:00Z");
  beforeEach(async () => {
    now = START;
    c = new DemoClient(new MemoryDemoStorage(), () => now);
    await c.login({ email: "marie@demo.selio.local", password: "demo" });
  });

  it("la démo a une carte enregistrée « pour le marchand » (bac à sable) ; choisir une offre la retient pour la fin de l'essai", async () => {
    const s = await c.getSubscription();
    expect(s).toMatchObject({ status: "trialing", plan: "pro", cardOnFile: true, provider: "revolut", testMode: true, pendingPlan: null, cycle: "monthly" });
    expect(s.paymentMethodId).toBeTruthy();
    expect(s.revolutCustomerId).toBeTruthy();
    const r = await c.startCheckout("agence", { cycle: "yearly" });
    expect(r).toMatchObject({ orderToken: null, orderId: null, simulated: true, captureMode: null, amountCents: PRICING.monthlyCents.agence * PRICING.annualMonthsCharged });
    expect(r.message).toMatch(/Agence retenue/);
    expect(await c.getSubscription()).toMatchObject({ status: "trialing", plan: "pro", pendingPlan: "agence", cycle: "yearly" });
    expect(await c.listInvoices()).toEqual([]);
  });

  it("fin d'essai avec carte : premier débit simulé, période ouverte depuis l'échéance, facture SEL-AAAA-000001 avec HT / TVA / TTC", async () => {
    const end = new Date((await c.getSubscription()).currentPeriodEnd!);
    now = new Date(end.getTime() + 3 * 3_600_000);
    const s = await c.getSubscription();
    expect(s).toMatchObject({ status: "active", plan: "pro", provider: "revolut", cardOnFile: true, pendingPlan: null, chargeAttempts: 0, cancelAtPeriodEnd: false });
    expect(s.currentPeriodEnd).toBe(addMonthsUtc(end, 1).toISOString());
    const invoices = await c.listInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ number: `SEL-${end.getUTCFullYear()}-000001`, plan: "pro", cycle: "monthly", amountCents: PRICING.monthlyCents.pro, vatRate: 20, vatNotice: null, periodStart: end.toISOString(), periodEnd: s.currentPeriodEnd });
    expect(invoices[0]!.orderId).toMatch(/^demo-order-/);
    const view = await c.getInvoice(invoices[0]!.id);
    expect(view.totals).toEqual({ exclVatCents: 2083, vatCents: 416, inclVatCents: 2499, vatRate: 20 });
    expect(view.lines).toEqual([{ label: "Abonnement Selio Pro — mensuel", periodLabel: expect.stringMatching(/^du .* au .*$/), amountCents: 2499 }]);
    expect(view.customer.orgName).toBeTruthy();
    expect(view.paymentProvider).toBe("revolut");
    expect(view.issuer.name).toBe("Selio");
    await expect(c.getInvoice("introuvable")).rejects.toThrow(/introuvable/);
    expect((await c.listAuditLogs()).some((a) => a.action === "billing.payment_completed" && a.meta.kind === "renewal" && a.meta.simulated === true)).toBe(true);
  });

  it("renouvellements successifs : une facture par période, numéros qui se suivent, offre retenue appliquée au renouvellement", async () => {
    const end = new Date((await c.getSubscription()).currentPeriodEnd!);
    now = new Date(end.getTime() + 60_000);
    await c.getSubscription();
    await c.changePlan("agence");
    expect(await c.getSubscription()).toMatchObject({ status: "active", plan: "pro", pendingPlan: "agence" });
    now = new Date(addMonthsUtc(end, 2).getTime() + 60_000);
    const s = await c.getSubscription();
    expect(s).toMatchObject({ status: "active", plan: "agence", pendingPlan: null, quotas: { connections: 10 } });
    const numbers = (await c.listInvoices()).map((i) => i.number).sort();
    expect(numbers).toEqual([`SEL-${end.getUTCFullYear()}-000001`, `SEL-${end.getUTCFullYear()}-000002`, `SEL-${end.getUTCFullYear()}-000003`]);
    const amounts = (await c.listInvoices()).map((i) => i.amountCents).sort((a, b) => a - b);
    expect(amounts).toEqual([PRICING.monthlyCents.pro, PRICING.monthlyCents.agence, PRICING.monthlyCents.agence]);
    // Même offre que l'offre actuelle : rien en attente.
    await c.changePlan("agence");
    expect((await c.getSubscription()).pendingPlan).toBeNull();
  });

  it("résiliation : accès jusqu'à la fin de la période, reprise possible tant qu'elle court, puis accès de base avec données gardées 30 jours", async () => {
    const trialEnd = new Date((await c.getSubscription()).currentPeriodEnd!);
    now = new Date(trialEnd.getTime() + 60_000);
    let s = await c.getSubscription();
    expect(s.status).toBe("active");
    const periodEnd = s.currentPeriodEnd!;
    s = await c.cancelSubscription();
    expect(s).toMatchObject({ status: "active", plan: "pro", cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd });
    expect(await c.cancelSubscription()).toMatchObject({ cancelAtPeriodEnd: true });
    s = await c.reactivateSubscription();
    expect(s.cancelAtPeriodEnd).toBe(false);
    await c.cancelSubscription();
    now = new Date(new Date(periodEnd).getTime() + 60_000);
    s = await c.getSubscription();
    expect(s).toMatchObject({ status: "canceled", plan: "free", cancelAtPeriodEnd: false, pendingPlan: null, quotas: { connections: 1 } });
    expect(s.dataRetentionUntil).toBe(new Date(now.getTime() + 30 * 86_400_000).toISOString());
    expect(await c.listInvoices()).toHaveLength(1);
    await expect(c.cancelSubscription()).rejects.toThrow(/Aucun abonnement/);
    await expect(c.changePlan("pro")).rejects.toThrow(/enregistrez une carte/);
    // Reprendre : hors essai, le paiement simulé réussit sur-le-champ, période ouverte depuis aujourd'hui, facture émise.
    const r = await c.startCheckout("starter");
    expect(r).toMatchObject({ orderToken: null, simulated: true, captureMode: "automatic", amountCents: PRICING.monthlyCents.starter });
    expect(r.orderId).toMatch(/^demo-order-/);
    expect(r.message).toMatch(/SEL-\d{4}-\d{6}/);
    s = await c.getSubscription();
    expect(s).toMatchObject({ status: "active", plan: "starter", dataRetentionUntil: null, cancelAtPeriodEnd: false });
    expect(s.currentPeriodEnd).toBe(addMonthsUtc(now, 1).toISOString());
    expect(await c.listInvoices()).toHaveLength(2);
    expect((await c.listInvoices())[0]).toMatchObject({ plan: "starter", amountCents: PRICING.monthlyCents.starter });
  });

  it("inscription (sans carte) : enregistrer la carte pendant l'essai retient l'offre sans rien débiter ; sans carte, la fin d'essai ramène à l'accès de base", async () => {
    await c.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa" });
    let s = await c.getSubscription();
    expect(s).toMatchObject({ status: "trialing", cardOnFile: false, provider: "none", paymentMethodId: null });
    const r = await c.startCheckout("pro");
    // Pendant l'essai : montant de vérification (1 €) autorisé puis annulé, jamais le prix de l'offre.
    expect(r).toMatchObject({ orderToken: null, simulated: true, captureMode: "manual", amountCents: CARD_VERIFICATION_AMOUNT_CENTS });
    expect(r.message).toMatch(/rien n'est débité avant la fin de l'essai/);
    s = await c.getSubscription();
    expect(s).toMatchObject({ status: "trialing", cardOnFile: true, provider: "revolut", pendingPlan: "pro" });
    expect(s.paymentMethodId).toBeTruthy();
    expect(await c.listInvoices()).toEqual([]);
    // Changement de carte : nouvelle carte fictive, rien débité, aucune facture.
    const previousMethod = s.paymentMethodId;
    const card = await c.startCardUpdate();
    expect(card).toMatchObject({ orderToken: null, simulated: true, captureMode: "manual", amountCents: CARD_VERIFICATION_AMOUNT_CENTS });
    expect(card.message).toMatch(/rien n'est débité/);
    s = await c.getSubscription();
    expect(s.cardOnFile).toBe(true);
    expect(s.paymentMethodId).not.toBe(previousMethod);
    expect(await c.listInvoices()).toEqual([]);
    expect((await c.listAuditLogs()).some((a) => a.action === "billing.card_saved" && a.meta.kind === "card_update")).toBe(true);
    // Nouvelle inscription, jamais de carte : fin d'essai → accès de base, aucune facture, aucune rétention à compter.
    await c.register({ email: "noe@exemple.fr", password: "motdepasse-long", displayName: "Noé", orgName: "Boutique Noé" });
    const end = new Date((await c.getSubscription()).currentPeriodEnd!);
    now = new Date(end.getTime() + 60_000);
    s = await c.getSubscription();
    expect(s).toMatchObject({ status: "canceled", plan: "free", cardOnFile: false, dataRetentionUntil: null, quotas: { connections: 1 } });
    expect(await c.listInvoices()).toEqual([]);
    expect((await c.listAuditLogs()).some((a) => a.action === "billing.trial_ended" && a.meta.reason === "trial_ended")).toBe(true);
  });
});

describe("utilisation du mois et vue administrateur (démonstration)", () => {
  it("« Mon utilisation » : même forme que l'API, période du 1er du mois, un compteur par filiale, alerte à 80 %", async () => {
    const u = await client.getUsage();
    expect(u.period.from).toBe("2026-10-01T00:00:00.000Z");
    expect(u.quotas.studioListingsPerMonth).toBe(20);
    // Compteurs généraux et par filiale : utilisé / quota / pourcentage plafonné / alerte / dépassement.
    // Compteur IA : la limite réellement appliquée (plus petit entre le plan et le réglage de l'organisation), pas le plan seul.
    const session = await client.getSession();
    expect(u.counters.aiRequests).toMatchObject({ used: u.aiRequests, quota: effectiveAiQuota(u.quotas.aiRequestsPerMonth, session!.org.settings.ai.monthlyRequestQuota) });
    expect(u.counters.aiRequests.quota).toBeLessThanOrEqual(u.quotas.aiRequestsPerMonth);
    expect(u.counters.items).toMatchObject({ used: u.itemsCount, quota: u.quotas.items });
    expect(u.counters.members).toMatchObject({ used: u.membersCount, quota: u.quotas.members });
    const studioEvents = (await client.listUsageEvents(500)).filter((e) => e.kind === "studio.listing" && e.createdAt >= u.period.from).length;
    expect(u.studio.listings).toMatchObject({ used: studioEvents, quota: 20 });
    expect(studioEvents).toBeGreaterThan(0);
    expect(u.studio.wornPhotos).toEqual({ used: 0, quota: 10, percent: 0, warning: false, exceeded: false });
    expect(u.track.scans.quota).toBe(10);
    expect(u.track.filtersFollowed).toMatchObject({ used: 0, quota: 5 });
    expect(u.cloud).toMatchObject({ actions: { used: 0, quota: 500, percent: 0 }, included: false });
    for (const c of [u.counters.aiRequests, u.counters.items, u.counters.connections, u.counters.members, u.studio.listings, u.track.scans, u.track.photoSearches, u.cloud.actions]) {
      expect(c.percent).toBeGreaterThanOrEqual(0);
      expect(c.percent).toBeLessThanOrEqual(100);
      expect(c.warning).toBe(c.used >= c.quota * 0.8);
    }
    // Une annonce Studio de plus compte aussitôt dans le compteur de la filiale.
    const photo = { id: "p1", url: "data:image/jpeg;base64," + btoa("photo"), alt: "levis-501-w32.jpg" };
    await client.generateListing({ photos: [photo], hints: {} });
    expect((await client.getUsage()).studio.listings.used).toBe(studioEvents + 1);
  });

  it("le compteur IA et le refus lisent la même limite : à la limite effective, « dépassé » et 402 avec le même chiffre", async () => {
    const before = await client.getUsage();
    // Réglage de l'organisation plus bas que le plan : c'est lui qui compte (même règle que le serveur).
    const session = await client.getSession();
    await client.updateOrg({ settings: { ai: { ...session!.org.settings.ai, monthlyRequestQuota: Math.max(1, before.aiRequests) } } });
    const capped = await client.getUsage();
    expect(capped.counters.aiRequests).toMatchObject({ used: before.aiRequests, quota: Math.max(1, before.aiRequests), percent: 100, warning: true, exceeded: true });
    await expect(client.suggestReply("conv-001")).rejects.toMatchObject({ code: "quota_exceeded", message: `Quota IA mensuel atteint (${capped.counters.aiRequests.quota}).` });
    // 0 = limite du plan : le compteur revient au quota du plan.
    await client.updateOrg({ settings: { ai: { ...session!.org.settings.ai, monthlyRequestQuota: 0 } } });
    expect((await client.getUsage()).counters.aiRequests.quota).toBe(before.quotas.aiRequestsPerMonth);
  });

  it("utilisation par client : réservée à l'opérateur, l'organisation de la démo puis des exemples fictifs, triés du plus proche de sa limite", async () => {
    const report = await client.getAdminUsage();
    expect(report.period.from).toBe("2026-10-01T00:00:00.000Z");
    const mine = await client.getUsage();
    const session = (await client.getSession())!;
    const demoOrg = report.orgs.find((o) => o.id === session.org.id)!;
    expect(demoOrg).toMatchObject({ name: session.org.name, plan: "pro", status: "trialing", counters: mine.counters, studio: mine.studio });
    const samples = report.orgs.filter((o) => o.id !== session.org.id);
    expect(samples.length).toBe(3);
    expect(samples.every((o) => /\(exemple\)$/.test(o.name))).toBe(true);
    expect(samples.map((o) => o.plan).sort()).toEqual(["agence", "pro", "starter"]);
    // Tri décroissant sur le compteur le plus avancé ; l'état se déduit des compteurs (jamais inventé).
    for (let i = 1; i < report.orgs.length; i++) expect(report.orgs[i - 1]!.maxPercent).toBeGreaterThanOrEqual(report.orgs[i]!.maxPercent);
    const blocked = samples.find((o) => o.plan === "pro")!;
    expect(blocked).toMatchObject({ exceeded: true, warning: true, maxPercent: 100 });
    expect(blocked.studio.listings).toMatchObject({ used: 20, quota: 20, exceeded: true });
    const agence = samples.find((o) => o.plan === "agence")!;
    expect(agence.cloud).toMatchObject({ included: true, actions: { used: 620, quota: 2000 } });
    // Hors opérateur : refus.
    await client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa" });
    const me = (await client.getSession())!;
    if (!me.user.isOperator) await expect(client.getAdminUsage()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("espaces Selio (démonstration)", () => {
  it("enregistre la marque blanche de Selio Agents, la valide et la remet à zéro avec la démo", async () => {
    expect(await client.getWhiteLabel()).toBeNull();
    await expect(client.saveWhiteLabel({ name: "Dépôt Lumière", initials: "D?", accent: "jade" })).rejects.toThrow(/Lettres ou chiffres/);
    const saved = await client.saveWhiteLabel({ name: "  Dépôt Lumière ", initials: "dl", accent: "jade", tagline: "Votre dépôt-vente en ligne" });
    expect(saved).toMatchObject({ name: "Dépôt Lumière", initials: "DL", accent: "jade", poweredBy: true, updatedAt: "2026-10-08T12:00:00.000Z" });
    expect(await client.getWhiteLabel()).toEqual(saved);
    expect((await client.listAuditLogs()).some((a) => a.action === "agency.white_label_updated")).toBe(true);
    await client.resetDemo();
    expect(await client.getWhiteLabel()).toBeNull();
  });

  it("Studio : annonces générées et enseignements calculés depuis les données de la démo", async () => {
    const items = (await client.listItems({ pageSize: 200 })).items;
    expect(items.filter(isGenerated).length).toBeGreaterThan(0);
    const orders = (await client.listOrders({ pageSize: 200 })).items;
    const insights = listingInsights(items, orders.map((o) => ({ itemId: o.itemId, brand: o.item?.brand ?? null, category: o.item?.category ?? null, salePriceCents: o.salePriceCents })));
    expect(insights.sample.listed).toBe(items.filter((i) => i.listedAt && i.status !== "in_stock").length);
    expect(insights.sample.sold).toBe(items.filter((i) => i.status === "sold").length);
    expect(insights.dimensions.find((d) => d.key === "title")!.buckets.length).toBeGreaterThan(1);
  });
});
