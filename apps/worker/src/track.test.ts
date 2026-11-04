import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { orgSettings, quotasForPlan, type ItemCategory, type Plan, type PriceReferenceInput } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import { FakeTrackReader, cloud, pricing, track, type OrgContext, type Services } from "@selio/core";
import { parseCondition } from "@selio/pricing";
import { generateSyntheticReferences } from "@selio/pricing/synthetic";
import type { RadarReadResult } from "@selio/cloud";
import { loadEnv, maintenanceSchedules, trackServicesConfig } from "./config";
import { GbmPriceTrainer, ThreadedPriceTrainer, createPricingServices, loadStoredPriceModel, toPricingReference } from "./pricing";
import { PageRateLimiter } from "./radar";
import { retentionTick } from "./tasks";
import { CloudTrackReader, pricingReferencesTick, pricingTrainTask, toTrackReaderOutcome, trackTick } from "./track";

/**
 * Selio Track et modèle de prix côté worker, sur PostgreSQL, base DÉDIÉE (selio_test_worker_track, créée si
 * besoin) : Vitest 3 en espace de travail peut faire tourner les fichiers de tests du paquet en même temps,
 * et ce fichier vide les organisations, les tables partagées de Track, la base de références, les modèles et
 * le coupe-circuit de SA base. Simulateur ou lecteur factice : aucune page de Vinted n'est lue. Ignoré si la
 * base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_WORKER_TRACK_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker_track";
const APP_URL = process.env.TEST_WORKER_TRACK_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker_track";

const T0 = new Date("2026-10-30T08:00:00.000Z");
const silent = { info: () => {}, warn: () => {}, error: () => {} };

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let seq = 0;

async function ensureDatabase(): Promise<void> {
  const url = new URL(OWNER_URL);
  const dbName = url.pathname.replace(/^\//, "");
  url.pathname = "/postgres";
  const admin = createPool(url.toString(), { max: 1 });
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database "${dbName.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 2 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  services = {
    db: new Db(createPool(APP_URL, { max: 4 })),
    ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }),
    secrets: new SecretBox(SecretBox.generateKey()),
    now: () => new Date(clock),
    allowAiFallback: false,
    version: "test",
    config: {},
  };
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

beforeEach(async () => {
  clock = new Date(T0);
  if (!available || !services) return;
  services.config = {};
  services.track = undefined;
  services.pricing = undefined;
  // Tables partagées de Track, base de références, modèles et coupe-circuit : propres à cette base de test.
  await owner.query("truncate track_filter_reads, track_snapshots, price_references, price_models");
  await owner.query("delete from track_filters");
  await owner.query("update track_runtime set window_measures = '', slowdown_factor = 1, last_block_at = null, paused_until = null, pause_reason = null");
  await cloud.clearCircuit(services);
});

async function setupOrg(plan: Plan): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `wtrack${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org W Track ${n}`, slug: `org-w-track-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await setPlan(ids.orgId, plan);
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: null };
}

const setPlan = (orgId: string, plan: Plan) => services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotasForPlan(plan) }));

const criteria = { brands: ["Levi's"], categories: ["men" as const], keywords: ["jean 501"], maxPriceCents: 4000 };
const snapshotsOf = async (fingerprint: string) => Number((await owner.query("select count(*)::int as n from track_snapshots where fingerprint = $1", [fingerprint])).rows[0].n);

/** Annonce lue sur une page publique (avec pseudo, photo et adresse : rien de cela ne doit atteindre Track). */
const listing = (ref: string, priceCents: number) => ({
  externalRef: ref, title: `Jean Levi's 501 de vendeuse_${ref}`, priceCents, shippingCents: 450, brand: "Levi's", size: "W32", condition: "very_good", category: "men",
  url: `https://www.vinted.fr/items/${ref}-jean`, photoUrl: `https://images1.vinted.net/t/${ref}.jpg`, photoCount: 4,
  sellerHandle: `vendeuse_${ref}`, sellerRating: 4.8, sellerReviews: 31, publishedAt: new Date(clock.getTime() - 3_600_000).toISOString(), publishedAtSource: "absolute",
});

