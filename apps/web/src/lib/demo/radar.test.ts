import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { CLOUD_CONSENT_VERSION, RADAR_AUTO_SHARED_ADDRESS_NOTICE, RADAR_LIVE_REQUIRES_CLOUD, type PurchaseRequest } from "@selio/contracts";
import { purchaseCost } from "@selio/domain";
import { DataError } from "../data/types";
import { DemoClient, type DemoClientOptions } from "./client";

let now = new Date("2026-10-30T12:00:00Z");
let storage: MemoryDemoStorage;
let client: DemoClient;

async function fresh(options: DemoClientOptions = {}) {
  now = new Date("2026-10-30T12:00:00Z");
  storage = new MemoryDemoStorage();
  client = new DemoClient(storage, () => now, options);
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
}

async function failure(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DataError) return e;
    throw e;
  }
  throw new Error("aucune erreur");
}

/** Compte Achat relié au Cloud de la démonstration : offre Agence, accord, compte actif avec sa session (simulée). */
async function linkPurchaseAccountToCloud() {
  const s = (await client.getSession())!;
  await client.adminSetPlan(s.org.id, "agence");
  await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
  const purchase = (await client.listConnections()).find((c) => c.usage === "purchase")!;
  const account = await client.enableCloudAccount(purchase.id);
  const login = await client.startCloudLogin(account.id);
  await client.completeSimulatedCloudLogin(login.loginSessionId);
  return purchase;
}

beforeEach(() => fresh());

