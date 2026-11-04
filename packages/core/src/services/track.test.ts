import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIError, AIService, MockAIProvider, createAIService, type AIProvider, type GenerateOptions, type StructuredRequest, type StructuredResult } from "@selio/ai";
import { PRICE_REFERENCE_KEYS, TRACK_DEMO_NOTICE, TRACK_GONE_NOTICE, TRACK_UNAVAILABLE_MESSAGE, quotasForPlan, type Plan, type PriceReferenceInput } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { OrgContext, Services } from "../context";
import * as cloud from "./cloud";
import * as market from "./market";
import * as track from "./track";

/**
 * Selio Track sur PostgreSQL, base DÉDIÉE (selio_test_core_track, créée si besoin) : Vitest 3 en espace de
 * travail peut faire tourner les fichiers de tests d'un paquet en même temps, et ce fichier vide les
 * organisations, les tables partagées de Track et le coupe-circuit de sa base. Lecteur de pages factice
 * (aucune page de Vinted n'est lue), IA simulée, horloge injectée. Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_TRACK_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_track";
const APP_URL = process.env.TEST_CORE_TRACK_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_track";

const T0 = new Date("2026-10-30T08:00:00.000Z");
const PHOTO_B64 = "UEhPVE8tU0VDUkVURS1ERS1URVNULTEyMzQ1Njc4OTA=";

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let seq = 0;
let reader: track.FakeTrackReader;
const mockAi = createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false });
const aiWith = (provider: AIProvider) => new AIService({ provider, concurrency: 4, maxPending: 50, circuitFailures: 50, circuitCooldownMs: 1000, timeoutMs: 5000, allowFallback: false });

/** Modèle de vision qui rend des champs vides (« "brand": "" »), comme souvent les vrais modèles. */
class BlankFieldsVision extends MockAIProvider {
  override async generateStructured<T>(req: StructuredRequest<T>, opts?: GenerateOptions): Promise<StructuredResult<T>> {
    const r = await super.generateStructured(req, opts);
    if (req.schemaName !== "photo_description") return r;
    return { ...r, data: { ...(r.data as object), brand: "", subcategory: "", material: " ", color: "" } as T };
  }
}
/** Fournisseur sans modèle de vision : la photo irait au modèle de texte, qui ne la voit pas. */
class TextOnlyProvider extends MockAIProvider {
  override readonly canSeeImages = false;
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
  reader = new track.FakeTrackReader();
  if (!available || !services) return;
  services.config = {};
  services.ai = mockAi;
  services.track = { reader };
  // Tables partagées de Track et coupe-circuit : propres à cette base de test.
  await owner.query("truncate track_filter_reads, track_snapshots, price_references, price_models");
  await owner.query("delete from track_filters");
  await owner.query("update track_runtime set window_measures = '', slowdown_factor = 1, last_block_at = null, paused_until = null, pause_reason = null");
  await cloud.clearCircuit(services);
});

const advance = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); };

async function setupOrg(plan: Plan = "pro"): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `track${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Track ${n}`, slug: `org-track-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotasForPlan(plan) }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.7" };
}

const criteria = { brands: ["Levi's"], categories: ["men" as const], keywords: ["jean 501"], maxPriceCents: 4000 };

/** Annonce lue sur une page publique (avec pseudo, photo et adresse : rien de cela ne doit être gardé). */
const listing = (ref: string, priceCents: number, extra: Record<string, unknown> = {}) => ({
  externalRef: ref, title: `Jean Levi's 501 de vendeuse_${ref}`, priceCents, shippingCents: 450, brand: "Levi's", size: "W32", condition: "very_good", category: "men",
  url: `https://www.vinted.fr/items/${ref}-jean`, photoUrl: `https://images1.vinted.net/t/${ref}.jpg`, photoCount: 4,
  sellerHandle: `vendeuse_${ref}`, sellerRating: 4.8, sellerReviews: 31, publishedAt: new Date(clock.getTime() - 3_600_000).toISOString(), publishedAtSource: "absolute", ...extra,
});

const dbText = async (sql: string) => JSON.stringify((await owner.query(sql)).rows);

// ---------------------------------------------------------------- fonctions pures

