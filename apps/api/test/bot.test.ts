import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, hashPassword, repos, type PgPool } from "@selio/db";
import { BOT_IDS, quotasForPlan } from "@selio/contracts";
import { NoopEmailProvider } from "@selio/email";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Selio Bot par l'API, sur une base dédiée selio_test_api_bot (créée si besoin) : synthèse lisible par
 * l'exécuteur, « Tout arrêter » et « Reprendre » réservés au titulaire et à l'administrateur, audit `bot.*`,
 * Selio Cloud et Radar Auto fermés par défaut (CLOUD_ENABLED, RADAR_AUTO_ENABLED et RADAR_REAL_PURCHASE
 * absents). Aucun appel réseau, rien vers Vinted. Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_BOT_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_bot";
const APP_URL = process.env.TEST_API_BOT_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_bot";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};
let orgId = "";

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

async function call(method: "GET" | "POST", url: string, who = "owner") {
  const res = await built.app.inject({ method, url, headers: { cookie: cookies[who] ?? "" } });
  let json: unknown = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, json: json as any, text: res.body };
}

async function member(who: string, role: "admin" | "operator" | "photographer") {
  const inv = await built.app.inject({ method: "POST", url: "/api/org/members", payload: { email: `${who}@bot.test`, role }, headers: { cookie: cookies.owner ?? "" } });
  expect(inv.statusCode, inv.body).toBe(201);
  const { hash, salt } = await hashPassword(`${who}-mdp-solide-1`);
  await built.services.db.withGlobal((tx) => repos.users.setPassword(tx, JSON.parse(inv.body).user.id, hash, salt));
  const login = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${who}@bot.test`, password: `${who}-mdp-solide-1` } });
  expect(login.statusCode).toBe(200);
  cookies[who] = cookieOf(login);
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits, invoice_counters cascade");
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "", PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { email: new NoopEmailProvider(), payments: null }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "titulaire@bot.test", password: "motdepasse-B1", displayName: "Titulaire", orgName: "Boutique Bot" } });
  expect(r.statusCode).toBe(201);
  cookies.owner = cookieOf(r);
  orgId = JSON.parse(r.body).org.id;
  await built.services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
  await member("admin", "admin");
  await member("executeur", "operator");
  await member("photos", "photographer");
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("Selio Bot (API)", () => {
  it("GET /api/bot : sept bots ; Cloud et Radar Auto fermés par défaut ; l'exécuteur voit l'état sans pouvoir tout arrêter", async () => {
    if (!available) return;
    const s = await call("GET", "/api/bot");
    expect(s.status, s.text).toBe(200);
    expect(s.json.bots.map((b: { id: string }) => b.id)).toEqual([...BOT_IDS]);
    expect(s.json).toMatchObject({ stopped: false, canManage: true, plan: "agence" });
    expect(s.json.cloud).toMatchObject({ available: true, serverEnabled: false, ready: false });
    expect(s.json.autoBuy).toMatchObject({ serverEnabled: false, realPurchase: false, active: false });
    expect(s.json.bots.find((b: { id: string }) => b.id === "auto_buy").state).toBe("locked");
    const op = await call("GET", "/api/bot", "executeur");
    expect(op.status).toBe(200);
    expect(op.json.canManage).toBe(false);
    expect((await call("POST", "/api/bot/stop", "executeur")).status).toBe(403);
    expect((await call("POST", "/api/bot/resume", "executeur")).status).toBe(403);
    expect((await call("GET", "/api/bot", "photos")).status).toBe(403);
    expect((await call("GET", "/api/bot", "personne")).status).toBe(401);
  });

  it("« Tout arrêter » par l'administrateur, visible par tous et dans l'arrêt global ; reprise par le titulaire ; audit bot.*", async () => {
    if (!available) return;
    const stop = await call("POST", "/api/bot/stop", "admin");
    expect(stop.status, stop.text).toBe(200);
    expect(stop.json.stopped).toBe(true);
    expect(stop.json.bots.find((b: { id: string }) => b.id === "auto_buy").state).toBe("stopped");
    expect((await call("GET", "/api/bot", "executeur")).json.stopped).toBe(true);
    expect((await call("GET", "/api/automations/state")).json.globalPaused).toBe(true);
    expect((await call("GET", "/api/radar/auto/status")).json.reasons).toContain("Arrêt global des automatisations.");
    const resume = await call("POST", "/api/bot/resume");
    expect(resume.json.stopped).toBe(false);
    expect((await call("GET", "/api/automations/state")).json.globalPaused).toBe(false);
    const audit = (await call("GET", "/api/audit?limit=50")).json.map((a: { action: string }) => a.action);
    expect(audit).toContain("bot.stopped");
    expect(audit).toContain("bot.resumed");
  });
});
