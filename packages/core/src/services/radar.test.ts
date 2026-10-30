import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIService, MockAIProvider, createAIService, type AIProvider, type EmbedResult } from "@selio/ai";
import { CLOUD_CONSENT_VERSION, RADAR_3DS_TIMEOUT_MINUTES, RADAR_LIVE_REQUIRES_CLOUD, quotasForPlan, type CloudAccount, type Opportunity, type RadarSearch } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { EmailMessage } from "@selio/email";
import type { OrgContext, Services } from "../context";
import * as alerts from "./alerts";
import * as cloud from "./cloud";
import * as radar from "./radar";
import { FakePurchaseRunner, FakeRadarReader } from "./radar-sources";

/**
 * Selio Radar de bout en bout sur PostgreSQL (base dédiée selio_test_core_radar, créée si besoin),
 * avec un lecteur, un exécuteur d'achat et un envoi de notifications factices, et une horloge injectée.
 * Aucune page Vinted n'est lue, aucun achat réel n'est exécuté. Ignoré si la base n'est pas joignable.
 *
 * Base distincte de celle des tests du Cloud (selio_test_core) : Vitest 3 en mode espace de travail
 * n'applique pas `fileParallelism: false` déclaré dans la configuration d'un projet, donc les deux
 * fichiers peuvent tourner en même temps. Sur une base commune, l'un vidait les organisations et
 * remettait à zéro le coupe-circuit global (table cloud_runtime) pendant que l'autre s'en servait.
 */
const OWNER_URL = process.env.TEST_CORE_RADAR_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_radar";
const APP_URL = process.env.TEST_CORE_RADAR_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_radar";

const T0 = new Date("2026-10-29T09:00:00.000Z"); // jeudi, 10 h à Paris
const SECRET_COOKIE = "SESSION-RADAR-SECRETE-456";

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let sent: EmailMessage[] = [];
let seq = 0;
let reader: FakeRadarReader;
let purchaser: FakePurchaseRunner;
let push: alerts.FakePushSender;
const mockAi = createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false });

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
    email: { send: async (m) => { sent.push(m); return { id: `mail-${sent.length}` }; } },
    publicWebUrl: "https://selio.example",
    config: {},
  };
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

beforeEach(async () => {
  clock = new Date(T0);
  sent = [];
  reader = new FakeRadarReader();
  purchaser = new FakePurchaseRunner();
  push = new alerts.FakePushSender();
  if (services) {
    services.config = {};
    services.ai = mockAi;
    services.radar = { reader, purchaser };
    services.push = push;
  }
  if (available && services) await cloud.clearCircuit(services);
});

const advance = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };

async function setupOrg(): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `radar${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Radar ${n}`, slug: `org-radar-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.9" };
}

const vintedState = () => ({
  cookies: [
    { name: "_vinted_fr_session", value: SECRET_COOKIE, domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "NID", value: "cookie-google", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" },
  ],
  origins: [{ origin: "https://www.vinted.fr", localStorage: [{ name: "vinted_prefs", value: "fr" }] }],
});

/** Compte Vinted « Achat » relié à un compte Cloud actif (accord, activation, connexion) et une recherche en direct. */
async function liveSetup(ctx: OrgContext, searchInput: Record<string, unknown> = {}): Promise<{ connectionId: string; account: CloudAccount; search: RadarSearch }> {
  const connectionId = `conn-radar-${++seq}`;
  await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: connectionId, provider: "vinted", label: "Compte achats", status: "connected", usage: "purchase" }));
  await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
  const enabled = await cloud.enableAccount(ctx, connectionId);
  const ticket = await cloud.startLogin(ctx, enabled.id);
  const account = await cloud.completeLogin(services, ticket.loginSessionId, vintedState());
  const search = await radar.createSearch(ctx, { name: "Pulls Ralph Lauren", source: "cloud", connectionId, criteria: { brands: ["Ralph Lauren"], maxPriceCents: 3000 }, budgetCents: 4000, targetMarginCents: 1000, ...searchInput });
  return { connectionId, account, search };
}

const item = (ref: string | null, title: string, priceCents: number, extra: Record<string, unknown> = {}) => ({
  externalRef: ref, title, priceCents, shippingCents: 450, brand: "Ralph Lauren", size: "M", condition: "very_good",
  url: ref ? `https://www.vinted.fr/items/${ref}-pull?referrer=catalog` : null, photoUrl: "https://images1.vinted.net/t/photo.jpg", photoCount: 5,
  sellerHandle: "vendeuse_test", sellerRating: 4.9, sellerReviews: 40, publishedAt: new Date(clock.getTime() - 90_000).toISOString(), publishedAtSource: "absolute", ...extra,
});

/**
 * Première lecture en direct d'une recherche (page vide) : tout ce qu'elle trouverait serait du stock
 * initial (ni alerte, ni Radar Auto, ni mesure du délai). Les tests qui attendent une alerte lisent
 * d'abord une fois, puis avancent d'une minute.
 */
async function warmUp(ctx: OrgContext, searchId: string): Promise<void> {
  reader.enqueue({ ok: true, items: [] });
  await radar.runSearch(ctx, searchId);
  advance(60);
}

const accountOf = (ctx: OrgContext, id: string) => services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, id));
const readsOf = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.radarReads.list(tx));
const oppsOf = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.list(tx, {}));
const alertsOf = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.radarAlerts.list(tx));
const subscribe = (ctx: OrgContext, endpoint = `https://push.example/${++seq}`) => alerts.subscribePush(ctx, { endpoint, keys: { p256dh: "B".repeat(60), auth: "a".repeat(16) }, userAgent: "Test" });

async function addOpportunity(ctx: OrgContext, searchId: string, ref: string, score = 95): Promise<Opportunity> {
  return services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.create(tx, {
    searchId, title: "Pull Ralph Lauren exceptionnel",
    observed: { priceCents: 2000, shippingCents: 450, brand: "Ralph Lauren", size: "M", condition: "very_good", category: "men", sellerHandle: "vendeuse_test", sellerRating: 4.9, sellerReviews: 50, photoUrl: null, photoCount: 6, url: `https://www.vinted.fr/items/${ref}-pull`, seenAt: clock.toISOString(), source: "connector", externalRef: ref, publishedAt: clock.toISOString(), detectedAt: clock.toISOString() },
    estimate: { resalePriceCents: 6000, expectedFeesCents: 0, marginCents: 3380, marginRate: 0.56, confidence: "high", method: "brand_category", comparableCount: 3 },
    score, reasons: [], breakdown: [], status: "new",
  }));
}

// ---------------------------------------------------------------- fonctions pures