describe("Selio Track : empreinte et rythme (fonctions pures)", () => {
  it("donne la même empreinte aux critères identiques (casse, ordre, espaces) et une autre aux critères différents", () => {
    const a = track.fingerprintOf({ brands: ["Levi's", "Carhartt"], keywords: ["Jean  501"], categories: ["men"], maxPriceCents: 4000 });
    const b = track.fingerprintOf({ brands: [" carhartt", "LEVI'S", "levi's"], keywords: ["jean 501"], categories: ["men", "men"], maxPriceCents: 4000 });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(b).toBe(a);
    expect(track.fingerprintOf({ brands: ["Levi's"], keywords: ["jean 501"], categories: ["men"], maxPriceCents: 4500 })).not.toBe(a);
    expect(track.normalizeTrackCriteria({ sizes: ["m", "M ", "w32"], brands: ["Levi's"] })).toMatchObject({ sizes: ["M", "W32"], brands: ["levi's"] });
    // Accents et apostrophes (clavier iOS) : même recherche, même empreinte — lue une seule fois.
    expect(track.fingerprintOf({ brands: ["Levi’s"], keywords: ["jean 501"], categories: ["men"], maxPriceCents: 4000 })).toBe(track.fingerprintOf({ brands: ["Levi's"], keywords: ["Jean 501"], categories: ["men"], maxPriceCents: 4000 }));
    expect(track.fingerprintOf({ brands: ["Sézane"], keywords: ["Robe été"] })).toBe(track.fingerprintOf({ brands: ["SEZANE"], keywords: ["robe  ete"] }));
    expect(track.normalizeTrackCriteria({ brands: ["Sézane", "Levi`s"] }).brands).toEqual(["levi's", "sezane"]);
  });

  it("relit toutes les 2 h ± 10 min, une seule fois par empreinte, les plus en retard d'abord", () => {
    const next = track.nextTrackReadAt("a".repeat(64), T0);
    const delta = next.getTime() - T0.getTime();
    expect(delta).toBeGreaterThanOrEqual(110 * 60_000);
    expect(delta).toBeLessThanOrEqual(130 * 60_000);
    expect(track.nextTrackReadAt("a".repeat(64), T0)).toEqual(next);
    const slow = track.nextTrackReadAt("a".repeat(64), T0, 2).getTime() - T0.getTime();
    expect(slow).toBeGreaterThanOrEqual(230 * 60_000);
    const at = (min: number) => new Date(T0.getTime() + min * 60_000).toISOString();
    const plan = track.planTrackReads([
      { fingerprint: "b", nextReadAt: at(-5) },
      { fingerprint: "a", nextReadAt: at(-30) },
      { fingerprint: "a", nextReadAt: at(-1) },
      { fingerprint: "c", nextReadAt: at(10) },
    ], T0);
    expect(plan.map((p) => p.fingerprint)).toEqual(["a", "b"]);
    expect(plan[0]!.overdueMs).toBe(30 * 60_000);
  });

  it("ne compte « disparue » qu'une annonce qui aurait dû rester sur la page", () => {
    const s = (k: string, minutesAgo: number) => ({ k, p: 1000, c: "men" as const, f: T0.toISOString(), d: new Date(T0.getTime() - minutesAgo * 60_000).toISOString() });
    const prev = [s("a", 10), s("b", 20), s("old", 500)];
    const current = [s("new", 1), s("a", 10), s("c", 100)];
    // Page pleine : « old » (plus ancienne que la plus ancienne de la page) est sortie de la page, pas disparue.
    expect(track.diffTrackState(prev, current, { pageFull: true, firstRead: false })).toMatchObject({ gone: [{ k: "b" }], newCount: 2 });
    // Page incomplète : tout ce qui manque a disparu.
    expect(track.diffTrackState(prev, current, { pageFull: false, firstRead: false }).gone.map((x) => x.k)).toEqual(["b", "old"]);
    // Première lecture : ni nouvelle, ni disparue.
    expect(track.diffTrackState([], current, { pageFull: false, firstRead: true })).toEqual({ gone: [], newCount: 0 });
    // Page entière plus ancienne que les annonces retenues (filtre local) : la règle porte sur la page entière.
    expect(track.diffTrackState(prev, current, { pageFull: true, firstRead: false, oldestAt: T0.getTime() - 600 * 60_000 }).gone.map((x) => x.k)).toEqual(["b", "old"]);
    // Page pleine et date de publication inconnue : position inconnue, jamais comptée.
    expect(track.diffTrackState([{ ...s("x", 5), d: null }], current, { pageFull: true, firstRead: false }).gone).toEqual([]);
    // Annonces illisibles sur la page : aucune disparition comptée (l'une d'elles peut être celle qui « manque »).
    expect(track.diffTrackState(prev, current, { pageFull: false, firstRead: false, skipGone: true })).toEqual({ gone: [], newCount: 2 });
  });

  it("note une niche par une combinaison documentée de demande, vitesse, concurrence et marge", () => {
    const r = track.scanComponents({ sold: 12, active: 8, activeListings: 50, medianDaysToSell: 6, medianResaleCents: 2500, medianBuyCents: 1250 });
    expect(r.components).toEqual({ demand: 60, speed: 80, competition: 50, margin: 100 });
    expect(r.score).toBe(Math.round(0.35 * 60 + 0.25 * 80 + 0.2 * 50 + 0.2 * 100));
    expect(track.scanComponents({ sold: 0, active: 0, activeListings: 0, medianDaysToSell: null, medianResaleCents: null, medianBuyCents: null }).components).toEqual({ demand: 0, speed: 50, competition: 100, margin: 0 });
  });

  it("garde les deux réglages fermés par défaut", () => {
    expect(track.trackConfigFromEnv({})).toEqual({ trackLiveEnabled: false, trackSellerAnalysisEnabled: false });
    expect(track.trackConfigFromEnv({ TRACK_LIVE_ENABLED: "true", TRACK_SELLER_ANALYSIS_ENABLED: "1" })).toEqual({ trackLiveEnabled: true, trackSellerAnalysisEnabled: true });
  });
});

// ---------------------------------------------------------------- filtres et quotas

