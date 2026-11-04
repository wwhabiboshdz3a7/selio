import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIError, AIService, MockAIProvider, createAIService, type AIProvider, type EmbedResult } from "@selio/ai";
import { PRICE_MODEL_DEMO_DATA, PRICE_MODEL_MIN_REFERENCES, PRICE_MODEL_NOT_TRAINED, PRICE_NOT_ENOUGH_REFERENCES, PRICE_REFERENCE_KEYS, quotasForPlan, type Plan, type PriceReferenceInput } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { OrgContext, Services } from "../context";
import * as org from "./org";
import * as pricing from "./pricing";
import * as radar from "./radar";
import * as studio from "./studio";

/**
 * Estimation des prix sur PostgreSQL, base DÉDIÉE (selio_test_core_pricing, créée si besoin) : ce fichier
 * vide les organisations et les tables partagées de prix de sa base. Modèle et entraîneur factices, faux
 * modèle 2, IA simulée, horloge injectée. Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_PRICING_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_pricing";
const APP_URL = process.env.TEST_CORE_PRICING_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_pricing";

const T0 = new Date("2026-10-30T09:00:00.000Z");

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let seq = 0;
const mockAi = createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false });
const aiWith = (provider: AIProvider) => new AIService({ provider, concurrency: 2, maxPending: 20, circuitFailures: 5, circuitCooldownMs: 1000, timeoutMs: 5000, allowFallback: false });

/** Faux modèle 2 : un axe par mot-clé reconnu dans le texte. Garde les textes vectorisés. */
class KeywordEmbedProvider extends MockAIProvider {
  readonly embedded: string[] = [];
  override async embed(texts: string[]): Promise<EmbedResult> {
    this.embedded.push(...texts);
    const v = (t: string) => (/ralph/i.test(t) ? [1, 0, 0] : /levi/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
    return { embeddings: texts.map(v), dimensions: 3, usage: { promptTokens: 0, outputTokens: 0 }, latencyMs: 0, model: this.embedModel, provider: "fake" };
  }
}

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
    ai: mockAi,
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
  services.ai = mockAi;
  services.pricing = undefined;
  await owner.query("truncate price_references, price_models");
});

async function setupOrg(plan: Plan = "pro", settings: Record<string, unknown> = {}): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `pricing${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Prix ${n}`, slug: `org-prix-${n}`, settings });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotasForPlan(plan) }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: null };
}

/** Vente réelle de l'organisation (client avec un pseudo : il ne doit jamais rejoindre la base de références). */
async function addSale(ctx: OrgContext, title: string, brand: string | null, priceCents: number, extra: { category?: "men" | "women" | "shoes"; simulated?: boolean } = {}): Promise<{ orderId: string; itemId: string }> {
  return services.db.withOrg(ctx.orgId, async (tx) => {
    const it = await repos.items.create(tx, { title, brand, category: extra.category ?? "men", condition: "very_good", status: "sold", purchasePriceCents: 800, listedPriceCents: priceCents + 300, listedAt: "2026-10-01T09:00:00.000Z", size: "M", attributes: { colors: ["Bleu marine"], material: "Coton", generatedBy: null } });
    const customer = await repos.customers.create(tx, { displayName: "Léa Martin", handle: `lea_martin_${++seq}`, provider: "vinted" });
    const order = await repos.orders.create(tx, { itemId: it.id, customerId: customer.id, dedupeKey: `vinted:${it.id}`, status: "completed", salePriceCents: priceCents, provider: extra.simulated ? "demo" : "vinted", simulated: extra.simulated ?? false });
    return { orderId: order.id, itemId: it.id };
  });
}

const ref = (i: number, over: Partial<PriceReferenceInput> = {}): PriceReferenceInput => ({
  dedupeKey: `track:${String(i).padStart(64, "0")}`, source: "track", status: "gone", brand: "Levi's", category: "men", condition: "very_good",
  listedPriceCents: 2000 + (i % 10) * 100, finalPriceCents: 2000 + (i % 10) * 100, finalPriceEstimated: true, listedAt: "2026-09-01T00:00:00.000Z", soldAt: "2026-09-08T00:00:00.000Z", ...over,
});

