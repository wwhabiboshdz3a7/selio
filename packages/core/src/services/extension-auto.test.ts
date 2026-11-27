import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { CLOUD_CONSENT_VERSION, quotasForPlan } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { EmailMessage } from "@selio/email";
import type { OrgContext, Services } from "../context";
import * as automation from "./automation";
import * as cloud from "./cloud";
import * as ext from "./extension-auto";

/**
 * Automatisation complète par l'extension (D64) sur PostgreSQL : routage des tâches, décision de la prochaine
 * action par le serveur (toutes les barrières), comptes rendus (envoi confirmé, incertain, signal de Vinted).
 * Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core";
const APP_URL = process.env.TEST_CORE_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core";
const T0 = new Date("2026-11-27T09:00:00.000Z"); // vendredi, 10 h à Paris

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let sent: EmailMessage[] = [];
let seq = 0;

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
  } catch {
    available = false;
    return;
  }
  services = {
    db: new Db(createPool(APP_URL, { max: 4 })),
    ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }),
    secrets: new SecretBox(SecretBox.generateKey()),
    now: () => new Date(clock),
    allowAiFallback: false,
    version: "test",
    email: { send: async (m) => { sent.push(m); return { id: `mail-${sent.length}` }; } },
    publicWebUrl: "https://selio.example",
    config: { cloudInboxSyncMinutes: 10 },
  };
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

beforeEach(async () => {
  clock = new Date(T0);
  sent = [];
  if (available && services) await cloud.clearCircuit(services);
});

const advance = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); };
const rng0 = () => 0;

async function setupOrg(): Promise<{ ctx: OrgContext; connectionId: string }> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `ext-auto${n}-${Date.now()}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Ext ${n}`, slug: `org-ext-${n}-${Date.now()}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "active", quotas: quotasForPlan("pro") }));
  const ctx: OrgContext = { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.8" };
  const connectionId = `conn-ext-${n}-${Date.now()}`;
  await services.db.withOrg(ids.orgId, (tx) => repos.connections.create(tx, { id: connectionId, provider: "vinted", label: "Vinted test", status: "connected", usage: "sale" }));
  return { ctx, connectionId };
}

const ALL_DAY = { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" };
// L'activation crée déjà la règle de réponse (plein automatique) : elle est réglée pour le test si elle existe.
const addReplyRule = (ctx: OrgContext, requiresApproval = false) =>
  services.db.withOrg(ctx.orgId, async (tx) => {
    const fields = { name: "Réponse auto", kind: "reply_on_new_message" as const, enabled: true, requiresApproval, runsIn: "browser" as const, schedule: ALL_DAY, limits: { maxPerDay: 10, maxPerCustomerPerDay: 3, minMinutesBetweenActions: 0 }, config: { template: "Bien reçu {{prenom}}, je regarde." } };
    const existing = (await repos.rules.list(tx)).find((r) => r.kind === "reply_on_new_message");
    return existing ? repos.rules.update(tx, existing.id, fields) : repos.rules.create(tx, fields);
  });
const jobOf = (ctx: OrgContext, id: string) => services.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, id));
const inbox = (ref: string, body: string, at: string) => ({ listSource: "dom" as const, listed: 1, conversations: [{ ref, buyerHandle: "acheteur_ext", itemExternalRef: null, messages: [{ direction: "inbound" as const, body, at }] }] });

describe("automatisation complète par l'extension : routage (fonction pure)", () => {
  it("sans Cloud actif, réponses, négociation et situations partent vers le navigateur ; le Cloud passe avant ; les relances jamais", () => {
    for (const ruleKind of ["reply_on_new_message", "auto_negotiate", "keyword_situation"] as const) {
      expect(automation.decideRunsIn({ ruleKind, ruleRunsIn: "server", cloudAccount: null, extensionAuto: true })).toBe("browser");
      expect(automation.decideRunsIn({ ruleKind, ruleRunsIn: "server", cloudAccount: { status: "active", hasSession: true }, extensionAuto: true })).toBe("cloud");
    }
    expect(automation.decideRunsIn({ ruleKind: "follow_up_no_reply", ruleRunsIn: "server", cloudAccount: null, extensionAuto: true })).toBe("server");
    expect(automation.decideRunsIn({ ruleKind: "reply_on_new_message", ruleRunsIn: "server", cloudAccount: null, extensionAuto: false })).toBe("server");
  });
});

describe("automatisation complète par l'extension (PostgreSQL)", () => {
  it("interrupteur : refusé sans l'accord courant ; un seul compte à la fois ; coupé, les envois en file redeviennent à valider", async () => {
    if (!available) return;
    const { ctx, connectionId } = await setupOrg();
    await expect(ext.setAuto(ctx, { connectionId, enabled: true })).rejects.toMatchObject({ code: "consent_required" });
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const second = `conn-ext-b-${Date.now()}`;
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id: second, provider: "vinted", label: "Vinted 2", status: "connected", usage: "sale" }));
    expect((await ext.setAuto(ctx, { connectionId, enabled: true })).connections.find((c) => c.connectionId === connectionId)).toMatchObject({ enabled: true });
    const state = await ext.setAuto(ctx, { connectionId: second, enabled: true });
    expect(state.connections.filter((c) => c.enabled).map((c) => c.connectionId)).toEqual([second]);
    // Lecture seule ou rôle sans gestion : refusé.
    await expect(ext.setAuto({ ...ctx, role: "viewer" }, { connectionId, enabled: true })).rejects.toBeTruthy();
  });

  it("de bout en bout : lecture (navigateur), réponse en file pour l'extension, envoi confirmé, rythme humain, journal « navigateur » sans texte", async () => {
    if (!available) return;
    const { ctx, connectionId } = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    await addReplyRule(ctx);
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "disabled" });
    await ext.setAuto(ctx, { connectionId, enabled: true });

    const first = await ext.nextAction(ctx);
    expect(first).toMatchObject({ action: "sync_inbox", inboxUrl: "https://www.vinted.fr/inbox", maxConversations: 5 });
    if (first.action !== "sync_inbox") return;
    // Une seule action à la fois.
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "busy" });
    const report = await ext.reportAction(ctx, { jobId: first.jobId, code: "ok", inbox: inbox("8801", "Bonjour, il est encore dispo ?", "2026-11-27T08:55:00.000Z") }, { rng: rng0 });
    expect(report.inbox).toMatchObject({ messagesIn: 1, jobsCreated: 1 });
    const reply = (await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}))).items.find((j) => j.kind === "automation.send_message")!;
    expect(reply).toMatchObject({ runsIn: "browser", status: "queued", payload: { extAuto: true, connectionId, cloudKind: "reply" } });

    // Délai humain : rien avant 3 min.
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "too_soon" });
    advance(4);
    const send = await ext.nextAction(ctx);
    // Plein automatique : validation IA coupée à l'activation, la réponse est rédigée par l'IA (fournisseur de test).
    expect(send).toMatchObject({ action: "send", jobId: reply.id, conversationUrl: "https://www.vinted.fr/inbox/8801", text: expect.stringMatching(/\S/) });
    if (send.action !== "send") return;
    await ext.reportAction(ctx, { jobId: send.jobId, code: "ok", sideEffects: "unknown", durationMs: 4200 }, { rng: rng0 });
    expect((await jobOf(ctx, reply.id)).status).toBe("succeeded");
    const actions = await services.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.listAll(tx, {}));
    expect(actions.map((a) => [a.kind, a.source, a.status, a.connectionId])).toEqual([["reply", "browser", "done", connectionId], ["sync_inbox", "browser", "done", connectionId]]);
    expect(JSON.stringify(actions)).not.toMatch(/encore dispo|Bien reçu|acheteur_ext/);
    const conv = await services.db.withOrg(ctx.orgId, async (tx) => repos.messages.forConversation(tx, (await repos.conversations.byExternalRef(tx, "vinted", "8801"))!.id));
    expect(conv.map((m) => [m.direction, m.status])).toEqual([["inbound", "received"], ["outbound", "sent"]]);
    // Après l'envoi : délai humain, puis la lecture suivante n'arrive qu'après l'intervalle.
    advance(4);
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "idle" });
    advance(4);
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "sync_inbox" });
  });

  it("barrières du serveur : arrêt global, heures actives, coupe-circuit, et extension absente depuis longtemps (routage normal)", async () => {
    if (!available) return;
    const { ctx, connectionId } = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    await ext.setAuto(ctx, { connectionId, enabled: true });
    await automation.setGlobalPause(ctx, true);
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "global_pause" });
    await automation.setGlobalPause(ctx, false);
    clock = new Date("2026-11-28T02:00:00.000Z");
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "outside_active_hours" });
    clock = new Date(T0);
    await cloud.tripCircuit(services, "blocked", clock);
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "machine_paused" });
    await cloud.clearCircuit(services);
    // Extension plus vue depuis 31 min : une nouvelle réponse suit le chemin habituel (validation, pas d'envoi automatique).
    await addReplyRule(ctx, true);
    await services.db.withOrg(ctx.orgId, (tx) => repos.extensionAutos.upsert(tx, connectionId, { lastSeenAt: new Date(clock.getTime() - 31 * 60_000).toISOString() }));
    const conv = await services.db.withOrg(ctx.orgId, async (tx) => {
      const customer = await repos.customers.create(tx, { displayName: "Paul", handle: `paul${seq}`, provider: "vinted" });
      const c = await repos.conversations.create(tx, { customerId: customer.id, connectionId, provider: "vinted", externalRef: "8811", unreadCount: 1 });
      await repos.messages.create(tx, { conversationId: c.id, direction: "inbound", source: "buyer", status: "received", body: "Bonjour" });
      return c;
    });
    const rules = await services.db.withOrg(ctx.orgId, (tx) => repos.rules.list(tx));
    await services.db.withOrg(ctx.orgId, (tx) => automation.runRuleTx(ctx, tx, rules.find((r) => r.kind === "reply_on_new_message")!));
    const job = (await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}))).items.find((j) => j.payload.conversationId === conv.id)!;
    expect(job).toMatchObject({ runsIn: "browser", status: "awaiting_approval" });
    expect(job.payload.extAuto).toBeUndefined();
  });

  it("CAPTCHA vu par l'extension : pause, email aux propriétaires, rien de retenté ; reprise acquittée seulement", async () => {
    if (!available) return;
    const { ctx, connectionId } = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    await ext.setAuto(ctx, { connectionId, enabled: true });
    const sync = await ext.nextAction(ctx);
    if (sync.action !== "sync_inbox") throw new Error("lecture attendue");
    const r = await ext.reportAction(ctx, { jobId: sync.jobId, code: "captcha" });
    expect(r).toMatchObject({ paused: true, inbox: null });
    expect(sent.at(-1)?.subject).toMatch(/automatisation complète en pause/);
    advance(30);
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "paused" });
    // Un second compte rendu de la même action est refusé (rien n'est rejoué).
    await expect(ext.reportAction(ctx, { jobId: sync.jobId, code: "ok" })).rejects.toMatchObject({ code: "conflict" });
    await expect(ext.resumeAuto(ctx, { connectionId })).rejects.toMatchObject({ code: "acknowledge_required" });
    await ext.resumeAuto(ctx, { connectionId, acknowledge: true });
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "sync_inbox" });
  });

  it("envoi : clic sans confirmation → échec, jamais renvoyé ; rien cliqué → remis en file ; dernier message du vendeur → rien envoyé", async () => {
    if (!available) return;
    const { ctx, connectionId } = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    await addReplyRule(ctx);
    await ext.setAuto(ctx, { connectionId, enabled: true });
    const sync = await ext.nextAction(ctx);
    if (sync.action !== "sync_inbox") throw new Error("lecture attendue");
    await ext.reportAction(ctx, { jobId: sync.jobId, code: "ok", inbox: { listSource: "dom", conversations: [
      { ref: "8901", buyerHandle: "a_test", itemExternalRef: null, messages: [{ direction: "inbound", body: "Salut", at: "2026-11-27T08:50:00.000Z" }] },
      { ref: "8902", buyerHandle: "b_test", itemExternalRef: null, messages: [{ direction: "inbound", body: "Hello", at: "2026-11-27T08:51:00.000Z" }] },
    ] } }, { rng: rng0 });
    advance(4);
    const s1 = await ext.nextAction(ctx);
    if (s1.action !== "send") throw new Error("envoi attendu");
    await ext.reportAction(ctx, { jobId: s1.jobId, code: "timeout", sideEffects: "unknown" }, { rng: rng0 });
    expect(await jobOf(ctx, s1.jobId)).toMatchObject({ status: "failed" });
    advance(4);
    const s2 = await ext.nextAction(ctx);
    if (s2.action !== "send") throw new Error("envoi attendu");
    expect(s2.jobId).not.toBe(s1.jobId);
    // Navigateur déconnecté de Vinted, rien cliqué : la tâche est remise en file, l'extension attend 30 min.
    await ext.reportAction(ctx, { jobId: s2.jobId, code: "not_logged_in", sideEffects: "none" }, { rng: rng0 });
    expect(await jobOf(ctx, s2.jobId)).toMatchObject({ status: "queued" });
    expect(await ext.nextAction(ctx)).toMatchObject({ action: "wait", reason: "too_soon" });
    // Le vendeur répond lui-même entre-temps : la réponse remise en file n'est jamais envoyée.
    const convId = (await jobOf(ctx, s2.jobId)).payload.conversationId as string;
    await services.db.withOrg(ctx.orgId, (tx) => repos.messages.create(tx, { conversationId: convId, direction: "outbound", source: "user", status: "sent", body: "Je réponds moi-même.", sentAt: clock.toISOString() }));
    advance(31);
    const next = await ext.nextAction(ctx);
    expect(next.action).not.toBe("send");
    expect(await jobOf(ctx, s2.jobId)).toMatchObject({ status: "skipped", result: { reason: "already_answered" } });
    expect(await jobOf(ctx, s1.jobId)).toMatchObject({ status: "failed" });
  });
});
