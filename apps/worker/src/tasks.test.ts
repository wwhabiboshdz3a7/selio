import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, SecretBox, createPool, runMigrations, MIGRATIONS_DIR, repos, hashPassword } from "@selio/db";
import { createAIService } from "@selio/ai";
import type { Services } from "@selio/core";
import { automationTick, processJobs, retentionTick, systemContext } from "./tasks";
import { messaging } from "@selio/core";

const OWNER_URL = process.env.TEST_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker";
const APP_URL = process.env.TEST_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker";
let services: Services;
let available = true;
let orgId = "";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  const owner = createPool(OWNER_URL, { max: 1 });
  try {
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  } finally {
    await owner.end();
  }
  services = { db: new Db(createPool(APP_URL, { max: 2 })), ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }), secrets: new SecretBox(SecretBox.generateKey()), now: () => new Date(), allowAiFallback: false, version: "test" };
  const { hash, salt } = await hashPassword("x".repeat(12));
  orgId = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: "w@test.local", displayName: "W", passwordHash: hash, passwordSalt: salt });
    const o = await repos.orgs.create(tx, { name: "Org W", slug: "org-w", settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return o.id;
  });
});

afterAll(async () => { await services?.db.close(); });

describe("worker", () => {
  it("évalue les règles de toutes les organisations et exécute les tâches échues", async () => {
    if (!available) return;
    const ctx = systemContext(services, orgId);
    await services.db.withOrg(orgId, async (tx) => {
      await repos.connections.create(tx, { id: "c-demo", provider: "demo", label: "Simu", status: "connected", capabilities: [{ capability: "send_message", state: "available", note: "" }, { capability: "read_conversations", state: "available", note: "" }], transport: "simulator" });
      await repos.rules.create(tx, { name: "Accusé", kind: "reply_on_new_message", enabled: true, requiresApproval: false, runsIn: "server", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" }, limits: { maxPerDay: 5, maxPerCustomerPerDay: 2, minMinutesBetweenActions: 0 }, config: { template: "Bien reçu {{prenom}}" } });
    });
    await messaging.simulateIncoming(ctx, null, "Bonjour, dispo ?");
    const r1 = await automationTick(services, silent);
    expect(r1.created).toBe(1);
    const r2 = await automationTick(services, silent);
    expect(r2.created).toBe(0);
    const jobs = await services.db.withOrg(orgId, (tx) => repos.jobs.list(tx, {}));
    expect(jobs.items[0]?.status).toBe("succeeded");
    expect(await processJobs(services, silent)).toBe(0);
    const clean = await retentionTick(services);
    expect(clean.orgs).toBe(1);
  });
});