// ---------------------------------------------------------------- fonctions pures

describe("Estimation des prix : moteur (fonctions pures)", () => {
  const comp = (ref: string, priceCents: number, extra: Partial<pricing.PricingComparable> = {}): pricing.PricingComparable => ({ ref, kind: "sale", text: `Levi's jean ${ref}`, brand: "Levi's", category: "men", condition: "very_good", priceCents, delayDays: 7, estimated: false, at: T0.toISOString(), ...extra });
  const target: pricing.PricingTarget = { title: "Jean Levi's 501", brand: "Levi's", category: "men", condition: "very_good" };

  it("arrondit au prix psychologique (x,90) et pondère les comparables par leur nombre", () => {
    expect(pricing.roundPrice(2743)).toBe(2790);
    expect(pricing.roundPrice(2690)).toBe(2690);
    expect(pricing.roundPrice(2700)).toBe(2690);
    expect(pricing.roundPrice(95)).toBe(100);
    expect(pricing.comparablesWeight(0)).toBe(0);
    expect(pricing.comparablesWeight(6)).toBe(0.4);
    expect(pricing.comparablesWeight(12)).toBe(0.8);
    expect(pricing.comparablesWeight(40)).toBe(0.8);
    expect(pricing.quantileCents([1000, 2000, 3000, 4000], 0.25)).toBe(1750);
    expect(pricing.quantileCents([], 0.5)).toBeNull();
  });

  it("comparables seuls, modèle seul, combinaison, ou « pas assez de références »", () => {
    const comps = [2000, 2400, 2600, 3000].map((p, i) => comp(`o${i}`, p));
    const onlyComps = pricing.combineEstimate(target, pricing.selectComparables(target, comps), null);
    expect(onlyComps).toMatchObject({ method: "comparables", comparableCount: 4, p25: 2300, p50: 2500, p75: 2700, confidenceLevel: "high", delayDays: 7, modelVersion: null });
    expect(onlyComps.strategies).toEqual({ fast: 2290, standard: 2490, max: 2690 });

    const model = new pricing.FakePriceModel({ p25: 1800, p50: 2200, p75: 2900, delayDays: 12, confidence: "medium" }, "gb-test");
    const onlyModel = pricing.combineEstimate(target, pricing.selectComparables(target, []), model);
    expect(onlyModel).toMatchObject({ method: "model", comparableCount: 0, p50: 2200, delayDays: 12, confidence: 0.6, confidenceLevel: "medium", modelVersion: "gb-test", weights: { comparables: 0, model: 1 } });
    expect(model.calls[0]).toMatchObject({ brand: "Levi's", category: "men", condition: "very_good" });

    const blend = pricing.combineEstimate(target, pricing.selectComparables(target, comps), model);
    // 4 comparables : poids 0,8 × 4 / 12.
    const wc = pricing.comparablesWeight(4);
    expect(blend).toMatchObject({ method: "blend", comparableCount: 4, weights: { comparables: wc } });
    expect(blend.p50).toBe(Math.round(2500 * wc + 2200 * (1 - wc)));
    expect(blend.factors.some((f) => f.startsWith("Poids des comparables"))).toBe(true);

    const none = pricing.combineEstimate({ ...target, brand: null }, pricing.selectComparables({ ...target, brand: null }, comps), null);
    expect(none).toMatchObject({ method: "none", p50: null, strategies: null, message: PRICE_NOT_ENOUGH_REFERENCES, comparableCount: 0 });
  });

  it("par similarité : 8 au plus au-dessus de 0,6 dans la catégorie ; ajuste à l'état ; signale un modèle de démonstration", () => {
    const comps = [comp("a", 4000), comp("b", 5000), comp("c", 6000), comp("d", 9000, { brand: "Ralph Lauren" }), comp("e", 100, { category: "shoes" })];
    const pool = new Map([["sale:a", [1, 0]], ["sale:b", [0.9, 0.1]], ["sale:c", [1, 0.05]], ["sale:d", [0, 1]], ["sale:e", [1, 0]]]);
    const sel = pricing.selectComparables(target, comps, { target: [1, 0], pool });
    expect(sel).toMatchObject({ method: "embeddings", level: "medium" });
    expect(sel.comparables.map((c) => c.ref).sort()).toEqual(["a", "b", "c"]);
    const good = pricing.combineEstimate({ ...target, condition: "good" }, sel, null);
    expect(good).toMatchObject({ method: "embeddings", p50: 4500 });
    const demo = pricing.combineEstimate(target, sel, new pricing.FakePriceModel({ p50: 5000 }, "demo-1", true));
    expect(demo).toMatchObject({ method: "blend", demo: true });
    expect(demo.message).toContain(PRICE_MODEL_DEMO_DATA);
  });
});