describe("Selio Track : filtres suivis et quotas", () => {
  it("refuse le 6e filtre en Pro, et tout filtre sans offre Track", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    for (let i = 0; i < 5; i++) await track.createFilter(ctx, { name: `Filtre ${i}`, criteria: { ...criteria, maxPriceCents: 1000 + i } });
    await expect(track.createFilter(ctx, { name: "Sixième", criteria: { ...criteria, maxPriceCents: 9999 } })).rejects.toMatchObject({ status: 402, code: "quota_exceeded" });
    expect(await track.listFilters(ctx)).toHaveLength(5);
    const starter = await setupOrg("starter");
    await expect(track.createFilter(starter, { name: "Jeans", criteria })).rejects.toMatchObject({ status: 402, message: TRACK_UNAVAILABLE_MESSAGE });
    // Mêmes critères (casse, espaces) dans la même organisation : refusé.
    const agence = await setupOrg("agence");
    await track.createFilter(agence, { name: "Jeans", criteria });
    await expect(track.createFilter(agence, { name: "Doublon", criteria: { ...criteria, brands: ["LEVI'S "] } })).rejects.toMatchObject({ status: 409 });
  });

  it("lit une seule fois une empreinte suivie par deux organisations, puis toutes les 2 h", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const a = await setupOrg("pro");
    const b = await setupOrg("agence");
    const fa = await track.createFilter(a, { name: "Jeans Levi's", criteria });
    const fb = await track.createFilter(b, { name: "Mes 501", criteria: { ...criteria, brands: ["levi's"], keywords: ["Jean 501"] } });
    expect(fb.fingerprint).toBe(fa.fingerprint);
    reader.enqueue({ ok: true, items: [listing("111", 2500), listing("222", 1800)] });
    const tick = await track.runDueTrackReads(services);
    expect(tick).toMatchObject({ due: 1, read: 1, source: "cloud" });
    expect(reader.calls).toHaveLength(1);
    expect(reader.calls[0]).toMatchObject({ fingerprint: fa.fingerprint, vintedHost: "www.vinted.fr", criteria: { brands: ["levi's"], keywords: ["jean 501"] } });
    // Les deux organisations voient la même lecture.
    const [la] = await track.listFilters(a);
    const [lb] = await track.listFilters(b);
    expect(la!.lastReadAt).toBe(T0.toISOString());
    expect(lb!.lastReadAt).toBe(T0.toISOString());
    expect(la!.nextReadAt).toBe(lb!.nextReadAt);
    const wait = new Date(la!.nextReadAt!).getTime() - T0.getTime();
    expect(wait).toBeGreaterThanOrEqual(110 * 60_000);
    expect(wait).toBeLessThanOrEqual(130 * 60_000);
    // Une heure plus tard : rien à lire ; après 2 h 10 : une lecture.
    advance(60);
    expect((await track.runDueTrackReads(services)).due).toBe(0);
    advance(70);
    reader.enqueue({ ok: true, items: [listing("111", 2500), listing("222", 1800)] });
    expect(await track.runDueTrackReads(services)).toMatchObject({ due: 1, read: 1 });
    expect(reader.calls).toHaveLength(2);
    // Un filtre désactivé partout n'est plus lu.
    await track.updateFilter(a, fa.id, { enabled: false });
    await track.updateFilter(b, fb.id, { enabled: false });
    advance(180);
    expect((await track.runDueTrackReads(services)).due).toBe(0);
  });

  it("refuse la lecture en direct sans TRACK_LIVE_ENABLED : le simulateur reste la source", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const f = await track.createFilter(ctx, { name: "Jeans", criteria });
    await expect(track.runTrackRead(services, f.fingerprint, "cloud")).rejects.toMatchObject({ status: 409, code: "track_live_disabled" });
    const tick = await track.runDueTrackReads(services);
    expect(tick).toMatchObject({ source: "demo", read: 1 });
    expect(reader.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- lectures, disparitions, signaux

describe("Selio Track : instantanés et références, statistiques seulement", () => {
  it("transforme une annonce disparue en référence « estimation », sans pseudo, photo, titre ni identifiant", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const ctx = await setupOrg("pro");
    const f = await track.createFilter(ctx, { name: "Jeans", criteria });
    // Dates de publication fixes (comme sur une vraie page) : 222 est plus récente que 333, la plus ancienne.
    const at = (h: number) => ({ publishedAt: new Date(T0.getTime() - h * 3_600_000).toISOString() });
    reader.enqueue({ ok: true, items: [listing("111", 2500, at(3)), listing("222", 1800, at(2)), listing("333", 3000, at(4))] });
    const first = await track.runTrackRead(services, f.fingerprint, "cloud");
    expect(first).toMatchObject({ outcome: "ok", listed: 3, newCount: 0, goneCount: 0, references: 3 });
    clock = new Date(first.nextReadAt!);
    reader.enqueue({ ok: true, items: [listing("111", 2400, at(3)), listing("333", 3000, at(4)), listing("444", 2000, { publishedAt: clock.toISOString() })] });
    const second = await track.runTrackRead(services, f.fingerprint, "cloud");
    expect(second).toMatchObject({ outcome: "ok", listed: 3, newCount: 1, goneCount: 1 });
    const refs = await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { category: "men", includeDemo: true }));
    expect(refs).toHaveLength(4);
    const gone = refs.filter((r) => r.status === "gone");
    expect(gone).toHaveLength(1);
    // Dates au jour (UTC), photos par tranches (4 photos → tranche « 4–5 »).
    expect(gone[0]).toMatchObject({ source: "track", finalPriceCents: 1800, finalPriceEstimated: true, soldAt: `${clock.toISOString().slice(0, 10)}T00:00:00.000Z`, brand: "Levi's", size: "W32", condition: "very_good", photoCount: 4 });
    for (const r of refs) expect(r.listedAt).toMatch(/T00:00:00\.000Z$/);
    expect(refs.find((r) => r.listedPriceCents === 2400)).toMatchObject({ status: "listed", finalPriceCents: null });
    for (const r of refs) {
      expect(Object.keys(r).sort()).toEqual([...PRICE_REFERENCE_KEYS].sort());
      expect(r.dedupeKey).toMatch(/^track:[a-f0-9]{64}$/);
    }
    // La clé d'état qu'un appelant peut calculer pour une annonce n'est PAS celle de sa référence (autre sel).
    const stateKey = (await services.db.withGlobal((tx) => repos.trackReads.refKeys(tx, ["111"]))).get("111")!;
    expect(refs.some((r) => r.dedupeKey === `track:${stateKey}`)).toBe(false);
    // Rien de la page (pseudo, photo, adresse, titre, référence Vinted) n'est en base.
    const stored = await dbText("select (select json_agg(r) from price_references r) as refs, (select json_agg(s) from track_snapshots s) as snaps, (select json_agg(t) from track_filter_reads t) as reads");
    for (const needle of ["vendeuse", "vinted.net", "vinted.fr", "Jean Levi's 501 de", "\"222\"", "\"111\""]) expect(stored).not.toContain(needle);
    // Instantané : agrégats seulement.
    const snaps = await services.db.withGlobal((tx) => repos.trackSnapshots.since(tx, f.fingerprint, T0.toISOString()));
    expect(snaps).toHaveLength(2);
    // Catégorie du filtre non appliquée en direct : l'instantané ne compte pour aucune catégorie.
    expect(snaps[1]).toMatchObject({ source: "cloud", listedCount: 3, newCount: 1, goneCount: 1, medianPriceCents: 2400, brandShares: [{ brand: "Levi's", count: 3, share: 1 }], scope: { categories: ["men"], brands: ["levi's"], categoriesVerified: false } });
    expect(snaps[1]!.medianDaysListed).toBeGreaterThan(0);
    // Tendances : un point par jour, disparitions annoncées comme une estimation.
    const t = await track.trends(ctx, f.id);
    expect(t).toMatchObject({ days: 30, snapshots: 2, goneTotal: 1, source: "cloud", demo: false });
    expect(t.notices).toContain(TRACK_GONE_NOTICE);
  });

  it("au premier signal de Vinted : arrêt, pause de Track, ralentissement, coupe-circuit après un « trop de requêtes », rien n'est retenté", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const ctx = await setupOrg("agence");
    const f1 = await track.createFilter(ctx, { name: "Jeans", criteria });
    const f2 = await track.createFilter(ctx, { name: "Vestes", criteria: { ...criteria, keywords: ["veste"] } });
    reader.enqueue({ ok: false, code: "captcha", message: "Vérification" });
    const tick = await track.runDueTrackReads(services);
    // Le passage s'arrête au signal : la seconde empreinte n'est pas lue.
    expect(reader.calls).toHaveLength(1);
    expect(tick.results[0]).toMatchObject({ outcome: "captcha", paused: true, factor: 2, circuitUntil: null });
    const runtime = await services.db.withGlobal((tx) => repos.trackReads.runtime(tx));
    expect(runtime).toMatchObject({ windowReads: 1, windowBlocks: 1, slowdownFactor: 2, pauseReason: "captcha", pausedUntil: new Date(T0.getTime() + 60 * 60_000).toISOString() });
    const other = [f1, f2].find((f) => f.fingerprint !== reader.calls[0]!.fingerprint)!;
    expect(await track.runTrackRead(services, other.fingerprint, "cloud")).toMatchObject({ skipped: "paused" });
    expect(reader.calls).toHaveLength(1);
    // Après la pause : « trop de requêtes » → coupe-circuit de toute la machine.
    advance(61);
    reader.enqueue({ ok: false, code: "rate_limited" });
    const limited = await track.runTrackRead(services, other.fingerprint, "cloud");
    expect(limited).toMatchObject({ outcome: "rate_limited", paused: true });
    expect(limited.circuitUntil).not.toBeNull();
    expect(await cloud.machinePausedUntil(services)).not.toBeNull();
    expect(await track.runTrackRead(services, f1.fingerprint, "cloud")).toMatchObject({ skipped: "paused" });
    // Pause de Track levée, coupe-circuit de la machine toujours actif : toujours rien de lu.
    await owner.query("update track_runtime set paused_until = null");
    expect(await track.runTrackRead(services, f1.fingerprint, "cloud")).toMatchObject({ skipped: "machine_paused" });
    expect(reader.calls).toHaveLength(2);
    // Aucun navigateur libre : rien n'est compté, nouvel essai 5 min plus tard.
    await cloud.clearCircuit(services);
    advance(240);
    reader.enqueue({ ok: false, code: "unavailable", launched: false });
    const before = await services.db.withGlobal((tx) => repos.trackReads.runtime(tx));
    // L'empreinte arrêtée au CAPTCHA (facteur ×2 : 4 h ± 10 min) est de nouveau due.
    const unavailable = await track.runTrackRead(services, reader.calls[0]!.fingerprint, "cloud");
    expect(unavailable).toMatchObject({ outcome: null, skipped: null });
    expect((await services.db.withGlobal((tx) => repos.trackReads.runtime(tx))).windowReads).toBe(before.windowReads);
  });

  it("le simulateur produit des données de démonstration, annoncées comme telles", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const f = await track.createFilter(ctx, { name: "Jeans", criteria });
    const first = await track.runDueTrackReads(services);
    expect(first.results[0]).toMatchObject({ source: "demo", outcome: "ok", newCount: 0, goneCount: 0 });
    expect(first.results[0]!.listed).toBeGreaterThan(10);
    // Même empreinte, même heure : même page.
    const page = track.simulateTrackPage(f.fingerprint, track.normalizeTrackCriteria(criteria), clock);
    expect(track.simulateTrackPage(f.fingerprint, track.normalizeTrackCriteria(criteria), clock)).toEqual(page);
    expect(page.every((i) => i.sellerHandle === null && i.photoUrl === null && i.url === null && (i.priceCents ?? 0) <= 4000)).toBe(true);
    for (let i = 0; i < 6; i++) {
      advance(130);
      await track.runDueTrackReads(services);
    }
    const counts = await services.db.withGlobal((tx) => repos.priceReferences.countBySource(tx));
    expect(counts.demo).toBeGreaterThan(0);
    expect(counts.track).toBe(0);
    const t = await track.trends(ctx, f.id, { days: 7 });
    expect(t).toMatchObject({ source: "demo", demo: true, days: 7 });
    expect(t.notices).toContain(TRACK_DEMO_NOTICE);
    expect(t.points.length).toBeGreaterThanOrEqual(1);
    // Le Market s'appuie aussi sur Track (niches sans vendeur), données de démonstration à défaut de réelles.
    const m = await market.getMarketInsights(ctx, { windowDays: 30 });
    expect(m.track.demo).toBe(true);
    expect(m.track.snapshots).toBe(7);
    expect(m.track.niches[0]).toMatchObject({ brand: "levi's", category: "men" });
    expect(JSON.stringify(m.track)).not.toMatch(/vendeu|seller/i);
  });
});

