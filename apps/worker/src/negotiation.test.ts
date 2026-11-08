import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAIService } from "@selio/ai";
import { FakeRunner } from "@selio/cloud";
import { CLOUD_CONSENT_VERSION, quotasForPlan, type Plan } from "@selio/contracts";
import { cloud, migration, type OrgContext, type Services } from "@selio/core";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations } from "@selio/db";
import { RunnerCloudExecutor, cloudTick } from "./cloud";
import { automationTick, retentionTick } from "./tasks";

/**
 * Worker et négociation avancée (§5.12, §5.13) sur PostgreSQL : la relance après 24 h passe par le tick
 * d'automatisation existant (brouillon à valider en Pro, une seule fois par conversation) et, en Agence,
 * par le tick du Cloud (`cloud.runDueCloudJobs`, FakeRunner : aucun navigateur, aucune page Vinted) ; la
 * rétention efface l'entrée brute d'une migration au bout de 7 jours. Base dédiée selio_test_worker_negotiation
 * (créée si besoin) : les fichiers de tests tournent en parallèle. Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_WORKER_NEGOTIATION_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker_negotiation";
const APP_URL = process.env.TEST_WORKER_NEGOTIATION_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker_negotiation";

const T0 = new Date("2026-11-05T09:00:00.000Z"); // jeudi, 10 h à Paris
let clock = new Date(T0);
let available = true;
let services: Services;
let profileBase = "";
let seq = 0;
const silent = { info: () => {}, warn: () => {}, error: () => {} };

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
      await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
    } finally {
      await owner.end();
    }
  } catch {
    available = false;
    return;
  }
  services = {
    db: new Db(createPool(APP_URL, { max: 3 })),
    ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }),
    secrets: new SecretBox(SecretBox.generateKey()),
    now: () => new Date(clock),
    allowAiFallback: false,
    version: "test",
    config: { cloudActiveHours: { startHour: 8, endHour: 23 } },
  };
  profileBase = await mkdtemp(join(tmpdir(), "selio-worker-nego-test-"));
});

afterAll(async () => {
  await services?.db.close();
  if (profileBase) await rm(profileBase, { recursive: true, force: true });
});

async function setupOrg(plan: Plan): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `wnego${n}@test.local`, displayName: `W ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org W Négo ${n}`, slug: `org-w-nego-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { orgId: o.id, userId: u.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotasForPlan(plan) }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: null };
}

/** Règle de relance après 24 h et conversation dont le dernier message (sortant, envoyé) date de 25 h. */
async function followUpSetup(ctx: OrgContext, connectionId: string, externalRef: string | null): Promise<string> {
  return services.db.withOrg(ctx.orgId, async (tx) => {
    await repos.rules.create(tx, { name: "Relance 24 h", kind: "follow_up_24h", enabled: true, requiresApproval: false, runsIn: "server", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" }, limits: { maxPerDay: 50, maxPerCustomerPerDay: 5, minMinutesBetweenActions: 0 }, config: {} });
    const customer = await repos.customers.create(tx, { displayName: "Léa Martin", handle: `lea-wn${++seq}`, provider: "vinted" });
    const conv = await repos.conversations.create(tx, { customerId: customer.id, connectionId, provider: "vinted", externalRef, status: "open" });
    const at = new Date(clock.getTime() - 25 * 3_600_000).toISOString();
    await repos.messages.create(tx, { conversationId: conv.id, direction: "outbound", source: "user", status: "sent", body: "Oui, toujours disponible.", createdAt: at, sentAt: at });
    await repos.conversations.update(tx, conv.id, { lastMessageAt: at });
    return conv.id;
  });
}

describe("worker : relance après 24 h et rétention de la migration", () => {
  it("tick d'automatisation, offre Pro : un brouillon à valider, une seule fois par conversation", async () => {
    if (!available) return;
    clock = new Date(T0);
    const ctx = await setupOrg("pro");
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: `demo-wn-${seq}`, provider: "demo", label: "Simulateur", status: "connected", transport: "simulator", capabilities: [{ capability: "send_message", state: "available", note: "" }] }));
    const convId = await followUpSetup(ctx, `demo-wn-${seq}`, null);
    expect((await automationTick(services, silent)).created).toBeGreaterThanOrEqual(1);
    const jobs = await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}));
    expect(jobs.items).toHaveLength(1);
    expect(jobs.items[0]).toMatchObject({ status: "awaiting_approval", runsIn: "server", dedupeKey: `follow_up_24h:${convId}` });
    // Le lendemain, toujours une seule relance.
    clock = new Date(T0.getTime() + 24 * 3_600_000);
    await automationTick(services, silent);
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}))).items).toHaveLength(1);
    const drafts = await services.db.withOrg(ctx.orgId, (tx) => repos.messages.forConversation(tx, convId));
    expect(drafts.filter((m) => m.status === "draft")).toHaveLength(1);
  });

  it("offre Agence avec Selio Cloud actif : tâche « cloud » exécutée par le tick du Cloud (FakeRunner), aux heures actives", async () => {
    if (!available) return;
    clock = new Date(T0);
    const ctx = await setupOrg("agence");
    const connectionId = `vinted-wn-${++seq}`;
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: connectionId, provider: "vinted", label: "Vinted Agence", status: "connected", usage: "sale" }));
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, { connectionId });
    const ticket = await cloud.startLogin(ctx, account.id);
    await cloud.completeLogin(services, ticket.loginSessionId, { cookies: [{ name: "_vinted_fr_session", value: "SESSION-WORKER-NEGO", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] });
    const convId = await followUpSetup(ctx, connectionId, "7712345");
    await automationTick(services, silent);
    const job = (await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}))).items[0]!;
    expect(job).toMatchObject({ status: "queued", runsIn: "cloud", payload: { followUpMode: "cloud", cloudKind: "follow_up", cloudAccountId: account.id } });
    const runner = new FakeRunner();
    const res = await cloudTick(services, silent, { executor: new RunnerCloudExecutor(runner, profileBase), concurrency: 1, now: new Date(clock), rng: () => 0 });
    expect(res).toMatchObject({ executed: 1, done: 1 });
    expect(runner.calls[0]).toMatchObject({ action: { kind: "follow_up", conversationUrl: "https://www.vinted.fr/inbox/7712345" } });
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, job.id))).status).toBe("succeeded");
    const sent = (await services.db.withOrg(ctx.orgId, (tx) => repos.messages.forConversation(tx, convId))).at(-1)!;
    expect(sent).toMatchObject({ direction: "outbound", status: "sent", source: "automation" });
    expect(sent.body).not.toMatch(/\d/);
    // Jamais une deuxième relance.
    clock = new Date(T0.getTime() + 30 * 3_600_000);
    await automationTick(services, silent);
    expect((await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}))).items).toHaveLength(1);
    await cloud.stop(ctx, account.id);
  });

  it("rétention : le texte collé d'une migration est effacé 7 jours après la conversion, la correspondance reste", async () => {
    if (!available) return;
    clock = new Date(T0);
    const ctx = await setupOrg("pro");
    const res = await migration.convertSettings(ctx, { text: "Remise maximale : 20 %" });
    expect(res.rawInputKept).toBe(true);
    clock = new Date(T0.getTime() + 6 * 86_400_000);
    expect((await retentionTick(services, silent)).migration.rawInputsPurged).toBe(0);
    clock = new Date(T0.getTime() + 8 * 86_400_000);
    expect((await retentionTick(services, silent)).migration.rawInputsPurged).toBe(1);
    expect(await migration.getMigration(ctx, res.id)).toMatchObject({ rawInputKept: false, status: "draft" });
  });
});
