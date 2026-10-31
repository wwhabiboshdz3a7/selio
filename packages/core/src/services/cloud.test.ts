import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { CLOUD_ACTIVE_HOURS_DEFAULT, CLOUD_CIRCUIT_BREAKER_MINUTES, CLOUD_CONSENT_VERSION, CLOUD_LOGIN_TTL_MINUTES, CLOUD_MAX_ACTIONS_PER_HOUR, CLOUD_MAX_LOGIN_WINDOWS_PER_ORG, PLAN_QUOTAS, quotasForPlan, type CloudAccount, type Plan, type PlanQuotas } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { EmailMessage } from "@selio/email";
import type { OrgContext, Services } from "../context";
import * as automation from "./automation";
import * as cloud from "./cloud";
import * as connections from "./connections";

/**
 * Selio Cloud de bout en bout sur PostgreSQL (base dédiée selio_test_core, créée si besoin) avec un
 * exécuteur factice et une horloge injectée. Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core";
const APP_URL = process.env.TEST_CORE_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core";

const SECRET_COOKIE = "SESSION-SECRET-VALEUR-123";
const MESSAGE_TEXT = "Bonjour, il est toujours disponible, je peux l'envoyer demain.";
const T0 = new Date("2026-10-29T09:00:00.000Z"); // jeudi, 10 h à Paris (heures actives)

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
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
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
  if (services) services.config = {};
  // Le coupe-circuit est global à la machine (table cloud_runtime) : remis à zéro entre deux tests.
  if (available && services) await cloud.clearCircuit(services);
});

const rng0 = () => 0;
const run = (orgId: string, executor: cloud.CloudExecutor) => cloud.runDueCloudJobs(services, orgId, executor, { rng: rng0 });
const advance = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); };

async function setupOrg(plan: Plan = "agence", quotas?: PlanQuotas): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `cloud${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Cloud ${n}`, slug: `org-cloud-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotas ?? quotasForPlan(plan) }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.7" };
}

async function addConnection(ctx: OrgContext, label = "Vinted principal"): Promise<string> {
  const id = `conn-${++seq}`;
  await services.db.withOrg(ctx.orgId, (tx) => repos.connections.create(tx, { id, provider: "vinted", label, status: "connected", usage: "sale" }));
  return id;
}

async function addConversation(ctx: OrgContext, connectionId: string, externalRef: string | null = String(4_000_000 + ++seq)): Promise<{ conversationId: string; customerId: string }> {
  return services.db.withOrg(ctx.orgId, async (tx) => {
    const customer = await repos.customers.create(tx, { displayName: "Léa Martin", handle: `lea${seq}`, provider: "vinted" });
    const conv = await repos.conversations.create(tx, { customerId: customer.id, connectionId, provider: "vinted", externalRef, unreadCount: 1, lastMessagePreview: "Dispo ?" });
    await repos.messages.create(tx, { conversationId: conv.id, direction: "inbound", source: "buyer", status: "received", body: "Bonjour, toujours dispo ?" });
    return { conversationId: conv.id, customerId: customer.id };
  });
}

const vintedState = () => ({
  cookies: [
    { name: "_vinted_fr_session", value: SECRET_COOKIE, domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "NID", value: "cookie-google", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" },
  ],
  origins: [
    { origin: "https://www.vinted.fr", localStorage: [{ name: "vinted_prefs", value: "fr" }] },
    { origin: "https://accounts.google.com", localStorage: [{ name: "jeton", value: "google" }] },
  ],
});

/** Accord, activation, fenêtre de connexion et session enregistrée : compte « actif ». */
async function activeAccount(ctx: OrgContext, connectionId?: string): Promise<CloudAccount> {
  const conn = connectionId ?? (await addConnection(ctx));
  await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
  const account = await cloud.enableAccount(ctx, conn);
  const ticket = await cloud.startLogin(ctx, account.id);
  return cloud.completeLogin(services, ticket.loginSessionId, vintedState());
}

async function addCloudJob(ctx: OrgContext, account: CloudAccount, conv: { conversationId: string; customerId: string }, extra: { kind?: string; createdAt?: string; body?: string } = {}): Promise<string> {
  return services.db.withOrg(ctx.orgId, async (tx) => {
    const job = await repos.jobs.create(tx, {
      kind: "automation.send_message", status: "queued", dedupeKey: `cloud-test:${++seq}`, runsIn: "cloud", scheduledFor: clock.toISOString(),
      payload: { conversationId: conv.conversationId, customerId: conv.customerId, cloudAccountId: account.id, cloudKind: extra.kind ?? "reply", body: extra.body ?? MESSAGE_TEXT, ruleName: "Réponse auto" },
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    });
    return job.id;
  });
}

const jobOf = (ctx: OrgContext, id: string) => services.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, id));
const accountOf = (ctx: OrgContext, id: string) => services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, id));
const actionsOf = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.listAll(tx, {}));
const auditOf = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.audit.list(tx, 500));
const decryptSession = async (ctx: OrgContext, accountId: string) => {
  const blob = await services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.session(tx, accountId));
  return blob ? (JSON.parse(services.secrets.decrypt(blob, accountId)) as { cookies: { name: string; value: string; domain: string }[]; origins: { origin: string }[] }) : null;
};

// ---------------------------------------------------------------- fonctions pures

