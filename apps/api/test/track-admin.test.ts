import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, repos, type PgPool } from "@selio/db";
import { quotasForPlan } from "@selio/contracts";
import { track } from "@selio/core";
import { NoopEmailProvider } from "@selio/email";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Selio Track dans l'administration (/api/admin/track/*) et alertes de tendance d'un filtre
 * (/api/track/filters/:id/alerts), sur une base dédiée selio_test_api_track (créée si besoin). Simulateur
 * seulement (TRACK_LIVE_ENABLED absent) : aucune page de Vinted n'est lue.
 */
const OWNER_URL = process.env.TEST_API_TRACK_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_track";
const APP_URL = process.env.TEST_API_TRACK_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_track";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};
const orgs: Record<string, string> = {};

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

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? "").split(";")[0] ?? "";
}

async function call(method: "GET" | "POST" | "PUT", url: string, body: unknown, who: string) {
  const res = await built.app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[who] ?? "" } });
  let json: unknown = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, json: json as any };
}

async function register(who: string, email: string) {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: `motdepasse-${who}-1`, displayName: who, orgName: `Boutique ${who}` } });
  expect(r.statusCode, r.body).toBe(201);
  cookies[who] = cookieOf(r);
  orgs[who] = JSON.parse(r.body).org.id;
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
    await owner.query("truncate track_filter_reads, track_snapshots, track_read_log");
    await owner.query("update track_runtime set manual_paused = false, manual_paused_at = null, manual_paused_by = null, manual_pause_reason = null, paused_until = null, pause_reason = null");
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "ops@track-admin.test", PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { email: new NoopEmailProvider() }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  await register("ops", "ops@track-admin.test");
  await register("cliente", "cliente@track-admin.test");
  await built.app.services.db.withOrg(orgs.cliente!, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "active", quotas: quotasForPlan("pro") }));
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

const criteria = { brands: ["Levi's"], categories: ["men"], keywords: ["jean 501"], maxPriceCents: 4000 };

describe("Track dans l'administration (/api/admin/track)", () => {
  it("refuse tout non-opérateur (403), lecture et pause comprises", async () => {
    if (!available) return;
    expect((await call("GET", "/api/admin/track", undefined, "cliente")).status).toBe(403);
    expect((await call("POST", "/api/admin/track/pause", { reason: "Essai" }, "cliente")).status).toBe(403);
    expect((await call("POST", "/api/admin/track/resume", {}, "cliente")).status).toBe(403);
    expect((await built.app.inject({ method: "GET", url: "/api/admin/track" })).statusCode).toBe(401);
  });

  it("montre la source (simulateur, interrupteur fermé), l'usage par client et les filtres suivis réels", async () => {
    if (!available) return;
    const f = await call("POST", "/api/track/filters", { name: "Jeans", criteria }, "cliente");
    expect(f.status).toBe(201);
    const s = await call("GET", "/api/admin/track", undefined, "ops");
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ source: "demo", liveEnabled: false, manualPause: { paused: false }, canControl: true, fingerprints: { followed: 1 } });
    expect(s.json.usage.find((u: { orgId: string }) => u.orgId === orgs.cliente)).toMatchObject({ filters: { used: 1, quota: 5, enabled: 1 }, scans: { used: 0, quota: 10 }, photoSearches: { used: 0, quota: 30 } });
    // Aucun critère ni nom de filtre dans la vue d'administration.
    expect(JSON.stringify(s.json)).not.toContain("jean 501");
    // Vue « utilisation par client » : le compteur des filtres suivis n'est plus à 0.
    const usage = await call("GET", "/api/admin/usage", undefined, "ops");
    expect(usage.json.orgs.find((o: { id: string }) => o.id === orgs.cliente).track.filtersFollowed).toMatchObject({ used: 1, quota: 5 });
    // Et la page « Mon utilisation » du client dit la même chose.
    expect((await call("GET", "/api/track/usage", undefined, "cliente")).json.counters.filtersFollowed).toMatchObject({ used: 1, quota: 5 });
  });

  it("pause manuelle (raison exigée, auditée) respectée par le worker sans redémarrage, puis reprise", async () => {
    if (!available) return;
    expect((await call("POST", "/api/admin/track/pause", {}, "ops")).status).toBe(400);
    const paused = await call("POST", "/api/admin/track/pause", { reason: "Contrôle avant mise à jour" }, "ops");
    expect(paused.status).toBe(200);
    expect(paused.json.manualPause).toMatchObject({ paused: true, reason: "Contrôle avant mise à jour" });
    // Le passage du worker (même base, mêmes services) n'en lit plus aucune empreinte.
    const services = built.app.services;
    const skipped = await track.runDueTrackReads(services);
    expect(skipped.results.map((r) => r.skipped)).toEqual(["manual_pause"]);
    expect(skipped.read).toBe(0);
    const resumed = await call("POST", "/api/admin/track/resume", {}, "ops");
    expect(resumed.json.manualPause.paused).toBe(false);
    const read = await track.runDueTrackReads(services);
    expect(read.read).toBe(1);
    const after = await call("GET", "/api/admin/track", undefined, "ops");
    expect(after.json.recentReads[0]).toMatchObject({ source: "demo", outcome: "ok" });
    expect(after.json.recentReads[0].fingerprint).toHaveLength(12);
    expect(after.json.last24h.reads).toBeGreaterThanOrEqual(1);
    const actions = (await owner.query("select action from audit_logs where action like 'admin.track_%' order by created_at")).rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(["admin.track_paused", "admin.track_resumed"]);
  });
});

describe("alertes de tendance d'un filtre (/api/track/filters/:id/alerts)", () => {
  it("réglage coupé par défaut, modifiable, validé ; refusé sans Track ; filtre d'une autre organisation introuvable", async () => {
    if (!available) return;
    const [f] = (await call("GET", "/api/track/filters", undefined, "cliente")).json;
    const initial = await call("GET", `/api/track/filters/${f.id}/alerts`, undefined, "cliente");
    expect(initial.status).toBe(200);
    expect(initial.json).toMatchObject({ rules: { enabled: false, medianPrice: { enabled: false, percent: 15 } }, events: [], cooldownHours: 24 });
    const put = await call("PUT", `/api/track/filters/${f.id}/alerts`, { enabled: true, newListings: { enabled: true, threshold: 3 } }, "cliente");
    expect(put.status).toBe(200);
    expect(put.json.rules).toMatchObject({ enabled: true, newListings: { enabled: true, threshold: 3 } });
    expect((await call("PUT", `/api/track/filters/${f.id}/alerts`, { enabled: true, medianPrice: { enabled: true, percent: 1 } }, "cliente")).status).toBe(400);
    // Filtre d'une autre organisation : introuvable ; organisation sans Track (Starter) : 402.
    expect((await call("GET", `/api/track/filters/${f.id}/alerts`, undefined, "ops")).status).toBe(404);
    await built.app.services.db.withOrg(orgs.ops!, (tx) => repos.subscriptions.upsert(tx, { plan: "starter", status: "active", quotas: quotasForPlan("starter") }));
    expect((await call("GET", `/api/track/filters/${f.id}/alerts`, undefined, "ops")).status).toBe(402);
  });
});
