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

  it("0012 : Selio Radar — mesures, abonnements, alertes et cache isolés par RLS, dédoublonnage, purge des données du vendeur", async () => {
    if (!available) return;
    const tables = await owner.withGlobal((tx) => tx.query<{ tablename: string; rowsecurity: boolean; forcerls: boolean }>("select c.relname as tablename, c.relrowsecurity as rowsecurity, c.relforcerowsecurity as forcerls from pg_class c where c.relname = any($1) and c.relkind = 'r' order by 1", [["radar_reads", "push_subscriptions", "radar_alerts", "embeddings_cache"]]));
    expect(tables.map((t) => t.tablename)).toEqual(["embeddings_cache", "push_subscriptions", "radar_alerts", "radar_reads"]);
    for (const t of tables) expect(t, t.tablename).toMatchObject({ rowsecurity: true, forcerls: true });
    const { orgA, orgB, userA, userB } = await owner.withGlobal(async (tx) => {
      const userA = await repos.users.create(tx, { email: "radar-a@test.local", displayName: "RA", passwordHash: "x", passwordSalt: "y" });
      const userB = await repos.users.create(tx, { email: "radar-b@test.local", displayName: "RB", passwordHash: "x", passwordSalt: "y" });
      const orgA = await repos.orgs.create(tx, { name: "Radar A", slug: "radar-a", settings: {} });
      const orgB = await repos.orgs.create(tx, { name: "Radar B", slug: "radar-b", settings: {} });
      await repos.memberships.create(tx, { orgId: orgA.id, userId: userA.id, role: "owner" });
      await repos.memberships.create(tx, { orgId: orgB.id, userId: userB.id, role: "owner" });
      return { orgA, orgB, userA, userB };
    });
    const now = new Date("2026-10-30T10:00:00.000Z");
    const { search, opp } = await app.withOrg(orgA.id, async (tx) => {
      const conn = await repos.connections.create(tx, { id: "radar-conn-a", provider: "vinted", label: "Achats", status: "connected", usage: "purchase" });
      const search = await repos.searches.create(tx, { name: "Pulls", source: "cloud", priority: true, connectionId: conn.id });
      expect(search).toMatchObject({ source: "cloud", priority: true, slowdownFactor: 1, pagesRead: 0, blocksCount: 0, lastReadAt: null, lastBlockAt: null });
      expect(await repos.searches.countPriority(tx)).toBe(1);
      expect(await repos.searches.countPriority(tx, search.id)).toBe(0);
      // Mesures d'une lecture : compteurs incrémentés en SQL, dernier blocage daté.
      const after = await repos.searches.recordRead(tx, search.id, { readAt: now.toISOString(), livePages: 1, blocked: true, slowdownFactor: 2 });
      expect(after).toMatchObject({ pagesRead: 1, blocksCount: 1, slowdownFactor: 2, lastReadAt: now.toISOString(), lastBlockAt: now.toISOString(), lastRunAt: now.toISOString() });
      const ok = await repos.searches.recordRead(tx, search.id, { readAt: "2026-10-30T10:02:00.000Z", livePages: 1, blocked: false, slowdownFactor: 2 });
      expect(ok).toMatchObject({ pagesRead: 2, blocksCount: 1, lastBlockAt: now.toISOString() });
      // Une annonce Vinted ne donne qu'une affaire par organisation.
      const observed = { priceCents: 1500, shippingCents: 450, seenAt: now.toISOString(), source: "connector" as const, externalRef: "4242", publishedAt: "2026-10-30T09:58:00.000Z", publishedAtSource: "absolute" as const, detectedAt: now.toISOString(), sellerHandle: "vendeuse_x", sellerRating: 4.9, sellerReviews: 12, photoUrl: "https://images.vinted.net/p.jpg", url: "https://www.vinted.fr/items/4242-pull" };
      const estimate = { resalePriceCents: 4000, marginCents: 1500, marginRate: 0.4, confidence: "medium" as const, method: "embeddings", comparableCount: 3 };
      const opp = await repos.opportunities.create(tx, { searchId: search.id, title: "Pull Ralph Lauren", observed, estimate, score: 88, status: "new" } as never);
      expect(opp.observed).toMatchObject({ externalRef: "4242", detectedAt: now.toISOString() });
      expect((await repos.opportunities.byExternalRef(tx, "4242"))?.id).toBe(opp.id);
      expect(await repos.opportunities.byExternalRef(tx, "9999")).toBeNull();
      expect(await repos.opportunities.detectionDelays(tx, "2026-10-01T00:00:00.000Z")).toEqual([{ publishedAt: "2026-10-30T09:58:00.000Z", detectedAt: now.toISOString() }]);
      // Stock initial, date relative à l'heure près ou d'origine inconnue : hors de la mesure du délai.
      const extra = (ref: string, o: Record<string, unknown>) => repos.opportunities.create(tx, { searchId: search.id, title: `Pull ${ref}`, observed: { ...observed, externalRef: ref, ...o }, estimate, score: 50, status: "new" } as never);
      await extra("4243", { initialStock: true });
      await extra("4244", { publishedAtSource: "relative", publishedAt: "2026-10-30T08:00:00.000Z" });
      await extra("4245", { publishedAtSource: "unknown" });
      await extra("4246", { publishedAtSource: "relative", publishedAt: "2026-10-30T09:57:00.000Z" });
      expect((await repos.opportunities.detectionDelays(tx, "2026-10-01T00:00:00.000Z")).map((d) => d.publishedAt).sort()).toEqual(["2026-10-30T09:57:00.000Z", "2026-10-30T09:58:00.000Z"]);
      await tx.query("delete from opportunities where org_id = $1 and observed->>'externalRef' in ('4243', '4244', '4245', '4246')", [tx.orgId]);
      // Ralentissement par organisation : facteur et date du dernier blocage, gardés hors des recherches.
      expect(await repos.radarOrgState.get(tx)).toEqual({ slowdownFactor: 1, lastBlockAt: null });
      await repos.radarOrgState.set(tx, { slowdownFactor: 4, blockAt: now.toISOString() });
      await repos.radarOrgState.set(tx, { slowdownFactor: 200 });
      expect(await repos.radarOrgState.get(tx)).toEqual({ slowdownFactor: 64, lastBlockAt: now.toISOString() });
      // Lectures anormales consécutives : +1, remis à zéro par une lecture correcte, arrêt avec la raison.
      await repos.searches.recordRead(tx, search.id, { readAt: now.toISOString(), livePages: 1, blocked: false, slowdownFactor: 1, anomaly: true });
      expect((await repos.searches.recordRead(tx, search.id, { readAt: now.toISOString(), livePages: 1, blocked: false, slowdownFactor: 1, anomaly: true })).consecutiveFailures).toBe(2);
      expect((await repos.searches.recordRead(tx, search.id, { readAt: now.toISOString(), livePages: 1, blocked: false, slowdownFactor: 1, anomaly: null })).consecutiveFailures).toBe(2);
      expect((await repos.searches.recordRead(tx, search.id, { readAt: now.toISOString(), livePages: 1, blocked: false, slowdownFactor: 1, anomaly: false })).consecutiveFailures).toBe(0);
      expect(await repos.searches.suspend(tx, search.id, "Page non reconnue")).toMatchObject({ enabled: false, suspendedReason: "Page non reconnue" });
      await repos.searches.update(tx, search.id, { enabled: true, suspendedReason: null });
      // Compte tenu par un achat en attente de la validation 3-D Secure : aucun verrou (lecture, action, achat) jusqu'à l'échéance.
      const acc = await repos.cloudAccounts.create(tx, { connectionId: conn.id, status: "active" });
      await repos.cloudAccounts.hold(tx, acc.id, "2026-10-30T10:10:00.000Z");
      expect(await repos.cloudAccounts.heldUntil(tx, acc.id)).toBe("2026-10-30T10:10:00.000Z");
      expect(await repos.cloudAccounts.lock(tx, acc.id, now.toISOString(), "2026-10-30T09:45:00.000Z")).toBeNull();
      expect(await repos.cloudAccounts.lock(tx, acc.id, "2026-10-30T10:10:01.000Z", "2026-10-30T09:55:01.000Z")).not.toBeNull();
      await repos.cloudAccounts.unlock(tx, acc.id);
      await repos.cloudAccounts.release(tx, acc.id);
      expect(await repos.cloudAccounts.lock(tx, acc.id, now.toISOString(), "2026-10-30T09:45:00.000Z")).not.toBeNull();
      await tx.query("delete from cloud_accounts where id = $1", [acc.id]);
      await tx.query("update radar_searches set pages_read = 2, last_read_at = $2, last_run_at = $2 where id = $1", [search.id, "2026-10-30T10:02:00.000Z"]);
      return { search, opp };
    });
    await expect(app.withOrg(orgA.id, (tx) => repos.opportunities.create(tx, { searchId: search.id, title: "Doublon", observed: { ...opp.observed }, estimate: opp.estimate, score: 10 }))).rejects.toMatchObject({ code: "conflict" });
    // Contraintes : source, résultat de lecture, sorte de vecteur, une seule demande d'achat active par affaire.
    await expect(app.withOrg(orgA.id, (tx) => tx.query("update radar_searches set source = 'vinted' where id = $1", [search.id]))).rejects.toMatchObject({ code: "validation" });
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into radar_reads (org_id, outcome) values ($1, 'warning')", [tx.orgId]))).rejects.toMatchObject({ code: "validation" });
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into embeddings_cache (org_id, kind, ref, model, dims, text_hash, vector) values ($1, 'seller', 'x', 'm', 1, 'h', '[1]')", [tx.orgId]))).rejects.toMatchObject({ code: "validation" });

    await app.withOrg(orgA.id, async (tx) => {
      // Mesures : fenêtre glissante, plafond par minute (le simulateur ne compte pas), par jour, rétention 90 jours.
      const read = (readAt: string, outcome: "ok" | "captcha" | "rate_limited" | "error", source: "cloud" | "demo" = "cloud") => repos.radarReads.add(tx, { searchId: search.id, connectionId: "radar-conn-a", source, readAt, durationMs: 1234.4, outcome, itemsSeen: 20, itemsNew: 2, factor: 1 });
      expect(await read("2026-10-30T09:59:30.000Z", "ok")).toMatchObject({ durationMs: 1234, outcome: "ok", source: "cloud" });
      await read("2026-10-30T09:59:40.000Z", "captcha");
      await read("2026-10-30T09:59:50.000Z", "ok", "demo");
      await read("2026-10-29T12:00:00.000Z", "rate_limited");
      await read("2026-10-29T12:01:00.000Z", "error");
      await read("2026-07-01T12:00:00.000Z", "ok");
      expect(await repos.radarReads.countLiveSince(tx, "2026-10-30T09:59:00.000Z")).toBe(2);
      expect(await repos.radarReads.liveWindow(tx, 1000)).toEqual({ reads: 5, blocks: 2 });
      expect(await repos.radarReads.liveWindow(tx, 2)).toEqual({ reads: 2, blocks: 1 });
      expect(await repos.radarReads.dailyLive(tx, "2026-10-29T00:00:00.000Z")).toEqual([{ day: "2026-10-29", reads: 2, blocks: 1 }, { day: "2026-10-30", reads: 2, blocks: 1 }]);
      expect(await repos.radarReads.purgeOlderThan(tx, 90, now)).toBe(1);
      expect(await repos.radarReads.list(tx, { searchId: search.id })).toHaveLength(5);
      // Pages d'un achat Radar Auto : comptées dans les plafonds par minute et dans la fenêtre (en pages).
      const buyRead = await repos.radarReads.add(tx, { kind: "purchase", pages: 3, searchId: search.id, connectionId: "radar-conn-a", source: "cloud", readAt: "2026-10-30T09:59:55.000Z", durationMs: 9000, outcome: "page_changed", itemsSeen: 0, itemsNew: 0, factor: 1 });
      expect(buyRead).toMatchObject({ kind: "purchase", pages: 3, outcome: "page_changed" });
      expect(await repos.radarReads.countLiveSince(tx, "2026-10-30T09:59:00.000Z")).toBe(5);
      expect(await repos.radarReads.liveWindow(tx, 1)).toEqual({ reads: 3, blocks: 0 });
      await repos.radarReads.setItemsNew(tx, buyRead.id, 4);
      expect((await repos.radarReads.list(tx, { limit: 1 }))[0]).toMatchObject({ id: buyRead.id, itemsNew: 4 });
      await tx.query("delete from radar_reads where id = $1", [buyRead.id]);

      // Abonnements Web Push : adresse unique, réabonnement remis à zéro, désactivation et échecs.
      const sub = await repos.pushSubscriptions.upsert(tx, { userId: userA.id, endpoint: "https://push.example/abc", p256dh: "p".repeat(40), auth: "a".repeat(16), userAgent: "Mozilla/5.0 ".repeat(30) });
      expect(sub.userAgent?.length).toBe(120);
      expect(await repos.pushSubscriptions.markFailure(tx, sub.id, now.toISOString(), 2)).toMatchObject({ failures: 1, disabledAt: null });
      expect(await repos.pushSubscriptions.markFailure(tx, sub.id, now.toISOString(), 2)).toMatchObject({ failures: 2, disabledAt: now.toISOString() });
      expect(await repos.pushSubscriptions.listActive(tx)).toHaveLength(0);
      const again = await repos.pushSubscriptions.upsert(tx, { userId: userA.id, endpoint: "https://push.example/abc", p256dh: "q".repeat(40), auth: "b".repeat(16), userAgent: null });
      expect(again).toMatchObject({ id: sub.id, failures: 0, disabledAt: null, p256dh: "q".repeat(40) });
      await repos.pushSubscriptions.markUsed(tx, sub.id, now.toISOString());
      expect((await repos.pushSubscriptions.listActive(tx, userA.id)).map((x) => x.lastUsedAt)).toEqual([now.toISOString()]);
      expect(await repos.pushSubscriptions.listActive(tx, userB.id)).toHaveLength(0);
      expect((await repos.pushSubscriptions.listActive(tx))[0]).toMatchObject({ role: "owner" });
      // Abonnement d'un utilisateur qui n'est pas (ou plus) membre de l'organisation : jamais servi.
      await repos.pushSubscriptions.upsert(tx, { userId: userB.id, endpoint: "https://push.example/non-membre", p256dh: "p".repeat(40), auth: "a".repeat(16), userAgent: null });
      expect((await repos.pushSubscriptions.listActive(tx)).map((x) => x.endpoint)).toEqual(["https://push.example/abc"]);
      expect(await repos.pushSubscriptions.removeForUser(tx, tx.orgId!, userB.id)).toBe(1);
      expect(await repos.pushSubscriptions.removeById(tx, sub.id, userB.id)).toBe(false);
      await repos.pushSubscriptions.disable(tx, sub.id, now.toISOString());
      expect(await repos.pushSubscriptions.listActive(tx)).toHaveLength(0);

      // File d'alertes : une seule par affaire, prise conditionnelle, envoi, rétention.
      const payload = { title: "Affaire Radar : Pull Ralph Lauren", body: "15,00 € · note 88 · revente estimée 40,00 €", url: `/app/radar/affaires/${opp.id}` };
      const alert = await repos.radarAlerts.enqueue(tx, { kind: "opportunity", opportunityId: opp.id, dedupeKey: `opportunity:${opp.id}`, payload, scheduledFor: now.toISOString() });
      expect(alert).toMatchObject({ status: "queued", attempts: 0, channel: "push", payload });
      expect(await repos.radarAlerts.enqueue(tx, { kind: "opportunity", opportunityId: opp.id, dedupeKey: `opportunity:${opp.id}`, payload, scheduledFor: now.toISOString() })).toBeNull();
      expect(await repos.radarAlerts.enqueue(tx, { kind: "opportunity", opportunityId: opp.id, dedupeKey: `autre:${opp.id}`, payload, scheduledFor: now.toISOString() })).toBeNull();
      expect(await repos.radarAlerts.due(tx, "2026-10-30T09:00:00.000Z")).toHaveLength(0);
      expect((await repos.radarAlerts.due(tx, now.toISOString())).map((a) => a.id)).toEqual([alert!.id]);
      expect(await repos.radarAlerts.claim(tx, alert!.id, 0, "2026-10-30T10:02:00.000Z")).toMatchObject({ attempts: 1 });
      expect(await repos.radarAlerts.claim(tx, alert!.id, 0, "2026-10-30T10:02:00.000Z")).toBeNull();
      expect(await repos.radarAlerts.due(tx, now.toISOString())).toHaveLength(0);
      await repos.radarAlerts.markSent(tx, alert!.id, now.toISOString());
      expect(await repos.radarAlerts.byDedupeKey(tx, `opportunity:${opp.id}`)).toMatchObject({ status: "sent", sentAt: now.toISOString() });
      expect(await repos.radarAlerts.purgeOlderThan(tx, 90, new Date("2027-03-01T00:00:00.000Z"))).toBe(1);

      // Cache des embeddings : un vecteur par (sorte, référence, modèle), mis à jour si le texte change.
      expect(await repos.embeddingsCache.put(tx, [{ kind: "sale", ref: "o1", model: "m1", textHash: "h1", vector: [0.1, 0.2] }, { kind: "sale", ref: "o2", model: "m1", textHash: "h2", vector: [] }])).toBe(1);
      await repos.embeddingsCache.put(tx, [{ kind: "sale", ref: "o1", model: "m1", textHash: "h1b", vector: [0.3, 0.4, 0.5] }, { kind: "sale", ref: "o1", model: "m2", textHash: "h1", vector: [1] }]);
      const cached = await repos.embeddingsCache.get(tx, "sale", ["o1", "o2"], "m1");
      expect([...cached.entries()]).toEqual([["o1", { vector: [0.3, 0.4, 0.5], textHash: "h1b" }]]);
      expect(await repos.embeddingsCache.count(tx)).toBe(2);

      // Achats : montant engagé (réservation de l'achat automatique comprise), attente 3-D Secure, délais.
      const base = { opportunityId: opp.id, maxPriceCents: 2000, budgetCents: 5000 };
      const p1 = await repos.purchases.create(tx, { ...base, dedupeKey: `purchase:${opp.id}`, status: "awaiting_3ds", mode: "auto", totalCents: 1820, awaiting3dsUntil: "2026-10-30T10:15:00.000Z", confirmedAt: now.toISOString() });
      expect(p1).toMatchObject({ status: "awaiting_3ds", totalCents: 1820, orderRef: null, reportedItemId: null });
      expect(await repos.purchases.spentSince(tx, "2026-10-30T00:00:00.000Z")).toBe(1820);
      expect(await repos.purchases.spentSince(tx, "2026-10-30T00:00:00.000Z", p1.id)).toBe(0);
      expect(await repos.purchases.awaiting3dsCount(tx)).toBe(1);
      // Plafond du jour : une demande bloquée ou annulée dont « Payer » a été cliqué reste comptée ;
      // un achat fait à la main par le client n'entre pas dans le plafond de Radar Auto.
      const opp2 = await repos.opportunities.create(tx, { searchId: search.id, title: "Pull 2", observed: { ...opp.observed, externalRef: "5252" }, estimate: opp.estimate, score: 50 });
      const opp3 = await repos.opportunities.create(tx, { searchId: search.id, title: "Pull 3", observed: { ...opp.observed, externalRef: "5353" }, estimate: opp.estimate, score: 50 });
      const uncertain = await repos.purchases.create(tx, { opportunityId: opp2.id, maxPriceCents: 3000, budgetCents: 5000, dedupeKey: `purchase:${opp2.id}`, status: "blocked", mode: "auto", paymentAttempted: true, confirmedAt: now.toISOString() });
      expect(uncertain.paymentAttempted).toBe(true);
      await repos.purchases.create(tx, { opportunityId: opp3.id, maxPriceCents: 900, budgetCents: 5000, dedupeKey: `purchase:${opp3.id}`, status: "simulated", mode: "manual", totalCents: 900, executedAt: now.toISOString() });
      expect(await repos.purchases.spentSince(tx, "2026-10-30T00:00:00.000Z")).toBe(1820 + 3000);
      const draft = await repos.purchases.create(tx, { opportunityId: opp3.id, maxPriceCents: 900, budgetCents: 5000, dedupeKey: `purchase-draft:${opp3.id}`, status: "draft", mode: "auto" });
      expect(await repos.purchases.deleteDraft(tx, draft.id)).toBe(true);
      expect(await repos.purchases.deleteDraft(tx, uncertain.id)).toBe(false);
      await tx.query("delete from purchase_requests where opportunity_id in ($1, $2)", [opp2.id, opp3.id]);
      await tx.query("delete from opportunities where id in ($1, $2)", [opp2.id, opp3.id]);
      expect(await repos.purchases.awaiting3dsExpired(tx, "2026-10-30T10:10:00.000Z")).toHaveLength(0);
      expect((await repos.purchases.awaiting3dsExpired(tx, "2026-10-30T10:16:00.000Z")).map((p) => p.id)).toEqual([p1.id]);
      const item = await repos.items.create(tx, { title: "Pull Ralph Lauren", purchasePriceCents: 1820, status: "in_stock", tags: ["radar"] });
      await repos.purchases.update(tx, p1.id, { status: "executed", executedAt: "2026-10-30T10:01:30.000Z", realPurchaseEnabled: true, orderRef: "V-123", reportedItemId: item.id });
      expect(await repos.purchases.detectToPurchaseDelays(tx, "2026-10-01T00:00:00.000Z")).toEqual([{ detectedAt: now.toISOString(), executedAt: "2026-10-30T10:01:30.000Z" }]);
    });

    // RLS : l'organisation B ne voit rien de A ; un appareil qui s'abonne pour B quitte A.
    await app.withOrg(orgB.id, async (tx) => {
      expect(await tx.query("select id from radar_reads")).toHaveLength(0);
      expect(await tx.query("select id from radar_alerts")).toHaveLength(0);
      expect(await tx.query("select id from embeddings_cache")).toHaveLength(0);
      expect(await repos.pushSubscriptions.list(tx)).toHaveLength(0);
      const moved = await repos.pushSubscriptions.upsert(tx, { userId: userB.id, endpoint: "https://push.example/abc", p256dh: "r".repeat(40), auth: "c".repeat(16), userAgent: null });
      expect(moved.orgId).toBe(orgB.id);
    });
    await expect(app.withOrg(orgB.id, (tx) => tx.query("insert into radar_reads (org_id, outcome) values ($1, 'ok')", [orgA.id]))).rejects.toBeInstanceOf(Error);
    expect(await app.withOrg(orgA.id, (tx) => repos.pushSubscriptions.list(tx))).toHaveLength(0);
    // Une seule demande active par affaire (index unique partiel).
    await expect(app.withOrg(orgA.id, (tx) => repos.purchases.create(tx, { opportunityId: opp.id, maxPriceCents: 2000, budgetCents: 5000, dedupeKey: `purchase:${opp.id}`, status: "draft", mode: "auto" }))).rejects.toMatchObject({ code: "conflict" });
    expect(await app.withGlobal((tx) => tx.query("select id from push_subscriptions"))).toHaveLength(0);
    expect(await app.withGlobal((tx) => repos.radarOrgs.ids(tx))).toContain(orgA.id);

    // Purge : données du vendeur effacées après 30 jours, affaire écartée supprimée (avec ses alertes).
    await app.withOrg(orgA.id, async (tx) => {
      await tx.query("update opportunities set created_at = $2 where id = $1", [opp.id, "2026-09-01T00:00:00.000Z"]);
      expect(await repos.opportunities.purgeSellerData(tx, 30, now)).toEqual({ deleted: 0, stripped: 1 });
      const stripped = await repos.opportunities.byId(tx, opp.id);
      expect(stripped.observed).toMatchObject({ sellerHandle: null, sellerRating: null, sellerReviews: null, photoUrl: null, url: null, externalRef: "4242", priceCents: 1500 });
      expect(await repos.opportunities.purgeSellerData(tx, 30, now)).toEqual({ deleted: 0, stripped: 0 });
      await repos.radarAlerts.enqueue(tx, { kind: "opportunity", opportunityId: opp.id, dedupeKey: `opportunity:${opp.id}:2`, payload: { title: "t", body: "b", url: "/app/radar" }, scheduledFor: now.toISOString() }).catch(() => null);
      await repos.opportunities.update(tx, opp.id, { status: "dismissed" });
      await tx.query("update opportunities set updated_at = $2 where id = $1", [opp.id, "2026-09-15T00:00:00.000Z"]);
      expect(await repos.opportunities.purgeSellerData(tx, 30, now)).toEqual({ deleted: 1, stripped: 0 });
      expect(await tx.count("select count(*) from radar_alerts where opportunity_id = $1", [opp.id])).toBe(0);
    });
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