describe("Selio Cloud : planification (fonction pure)", () => {
  const base: cloud.PlanAccountRunInput = {
    account: { status: "active", hasSession: true, settings: { levels: ["light"] } },
    consentOk: true, globalPaused: false, available: true, heavyActionsEnabled: false,
    quotas: { automationActionsPerDay: 2000 }, actionsToday: 0, actionsLastHour: 0, lastActionAt: null,
    now: T0, activeHours: { ...CLOUD_ACTIVE_HOURS_DEFAULT, timezone: "Europe/Paris" },
  };

  it("agit quand tout est réuni", () => {
    expect(cloud.planAccountRun(base)).toEqual({ act: true, reason: "ok" });
  });

  it("refuse sans accord, en pause globale, hors offre, compte inactif ou sans session", () => {
    expect(cloud.planAccountRun({ ...base, consentOk: false })).toEqual({ act: false, reason: "no_consent" });
    expect(cloud.planAccountRun({ ...base, globalPaused: true, consentOk: false })).toEqual({ act: false, reason: "global_pause" });
    expect(cloud.planAccountRun({ ...base, available: false })).toEqual({ act: false, reason: "plan_unavailable" });
    expect(cloud.planAccountRun({ ...base, account: { ...base.account, status: "paused" } })).toEqual({ act: false, reason: "account_not_active" });
    expect(cloud.planAccountRun({ ...base, account: { ...base.account, hasSession: false } })).toEqual({ act: false, reason: "no_session" });
  });

  it("coupe-circuit de la machine et compte au-delà du nombre de comptes de l'offre : refusés", () => {
    expect(cloud.planAccountRun({ ...base, machinePaused: true })).toEqual({ act: false, reason: "machine_paused" });
    expect(cloud.planAccountRun({ ...base, globalPaused: true, machinePaused: true })).toEqual({ act: false, reason: "global_pause" });
    expect(cloud.planAccountRun({ ...base, withinAccountLimit: false })).toEqual({ act: false, reason: "over_account_limit" });
    const accounts = [
      { id: "c", status: "active" as const, createdAt: "2026-10-03T00:00:00.000Z" },
      { id: "a", status: "active" as const, createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "s", status: "stopped" as const, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "b", status: "paused" as const, createdAt: "2026-10-02T00:00:00.000Z" },
    ];
    expect([...cloud.accountsWithinLimit(accounts, 2)].sort()).toEqual(["a", "b"]);
    expect(cloud.accountsWithinLimit(accounts, 0).size).toBe(0);
  });

  it("actions lourdes : refusées tant que CLOUD_HEAVY_ACTIONS est faux, puis selon les niveaux du compte", () => {
    expect(cloud.planAccountRun({ ...base, level: "heavy" })).toEqual({ act: false, reason: "heavy_disabled" });
    expect(cloud.planAccountRun({ ...base, level: "heavy", heavyActionsEnabled: true })).toEqual({ act: false, reason: "level_not_allowed" });
    expect(cloud.planAccountRun({ ...base, level: "heavy", heavyActionsEnabled: true, account: { ...base.account, settings: { levels: ["light", "heavy"] } } }).act).toBe(true);
  });

  it("jamais hors des heures actives (8 h – 23 h, fuseau de l'organisation)", () => {
    expect(CLOUD_ACTIVE_HOURS_DEFAULT).toMatchObject({ startHour: 8, endHour: 23 });
    expect(cloud.planAccountRun({ ...base, now: new Date("2026-10-29T21:30:00.000Z") }).act).toBe(true); // 22 h 30 à Paris
    expect(cloud.planAccountRun({ ...base, now: new Date("2026-10-29T22:30:00.000Z") })).toEqual({ act: false, reason: "outside_active_hours" });
    expect(cloud.planAccountRun({ ...base, now: new Date("2026-10-29T06:30:00.000Z") })).toEqual({ act: false, reason: "outside_active_hours" });
    expect(cloud.planAccountRun({ ...base, now: new Date("2026-10-29T07:05:00.000Z") }).act).toBe(true); // 8 h 05 à Paris
  });

  it("plafonds : journalier (offre), horaire (rythme humain), délai minimal plus aléa", () => {
    expect(cloud.planAccountRun({ ...base, quotas: { automationActionsPerDay: 5 }, actionsToday: 5 })).toEqual({ act: false, reason: "daily_limit" });
    expect(cloud.planAccountRun({ ...base, quotas: { automationActionsPerDay: 5 }, actionsToday: 4 }).act).toBe(true);
    expect(cloud.planAccountRun({ ...base, actionsLastHour: CLOUD_MAX_ACTIONS_PER_HOUR })).toEqual({ act: false, reason: "hourly_limit" });
    expect(cloud.planAccountRun({ ...base, lastActionAt: new Date(T0.getTime() - 2 * 60_000) })).toEqual({ act: false, reason: "too_soon" });
    expect(cloud.planAccountRun({ ...base, lastActionAt: new Date(T0.getTime() - 4 * 60_000) }).act).toBe(true);
    expect(cloud.planAccountRun({ ...base, lastActionAt: new Date(T0.getTime() - 4 * 60_000).toISOString(), jitterMinutes: 3 })).toEqual({ act: false, reason: "too_soon" });
  });

  it("disponibilité selon l'offre : Agence compris, Pro en option (prix à décider), Starter et accès de base indisponibles", () => {
    const off = cloud.cloudSettings({ config: {} });
    expect(off).toEqual({ heavyActions: false, maxAccountsPerOrg: 10, maxBrowsers: 5, proOption: false });
    const agence = cloud.cloudAvailabilityFor("agence", PLAN_QUOTAS.agence, off);
    expect(agence).toMatchObject({ included: true, optional: false, available: true, maxAccounts: 10, actionsPerDay: 2000, heavyActionsEnabled: false, maxBrowsers: 5 });
    expect(agence.capacityNote).toMatch(/hypothèse à mesurer/);
    const pro = cloud.cloudAvailabilityFor("pro", PLAN_QUOTAS.pro, off);
    expect(pro).toMatchObject({ included: false, optional: true, available: false, maxAccounts: 0 });
    expect(pro.reason).toMatch(/option.*prix à décider/);
    expect(cloud.cloudAvailabilityFor("pro", PLAN_QUOTAS.pro, { ...off, proOption: true })).toMatchObject({ available: true, maxAccounts: 3 });
    for (const plan of ["starter", "free"] as const) expect(cloud.cloudAvailabilityFor(plan, PLAN_QUOTAS[plan], { ...off, proOption: true })).toMatchObject({ available: false, optional: false });
    expect(cloud.cloudConfigFromEnv({ CLOUD_HEAVY_ACTIONS: "true", CLOUD_MAX_ACCOUNTS_PER_ORG: "4", CLOUD_MAX_BROWSERS: "abc" })).toEqual({ cloudHeavyActions: true, cloudMaxAccountsPerOrg: 4, cloudMaxBrowsers: 5, cloudProOption: false });
  });

  it("URL de conversation : référence numérique, hôte vinted.* seulement", () => {
    expect(cloud.vintedConversationUrl("123456")).toBe("https://www.vinted.fr/inbox/123456");
    expect(cloud.vintedConversationUrl("123456", "www.vinted.be")).toBe("https://www.vinted.be/inbox/123456");
    expect(cloud.vintedConversationUrl("123456", "evil.com")).toBe("https://www.vinted.fr/inbox/123456");
    // Domaine qui ressemble à Vinted sans en être un (liste fermée) : jamais utilisé.
    expect(cloud.vintedConversationUrl("123456", "x.vinted.lol")).toBe("https://www.vinted.fr/inbox/123456");
    expect(cloud.vintedConversationUrl("../admin")).toBeNull();
    expect(cloud.vintedConversationUrl(null)).toBeNull();
  });

  it("accord : empreinte du texte courant, version obligatoire", () => {
    expect(cloud.cloudConsentTextHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(cloud.isConsentCurrent({ version: CLOUD_CONSENT_VERSION, textHash: cloud.cloudConsentTextHash() })).toBe(true);
    expect(cloud.isConsentCurrent({ version: "2020-01-01.1", textHash: cloud.cloudConsentTextHash() })).toBe(false);
    expect(cloud.isConsentCurrent({ version: CLOUD_CONSENT_VERSION, textHash: cloud.cloudConsentTextHash("autre texte") })).toBe(false);
    expect(cloud.isConsentCurrent(null)).toBe(false);
  });
});

// ---------------------------------------------------------------- base de données

describe("Selio Cloud : accord, comptes et session (PostgreSQL)", () => {
  it("pas d'activation sans accord ; l'accord enregistre version, empreinte, date, utilisateur et IP", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const conn = await addConnection(ctx);
    await expect(cloud.enableAccount(ctx, conn)).rejects.toMatchObject({ code: "consent_required" });
    await expect(cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: false })).rejects.toMatchObject({ code: "validation" });
    await expect(cloud.acceptConsent(ctx, { version: "2020-01-01.1", accepted: true })).rejects.toMatchObject({ code: "conflict" });
    const view = await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    expect(view.current).toBe(true);
    expect(view.accepted).toMatchObject({ userId: ctx.userId, version: CLOUD_CONSENT_VERSION, textHash: cloud.cloudConsentTextHash(), acceptedAt: T0.toISOString(), ip: "203.0.113.7" });
    const account = await cloud.enableAccount(ctx, conn);
    expect(account).toMatchObject({ status: "needs_login", hasSession: false });
    // Idempotent : réactiver le même compte rend le même compte.
    expect((await cloud.enableAccount(ctx, { connectionId: conn })).id).toBe(account.id);
    // Un lecteur ne peut rien activer.
    await expect(cloud.enableAccount({ ...ctx, role: "viewer" }, conn)).rejects.toMatchObject({ code: "forbidden" });
    expect((await auditOf(ctx)).map((a) => a.action)).toEqual(expect.arrayContaining(["cloud.consent.accepted", "cloud.account.enabled"]));
  });

  it("offre : rien d'activable en Starter ; Pro en option seulement si CLOUD_PRO_OPTION l'ouvre", async () => {
    if (!available) return;
    const starter = await setupOrg("starter");
    await cloud.acceptConsent(starter, { version: CLOUD_CONSENT_VERSION, accepted: true });
    await expect(cloud.enableAccount(starter, await addConnection(starter))).rejects.toMatchObject({ code: "cloud_unavailable", status: 402 });
    const pro = await setupOrg("pro");
    await cloud.acceptConsent(pro, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const conn = await addConnection(pro);
    const err = await cloud.enableAccount(pro, conn).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "cloud_unavailable" });
    expect((err as Error).message).toMatch(/prix à décider/);
    services.config = { cloudProOption: true };
    expect((await cloud.enableAccount(pro, conn)).status).toBe("needs_login");
    expect((await cloud.availability(pro)).reason).toMatch(/rien n'est facturé/);
  });

  it("onzième compte refusé (10 au plus par organisation)", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    for (let i = 0; i < 10; i++) await cloud.enableAccount(ctx, await addConnection(ctx, `Compte ${i + 1}`));
    await expect(cloud.enableAccount(ctx, await addConnection(ctx, "Compte 11"))).rejects.toMatchObject({ code: "quota_exceeded" });
    // Un compte arrêté libère une place.
    const [first] = await cloud.listAccounts(ctx);
    await cloud.stop(ctx, first!.id);
    expect((await cloud.enableAccount(ctx, await addConnection(ctx, "Compte 12"))).status).toBe("needs_login");
  });

  it("compte Perso ou déconnecté : jamais activé", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const perso = await addConnection(ctx, "Perso");
    await services.db.withOrg(ctx.orgId, (tx) => repos.connections.update(tx, perso, { usage: "personal" }));
    await expect(cloud.enableAccount(ctx, perso)).rejects.toMatchObject({ code: "validation" });
  });

  it("fenêtre de connexion : ticket rendu une fois et haché, session limitée à vinted.* et chiffrée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const conn = await addConnection(ctx);
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, conn);
    const ticket = await cloud.startLogin(ctx, account.id);
    expect(ticket.ticket.length).toBeGreaterThanOrEqual(40);
    expect(ticket.expiresAt).toBe(new Date(T0.getTime() + CLOUD_LOGIN_TTL_MINUTES * 60_000).toISOString());
    expect(CLOUD_LOGIN_TTL_MINUTES).toBe(5);
    const raw = await owner.query("select row_to_json(t)::text as j from cloud_login_sessions t where id = $1", [ticket.loginSessionId]);
    expect(raw.rows[0].j).not.toContain(ticket.ticket);
    expect(await cloud.findLoginByTicket(services, ticket.ticket)).toMatchObject({ loginSessionId: ticket.loginSessionId, orgId: ctx.orgId, accountId: account.id });
    expect(await cloud.findLoginByTicket(services, "x".repeat(43))).toBeNull();
    // Une session sans cookie Vinted est refusée.
    await expect(cloud.completeLogin(services, ticket.loginSessionId, { cookies: [{ name: "NID", value: "g", domain: ".google.com" }] })).rejects.toMatchObject({ code: "validation" });
    const active = await cloud.completeLogin(services, ticket.loginSessionId, vintedState());
    expect(active).toMatchObject({ status: "active", hasSession: true, sessionSavedAt: T0.toISOString() });
    expect(JSON.stringify(active)).not.toContain(SECRET_COOKIE);
    // En base : bloc chiffré, illisible sans la clé et lié au compte (données associées).
    const stored = await owner.query("select session_ciphertext from cloud_accounts where id = $1", [account.id]);
    expect(Buffer.from(stored.rows[0].session_ciphertext).toString("utf8")).not.toContain(SECRET_COOKIE);
    expect(() => services.secrets.decrypt(stored.rows[0].session_ciphertext, "autre-compte")).toThrow();
    const session = await decryptSession(ctx, account.id);
    expect(session?.cookies.map((c) => c.name)).toEqual(["_vinted_fr_session"]);
    expect(session?.origins.map((o) => o.origin)).toEqual(["https://www.vinted.fr"]);
    // La fenêtre ne sert qu'une fois ; une fenêtre expirée est refusée.
    await expect(cloud.completeLogin(services, ticket.loginSessionId, vintedState())).rejects.toMatchObject({ code: "conflict" });
    expect(await cloud.findLoginByTicket(services, ticket.ticket)).toBeNull();
    const late = await cloud.startLogin(ctx, account.id);
    advance(16);
    await expect(cloud.completeLogin(services, late.loginSessionId, vintedState())).rejects.toMatchObject({ code: "login_expired" });
    const audit = await auditOf(ctx);
    expect(audit.find((a) => a.action === "cloud.login.completed")?.meta).toEqual({ loginSessionId: ticket.loginSessionId, cookies: 1, origins: 1 });
  });

  it("actions lourdes refusées par défaut ; ouvertes seulement par CLOUD_HEAVY_ACTIONS", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    await expect(cloud.updateSettings(ctx, account.id, { levels: ["light", "heavy"] })).rejects.toMatchObject({ code: "heavy_disabled", status: 403 });
    expect((await cloud.availability(ctx)).heavyActionsEnabled).toBe(false);
    // Une tâche lourde arrivée en file malgré tout est écartée sans ouvrir le navigateur.
    const conv = await addConversation(ctx, account.connectionId);
    const jobId = await addCloudJob(ctx, account, conv, { kind: "republish" });
    const exec = new cloud.FakeCloudExecutor();
    const r = await run(ctx.orgId, exec);
    expect(exec.calls).toHaveLength(0);
    expect(r.skipped).toEqual([{ reason: "heavy_disabled", count: 1 }]);
    expect((await jobOf(ctx, jobId)).status).toBe("skipped");
    services.config = { cloudHeavyActions: true };
    expect((await cloud.updateSettings(ctx, account.id, { levels: ["light", "heavy"] })).settings.levels).toEqual(["light", "heavy"]);
  });

  it("arrêt : statut arrêté, session effacée, tâches en file annulées ; suppression de session en un clic", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId);
    const jobId = await addCloudJob(ctx, account, conv);
    const stopped = await cloud.stop(ctx, account.id);
    expect(stopped).toMatchObject({ status: "stopped", hasSession: false, sessionSavedAt: null });
    expect(await decryptSession(ctx, account.id)).toBeNull();
    expect((await jobOf(ctx, jobId)).status).toBe("cancelled");
    expect((await auditOf(ctx)).find((a) => a.action === "cloud.account.stopped")?.meta).toMatchObject({ reason: "client", sessionDeleted: true, cancelledJobs: 1 });
    // Suppression de session seule : le compte repasse « connexion à faire ».
    const other = await activeAccount(ctx);
    const cleared = await cloud.deleteSession(ctx, other.id);
    expect(cleared).toMatchObject({ status: "needs_login", hasSession: false });
    expect(await decryptSession(ctx, other.id)).toBeNull();
  });

  it("déconnexion du compte Vinted : le compte Cloud est arrêté et sa session effacée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    await connections.disconnectConnection(ctx, account.connectionId);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "stopped", hasSession: false });
    const again = await activeAccount(ctx);
    await connections.deleteConnection(ctx, again.connectionId);
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byConnection(tx, again.connectionId))).toBeNull();
  });
});