// ---------------------------------------------------------------- service (base)

describe("Estimation des prix : service", () => {
  it("estime par les ventes de l'organisation, puis par la base de références, sinon « pas assez de références »", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    expect(await pricing.estimate(ctx, { title: "Jean Levi's 501", brand: "Levi's", category: "men", condition: "very_good" })).toMatchObject({ method: "none", strategies: null, message: PRICE_NOT_ENOUGH_REFERENCES, explanation: null });
    await addSale(ctx, "Jean Levi's 501 bleu", "Levi's", 2500);
    await addSale(ctx, "Jean Levi's 505 brut", "Levi's", 3100);
    const fromSales = await pricing.estimate(ctx, { title: "Jean Levi's 501", brand: "Levi's", category: "men", condition: "very_good" });
    // Mock du modèle 2 : vecteurs par mots ; 2 ventes de la marque au moins.
    expect(["embeddings", "comparables"]).toContain(fromSales.method);
    expect(fromSales.comparableCount).toBe(2);
    expect(fromSales.p50).toBe(2800);
    // Base de références partagée (les références de démonstration ne servent jamais de comparables).
    await services.db.withGlobal((tx) => repos.priceReferences.upsertMany(tx, [...Array.from({ length: 6 }, (_, i) => ref(i, { brand: "Carhartt" })), ref(99, { brand: "Carhartt", source: "demo", dedupeKey: "demo:abcdefgh", finalPriceCents: 99_000 })]));
    const fromBase = await pricing.estimate(ctx, { brand: "Carhartt", category: "men", condition: "good" });
    expect(fromBase).toMatchObject({ method: "comparables", comparableCount: 6 });
    expect(fromBase.p75!).toBeLessThan(5000);
    expect(fromBase.factors[0]).toContain("dont 6 de la base de références");
  });

  it("affine par similarité des titres (modèle 2) et garde les vecteurs dans le cache de Radar", async () => {
    if (!available) return;
    const fake = new KeywordEmbedProvider();
    services.ai = aiWith(fake);
    const ctx = await setupOrg();
    await addSale(ctx, "Pull Ralph Lauren col rond", "Ralph Lauren", 4000);
    await addSale(ctx, "Pull Ralph Lauren torsadé", "Ralph Lauren", 5000);
    await addSale(ctx, "Pull sans marque façon Ralph", null, 6000);
    await addSale(ctx, "Jean Levi's 501", "Levi's", 9000);
    const est = await pricing.estimate(ctx, { title: "Pull Ralph Lauren laine", brand: "Ralph Lauren", category: "men", condition: "very_good" });
    // La vente sans marque au titre proche compte (D34) ; le jean Levi's non.
    expect(est).toMatchObject({ method: "embeddings", comparableCount: 3, p50: 5000, confidenceLevel: "medium" });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.embeddingsCache.count(tx, "sale"))).toBe(4);
    fake.embedded.length = 0;
    await pricing.estimate(ctx, { title: "Pull Ralph Lauren laine", brand: "Ralph Lauren", category: "men", condition: "very_good" });
    expect(fake.embedded).toEqual([]);
  });

  it("combine avec le modèle de prix chargé : modèle seul sans comparable, mélange avec", async () => {
    if (!available) return;
    const model = new pricing.FakePriceModel({ p25: 1500, p50: 2000, p75: 2600, delayDays: 10, confidence: 0.7 }, "gb-2026-10-23");
    services.pricing = { model };
    const ctx = await setupOrg();
    expect(await pricing.estimate(ctx, { brand: "Sézane", category: "women", condition: "good" })).toMatchObject({ method: "model", p50: 2000, strategies: { fast: 1490, standard: 1990, max: 2590 }, modelVersion: "gb-2026-10-23", delayDays: 10 });
    for (const [i, p] of [2400, 2600, 2800].entries()) await addSale(ctx, `Robe Sézane ${i}`, "Sézane", p, { category: "women" });
    const blend = await pricing.estimate(ctx, { brand: "Sézane", category: "women", condition: "very_good" });
    expect(blend).toMatchObject({ method: "blend", comparableCount: 3, modelVersion: "gb-2026-10-23" });
    expect(blend.p50).toBe(Math.round(2600 * pricing.comparablesWeight(3) + 2000 * (1 - pricing.comparablesWeight(3))));
  });

  it("explication facultative par mon IA perso, jamais bloquante, écartée si l'IA est désactivée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    for (const p of [2400, 2600, 2800]) await addSale(ctx, "Pull Lacoste", "Lacoste", p);
    const features = { brand: "Lacoste", category: "men" as const, condition: "very_good" as const };
    const silent = await pricing.estimate(ctx, features);
    expect(silent.explanation).toBeNull();
    const explained = await pricing.estimate(ctx, { ...features, explain: true });
    expect(explained).toMatchObject({ explanationSource: "ai", p50: silent.p50, strategies: silent.strategies });
    expect(explained.explanation).toContain("24,90 €");
    expect(explained.explanation).toContain("3 vente(s) comparable(s)");
    // IA en panne : l'estimation reste, sans explication.
    services.ai = aiWith(new MockAIProvider({ failWith: new AIError("unavailable", "panne") }));
    expect(await pricing.estimate(ctx, { ...features, explain: true })).toMatchObject({ explanation: null, explanationSource: null, p50: silent.p50 });
    services.ai = mockAi;
    const off = await setupOrg("pro", { ai: { enabled: false } });
    await addSale(off, "Pull Lacoste", "Lacoste", 2500);
    await addSale(off, "Pull Lacoste", "Lacoste", 2700);
    expect((await pricing.estimate(off, { ...features, explain: true })).explanation).toBeNull();
  });

  it("convertit les ventes réelles en références sans aucune donnée personnelle, seulement avec l'accord de l'organisation", async () => {
    if (!available) return;
    // Sans accord (défaut) : rien n'est versé.
    const noConsent = await setupOrg();
    await addSale(noConsent, "Pull Ralph Lauren", "Ralph Lauren", 4200);
    expect(await pricing.addReferencesFromSales(services, noConsent.orgId)).toEqual({ written: 0, removed: 0, shared: false });
    const ctx = await setupOrg("pro", { pricing: { shareSales: true } });
    const a = await addSale(ctx, "Pull Ralph Lauren de Léa", "Ralph Lauren", 4200);
    await addSale(ctx, "Pull démo", "Ralph Lauren", 3000, { simulated: true });
    expect(await pricing.addReferencesFromSales(services, ctx.orgId)).toEqual({ written: 2, removed: 0, shared: true });
    // Idempotent : aucune référence en double.
    expect(await pricing.addReferencesFromSales(services, ctx.orgId)).toMatchObject({ written: 2, removed: 0 });
    const refs = await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { includeDemo: true }));
    expect(refs).toHaveLength(2);
    for (const r of refs) expect(Object.keys(r).sort()).toEqual([...PRICE_REFERENCE_KEYS].sort());
    const real = refs.find((r) => r.source === "sale")!;
    // Dates au jour (UTC), nombre de photos par tranches.
    expect(real).toMatchObject({ status: "sold", brand: "Ralph Lauren", category: "men", size: "M", color: "Bleu marine", material: "Coton", condition: "very_good", listedPriceCents: 4500, finalPriceCents: 4200, finalPriceEstimated: false, photoCount: 0, listedAt: "2026-10-01T00:00:00.000Z" });
    expect(real.soldAt).toMatch(/T00:00:00\.000Z$/);
    expect(real.dedupeKey).toMatch(/^sale:[a-f0-9]{64}$/);
    expect(refs.find((r) => r.source === "demo")).toBeDefined();
    const stored = JSON.stringify((await owner.query("select * from price_references")).rows);
    for (const needle of ["Léa", "lea_martin", "Pull Ralph", a.orderId, a.itemId]) expect(stored).not.toContain(needle);
    // Vente remboursée : retirée de la base au passage suivant.
    await services.db.withOrg(ctx.orgId, (tx) => tx.query("update orders set status = 'refunded' where id = $1", [a.orderId]));
    expect(await pricing.addReferencesFromSales(services, ctx.orgId)).toMatchObject({ written: 1, removed: 1 });
    expect((await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { includeDemo: true }))).map((r) => r.source)).toEqual(["demo"]);
    // Accord retiré : tout ce que l'organisation a versé est retiré tout de suite, et tracé.
    await org.updateOrg(ctx, { settings: { pricing: { shareSales: false } } });
    expect(await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { includeDemo: true }))).toHaveLength(0);
    const audit = await services.db.withOrg(ctx.orgId, (tx) => repos.audit.list(tx));
    expect(audit.map((x) => x.action)).toContain("pricing.share_sales_disabled");
  });

  it("ne sert jamais les ventes d'une autre organisation une à une, ni ses propres ventes deux fois", async () => {
    if (!available) return;
    const a = await setupOrg("pro", { pricing: { shareSales: true } });
    await addSale(a, "Sweat Maison Kitsuné", "Maison Kitsuné", 8500);
    await addSale(a, "Sweat Maison Kitsuné", "Maison Kitsuné", 12000);
    await pricing.addReferencesFromSales(services, a.orgId);
    const b = await setupOrg("pro");
    // B ne retrouve pas les deux prix de vente de A (ni comparables, ni scans, ni flux des ventes).
    expect(await pricing.estimate(b, { brand: "Maison Kitsuné", category: "men", condition: "very_good" })).toMatchObject({ method: "none", p25: null, comparableCount: 0 });
    const since = "2026-01-01T00:00:00.000Z";
    expect(await services.db.withOrg(b.orgId, (tx) => repos.priceReferences.nicheStats(tx, { category: "men", brand: "Maison Kitsuné", since, includeDemo: true }))).toMatchObject({ total: 0, sold: 0, medianFinalCents: null });
    expect(await services.db.withOrg(b.orgId, (tx) => repos.priceReferences.salesByNiche(tx, { since, includeDemo: true }))).toEqual([]);
    expect(await services.db.withOrg(b.orgId, (tx) => repos.priceReferences.nicheSummary(tx, { since, includeDemo: true }))).toEqual([]);
    // A : ses deux ventes, une seule fois (ses commandes), pas quatre après le passage de nuit.
    expect(await pricing.estimate(a, { brand: "Maison Kitsuné", category: "men", condition: "very_good" })).toMatchObject({ comparableCount: 2 });
    // Ces ventes restent dans la base pour l'entraînement agrégé du modèle (lecture globale du worker).
    expect(await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { withFinalPrice: true, sources: ["sale"] }))).toHaveLength(2);
  });

  it("Radar ne se sert jamais d'un modèle de démonstration pour une vraie annonce", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    services.pricing = { model: new pricing.FakePriceModel({ p50: 9000 }, "demo-1", true) };
    const item = { externalRef: "1", title: "Veste Kenzo", priceCents: 2000, shippingCents: null, brand: "Kenzo", size: "M", condition: "very_good" as const, category: "men" as const, url: null, photoUrl: null, photoCount: 3, sellerHandle: null, sellerRating: null, sellerReviews: null, publishedAt: null, publishedAtSource: "unknown" as const };
    const pools = { sales: [], references: [] };
    const [demo] = await radar.estimateForItems(ctx, [item], pools);
    expect(demo).toMatchObject({ method: "model", resalePriceCents: 9000 });
    const [live] = await radar.estimateForItems(ctx, [item], pools, { live: true });
    expect(live!.method).toBe("brand_category");
    expect(live!.resalePriceCents).not.toBe(9000);
  });
});