describe("Selio Radar dans la démonstration", () => {
  it("deux recherches, dont une « en direct » simulée : rythme ralenti × 2 après un blocage, mesures marquées « démo »", async () => {
    const searches = await client.listSearches();
    expect(searches).toHaveLength(2);
    const live = searches.find((s) => s.source === "cloud")!;
    expect(searches.filter((s) => s.source === "demo")).toHaveLength(1);
    expect(live).toMatchObject({ provider: "vinted", slowdownFactor: 2, intervalSeconds: 120, priority: false });
    expect(live.pagesRead).toBeGreaterThan(1000);
    expect(live.lastBlockAt).not.toBeNull();
    const m = await client.radarMetrics(30);
    expect(m).toMatchObject({ status: "measured", demo: true });
    expect(m.label).toMatch(/Démo : chiffres fictifs/);
    expect(m.liveReads).toBe(live.pagesRead);
    expect(m.blockRatePer1000).toBeGreaterThan(1);
    expect(m.medianPublishToDetectSeconds).toBeGreaterThan(0);
    // Aucun achat réel n'existe : détection → achat reste « à mesurer ».
    expect(m.medianDetectToPurchaseSeconds).toBeNull();
    // Les affaires de la recherche en direct sont datées de leur publication.
    const opps = await client.listOpportunities({ searchId: live.id });
    expect(opps.length).toBeGreaterThan(0);
    expect(opps.every((o) => o.observed.publishedAt && o.observed.detectedAt && o.observed.externalRef)).toBe(true);
  });

  it("mesures « à mesurer » sans recherche en direct", async () => {
    const live = (await client.listSearches()).find((s) => s.source === "cloud")!;
    await client.updateSearch(live.id, { source: "demo" });
    const m = await client.radarMetrics(30);
    expect(m).toMatchObject({ status: "to_measure", label: "à mesurer", liveReads: 0, blockRatePer1000: null, medianPublishToDetectSeconds: null, medianDetectToPurchaseSeconds: null, readsPerDay: [] });
    expect(m.demo).toBeUndefined();
  });

  it("lecture en direct : rythme respecté, refus clair sans compte Achat relié au Cloud, lecture simulée sinon", async () => {
    const live = (await client.listSearches()).find((s) => s.source === "cloud")!;
    const soon = await client.runSearch(live.id);
    expect(soon).toMatchObject({ found: 0, skipped: "too_soon", source: "cloud" });
    expect(soon.message).toMatch(/ralenti × 2/);
    now = new Date(now.getTime() + 5 * 60_000);
    const refused = await failure(client.runSearch(live.id));
    expect(refused).toMatchObject({ code: "radar_live_requires_cloud", status: 409 });
    expect(refused.message).toContain(RADAR_LIVE_REQUIRES_CLOUD);
    await linkPurchaseAccountToCloud();
    const read = await client.runSearch(live.id);
    expect(read).toMatchObject({ source: "cloud", outcome: "ok", skipped: null, simulated: true });
    expect(read.message).toMatch(/SIMULÉE/);
    const after = (await client.listSearches()).find((s) => s.id === live.id)!;
    expect(after.pagesRead).toBe(live.pagesRead + 1);
    expect(after.lastReadAt).toBe(now.toISOString());
  });

  it("3 recherches prioritaires au plus : la 4e est refusée, à la création comme à la modification", async () => {
    const base = { criteria: { maxPriceCents: 2000 }, source: "cloud" as const, priority: true };
    for (const name of ["P1", "P2", "P3"]) await client.createSearch({ ...base, name });
    const fourth = await failure(client.createSearch({ ...base, name: "P4" }));
    expect(fourth).toMatchObject({ code: "validation", status: 400 });
    expect(fourth.message).toMatch(/3 recherches prioritaires au plus/);
    const live = (await client.listSearches()).find((s) => s.source === "cloud" && !s.priority)!;
    expect((await failure(client.updateSearch(live.id, { priority: true }))).code).toBe("validation");
    // Le compte lu est un compte Achat actif : jamais un compte Perso ni de vente.
    const personal = (await client.listConnections()).find((c) => c.usage === "personal")!;
    expect((await failure(client.updateSearch(live.id, { connectionId: personal.id }))).message).toMatch(/compte Vinted « Achat »/);
  });

  it("Radar Auto verrouillé : verrou serveur fermé, mention de l'adresse partagée, rien n'est évalué ni activable", async () => {
    const status = await client.autoBuyStatus();
    expect(status).toMatchObject({ active: false, serverEnabled: false, realPurchase: false, simulated: true, notice: RADAR_AUTO_SHARED_ADDRESS_NOTICE });
    expect(status.locks.map((l) => l.key)).toEqual(["server", "shared_address", "organization", "cloud", "consent"]);
    expect(status.locks.find((l) => l.key === "server")!.ok).toBe(false);
    expect(status.locks.find((l) => l.key === "shared_address")).toMatchObject({ ok: false, detail: RADAR_AUTO_SHARED_ADDRESS_NOTICE });
    const run = await client.runAutoBuy();
    expect(run).toMatchObject({ disabled: true, evaluated: 0, bought: 0 });
    expect(run.reasons!.join(" ")).toMatch(/RADAR_AUTO_ENABLED/);
    // Désactiver est permis ; réactiver exige le verrou serveur (refus avec la mention).
    await client.updateRadarSettings({ autoBuy: { enabled: false } });
    const refused = await failure(client.updateRadarSettings({ autoBuy: { enabled: true } }));
    expect(refused).toMatchObject({ code: "radar_auto_disabled", status: 403 });
    expect(refused.message).toContain(RADAR_AUTO_SHARED_ADDRESS_NOTICE);
  });

  it("Radar Auto verrous levés (compte de l'équipe) : achat SIMULÉ, jamais réel, annulable", async () => {
    await fresh({ radarAutoServerEnabled: true });
    expect((await client.autoBuyStatus()).active).toBe(false);
    await linkPurchaseAccountToCloud();
    const status = await client.autoBuyStatus();
    expect(status.active).toBe(true);
    expect(status.locks.every((l) => l.ok)).toBe(true);
    const run = await client.runAutoBuy();
    expect(run.disabled).toBeUndefined();
    expect(run.evaluated).toBeGreaterThan(0);
    const auto = (await client.listPurchaseRequests()).filter((p) => p.mode === "auto" && p.status === "simulated");
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((p) => p.realPurchaseEnabled === false)).toBe(true);
    expect((await client.cancelPurchaseRequest(auto[0]!.id)).status).toBe("cancelled");
  });

  it("« Je l'ai achetée » : affaire achetée, prix d'achat reporté dans Manager (article en stock, étiquette radar)", async () => {
    const opp = (await client.listOpportunities({ status: "new" })).find((o) => o.score >= 75)!;
    const detail = await client.getOpportunity(opp.id);
    // Annonce de démonstration : adresse fictive, jamais ouverte comme un lien Vinted.
    expect(detail.itemUrl).toBeNull();
    expect(detail.search).not.toBeNull();
    const p = await client.quickBuy(opp.id);
    const total = purchaseCost(opp.observed, (await client.getSession())!.org.settings.buyerFees).totalCents;
    expect(p).toMatchObject({ status: "simulated", mode: "manual", totalCents: total, realPurchaseEnabled: false });
    const item = await client.getItem(p.reportedItemId!);
    expect(item).toMatchObject({ status: "in_stock", purchasePriceCents: total, tags: ["radar"] });
    expect((await client.getOpportunity(opp.id))).toMatchObject({ status: "purchased", purchase: { id: p.id } });
  });

  it("3-D Secure : « J'ai validé » relit une confirmation simulée ; délai dépassé, achat abandonné", async () => {
    const opp = (await client.listOpportunities({ status: "new" }))[0]!;
    const base: PurchaseRequest = { id: "pur-3ds", orgId: opp.orgId, opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: 1500, budgetCents: 5000, status: "awaiting_3ds", mode: "auto", cancelableUntil: null, connectionId: null, checks: [], realPurchaseEnabled: false, confirmedAt: now.toISOString(), executedAt: null, resultNote: null, totalCents: 1500, awaiting3dsUntil: new Date(now.getTime() + 10 * 60_000).toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() };
    storage.load()!.purchases.unshift({ ...base });
    const ok = await client.resumePurchase("pur-3ds");
    expect(ok).toMatchObject({ queued: false, purchase: { status: "simulated" } });
    expect((await failure(client.resumePurchase("pur-3ds"))).status).toBe(409);
    storage.load()!.purchases.unshift({ ...base, id: "pur-3ds-old", opportunityId: "autre", dedupeKey: "purchase:autre", awaiting3dsUntil: new Date(now.getTime() - 60_000).toISOString() });
    expect((await failure(client.resumePurchase("pur-3ds-old"))).message).toMatch(/délai de validation bancaire est dépassé/);
    expect((await client.listPurchaseRequests()).find((p) => p.id === "pur-3ds-old")!.status).toBe("cancelled");
  });

  it("notifications : rien n'est envoyé, test local ; abonnement enregistré puis retiré", async () => {
    expect(await client.pushConfig()).toMatchObject({ enabled: false, publicKey: null, simulated: true });
    const test = await client.testPush();
    expect(test).toMatchObject({ sent: 0, simulated: true, payload: { url: "/app/radar" } });
    const endpoint = "https://fcm.googleapis.com/fcm/send/demo-appareil";
    await client.subscribePush({ endpoint, keys: { p256dh: "BCdemoCleP256dh0123456789", auth: "authdemo1234" } });
    expect((await client.listPushSubscriptions()).map((s) => s.endpoint)).toEqual([endpoint]);
    expect(JSON.stringify(await client.listPushSubscriptions())).not.toMatch(/p256dh|authdemo/);
    expect(await client.unsubscribePush(endpoint)).toEqual({ removed: true });
    expect(await client.listPushSubscriptions()).toEqual([]);
  });

  it("réglages des alertes : note minimale et heures calmes enregistrées", async () => {
    const r = await client.updateRadarSettings({ radar: { alertMinScore: 85, quietHours: { from: 22, to: 7 } } });
    expect(r.radar).toMatchObject({ alertMinScore: 85, quietHours: { from: 22, to: 7 }, alertsEnabled: true });
    expect((await client.getSession())!.org.settings.radar).toMatchObject({ alertMinScore: 85 });
    expect((await failure(client.updateRadarSettings({ radar: { alertMinScore: 140 } }))).code).toBe("validation");
  });
});