describe("Selio Cloud : exécution des tâches (exécuteur factice, horloge injectée)", () => {
  it("action réussie : message envoyé, journal sans secret ni texte, compteur « cloud.action », session rechiffrée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId, "987654321");
    const jobId = await addCloudJob(ctx, account, conv);
    const exec = new cloud.FakeCloudExecutor();
    const r = await run(ctx.orgId, exec);
    expect(r).toMatchObject({ executed: 1, done: 1, failed: 0, paused: [], needsLogin: [] });
    // L'exécuteur reçoit la session déchiffrée (vinted.* seulement) et l'action.
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]!.action).toEqual({ id: jobId, kind: "reply", level: "light", conversationUrl: "https://www.vinted.fr/inbox/987654321", text: MESSAGE_TEXT });
    expect(exec.calls[0]!.session?.cookies.map((c) => c.domain)).toEqual([".vinted.fr"]);
    const job = await jobOf(ctx, jobId);
    expect(job).toMatchObject({ status: "succeeded", attempts: 1 });
    const msgs = await services.db.withOrg(ctx.orgId, (tx) => repos.messages.forConversation(tx, conv.conversationId));
    expect(msgs.at(-1)).toMatchObject({ direction: "outbound", source: "automation", status: "sent", body: MESSAGE_TEXT, sentAt: T0.toISOString() });
    const [action] = await actionsOf(ctx);
    expect(action).toMatchObject({ kind: "reply", level: "light", status: "done", jobId, startedAt: T0.toISOString(), finishedAt: T0.toISOString() });
    expect(action!.detail).toEqual({ conversationRef: "987654321", conversationId: conv.conversationId, messageLength: MESSAGE_TEXT.length, ruleName: "Réponse auto", code: "ok", durationMs: 1200 });
    expect(await accountOf(ctx, account.id)).toMatchObject({ lastActionAt: T0.toISOString(), status: "active" });
    // Session rendue par l'exécuteur : rechiffrée et sauvegardée.
    expect((await decryptSession(ctx, account.id))?.cookies.map((c) => c.name)).toEqual(["_vinted_fr_session", "selio_fake_touch"]);
    // Ni le clair de la session ni le texte du message dans le journal, l'audit ou les compteurs.
    for (const table of ["cloud_actions", "audit_logs", "usage_events", "jobs"]) {
      const rows = await owner.query(`select row_to_json(t)::text as j from ${table} t where org_id = $1`, [ctx.orgId]);
      const dump = rows.rows.map((x: { j: string }) => x.j).join("\n");
      expect(dump, table).not.toContain(SECRET_COOKIE);
      expect(dump, table).not.toContain("selio_fake_touch");
      if (table !== "jobs") expect(dump, table).not.toContain(MESSAGE_TEXT);
    }
    const usage = await services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumSince(tx, "2000-01-01T00:00:00.000Z"));
    expect(usage["cloud.action"]).toBe(1);
    // Une tâche faite n'est jamais rejouée.
    advance(30);
    expect((await run(ctx.orgId, exec)).executed).toBe(0);
    expect(exec.calls).toHaveLength(1);
  });

  it("idempotence : deux passages simultanés n'exécutent la tâche qu'une fois ; une seule action par compte et par passage", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId);
    const first = await addCloudJob(ctx, account, conv);
    const second = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const exec = new cloud.FakeCloudExecutor();
    const slow = new cloud.FakeCloudExecutor().enqueue(async (input) => { await new Promise((r) => setTimeout(r, 150)); return exec.run(input); });
    const [a, b] = await Promise.all([run(ctx.orgId, slow), run(ctx.orgId, exec)]);
    expect(a.executed + b.executed).toBe(1);
    expect(exec.calls).toHaveLength(1);
    expect((await jobOf(ctx, first)).status).toBe("succeeded");
    expect((await jobOf(ctx, second)).status).toBe("queued");
    // Passage suivant, après le délai humain : la seconde tâche part.
    advance(10);
    expect((await run(ctx.orgId, exec)).done).toBe(1);
    expect((await jobOf(ctx, second)).status).toBe("succeeded");
    expect(exec.calls.map((c) => c.action.id)).toEqual([first, second]);
  });

  it("pas d'action sans accord valide pour la version courante, ni pendant l'arrêt global", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const jobId = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    // Accord plus récent mais d'une ancienne version du texte : il ne vaut pas.
    await services.db.withOrg(ctx.orgId, (tx) => repos.cloudConsents.add(tx, { userId: ctx.userId, version: "2020-01-01.1", textHash: "0".repeat(64), acceptedAt: new Date(T0.getTime() + 1000).toISOString(), ip: null }));
    const exec = new cloud.FakeCloudExecutor();
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "no_consent", count: 1 }]);
    expect(exec.calls).toHaveLength(0);
    expect((await jobOf(ctx, jobId)).status).toBe("queued");
    advance(1);
    await services.db.withOrg(ctx.orgId, (tx) => repos.cloudConsents.add(tx, { userId: ctx.userId, version: CLOUD_CONSENT_VERSION, textHash: cloud.cloudConsentTextHash(), acceptedAt: clock.toISOString(), ip: null }));
    await services.db.withOrg(ctx.orgId, (tx) => repos.automationState.set(tx, true));
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "global_pause", count: 1 }]);
    await services.db.withOrg(ctx.orgId, (tx) => repos.automationState.set(tx, false));
    expect((await run(ctx.orgId, exec)).done).toBe(1);
  });

  it("pas d'action hors des heures actives", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const jobId = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    clock = new Date("2026-10-29T22:30:00.000Z"); // 23 h 30 à Paris
    const exec = new cloud.FakeCloudExecutor();
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "outside_active_hours", count: 1 }]);
    expect(exec.calls).toHaveLength(0);
    expect((await jobOf(ctx, jobId)).status).toBe("queued");
  });

  it("plafonds horaire (rythme humain) et journalier (offre)", async () => {
    if (!available) return;
    const ctx = await setupOrg("agence", { ...PLAN_QUOTAS.agence, automationActionsPerDay: 13 });
    const account = await activeAccount(ctx);
    await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    // 12 actions dans l'heure pour ce compte : plafond horaire.
    await services.db.withOrg(ctx.orgId, async (tx) => {
      for (let i = 0; i < CLOUD_MAX_ACTIONS_PER_HOUR; i++) {
        const at = new Date(T0.getTime() - (50 - i) * 60_000).toISOString();
        await repos.cloudActions.add(tx, { accountId: account.id, kind: "reply", level: "light", status: "done", startedAt: at, createdAt: at });
      }
    });
    const exec = new cloud.FakeCloudExecutor();
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "hourly_limit", count: 1 }]);
    // Une heure plus tard, plus de plafond horaire ; une 13e action dans la journée atteint le plafond de l'offre.
    advance(60);
    await services.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.add(tx, { accountId: account.id, kind: "reply", level: "light", status: "failed", startedAt: clock.toISOString(), createdAt: clock.toISOString() }));
    advance(10);
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "daily_limit", count: 1 }]);
    expect(exec.calls).toHaveLength(0);
  });

  it("CAPTCHA : compte en pause avec la raison, email au propriétaire, aucune nouvelle tentative ; reprise sur acquittement", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId);
    const jobId = await addCloudJob(ctx, account, conv);
    const exec = new cloud.FakeCloudExecutor().enqueue({ ok: false, code: "captcha", message: "captcha", sideEffects: "none", durationMs: 800 });
    const r = await run(ctx.orgId, exec);
    expect(r).toMatchObject({ executed: 1, done: 0, paused: [account.id] });
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "captcha", pausedAt: T0.toISOString(), warningsCount: 1, hasSession: true });
    // Rien n'a été envoyé : la tâche attend (« paused »), le message en cours est retiré.
    const job = await jobOf(ctx, jobId);
    expect(job).toMatchObject({ status: "queued" });
    expect(job.result).toMatchObject({ cloud: "paused", code: "captcha" });
    const msgs = await services.db.withOrg(ctx.orgId, (tx) => repos.messages.forConversation(tx, conv.conversationId));
    expect(msgs.filter((m) => m.direction === "outbound")).toHaveLength(0);
    const [action] = await actionsOf(ctx);
    expect(action).toMatchObject({ status: "paused", detail: { code: "captcha", sideEffects: "none" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe((await services.db.withGlobal((tx) => repos.users.byId(tx, ctx.userId))).email);
    expect(sent[0]!.subject).toMatch(/en pause/);
    expect(sent[0]!.text).toMatch(/CAPTCHA/);
    expect(sent[0]!.text).toMatch(/n'a rien retenté/);
    expect(sent[0]!.text).toContain("https://selio.example/cloud");
    expect((await auditOf(ctx)).find((a) => a.action === "cloud.account.paused")?.meta).toMatchObject({ reason: "captcha", automatic: true });
    // Passages suivants : aucune nouvelle tentative tant que le client n'a pas repris.
    for (let i = 0; i < 3; i++) {
      advance(15);
      expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "account_not_active", count: 1 }]);
    }
    expect(exec.calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    // Reprise : refusée sans acquittement explicite.
    await expect(cloud.resume(ctx, account.id)).rejects.toMatchObject({ code: "acknowledge_required" });
    await expect(cloud.resume(ctx, account.id, { acknowledge: false })).rejects.toMatchObject({ code: "acknowledge_required" });
    expect(await cloud.resume(ctx, account.id, { acknowledge: true })).toMatchObject({ status: "active", pausedReason: null });
    expect((await auditOf(ctx)).find((a) => a.action === "cloud.account.resumed")?.meta).toMatchObject({ previousReason: "captcha", acknowledged: true });
  });

  it("CAPTCHA après le clic (effet incertain) : tâche en échec, jamais renvoyée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId);
    const jobId = await addCloudJob(ctx, account, conv);
    const exec = new cloud.FakeCloudExecutor().enqueue({ ok: false, code: "warning", message: "avertissement", sideEffects: "unknown" });
    await run(ctx.orgId, exec);
    expect(await jobOf(ctx, jobId)).toMatchObject({ status: "failed" });
    expect((await jobOf(ctx, jobId)).error).toMatch(/vérifiez dans Vinted/);
    const out = (await services.db.withOrg(ctx.orgId, (tx) => repos.messages.forConversation(tx, conv.conversationId))).filter((m) => m.direction === "outbound");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "failed" });
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "warning" });
  });

  it("session refusée par Vinted (not_logged_in) : connexion à refaire, session effacée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const jobId = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const exec = new cloud.FakeCloudExecutor().enqueue({ ok: false, code: "not_logged_in", message: "connexion requise", sideEffects: "none", session: vintedState() });
    const r = await run(ctx.orgId, exec);
    expect(r.needsLogin).toEqual([account.id]);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "needs_login", hasSession: false });
    expect(await decryptSession(ctx, account.id)).toBeNull();
    expect((await jobOf(ctx, jobId)).status).toBe("queued");
    advance(10);
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "account_not_active", count: 1 }]);
    expect(exec.calls).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("erreur technique et exception de l'exécuteur : tâche en échec, message d'exception jamais recopié", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const j1 = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const exec = new cloud.FakeCloudExecutor().enqueue(() => { throw new Error(`fuite ${SECRET_COOKIE}`); });
    const r = await run(ctx.orgId, exec);
    expect(r).toMatchObject({ executed: 1, failed: 1 });
    expect(await jobOf(ctx, j1)).toMatchObject({ status: "failed" });
    const dump = (await owner.query("select row_to_json(t)::text as j from cloud_actions t where org_id = $1", [ctx.orgId])).rows.map((x: { j: string }) => x.j).join("");
    expect(dump).not.toContain(SECRET_COOKIE);
    expect((await accountOf(ctx, account.id)).status).toBe("active");
  });

  it("isolation : jamais la session d'un compte pour la conversation d'un autre compte", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const otherConn = await addConnection(ctx, "Autre compte");
    const jobId = await addCloudJob(ctx, account, await addConversation(ctx, otherConn));
    const exec = new cloud.FakeCloudExecutor();
    const r = await run(ctx.orgId, exec);
    expect(r.skipped).toEqual([{ reason: "account_mismatch", count: 1 }]);
    expect(exec.calls).toHaveLength(0);
    expect(await jobOf(ctx, jobId)).toMatchObject({ status: "failed" });
    expect((await actionsOf(ctx))[0]).toMatchObject({ status: "failed", detail: { reason: "account_mismatch" } });
    expect((await accountOf(ctx, account.id)).status).toBe("active");
  });

  it("tâche trop ancienne (> 24 h) : écartée et journalisée, jamais exécutée en retard", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const old = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId), { createdAt: new Date(T0.getTime() - 25 * 3_600_000).toISOString() });
    const fresh = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const exec = new cloud.FakeCloudExecutor();
    const r = await run(ctx.orgId, exec);
    expect(r.skipped).toEqual([{ reason: "expired", count: 1 }]);
    expect((await jobOf(ctx, old)).status).toBe("skipped");
    expect((await jobOf(ctx, fresh)).status).toBe("succeeded");
    expect(exec.calls.map((c) => c.action.id)).toEqual([fresh]);
  });

  it("passage interrompu : tâche restée « en cours » marquée en échec, jamais relancée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const jobId = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    // Le worker meurt pendant l'action : l'exécuteur ne rend jamais la main.
    const never = new cloud.FakeCloudExecutor().enqueue(() => new Promise<never>(() => {}));
    void run(ctx.orgId, never);
    await new Promise((r) => setTimeout(r, 300));
    expect((await jobOf(ctx, jobId)).status).toBe("running");
    advance(20);
    const exec = new cloud.FakeCloudExecutor();
    const r = await run(ctx.orgId, exec);
    expect(r.recovered).toBe(1);
    expect(exec.calls).toHaveLength(0);
    expect(await jobOf(ctx, jobId)).toMatchObject({ status: "failed" });
    expect((await actionsOf(ctx))[0]).toMatchObject({ status: "failed", detail: { sideEffects: "unknown" } });
    // Prudence : Vinted a pu afficher un signal que personne n'a lu. Le compte attend le client.
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "interrupted" });
    expect(await cloud.resume(ctx, account.id)).toMatchObject({ status: "active" });
  });

  it("rétention : journal purgé après 90 jours ; offre sans Cloud → comptes arrêtés et sessions effacées", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    await services.db.withOrg(ctx.orgId, async (tx) => {
      await repos.cloudActions.add(tx, { accountId: account.id, kind: "reply", level: "light", status: "done", createdAt: new Date(T0.getTime() - 91 * 86_400_000).toISOString() });
      await repos.cloudActions.add(tx, { accountId: account.id, kind: "reply", level: "light", status: "done", createdAt: new Date(T0.getTime() - 89 * 86_400_000).toISOString() });
    });
    expect(await cloud.purgeCloudJournal(services)).toBeGreaterThanOrEqual(1);
    expect(await actionsOf(ctx)).toHaveLength(1);
    // Résiliation : l'organisation repasse à l'accès de base.
    await services.db.withOrg(ctx.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "free", quotas: quotasForPlan("free"), status: "canceled" }));
    const m = await cloud.cloudMaintenance(services);
    expect(m.stoppedForPlan).toBeGreaterThanOrEqual(1);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "stopped", hasSession: false });
  });

  it("journal : pagination, filtres et export CSV sans texte de message", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId, "111"));
    await run(ctx.orgId, new cloud.FakeCloudExecutor());
    const page = await cloud.journal(ctx, { status: "done", page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    const csv = await cloud.exportJournal(ctx);
    expect(csv).toContain("Date;Compte;Action;Niveau;Statut;Résultat;Durée (s);Conversation;Longueur du message");
    expect(csv).toContain("Vinted principal;Réponse à un message");
    expect(csv).toContain(`Action faite;"1,2";111;${MESSAGE_TEXT.length}`);
    expect(csv).not.toContain(MESSAGE_TEXT);
    const over = await cloud.overview(ctx);
    expect(over.accounts[0]).toMatchObject({ id: account.id, connectionLabel: "Vinted principal", actionsToday: 1 });
    expect(over.consent.current).toBe(true);
  });
});