// ---------------------------------------------------------------- scans, photo, Agence

async function seedNiche(n: { sold: number; listed: number }): Promise<void> {
  const rows: PriceReferenceInput[] = [];
  for (let i = 0; i < n.sold; i++) rows.push({ dedupeKey: `track:${String(i).padStart(64, "a")}`, source: "track" as const, status: "gone" as const, brand: "Levi's", category: "men" as const, listedPriceCents: 2500 + i * 10, finalPriceCents: 2500 + i * 10, finalPriceEstimated: true, listedAt: new Date(T0.getTime() - 20 * 86_400_000).toISOString(), soldAt: new Date(T0.getTime() - 14 * 86_400_000).toISOString() });
  for (let i = 0; i < n.listed; i++) rows.push({ dedupeKey: `track:${String(i).padStart(64, "b")}`, source: "track" as const, status: "listed" as const, brand: "Levi's", category: "men" as const, listedPriceCents: 1500 + i * 100, listedAt: new Date(T0.getTime() - 3 * 86_400_000).toISOString() });
  await services.db.withGlobal((tx) => repos.priceReferences.upsertMany(tx, rows));
}

describe("Selio Track : scans de niche, recherche par photo, Agence", () => {
  it("note une niche (0 à 100) et décompte le quota ; « données insuffisantes » sous le seuil, sans décompte", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const empty = await track.nicheScan(ctx, { brand: "Levi's", category: "men" });
    expect(empty).toMatchObject({ status: "insufficient_data", score: null, components: null, basedOn: { references: 0, snapshots: 0 } });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumKindSince(tx, "track.scan", "2026-10-01T00:00:00.000Z"))).toBe(0);
    await seedNiche({ sold: 12, listed: 8 });
    const scan = await track.nicheScan(ctx, { brand: "levi's", category: "men" });
    expect(scan).toMatchObject({ status: "ok", basedOn: { references: 20, sold: 12, demo: false }, details: { medianDaysToSell: 6, activeListings: 8 } });
    expect(scan.score).toBeGreaterThanOrEqual(0);
    expect(scan.score).toBeLessThanOrEqual(100);
    expect(scan.components).toMatchObject({ demand: 60, speed: 80 });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumKindSince(tx, "track.scan", "2026-10-01T00:00:00.000Z"))).toBe(1);
    // 10 scans par mois en Pro.
    await services.db.withOrg(ctx.orgId, async (tx) => { for (let i = 0; i < 9; i++) await repos.usage.record(tx, "track.scan", {}); });
    await expect(track.nicheScan(ctx, { brand: "Levi's", category: "men" })).rejects.toMatchObject({ status: 402, code: "quota_exceeded" });
    expect(await track.listScans(ctx)).toHaveLength(2);
    await expect(track.nicheScan(await setupOrg("free"), { brand: "Levi's", category: "men" })).rejects.toMatchObject({ status: 402, message: TRACK_UNAVAILABLE_MESSAGE });
  });

  it("recherche par photo : le modèle 1 décrit l'article, l'estimation suit, le quota est décompté, la photo n'est pas gardée", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    await seedNiche({ sold: 6, listed: 0 });
    const res = await track.photoSearch(ctx, { photo: `data:image/jpeg;base64,${PHOTO_B64}`, hints: { brand: "Levi's", notes: "jean 501 bleu" } });
    expect(res.description).toMatchObject({ brand: "Levi's", category: "men", subcategory: "Jean", color: "Bleu" });
    expect(res.simulated).toBe(true);
    expect(res.estimate.method).toBe("comparables");
    expect(res.estimate.strategies).not.toBeNull();
    expect(res.estimate.explanation).toContain("€");
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumKindSince(tx, "track.photo_search", "2026-10-01T00:00:00.000Z"))).toBe(1);
    // La photo n'apparaît nulle part en base.
    const stored = await dbText(`select (select json_agg(p) from track_photo_searches p) as searches, (select json_agg(a) from ai_requests a) as ai, (select json_agg(u) from usage_events u) as usage, (select json_agg(l) from audit_logs l) as audit`);
    expect(stored).not.toContain(PHOTO_B64);
    expect((await track.listPhotoSearches(ctx))[0]).toMatchObject({ id: res.id, description: { brand: "Levi's" } });
    // Quota du mois (30 en Pro) ; Track indisponible sans offre.
    await services.db.withOrg(ctx.orgId, async (tx) => { for (let i = 0; i < 29; i++) await repos.usage.record(tx, "track.photo_search", {}); });
    await expect(track.photoSearch(ctx, { photo: `data:image/jpeg;base64,${PHOTO_B64}` })).rejects.toMatchObject({ status: 402, code: "quota_exceeded" });
    await expect(track.photoSearch(await setupOrg("starter"), { photo: `data:image/jpeg;base64,${PHOTO_B64}` })).rejects.toMatchObject({ status: 402, message: TRACK_UNAVAILABLE_MESSAGE });
    await expect(track.photoSearch(ctx, { photo: "https://exemple.fr/photo.jpg" })).rejects.toMatchObject({ status: 400 });
  });

  it("flux des ventes réservé à Agence (sans pseudo) ; analyse d'un vendeur refusée tant qu'elle n'est pas validée", async () => {
    if (!available) return;
    await seedNiche({ sold: 5, listed: 2 });
    await services.db.withGlobal((tx) => tx.query("update price_references set sold_at = $1 where final_price_cents is not null", [new Date(T0.getTime() - 2 * 86_400_000).toISOString()]));
    const pro = await setupOrg("pro");
    await expect(track.salesFeed(pro)).rejects.toMatchObject({ status: 402, code: "plan_required" });
    const agence = await setupOrg("agence");
    const feed = await track.salesFeed(agence);
    expect(feed).toMatchObject({ days: 30, demo: false, rows: [{ brand: "Levi's", category: "men", sold: 5, estimatedShare: 1 }] });
    expect(JSON.stringify(feed)).not.toMatch(/vendeu|seller|handle/i);
    await expect(track.sellerAnalysis(agence)).rejects.toMatchObject({ status: 409, code: "track_seller_analysis_legal_review" });
    services.config = { trackSellerAnalysisEnabled: true };
    await expect(track.sellerAnalysis(agence)).rejects.toMatchObject({ status: 501 });
  });

  it("purge l'historique au-delà de celui du plan (organisation) et les instantanés des empreintes", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const f = await track.createFilter(ctx, { name: "Jeans", criteria });
    await track.runDueTrackReads(services);
    await services.db.withOrg(ctx.orgId, async (tx) => {
      await repos.trackScans.create(tx, { brand: "Levi's", category: "men", status: "insufficient_data", score: null, components: null, basedOn: { references: 0, snapshots: 0, sold: 0, demo: false }, details: { medianDaysToSell: null, activeListings: 0, medianResaleCents: null, medianBuyCents: null }, message: null, createdAt: "2026-06-01T00:00:00.000Z" });
      await repos.trackScans.create(tx, { brand: "Levi's", category: "men", status: "insufficient_data", score: null, components: null, basedOn: { references: 0, snapshots: 0, sold: 0, demo: false }, details: { medianDaysToSell: null, activeListings: 0, medianResaleCents: null, medianBuyCents: null }, message: null, createdAt: "2026-10-01T00:00:00.000Z" });
    });
    await services.db.withGlobal((tx) => repos.trackSnapshots.add(tx, { fingerprint: f.fingerprint, source: "demo", readAt: "2026-05-01T00:00:00.000Z", listedCount: 1, medianPriceCents: 1000, p25Cents: 1000, p75Cents: 1000, newCount: 0, goneCount: 0, medianDaysListed: null, brandShares: [], scope: { categories: [], brands: [], categoriesVerified: true } }));
    expect(await track.trackOrgIds(services)).toContain(ctx.orgId);
    // Pro : 3 mois d'historique.
    expect(await track.purgeTrackHistory(services, ctx.orgId)).toEqual({ scans: 1, photoSearches: 0 });
    expect(await track.purgeTrackSnapshots(services)).toEqual({ snapshots: 1, fingerprints: 0 });
    expect(await services.db.withGlobal((tx) => repos.trackSnapshots.count(tx, f.fingerprint))).toBe(1);
    // Plus aucun suivi : l'empreinte et ses instantanés sont oubliés.
    await track.deleteFilter(ctx, f.id);
    expect(await track.purgeTrackSnapshots(services)).toEqual({ snapshots: 1, fingerprints: 1 });
  });
});