// ---------------------------------------------------------------- adaptateurs et configuration (purs)

describe("worker : Selio Track (adaptateurs et configuration)", () => {
  const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://127.0.0.1:6379", SECRETS_ENCRYPTION_KEY: "k".repeat(44) };
  const read = (over: Partial<RadarReadResult>): RadarReadResult => ({ outcome: "ok", items: [], seenCount: 0, blocked: null, stop: null, measure: null, pageOk: true, durationMs: 900, finalUrl: null, status: 200, launched: true, observedAt: T0.toISOString(), message: "", missing: [], warnings: [], adapterVersion: "test", ...over });

  it("traduit la lecture d'une page publique sans session ni champ personnel ; un signal reste un signal", () => {
    const item = { externalRef: "5012345601", url: "https://www.vinted.fr/items/5012345601-jean", title: "Jean 501", brand: "Levi's", size: "W32", condition: "very_good" as const, priceCents: 2500, shippingCents: 399, sellerHandle: "vendeuse_secrete", sellerRating: 4.5, sellerReviews: 12, photoCount: 4, photoUrl: "https://images1.vinted.net/t/secret.jpg", publishedAt: T0.toISOString(), publishedAtSource: "absolute" as const, observedAt: T0.toISOString() };
    const ok = toTrackReaderOutcome(read({ items: [item], session: { cookies: [{ name: "x" }] } as unknown as RadarReadResult["session"] }));
    expect(ok).toMatchObject({ ok: true, durationMs: 900, items: [{ externalRef: "5012345601", priceCents: 2500, url: null, photoUrl: null, sellerHandle: null, sellerRating: null, sellerReviews: null }] });
    expect(JSON.stringify(ok)).not.toMatch(/vendeuse_secrete|secret\.jpg|items\/5012345601|cookies/);
    expect(toTrackReaderOutcome(read({ outcome: "blocked", blocked: { code: "captcha", pattern: "x", message: "" } }))).toMatchObject({ ok: false, code: "captcha", launched: true });
    expect(toTrackReaderOutcome(read({ outcome: "blocked", blocked: { code: "rate_limited", pattern: "status.429", message: "" } }))).toMatchObject({ ok: false, code: "rate_limited", launched: true });
    expect(toTrackReaderOutcome(read({ outcome: "unavailable", launched: false }))).toMatchObject({ ok: false, code: "unavailable", launched: false });
    expect(toTrackReaderOutcome(read({ outcome: "page_changed" }))).toMatchObject({ ok: false, code: "selector_missing" });
    const failed = toTrackReaderOutcome(read({ outcome: "timeout", session: { cookies: [] } as unknown as RadarReadResult["session"] }));
    expect(failed).toMatchObject({ ok: false, code: "timeout" });
    expect("session" in failed).toBe(false);
  });

  it("filtre la page APRÈS lecture et transmet la page entière (nombre d'annonces, publication la plus ancienne)", () => {
    const card = (ref: string, size: string, minutesAgo: number) => ({ externalRef: ref, url: `https://www.vinted.fr/items/${ref}-jean`, title: "Jean", brand: "Levi's", size, condition: "very_good" as const, priceCents: 2500, sellerHandle: null, photoCount: 2, photoUrl: null, publishedAt: new Date(T0.getTime() - minutesAgo * 60_000).toISOString(), publishedAtSource: "absolute" as const, observedAt: T0.toISOString() });
    const page = [card("1", "W32", 5), card("2", "W30", 50), card("3", "W32", 90), card("4", "W28", 400)];
    const out = toTrackReaderOutcome(read({ items: page, seenCount: 4 }), track.normalizeTrackCriteria({ sizes: ["W32"] }));
    expect(out).toMatchObject({ ok: true, seenCount: 4, oldestPublishedAt: new Date(T0.getTime() - 400 * 60_000).toISOString() });
    expect(out.ok && out.items.map((i) => (i as { externalRef: string }).externalRef)).toEqual(["1", "3"]);
  });

  it("lit la page catalogue SANS session (pages publiques) et refuse un domaine hors liste", async () => {
    const calls: { session: unknown; url: string; criteria: unknown }[] = [];
    const reader = new CloudTrackReader({ readSearch: async (input) => { calls.push({ session: input.session, url: input.url, criteria: input.criteria }); return read({}); } }, silent);
    const out = await reader.read({ fingerprint: "a".repeat(64), criteria: track.normalizeTrackCriteria(criteria), vintedHost: "www.vinted.fr", now: T0 });
    expect(out).toMatchObject({ ok: true, items: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.session).toBeNull();
    // Page lue entière : le filtre local est appliqué par Track, pas par le lecteur.
    expect(calls[0]!.criteria).toBeUndefined();
    expect(calls[0]!.url).toMatch(/^https:\/\/www\.vinted\.fr\/catalog\?/);
    const refused = await reader.read({ fingerprint: "a".repeat(64), criteria: track.normalizeTrackCriteria(criteria), vintedHost: "exemple.invalid", now: T0 });
    expect(refused).toMatchObject({ ok: false, launched: false });
    expect(calls).toHaveLength(1);
  });

  it("configuration : lecture en direct fermée, 2 h, 10 pages par minute, passages et entraînement du dimanche", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ TRACK_LIVE_ENABLED: false, TRACK_READ_INTERVAL_MINUTES: 120, TRACK_MAX_PAGES_PER_MINUTE: 10, CRON_TRACK: "*/15 * * * *", PRICING_TRAIN_CRON: "0 4 * * 0", PRICING_MIN_REFERENCES: 500, PRICING_TRAIN_MAX_MS: 600_000 });
    expect(trackServicesConfig(env)).toEqual({ trackLiveEnabled: false, trackReadIntervalMinutes: 120 });
    const schedules = maintenanceSchedules(env);
    expect(schedules.find((s) => s.name === "track.tick")).toEqual({ name: "track.tick", pattern: "*/15 * * * *" });
    expect(schedules.find((s) => s.name === "pricing.references")).toEqual({ name: "pricing.references", pattern: "30 2 * * *" });
    expect(schedules.find((s) => s.name === "pricing.train")).toEqual({ name: "pricing.train", pattern: "0 4 * * 0" });
    expect(trackServicesConfig(loadEnv({ ...base, TRACK_LIVE_ENABLED: "true", TRACK_READ_INTERVAL_MINUTES: "180" }))).toEqual({ trackLiveEnabled: true, trackReadIntervalMinutes: 180 });
    expect(() => loadEnv({ ...base, TRACK_READ_INTERVAL_MINUTES: "15" })).toThrow(/TRACK_READ_INTERVAL_MINUTES/);
    expect(() => loadEnv({ ...base, PRICING_MIN_REFERENCES: "100" })).toThrow(/PRICING_MIN_REFERENCES/);
  });
});