// ---------------------------------------------------------------- modèle de prix

describe("Estimation des prix : entraînement du modèle", () => {
  const seed = async (n: number, source: "track" | "demo") => {
    const rows = Array.from({ length: n }, (_, i) => ref(i, { source, dedupeKey: `${source}:${String(i).padStart(64, "0")}` }));
    await services.db.withGlobal((tx) => repos.priceReferences.upsertMany(tx, rows));
  };

  it("refuse sous le seuil, entraîne sur la base réelle, archive l'ancien modèle et recharge le nouveau", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const trainer = new pricing.FakePriceTrainer();
    const loaded: string[] = [];
    services.pricing = { model: null, trainer, loader: (s) => { loaded.push(s.version); return new pricing.FakePriceModel({ p50: 2100 }, s.version, s.synthetic); } };
    expect(await pricing.getModelStatus(ctx)).toMatchObject({ trained: false, label: PRICE_MODEL_NOT_TRAINED, metrics: null });
    await seed(PRICE_MODEL_MIN_REFERENCES - 1, "track");
    // Des annonces encore en ligne (sans prix final) ne comptent pas comme des ventes.
    await services.db.withGlobal((tx) => repos.priceReferences.upsertMany(tx, Array.from({ length: 50 }, (_, i) => ref(10_000 + i, { status: "listed", finalPriceCents: null, finalPriceEstimated: false, soldAt: null }))));
    expect(await pricing.trainActiveModel(services)).toMatchObject({ trained: false, references: PRICE_MODEL_MIN_REFERENCES - 1 });
    expect(trainer.calls).toHaveLength(0);
    await seed(PRICE_MODEL_MIN_REFERENCES + 20, "track");
    const ok = await pricing.trainActiveModel(services, { now: T0 });
    expect(ok).toMatchObject({ trained: true, synthetic: false, references: PRICE_MODEL_MIN_REFERENCES + 20 });
    // L'entraîneur ne reçoit que les champs autorisés (aucun identifiant, aucune clé de dédoublonnage).
    expect(Object.keys(trainer.calls[0]!.rows[0]!).sort()).toEqual(["brand", "category", "color", "condition", "favorites", "finalPriceCents", "finalPriceEstimated", "listedAt", "listedPriceCents", "material", "photoCount", "size", "soldAt", "source", "subcategory", "views"]);
    expect(trainer.calls[0]!.rows[0]!).toMatchObject({ source: "track", finalPriceEstimated: true });
    expect(trainer.calls[0]!.rows.every((r) => r.finalPriceCents !== null)).toBe(true);
    expect(loaded).toEqual(["fake-2026-10-30"]);
    expect(services.pricing.model?.version).toBe("fake-2026-10-30");
    const status = await pricing.getModelStatus(ctx);
    expect(status).toMatchObject({ trained: true, synthetic: false, version: "fake-2026-10-30", nReferences: PRICE_MODEL_MIN_REFERENCES + 20, metrics: { mdape: 0.2 } });
    expect(status.label).toMatch(/^Modèle entraîné le 30\/10\/2026/);
    // Une semaine plus tard : nouveau modèle actif, l'ancien archivé.
    await pricing.trainActiveModel(services, { now: new Date(T0.getTime() + 7 * 86_400_000) });
    const models = await services.db.withGlobal((tx) => repos.priceModels.list(tx));
    expect(models.map((m) => m.status)).toEqual(["active", "archived"]);
    // Un nouveau processus recharge le modèle actif.
    services.pricing = { model: null, loader: (s) => new pricing.FakePriceModel({ p50: 1000 }, s.version, s.synthetic) };
    expect((await pricing.refreshActiveModel(services))?.version).toBe("fake-2026-11-06");
    expect(services.pricing.model?.version).toBe("fake-2026-11-06");
  });

  it("sur des données de démonstration seulement : modèle marqué « données de démonstration », aucune mesure affichée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    services.pricing = { model: null, trainer: new pricing.FakePriceTrainer() };
    await seed(PRICE_MODEL_MIN_REFERENCES, "demo");
    expect(await pricing.trainActiveModel(services)).toMatchObject({ trained: true, synthetic: true });
    expect(await pricing.getModelStatus(ctx)).toMatchObject({ trained: true, synthetic: true, label: PRICE_MODEL_DEMO_DATA, metrics: null });
    // Sans entraîneur ou si l'entraîneur refuse : rien n'est enregistré.
    services.pricing = { model: null };
    expect(await pricing.trainActiveModel(services)).toMatchObject({ trained: false });
    services.pricing = { model: null, trainer: new pricing.FakePriceTrainer({ ok: false, reason: "Mois de test trop court." }) };
    expect(await pricing.trainActiveModel(services)).toEqual({ trained: false, reason: "Mois de test trop court.", references: PRICE_MODEL_MIN_REFERENCES });
    expect(await services.db.withGlobal((tx) => repos.priceModels.list(tx))).toHaveLength(1);
  });
});

