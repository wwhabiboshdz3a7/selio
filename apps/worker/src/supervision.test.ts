import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, hashPassword, repos, runMigrations, type PgPool } from "@selio/db";
import { FakePushSender, supervision, type Services, type SupervisionFetch } from "@selio/core";
import type { EmailMessage } from "@selio/email";
import { emailList, loadEnv, maintenanceSchedules, supervisionServicesConfig, supervisionTargets } from "./config";
import { supervisionTickTask } from "./tasks";

/**
 * Supervision de bout en bout sur PostgreSQL, base dédiée selio_test_worker_supervision (créée si besoin :
 * jamais celle de tasks.test.ts, Vitest 3 en espace de travail pouvant faire tourner les deux fichiers en
 * même temps). HTTP simulé, Web Push factice, emails capturés, horloge injectée. Ignoré si la base n'est
 * pas joignable.
 */
const OWNER_URL = process.env.TEST_WORKER_SUPERVISION_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker_supervision";
const APP_URL = process.env.TEST_WORKER_SUPERVISION_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker_supervision";
const T0 = new Date("2026-11-08T10:00:00.000Z");
const API = "https://api.selio.test";
const TOKEN = "jeton-de-sante-supervision-0123";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let push: FakePushSender;
let sent: EmailMessage[] = [];
/** Statut HTTP rendu par cible (adresse) ; « throw » = erreur réseau. */
const statusByUrl = new Map<string, number | "throw">();
const calls: { url: string; headers: Record<string, string> }[] = [];

const fakeFetch: SupervisionFetch = async (url, init) => {
  calls.push({ url, headers: init.headers });
  const s = statusByUrl.get(url) ?? 200;
  if (s === "throw") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  return { status: s, json: async () => ({ ok: s >= 200 && s < 300 }) };
};

const targets = [
  { name: "api", url: `${API}/api/health` },
  { name: "ia", url: `${API}/api/ai/health`, headers: { "x-health-token": TOKEN } },
];
const minute = (n = 1) => { clock = new Date(clock.getTime() + n * 60_000); };
const tick = () => supervisionTickTask(services, silent, { targets });

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
    await owner.query("truncate users, organizations, payment_events, rate_limits, supervision_targets, supervision_checks cascade");
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
    publicWebUrl: "https://app.selio.test",
    email: { send: async (m) => { sent.push(m); return { id: `mail-${sent.length}` }; } },
    supervision: { fetch: fakeFetch, operatorEmails: ["OPS@sup.test"], timeoutMs: 1_000 },
  };
  // Un opérateur (deux organisations, un appareil dans chacune) et un client (un appareil) : seul l'opérateur est prévenu.
  const { hash, salt } = await hashPassword("x".repeat(12));
  await services.db.withGlobal(async (tx) => {
    const ops = await repos.users.create(tx, { email: "ops@sup.test", displayName: "Ops", passwordHash: hash, passwordSalt: salt });
    const client = await repos.users.create(tx, { email: "client@sup.test", displayName: "Client", passwordHash: hash, passwordSalt: salt });
    const o1 = await repos.orgs.create(tx, { name: "Équipe", slug: "equipe-sup", settings: {} });
    const o2 = await repos.orgs.create(tx, { name: "Boutique", slug: "boutique-sup", settings: {} });
    await repos.memberships.create(tx, { orgId: o1.id, userId: ops.id, role: "owner" });
    await repos.memberships.create(tx, { orgId: o2.id, userId: ops.id, role: "viewer" });
    await repos.memberships.create(tx, { orgId: o2.id, userId: client.id, role: "owner" });
    return { ops, client, o1, o2 };
  }).then(async ({ ops, client, o1, o2 }) => {
    await services.db.withOrg(o1.id, (tx) => repos.pushSubscriptions.upsert(tx, { userId: ops.id, endpoint: "https://push.test/ops-phone", p256dh: "p", auth: "a", userAgent: "iPhone" }));
    await services.db.withOrg(o2.id, (tx) => repos.pushSubscriptions.upsert(tx, { userId: ops.id, endpoint: "https://push.test/ops-laptop", p256dh: "p", auth: "a", userAgent: "Chrome" }));
    await services.db.withOrg(o2.id, (tx) => repos.pushSubscriptions.upsert(tx, { userId: client.id, endpoint: "https://push.test/client", p256dh: "p", auth: "a", userAgent: "Android" }));
  });
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