describe("Selio Radar : rythme de lecture (fonctions pures)", () => {
  const base = { enabled: true, source: "cloud" as const, priority: false, lastReadAt: null, lastRunAt: null, createdAt: "2026-10-01T00:00:00.000Z" };

  it("relit toutes les 60 s, 30 s pour une recherche prioritaire quand Radar Auto est actif, 1 h pour le simulateur", () => {
    const at = (s: number) => new Date(T0.getTime() - s * 1000).toISOString();
    const plan = radar.planReads([
      // 5 s de tolérance pour l'horloge des passages : lue il y a 54 s, pas encore due.
      { ...base, id: "a", lastReadAt: at(54) },
      { ...base, id: "b", lastReadAt: at(60) },
      { ...base, id: "p", priority: true, lastReadAt: at(31) },
      { ...base, id: "d", source: "demo", lastRunAt: at(1800) },
      { ...base, id: "x", enabled: false },
    ], T0, { radarAutoActive: true });
    const by = new Map(plan.map((p) => [p.searchId, p]));
    expect(by.get("a")).toMatchObject({ due: false, intervalSeconds: 60, reason: "waiting" });
    expect(by.get("b")).toMatchObject({ due: true, intervalSeconds: 60 });
    expect(by.get("p")).toMatchObject({ due: true, intervalSeconds: 30, priority: true });
    expect(by.get("d")).toMatchObject({ due: false, intervalSeconds: 3600 });
    expect(by.get("x")).toMatchObject({ due: false, reason: "disabled" });
    // Dues d'abord, prioritaires en tête.
    expect(plan.slice(0, 2).map((p) => p.searchId)).toEqual(["p", "b"]);
    // Sans Radar Auto actif, la priorité ne raccourcit pas le rythme.
    expect(radar.planReads([{ ...base, id: "p", priority: true, lastReadAt: at(31) }], T0, { radarAutoActive: false })[0]).toMatchObject({ due: false, intervalSeconds: 60 });
  });

  it("3 recherches prioritaires au plus : la quatrième garde le rythme normal", () => {
    const four = ["p1", "p2", "p3", "p4"].map((id, i) => ({ ...base, id, priority: true, createdAt: `2026-10-0${i + 1}T00:00:00.000Z` }));
    const plan = radar.planReads(four, T0, { radarAutoActive: true });
    expect(plan.filter((p) => p.intervalSeconds === 30).map((p) => p.searchId).sort()).toEqual(["p1", "p2", "p3"]);
    expect(plan.find((p) => p.searchId === "p4")).toMatchObject({ priority: false, intervalSeconds: 60 });
  });

  it("ralentissement : facteur ×2 après un blocage, intervalle doublé, retour progressif par tranche de 24 h sans blocage", () => {
    expect(radar.slowdownAfterRead(1, true, { reads: 10, blocks: 1 })).toBe(2);
    expect(radar.slowdownAfterRead(2, true, { reads: 3, blocks: 2 })).toBe(4);
    expect(radar.slowdownAfterRead(64, true, { reads: 1, blocks: 1 })).toBe(64);
    // 1 blocage pour 2 000 pages : sous le seuil de 1 pour 1 000, pas de ralentissement.
    expect(radar.slowdownAfterRead(1, true, { reads: 2000, blocks: 1 })).toBe(1);
    expect(radar.slowdownAfterRead(4, false, { reads: 5, blocks: 5 })).toBe(4);
    const blockedAt = T0.toISOString();
    const after = (h: number) => new Date(T0.getTime() + h * 3_600_000);
    expect(radar.effectiveSlowdownFactor({ slowdownFactor: 4, lastBlockAt: blockedAt }, after(23))).toBe(4);
    expect(radar.effectiveSlowdownFactor({ slowdownFactor: 4, lastBlockAt: blockedAt }, after(24))).toBe(2);
    expect(radar.effectiveSlowdownFactor({ slowdownFactor: 4, lastBlockAt: blockedAt }, after(48))).toBe(1);
    // Le facteur est celui de l'organisation (`radar_org_state`), appliqué à toutes ses recherches en direct.
    const slowdown = { slowdownFactor: 2, lastBlockAt: blockedAt };
    const s = { ...base, id: "s", lastReadAt: blockedAt };
    expect(radar.planReads([s, { ...s, id: "t" }], new Date(T0.getTime() + 61_000), { slowdown }).map((p) => [p.due, p.factor, p.intervalSeconds])).toEqual([[false, 2, 120], [false, 2, 120]]);
    expect(radar.planReads([s], new Date(T0.getTime() + 120_000), { slowdown })[0]).toMatchObject({ due: true });
    expect(radar.planReads([{ ...s, lastReadAt: after(24).toISOString() }], new Date(after(24).getTime() + 60_000), { slowdown })[0]).toMatchObject({ due: true, factor: 1, intervalSeconds: 60 });
    // Le simulateur ne ralentit jamais.
    expect(radar.planReads([{ ...s, source: "demo" }], T0, { slowdown })[0]).toMatchObject({ factor: 1 });
    expect(radar.blockRatePer1000(0, 0)).toBeNull();
    expect(radar.blockRatePer1000(2000, 3)).toBe(1.5);
  });

  it("rythme tenu avec plusieurs recherches : la lecture est datée de l'heure prévue du passage (30 s, 60 s), jamais 60 s / 90 s", () => {
    const slot = T0;
    // Deuxième recherche lue 8 s après le début du passage : datée du passage.
    expect(radar.anchorReadAt(new Date(slot.getTime() + 8_000), slot)).toEqual(slot);
    // Lecture faite bien après le passage (plus de 30 s) : heure réelle.
    expect(radar.anchorReadAt(new Date(slot.getTime() + 31_000), slot).toISOString()).toBe(new Date(slot.getTime() + 31_000).toISOString());
    expect(radar.anchorReadAt(T0, null)).toEqual(T0);
    const p = { ...base, priority: true };
    const anchored = [{ ...p, id: "p1", lastReadAt: slot.toISOString() }, { ...p, id: "p2", lastReadAt: slot.toISOString() }];
    const next = new Date(slot.getTime() + 30_000);
    expect(radar.planReads(anchored, next, { radarAutoActive: true }).map((x) => x.due)).toEqual([true, true]);
    // Sans calage (heure réelle de la deuxième lecture) : sautée au passage suivant, d'où 60 s au lieu de 30 s.
    const unanchored = [{ ...p, id: "p1", lastReadAt: slot.toISOString() }, { ...p, id: "p2", lastReadAt: new Date(slot.getTime() + 8_000).toISOString() }];
    expect(radar.planReads(unanchored, next, { radarAutoActive: true }).find((x) => x.searchId === "p2")?.due).toBe(false);
  });

  it("stock initial : première lecture, annonce publiée avant la lecture précédente, ou coupure de plus de 30 min sans date", () => {
    const prev = { pagesRead: 3, lastReadAt: new Date(T0.getTime() - 60_000).toISOString() };
    expect(radar.isInitialStock({ publishedAt: T0.toISOString() }, { pagesRead: 0, lastReadAt: null }, T0)).toBe(true);
    expect(radar.isInitialStock({ publishedAt: new Date(T0.getTime() - 90_000).toISOString() }, prev, T0)).toBe(false);
    expect(radar.isInitialStock({ publishedAt: new Date(T0.getTime() - 2 * 3_600_000).toISOString() }, prev, T0)).toBe(true);
    expect(radar.isInitialStock({ publishedAt: null }, prev, T0)).toBe(false);
    expect(radar.isInitialStock({ publishedAt: null }, { pagesRead: 3, lastReadAt: new Date(T0.getTime() - 45 * 60_000).toISOString() }, T0)).toBe(true);
  });

  it("Radar Auto : coût maximal accepté au paiement = coût décidé + petite marge, jamais au-delà de la marge estimée", () => {
    const base2 = { decisionTotalCents: 2620, marginCents: 3380, shippingShown: true, maxItemCents: 6000, remainingTodayCents: 15000 };
    expect(radar.autoMaxTotalCents(base2)).toBe(2720);
    // Port non affiché sur la recherche : 8 € de plus permis.
    expect(radar.autoMaxTotalCents({ ...base2, shippingShown: false })).toBe(3520);
    // Marge faible : le plafond s'arrête avant de l'annuler ; plafond du jour et prix maximum par article.
    expect(radar.autoMaxTotalCents({ ...base2, marginCents: 50 })).toBe(2669);
    expect(radar.autoMaxTotalCents({ ...base2, remainingTodayCents: 2650 })).toBe(2650);
    expect(radar.autoMaxTotalCents({ ...base2, maxItemCents: 2700 })).toBe(2700);
  });

  it("heures calmes : alerte différée à la fin de la plage (fuseau de l'organisation), la lecture continue", () => {
    expect(alerts.isQuietHour(23, { from: 22, to: 8 })).toBe(true);
    expect(alerts.isQuietHour(7, { from: 22, to: 8 })).toBe(true);
    expect(alerts.isQuietHour(8, { from: 22, to: 8 })).toBe(false);
    expect(alerts.isQuietHour(13, { from: 12, to: 14 })).toBe(true);
    expect(alerts.isQuietHour(13, null)).toBe(false);
    // 23 h 30 à Paris (UTC+1 après le changement d'heure) → 8 h à Paris le lendemain.
    expect(alerts.alertScheduleFor(new Date("2026-10-29T22:30:00.000Z"), "Europe/Paris", { from: 22, to: 8 }).toISOString()).toBe("2026-10-30T07:00:00.000Z");
    expect(alerts.alertScheduleFor(T0, "Europe/Paris", { from: 22, to: 8 })).toEqual(T0);
    expect(alerts.localDayStart(T0, "Europe/Paris").toISOString()).toBe("2026-10-28T23:00:00.000Z");
    expect(alerts.formatEur(1250)).toBe("12,50 €");
  });

  it("contenu d'une alerte : jamais de pseudo, de note ni de photo du vendeur ; chemin relatif", () => {
    const payload = alerts.opportunityAlertPayload({ id: "opp-1", title: "Pull  Ralph Lauren", score: 88.4, observed: { priceCents: 1500, sellerHandle: "vendeuse_x", photoUrl: "https://x/p.jpg", sellerRating: 4.9 } as never, estimate: { resalePriceCents: 4000 } as never });
    expect(payload).toEqual({ title: "Affaire Radar : Pull Ralph Lauren", body: "15,00 € · note 88 · revente estimée 40,00 €", url: "/app/radar/affaires/opp-1" });
    expect(JSON.stringify(payload)).not.toMatch(/vendeuse_x|4,9|p\.jpg/);
  });
});