describe("Estimation des prix : lignes d'entraînement", () => {
  it("transmet le prix estimé et n'invente aucun délai sans date de mise en ligne", () => {
    const base = { id: "r1", dedupeKey: "sale:abcdefgh", source: "sale" as const, status: "sold" as const, brand: "Levi's", category: "men" as const, subcategory: null, size: null, material: null, color: null, condition: null, listedPriceCents: 3000, finalPriceCents: 2500, finalPriceEstimated: false, photoCount: null, views: null, favorites: null, createdAt: T0.toISOString(), updatedAt: T0.toISOString() };
    const [unknownListing] = pricing.trainingRows([{ ...base, listedAt: null, soldAt: "2026-10-20T00:00:00.000Z" }]);
    expect(unknownListing).toMatchObject({ listedAt: "2026-10-20T00:00:00.000Z", soldAt: null, finalPriceCents: 2500, finalPriceEstimated: false });
    const [gone] = pricing.trainingRows([{ ...base, source: "track", finalPriceEstimated: true, listedAt: "2026-10-01T00:00:00.000Z", soldAt: "2026-10-09T00:00:00.000Z" }]);
    expect(gone).toMatchObject({ soldAt: "2026-10-09T00:00:00.000Z", finalPriceEstimated: true, source: "track" });
  });

  it("dates au jour et photos par tranches", () => {
    expect(pricing.dayIso("2026-10-30T23:59:59.999Z")).toBe("2026-10-30T00:00:00.000Z");
    expect(pricing.dayIso(null)).toBeNull();
    expect([0, 1, 2, 3, 4, 5, 6, 9, 10, 30].map(pricing.photoBucket)).toEqual([0, 1, 2, 2, 4, 4, 6, 6, 10, 10]);
  });
});