beforeEach(async () => {
  if (!available) return;
  await owner.query("truncate supervision_targets, supervision_checks");
  // Worker « neuf » à chaque test : l'état gardé en mémoire (secours si la base tombe) repart de zéro.
  services.supervision!.memory = new Map();
  clock = new Date(T0);
  push = new FakePushSender();
  services.push = push;
  sent = [];
  statusByUrl.clear();
  calls.length = 0;
});

describe("supervision.tick (base réelle)", () => {
  it("3 échecs consécutifs → une seule alerte (Web Push aux appareils des opérateurs et email), sans doublon", async () => {
    if (!available) return;
    statusByUrl.set(`${API}/api/health`, 503);
    const r1 = await tick();
    minute();
    const r2 = await tick();
    expect([r1.alerts, r2.alerts]).toEqual([0, 0]);
    expect(push.sent).toHaveLength(0);
    minute();
    const r3 = await tick();
    expect(r3).toMatchObject({ checked: 2, up: 1, down: 1, alerts: 1, reminders: 0, recovered: 0, pushSent: 2, emailsSent: 1 });
    // Deux appareils de l'opérateur (deux organisations), jamais celui du client.
    expect(push.sent.map((s) => s.endpoint).sort()).toEqual(["https://push.test/ops-laptop", "https://push.test/ops-phone"]);
    expect(push.sent[0]!.payload).toMatchObject({ title: "Selio : « api » ne répond plus", url: "/admin" });
    expect(push.sent[0]!.payload.body).toContain("HTTP 503");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ops@sup.test", subject: "Selio : « api » ne répond plus" });
    expect(sent[0]!.text).toContain("https://app.selio.test/admin");
    // Toujours en panne pendant 59 min : aucune nouvelle notification.
    for (let i = 0; i < 59; i++) {
      minute();
      const r = await tick();
      expect(r.alerts + r.reminders).toBe(0);
    }
    expect(push.sent).toHaveLength(2);
    expect(sent).toHaveLength(1);
    // 60 min après l'alerte : un rappel.
    minute();
    const reminder = await tick();
    expect(reminder).toMatchObject({ alerts: 0, reminders: 1, pushSent: 2, emailsSent: 1 });
    expect(push.sent.at(-1)!.payload.title).toBe("Selio : « api » toujours en panne");
    // Le jeton de santé part dans l'en-tête de « ia », jamais en base.
    expect(calls.find((c) => c.url.endsWith("/api/ai/health"))!.headers["x-health-token"]).toBe(TOKEN);
    const dump = JSON.stringify((await owner.query("select * from supervision_targets")).rows) + JSON.stringify((await owner.query("select * from supervision_checks")).rows);
    expect(dump).not.toContain(TOKEN);
    const events = (await owner.query("select event, count(*)::int as n from supervision_checks where event is not null group by event order by event")).rows;
    expect(events).toEqual([{ event: "alert", n: 1 }, { event: "reminder", n: 1 }]);
  });

  it("rétablissement → notification « rétabli », puis plus rien ; un échec isolé ne réveille personne", async () => {
    if (!available) return;
    statusByUrl.set(`${API}/api/ai/health`, "throw");
    for (let i = 0; i < 3; i++) { await tick(); minute(); }
    expect(push.sent).toHaveLength(2);
    statusByUrl.delete(`${API}/api/ai/health`);
    const back = await tick();
    expect(back).toMatchObject({ recovered: 1, alerts: 0, down: 0, up: 2, pushSent: 2, emailsSent: 1 });
    expect(push.sent.at(-1)!.payload.title).toBe("Selio : « ia » rétabli");
    expect(sent.at(-1)!.subject).toBe("Selio : « ia » rétabli");
    minute();
    expect((await tick()).recovered).toBe(0);
    // Deux échecs puis un succès : ni alerte ni « rétabli ».
    statusByUrl.set(`${API}/api/health`, 500);
    await tick(); minute(); await tick(); minute();
    statusByUrl.delete(`${API}/api/health`);
    const fine = await tick();
    expect(fine).toMatchObject({ alerts: 0, recovered: 0 });
    expect(push.sent).toHaveLength(4);
    expect(sent).toHaveLength(2);
    const state = await supervision.supervisionDetails(services);
    expect(state.targets.map((t) => [t.name, t.status, t.consecutiveFailures])).toEqual([["api", "up", 0], ["ia", "up", 0]]);
  });

  it("deux passages simultanés au seuil : une seule alerte (ligne verrouillée)", async () => {
    if (!available) return;
    statusByUrl.set(`${API}/api/health`, 503);
    await tick(); minute(); await tick(); minute();
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a.alerts + b.alerts).toBe(1);
    expect(push.sent).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect((await owner.query("select consecutive_failures from supervision_targets where name = 'api'")).rows[0].consecutive_failures).toBe(4);
  });

  it("base de données injoignable (db.withGlobal lève) : état en mémoire, un email part au 3e échec, sans doublon ; resynchronisé au retour", async () => {
    if (!available) return;
    const realDb = services.db;
    const down = Object.assign(Object.create(Object.getPrototypeOf(realDb)), realDb, {
      withGlobal: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); },
      withOrg: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); },
    }) as typeof realDb;
    // La base tombe : /api/health répond 503 (base « down »).
    statusByUrl.set(`${API}/api/health`, 503);
    services.db = down;
    try {
      const r1 = await tick(); minute();
      const r2 = await tick(); minute();
      expect([r1.alerts, r2.alerts]).toEqual([0, 0]);
      expect(r1.dbUnavailable).toBe(true);
      const r3 = await tick();
      expect(r3).toMatchObject({ alerts: 1, dbUnavailable: true, emailsSent: 1, pushSent: 0, undelivered: 0 });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.subject).toBe("Selio : « api » ne répond plus");
      expect(sent[0]!.text).toContain("Base de données injoignable");
      // Le push a besoin de la base (abonnements) : rien n'est tenté.
      expect(push.sent).toHaveLength(0);
      // Toujours en panne : pas de nouvel email avant le rappel de 60 minutes (anti-doublon en mémoire).
      for (let i = 0; i < 10; i++) { minute(); const r = await tick(); expect(r.alerts + r.reminders).toBe(0); }
      expect(sent).toHaveLength(1);
    } finally {
      services.db = realDb;
    }
    // La base revient, l'API répond de nouveau : l'état mémoire (« down », alerte partie) sert de départ,
    // donc le rétablissement est notifié et aucune alerte n'est renvoyée.
    statusByUrl.delete(`${API}/api/health`);
    minute();
    const back = await tick();
    expect(back).toMatchObject({ recovered: 1, alerts: 0, dbUnavailable: false });
    expect(sent.at(-1)!.subject).toBe("Selio : « api » rétabli");
    const state = await supervision.supervisionDetails(services);
    expect(state.targets.find((t) => t.name === "api")).toMatchObject({ status: "up", consecutiveFailures: 0 });
  });

  it("email « noop » et aucun appareil : alerte jamais comptée « envoyée », retentée au passage suivant", async () => {
    if (!available) return;
    const { NoopEmailProvider } = await import("@selio/email");
    const savedEmail = services.email;
    services.email = new NoopEmailProvider({ keepLast: 0 });
    services.push = undefined;
    try {
      statusByUrl.set(`${API}/api/health`, 503);
      await tick(); minute(); await tick(); minute();
      const r3 = await tick();
      expect(r3).toMatchObject({ alerts: 1, emailsSent: 0, pushSent: 0, undelivered: 1 });
      expect((await owner.query("select last_alert_at from supervision_targets where name = 'api'")).rows[0].last_alert_at).toBeNull();
      // Passage suivant : nouvel essai (rappel), toujours délivré à personne.
      minute();
      expect(await tick()).toMatchObject({ reminders: 1, undelivered: 1 });
      // Un vrai fournisseur revient : le rappel suivant est délivré, puis plus rien pendant 60 minutes.
      services.email = savedEmail;
      minute();
      expect(await tick()).toMatchObject({ reminders: 1, emailsSent: 1, undelivered: 0 });
      minute();
      expect(await tick()).toMatchObject({ reminders: 0, alerts: 0 });
    } finally {
      services.email = savedEmail;
    }
  });

  it("historique des alertes : 7 jours, au-delà des 20 dernières vérifications de la cible", async () => {
    if (!available) return;
    statusByUrl.set(`${API}/api/health`, 503);
    for (let i = 0; i < 3; i++) { await tick(); minute(); }
    statusByUrl.delete(`${API}/api/health`);
    for (let i = 0; i < 40; i++) { await tick(); minute(); }
    const d = await supervision.supervisionDetails(services);
    expect(d.recent.filter((c) => c.event !== null)).toHaveLength(0);
    expect(d.alerts.map((a) => [a.target, a.event])).toEqual([["api", "recovered"], ["api", "alert"]]);
    expect(d.alerts.find((a) => a.event === "alert")!.delivered).toBe(3);
  });

  it("avertissements de démarrage : aucun canal utilisable, email noop, pas de VAPID, pas de battement", () => {
    expect(supervision.supervisionChannelWarnings({ operatorEmails: 0, emailDelivers: true, push: true, heartbeat: true })).toEqual([expect.stringMatching(/OPERATOR_EMAILS vide/)]);
    expect(supervision.supervisionChannelWarnings({ operatorEmails: 1, emailDelivers: false, push: false, heartbeat: true })[0]).toMatch(/aucun canal d'alerte utilisable/);
    expect(supervision.supervisionChannelWarnings({ operatorEmails: 1, emailDelivers: false, push: true, heartbeat: true })[0]).toMatch(/noop/);
    expect(supervision.supervisionChannelWarnings({ operatorEmails: 1, emailDelivers: true, push: false, heartbeat: true })[0]).toMatch(/VAPID/);
    expect(supervision.supervisionChannelWarnings({ operatorEmails: 1, emailDelivers: true, push: true, heartbeat: true })).toEqual([]);
    expect(supervision.supervisionChannelWarnings({ operatorEmails: 1, emailDelivers: true, push: true, heartbeat: false })[0]).toMatch(/Redis/);
  });

  it("appareil disparu (410) désactivé ; sans Web Push ni opérateur, la panne est tout de même enregistrée", async () => {
    if (!available) return;
    push.respond("https://push.test/ops-laptop", 410);
    statusByUrl.set(`${API}/api/health`, 503);
    for (let i = 0; i < 3; i++) { await tick(); minute(); }
    expect(push.sent.map((s) => s.endpoint)).toEqual(["https://push.test/ops-phone"]);
    const disabled = (await owner.query("select endpoint from push_subscriptions where disabled_at is not null")).rows.map((r) => r.endpoint);
    expect(disabled).toEqual(["https://push.test/ops-laptop"]);
    await owner.query("update push_subscriptions set disabled_at = null, failures = 0");
    // Personne à prévenir : l'événement reste enregistré.
    await owner.query("truncate supervision_targets, supervision_checks");
    services.push = undefined;
    const saved = services.supervision;
    services.supervision = { ...saved, operatorEmails: [], memory: new Map() };
    try {
      sent = [];
      const runs = [];
      for (let i = 0; i < 3; i++) { runs.push(await tick()); minute(); }
      expect(sent).toHaveLength(0);
      expect((await owner.query("select count(*)::int as n from supervision_checks where event = 'alert'")).rows[0].n).toBe(1);
      // Jamais comptée « envoyée » : délivrée à personne, enregistrée comme telle, retentée au passage suivant.
      expect(runs[2]).toMatchObject({ alerts: 1, undelivered: 1 });
      expect((await owner.query("select delivered from supervision_checks where event = 'alert'")).rows[0].delivered).toBe(0);
      expect((await owner.query("select last_alert_at from supervision_targets where name = 'api'")).rows[0].last_alert_at).toBeNull();
      expect((await tick())).toMatchObject({ reminders: 1, undelivered: 1 });
    } finally {
      services.supervision = saved;
    }
  });

  it("battement externe (option désactivée par défaut) : envoyé seulement si tout va bien", async () => {
    if (!available) return;
    const hb = "https://hc.exemple.invalid/ping/abc";
    expect((await tick()).heartbeat).toBe("skipped");
    expect((await supervisionTickTask(services, silent, { targets, heartbeatUrl: hb })).heartbeat).toBe("sent");
    expect(calls.filter((c) => c.url === hb)).toHaveLength(1);
    statusByUrl.set(`${API}/api/health`, 503);
    expect((await supervisionTickTask(services, silent, { targets, heartbeatUrl: hb })).heartbeat).toBe("skipped");
    statusByUrl.delete(`${API}/api/health`);
    statusByUrl.set(hb, 500);
    expect((await supervisionTickTask(services, silent, { targets, heartbeatUrl: hb })).heartbeat).toBe("failed");
  });

  it("historique élagué au-delà de 7 jours", async () => {
    if (!available) return;
    await tick();
    clock = new Date(T0.getTime() + 8 * 86_400_000);
    await tick();
    const rows = (await owner.query("select checked_at from supervision_checks")).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => new Date(r.checked_at).getTime() === clock.getTime())).toBe(true);
  });
});