// ---------------------------------------------------------------- lecture en direct

describe("Selio Radar : lecture en direct depuis le compte Achat", () => {
  it("crée les affaires, dédoublonne par référence Vinted puis par titre et prix, mesure le délai de détection", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search, connectionId } = await liveSetup(ctx);
    reader.enqueue({ ok: true, durationMs: 1800, items: [item("111", "Pull Ralph Lauren col V", 1800), item("111", "Pull Ralph Lauren col V (copie)", 1800), item(null, "Pull Ralph Lauren sans référence", 1500), { title: "", priceCents: -1 }] });
    const first = await radar.runSearch(ctx, search.id);
    expect(first).toMatchObject({ source: "cloud", outcome: "ok", found: 2, duplicates: 1, itemsSeen: 3, skipped: null, factor: 1, intervalSeconds: 60, paused: false });
    // Le lecteur ne reçoit que la session vinted.* du compte Achat (aucun autre cookie, jamais de mot de passe).
    expect(reader.calls[0]).toMatchObject({ searchId: search.id, connectionId, vintedHost: "www.vinted.fr", cookieNames: ["_vinted_fr_session"] });
    const opp = (await oppsOf(ctx)).find((o) => o.observed.externalRef === "111")!;
    expect(opp.observed).toMatchObject({ source: "connector", externalRef: "111", url: "https://www.vinted.fr/items/111-pull", publishedAt: new Date(T0.getTime() - 90_000).toISOString(), detectedAt: T0.toISOString() });
    expect(opp.estimate.method).toBe("brand_category");

    // Trop tôt : aucune relecture avant 60 s.
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ skipped: "too_soon", outcome: null });
    advance(60);
    reader.enqueue({ ok: true, items: [item("111", "Pull Ralph Lauren col V", 1800), item(null, "Pull Ralph Lauren sans référence", 1500), item("222", "Pull Ralph Lauren torsadé", 2200)] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 1, duplicates: 2 });
    expect(reader.calls).toHaveLength(2);
    const reads = await readsOf(ctx);
    expect(reads.map((r) => [r.source, r.outcome, r.itemsSeen, r.itemsNew])).toEqual([["cloud", "ok", 3, 1], ["cloud", "ok", 3, 2]]);
    expect(reads[1]!.durationMs).toBe(1800);
    const saved = await services.db.withOrg(ctx.orgId, (tx) => repos.searches.byId(tx, search.id));
    expect(saved).toMatchObject({ pagesRead: 2, blocksCount: 0, lastReadAt: clock.toISOString() });
  });

  it("sans Selio Cloud sur le compte Achat : erreur claire, rien n'est lancé ; le passage du worker l'écarte", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: `conn-nocloud-${++seq}`, provider: "vinted", label: "Achats", status: "connected", usage: "purchase" }));
    const search = await radar.createSearch(ctx, { name: "En direct", source: "cloud" });
    await expect(radar.runSearch(ctx, search.id)).rejects.toMatchObject({ code: "radar_live_requires_cloud", status: 409, message: expect.stringContaining(RADAR_LIVE_REQUIRES_CLOUD) });
    const tick = await radar.runDueReads(services, ctx.orgId);
    expect(tick.skipped).toEqual([{ reason: "not_ready", count: 1 }]);
    expect(reader.calls).toHaveLength(0);
    // Un compte de vente n'est jamais lu par Radar.
    const sale = `conn-sale-${++seq}`;
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: sale, provider: "vinted", label: "Ventes", status: "connected", usage: "sale" }));
    await expect(radar.createSearch(ctx, { name: "Vente", source: "cloud", connectionId: sale })).rejects.toMatchObject({ code: "validation" });
  });

  it("CAPTCHA : compte Cloud en pause (écrite d'abord), alerte au client, mesure enregistrée, ralentissement, aucune relecture", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search, account } = await liveSetup(ctx);
    await subscribe(ctx);
    reader.enqueue({ ok: false, code: "captcha", durationMs: 2100 });
    const res = await radar.runSearch(ctx, search.id);
    expect(res).toMatchObject({ outcome: "captcha", paused: true, found: 0, factor: 2, intervalSeconds: 120, circuitUntil: null });
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "captcha", warningsCount: 1 });
    expect((await readsOf(ctx)).map((r) => [r.outcome, r.factor])).toEqual([["captcha", 1]]);
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.searches.byId(tx, search.id))).toMatchObject({ blocksCount: 1, slowdownFactor: 2, lastBlockAt: T0.toISOString() });
    expect(sent.map((m) => m.subject)).toEqual([expect.stringContaining("en pause")]);
    expect(push.sent.map((p) => p.payload.title)).toEqual(["Radar en pause : Vinted a demandé une vérification"]);
    expect((await alertsOf(ctx)).map((a) => [a.kind, a.status])).toEqual([["blocked", "sent"]]);
    // Aucune relecture : trop tôt, puis compte en pause (le client doit vérifier et reprendre lui-même).
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ skipped: "too_soon" });
    advance(180);
    await expect(radar.runSearch(ctx, search.id)).rejects.toMatchObject({ code: "radar_live_requires_cloud" });
    expect((await radar.runDueReads(services, ctx.orgId)).skipped).toEqual([{ reason: "not_ready", count: 1 }]);
    expect(reader.calls).toHaveLength(1);
    expect(await cloud.machinePausedUntil(services)).toBeNull();
  });

  it("« trop de requêtes » : coupe-circuit de la machine, plus aucune lecture en direct nulle part", async () => {
    if (!available) return;
    const a = await setupOrg();
    const { search } = await liveSetup(a);
    reader.enqueue({ ok: false, code: "rate_limited" });
    expect(await radar.runSearch(a, search.id)).toMatchObject({ outcome: "rate_limited", paused: true });
    expect(await cloud.machinePausedUntil(services)).not.toBeNull();
    const b = await setupOrg();
    await liveSetup(b);
    const tick = await radar.runDueReads(services, b.orgId);
    expect(tick.skipped).toEqual([{ reason: "machine_paused", count: 1 }]);
    expect(reader.calls).toHaveLength(1);
  });

  it("session refusée par Vinted : session effacée, connexion à refaire ; aucun navigateur libre : rien n'est compté", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search, account } = await liveSetup(ctx);
    reader.enqueue({ ok: false, code: "unavailable", launched: false });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ skipped: "unavailable", outcome: null });
    expect(await readsOf(ctx)).toHaveLength(0);
    reader.enqueue({ ok: false, code: "not_logged_in" });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ outcome: "error", paused: false });
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "needs_login", hasSession: false });
  });

  it("plafond de pages par minute pour l'organisation", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { connectionId } = await liveSetup(ctx);
    await radar.createSearch(ctx, { name: "Deuxième", source: "cloud", connectionId });
    await radar.updateRadarSettings(ctx, { radar: { maxPagesPerMinute: 1 } });
    const tick = await radar.runDueReads(services, ctx.orgId);
    expect(tick).toMatchObject({ read: 1, skipped: [{ reason: "pages_per_minute", count: 1 }] });
    expect(reader.calls).toHaveLength(1);
    advance(61);
    expect((await radar.runDueReads(services, ctx.orgId)).read).toBe(1);
  });

  it("simulateur : affaires « démo », mesure « demo », aucune alerte, rien n'est « mesuré »", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    await subscribe(ctx);
    const search = await radar.createSearch(ctx, { name: "Démo", criteria: { brands: ["Nike"], maxPriceCents: 4000 } });
    expect(search.source).toBe("demo");
    const res = await radar.runSearch(ctx, search.id);
    expect(res.source).toBe("demo");
    expect(res.found).toBeGreaterThanOrEqual(1);
    expect((await oppsOf(ctx)).every((o) => o.observed.source === "demo_simulator" && o.title.startsWith("Nike"))).toBe(true);
    expect((await readsOf(ctx)).map((r) => r.source)).toEqual(["demo"]);
    expect(await alertsOf(ctx)).toHaveLength(0);
    expect(reader.calls).toHaveLength(0);
    expect(await radar.radarMetrics(ctx, { days: 30 })).toMatchObject({ status: "to_measure", label: "à mesurer", liveReads: 0, blockRatePer1000: null, medianPublishToDetectSeconds: null, medianDetectToPurchaseSeconds: null });
  });
});