// ---------------------------------------------------------------- corrections : quotas, rythme, disparitions, photo

const usageOf = (ctx: OrgContext, kind: "track.scan" | "track.photo_search" | "track.filter_change") => services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumKindSince(tx, kind, "2026-10-01T00:00:00.000Z"));
const settle = async <T>(ps: Promise<T>[]) => (await Promise.allSettled(ps)).map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code ?? "error"));

describe("Selio Track : quotas sous verrou (requêtes simultanées)", () => {
  it("recherches par photo simultanées à 29/30 : une seule passe, la place est réservée avant l'appel au modèle", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    await services.db.withOrg(ctx.orgId, async (tx) => { for (let i = 0; i < 29; i++) await repos.usage.record(tx, "track.photo_search", {}); });
    services.ai = aiWith(new MockAIProvider({ latencyMs: 50 }));
    const out = await settle(Array.from({ length: 6 }, () => track.photoSearch(ctx, { photo: `data:image/jpeg;base64,${PHOTO_B64}`, hints: { brand: "Levi's" } })));
    expect(out.filter((x) => x === "ok")).toHaveLength(1);
    expect(out.filter((x) => x === "quota_exceeded")).toHaveLength(5);
    expect(await usageOf(ctx, "track.photo_search")).toBe(30);
  });

  it("scans de niche simultanés à 9/10 : un seul décompté", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    await seedNiche({ sold: 12, listed: 8 });
    await services.db.withOrg(ctx.orgId, async (tx) => { for (let i = 0; i < 9; i++) await repos.usage.record(tx, "track.scan", {}); });
    const out = await settle(Array.from({ length: 5 }, () => track.nicheScan(ctx, { brand: "Levi's", category: "men" })));
    expect(out.filter((x) => x === "ok")).toHaveLength(1);
    expect(await usageOf(ctx, "track.scan")).toBe(10);
  });

  it("filtres simultanés à 4/5 : un seul créé ; réactivations simultanées : jamais au-delà du quota", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const made = [];
    for (let i = 0; i < 4; i++) made.push(await track.createFilter(ctx, { name: `F${i}`, criteria: { ...criteria, maxPriceCents: 1000 + i } }));
    const out = await settle(Array.from({ length: 4 }, (_, i) => track.createFilter(ctx, { name: `G${i}`, criteria: { ...criteria, maxPriceCents: 5000 + i } })));
    expect(out.filter((x) => x === "ok")).toHaveLength(1);
    expect(await track.listFilters(ctx)).toHaveLength(5);
    // Deux filtres coupés, un seul emplacement actif libre : une seule réactivation passe.
    await track.updateFilter(ctx, made[0]!.id, { enabled: false });
    await track.updateFilter(ctx, made[1]!.id, { enabled: false });
    await track.updateFilter(ctx, made[2]!.id, { enabled: false });
    await services.db.withOrg(ctx.orgId, (tx) => tx.query("update subscriptions set quotas = jsonb_set(quotas, '{trackFiltersFollowed}', '3') where org_id = $1", [ctx.orgId]));
    const re = await settle([track.updateFilter(ctx, made[0]!.id, { enabled: true }), track.updateFilter(ctx, made[1]!.id, { enabled: true })]);
    expect(re.sort()).toEqual(["ok", "quota_exceeded"]);
    expect((await track.listFilters(ctx)).filter((f) => f.enabled)).toHaveLength(3);
  });
});

