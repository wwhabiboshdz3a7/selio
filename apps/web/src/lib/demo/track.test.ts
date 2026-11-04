import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { PRICE_MODEL_DEMO_DATA, TRACK_DEMO_NOTICE, TRACK_INSUFFICIENT_DATA, TRACK_SALES_FEED_AGENCY_ONLY, TRACK_UNAVAILABLE_MESSAGE, priceEstimate, trackFilter, trackScan } from "@selio/contracts";
import { DataError } from "../data/types";
import { DemoClient } from "./client";
import { demoFingerprint } from "./track";

let now = new Date("2026-10-30T12:00:00Z");
let storage: MemoryDemoStorage;
let client: DemoClient;

async function fresh() {
  now = new Date("2026-10-30T12:00:00Z");
  storage = new MemoryDemoStorage();
  client = new DemoClient(storage, () => now);
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

async function setPlan(plan: "free" | "starter" | "pro" | "agence") {
  const s = (await client.getSession())!;
  await client.adminSetPlan(s.org.id, plan);
}

/** Photo minuscule (le simulateur ne la regarde pas vraiment). */
const PHOTO = "data:image/jpeg;base64," + btoa("photo-de-test-levis");

beforeEach(fresh);

describe("Selio Track en démonstration", () => {
  it("deux filtres suivis, lus toutes les 2 h, avec des tendances sur 30 jours marquées « démo »", async () => {
    const filters = await client.trackFilters();
    expect(filters).toHaveLength(2);
    for (const f of filters) {
      expect(trackFilter.safeParse(f).success).toBe(true);
      expect(f.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(new Date(f.nextReadAt!).getTime() - new Date(f.lastReadAt!).getTime()).toBe(2 * 3_600_000);
      expect(new Date(f.lastReadAt!).getTime()).toBeLessThanOrEqual(now.getTime());
    }
    const t = await client.trackTrends(filters[0]!.id);
    expect(t.days).toBe(30);
    expect(t.points.length).toBe(30);
    expect(t.demo).toBe(true);
    expect(t.source).toBe("demo");
    expect(t.notices).toContain(TRACK_DEMO_NOTICE);
    expect(t.points.some((p) => p.goneCount > 0)).toBe(true);
    expect(t.brandShares?.length).toBeGreaterThan(0);
    // Aucune annonce, aucun pseudo : seulement des agrégats.
    expect(JSON.stringify(t)).not.toMatch(/sellerHandle|vintage_lou|sneakers\.paris|photoUrl/);
    // Historique du plan : 90 jours en Pro (3 mois), mais un filtre créé il y a 45 jours n'a que 45 jours de points.
    const long = await client.trackTrends(filters[0]!.id, 90);
    expect(long.days).toBe(90);
    expect(long.points.length).toBeLessThanOrEqual(46);
  });

  it("filtres : quota de l'offre (402), doublon refusé (409, même empreinte quelle que soit la casse)", async () => {
    const dup = await failure(client.createTrackFilter({ name: "Doublon", criteria: { brands: ["LEVI'S "], categories: ["men"], keywords: ["501"], maxPriceCents: 4500 } }));
    expect(dup.status).toBe(409);
    expect(demoFingerprint({ brands: ["Levi's"], keywords: ["501"] })).toBe(demoFingerprint({ brands: [" levi's"], keywords: ["501 "] }));
    for (let i = 0; i < 3; i++) await client.createTrackFilter({ name: `Filtre ${i}`, criteria: { brands: [`Marque ${i}`], categories: ["women"] } });
    expect((await client.trackUsage()).filters).toMatchObject({ used: 5, quota: 5, exceeded: true });
    const full = await failure(client.createTrackFilter({ name: "Sixième", criteria: { brands: ["Zara"] } }));
    expect(full.status).toBe(402);
    expect(full.code).toBe("quota_exceeded");
    // Un filtre retiré libère la place.
    const list = await client.trackFilters();
    await client.deleteTrackFilter(list[list.length - 1]!.id);
    await client.createTrackFilter({ name: "Sixième", criteria: { brands: ["Zara"] } });
  });

  it("free et Starter : Track indisponible (402 « compris à partir de Pro ») ; Agence : 25 filtres et le flux des ventes", async () => {
    await setPlan("starter");
    const usage = await client.trackUsage();
    expect(usage.available).toBe(false);
    const e = await failure(client.trackFilters());
    expect(e.status).toBe(402);
    expect(e.message).toBe(TRACK_UNAVAILABLE_MESSAGE);
    await setPlan("pro");
    const feed = await failure(client.trackSalesFeed());
    expect(feed.status).toBe(402);
    expect(feed.message).toBe(TRACK_SALES_FEED_AGENCY_ONLY);
    await setPlan("agence");
    const u = await client.trackUsage();
    expect(u).toMatchObject({ available: true, salesFeed: true, historyMonths: 12, source: "demo" });
    expect(u.filters.quota).toBe(25);
    expect(u.history).toHaveLength(12);
    const rows = await client.trackSalesFeed();
    expect(rows.demo).toBe(true);
    expect(rows.rows.length).toBeGreaterThan(3);
    expect(JSON.stringify(rows)).not.toMatch(/sellerHandle|vintage_lou|polo\.club/);
  });

  it("scan de niche : note sur 100 décomptée ; « données insuffisantes » sans note ni décompte", async () => {
    expect(await client.trackScans()).toHaveLength(1);
    const ok = await client.runNicheScan({ brand: "Nike", category: "shoes" });
    expect(trackScan.safeParse(ok).success).toBe(true);
    expect(ok.status).toBe("ok");
    expect(ok.score).toBeGreaterThanOrEqual(0);
    expect(ok.score).toBeLessThanOrEqual(100);
    expect(ok.components).not.toBeNull();
    expect(ok.basedOn.demo).toBe(true);
    expect((await client.trackUsage()).scans.used).toBe(1);
    const thin = await client.runNicheScan({ brand: "Marque inconnue", category: "home" });
    expect(thin).toMatchObject({ status: "insufficient_data", score: null, message: TRACK_INSUFFICIENT_DATA, details: { medianDaysToSell: null, medianResaleCents: null, medianBuyCents: null } });
    expect((await client.trackUsage()).scans.used).toBe(1);
  });

  it("recherche par photo : description lue, estimation, photo jamais gardée, quota décompté", async () => {
    const res = await client.trackPhotoSearch({ photo: PHOTO, hints: { brand: "Levi's" } });
    expect(res.simulated).toBe(true);
    expect(res.description.title.length).toBeGreaterThan(2);
    expect(priceEstimate.safeParse(res.estimate).success).toBe(true);
    expect(res.estimate.strategies).not.toBeNull();
    expect(JSON.stringify(storage.load())).not.toContain(PHOTO.slice(23));
    expect((await client.trackUsage()).photoSearches.used).toBe(1);
    expect(await client.trackPhotoSearches()).toHaveLength(1);
  });
});

describe("estimation des prix en démonstration", () => {
  it("trois stratégies arrondies à x,90, ordonnées, méthode et « données de démonstration »", async () => {
    const e = await client.estimatePrice({ brand: "Nike", category: "shoes", condition: "very_good" });
    expect(priceEstimate.safeParse(e).success).toBe(true);
    expect(e.method).toBe("blend");
    expect(e.demo).toBe(true);
    expect(e.p25!).toBeLessThanOrEqual(e.p50!);
    expect(e.p50!).toBeLessThanOrEqual(e.p75!);
    for (const v of Object.values(e.strategies!)) expect(v % 100).toBe(90);
    expect(e.explanation ?? null).toBeNull();
    const status = await client.pricingModelStatus();
    expect(status).toMatchObject({ trained: true, synthetic: true, label: PRICE_MODEL_DEMO_DATA, metrics: null });
  });

  it("explication en mots par mon IA perso (simulée) : elle ne cite que les prix décidés", async () => {
    const e = await client.estimatePrice({ title: "Jean 501", brand: "Levi's", category: "men", condition: "good", explain: true });
    expect(e.explanationSource).toBe("ai");
    expect(e.explanation).toBeTruthy();
    const s = e.strategies!;
    const cited = [...e.explanation!.matchAll(/(\d+),(\d{2}) €/g)].map((m) => Number(m[1]) * 100 + Number(m[2]));
    for (const c of cited) expect([s.fast, s.standard, s.max]).toContain(c);
  });

  it("Studio : le résultat porte l'estimation et applique le plancher aux stratégies", async () => {
    const photo = { id: "p1", url: "data:image/jpeg;base64," + btoa("photo"), alt: "levis-501-w32.jpg" };
    const d = await client.generateListing({ photos: [photo], hints: { purchasePriceCents: 4000 } });
    expect(d.pricing).toBeTruthy();
    expect(d.pricing!.strategies).not.toBeNull();
    expect(d.priceLowCents).toBeGreaterThanOrEqual(4000);
    expect(d.suggestedPriceCents).toBeGreaterThanOrEqual(d.priceLowCents);
  });
});