// ---------------------------------------------------------------- estimation par similarité

/** Faux modèle 2 : un axe par marque reconnue dans le texte. Compte les textes vectorisés. */
class KeywordEmbedProvider extends MockAIProvider {
  readonly embedded: string[] = [];
  override async embed(texts: string[]): Promise<EmbedResult> {
    this.embedded.push(...texts);
    const v = (t: string) => (/ralph/i.test(t) ? [1, 0, 0] : /levi/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
    return { embeddings: texts.map(v), dimensions: 3, usage: { promptTokens: 0, outputTokens: 0 }, latencyMs: 0, model: this.embedModel, provider: "fake" };
  }
}

const aiWith = (provider: AIProvider) => new AIService({ provider, concurrency: 2, maxPending: 20, circuitFailures: 5, circuitCooldownMs: 1000, timeoutMs: 5000, allowFallback: false });

async function addSale(ctx: OrgContext, title: string, brand: string, priceCents: number): Promise<void> {
  await services.db.withOrg(ctx.orgId, async (tx) => {
    const it = await repos.items.create(tx, { title, brand, category: "men", condition: "very_good", status: "sold", purchasePriceCents: 1000 });
    const customer = await repos.customers.create(tx, { displayName: "Client", handle: `client${++seq}`, provider: "demo" });
    await repos.orders.create(tx, { itemId: it.id, customerId: customer.id, dedupeKey: `sale:${it.id}`, status: "completed", salePriceCents: priceCents });
  });
}

describe("Selio Radar : revente estimée par les ventes proches (modèle 2)", () => {
  it("compare le titre aux ventes de l'organisation (cosinus, top 8 au-dessus de 0,6), met les vecteurs en cache, sinon marque et catégorie", async () => {
    if (!available) return;
    const fake = new KeywordEmbedProvider();
    services.ai = aiWith(fake);
    const ctx = await setupOrg();
    await addSale(ctx, "Pull Ralph Lauren col rond", "Ralph Lauren", 4000);
    await addSale(ctx, "Pull Ralph Lauren torsadé", "Ralph Lauren", 5000);
    await addSale(ctx, "Pull Ralph Lauren câble", "Ralph Lauren", 6000);
    await addSale(ctx, "Jean Levi's 501", "Levi's", 9000);
    const { search } = await liveSetup(ctx);
    reader.enqueue({ ok: true, items: [item("501", "Pull Ralph Lauren laine", 1500)] });
    await radar.runSearch(ctx, search.id);
    const opp = (await oppsOf(ctx))[0]!;
    expect(opp.estimate).toMatchObject({ method: "embeddings", comparableCount: 3, resalePriceCents: 5000, confidence: "medium" });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.embeddingsCache.count(tx, "sale"))).toBe(4);
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.embeddingsCache.count(tx, "opportunity"))).toBe(1);
    // Deuxième lecture : seules les nouvelles annonces sont vectorisées (ventes lues dans le cache).
    fake.embedded.length = 0;
    advance(60);
    reader.enqueue({ ok: true, items: [item("502", "Pull Ralph Lauren mérinos", 1600)] });
    await radar.runSearch(ctx, search.id);
    expect(fake.embedded).toEqual(["Pull Ralph Lauren mérinos"]);
    // Sans modèle 2 : méthode d'avant (marque et catégorie).
    const plain = new MockAIProvider();
    services.ai = aiWith(new Proxy(plain, { get: (t, k) => (k === "embed" ? undefined : Reflect.get(t, k)) }));
    expect(services.ai.canEmbed).toBe(false);
    advance(60);
    reader.enqueue({ ok: true, items: [item("503", "Pull Ralph Lauren coton", 1700)] });
    await radar.runSearch(ctx, search.id);
    expect((await oppsOf(ctx)).find((o) => o.observed.externalRef === "503")?.estimate.method).toBe("brand_category");
  });
});

// ---------------------------------------------------------------- alertes