describe("Selio Track : une empreinte retirée garde sa place 2 h", () => {
  it("changer de critères (ou supprimer et recréer) au-delà du quota repousse la première lecture de 2 h", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await track.createFilter(ctx, { name: `F${i}`, criteria: { ...criteria, maxPriceCents: 1000 + i } }));
    // Cinq filtres dans le quota : lus au prochain passage.
    for (const f of made) expect(f.nextReadAt).toBe(T0.toISOString());
    // Critères changés : l'ancienne empreinte occupe encore sa place, la nouvelle attend 2 h.
    const changed = await track.updateFilter(ctx, made[0]!.id, { criteria: { ...criteria, maxPriceCents: 7777 } });
    expect(new Date(changed.nextReadAt!).getTime() - T0.getTime()).toBe(120 * 60_000);
    expect(await usageOf(ctx, "track.filter_change")).toBe(1);
    // Supprimer puis recréer d'autres critères : pareil.
    await track.deleteFilter(ctx, made[1]!.id);
    const recreated = await track.createFilter(ctx, { name: "Autre", criteria: { ...criteria, maxPriceCents: 8888 } });
    expect(new Date(recreated.nextReadAt!).getTime() - T0.getTime()).toBe(120 * 60_000);
    // Revenir aux critères abandonnés ne relit pas tout de suite non plus (personne d'autre ne les suit).
    const back = await track.updateFilter(ctx, made[0]!.id, { criteria: { ...criteria, maxPriceCents: 1000 } });
    expect(new Date(back.nextReadAt!).getTime()).toBeGreaterThanOrEqual(T0.getTime() + 120 * 60_000);
    // Au passage suivant : rien de lu pour ces trois empreintes, seulement les trois filtres d'origine restants.
    const tick = await track.runDueTrackReads(services);
    expect(tick.due).toBe(3);
    // Deux heures plus tard, la place est rendue : une nouvelle empreinte est lue au prochain passage.
    advance(121);
    await track.deleteFilter(ctx, recreated.id);
    advance(121);
    const fresh = await track.createFilter(ctx, { name: "Neuf", criteria: { ...criteria, maxPriceCents: 9999 } });
    expect(fresh.nextReadAt).toBe(clock.toISOString());
  });

  it("une empreinte suivie par une autre organisation garde son rythme", async () => {
    if (!available) return;
    const a = await setupOrg("pro");
    const b = await setupOrg("pro");
    const shared = { ...criteria, maxPriceCents: 4321 };
    await track.createFilter(b, { name: "Chez B", criteria: shared });
    for (let i = 0; i < 5; i++) await track.createFilter(a, { name: `A${i}`, criteria: { ...criteria, maxPriceCents: 1000 + i } });
    const [first] = await track.listFilters(a);
    const moved = await track.updateFilter(a, first!.id, { criteria: shared });
    // Déjà lue pour B : aucune lecture de plus, la ligne partagée n'est pas repoussée.
    expect(moved.nextReadAt).toBe(T0.toISOString());
  });
});