// ---------------------------------------------------------------- passage de Track

describe("worker : passage de Track (track.tick)", () => {
  it("lit UNE fois l'empreinte partagée par deux organisations (simulateur), à l'intervalle réglé", async () => {
    if (!available) return;
    services.config = { trackReadIntervalMinutes: 180 };
    const a = await setupOrg("pro");
    const b = await setupOrg("agence");
    const fa = await track.createFilter(a, { name: "Jeans Levi's", criteria });
    const fb = await track.createFilter(b, { name: "Mes 501", criteria: { ...criteria, brands: ["LEVI'S "], keywords: ["Jean  501"] } });
    expect(fb.fingerprint).toBe(fa.fingerprint);
    const limiter = new PageRateLimiter(10);
    const r = await trackTick(services, silent, { limiter });
    expect(r).toMatchObject({ source: "demo", due: 1, reads: 1, ok: 1, blocked: 0, errors: 0, paused: false });
    expect(r.references).toBeGreaterThan(0);
    // Simulateur : aucune page comptée dans le plafond.
    expect(limiter.used(clock)).toBe(0);
    expect(await snapshotsOf(fa.fingerprint)).toBe(1);
    const [la] = await track.listFilters(a);
    const [lb] = await track.listFilters(b);
    expect(la!.lastReadAt).toBe(T0.toISOString());
    expect(lb!.lastReadAt).toBe(T0.toISOString());
    expect(la!.nextReadAt).toBe(lb!.nextReadAt);
    const wait = new Date(la!.nextReadAt!).getTime() - T0.getTime();
    expect(wait).toBeGreaterThanOrEqual(170 * 60_000);
    expect(wait).toBeLessThanOrEqual(190 * 60_000);
    // Passage suivant : rien n'est dû.
    clock = new Date(T0.getTime() + 15 * 60_000);
    expect(await trackTick(services, silent, { limiter })).toMatchObject({ due: 0, reads: 0 });
    // Références de démonstration : jamais comptées comme réelles, sans aucune donnée personnelle.
    const refs = await owner.query("select * from price_references");
    expect(refs.rows.every((x: { source: string }) => x.source === "demo")).toBe(true);
    expect(JSON.stringify(refs.rows)).not.toMatch(/vinted\.fr\/items|vendeuse|images1/);
  });

  it("en direct : plafond de pages de Track et de la machine, puis arrêt au premier signal de Vinted (pause, ralentissement, rien de retenté)", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const reader = new FakeTrackReader();
    services.track = { reader };
    const ctx = await setupOrg("agence");
    const f1 = await track.createFilter(ctx, { name: "Jeans", criteria });
    const f2 = await track.createFilter(ctx, { name: "Vestes", criteria: { ...criteria, keywords: ["veste"] } });
    const f3 = await track.createFilter(ctx, { name: "Chemises", criteria: { ...criteria, keywords: ["chemise"] } });
    const warnings: string[] = [];
    const log = { ...silent, warn: (_o: object, m: string) => { warnings.push(m); } };
    const limiter = new PageRateLimiter(1);
    const machine = new PageRateLimiter(30);
    reader.enqueue({ ok: true, items: [listing("111", 2500), listing("222", 1800)] });
    const first = await trackTick(services, log, { limiter, machineLimiter: machine });
    expect(first).toMatchObject({ source: "cloud", due: 3, reads: 1, ok: 1, skipped: { track_pages_per_minute: 1 } });
    expect(reader.calls).toHaveLength(1);
    // La page compte aussi dans le plafond de la machine (partagé avec Radar).
    expect(machine.used(clock)).toBe(1);
    // Aucun pseudo, aucune photo, aucune adresse d'annonce dans la base partagée.
    expect(JSON.stringify((await owner.query("select * from price_references")).rows)).not.toMatch(/vendeuse|images1|vinted\.fr\/items/);

    // Une minute plus tard : une autre empreinte est lue, Vinted affiche un CAPTCHA ; la dernière n'est pas lue.
    clock = new Date(T0.getTime() + 61_000);
    reader.enqueue({ ok: false, code: "captcha", launched: true });
    const second = await trackTick(services, log, { limiter, machineLimiter: machine });
    expect(second).toMatchObject({ due: 2, reads: 1, blocked: 1, paused: true, circuitUntil: null });
    expect(second.factor).toBe(2);
    expect(warnings.some((m) => /signal de Vinted/.test(m))).toBe(true);
    const runtime = await services.db.withGlobal((tx) => repos.trackReads.runtime(tx));
    expect(runtime).toMatchObject({ pauseReason: "captcha", slowdownFactor: 2 });
    expect(new Date(runtime.pausedUntil!).getTime()).toBeGreaterThan(clock.getTime());
    // Track en pause : l'empreinte encore due n'est pas lue, rien n'est retenté, les places sont rendues.
    clock = new Date(T0.getTime() + 5 * 60_000);
    const fresh = new PageRateLimiter(10);
    const third = await trackTick(services, log, { limiter: fresh, machineLimiter: machine });
    expect(third).toMatchObject({ due: 1, reads: 0, paused: true, skipped: { paused: 1 } });
    expect(fresh.used(clock)).toBe(0);
    expect(reader.calls).toHaveLength(2);
    expect(new Set(reader.calls.map((c) => c.fingerprint)).size).toBe(2);
    expect([f1.fingerprint, f2.fingerprint, f3.fingerprint]).toContain(reader.calls[1]!.fingerprint);
  });

  it("en direct : attend une place dans le plafond de Track (budget du passage) au lieu de s'arrêter à la première page", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const reader = new FakeTrackReader();
    services.track = { reader };
    const ctx = await setupOrg("agence");
    for (const k of ["jean", "veste", "chemise"]) await track.createFilter(ctx, { name: k, criteria: { ...criteria, keywords: [k] } });
    const limiter = new PageRateLimiter(1);
    const machine = new PageRateLimiter(30);
    const machineTakes: number[] = [];
    const take = machine.tryTake.bind(machine);
    machine.tryTake = (at: Date) => { const t = take(at); if (t !== null) machineTakes.push(t); return t; };
    const sleeps: number[] = [];
    // Horloge simulée : chaque pause fait avancer le temps.
    const sleep = async (ms: number) => { sleeps.push(ms); clock = new Date(clock.getTime() + ms); };
    // Budget d'attente plus court que la minute du plafond : une page, le reste au passage suivant.
    const short = await trackTick(services, silent, { limiter, machineLimiter: machine, maxWaitMs: 30_000, sleep });
    expect(short).toMatchObject({ due: 3, reads: 1, waitedMs: 0, skipped: { track_pages_per_minute: 1 } });
    expect(sleeps).toHaveLength(0);
    // Budget de 5 min : les deux empreintes restantes sont lues, une par minute, par tranches d'attente d'1 s au plus.
    const long = await trackTick(services, silent, { limiter, machineLimiter: machine, maxWaitMs: 5 * 60_000, sleep });
    expect(long).toMatchObject({ due: 2, reads: 2, ok: 2, waitedMs: 120_000, skipped: {} });
    expect(reader.calls).toHaveLength(3);
    expect(new Set(reader.calls.map((c) => c.fingerprint)).size).toBe(3);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(1_000);
    expect(clock.getTime() - T0.getTime()).toBe(120_000);
    // Jamais plus d'une page dans une même minute ; chaque page compte aussi dans le plafond de la machine.
    expect(limiter.used(clock)).toBe(1);
    expect(machineTakes).toEqual([T0.getTime(), T0.getTime() + 60_000, T0.getTime() + 120_000]);
    // Arrêt du worker pendant l'attente : le passage s'arrête sans lire.
    let stopping = false;
    await track.createFilter(ctx, { name: "pulls", criteria: { ...criteria, keywords: ["pull"] } });
    const stopped = await trackTick(services, silent, { limiter, machineLimiter: machine, maxWaitMs: 5 * 60_000, sleep: async (ms) => { await sleep(ms); stopping = true; }, shouldStop: () => stopping });
    expect(stopped).toMatchObject({ reads: 0, skipped: { worker_stopping: 1 } });
    expect(reader.calls).toHaveLength(3);
  });

  it("aucun navigateur libre : rien n'est compté, les places sont rendues", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const reader = new FakeTrackReader().enqueue({ ok: false, code: "unavailable", launched: false });
    services.track = { reader };
    const ctx = await setupOrg("pro");
    await track.createFilter(ctx, { name: "Jeans", criteria });
    const limiter = new PageRateLimiter(5);
    const machine = new PageRateLimiter(5);
    const r = await trackTick(services, silent, { limiter, machineLimiter: machine });
    expect(r).toMatchObject({ reads: 0, blocked: 0, skipped: { no_browser: 1 } });
    expect(limiter.used(clock)).toBe(0);
    expect(machine.used(clock)).toBe(0);
  });
});