describe("Selio Cloud : arrêts, horloge, sessions, créneaux et coupe-circuit", () => {
  it("arrêt global déclenché pendant un passage : les comptes suivants n'agissent plus (relu sous verrou)", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const a1 = await activeAccount(ctx);
    const a2 = await activeAccount(ctx);
    const j1 = await addCloudJob(ctx, a1, await addConversation(ctx, a1.connectionId));
    const j2 = await addCloudJob(ctx, a2, await addConversation(ctx, a2.connectionId));
    const exec = new cloud.FakeCloudExecutor().enqueue(async (input) => {
      // Le client déclenche l'arrêt d'urgence pendant la première action.
      await services.db.withOrg(ctx.orgId, (tx) => repos.automationState.set(tx, true));
      return { ok: true, session: input.session, durationMs: 10 };
    });
    const r = await run(ctx.orgId, exec);
    expect(exec.calls).toHaveLength(1);
    expect(r.skipped).toEqual([{ reason: "global_pause", count: 1 }]);
    expect((await jobOf(ctx, j1)).status).toBe("succeeded");
    expect((await jobOf(ctx, j2)).status).toBe("queued");
    expect(await accountOf(ctx, a2.id)).toMatchObject({ lastActionAt: null });
  });

  it("horloge relue : la fin réelle de l'action fixe lastActionAt et finishedAt (délai humain en temps réel)", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const exec = new cloud.FakeCloudExecutor().enqueue(async (input) => {
      advance(2); // l'action dure 2 minutes
      return { ok: true, session: input.session };
    });
    await run(ctx.orgId, exec);
    const end = new Date(T0.getTime() + 2 * 60_000).toISOString();
    expect(await accountOf(ctx, account.id)).toMatchObject({ lastActionAt: end });
    expect((await actionsOf(ctx))[0]).toMatchObject({ startedAt: T0.toISOString(), finishedAt: end });
    // 3 min après le DÉBUT mais 1 min après la fin : trop tôt pour une nouvelle action.
    await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    advance(1);
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "too_soon", count: 1 }]);
  });

  it("« Arrêter » pendant l'action : la session n'est jamais recréée ; reconnexion pendant l'action : la nouvelle session est gardée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const stopping = new cloud.FakeCloudExecutor().enqueue(async (input) => {
      await cloud.stop(ctx, account.id);
      return { ok: true, session: input.session };
    });
    await run(ctx.orgId, stopping);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "stopped", hasSession: false });
    expect(await decryptSession(ctx, account.id)).toBeNull();

    const other = await activeAccount(ctx);
    await addCloudJob(ctx, other, await addConversation(ctx, other.connectionId));
    const fresh = { cookies: [{ name: "_vinted_fr_session", value: "NOUVELLE-SESSION", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] };
    const reconnecting = new cloud.FakeCloudExecutor().enqueue(async (input) => {
      advance(1);
      const t = await cloud.startLogin(ctx, other.id);
      await cloud.completeLogin(services, t.loginSessionId, fresh);
      return { ok: true, session: input.session };
    });
    await run(ctx.orgId, reconnecting);
    expect((await decryptSession(ctx, other.id))?.cookies.map((c) => c.value)).toEqual(["NOUVELLE-SESSION"]);

    // « Supprimer la session » pendant l'action : rien n'est réécrit.
    const third = await activeAccount(ctx);
    await addCloudJob(ctx, third, await addConversation(ctx, third.connectionId));
    const deleting = new cloud.FakeCloudExecutor().enqueue(async (input) => {
      await cloud.deleteSession(ctx, third.id);
      return { ok: true, session: input.session };
    });
    await run(ctx.orgId, deleting);
    expect(await accountOf(ctx, third.id)).toMatchObject({ hasSession: false });
  });

  it("signal de Vinted : la pause est écrite d'abord et survit à un échec de l'enregistrement du reste", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId);
    await addCloudJob(ctx, account, conv);
    const exec = new cloud.FakeCloudExecutor().enqueue(async () => {
      // Le message « en cours » disparaît pendant l'action : l'enregistrement du résultat échouera.
      await owner.query("delete from messages where conversation_id = $1 and direction = 'outbound'", [conv.conversationId]);
      return { ok: false, code: "captcha", sideEffects: "unknown" };
    });
    await expect(run(ctx.orgId, exec)).rejects.toBeTruthy();
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "captcha", warningsCount: 1 });
    expect(sent).toHaveLength(1);
  });

  it("aucun navigateur libre : tâche remise en file, rien de compté (journal, « cloud.action », délai humain)", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId);
    const jobId = await addCloudJob(ctx, account, conv);
    const exec = new cloud.FakeCloudExecutor().enqueue({ ok: false, code: "unavailable", launched: false, sideEffects: "none" });
    const r = await run(ctx.orgId, exec);
    expect(r).toMatchObject({ executed: 0, failed: 0, requeued: 1 });
    expect(await jobOf(ctx, jobId)).toMatchObject({ status: "queued" });
    expect(await actionsOf(ctx)).toHaveLength(0);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "active", lastActionAt: null });
    const usage = await services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumSince(tx, "2000-01-01T00:00:00.000Z"));
    expect(usage["cloud.action"] ?? 0).toBe(0);
    const outbound = (await services.db.withOrg(ctx.orgId, (tx) => repos.messages.forConversation(tx, conv.conversationId))).filter((m) => m.direction === "outbound");
    expect(outbound).toHaveLength(0);
    // Passage suivant : la tâche part, sans attendre le délai humain (rien n'avait été fait).
    expect((await run(ctx.orgId, exec)).done).toBe(1);
    expect((await jobOf(ctx, jobId)).status).toBe("succeeded");
  });

  it("refus avant lancement (navigateur jamais ouvert) : tâche en échec mais hors plafonds", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const jobId = await addCloudJob(ctx, account, await addConversation(ctx, account.connectionId));
    const exec = new cloud.FakeCloudExecutor().enqueue({ ok: false, code: "error", message: "Action refusée", launched: false, sideEffects: "none" });
    await run(ctx.orgId, exec);
    expect(await jobOf(ctx, jobId)).toMatchObject({ status: "failed" });
    expect((await actionsOf(ctx))[0]).toMatchObject({ status: "failed", startedAt: null });
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.countSince(tx, "2000-01-01T00:00:00.000Z"))).toBe(0);
    expect(await accountOf(ctx, account.id)).toMatchObject({ lastActionAt: null });
  });

  it("coupe-circuit : après « trop de requêtes », plus aucune action Cloud sur la machine, toutes organisations confondues", async () => {
    if (!available) return;
    const ctxA = await setupOrg();
    const ctxB = await setupOrg();
    const a = await activeAccount(ctxA);
    const b = await activeAccount(ctxB);
    await addCloudJob(ctxA, a, await addConversation(ctxA, a.connectionId));
    const jobB = await addCloudJob(ctxB, b, await addConversation(ctxB, b.connectionId));
    const exec = new cloud.FakeCloudExecutor().enqueue({ ok: false, code: "rate_limited", sideEffects: "none" });
    const rA = await run(ctxA.orgId, exec);
    expect(rA.circuitUntil).toBe(new Date(T0.getTime() + CLOUD_CIRCUIT_BREAKER_MINUTES * 60_000).toISOString());
    expect(await cloud.machinePausedUntil(services)).toMatchObject({ reason: "rate_limited" });
    // Autre organisation : rien ne part, ni par le passage global ni par l'organisation directement.
    expect(await cloud.runCloudTick(services, exec, { rng: rng0 })).toMatchObject({ orgs: 0, machinePausedUntil: rA.circuitUntil });
    expect((await run(ctxB.orgId, exec)).skipped).toEqual([{ reason: "machine_paused", count: 1 }]);
    expect(exec.calls).toHaveLength(1);
    advance(CLOUD_CIRCUIT_BREAKER_MINUTES + 1);
    expect((await run(ctxB.orgId, exec)).done).toBe(1);
    expect((await jobOf(ctxB, jobB)).status).toBe("succeeded");
  });

  it("offre réduite : compte au-delà du plafond qui n'agit plus puis arrêté ; Pro sans option → tout arrêté et sessions effacées", async () => {
    if (!available) return;
    const ctx = await setupOrg("agence");
    const accounts: CloudAccount[] = [];
    for (let i = 0; i < 4; i++) {
      advance(1);
      accounts.push(await activeAccount(ctx));
    }
    const newest = accounts[3]!;
    const jobId = await addCloudJob(ctx, newest, await addConversation(ctx, newest.connectionId));
    // Agence → Pro avec l'option ouverte : 3 comptes au plus.
    services.config = { cloudProOption: true };
    await services.db.withOrg(ctx.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "active", quotas: quotasForPlan("pro") }));
    const exec = new cloud.FakeCloudExecutor();
    expect((await run(ctx.orgId, exec)).skipped).toEqual([{ reason: "over_account_limit", count: 1 }]);
    expect(exec.calls).toHaveLength(0);
    expect((await jobOf(ctx, jobId)).status).toBe("queued");
    const m = await cloud.cloudMaintenance(services);
    expect(m.stoppedOverLimit).toBeGreaterThanOrEqual(1);
    expect(await accountOf(ctx, newest.id)).toMatchObject({ status: "stopped", hasSession: false });
    expect(await accountOf(ctx, accounts[0]!.id)).toMatchObject({ status: "active", hasSession: true });
    // Option Pro refermée : plus rien ne peut tourner, rien n'est gardé.
    services.config = {};
    await cloud.cloudMaintenance(services);
    for (const acc of accounts) expect(await accountOf(ctx, acc.id)).toMatchObject({ status: "stopped", hasSession: false });
  });
});