describe("Selio Track : lecture en direct, ralentissement et disparitions", () => {
  const pub = (minutesAgo: number) => ({ publishedAt: new Date(T0.getTime() - minutesAgo * 60_000).toISOString() });

  it("après des blocages, le facteur redescend d'un cran par 24 h, pas en quelques lectures", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const ctx = await setupOrg("agence");
    const f = await track.createFilter(ctx, { name: "Jeans", criteria });
    await owner.query("update track_runtime set slowdown_factor = 8, last_block_at = $1", [T0.toISOString()]);
    advance(24 * 60 + 1);
    for (let i = 0; i < 3; i++) {
      await owner.query("update track_filter_reads set next_read_at = $1", [clock.toISOString()]);
      reader.enqueue({ ok: true, items: [listing("111", 2500)] });
      expect(await track.runTrackRead(services, f.fingerprint, "cloud")).toMatchObject({ outcome: "ok", factor: 4 });
      advance(5);
    }
    // Facteur stocké et date du dernier blocage inchangés ; 48 h après le blocage : ×2.
    expect(await services.db.withGlobal((tx) => repos.trackReads.runtime(tx))).toMatchObject({ slowdownFactor: 8, lastBlockAt: T0.toISOString() });
    clock = new Date(T0.getTime() + 48 * 3_600_000 + 60_000);
    await owner.query("update track_filter_reads set next_read_at = $1", [clock.toISOString()]);
    reader.enqueue({ ok: true, items: [listing("111", 2500)] });
    expect(await track.runTrackRead(services, f.fingerprint, "cloud")).toMatchObject({ factor: 2 });
  });

  it("page entière pleine filtrée à quelques annonces : une annonce sortie de la page n'est pas une vente", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const ctx = await setupOrg("pro");
    const f = await track.createFilter(ctx, { name: "Jeans M", criteria: { keywords: ["jean"], sizes: ["W32"] } });
    reader.enqueue({ ok: true, items: [listing("1", 2000, pub(30)), listing("2", 2100, pub(300)), listing("3", 2200, pub(900))], seenCount: 96, oldestPublishedAt: new Date(T0.getTime() - 1000 * 60_000).toISOString() });
    await track.runTrackRead(services, f.fingerprint, "cloud");
    clock = new Date(T0.getTime() + 130 * 60_000);
    await owner.query("update track_filter_reads set next_read_at = $1", [clock.toISOString()]);
    // Deux heures plus tard, la page entière commence 6 h 40 plus tôt : « 3 » (15 h) en est simplement sortie ;
    // « 2 » (5 h), plus récente que la plus ancienne de la page, a réellement disparu.
    reader.enqueue({ ok: true, items: [listing("1", 2000, pub(30))], seenCount: 96, oldestPublishedAt: new Date(T0.getTime() - 400 * 60_000).toISOString() });
    expect(await track.runTrackRead(services, f.fingerprint, "cloud")).toMatchObject({ outcome: "ok", seen: 96, listed: 1, goneCount: 1 });
    // Une annonce illisible sur la page : aucune disparition comptée.
    clock = new Date(clock.getTime() + 130 * 60_000);
    await owner.query("update track_filter_reads set next_read_at = $1", [clock.toISOString()]);
    reader.enqueue({ ok: true, items: [{ externalRef: "9", priceCents: -5 }], seenCount: 96, oldestPublishedAt: new Date(T0.getTime() - 400 * 60_000).toISOString() });
    expect(await track.runTrackRead(services, f.fingerprint, "cloud")).toMatchObject({ outcome: "ok", goneCount: 0 });
    const gone = await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { includeDemo: true, withFinalPrice: true }));
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ finalPriceCents: 2100, finalPriceEstimated: true });
  });

  it("catégorie non lue en direct : aucune référence, instantané compté pour aucune catégorie", async () => {
    if (!available) return;
    services.config = { trackLiveEnabled: true };
    const ctx = await setupOrg("pro");
    const f = await track.createFilter(ctx, { name: "Nike chaussures", criteria: { keywords: ["nike"], categories: ["shoes"] } });
    reader.enqueue({ ok: true, items: [listing("51", 2500, { category: null, brand: "Nike" }), listing("52", 1500, { category: null, brand: "Nike" })] });
    expect(await track.runTrackRead(services, f.fingerprint, "cloud")).toMatchObject({ outcome: "ok", listed: 2, references: 0 });
    expect(await services.db.withGlobal((tx) => repos.priceReferences.countBySource(tx))).toMatchObject({ track: 0 });
    const [snap] = await services.db.withGlobal((tx) => repos.trackSnapshots.since(tx, f.fingerprint, T0.toISOString()));
    expect(snap!.scope).toMatchObject({ categories: ["shoes"], categoriesVerified: false });
    expect(await services.db.withGlobal((tx) => repos.trackSnapshots.latestForCategory(tx, "shoes", T0.toISOString()))).toHaveLength(0);
  });
});

