import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockAIProvider, AIService } from "@selio/ai";
import { BOT_AUTO_BUY_LOCKED_TEXT, BOT_IDS, quotasForPlan, type Role } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { OrgContext, Services } from "../context";
import * as automation from "./automation";
import * as bot from "./bot";
import * as radar from "./radar";

/**
 * Selio Bot sur PostgreSQL, base dédiée selio_test_core_bot (créée si besoin) : synthèse des bots à partir
 * des règles, des journaux et des verrous existants, « Tout arrêter » et « Reprendre » réservés au titulaire
 * et à l'administrateur, audit `bot.*`, coupe-circuit respecté par la file serveur, le planificateur des
 * règles et Radar Auto. Aucun appel réseau, rien n'est envoyé vers Vinted. Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_BOT_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_bot";
const APP_URL = process.env.TEST_CORE_BOT_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_bot";

let available = true;
let owner: PgPool;
let db: Db;
let services: Services;
let ctx: OrgContext;

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

const as = (role: Role): OrgContext => ({ ...ctx, role });
const schedule = { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" };
const limits = { maxPerDay: 50, maxPerCustomerPerDay: 2, minMinutesBetweenActions: 0 };

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 2 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  db = new Db(createPool(APP_URL, { max: 4 }));
  services = { db, ai: new AIService({ provider: new MockAIProvider(), concurrency: 2, maxPending: 20, circuitFailures: 1000, circuitCooldownMs: 1000, timeoutMs: 5000, allowFallback: false }), secrets: new SecretBox(SecretBox.generateKey()), now: () => new Date(), allowAiFallback: false, version: "test" };
  const ids = await db.withGlobal(async (tx) => {
    const user = await repos.users.create(tx, { email: "bot@test.local", displayName: "Titulaire Bot", passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: "Boutique Bot", slug: "boutique-bot", settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: user.id, role: "owner" });
    return { userId: user.id, orgId: o.id };
  });
  await db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "active", provider: "none", quotas: quotasForPlan("pro") }));
  ctx = { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.30" };
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
});

/** Tâche serveur en file, échue (règle « remise en avant », sans article : exécution sans effet). */
async function queuedServerJob(): Promise<string> {
  return db.withOrg(ctx.orgId, async (tx) => {
    const rule = (await repos.rules.list(tx)).find((r) => r.kind === "relist_stale") ?? (await repos.rules.create(tx, { name: "Remise en avant", kind: "relist_stale", enabled: true, requiresApproval: false, runsIn: "server", schedule, limits, config: {} }));
    const job = await repos.jobs.create(tx, { kind: "automation.evaluate", status: "queued", dedupeKey: `bot-test-${Math.random()}`, ruleId: rule.id, payload: { ruleName: "Remise en avant" }, runsIn: "server", scheduledFor: new Date(Date.now() - 60_000).toISOString() });
    return job.id;
  });
}

describe("Selio Bot (cœur, PostgreSQL)", () => {
  it("synthèse : sept bots à partir des règles existantes, verrous de Radar Auto fermés, Cloud indisponible en Pro", async () => {
    if (!available) return;
    await db.withOrg(ctx.orgId, async (tx) => {
      await repos.rules.create(tx, { name: "Négo", kind: "auto_negotiate", enabled: true, requiresApproval: true, runsIn: "browser", schedule, limits, config: {} });
      await repos.rules.create(tx, { name: "Relance 24 h", kind: "follow_up_24h", enabled: true, requiresApproval: true, runsIn: "server", schedule, limits, config: {} });
    });
    const s = await bot.summary(ctx, { cloudServerEnabled: false });
    expect(s.bots.map((b) => b.id)).toEqual([...BOT_IDS]);
    expect(s.stopped).toBe(false);
    expect(s.canManage).toBe(true);
    expect(s.plan).toBe("pro");
    expect(s.actionsPerDay).toBe(quotasForPlan("pro").automationActionsPerDay);
    expect(s.cloud).toMatchObject({ available: false, serverEnabled: false, ready: false, activeAccounts: 0 });
    const byId = Object.fromEntries(s.bots.map((b) => [b.id, b]));
    expect(byId.negotiation).toMatchObject({ state: "on", place: "extension", rulesEnabled: 1 });
    expect(byId.follow_up).toMatchObject({ state: "on", place: "server" });
    expect(byId.favorites!.state).toBe("soon");
    expect(byId.auto_buy).toMatchObject({ state: "locked", stateDetail: BOT_AUTO_BUY_LOCKED_TEXT });
    expect(s.autoBuy).toMatchObject({ serverEnabled: false, realPurchase: false, orgEnabled: false, active: false });
  });

  it("dernières actions : lues dans le journal des tâches, rangées par bot", async () => {
    if (!available) return;
    const jobId = await queuedServerJob();
    expect(await automation.processDueJobs(ctx)).toBeGreaterThanOrEqual(1);
    expect((await db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("succeeded");
    const s = await bot.summary(ctx);
    const republish = s.bots.find((b) => b.id === "republish")!;
    expect(republish.recent[0]).toMatchObject({ status: "done", source: "job" });
    expect(republish.recent[0]!.label).toMatch(/Remise en avant/);
  });

  it("rôles : l'exécuteur voit l'état mais ne peut ni arrêter ni reprendre ; le contributeur photos ne voit rien", async () => {
    if (!available) return;
    const seen = await bot.summary(as("operator"));
    expect(seen.canManage).toBe(false);
    await expect(bot.stopAll(as("operator"))).rejects.toMatchObject({ status: 403 });
    await expect(bot.resumeAll(as("viewer"))).rejects.toMatchObject({ status: 403 });
    await expect(bot.summary(as("photographer"))).rejects.toMatchObject({ status: 403 });
  });

  it("« Tout arrêter » (administrateur) : audit, file serveur gelée, aucune règle ne crée de tâche, Radar Auto refusé ; puis reprise", async () => {
    if (!available) return;
    const stopped = await bot.stopAll(as("admin"));
    expect(stopped.stopped).toBe(true);
    expect(stopped.stoppedAt).not.toBeNull();
    expect(stopped.bots.find((b) => b.id === "negotiation")!.state).toBe("stopped");
    expect(stopped.bots.find((b) => b.id === "auto_buy")!.state).toBe("stopped");

    const jobId = await queuedServerJob();
    expect(await automation.processDueJobs(ctx)).toBe(0);
    expect((await db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("queued");
    const rule = (await automation.listRules(ctx)).find((r) => r.kind === "auto_negotiate")!;
    const run = await db.withOrg(ctx.orgId, (tx) => automation.runRuleTx(ctx, tx, rule));
    expect(run.created).toBe(0);
    expect((await radar.autoStatus(ctx)).reasons).toContain("Arrêt global des automatisations.");

    const resumed = await bot.resumeAll(ctx);
    expect(resumed.stopped).toBe(false);
    expect(await automation.processDueJobs(ctx)).toBeGreaterThanOrEqual(1);
    expect((await db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("succeeded");
    const actions = (await db.withOrg(ctx.orgId, (tx) => repos.audit.list(tx, 50))).map((a) => a.action);
    expect(actions).toContain("bot.stopped");
    expect(actions).toContain("bot.resumed");
    // Journal d'activité de Selio Manager (`recordActivity`) : « … a tout arrêté dans Selio Bot ».
    expect(actions).toContain("activity.bot.action");
  });
});