describe("Selio Cloud : fenêtre de connexion (ticket, limites, signaux)", () => {
  it("ticket à usage unique : la première WebSocket le consomme, la seconde est refusée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const conn = await addConnection(ctx);
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, conn);
    const ticket = await cloud.startLogin(ctx, account.id);
    expect(await cloud.attachLoginTicket(services, ticket.ticket)).toMatchObject({ loginSessionId: ticket.loginSessionId, orgId: ctx.orgId });
    expect(await cloud.attachLoginTicket(services, ticket.ticket)).toBeNull();
    expect(await cloud.findLoginByTicket(services, ticket.ticket)).toBeNull();
    // La fenêtre elle-même reste ouverte : le worker peut encore enregistrer la session.
    expect(await cloud.completeLogin(services, ticket.loginSessionId, vintedState())).toMatchObject({ status: "active" });
  });

  it("au plus CLOUD_MAX_LOGIN_WINDOWS_PER_ORG fenêtres ouvertes par organisation", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const accounts: CloudAccount[] = [];
    for (let i = 0; i <= CLOUD_MAX_LOGIN_WINDOWS_PER_ORG; i++) accounts.push(await cloud.enableAccount(ctx, await addConnection(ctx)));
    for (let i = 0; i < CLOUD_MAX_LOGIN_WINDOWS_PER_ORG; i++) await cloud.startLogin(ctx, accounts[i]!.id);
    await expect(cloud.startLogin(ctx, accounts[CLOUD_MAX_LOGIN_WINDOWS_PER_ORG]!.id)).rejects.toMatchObject({ code: "cloud_busy", status: 429 });
    // Rouvrir la fenêtre d'un compte qui en a déjà une remplace l'ancienne (pas de cumul).
    expect(await cloud.startLogin(ctx, accounts[0]!.id)).toMatchObject({ loginSessionId: expect.any(String) });
    // Une fenêtre expirée ne compte plus.
    advance(CLOUD_LOGIN_TTL_MINUTES + 1);
    expect(await cloud.startLogin(ctx, accounts[CLOUD_MAX_LOGIN_WINDOWS_PER_ORG]!.id)).toMatchObject({ loginSessionId: expect.any(String) });
  });

  it("CAPTCHA pendant la connexion : fenêtre fermée sans session, compte en pause, client prévenu ; reconnexion après acquittement", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const conn = await addConnection(ctx);
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, conn);
    const ticket = await cloud.startLogin(ctx, account.id);
    expect(await cloud.loginBlocked(services, ticket.loginSessionId, "captcha")).toBe(true);
    expect(await accountOf(ctx, account.id)).toMatchObject({ status: "paused", pausedReason: "captcha", hasSession: false, warningsCount: 1 });
    await expect(cloud.completeLogin(services, ticket.loginSessionId, vintedState())).rejects.toMatchObject({ code: "conflict" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/CAPTCHA/);
    expect((await auditOf(ctx)).find((a) => a.action === "cloud.login.blocked")?.meta).toMatchObject({ reason: "captcha", sessionSaved: false });
    // CAPTCHA seul : pas de coupe-circuit de la machine.
    expect(await cloud.machinePausedUntil(services)).toBeNull();
    await expect(cloud.startLogin(ctx, account.id)).rejects.toMatchObject({ code: "acknowledge_required" });
    expect(await cloud.resume(ctx, account.id, { acknowledge: true })).toMatchObject({ status: "needs_login" });
    expect(await cloud.startLogin(ctx, account.id)).toMatchObject({ loginSessionId: expect.any(String) });
  });

  it("blocage pendant la connexion : coupe-circuit de la machine", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, await addConnection(ctx));
    const ticket = await cloud.startLogin(ctx, account.id);
    await cloud.loginBlocked(services, ticket.loginSessionId, "blocked");
    expect(await cloud.machinePausedUntil(services)).toMatchObject({ reason: "blocked" });
  });
});