// ---------------------------------------------------------------- modèle de prix

/** Références de démonstration de @selio/pricing → base de références (catégories de Selio, aucune donnée personnelle). */
function syntheticReferences(n: number, seed: number): PriceReferenceInput[] {
  const CATEGORY: Record<string, ItemCategory> = { Jupes: "women", Robes: "women", Baskets: "shoes", Bottes: "shoes", Sacs: "bags", "Vêtements enfant": "kids" };
  return generateSyntheticReferences({ n, seed, now: T0, dirtyShare: 0 }).map((r, i) => ({
    dedupeKey: `demo:synthetic:${seed}:${i}`,
    source: "demo",
    status: r.soldAt ? "sold" : "listed",
    brand: r.brand || null,
    category: CATEGORY[r.category] ?? "men",
    // Le type de pièce du générateur garde l'information fine (« Jeans », « Manteaux »…).
    subcategory: r.category.slice(0, 60),
    size: r.size ?? null,
    material: r.material ?? null,
    color: r.color ?? null,
    condition: parseCondition(r.condition),
    listedPriceCents: r.listedPriceCents,
    finalPriceCents: r.finalPriceCents ?? null,
    finalPriceEstimated: false,
    listedAt: typeof r.listedAt === "string" ? r.listedAt : r.listedAt.toISOString(),
    soldAt: r.soldAt ? (typeof r.soldAt === "string" ? r.soldAt : r.soldAt.toISOString()) : null,
    photoCount: r.photoCount ?? null,
    views: r.views ?? null,
    favorites: r.favorites ?? null,
  }));
}