describe("configuration de la supervision", () => {
  const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://127.0.0.1:6379", SECRETS_ENCRYPTION_KEY: "k".repeat(44) };

  it("supervision.tick chaque minute ; seuil 3, rappel 60 min ; battement externe désactivé", () => {
    const env = loadEnv(base);
    expect(maintenanceSchedules(env).find((s) => s.name === "supervision.tick")).toEqual({ name: "supervision.tick", pattern: "* * * * *" });
    expect(env).toMatchObject({ SUPERVISION_FAILURES_BEFORE_ALERT: 3, SUPERVISION_REMINDER_MINUTES: 60, SUPERVISION_TIMEOUT_MS: 10_000, PUBLIC_API_URL: "http://127.0.0.1:8787" });
    expect(env.SUPERVISION_HEARTBEAT_URL).toBeUndefined();
    expect(loadEnv({ ...base, SUPERVISION_HEARTBEAT_URL: " " }).SUPERVISION_HEARTBEAT_URL).toBeUndefined();
    expect(supervisionServicesConfig(loadEnv({ ...base, OPERATOR_EMAILS: " A@x.fr, b@x.fr ,a@x.fr", SUPERVISION_FAILURES_BEFORE_ALERT: "" }))).toEqual({ operatorEmails: ["a@x.fr", "b@x.fr"], failuresBeforeAlert: 3, reminderMinutes: 60, timeoutMs: 10_000 });
    expect(emailList("")).toEqual([]);
    expect(() => loadEnv({ ...base, SUPERVISION_HEARTBEAT_URL: "http://hc.exemple/ping" })).toThrow(/SUPERVISION_HEARTBEAT_URL/);
  });

  it("cibles par défaut : /api/health, et /api/ai/health avec le jeton seulement s'il est renseigné", () => {
    expect(supervisionTargets(loadEnv(base))).toEqual([{ name: "api", url: "http://127.0.0.1:8787/api/health" }]);
    const withToken = supervisionTargets(loadEnv({ ...base, PUBLIC_API_URL: "https://api.selio.test/", AI_HEALTH_TOKEN: TOKEN }));
    expect(withToken).toEqual([
      { name: "api", url: "https://api.selio.test/api/health" },
      { name: "ia", url: "https://api.selio.test/api/ai/health", headers: { "x-health-token": TOKEN } },
    ]);
  });

  it("SUPERVISION_TARGETS : JSON name/url seulement ; le jeton n'est jamais joint à un autre hôte", () => {
    const env = loadEnv({ ...base, AI_HEALTH_TOKEN: TOKEN, SUPERVISION_TARGETS: JSON.stringify([{ name: "api", url: "http://127.0.0.1:8787/api/health" }, { name: "ia", url: "http://127.0.0.1:8787/api/ai/health" }, { name: "ailleurs", url: "https://autre.exemple/api/ai/health" }]) });
    const t = supervisionTargets(env);
    expect(t.find((x) => x.name === "ia")!.headers).toEqual({ "x-health-token": TOKEN });
    expect(t.find((x) => x.name === "ailleurs")!.headers).toBeUndefined();
    expect(() => loadEnv({ ...base, SUPERVISION_TARGETS: "pas du json" })).toThrow(/SUPERVISION_TARGETS/);
    expect(() => loadEnv({ ...base, SUPERVISION_TARGETS: JSON.stringify([{ name: "api", url: "https://a.test", headers: { authorization: "x" } }]) })).toThrow(/name.*url/);
    expect(() => loadEnv({ ...base, SUPERVISION_TARGETS: JSON.stringify([{ name: "a", url: "https://a.test" }, { name: "a", url: "https://b.test" }]) })).toThrow(/double/);
    expect(() => loadEnv({ ...base, SUPERVISION_TARGETS: JSON.stringify([{ name: "a", url: "ftp://a.test" }]) })).toThrow(/SUPERVISION_TARGETS/);
  });
});