// ---------------------------------------------------------------- Studio

describe("Studio : prix par l'estimation (trois stratégies, plancher et prix d'achat gardés)", () => {
  const photo = { id: "p1", url: "data:image/jpeg;base64,QUJDRA==", alt: "pull-ralph-lauren-bleu-marine.jpg" };

  it("propose les trois stratégies et l'explication, relève au plancher quand le prix d'achat l'impose", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    for (const p of [3800, 4200, 4600]) await addSale(ctx, "Pull Ralph Lauren", "Ralph Lauren", p);
    const draft = await studio.generateListing(ctx, { photos: [photo], hints: { brand: "Ralph Lauren", size: "M" } });
    expect(draft.pricing).not.toBeNull();
    expect(draft.pricing!.method).not.toBe("none");
    expect(draft).toMatchObject({ suggestedPriceCents: draft.pricing!.strategies!.standard, priceLowCents: draft.pricing!.strategies!.fast, priceHighCents: draft.pricing!.strategies!.max, comparableCount: 3 });
    expect(draft.pricing!.explanation).toContain("€");
    // Prix d'achat élevé : plancher (achat + marge minimale) au-dessus des comparables.
    const high = await studio.generateListing(ctx, { photos: [photo], hints: { brand: "Ralph Lauren", size: "M", purchasePriceCents: 5000 } });
    expect(high.suggestedPriceCents).toBeGreaterThan(5000);
    expect(high.priceLowCents).toBe(high.suggestedPriceCents);
    expect(high.warnings.some((w) => w.startsWith("Prix relevé au plancher"))).toBe(true);
    // Sans aucune référence : calcul d'avant (multiple prudent), jamais de blocage.
    const empty = await setupOrg("pro");
    const legacy = await studio.generateListing(empty, { photos: [photo], hints: { brand: "Kenzo" } });
    expect(legacy.pricing?.method).toBe("none");
    expect(legacy.suggestedPriceCents).toBeGreaterThan(0);
  });
});