describe("worker : modèle de prix (pricing.train, pricing.references)", () => {
  it("refuse sous le seuil, puis entraîne sur les références de démonstration, charge le modèle et le marque comme tel", async () => {
    if (!available) return;
    services.pricing = createPricingServices(() => new Date(clock));
    const ctx = await setupOrg("pro");
    await services.db.withGlobal((tx) => repos.priceReferences.upsertMany(tx, syntheticReferences(40, 1)));
    const refused = await pricingTrainTask(services, silent, { refreshReferences: false });
    expect(refused).toMatchObject({ trained: false, version: null, loaded: null });
    expect(refused.reason).toMatch(/Pas assez de ventes/);
    expect((await pricing.getModelStatus(ctx)).label).toBe("Modèle non entraîné");

    await services.db.withGlobal((tx) => repos.priceReferences.upsertMany(tx, syntheticReferences(3000, 7)));
    // Seuil du serveur plus haut que la base : refus.
    expect(await pricingTrainTask(services, silent, { refreshReferences: false, minReferences: 10_000 })).toMatchObject({ trained: false, reason: expect.stringMatching(/10000 nécessaires/) });
    const ok = await pricingTrainTask(services, silent, { minReferences: 500 });
    expect(ok).toMatchObject({ trained: true, synthetic: true });
    expect(ok.version).toMatch(/^gbm-20261030T080000-demo-[a-f0-9]{10}$/);
    expect(ok.loaded).toBe(ok.version);
    const model = services.pricing.model!;
    expect(model.synthetic).toBe(true);
    const p = model.predict({ category: "women", subcategory: "Robes", brand: "Zara", condition: "very_good", size: "M" });
    expect(p.p25).toBeGreaterThan(0);
    expect(p.p25).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.dataOrigin).toBe("demo");
    // État affiché : « données de démonstration », aucune mesure présentée comme réelle.
    const status = await pricing.getModelStatus(ctx);
    expect(status).toMatchObject({ trained: true, synthetic: true, label: "Données de démonstration", metrics: null, version: ok.version });
    const stored = await services.db.withGlobal((tx) => repos.priceModels.active(tx));
    expect(stored?.metrics).toMatchObject({ measured: false, dataOrigin: "demo", synthetic: true });
    // Rechargé depuis la base (redémarrage, ou l'API) : mêmes prédictions.
    const reloaded = loadStoredPriceModel({ version: stored!.version, model: stored!.model, synthetic: stored!.synthetic }, () => new Date(clock));
    expect(reloaded.predict({ category: "women", subcategory: "Robes", brand: "Zara", condition: "very_good", size: "M" })).toEqual(p);
    // Une estimation utilise le modèle chargé (marqué « démonstration »).
    const est = await pricing.estimate(ctx, { category: "women", subcategory: "Robes", brand: "Zara", condition: "very_good" });
    expect(est).toMatchObject({ method: "model", modelVersion: ok.version, demo: true });
  }, 120_000);

  it("entraîne dans un fil séparé : la boucle d'événements du worker reste libre ; arrêté au-delà de la durée maximale", async () => {
    const rows = generateSyntheticReferences({ n: 3000, seed: 5, now: T0, dirtyShare: 0 }).map((r) => ({
      brand: r.brand, category: r.category, subcategory: null, size: r.size ?? null, material: r.material ?? null, color: r.color ?? null, condition: parseCondition(r.condition),
      listedPriceCents: r.listedPriceCents, finalPriceCents: r.finalPriceCents ?? null, finalPriceEstimated: false,
      listedAt: typeof r.listedAt === "string" ? r.listedAt : r.listedAt.toISOString(), soldAt: r.soldAt ? (typeof r.soldAt === "string" ? r.soldAt : r.soldAt.toISOString()) : null,
      photoCount: r.photoCount ?? null, views: null, favorites: null, source: "demo" as const,
    }));
    const reports: unknown[] = [];
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const started = Date.now();
    const out = await new ThreadedPriceTrainer({ onReport: (r) => reports.push(r) }).train(rows, { now: T0, synthetic: true });
    const elapsed = Date.now() - started;
    clearInterval(timer);
    expect(out).toMatchObject({ ok: true, version: expect.stringMatching(/^gbm-20261030T080000-demo-/) });
    expect(reports).toHaveLength(1);
    // Pendant le calcul, les minuteries du worker ont continué de tourner (au moins une sur deux).
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(elapsed / 20 / 2));
    // Même résultat que dans le processus (déterministe).
    const inProcess = await new GbmPriceTrainer().train(rows, { now: T0, synthetic: true });
    expect(inProcess.ok && out.ok && inProcess.version).toBe(out.ok && out.version);
    // Au-delà de la durée maximale : fil arrêté, « entraînement interrompu », rien n'est rendu.
    expect(await new ThreadedPriceTrainer({ maxMs: 1 }).train(rows, { now: T0, synthetic: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/interrompu/) });
  }, 120_000);

  it("ajoute à la base de références les ventes des organisations qui l'ont accepté, sans donnée personnelle", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    // Accord de l'organisation (désactivé par défaut) : sans lui, rien n'est versé.
    await services.db.withGlobal((tx) => repos.orgs.update(tx, ctx.orgId, { settings: orgSettings.parse({ pricing: { shareSales: true } }) }));
    await services.db.withOrg(ctx.orgId, async (tx) => {
      const it = await repos.items.create(tx, { title: "Veste Carhartt de Léa", brand: "Carhartt", category: "men", condition: "very_good", status: "sold", purchasePriceCents: 800, listedPriceCents: 4500, listedAt: "2026-10-01T09:00:00.000Z", size: "L", attributes: { colors: ["Marron"], material: "Coton", generatedBy: null } });
      const customer = await repos.customers.create(tx, { displayName: "Léa Martin", handle: "lea_martin_secret", provider: "vinted" });
      await repos.orders.create(tx, { itemId: it.id, customerId: customer.id, dedupeKey: `vinted:${it.id}`, status: "completed", salePriceCents: 4200, provider: "vinted", simulated: false });
    });
    const r = await pricingReferencesTick(services, silent);
    expect(r.errors).toBe(0);
    expect(r.orgs).toBeGreaterThanOrEqual(1);
    expect(r.sharing).toBeGreaterThanOrEqual(1);
    expect(r.references).toBeGreaterThanOrEqual(1);
    const rows = (await owner.query("select * from price_references where source = 'sale'")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ brand: "Carhartt", category: "men", final_price_cents: 4200, status: "sold" });
    expect(JSON.stringify(rows)).not.toMatch(/Léa|lea_martin|Veste Carhartt de/);
    // Idempotent : la même vente n'est pas dupliquée.
    await pricingReferencesTick(services, silent);
    expect((await owner.query("select count(*)::int as n from price_references where source = 'sale'")).rows[0].n).toBe(1);
  });

  it("ne transmet à l'entraîneur que les champs autorisés", () => {
    const ref = toPricingReference({ brand: "Levi's", category: "men", subcategory: null, size: "W32", material: null, color: null, condition: null, listedPriceCents: 2500, finalPriceCents: 2300, finalPriceEstimated: true, listedAt: T0.toISOString(), soldAt: null, photoCount: 3, views: null, favorites: null, source: "track" });
    expect(Object.keys(ref).sort()).toEqual(["brand", "category", "color", "condition", "favorites", "finalPriceCents", "finalPriceEstimated", "listedAt", "listedPriceCents", "material", "photoCount", "size", "soldAt", "source", "subcategory", "views"]);
  });
});