describe("Selio Radar : alertes sur le téléphone (PWA)", () => {
  it("une seule alerte par affaire, différée pendant les heures calmes ; 410 → abonnement désactivé", async () => {
    if (!available) return;
    clock = new Date("2026-10-29T22:29:00.000Z"); // 23 h 29 à Paris
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { radar: { alertMinScore: 0, quietHours: { from: 22, to: 8 } } });
    await warmUp(ctx, search.id);
    const ok = await subscribe(ctx, "https://push.example/ok");
    await subscribe(ctx, "https://push.example/gone");
    push.respond("https://push.example/gone", 410);
    reader.enqueue({ ok: true, items: [item("777", "Pull Ralph Lauren nuit", 1500)] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 1, alertsQueued: 1 });
    expect(push.sent).toHaveLength(0);
    const queued = (await alertsOf(ctx))[0]!;
    expect(queued).toMatchObject({ kind: "opportunity", status: "queued", scheduledFor: "2026-10-30T07:00:00.000Z" });
    expect(JSON.stringify(queued.payload)).not.toContain("vendeuse_test");
    // Même annonce relue : aucune seconde alerte.
    advance(60);
    reader.enqueue({ ok: true, items: [item("777", "Pull Ralph Lauren nuit", 1500)] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 0, duplicates: 1, alertsQueued: 0 });
    clock = new Date("2026-10-30T07:01:00.000Z");
    expect(await alerts.sendDueAlerts(services, ctx.orgId)).toMatchObject({ sent: 1, disabledSubscriptions: 1 });
    expect(push.sent.map((p) => [p.endpoint, p.payload.url])).toEqual([["https://push.example/ok", `/app/radar/affaires/${queued.opportunityId}`]]);
    expect(await alerts.sendDueAlerts(services, ctx.orgId)).toMatchObject({ sent: 0 });
    const subs = await services.db.withOrg(ctx.orgId, (tx) => repos.pushSubscriptions.listActive(tx));
    expect(subs.map((s) => s.id)).toEqual([ok.id]);
    expect(ok).not.toHaveProperty("p256dh");
  });

  it("sous la note minimale ou alertes coupées : aucune alerte", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { radar: { alertMinScore: 100 } });
    await warmUp(ctx, search.id);
    reader.enqueue({ ok: true, items: [item("888", "Pull Ralph Lauren banal", 2900)] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 1, alertsQueued: 0 });
    await radar.updateRadarSettings(ctx, { radar: { alertMinScore: 0, alertsEnabled: false } });
    advance(60);
    reader.enqueue({ ok: true, items: [item("889", "Pull Ralph Lauren banal 2", 2900)] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 1, alertsQueued: 0 });
  });

  it("sans clés VAPID : rien n'est envoyé, mais une alerte trop ancienne expire quand même (la file ne grossit pas sans fin)", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { radar: { alertMinScore: 0, quietHours: null } });
    await subscribe(ctx);
    services.push = undefined;
    await warmUp(ctx, search.id);
    reader.enqueue({ ok: true, items: [item("990", "Pull Ralph Lauren sans push", 1500)] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 1, alertsQueued: 1 });
    expect(await alerts.sendDueAlerts(services, ctx.orgId)).toMatchObject({ sent: 0, expired: 0, pending: 1 });
    advance(13 * 3600);
    expect(await alerts.sendDueAlerts(services, ctx.orgId)).toMatchObject({ sent: 0, expired: 1, pending: 0 });
    expect((await alertsOf(ctx)).map((a) => a.status)).toEqual(["failed"]);
    expect(push.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Radar Auto

describe("Radar Auto : verrous, 3-D Secure et prix d'achat reporté dans Manager", () => {
  it("désactivé par défaut : rien n'est évalué, raisons rendues ; activation refusée sans le verrou serveur", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search, connectionId } = await liveSetup(ctx);
    await addOpportunity(ctx, search.id, "9001");
    const res = await radar.runAutoBuy(ctx);
    expect(res).toMatchObject({ disabled: true, evaluated: 0, bought: 0, account: { id: connectionId, label: "Compte achats" }, realPurchase: false });
    expect(res.reasons).toEqual([expect.stringContaining("RADAR_AUTO_ENABLED"), "Radar Auto n'est pas activé dans les réglages de l'organisation."]);
    expect(res.notice).toMatch(/Ibrahim/);
    await expect(radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } })).rejects.toMatchObject({ code: "radar_auto_disabled", status: 403 });
    // Verrou serveur ouvert mais liste des comptes de l'équipe sans cette organisation.
    services.config = { radarAutoEnabled: true, radarAutoOrgIds: ["org-de-l-equipe"] };
    expect((await radar.runAutoBuy(ctx)).reasons[0]).toMatch(/RADAR_AUTO_ORG_IDS/);
    expect(purchaser.calls).toHaveLength(0);
  });

  it("verrous ouverts mais compte Achat hors du Cloud : désactivé avec la raison", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true };
    const ctx = await setupOrg();
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: `conn-achat-${++seq}`, provider: "vinted", label: "Achats", status: "connected", usage: "purchase" }));
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    const res = await radar.runAutoBuy(ctx);
    expect(res.disabled).toBe(true);
    expect(res.reasons).toEqual([expect.stringContaining(RADAR_LIVE_REQUIRES_CLOUD)]);
  });

  it("3-D Secure : l'achat attend le client (alerte), puis reprise → acheté, article créé dans Manager avec le prix d'achat", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await subscribe(ctx);
    const settings = await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true, threshold: 85, maxItemCents: 8000, dailyCapCents: 20000 } });
    expect(settings.autoBuy).toMatchObject({ enabled: true, enabledAt: T0.toISOString(), enabledBy: ctx.userId });
    const opp = await addOpportunity(ctx, search.id, "4242");
    purchaser.enqueue({ status: "awaiting_3ds", totalCents: 2620 });
    const run = await radar.runAutoBuy(ctx);
    expect(run).toMatchObject({ disabled: false, awaiting3ds: 1, bought: 0, realPurchase: true });
    // Coût décidé (26,20 €) + 1 € de marge : une hausse de prix au-delà arrête l'achat avant de payer.
    expect(purchaser.calls[0]).toMatchObject({ dryRun: false, paymentMethod: "vinted_wallet", itemUrl: "https://www.vinted.fr/items/4242-pull", maxTotalCents: 2720, resume: false, hadSession: true });
    const p = (await radar.listPurchases(ctx))[0]!;
    expect(p).toMatchObject({ status: "awaiting_3ds", mode: "auto", totalCents: 2620, maxPriceCents: 2720, awaiting3dsUntil: new Date(T0.getTime() + RADAR_3DS_TIMEOUT_MINUTES * 60_000).toISOString(), realPurchaseEnabled: true, paymentAttempted: true });
    await alerts.sendDueAlerts(services, ctx.orgId);
    expect(push.sent.map((s) => s.payload.title)).toEqual(["Validez le paiement dans votre application bancaire"]);
    // Un second passage n'achète rien tant que la banque attend (compte tenu, raison rendue).
    expect((await radar.runAutoBuy(ctx)).reasons).toEqual([expect.stringContaining("validation bancaire")]);
    expect(purchaser.calls).toHaveLength(1);
    // Compte tenu par le navigateur de l'achat : aucune lecture en direct sur la même session pendant l'attente.
    advance(60);
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ skipped: "account_busy", launched: false });
    expect(reader.calls).toHaveLength(0);
    // Le client a validé dans son application bancaire : Selio relit la confirmation, sans reprendre la session.
    advance(60);
    purchaser.enqueue({ status: "purchased", totalCents: 2620, orderRef: "V-42" });
    const done = await radar.resumePurchase(ctx, p.id);
    expect(purchaser.calls[1]).toMatchObject({ resume: true, hadSession: false });
    expect(done).toMatchObject({ status: "executed", totalCents: 2620, orderRef: "V-42", executedAt: clock.toISOString() });
    const reported = await services.db.withOrg(ctx.orgId, (tx) => repos.items.byId(tx, done.reportedItemId!));
    expect(reported).toMatchObject({ title: opp.title, purchasePriceCents: 2620, status: "in_stock", tags: ["radar"], brand: "Ralph Lauren" });
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.byId(tx, opp.id))).status).toBe("purchased");
    // Pages de l'achat comptées dans la mesure (sorte « purchase ») ; aucune lecture de recherche.
    expect((await readsOf(ctx)).map((r) => [r.kind, r.outcome])).toEqual([["purchase", "ok"], ["purchase", "ok"]]);
    // Achat fini : le compte n'est plus tenu.
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.heldUntil(tx, p.cloudAccountId!))).toBeNull();
  });

  it("achat réel désactivé (D11) : essai à blanc, enregistré « simulé », aucun article créé", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, search.id, "5151");
    const run = await radar.runAutoBuy(ctx);
    expect(run).toMatchObject({ bought: 1, realPurchase: false });
    expect(purchaser.calls[0]).toMatchObject({ dryRun: true });
    const p = (await radar.listPurchases(ctx))[0]!;
    expect(p).toMatchObject({ status: "simulated", realPurchaseEnabled: false, reportedItemId: null });
    expect(p.resultNote).toMatch(/SIMULÉ.*avant le bouton de paiement/);
    expect(p.cancelableUntil).not.toBeNull();
  });

  it("validation 3-D Secure non reçue dans le délai : achat abandonné, affaire en observation", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    const opp = await addOpportunity(ctx, search.id, "6161");
    purchaser.enqueue({ status: "awaiting_3ds" });
    await radar.runAutoBuy(ctx);
    const p = (await radar.listPurchases(ctx))[0]!;
    advance(16 * 60);
    await expect(radar.resumePurchase(ctx, p.id)).rejects.toMatchObject({ code: "conflict" });
    expect((await radar.listPurchases(ctx))[0]).toMatchObject({ status: "cancelled", paymentAttempted: true });
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.byId(tx, opp.id))).status).toBe("watching");
    expect(purchaser.calls).toHaveLength(1);
    // Le paiement a pu partir : la demande reste dans le plafond du jour, le compte est libéré, Radar Auto est arrêté.
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.purchases.spentSince(tx, alerts.localDayStart(clock, "Europe/Paris").toISOString()))).toBe(2720);
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.heldUntil(tx, p.cloudAccountId!))).toBeNull();
    const status = await radar.autoStatus(ctx);
    expect(status.settings).toMatchObject({ enabled: false, suspendedReason: expect.stringContaining("3-D Secure") });
    expect(status.locks.find((l) => l.key === "organization")?.detail).toMatch(/Arrêté par Selio/);
    // Réactivation par le client (acquittement) : la raison est effacée.
    expect((await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } })).autoBuy).toMatchObject({ enabled: true, suspendedAt: null, suspendedReason: null });
  });

  it("CAPTCHA pendant l'achat : compte en pause, achat arrêté, rien n'est retenté", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search, account } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, search.id, "7171");
    await addOpportunity(ctx, search.id, "7172", 96);
    purchaser.enqueue({ status: "failed", code: "captcha" });
    const run = await radar.runAutoBuy(ctx);
    expect(run.bought).toBe(0);
    expect(purchaser.calls).toHaveLength(1);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "captcha" });
    expect((await radar.listPurchases(ctx))[0]).toMatchObject({ status: "blocked", resultNote: expect.stringContaining("CAPTCHA") });
    expect((await radar.runAutoBuy(ctx)).disabled).toBe(true);
    expect(purchaser.calls).toHaveLength(1);
  });

  it("« 1 clic » validé à la main : aucun achat par Selio, prix d'achat reporté dans Manager", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const search = await radar.createSearch(ctx, { name: "Démo", budgetCents: 5000 });
    const opp = await addOpportunity(ctx, search.id, "8181", 80);
    const p = await radar.quickBuy(ctx, opp.id);
    // 20,00 € + 4,50 € de port + protection acheteurs (0,70 € + 5 %).
    expect(p).toMatchObject({ status: "simulated", mode: "manual", totalCents: 2620, maxPriceCents: 2620 });
    const reported = await services.db.withOrg(ctx.orgId, (tx) => repos.items.byId(tx, p.reportedItemId!));
    expect(reported).toMatchObject({ purchasePriceCents: 2620, status: "in_stock", tags: ["radar"] });
    expect(purchaser.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- statistiques

describe("Selio Radar : statistiques honnêtes", () => {
  it("à mesurer sans lecture en direct ; ensuite taux de blocage pour 1 000 pages, délai publication → détection, lectures par jour", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    expect(await radar.radarMetrics(ctx, { days: 7 })).toMatchObject({ status: "to_measure", liveReads: 0, readsPerDay: [] });
    const { search } = await liveSetup(ctx);
    // Première lecture : stock déjà en ligne, hors de la mesure du délai.
    reader.enqueue({ ok: true, items: [item("9190", "Pull Ralph Lauren ancien", 1500, { publishedAt: new Date(clock.getTime() - 3 * 86_400_000).toISOString() })] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 1, initialStock: 1, alertsQueued: 0 });
    advance(60);
    // Date relative à l'heure près (« il y a 2 h ») : hors de la médiane ; date absolue : comptée.
    reader.enqueue({ ok: true, items: [item("9191", "Pull Ralph Lauren mesure", 1500), item("9192", "Pull Ralph Lauren approximatif", 1500, { publishedAtSource: "relative", publishedAt: new Date(clock.getTime() - 50_000).toISOString() })] });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ found: 2, initialStock: 0 });
    advance(60);
    reader.enqueue({ ok: false, code: "warning" });
    await radar.runSearch(ctx, search.id);
    const m = await radar.radarMetrics(ctx, { days: 7 });
    expect(m).toMatchObject({ status: "measured", liveReads: 3, blocks: 1, blockRatePer1000: 333.33, medianDetectToPurchaseSeconds: null, readsPerDay: [{ day: "2026-10-29", reads: 3, blocks: 1 }] });
    // Médiane : 90 s (absolue) et 50 s (relative, à la minute près) ; le stock initial (3 jours) n'y est pas.
    expect(m.medianPublishToDetectSeconds).toBe(70);
    expect(m.searches).toEqual([{ id: search.id, name: search.name, factor: 2, intervalSeconds: 120, lastBlockAt: clock.toISOString() }]);
    // Aucune donnée du vendeur dans les raisons de la note (elles restent après la purge).
    expect(JSON.stringify((await oppsOf(ctx)).map((o) => o.reasons))).not.toMatch(/4[.,]9|40 avis|vendeuse_test/);
    // Rétention : données du vendeur effacées après 30 jours (adresse de l'annonce comprise), mesures gardées 90 jours.
    const purge = await radar.purgeRadarData(services, ctx.orgId, new Date(T0.getTime() + 31 * 86_400_000));
    expect(purge).toMatchObject({ reads: 0, stripped: 3 });
    const after = await oppsOf(ctx);
    expect(after.every((o) => o.observed.sellerHandle === null && o.observed.sellerRating === null && o.observed.sellerReviews === null && o.observed.photoUrl === null && o.observed.url === null)).toBe(true);
    expect(JSON.stringify(after)).not.toMatch(/vendeuse_test|"sellerRating":4/);
  });
});