describe("Selio Cloud : règles d'automatisation", () => {
  it("une réponse automatique sur un compte actif dans le Cloud part en tâche « cloud », exécutée par le planificateur seulement", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const account = await activeAccount(ctx);
    const conv = await addConversation(ctx, account.connectionId, "555");
    const otherConn = await addConnection(ctx, "Sans Cloud");
    const conv2 = await addConversation(ctx, otherConn, "556");
    const rule = await services.db.withOrg(ctx.orgId, (tx) => repos.rules.create(tx, { name: "Accusé", kind: "reply_on_new_message", enabled: true, requiresApproval: false, runsIn: "browser", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" }, limits: { maxPerDay: 10, maxPerCustomerPerDay: 2, minMinutesBetweenActions: 0 }, config: { template: "Bien reçu {{prenom}}" } }));
    const res = await automation.runRuleNow(ctx, rule.id);
    expect(res.created).toBe(2);
    const jobs = (await services.db.withOrg(ctx.orgId, (tx) => repos.jobs.list(tx, {}))).items;
    const cloudJob = jobs.find((j) => j.payload.conversationId === conv.conversationId)!;
    const browserJob = jobs.find((j) => j.payload.conversationId === conv2.conversationId)!;
    expect(cloudJob).toMatchObject({ runsIn: "cloud", status: "queued", payload: { cloudAccountId: account.id, cloudKind: "reply" } });
    expect(cloudJob.result).toMatchObject({ awaitingCloud: true });
    expect(browserJob.runsIn).toBe("browser");
    // Le traitement serveur ne touche jamais une tâche Cloud.
    await automation.processDueJobs(ctx);
    expect((await jobOf(ctx, cloudJob.id)).status).toBe("queued");
    const exec = new cloud.FakeCloudExecutor();
    expect((await run(ctx.orgId, exec)).done).toBe(1);
    expect(exec.calls[0]!.action).toMatchObject({ kind: "reply", text: "Bien reçu Léa", conversationUrl: "https://www.vinted.fr/inbox/555" });
    expect((await jobOf(ctx, cloudJob.id)).status).toBe("succeeded");
  });
});
