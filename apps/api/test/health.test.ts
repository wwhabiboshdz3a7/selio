import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, type PgPool } from "@selio/db";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * /api/health (public, sans secret) et /api/health/details (opérateurs), sur une base dédiée
 * selio_test_api_health (créée si besoin) : jamais celle de api.test.ts, qui peut tourner en même temps.
 * Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_HEALTH_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_health";
const APP_URL = process.env.TEST_API_HEALTH_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_health";
const ENCRYPTION_KEY = SecretBox.generateKey();
const HEALTH_TOKEN = "jeton-de-sante-health-test-0123";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};

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

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits, supervision_targets, supervision_checks cascade");
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "ops@health.test", AI_HEALTH_TOKEN: HEALTH_TOKEN, PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env);
  await built.app.ready();
  for (const [who, email] of [["ops", "ops@health.test"], ["client", "client@health.test"]] as const) {
    const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "motdepasse-H1", displayName: who, orgName: `Boutique ${who}` } });
    expect(r.statusCode).toBe(201);
    cookies[who] = cookieOf(r);
  }
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("/api/health", () => {
  it("public : base, Redis, file, version, durée de fonctionnement — sans secret", async () => {
    if (!available) return;
    const r = await built.app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({ ok: true, status: "ok", checks: { database: "ok", redis: "inline", queue: "inline" } });
    expect(typeof body.version).toBe("string");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "checks", "ok", "status", "uptimeSeconds", "version"]);
    for (const secret of [ENCRYPTION_KEY, HEALTH_TOKEN, "selio_app", "127.0.0.1", "5432"]) expect(r.body).not.toContain(secret);
  });

  it("détails réservés aux opérateurs, avec l'état des cibles supervisées et les dernières vérifications", async () => {
    if (!available) return;
    expect((await built.app.inject({ method: "GET", url: "/api/health/details" })).statusCode).toBe(401);
    expect((await built.app.inject({ method: "GET", url: "/api/health/details", headers: { cookie: cookies.client! } })).statusCode).toBe(403);
    // Une cible en panne enregistrée par le worker (tables globales de 0016).
    await owner.query("insert into supervision_targets (name, url, status, consecutive_failures, down_since, last_alert_at, last_checked_at, last_error) values ('ia', 'https://api.selio.test/api/ai/health', 'down', 4, now(), now(), now(), 'HTTP 503')");
    await owner.query("insert into supervision_checks (target, ok, status_code, latency_ms, error, event) values ('ia', false, 503, 15, 'HTTP 503', 'alert'), ('ia', false, 503, 14, 'HTTP 503', null)");
    const r = await built.app.inject({ method: "GET", url: "/api/health/details", headers: { cookie: cookies.ops! } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.health).toMatchObject({ ok: true, checks: { database: "ok" } });
    expect(typeof body.health.latencyMs.database).toBe("number");
    expect(Array.isArray(body.queues)).toBe(true);
    expect(body.supervision).toMatchObject({ failuresBeforeAlert: 3, reminderMinutes: 60 });
    expect(body.supervision.targets).toEqual([expect.objectContaining({ name: "ia", status: "down", consecutiveFailures: 4, lastError: "HTTP 503" })]);
    expect(body.supervision.recent).toHaveLength(2);
    expect(body.supervision.recent.map((c: { event: string | null }) => c.event).sort()).toEqual(["alert", null].sort());
    expect(r.body).not.toContain(HEALTH_TOKEN);
  });
});