// ---------------------------------------------------------------- rétention selon le plan

describe("worker : rétention de Track selon le plan", () => {
  const scan = (ctx: OrgContext, createdAt: Date) => services.db.withOrg(ctx.orgId, (tx) => repos.trackScans.create(tx, { brand: "Levi's", category: "men", status: "insufficient_data", score: null, components: null, basedOn: { references: 0, snapshots: 0, sold: 0, demo: true }, details: { medianDaysToSell: null, activeListings: 0, medianResaleCents: null, medianBuyCents: null }, message: null, createdAt: createdAt.toISOString() }));
  const scansOf = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.trackScans.list(tx));

  it("garde 3 mois en Pro, 12 en Agence, rien sans Track ; coupe les filtres au-delà du quota", async () => {
    if (!available) return;
    // Horloge réelle : la purge des instantanés compare aux dates de la base.
    clock = new Date();
    const day = 86_400_000;
    const pro = await setupOrg("pro");
    const agence = await setupOrg("agence");
    const starter = await setupOrg("pro");
    await scan(pro, new Date(clock.getTime() - 120 * day));
    await scan(pro, new Date(clock.getTime() - 20 * day));
    await scan(agence, new Date(clock.getTime() - 200 * day));
    await scan(agence, new Date(clock.getTime() - 400 * day));
    await scan(starter, new Date(clock.getTime() - 2 * day));
    // Agence ramenée à Pro avec 7 filtres : les 2 plus récents sont coupés ; Pro ramené à Starter : tout est coupé.
    for (let i = 0; i < 7; i++) {
      const f = await track.createFilter(agence, { name: `Filtre ${i}`, criteria: { ...criteria, maxPriceCents: 1000 + i } });
      await owner.query("update track_filters set created_at = $1 where id = $2", [new Date(clock.getTime() - (10 - i) * 60_000).toISOString(), f.id]);
    }
    const starterFilter = await track.createFilter(starter, { name: "Jeans", criteria: { ...criteria, keywords: ["starter"] } });
    await trackTick(services, silent, { limiter: new PageRateLimiter(10) });
    expect(await snapshotsOf(starterFilter.fingerprint)).toBe(1);
    await setPlan(agence.orgId, "pro");
    await setPlan(starter.orgId, "starter");

    const res = await retentionTick(services, silent);
    expect(res.track.errors).toBe(0);
    expect(res.track.scans).toBeGreaterThanOrEqual(3);
    expect(res.track.filtersDisabled).toBe(3);
    expect((await scansOf(pro)).map((s) => s.createdAt.slice(0, 10))).toEqual([new Date(clock.getTime() - 20 * day).toISOString().slice(0, 10)]);
    // Agence (désormais Pro) : 3 mois gardés → le scan de 200 jours part aussi.
    expect(await scansOf(agence)).toHaveLength(0);
    expect(await scansOf(starter)).toHaveLength(0);
    const filters = await track.listFilters(agence);
    expect(filters.filter((f) => f.enabled)).toHaveLength(5);
    expect(filters.filter((f) => !f.enabled).map((f) => f.name).sort()).toEqual(["Filtre 5", "Filtre 6"]);
    expect((await track.listFilters(starter)).every((f) => !f.enabled)).toBe(true);
    // Sans Track : instantanés de l'empreinte supprimés, et plus aucune lecture.
    expect(await snapshotsOf(starterFilter.fingerprint)).toBe(0);
    const due = await services.db.withGlobal((tx) => repos.trackReads.due(tx, new Date(clock.getTime() + 10 * 3_600_000).toISOString(), 50));
    expect(due.map((d) => d.fingerprint)).not.toContain(starterFilter.fingerprint);
    // Une seconde passe ne coupe plus rien.
    expect((await retentionTick(services, silent)).track.filtersDisabled).toBe(0);
  });
});