describe("Selio Track : scans insuffisants et recherche par photo", () => {
  it("un scan « données insuffisantes » ne rend aucun prix ni délai, et pas plus de 20 par jour", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    await seedNiche({ sold: 1, listed: 2 });
    const scan = await track.nicheScan(ctx, { brand: "Levi's", category: "men" });
    expect(scan).toMatchObject({ status: "insufficient_data", details: { medianDaysToSell: null, medianResaleCents: null, medianBuyCents: null }, basedOn: { references: 3, sold: 1 } });
    for (let i = 0; i < 19; i++) await track.nicheScan(ctx, { brand: "Levi's", category: "men" });
    await expect(track.nicheScan(ctx, { brand: "Levi's", category: "men" })).rejects.toMatchObject({ status: 429 });
    expect(await usageOf(ctx, "track.scan")).toBe(0);
  });

  it("champs vides du modèle de vision : « inconnu », l'estimation suit et la requête IA est close", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    await seedNiche({ sold: 6, listed: 0 });
    services.ai = aiWith(new BlankFieldsVision());
    const res = await track.photoSearch(ctx, { photo: `data:image/jpeg;base64,${PHOTO_B64}`, hints: { brand: "Levi's", notes: "jean" } });
    expect(res.description).toMatchObject({ brand: null, subcategory: null, material: null, color: null });
    const running = await owner.query("select count(*)::int as n from ai_requests where org_id = $1 and status = 'running'", [ctx.orgId]);
    expect(running.rows[0].n).toBe(0);
  });

  it("sans modèle de vision : refus, rien n'est décrit ni décompté ; panne du modèle : la place est rendue", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    services.ai = aiWith(new TextOnlyProvider());
    await expect(track.photoSearch(ctx, { photo: `data:image/jpeg;base64,${PHOTO_B64}` })).rejects.toMatchObject({ status: 503, code: "ai_vision_unavailable" });
    services.ai = aiWith(new MockAIProvider({ failWith: new AIError("unavailable", "panne") }));
    await expect(track.photoSearch(ctx, { photo: `data:image/jpeg;base64,${PHOTO_B64}` })).rejects.toMatchObject({ status: 503 });
    expect(await usageOf(ctx, "track.photo_search")).toBe(0);
    expect(await track.listPhotoSearches(ctx)).toHaveLength(0);
  });
});
