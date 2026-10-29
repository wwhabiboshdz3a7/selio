import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createPool, DbError } from "./pool";
import { MIGRATIONS_DIR, runMigrations } from "./migrate";
import { SecretBox, hashPassword, verifyPassword, hashSecret, secretsMatch } from "./crypto";
import * as repos from "./repos";

const OWNER_URL = process.env.TEST_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test";
const APP_URL = process.env.TEST_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test";

let owner: Db;
let app: Db;
let available = true;

beforeAll(async () => {
  owner = new Db(createPool(OWNER_URL, { max: 2 }));
  try {
    await owner.ping();
  } catch {
    available = false;
    return;
  }
  await runMigrations(owner.pool, MIGRATIONS_DIR);
  await owner.pool.query("truncate users, organizations, payment_events, rate_limits cascade");
  app = new Db(createPool(APP_URL, { max: 2 }));
});

afterAll(async () => {
  await owner?.close();
  await app?.close();
});

describe("base de données", () => {
  it("chiffre et déchiffre les secrets avec authentification", () => {
    const box = new SecretBox(SecretBox.generateKey());
    const blob = box.encrypt("token-vinted", "conn-1");
    expect(box.decrypt(blob, "conn-1")).toBe("token-vinted");
    expect(() => box.decrypt(blob, "conn-2")).toThrow();
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0xff;
    expect(() => box.decrypt(blob, "conn-1")).toThrow();
    expect(() => new SecretBox("court")).toThrow();
  });
  it("hache mots de passe et jetons", async () => {
    const { hash, salt } = await hashPassword("motdepasse-solide");
    expect(await verifyPassword("motdepasse-solide", hash, salt)).toBe(true);
    expect(await verifyPassword("autre", hash, salt)).toBe(false);
    expect(secretsMatch("abc", hashSecret("abc"))).toBe(true);
    expect(secretsMatch("abd", hashSecret("abc"))).toBe(false);
  });

  it("applique les migrations de façon idempotente", async () => {
    if (!available) return;
    const again = await runMigrations(owner.pool, MIGRATIONS_DIR);
    expect(again).toEqual([]);
  });

  it("isole les organisations par RLS, même sans filtre applicatif", async () => {
    if (!available) return;
    const { orgA, orgB } = await owner.withGlobal(async (tx) => {
      const u = await repos.users.create(tx, { email: "a@test.local", displayName: "A", passwordHash: "x", passwordSalt: "y" });
      const orgA = await repos.orgs.create(tx, { name: "Org A", slug: "org-a", settings: {} });
      const orgB = await repos.orgs.create(tx, { name: "Org B", slug: "org-b", settings: {} });
      await repos.memberships.create(tx, { orgId: orgA.id, userId: u.id, role: "owner" });
      return { orgA, orgB };
    });
    await app.withOrg(orgA.id, async (tx) => { await repos.items.create(tx, { title: "Article A", status: "listed", listedPriceCents: 1000 }); });
    await app.withOrg(orgB.id, async (tx) => { await repos.items.create(tx, { title: "Article B", status: "listed", listedPriceCents: 2000 }); });
    // Lecture sans filtre org_id : RLS ne renvoie que l'organisation courante.
    const seenFromA = await app.withOrg(orgA.id, (tx) => tx.query<{ title: string }>("select title from inventory_items"));
    expect(seenFromA.map((r) => r.title)).toEqual(["Article A"]);
    // Tentative d'insertion pour une autre organisation : refusée par la politique.
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into inventory_items (org_id, title) values ($1, 'intrus')", [orgB.id]))).rejects.toBeInstanceOf(Error);
    // Mise à jour croisée : aucune ligne affectée.
    const updated = await app.withOrg(orgA.id, (tx) => tx.query("update inventory_items set title = 'pirate' where title = 'Article B' returning id"));
    expect(updated).toHaveLength(0);
    // Le rôle applicatif ne contourne pas RLS sans contexte : aucune ligne visible.
    const none = await app.withGlobal((tx) => tx.query("select id from inventory_items"));
    expect(none).toHaveLength(0);
  });

  it("garantit l'idempotence des commandes et des événements de paiement", async () => {
    if (!available) return;
    const org = await owner.withGlobal((tx) => repos.orgs.create(tx, { name: "Org C", slug: "org-c", settings: {} }));
    await app.withOrg(org.id, async (tx) => {
      const item = await repos.items.create(tx, { title: "Sac", status: "listed", listedPriceCents: 5000 });
      const cust = await repos.customers.create(tx, { displayName: "Léa", handle: "lea", provider: "demo" });
      await repos.orders.create(tx, { itemId: item.id, customerId: cust.id, dedupeKey: "demo:tx-1", salePriceCents: 5000, statusHistory: [] });
      await expect(repos.orders.create(tx, { itemId: item.id, customerId: cust.id, dedupeKey: "demo:tx-1", salePriceCents: 5000, statusHistory: [] })).rejects.toMatchObject({ code: "conflict" });
    }).catch((e) => { if (!(e instanceof DbError)) throw e; });
    const eventId = repos.paymentEvents.eventId("revolut", "ord_1", "ORDER_COMPLETED");
    expect(eventId).toBe("revolut:ord_1:ORDER_COMPLETED");
    const record = () => app.withGlobal((tx) => repos.paymentEvents.record(tx, { id: eventId, provider: "revolut", type: "ORDER_COMPLETED", orderId: "ord_1", payload: {} }));
    expect(await record()).toBe(true);
    // Réservé et en cours de traitement : une seconde livraison simultanée est un doublon (une seule facture).
    expect(await record()).toBe(false);
    // Traitement en échec, réservation relâchée : le renvoi du fournisseur doit pouvoir être retraité.
    await app.withGlobal((tx) => repos.paymentEvents.release(tx, eventId));
    expect(await record()).toBe(true);
    // Réservation expirée (traitement interrompu il y a plus de deux minutes) : retraitable aussi.
    await owner.withGlobal((tx) => tx.query("update payment_events set claimed_at = now() - interval '3 minutes' where id = $1", [eventId]));
    expect(await record()).toBe(true);
    await app.withGlobal((tx) => repos.paymentEvents.markProcessed(tx, eventId));
    // Traité : un nouveau renvoi est un doublon, et le relâchement ne rouvre rien.
    expect(await record()).toBe(false);
    await app.withGlobal((tx) => repos.paymentEvents.release(tx, eventId));
    expect(await record()).toBe(false);
  });

  it("0011 : Selio Cloud — tables isolées par RLS, session jamais relue, verrou et prise de tâche conditionnels, rétention", async () => {
    if (!available) return;
    const tables = await owner.withGlobal((tx) => tx.query<{ tablename: string; rowsecurity: boolean; forcerls: boolean }>("select c.relname as tablename, c.relrowsecurity as rowsecurity, c.relforcerowsecurity as forcerls from pg_class c where c.relname like 'cloud\\_%' and c.relkind = 'r' order by 1"));
    // cloud_runtime (coupe-circuit) n'a aucune donnée d'organisation : hors RLS, une seule ligne.
    expect(tables.filter((t) => t.tablename !== "cloud_runtime").map((t) => t.tablename)).toEqual(["cloud_accounts", "cloud_actions", "cloud_consents", "cloud_login_sessions"]);
    for (const t of tables.filter((x) => x.tablename !== "cloud_runtime")) expect(t, t.tablename).toMatchObject({ rowsecurity: true, forcerls: true });
    const { orgA, orgB } = await owner.withGlobal(async (tx) => ({
      orgA: await repos.orgs.create(tx, { name: "Cloud A", slug: "cloud-a", settings: {} }),
      orgB: await repos.orgs.create(tx, { name: "Cloud B", slug: "cloud-b", settings: {} }),
    }));
    const box = new SecretBox(SecretBox.generateKey());
    const a = await app.withOrg(orgA.id, async (tx) => {
      const conn = await repos.connections.create(tx, { id: "cloud-conn-a", provider: "vinted", label: "Vinted A", status: "connected" });
      return repos.cloudAccounts.create(tx, { connectionId: conn.id });
    });
    expect(a).toMatchObject({ status: "needs_login", hasSession: false, settings: { levels: ["light"] } });
    // Un seul compte Cloud par connexion.
    await expect(app.withOrg(orgA.id, (tx) => repos.cloudAccounts.create(tx, { connectionId: "cloud-conn-a" }))).rejects.toMatchObject({ code: "conflict" });
    await app.withOrg(orgB.id, async (tx) => {
      const conn = await repos.connections.create(tx, { id: "cloud-conn-b", provider: "vinted", label: "Vinted B", status: "connected" });
      await repos.cloudAccounts.create(tx, { connectionId: conn.id });
      await repos.cloudConsents.add(tx, { userId: "u-b", version: "v1", textHash: "f".repeat(64), acceptedAt: "2026-10-29T10:00:00.000Z", ip: null });
    });
    // RLS : l'organisation A ne voit ni les comptes ni les accords de B, même sans filtre applicatif.
    const seen = await app.withOrg(orgA.id, (tx) => tx.query<{ id: string }>("select id from cloud_accounts"));
    expect(seen.map((r) => r.id)).toEqual([a.id]);
    expect(await app.withOrg(orgA.id, (tx) => repos.cloudConsents.latest(tx))).toBeNull();
    expect(await app.withOrg(orgA.id, (tx) => repos.cloudAccounts.list(tx))).toHaveLength(1);
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into cloud_accounts (org_id, connection_id) values ($1, 'cloud-conn-b')", [orgB.id]))).rejects.toBeInstanceOf(Error);
    expect(await app.withGlobal((tx) => tx.query("select id from cloud_accounts"))).toHaveLength(0);

    await app.withOrg(orgA.id, async (tx) => {
      // Session : bloc chiffré stocké, jamais renvoyé par les lectures ordinaires.
      const blob = box.encrypt(JSON.stringify({ cookies: [{ name: "s", value: "valeur-secrete", domain: ".vinted.fr" }], origins: [] }), a.id);
      const saved = await repos.cloudAccounts.setSession(tx, a.id, blob, "2026-10-29T10:00:00.000Z");
      expect(saved.hasSession).toBe(true);
      expect(JSON.stringify(saved)).not.toContain("valeur-secrete");
      expect(JSON.stringify(await repos.cloudAccounts.list(tx))).not.toMatch(/valeur-secrete|sessionCiphertext/);
      expect(box.decrypt((await repos.cloudAccounts.session(tx, a.id))!, a.id)).toContain("valeur-secrete");
      // Verrou : seulement sur un compte actif et libre.
      expect(await repos.cloudAccounts.lock(tx, a.id, "2026-10-29T10:00:00.000Z", "2026-10-29T09:45:00.000Z")).toBeNull();
      await repos.cloudAccounts.update(tx, a.id, { status: "active" });
      expect(await repos.cloudAccounts.lock(tx, a.id, "2026-10-29T10:00:00.000Z", "2026-10-29T09:45:00.000Z")).not.toBeNull();
      expect(await repos.cloudAccounts.lock(tx, a.id, "2026-10-29T10:01:00.000Z", "2026-10-29T09:46:00.000Z")).toBeNull();
      // Verrou abandonné (plus vieux que le délai) : repris.
      expect(await repos.cloudAccounts.lock(tx, a.id, "2026-10-29T10:20:00.000Z", "2026-10-29T10:05:00.000Z")).not.toBeNull();
      await repos.cloudAccounts.unlock(tx, a.id);
      expect(await repos.cloudAccounts.countActive(tx)).toBe(1);
      const cleared = await repos.cloudAccounts.clearSession(tx, a.id);
      expect(cleared).toMatchObject({ hasSession: false, sessionSavedAt: null });
      expect(await repos.cloudAccounts.session(tx, a.id)).toBeNull();
      await repos.cloudAccounts.update(tx, a.id, { status: "stopped" });
      expect(await repos.cloudAccounts.countActive(tx)).toBe(0);
      await repos.cloudAccounts.update(tx, a.id, { status: "active" });

      // Prise de tâche : une seule fois.
      const job = await repos.jobs.create(tx, { kind: "automation.send_message", status: "queued", dedupeKey: "cloud:test:1", payload: { cloudAccountId: a.id }, runsIn: "cloud", scheduledFor: "2026-10-29T09:00:00.000Z" });
      expect((await repos.jobs.dueCloud(tx, "2026-10-29T10:00:00.000Z")).map((j) => j.id)).toEqual([job.id]);
      expect(await repos.jobs.dueCloud(tx, "2026-10-29T08:00:00.000Z")).toHaveLength(0);
      const claimed = await repos.jobs.claimCloud(tx, job.id, "2026-10-29T10:00:00.000Z");
      expect(claimed).toMatchObject({ status: "running", attempts: 1, runsIn: "cloud" });
      expect(await repos.jobs.claimCloud(tx, job.id, "2026-10-29T10:00:01.000Z")).toBeNull();
      expect((await repos.jobs.staleCloudRunning(tx, "2026-10-29T10:30:00.000Z")).map((j) => j.id)).toEqual([job.id]);
      const queued2 = await repos.jobs.create(tx, { kind: "automation.send_message", status: "queued", dedupeKey: "cloud:test:2", payload: { cloudAccountId: a.id }, runsIn: "cloud", scheduledFor: "2026-10-29T09:00:00.000Z" });
      expect(await repos.jobs.cancelCloudForAccount(tx, a.id)).toBe(1);
      expect((await repos.jobs.byId(tx, queued2.id)).status).toBe("cancelled");

      // Journal : filtres, pagination, plafonds (actions qui ont ouvert le navigateur) et rétention de 90 jours.
      const at = (iso: string) => ({ startedAt: iso, createdAt: iso });
      await repos.cloudActions.add(tx, { accountId: a.id, kind: "reply", level: "light", status: "done", jobId: job.id, detail: { conversationRef: "123", messageLength: 12, code: "ok", durationMs: 900 }, ...at("2026-10-29T09:30:00.000Z") });
      await repos.cloudActions.add(tx, { accountId: a.id, kind: "follow_up", level: "light", status: "paused", detail: { code: "captcha" }, ...at("2026-10-29T08:00:00.000Z") });
      await repos.cloudActions.add(tx, { accountId: a.id, kind: "reply", level: "light", status: "skipped", detail: { reason: "expired" }, createdAt: "2026-10-29T09:40:00.000Z" });
      await repos.cloudActions.add(tx, { accountId: a.id, kind: "reply", level: "light", status: "done", ...at("2026-07-01T09:00:00.000Z") });
      expect(await repos.cloudActions.countSince(tx, "2026-10-29T09:00:00.000Z", a.id)).toBe(1);
      expect(await repos.cloudActions.countSince(tx, "2026-10-29T00:00:00.000Z", a.id)).toBe(2);
      expect(await repos.cloudActions.countSince(tx, "2026-10-29T00:00:00.000Z")).toBe(2);
      const pageAll = await repos.cloudActions.list(tx, { page: 1, pageSize: 2 });
      expect(pageAll).toMatchObject({ total: 4, pageCount: 2 });
      expect(pageAll.items[0]?.detail).toMatchObject({ reason: "expired" });
      expect((await repos.cloudActions.list(tx, { status: "paused" })).items.map((x) => x.kind)).toEqual(["follow_up"]);
      expect((await repos.cloudActions.list(tx, { kind: "follow_up", accountId: a.id })).total).toBe(1);
      expect((await repos.cloudActions.byJob(tx, job.id))?.status).toBe("done");
      expect(await repos.cloudActions.purgeOlderThan(tx, 90, new Date("2026-10-29T12:00:00.000Z"))).toBe(1);
      expect((await repos.cloudActions.listAll(tx, {})).length).toBe(3);

      // Fenêtres de connexion : ticket haché, fermeture conditionnelle, expiration.
      const ls = await repos.cloudLoginSessions.create(tx, { accountId: a.id, ticketHash: hashSecret("ticket-1"), expiresAt: "2026-10-29T10:15:00.000Z" });
      expect(ls).not.toHaveProperty("ticketHash");
      expect(await repos.cloudLoginSessions.close(tx, ls.id, "done")).toMatchObject({ status: "done" });
      expect(await repos.cloudLoginSessions.close(tx, ls.id, "cancelled")).toBeNull();
      await repos.cloudLoginSessions.create(tx, { accountId: a.id, ticketHash: hashSecret("ticket-2"), expiresAt: "2026-10-29T10:15:00.000Z" });
      expect(await repos.cloudLoginSessions.expireStale(tx, "2026-10-29T10:00:00.000Z")).toBe(0);
      expect(await repos.cloudLoginSessions.expireStale(tx, "2026-10-29T10:16:00.000Z")).toBe(1);
      const t3 = await repos.cloudLoginSessions.create(tx, { accountId: a.id, ticketHash: hashSecret("ticket-3"), expiresAt: "2026-10-29T11:15:00.000Z" });
      // Ticket à usage unique : la première WebSocket le consomme, la seconde est refusée.
      expect(await repos.cloudLoginSessions.countOpen(tx, "2026-10-29T10:20:00.000Z")).toBe(1);
      expect(await repos.cloudLoginSessions.attach(tx, t3.id, "2026-10-29T10:20:00.000Z")).toBe(true);
      expect(await repos.cloudLoginSessions.attach(tx, t3.id, "2026-10-29T10:21:00.000Z")).toBe(false);
      expect(await repos.cloudLoginSessions.closeOpenForAccount(tx, a.id, "cancelled")).toBe(1);
      expect(await repos.cloudLoginSessions.countOpen(tx, "2026-10-29T10:20:00.000Z")).toBe(0);
    });
    // Recherche globale (fonctions SECURITY DEFINER) par le rôle applicatif, hors contexte d'organisation.
    const byTicket = await app.withGlobal((tx) => repos.cloudLoginSessions.byTicketHash(tx, hashSecret("ticket-1")));
    expect(byTicket).toMatchObject({ orgId: orgA.id, accountId: a.id, status: "done" });
    expect(await app.withGlobal((tx) => repos.cloudLoginSessions.findGlobal(tx, byTicket!.id))).toMatchObject({ orgId: orgA.id });
    expect(await app.withGlobal((tx) => repos.cloudLoginSessions.byTicketHash(tx, hashSecret("inconnu")))).toBeNull();
    expect((await app.withGlobal((tx) => repos.cloudOrgs.ids(tx))).sort()).toEqual([orgA.id, orgB.id].sort());
    // Écritures conditionnelles de la session (course avec « Arrêter » / « Supprimer la session »).
    await app.withOrg(orgA.id, async (tx) => {
      const box = new SecretBox(SecretBox.generateKey());
      const blob = (v: string) => box.encrypt(v, a.id);
      await repos.cloudAccounts.update(tx, a.id, { status: "active" });
      await repos.cloudAccounts.setSession(tx, a.id, blob("s1"), "2026-10-29T10:00:00.000Z");
      // Date attendue différente (reconnexion pendant l'action) : rien n'est écrasé.
      expect(await repos.cloudAccounts.replaceSessionIf(tx, a.id, blob("ancienne"), "2026-10-29T10:05:00.000Z", "2026-10-29T09:00:00.000Z")).toBe(false);
      expect(await repos.cloudAccounts.replaceSessionIf(tx, a.id, blob("s2"), "2026-10-29T10:05:00.000Z", "2026-10-29T10:00:00.000Z")).toBe(true);
      expect(box.decrypt((await repos.cloudAccounts.session(tx, a.id))!, a.id)).toBe("s2");
      expect(await repos.cloudAccounts.clearSessionIf(tx, a.id, "2026-10-29T10:00:00.000Z")).toBe(false);
      // Compte arrêté (session effacée) : jamais recréée.
      await repos.cloudAccounts.clearSession(tx, a.id);
      await repos.cloudAccounts.update(tx, a.id, { status: "stopped" });
      expect(await repos.cloudAccounts.replaceSessionIf(tx, a.id, blob("s3"), "2026-10-29T10:10:00.000Z", null)).toBe(false);
      expect(await repos.cloudAccounts.session(tx, a.id)).toBeNull();
      // Pause après un signal : compte arrêté laissé arrêté, compteur incrémenté ; compte actif mis en pause.
      expect(await repos.cloudAccounts.pauseForSignal(tx, a.id, "captcha", "2026-10-29T10:12:00.000Z")).toMatchObject({ status: "stopped", warningsCount: 1 });
      await repos.cloudAccounts.update(tx, a.id, { status: "active" });
      expect(await repos.cloudAccounts.pauseForSignal(tx, a.id, "rate_limited", "2026-10-29T10:13:00.000Z")).toMatchObject({ status: "paused", pausedReason: "rate_limited", warningsCount: 2, lastActionAt: "2026-10-29T10:13:00.000Z" });
      expect((await repos.cloudAccounts.lockedById(tx, a.id)).id).toBe(a.id);
      const row = await repos.cloudActions.add(tx, { accountId: a.id, kind: "reply", level: "light", status: "running" });
      await repos.cloudActions.remove(tx, row.id);
      expect((await repos.cloudActions.listAll(tx, {})).find((x) => x.id === row.id)).toBeUndefined();
    });
    // Coupe-circuit de la machine : lisible et modifiable par le rôle applicatif, jamais raccourci.
    await app.withGlobal(async (tx) => {
      await repos.cloudRuntime.clear(tx);
      expect(await repos.cloudRuntime.get(tx)).toEqual({ suspendedUntil: null, reason: null });
      await repos.cloudRuntime.suspend(tx, "2026-10-29T11:00:00.000Z", "rate_limited");
      await repos.cloudRuntime.suspend(tx, "2026-10-29T10:30:00.000Z", "blocked");
      expect(await repos.cloudRuntime.get(tx)).toEqual({ suspendedUntil: "2026-10-29T11:00:00.000Z", reason: "blocked" });
      await repos.cloudRuntime.clear(tx);
    });
    // Après une restauration : comptes en pause « restored », sessions effacées, tâches Cloud annulées.
    await app.withOrg(orgA.id, async (tx) => {
      await repos.cloudAccounts.update(tx, a.id, { status: "active", pausedReason: null, pausedAt: null });
      await repos.cloudAccounts.setSession(tx, a.id, Buffer.from("chiffre"), "2026-10-29T10:00:00.000Z");
      await repos.jobs.create(tx, { kind: "automation.send_message", status: "queued", dedupeKey: "cloud:restore:1", payload: { cloudAccountId: a.id }, runsIn: "cloud", scheduledFor: "2026-10-29T09:00:00.000Z" });
    });
    await expect(app.withGlobal((tx) => tx.query("select app_cloud_after_restore()"))).rejects.toBeInstanceOf(Error);
    const touched = await owner.withGlobal((tx) => tx.query<{ n: number }>("select app_cloud_after_restore() as n"));
    expect(Number(touched[0]?.n)).toBeGreaterThanOrEqual(1);
    await app.withOrg(orgA.id, async (tx) => {
      expect(await repos.cloudAccounts.byId(tx, a.id)).toMatchObject({ status: "paused", pausedReason: "restored", hasSession: false });
      expect(await tx.count("select count(*) from jobs where org_id = $1 and runs_in = 'cloud' and status = 'queued'", [tx.orgId])).toBe(0);
    });
    // Suppression de la connexion : le compte Cloud (et sa session) part avec elle.
    await app.withOrg(orgA.id, (tx) => repos.connections.delete(tx, "cloud-conn-a"));
    expect(await app.withOrg(orgA.id, (tx) => repos.cloudAccounts.list(tx))).toHaveLength(0);
  });

  it("limite le débit par fenêtre", async () => {
    if (!available) return;
    const a = await app.withGlobal((tx) => repos.rateLimits.hit(tx, "test:ip", 60_000));
    const b = await app.withGlobal((tx) => repos.rateLimits.hit(tx, "test:ip", 60_000));
    expect(b).toBe(a + 1);
  });

  it("0008 : un ancien abonnement Pro retrouve les quotas du nouveau Pro, un devis complet est gardé, la vue administrateur compte les requêtes IA", async () => {
    if (!available) return;
    const { PLAN_QUOTAS } = await import("@selio/contracts");
    // Les JSON écrits par la migration sont une copie de PLAN_QUOTAS : on vérifie qu'ils n'ont pas divergé.
    const sql = readFileSync(join(MIGRATIONS_DIR, "0008_quotas_backfill_admin_ai.sql"), "utf8");
    for (const plan of ["free", "starter", "pro", "agence"] as const) {
      const m = new RegExp(`set quotas = '(\\{[^']+\\})'::jsonb\\s+where plan = '${plan}'`).exec(sql);
      expect(m, `JSON du plan ${plan} dans la migration`).not.toBeNull();
      expect(JSON.parse(m![1]!)).toEqual(PLAN_QUOTAS[plan]);
    }
    const legacy = { items: 5000, aiRequestsPerMonth: 3000, automationActionsPerDay: 500, connections: 5, members: 10 };
    const custom = { ...PLAN_QUOTAS.agence, connections: 25, aiRequestsPerMonth: 12_000 };
    const { oldPro, quoted } = await owner.withGlobal(async (tx) => {
      const oldPro = await repos.orgs.create(tx, { name: "Org D", slug: "org-d", settings: { ai: { monthlyRequestQuota: 7 } } });
      const quoted = await repos.orgs.create(tx, { name: "Org E", slug: "org-e", settings: {} });
      await tx.insert("subscriptions", { orgId: oldPro.id, plan: "pro", status: "trialing", quotas: legacy });
      await tx.insert("subscriptions", { orgId: quoted.id, plan: "agence", status: "active", quotas: custom });
      return { oldPro, quoted };
    });
    // À la lecture, avant même la migration : l'ancien JSON est remplacé par les quotas du plan (Studio retrouvé).
    const read = await app.withOrg(oldPro.id, (tx) => repos.subscriptions.get(tx));
    expect(read?.quotas).toEqual(PLAN_QUOTAS.pro);
    expect(read?.quotas.studioListingsPerMonth).toBe(20);
    expect((await app.withOrg(quoted.id, (tx) => repos.subscriptions.get(tx)))?.quotas).toEqual(custom);
    // La migration (idempotente, rejouée ici) réécrit la ligne en base ; le JSON complet (devis) reste intact.
    await owner.pool.query(sql);
    const rows = await owner.withGlobal((tx) => tx.query<{ orgId: string; quotas: Record<string, unknown> }>("select org_id, quotas from subscriptions where org_id = any($1)", [[oldPro.id, quoted.id]]));
    expect(rows.find((r) => r.orgId === oldPro.id)?.quotas).toEqual(PLAN_QUOTAS.pro);
    expect(rows.find((r) => r.orgId === quoted.id)?.quotas).toEqual(custom);
    // Vue administrateur : décompte des requêtes IA du mois comme le refus (échecs compris, aide exclue) et réglage de l'organisation.
    await app.withOrg(oldPro.id, async (tx) => {
      await repos.aiRequests.create(tx, { kind: "reply_suggestion", provider: "mock", model: "m", status: "failed" });
      await repos.aiRequests.create(tx, { kind: "listing_generation", provider: "mock", model: "m", status: "succeeded" });
      await repos.aiRequests.create(tx, { kind: "help_answer", provider: "mock", model: "m", status: "succeeded" });
    });
    const usage = await app.withGlobal((tx) => repos.admin.orgUsage(tx, "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z"));
    const mine = usage.find((r) => r.id === oldPro.id);
    expect(mine).toMatchObject({ plan: "pro", aiRequestsMonth: 2, quotas: PLAN_QUOTAS.pro });
    expect(mine?.aiSettings).toMatchObject({ monthlyRequestQuota: 7 });
    expect(usage.find((r) => r.id === quoted.id)).toMatchObject({ aiRequestsMonth: 0, aiSettings: {} });
  });
});
