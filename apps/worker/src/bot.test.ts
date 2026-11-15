import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, SecretBox, createPool, runMigrations, MIGRATIONS_DIR, repos } from "@selio/db";
import { createAIService } from "@selio/ai";
import { bot, cloud, messaging, type OrgContext, type Services } from "@selio/core";
import { automationTick, processJobs, systemContext } from "./tasks";

/**
 * « Tout arrêter » de Selio Bot côté worker, sur une base dédiée selio_test_worker_bot (créée si besoin) :
 * le passage des règles, la file des tâches serveur et le planificateur Cloud ne lancent plus rien tant
 * que le coupe-circuit de l'organisation est actif ; tout repart à la reprise. Simulateur seulement.
 */
const OWNER_URL = process.env.TEST_WORKER_BOT_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker_bot";
const APP_URL = process.env.TEST_WORKER_BOT_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker_bot";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

let available = true;
let services: Services;
let orgId = "";
let userId = "";

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
    const owner = createPool(OWNER_URL, { max: 1 });
    try {
      await runMigrations(owner, MIGRATIONS_DIR);
      await owner.query("truncate users, organizations, rate_limits cascade");
    } finally {
      await owner.end();
    }
  } catch {
    available = false;
    return;
  }
  services = { db: new Db(createPool(APP_URL, { max: 2 })), ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }), secrets: new SecretBox(SecretBox.generateKey()), now: () => new Date(), allowAiFallback: false, version: "test" };
  ({ orgId, userId } = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: "bot-w@test.local", displayName: "W", passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: "Org Bot", slug: "org-bot-w", settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { orgId: o.id, userId: u.id };
  }));
});

afterAll(async () => { await services?.db.close(); });

describe("worker : coupe-circuit de Selio Bot", () => {
  it("rien ne part pendant « Tout arrêter » (règles, file serveur, Cloud) ; tout reprend après", async () => {
    if (!available) return;
    const owner: OrgContext = { services, orgId, userId, role: "owner", isOperator: false, ip: null };
    await services.db.withOrg(orgId, async (tx) => {
      await repos.connections.create(tx, { id: "c-demo-bot", provider: "demo", label: "Simu", status: "connected", capabilities: [{ capability: "send_message", state: "available", note: "" }, { capability: "read_conversations", state: "available", note: "" }], transport: "simulator" });
      await repos.rules.create(tx, { name: "Accusé", kind: "reply_on_new_message", enabled: true, requiresApproval: false, runsIn: "server", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" }, limits: { maxPerDay: 5, maxPerCustomerPerDay: 2, minMinutesBetweenActions: 0 }, config: { template: "Bien reçu {{prenom}}" } });
    });
    await messaging.simulateIncoming(systemContext(services, orgId), null, "Bonjour, dispo ?");
    await bot.stopAll(owner);

    // Passage des règles : organisation écartée, aucune tâche.
    expect((await automationTick(services, silent)).created).toBe(0);
    // File serveur : une tâche échue reste en file.
    const job = await services.db.withOrg(orgId, async (tx) => {
      const rule = (await repos.rules.list(tx))[0]!;
      return repos.jobs.create(tx, { kind: "automation.evaluate", status: "queued", dedupeKey: "bot-worker-1", ruleId: rule.id, payload: {}, runsIn: "server", scheduledFor: new Date(Date.now() - 60_000).toISOString() });
    });
    expect(await processJobs(services, silent)).toBe(0);
    expect((await services.db.withOrg(orgId, (tx) => repos.jobs.byId(tx, job.id))).status).toBe("queued");
    // Planificateur Cloud : refus « arrêt global » avant toute ouverture de navigateur.
    const plan = { account: { status: "active" as const, hasSession: true, settings: { levels: ["light" as const] } }, consentOk: true, globalPaused: true, available: true, heavyActionsEnabled: false, quotas: { automationActionsPerDay: 100 }, actionsToday: 0, actionsLastHour: 0, lastActionAt: null, now: new Date(), activeHours: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" } };
    expect(cloud.planAccountRun({ ...plan, globalPaused: (await services.db.withOrg(orgId, (tx) => bot.isStoppedTx(tx))) })).toEqual({ act: false, reason: "global_pause" });

    await bot.resumeAll(owner);
    expect((await automationTick(services, silent)).created).toBe(1);
    expect(await processJobs(services, silent)).toBeGreaterThanOrEqual(1);
    expect((await services.db.withOrg(orgId, (tx) => repos.jobs.byId(tx, job.id))).status).toBe("succeeded");
  });
});