// ---------------------------------------------------------------- correctifs de la revue (29 octobre 2026)

describe("Selio Radar : rythme, ralentissement par organisation et lectures anormales", () => {
  it("deux recherches lues l'une après l'autre (8 s chacune) : toutes deux relues au passage suivant, 60 s plus tard", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { connectionId } = await liveSetup(ctx);
    await radar.createSearch(ctx, { name: "Deuxième", source: "cloud", connectionId });
    // Chaque lecture « dure » 8 s : l'horloge avance pendant la lecture.
    const slow = () => { advance(8); return { ok: true as const, items: [], durationMs: 8000 }; };
    reader.enqueue(slow, slow, slow, slow);
    expect((await radar.runDueReads(services, ctx.orgId)).read).toBe(2);
    clock = new Date(T0.getTime() + 60_000);
    expect((await radar.runDueReads(services, ctx.orgId)).read).toBe(2);
    expect(reader.calls).toHaveLength(4);
  });

  it("ralentissement porté par l'organisation : toutes les recherches en direct ralentissent, et recréer la recherche bloquée n'efface rien", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search, connectionId, account } = await liveSetup(ctx);
    const other = await radar.createSearch(ctx, { name: "Autre", source: "cloud", connectionId });
    reader.enqueue({ ok: false, code: "captcha" });
    await radar.runSearch(ctx, search.id);
    const list = await radar.listSearches(ctx);
    expect(list.find((s) => s.id === other.id)).toMatchObject({ slowdownFactor: 2, intervalSeconds: 120 });
    await radar.deleteSearch(ctx, search.id);
    const again = await radar.createSearch(ctx, { name: "Pulls Ralph Lauren", source: "cloud", connectionId });
    expect((await radar.listSearches(ctx)).find((s) => s.id === again.id)).toMatchObject({ slowdownFactor: 2, intervalSeconds: 120 });
    expect(account.id).toBeTruthy();
  });

  it("page non reconnue 3 fois de suite : recherche arrêtée, client alerté, rythme ralenti ; une lecture correcte remet le compteur à zéro", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await subscribe(ctx);
    const read = async (o: Parameters<FakeRadarReader["enqueue"]>[0]) => { reader.enqueue(o); const r = await radar.runSearch(ctx, search.id); advance(60); return r; };
    await read({ ok: false, code: "selector_missing" });
    await read({ ok: false, code: "error", launched: true });
    await read({ ok: true, items: [] });
    await read({ ok: false, code: "selector_missing" });
    await read({ ok: false, code: "timeout" });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.searches.byId(tx, search.id))).toMatchObject({ enabled: true, consecutiveFailures: 2 });
    const third = await read({ ok: false, code: "selector_missing" });
    expect(third).toMatchObject({ outcome: "page_changed", suspended: expect.stringContaining("3 lectures anormales"), nextReadAt: null, factor: 2 });
    const saved = await services.db.withOrg(ctx.orgId, (tx) => repos.searches.byId(tx, search.id));
    expect(saved).toMatchObject({ enabled: false, consecutiveFailures: 3, suspendedReason: expect.stringContaining("réactivez") });
    expect((await readsOf(ctx)).map((r) => r.outcome)).toContain("page_changed");
    expect(push.sent.map((p) => p.payload.title)).toEqual(["Radar : recherche arrêtée"]);
    // Plus aucune lecture : le passage l'écarte (recherche désactivée).
    expect((await radar.runDueReads(services, ctx.orgId)).read).toBe(0);
    // Réactivée par le client : compteur et raison effacés.
    expect(await radar.updateSearch(ctx, search.id, { enabled: true })).toMatchObject({ enabled: true, consecutiveFailures: 0, suspendedReason: null });
  });

  it("erreur APRÈS le chargement de la page : mesure, date de lecture et pages comptées quand même, aucune relecture immédiate", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    const original = repos.orders.all;
    repos.orders.all = async () => { throw new Error("panne de lecture des ventes"); };
    try {
      reader.enqueue({ ok: true, items: [item("31", "Pull Ralph Lauren panne", 1500)] });
      await expect(radar.runSearch(ctx, search.id)).rejects.toThrow("panne");
    } finally {
      repos.orders.all = original;
    }
    expect((await readsOf(ctx)).map((r) => [r.outcome, r.itemsSeen, r.itemsNew])).toEqual([["ok", 1, 0]]);
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.searches.byId(tx, search.id))).toMatchObject({ pagesRead: 1, lastReadAt: T0.toISOString() });
    expect(await radar.runSearch(ctx, search.id)).toMatchObject({ skipped: "too_soon" });
    // Le compte Achat a bien été libéré.
    expect(reader.calls).toHaveLength(1);
  });

  it("stock initial : la première lecture ne déclenche ni alerte ni Radar Auto", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { radar: { alertMinScore: 0 }, autoBuy: { enabled: true, threshold: 50 } });
    reader.enqueue({ ok: true, items: [item("41", "Pull Ralph Lauren stock", 1000)] });
    expect(await radar.runSearch(ctx, search.id, { followUp: false })).toMatchObject({ found: 1, initialStock: 1, alertsQueued: 0 });
    const opp = (await oppsOf(ctx))[0]!;
    expect(opp.observed).toMatchObject({ initialStock: true, publishedAtSource: "absolute", shippingShown: true });
    const run = await radar.runAutoBuy(ctx);
    expect(run).toMatchObject({ evaluated: 0, bought: 0 });
    expect(run.skipped).toEqual([{ reason: "Stock initial : pas d'achat automatique", count: 1 }]);
    expect(purchaser.calls).toHaveLength(0);
  });
});

describe("Radar Auto : sûreté de l'argent réel (correctifs)", () => {
  it("issue incertaine (« Payer » cliqué, confirmation non reconnue) : comptée dans le plafond, Radar Auto arrêté jusqu'à la vérification", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await subscribe(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true, dailyCapCents: 6000 } });
    await addOpportunity(ctx, search.id, "5001");
    await addOpportunity(ctx, search.id, "5002", 94);
    purchaser.enqueue({ status: "failed", code: "timeout", sideEffects: "unknown", launched: true, pages: 3 });
    await radar.runAutoBuy(ctx);
    const p = (await radar.listPurchases(ctx))[0]!;
    expect(p).toMatchObject({ status: "blocked", paymentAttempted: true, resultNote: expect.stringContaining("Radar Auto est arrêté") });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.purchases.spentSince(tx, alerts.localDayStart(clock, "Europe/Paris").toISOString()))).toBe(p.maxPriceCents);
    const next = await radar.runAutoBuy(ctx);
    expect(next.disabled).toBe(true);
    expect(next.reasons.join(" ")).toMatch(/arrêté par Selio/);
    expect(purchaser.calls).toHaveLength(1);
    await alerts.sendDueAlerts(services, ctx.orgId);
    expect(push.sent.map((s) => s.payload.title)).toContain("Radar Auto arrêté : achat à vérifier");
    // Pages de l'achat comptées dans les plafonds de pages par minute.
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.radarReads.countLiveSince(tx, new Date(clock.getTime() - 60_000).toISOString()))).toBe(3);
  });

  it("signal de Vinted pendant l'achat : mesuré (sorte « purchase ») et suivi du ralentissement de toute l'organisation", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, search.id, "5101");
    // CAPTCHA (et non « trop de requêtes ») : pas de coupe-circuit de la machine, partagée avec les tests du Cloud.
    purchaser.enqueue({ status: "failed", code: "captcha", launched: true, pages: 2 });
    await radar.runAutoBuy(ctx);
    expect((await readsOf(ctx)).map((r) => [r.kind, r.outcome, r.pages])).toEqual([["purchase", "captcha", 2]]);
    expect((await radar.listSearches(ctx)).find((s) => s.id === search.id)).toMatchObject({ slowdownFactor: 2, intervalSeconds: 120 });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.radarReads.liveWindow(tx, 1000))).toEqual({ reads: 2, blocks: 1 });
  });

  it("affaires du simulateur jamais achetées par le navigateur ; sans navigateur (API), les affaires lues en direct attendent le worker", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    const demoSearch = await radar.createSearch(ctx, { name: "Démo", budgetCents: 5000 });
    const sim = await services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.create(tx, {
      searchId: demoSearch.id, title: "Affaire simulée",
      observed: { priceCents: 2000, shippingCents: 450, brand: "Nike", size: "M", condition: "very_good", category: "men", sellerHandle: null, sellerRating: null, sellerReviews: null, photoUrl: null, photoCount: null, url: null, seenAt: clock.toISOString(), source: "demo_simulator" },
      estimate: { resalePriceCents: 6000, expectedFeesCents: 0, marginCents: 3380, marginRate: 0.56, confidence: "high", method: "brand_category", comparableCount: 3 },
      score: 99, reasons: [], breakdown: [], status: "new",
    }));
    const live = await addOpportunity(ctx, search.id, "5201", 90);
    purchaser.enqueue({ status: "dry_run", totalCents: 2620, pages: 2 });
    const run = await radar.runAutoBuy(ctx);
    expect(run).toMatchObject({ bought: 1, realPurchase: true });
    expect(purchaser.calls.map((c) => c.itemUrl)).toEqual(["https://www.vinted.fr/items/5201-pull"]);
    expect((await radar.listPurchases(ctx)).map((p) => [p.opportunityId, p.status])).toEqual([[live.id, "simulated"]]);
    // Sans navigateur : l'affaire lue en direct n'est jamais « simulée » à la place du worker ; achat réel faux.
    const apiCtx: OrgContext = { ...ctx, services: { ...services, radar: undefined } };
    const live2 = await addOpportunity(ctx, search.id, "5202", 91);
    const api = await radar.runAutoBuy(apiCtx);
    expect(api.realPurchase).toBe(false);
    expect(api.skipped).toContainEqual({ reason: "Affaire lue en direct : achetée seulement par le navigateur du worker", count: 1 });
    const purchases = await radar.listPurchases(ctx);
    expect(purchases.find((p) => p.opportunityId === live2.id)).toBeUndefined();
    expect(purchases.find((p) => p.opportunityId === sim.id)).toMatchObject({ status: "simulated", resultNote: expect.stringContaining("simulateur") });
  });

  it("aucun navigateur libre : la réservation est retirée (aucune demande annulée en série)", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, search.id, "5301");
    purchaser.enqueue({ status: "failed", code: "unavailable", launched: false }, { status: "failed", code: "unavailable", launched: false });
    await radar.runAutoBuy(ctx);
    await radar.runAutoBuy(ctx);
    expect(await radar.listPurchases(ctx)).toHaveLength(0);
    expect(purchaser.calls).toHaveLength(2);
  });

  it("porte-monnaie non proposé : arrêt avant « Payer », rien n'est payé", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, search.id, "5401");
    purchaser.enqueue({ status: "failed", code: "wallet_unavailable", sideEffects: "none", launched: true, pages: 2 });
    await radar.runAutoBuy(ctx);
    const p = (await radar.listPurchases(ctx))[0]!;
    expect(p).toMatchObject({ status: "blocked", resultNote: expect.stringContaining("Porte-monnaie Vinted non proposé") });
    expect(p.paymentAttempted ?? false).toBe(false);
    expect((await radar.autoStatus(ctx)).settings.enabled).toBe(true);
  });

  it("délai 3-D Secure en base = échéance du navigateur (et non le début du passage)", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const { search } = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, search.id, "5501");
    purchaser.enqueue(() => {
      advance(90); // parcours de 90 s avant la page de la banque
      return { status: "awaiting_3ds", totalCents: 2620, expiresAt: new Date(clock.getTime() + RADAR_3DS_TIMEOUT_MINUTES * 60_000).toISOString() };
    });
    await radar.runAutoBuy(ctx, { now: T0 });
    const p = (await radar.listPurchases(ctx))[0]!;
    expect(p.awaiting3dsUntil).toBe(new Date(T0.getTime() + 90_000 + RADAR_3DS_TIMEOUT_MINUTES * 60_000).toISOString());
    // 10 min après le début du passage (mais avant l'échéance du navigateur) : rien n'expire.
    clock = new Date(T0.getTime() + RADAR_3DS_TIMEOUT_MINUTES * 60_000 + 30_000);
    expect(await radar.expireAwaiting3ds(services, ctx.orgId)).toBe(0);
  });

  it("reprise 3-D Secure : jamais de repli sur un autre compte Achat, aucune session réécrite", async () => {
    if (!available) return;
    services.config = { radarAutoEnabled: true, radarRealPurchase: true };
    const ctx = await setupOrg();
    const a = await liveSetup(ctx);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    await addOpportunity(ctx, a.search.id, "5601");
    purchaser.enqueue({ status: "awaiting_3ds", totalCents: 2620 });
    await radar.runAutoBuy(ctx);
    const p = (await radar.listPurchases(ctx))[0]!;
    expect(p.cloudAccountId).toBe(a.account.id);
    // Un second compte Achat B relié au Cloud ; le compte A devient un compte de vente pendant l'attente.
    const b = await liveSetup(ctx);
    const bBefore = await services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.session(tx, b.account.id));
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.update(tx, a.connectionId, { usage: "sale" }));
    await expect(radar.resumePurchase(ctx, p.id)).rejects.toMatchObject({ code: "radar_live_requires_cloud", status: 409 });
    expect(purchaser.calls).toHaveLength(1);
    const bAfter = await services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.session(tx, b.account.id));
    expect(bAfter?.equals(bBefore!)).toBe(true);
    expect(await accountOf(ctx, b.account.id)).toMatchObject({ status: "active" });
  });

  it("« Je l'ai achetée » : jamais bloqué par le plafond, le budget ou la marge (avertissements), prix saisi reporté dans Manager", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const search = await radar.createSearch(ctx, { name: "Démo", budgetCents: 1000 });
    const opp = await services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.create(tx, {
      searchId: search.id, title: "Pull trop cher",
      observed: { priceCents: 7000, shippingCents: 450, brand: "Ralph Lauren", size: "M", condition: "very_good", category: "men", sellerHandle: null, sellerRating: null, sellerReviews: null, photoUrl: null, photoCount: null, url: null, seenAt: clock.toISOString(), source: "connector", shippingShown: false },
      estimate: { resalePriceCents: 6000, expectedFeesCents: 0, marginCents: -1800, marginRate: -0.3, confidence: "low", method: "brand_category", comparableCount: 0 },
      score: 10, reasons: [], breakdown: [], status: "new",
    }));
    const p = await radar.quickBuy(ctx, opp.id, { paidCents: 8100 });
    expect(p).toMatchObject({ status: "simulated", mode: "manual", totalCents: 8100 });
    expect(p.resultNote).toMatch(/À vérifier/);
    expect(p.checks.filter((c) => !c.ok).map((c) => c.code).sort()).toEqual(["margin_positive", "within_request_budget"]);
    const reported = await services.db.withOrg(ctx.orgId, (tx) => repos.items.byId(tx, p.reportedItemId!));
    expect(reported.purchasePriceCents).toBe(8100);
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.byId(tx, opp.id))).status).toBe("purchased");
    await expect(radar.quickBuy(ctx, opp.id)).rejects.toMatchObject({ status: 409 });
    await expect(radar.quickBuy(ctx, opp.id, { paidCents: -5 })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("Selio Radar : alertes réservées aux membres actuels, purge des données du vendeur", () => {
  it("membre retiré : ses appareils sont désabonnés et ne reçoivent plus rien ; un appareil se retire par son identifiant", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const employee = await services.db.withGlobal(async (tx) => {
      const u = await repos.users.create(tx, { email: `employe${++seq}@test.local`, displayName: "Employé", passwordHash: "x", passwordSalt: "y" });
      const m = await repos.memberships.create(tx, { orgId: ctx.orgId, userId: u.id, role: "operator" });
      return { userId: u.id, membershipId: m.id };
    });
    const empCtx: OrgContext = { ...ctx, userId: employee.userId, role: "operator" };
    await subscribe(empCtx, "https://push.example/employe");
    const mine = await subscribe(ctx, "https://push.example/proprietaire");
    const old = await subscribe(ctx, "https://push.example/ancien-telephone");
    // Abonnement d'un ancien membre resté en base (retrait fait avant ce correctif) : jamais servi.
    const ghost = await services.db.withGlobal(async (tx) => (await repos.users.create(tx, { email: `ancien${++seq}@test.local`, displayName: "Ancien", passwordHash: "x", passwordSalt: "y" })).id);
    await services.db.withOrg(ctx.orgId, (tx) => tx.query("insert into push_subscriptions (org_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)", [ctx.orgId, ghost, "https://push.example/fantome", "B".repeat(60), "a".repeat(16)]));
    const org = await import("./org");
    await org.removeMember(ctx, employee.membershipId);
    const all = await services.db.withOrg(ctx.orgId, (tx) => repos.pushSubscriptions.list(tx));
    expect(all.map((s) => s.endpoint).sort()).toEqual(["https://push.example/ancien-telephone", "https://push.example/fantome", "https://push.example/proprietaire"]);
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.pushSubscriptions.listActive(tx))).map((s) => s.endpoint).sort()).toEqual(["https://push.example/ancien-telephone", "https://push.example/proprietaire"]);
    expect(await alerts.removePushSubscription(ctx, old.id)).toEqual({ removed: true });
    // Un autre membre ne peut pas retirer l'appareil de quelqu'un d'autre.
    expect(await alerts.removePushSubscription({ ...ctx, userId: ghost }, mine.id)).toEqual({ removed: false });
    await services.db.withOrg(ctx.orgId, (tx) => repos.radarAlerts.enqueue(tx, { kind: "blocked", dedupeKey: `t:${++seq}`, payload: { title: "T", body: "B", url: "/app/radar" }, scheduledFor: clock.toISOString() }));
    await alerts.sendDueAlerts(services, ctx.orgId);
    expect(push.sent.map((s) => s.endpoint)).toEqual(["https://push.example/proprietaire"]);
  });

  it("purge à 30 jours : raisons de la note réécrites (anciens textes avec la note du vendeur), nombre d'avis seul purgé", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const search = await radar.createSearch(ctx, { name: "Démo" });
    await services.db.withOrg(ctx.orgId, (tx) => repos.opportunities.create(tx, {
      searchId: search.id, title: "Ancienne affaire",
      observed: { priceCents: 1000, shippingCents: 0, brand: null, size: null, condition: null, category: null, sellerHandle: null, sellerRating: null, sellerReviews: 23, photoUrl: null, photoCount: null, url: null, seenAt: clock.toISOString(), source: "connector" },
      estimate: { resalePriceCents: 3000, expectedFeesCents: 0, marginCents: 1500, marginRate: 0.5, confidence: "low", method: "brand_category", comparableCount: 0 },
      score: 70, reasons: ["Marge estimée 15 € : +20/40.", "Vendeur noté 4.8/5 (23 avis) : +10/10."], breakdown: [], status: "watching", createdAt: clock.toISOString(),
    }));
    const purge = await radar.purgeRadarData(services, ctx.orgId, new Date(T0.getTime() + 31 * 86_400_000));
    expect(purge.stripped).toBe(1);
    const o = (await oppsOf(ctx))[0]!;
    expect(o.reasons).toEqual(["Marge estimée 15 € : +20/40.", repos.SELLER_REASON_PURGED]);
    expect(o.observed.sellerReviews).toBeNull();
    expect(JSON.stringify(o)).not.toMatch(/4\.8|23 avis/);
  });
});
