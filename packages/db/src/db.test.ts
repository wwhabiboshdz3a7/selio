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

  it("0013 : Selio Track et prix — RLS des tables d'organisation, lectures partagées par fonctions seulement, références sans donnée personnelle, un seul modèle actif", async () => {
    if (!available) return;
    const { PRICE_REFERENCE_KEYS, PLAN_QUOTAS } = await import("@selio/contracts");
    await owner.pool.query("truncate track_filter_reads, track_snapshots, price_models");
    await owner.pool.query("update track_runtime set window_measures = '', slowdown_factor = 1, last_block_at = null, paused_until = null, pause_reason = null");
    const tables = await owner.withGlobal((tx) => tx.query<{ tablename: string; rowsecurity: boolean; forcerls: boolean }>("select c.relname as tablename, c.relrowsecurity as rowsecurity, c.relforcerowsecurity as forcerls from pg_class c where c.relname in ('track_filters', 'track_scans', 'track_photo_searches') and c.relkind = 'r' order by 1"));
    expect(tables).toEqual([
      { tablename: "track_filters", rowsecurity: true, forcerls: true },
      { tablename: "track_photo_searches", rowsecurity: true, forcerls: true },
      { tablename: "track_scans", rowsecurity: true, forcerls: true },
    ]);
    // Aucune colonne de photo, de pseudo ou de titre dans les tables de Track et de prix.
    const cols = await owner.withGlobal((tx) => tx.query<{ tableName: string; columnName: string }>("select table_name, column_name from information_schema.columns where table_name in ('track_filters', 'track_filter_reads', 'track_snapshots', 'track_scans', 'track_photo_searches', 'price_references', 'price_models')"));
    expect(cols.filter((c) => /photo_url|photo$|seller|handle|pseudo|title|url/.test(c.columnName))).toEqual([]);

    const { orgA, orgB } = await owner.withGlobal(async (tx) => ({
      orgA: await repos.orgs.create(tx, { name: "Track A", slug: "track-a", settings: {} }),
      orgB: await repos.orgs.create(tx, { name: "Track B", slug: "track-b", settings: {} }),
    }));
    await owner.withGlobal(async (tx) => {
      await tx.insert("subscriptions", { orgId: orgA.id, plan: "pro", status: "active", quotas: PLAN_QUOTAS.pro });
      await tx.insert("subscriptions", { orgId: orgB.id, plan: "agence", status: "active", quotas: PLAN_QUOTAS.agence });
    });
    const fp = "a".repeat(64);
    const other = "b".repeat(64);
    const criteria = { brands: ["Levi's"], categories: ["men" as const], sizes: [], conditions: [], keywords: ["jean"], maxPriceCents: 4000 };
    const now = "2026-10-30T10:00:00.000Z";

    // Filtres : RLS, unicité (organisation, empreinte), aucun accès direct aux lectures partagées.
    const fA = await app.withOrg(orgA.id, async (tx) => {
      const f = await repos.trackFilters.create(tx, { name: "Jeans Levi's", criteria, fingerprint: fp, enabled: true });
      await repos.trackReads.follow(tx, fp, criteria, now);
      // Une empreinte que l'organisation ne suit pas n'est pas créée.
      await repos.trackReads.follow(tx, other, criteria, now);
      return f;
    });
    await expect(app.withOrg(orgA.id, (tx) => repos.trackFilters.create(tx, { name: "Doublon", criteria, fingerprint: fp, enabled: true }))).rejects.toMatchObject({ code: "conflict" });
    await app.withOrg(orgB.id, async (tx) => {
      expect(await repos.trackFilters.list(tx)).toHaveLength(0);
      await repos.trackFilters.create(tx, { name: "Mêmes jeans", criteria, fingerprint: fp, enabled: true });
      await repos.trackReads.follow(tx, fp, criteria, "2026-10-30T12:00:00.000Z");
      // Report demandé par B : la ligne est suivie (filtre actif) par A, son rythme est gardé.
      await repos.trackReads.follow(tx, fp, criteria, "2026-10-30T12:00:00.000Z", true);
      // L'état d'une empreinte n'est rendu qu'aux organisations qui la suivent.
      expect([...(await repos.trackReads.state(tx, [fp, other])).keys()]).toEqual([fp]);
    });
    await expect(app.withGlobal((tx) => tx.query("select * from track_filter_reads"))).rejects.toBeInstanceOf(Error);
    await expect(app.withGlobal((tx) => tx.query("select ref_salt from track_runtime"))).rejects.toBeInstanceOf(Error);
    await expect(app.withGlobal((tx) => tx.query("select ref_store_salt from track_runtime"))).rejects.toBeInstanceOf(Error);
    await expect(app.withOrg(orgA.id, (tx) => tx.query("update track_filter_reads set next_read_at = now()"))).rejects.toBeInstanceOf(Error);
    expect(await owner.withGlobal((tx) => tx.count("select count(*) from track_filter_reads"))).toBe(1);

    // Une seule lecture par empreinte, quelle que soit la quantité de clients ; prise conditionnelle.
    const due = await app.withGlobal((tx) => repos.trackReads.due(tx, now, 10));
    expect(due.map((d) => d.fingerprint)).toEqual([fp]);
    expect(due[0]!.criteria).toMatchObject({ brands: ["Levi's"], keywords: ["jean"] });
    const claimed = await app.withGlobal((tx) => repos.trackReads.claim(tx, fp, now, "2026-10-30T10:10:00.000Z"));
    expect(claimed).toMatchObject({ reads: 0, stateSource: null, consecutiveFailures: 0 });
    expect(await app.withGlobal((tx) => repos.trackReads.claim(tx, fp, now, "2026-10-30T10:10:00.000Z"))).toBeNull();
    expect(await app.withGlobal((tx) => repos.trackReads.due(tx, now, 10))).toHaveLength(0);
    const keys = await app.withGlobal((tx) => repos.trackReads.refKeys(tx, ["12345", "12345", "67890"]));
    expect(keys.size).toBe(2);
    expect(keys.get("12345")).toMatch(/^[a-f0-9]{64}$/);
    expect(keys.get("12345")).not.toContain("12345");
    expect((await app.withGlobal((tx) => repos.trackReads.refKeys(tx, ["12345"]))).get("12345")).toBe(keys.get("12345"));
    await app.withGlobal((tx) => repos.trackReads.finish(tx, { fingerprint: fp, readAt: now, nextReadAt: "2026-10-30T12:00:00.000Z", outcome: "ok", counted: true, blocked: false, anomaly: false, factor: 1, state: [{ k: keys.get("12345"), p: 2500, f: now, d: null }], stateSource: "demo" }));
    await app.withOrg(orgA.id, async (tx) => {
      expect((await repos.trackReads.state(tx, [fp])).get(fp)).toMatchObject({ lastReadAt: now, nextReadAt: "2026-10-30T12:00:00.000Z", reads: 1, lastOutcome: "ok", factor: 1 });
    });
    // Fenêtre partagée : une lettre par lecture en direct, 1 000 au plus ; pause jamais raccourcie ; une lecture
    // sans blocage (facteur null) ne réécrit ni le facteur ni la date du dernier blocage.
    await app.withGlobal(async (tx) => {
      await repos.trackReads.recordRuntime(tx, { blocked: false, factor: null, blockAt: null, pauseUntil: null, pauseReason: null });
      await repos.trackReads.recordRuntime(tx, { blocked: true, factor: 2, blockAt: now, pauseUntil: "2026-10-30T11:00:00.000Z", pauseReason: "captcha" });
      await repos.trackReads.recordRuntime(tx, { blocked: true, factor: 4, blockAt: now, pauseUntil: "2026-10-30T10:30:00.000Z", pauseReason: "blocked" });
      await repos.trackReads.recordRuntime(tx, { blocked: false, factor: null, blockAt: null, pauseUntil: null, pauseReason: null });
      expect(await repos.trackReads.runtime(tx)).toMatchObject({ windowReads: 4, windowBlocks: 2, slowdownFactor: 4, lastBlockAt: now, pausedUntil: "2026-10-30T11:00:00.000Z" });
    });

    // Instantanés : partagés par empreinte, sans donnée d'organisation.
    await app.withGlobal(async (tx) => {
      const snap = { fingerprint: fp, source: "demo" as const, readAt: now, listedCount: 40, medianPriceCents: 2500, p25Cents: 1800, p75Cents: 3200, newCount: 4, goneCount: 3, medianDaysListed: 6.5, brandShares: [{ brand: "Levi's", count: 40, share: 1 }], scope: { categories: ["men" as const], brands: ["Levi's"], categoriesVerified: true } };
      expect(await repos.trackSnapshots.add(tx, snap)).toMatchObject({ listedCount: 40, medianDaysListed: 6.5, brandShares: [{ brand: "Levi's", count: 40, share: 1 }] });
      expect(await repos.trackSnapshots.add(tx, snap)).toBeNull();
      await repos.trackSnapshots.add(tx, { ...snap, readAt: "2025-06-01T10:00:00.000Z" });
      await repos.trackSnapshots.add(tx, { ...snap, fingerprint: other, readAt: "2026-10-29T10:00:00.000Z", scope: { categories: ["women"], brands: [], categoriesVerified: true } });
      // Catégorie non appliquée à la page (lecture en direct) ou toutes catégories : ne compte pour aucune.
      await repos.trackSnapshots.add(tx, { ...snap, fingerprint: "c".repeat(64), scope: { categories: ["men"], brands: [], categoriesVerified: false } });
      await repos.trackSnapshots.add(tx, { ...snap, fingerprint: "d".repeat(64), scope: { categories: [], brands: [], categoriesVerified: true } });
      expect((await repos.trackSnapshots.since(tx, fp, "2026-10-01T00:00:00.000Z")).map((s) => s.readAt)).toEqual([now]);
      expect((await repos.trackSnapshots.latestForCategory(tx, "men", "2026-10-01T00:00:00.000Z")).map((s) => s.fingerprint)).toEqual([fp]);
    });

    // Scans et recherches par photo : RLS, aucune photo.
    await app.withOrg(orgA.id, async (tx) => {
      await repos.trackScans.create(tx, { brand: "Levi's", category: "men", status: "ok", score: 72, components: { demand: 80, speed: 60, competition: 70, margin: 75 }, basedOn: { references: 40, snapshots: 2, sold: 12, demo: true }, details: { medianDaysToSell: 6, activeListings: 28, medianResaleCents: 2500, medianBuyCents: 1200 }, message: null });
      const est = { p25: 2000, p50: 2500, p75: 3000, delayDays: 7, confidence: 0.6, confidenceLevel: "medium" as const, method: "comparables" as const, strategies: { fast: 2000, standard: 2500, max: 3000 }, comparableCount: 8, factors: [], demo: false, message: null };
      await repos.trackPhotoSearches.create(tx, { description: { title: "Jean Levi's bleu", brand: "Levi's", category: "men", subcategory: "Jean", material: "Denim", color: "Bleu", condition: "very_good", confidence: 0.6 }, estimate: est, simulated: true });
    });
    await app.withOrg(orgB.id, async (tx) => {
      expect(await repos.trackScans.list(tx)).toHaveLength(0);
      expect(await repos.trackPhotoSearches.list(tx)).toHaveLength(0);
    });
    await expect(app.withOrg(orgB.id, (tx) => tx.query("insert into track_scans (org_id, category) values ($1, 'men')", [orgA.id]))).rejects.toBeInstanceOf(Error);
    expect(await app.withOrg(orgA.id, (tx) => repos.trackScans.purgeBefore(tx, "2026-11-30T00:00:00.000Z"))).toBe(1);

    // Références : dédoublonnage, mise à jour (disparue → prix final estimé), aucune clé personnelle rendue.
    await app.withGlobal(async (tx) => {
      const base = { dedupeKey: `track:${keys.get("12345")}`, source: "track" as const, status: "listed" as const, brand: "Levi's", category: "men" as const, size: "W32", condition: "very_good" as const, listedPriceCents: 2500, listedAt: "2026-10-20T10:00:00.000Z", photoCount: 5 };
      expect(await repos.priceReferences.upsertMany(tx, [base, { ...base, listedPriceCents: 2400 }, { ...base, dedupeKey: "demo:0000001", source: "demo", listedPriceCents: 900 }])).toBe(2);
      await repos.priceReferences.upsertMany(tx, [{ ...base, status: "gone", size: null, finalPriceCents: 2400, finalPriceEstimated: true, soldAt: now, listedPriceCents: 2400, contributorOrgId: null }]);
      await repos.priceReferences.upsertMany(tx, [{ dedupeKey: "sale:abcdef0123", source: "sale", status: "sold", brand: "Levi's", category: "men", listedPriceCents: 3000, finalPriceCents: 2800, listedAt: "2026-10-01T10:00:00.000Z", soldAt: "2026-10-15T10:00:00.000Z", contributorOrgId: orgA.id }]);
      const refs = await repos.priceReferences.search(tx, { category: "men", brand: "levi's", withFinalPrice: true });
      expect(refs.map((r) => r.source).sort()).toEqual(["sale", "track"]);
      const gone = refs.find((r) => r.source === "track")!;
      expect(gone).toMatchObject({ status: "gone", size: "W32", finalPriceCents: 2400, finalPriceEstimated: true, soldAt: now, listedAt: "2026-10-20T10:00:00.000Z" });
      for (const r of refs) expect(Object.keys(r).sort()).toEqual([...PRICE_REFERENCE_KEYS].sort());
      expect(await repos.priceReferences.search(tx, { category: "men", includeDemo: true })).toHaveLength(3);
      expect(await repos.priceReferences.countBySource(tx)).toEqual({ track: 1, sale: 1, demo: 1, import: 0 });
      expect(await repos.priceReferences.soldBySource(tx)).toEqual({ sold: { track: 1, sale: 1, demo: 0, import: 0 }, estimated: { track: 1, sale: 0, demo: 0, import: 0 } });
    });
    // La vente versée par A n'est rendue qu'à A (agrégats) ; jamais à B, ni sans organisation.
    const since2026 = "2026-01-01T00:00:00.000Z";
    await app.withOrg(orgA.id, async (tx) => {
      expect(await repos.priceReferences.nicheStats(tx, { category: "men", brand: "LEVI'S", since: since2026, includeDemo: false })).toMatchObject({ total: 2, sold: 2, active: 0, medianFinalCents: 2600, medianDaysToSell: 12 });
      expect(await repos.priceReferences.salesByNiche(tx, { since: "2026-10-01T00:00:00.000Z", includeDemo: false })).toEqual([{ brand: "Levi's", category: "men", sold: 2, estimatedShare: 0.5, medianPriceCents: 2600, lastSoldAt: now }]);
    });
    await app.withOrg(orgB.id, async (tx) => {
      expect(await repos.priceReferences.nicheStats(tx, { category: "men", brand: "LEVI'S", since: since2026, includeDemo: false })).toMatchObject({ total: 1, sold: 1, medianFinalCents: 2400 });
      expect(await repos.priceReferences.salesByNiche(tx, { since: "2026-10-01T00:00:00.000Z", includeDemo: false })).toEqual([{ brand: "Levi's", category: "men", sold: 1, estimatedShare: 1, medianPriceCents: 2400, lastSoldAt: now }]);
      expect((await repos.priceReferences.nicheSummary(tx, { since: since2026, includeDemo: false })).map((r) => r.sold)).toEqual([1]);
    });

    // Références de Track écrites par la base : clé dérivée avec un autre sel (jamais la clé d'état), dates
    // au jour, photos par tranches, dernière ligne d'une clé gagnante.
    await app.withGlobal(async (tx) => {
      const k = keys.get("67890")!;
      expect(await repos.trackReads.storeReferences(tx, "track", [
        { key: k, status: "listed", brand: " Nike ", category: "shoes", size: "42", condition: "good", listedPriceCents: 3000, listedAt: "2026-10-28T17:45:12.000Z", photoCount: 7 },
        { key: k, status: "gone", category: "shoes", listedPriceCents: 2900, finalPriceCents: 2900, finalPriceEstimated: true, listedAt: "2026-10-28T17:45:12.000Z", soldAt: "2026-10-30T09:59:00.000Z", photoCount: 3 },
        { key: "pas-une-cle", status: "listed", category: "shoes" },
      ])).toBe(1);
      const [nike] = await repos.priceReferences.search(tx, { category: "shoes" });
      expect(nike).toMatchObject({ source: "track", status: "gone", brand: null, finalPriceCents: 2900, finalPriceEstimated: true, listedAt: "2026-10-28T00:00:00.000Z", soldAt: "2026-10-30T00:00:00.000Z", photoCount: 2 });
      expect(nike!.dedupeKey).toMatch(/^track:[a-f0-9]{64}$/);
      expect(nike!.dedupeKey).not.toBe(`track:${k}`);
      // Retrait des ventes d'une organisation (remboursée, ou accord retiré), puis conservation (24 mois).
      const sale = { dedupeKey: "sale:abcdef0123", source: "sale" as const, status: "sold" as const, brand: "Levi's", category: "men" as const, listedPriceCents: 3000, finalPriceCents: 2800, listedAt: "2026-10-01T10:00:00.000Z", soldAt: "2026-10-15T10:00:00.000Z", contributorOrgId: orgA.id };
      expect(await repos.priceReferences.deleteContributed(tx, orgA.id, ["sale:abcdef0123"])).toBe(0);
      expect(await repos.priceReferences.deleteContributed(tx, orgA.id)).toBe(1);
      expect(await repos.priceReferences.countBySource(tx)).toMatchObject({ sale: 0, track: 2, demo: 1 });
      await repos.priceReferences.upsertMany(tx, [sale]);
      // Vendue le 15 octobre : effacée par une purge au 16 ; le reste (après le 16) est gardé.
      expect(await repos.priceReferences.purgeBefore(tx, "2026-10-16T00:00:00.000Z")).toBe(1);
      expect(await repos.priceReferences.countBySource(tx)).toMatchObject({ sale: 0, track: 2, demo: 1 });
      await repos.priceReferences.upsertMany(tx, [sale]);
    });

    // Réservation d'une place de quota : enregistrée, puis rendue ; verrou par organisation et compteur.
    await app.withOrg(orgA.id, async (tx) => {
      await repos.usage.lock(tx, "track.photo_search");
      const id = await repos.usage.record(tx, "track.photo_search", {}, 1, "2026-10-30T10:00:00.000Z");
      expect(await repos.usage.sumKindSince(tx, "track.photo_search", "2026-10-01T00:00:00.000Z")).toBe(1);
      expect(await repos.usage.remove(tx, id)).toBe(true);
      expect(await repos.usage.sumKindSince(tx, "track.photo_search", "2026-10-01T00:00:00.000Z")).toBe(0);
    });

    // Modèles : un seul actif, l'ancien archivé.
    await app.withGlobal(async (tx) => {
      expect(await repos.priceModels.active(tx)).toBeNull();
      await repos.priceModels.activate(tx, { version: "gb-2026-10-23", trainedAt: "2026-10-23T03:00:00.000Z", nReferences: 300, metrics: { maeCents: 410 }, model: { trees: [] }, synthetic: true });
      await repos.priceModels.activate(tx, { version: "gb-2026-10-30", trainedAt: now, nReferences: 350, metrics: { maeCents: 380 }, model: { trees: [1] }, synthetic: false });
      expect(await repos.priceModels.active(tx)).toMatchObject({ version: "gb-2026-10-30", status: "active", synthetic: false, model: { trees: [1] }, metrics: { maeCents: 380 } });
      expect((await repos.priceModels.list(tx)).map((m) => `${m.version}:${m.status}`)).toEqual(["gb-2026-10-30:active", "gb-2026-10-23:archived"]);
    });
    await expect(owner.withGlobal((tx) => tx.query("insert into price_models (version, trained_at, model, status) values ('x', now(), '{}'::jsonb, 'active')"))).rejects.toMatchObject({ code: "conflict" });

    // Rétention : historique du plan le plus long (Agence, 12 mois : juin 2025 part) ; les instantanés d'une
    // empreinte que personne ne suit partent aussi.
    expect(await app.withGlobal((tx) => repos.trackReads.purge(tx, now))).toEqual({ snapshots: 4, fingerprints: 0 });
    await app.withOrg(orgB.id, async (tx) => { await tx.query("delete from track_filters"); });
    // Suivie seulement par A (Pro, 3 mois) : l'instantané d'octobre reste.
    expect(await app.withGlobal((tx) => repos.trackReads.purge(tx, now))).toEqual({ snapshots: 0, fingerprints: 0 });
    await app.withOrg(orgA.id, (tx) => repos.trackFilters.delete(tx, fA.id));
    expect(await app.withGlobal((tx) => repos.trackReads.purge(tx, now))).toEqual({ snapshots: 1, fingerprints: 1 });
    // Une organisation supprimée emporte les références de ventes qu'elle avait fournies.
    await owner.withGlobal((tx) => tx.query("delete from organizations where id = $1", [orgA.id]));
    expect(await app.withGlobal((tx) => repos.priceReferences.countBySource(tx))).toMatchObject({ sale: 0, track: 2 });
  });

  it("0014 : Studio — préparations et photos portées isolées par RLS, références de tailles en lecture seule (écriture par fonctions), dépassement facturé une fois", async () => {
    if (!available) return;
    await owner.pool.query("truncate size_references");
    const { orgA, orgB } = await owner.withGlobal(async (tx) => ({
      orgA: await repos.orgs.create(tx, { name: "Org Studio A", slug: "org-studio-a", settings: {} }),
      orgB: await repos.orgs.create(tx, { name: "Org Studio B", slug: "org-studio-b", settings: {} }),
    }));
    const keyA = `org/${orgA.id}/studio-photo/p1.jpg`;

    // Préparations : une ligne par article, clés et rôles des photos (jamais l'image), isolées par RLS.
    const prep = await app.withOrg(orgA.id, (tx) => repos.studioPreps.create(tx, {
      batchId: "batch-1", articleGroup: 1, photos: [{ index: 0, id: "p1", key: keyA, role: "label", confidence: 0.9 }],
      fields: { brand: { value: "Zara", source: "label", confidence: 0.95 }, size: { value: null, source: null } },
      measurements: [{ name: "chest", valueCm: null, source: null, question: "Mesurez la poitrine." }], questions: [{ field: "chest", reason: "no_tape", text: "Mesurez la poitrine." }],
      warnings: [], details: { tapeVisible: false }, garment: "top", category: "women", simulated: false,
    }));
    expect(prep).toMatchObject({ status: "draft", articleGroup: 1, garment: "top", shareMeasurements: false, validatedAt: null });
    expect(prep.fields).toMatchObject({ brand: { value: "Zara", source: "label" } });
    expect(await app.withOrg(orgB.id, (tx) => repos.studioPreps.byId(tx, prep.id))).toBeNull();
    expect(await app.withOrg(orgB.id, (tx) => tx.query("select id from studio_preps"))).toHaveLength(0);
    await expect(app.withOrg(orgB.id, (tx) => tx.query("insert into studio_preps (org_id, batch_id) values ($1, 'x')", [orgA.id]))).rejects.toBeInstanceOf(Error);
    const validated = await app.withOrg(orgA.id, (tx) => repos.studioPreps.update(tx, prep.id, { status: "validated", validatedAt: "2026-11-04T10:00:00.000Z", shareMeasurements: true }));
    expect(validated).toMatchObject({ status: "validated", shareMeasurements: true, validatedAt: "2026-11-04T10:00:00.000Z" });
    expect((await app.withOrg(orgA.id, (tx) => repos.studioPreps.byBatch(tx, "batch-1"))).map((p) => p.id)).toEqual([prep.id]);
    await expect(app.withOrg(orgA.id, (tx) => tx.query("update studio_preps set status = 'publiée' where id = $1", [prep.id]))).rejects.toMatchObject({ code: "validation" });
    // Rétention : seuls les brouillons partent.
    const draft = await app.withOrg(orgA.id, (tx) => repos.studioPreps.create(tx, { batchId: "batch-0", articleGroup: 1, photos: [], fields: {}, measurements: [], questions: [], warnings: [], details: {}, garment: null, category: null, simulated: true, createdAt: "2026-09-01T00:00:00.000Z" }));
    expect(await app.withOrg(orgA.id, (tx) => repos.studioPreps.purgeDraftsBefore(tx, "2026-10-01T00:00:00.000Z"))).toBe(1);
    expect(await app.withOrg(orgA.id, (tx) => repos.studioPreps.byId(tx, draft.id))).toBeNull();

    // Références de tailles : lecture pour tous, aucune écriture directe pour le rôle applicatif.
    await expect(app.withGlobal((tx) => tx.query("insert into size_references (brand, reference, measurements, source) values ('X', 'AB12', '{\"chest\": 50}', 'provided')"))).rejects.toBeInstanceOf(Error);
    const provided = await app.withGlobal((tx) => repos.sizeReferences.provide(tx, { brand: "Levi's", reference: "501-0115", size: "W32 L32", category: "bottom", measurements: { waist: 41, inseam: 81 } }));
    expect(provided).toMatchObject({ brand: "Levi's", reference: "501-0115", size: "W32 L32", category: "bottom", source: "provided", measurements: { waist: 41, inseam: 81 } });
    await expect(app.withGlobal((tx) => tx.query("update size_references set measurements = '{\"waist\": 1}'"))).rejects.toBeInstanceOf(Error);
    // Clés normalisées : « LEVIS » / « 501 0115 » / « w32l32 » retrouvent la même ligne ; la contribution d'un vendeur ne la modifie jamais.
    expect((await app.withOrg(orgB.id, (tx) => repos.sizeReferences.findAll(tx, "LEVIS", "501 0115"))).map((r) => r.size)).toEqual(["W32 L32"]);
    expect(await app.withOrg(orgB.id, (tx) => repos.sizeReferences.contribute(tx, { brand: "levis", reference: "5010115", size: "w32l32", category: "bottom", measurements: { waist: 99, rise: 30 } }))).toBeNull();
    expect((await app.withGlobal((tx) => repos.sizeReferences.findAll(tx, "Levi's", "501-0115")))[0]!.measurements).toEqual({ waist: 41, inseam: 81 });
    // Contribution « seller_validated » : ajoute seulement les mesures manquantes, ne remplace jamais une mesure connue.
    const c1 = await app.withOrg(orgB.id, (tx) => repos.sizeReferences.contribute(tx, { brand: "Zara", reference: "ZR-0001", size: "M", category: "top", measurements: { chest: 52 } }));
    expect(c1).toMatchObject({ source: "seller_validated" });
    await app.withOrg(orgA.id, (tx) => repos.sizeReferences.contribute(tx, { brand: "ZARA", reference: "zr 0001", size: "m", category: "top", measurements: { chest: 60, length: 70 } }));
    const zara = await app.withGlobal((tx) => repos.sizeReferences.findAll(tx, "zara", "ZR0001"));
    expect(zara).toHaveLength(1);
    expect(zara[0]).toMatchObject({ source: "seller_validated", measurements: { chest: 52, length: 70 } });
    // Aucune donnée d'organisation ni de personne dans la table partagée.
    const cols = await owner.withGlobal((tx) => tx.query<{ columnName: string }>("select column_name from information_schema.columns where table_name = 'size_references'"));
    expect(cols.map((c) => c.columnName).filter((c) => /org|user|email|photo|ip/.test(c))).toEqual([]);
    // Mesures contrôlées par la base : nombres de 0,5 à 300 cm, clés en minuscules.
    for (const bad of [{ chest: 400 }, { chest: "52" }, { "Chest!": 52 }, {}]) {
      await expect(app.withGlobal((tx) => repos.sizeReferences.contribute(tx, { brand: "Mango", reference: "MG-1", size: "S", category: "top", measurements: bad as Record<string, number> }))).rejects.toMatchObject({ code: "validation" });
    }
    expect(await app.withGlobal((tx) => repos.sizeReferences.count(tx))).toBe(2);

    // Photos portées : clés de l'organisation seulement, RLS, file de nuit lue par fonction (identifiants seulement).
    await expect(app.withOrg(orgB.id, (tx) => repos.wornPhotoJobs.create(tx, { photoKey: keyA, pose: "front", provider: "noop", scheduledFor: "2026-11-04T21:00:00.000Z" }))).rejects.toMatchObject({ code: "validation" });
    await expect(app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.create(tx, { photoKey: "https://exemple.fr/p.jpg", pose: "front", provider: "noop", scheduledFor: "2026-11-04T21:00:00.000Z" }))).rejects.toMatchObject({ code: "validation" });
    await expect(app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.create(tx, { photoKey: keyA, pose: "front", provider: "noop", scheduledFor: "2026-11-04T21:00:00.000Z", overageCents: 25 }))).rejects.toMatchObject({ code: "validation" });
    const j1 = await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.create(tx, { photoKey: keyA, pose: "front", provider: "mock", scheduledFor: "2026-11-04T21:00:00.000Z", overageCents: 25, overageAcceptedAt: "2026-11-04T10:00:00.000Z" }));
    const j2 = await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.create(tx, { photoKey: keyA, pose: "back", provider: "mock", scheduledFor: "2026-11-05T21:00:00.000Z" }));
    expect(j1).toMatchObject({ status: "queued", pose: "front", provider: "mock", overageCents: 25, billedInvoiceId: null });
    expect(await app.withOrg(orgB.id, (tx) => repos.wornPhotoJobs.list(tx))).toEqual([]);
    const due = await app.withGlobal((tx) => repos.wornPhotoJobs.due(tx, "2026-11-04T21:30:00.000Z", "2026-11-04T20:30:00.000Z"));
    expect(due.filter((d) => d.orgId === orgA.id)).toEqual([{ orgId: orgA.id, id: j1.id, status: "queued" }]);
    // Prise conditionnelle : une seule fois ; pas avant l'heure prévue.
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.claim(tx, j2.id, "2026-11-04T21:30:00.000Z", "mock"))).toBeNull();
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.claim(tx, j1.id, "2026-11-04T21:30:00.000Z", "mock"))).toMatchObject({ status: "running" });
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.claim(tx, j1.id, "2026-11-04T21:31:00.000Z", "mock"))).toBeNull();
    // Résultat : une clé de l'organisation seulement.
    await expect(app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.finish(tx, j1.id, { status: "done", finishedAt: "2026-11-04T21:32:00.000Z", resultKey: `org/${orgB.id}/studio-photo/x.jpg`, keepOverage: true }))).rejects.toMatchObject({ code: "validation" });
    const done = await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.finish(tx, j1.id, { status: "done", finishedAt: "2026-11-04T21:32:00.000Z", resultKey: `org/${orgA.id}/studio-photo/worn-1.jpg`, keepOverage: true }));
    expect(done).toMatchObject({ status: "done", resultKey: `org/${orgA.id}/studio-photo/worn-1.jpg`, overageCents: 25 });
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.finish(tx, j1.id, { status: "failed", finishedAt: "2026-11-04T21:33:00.000Z", keepOverage: false }))).toBeNull();
    // Annulation : seulement en file (suppression).
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.deleteQueued(tx, j1.id))).toBeNull();
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.deleteQueued(tx, j2.id))).toMatchObject({ id: j2.id });
    // Objets du stockage : autres demandes qui utilisent la même photo (avant d'effacer l'objet) ; purge des demandes
    // terminées depuis 30 jours (clés rendues pour effacer les objets), un dépassement produit non facturé est gardé.
    const j3 = await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.create(tx, { photoKey: keyA, pose: "front", provider: "noop", scheduledFor: "2026-11-05T21:00:00.000Z" }));
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.countByPhotoKey(tx, keyA, j1.id))).toBe(1);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.countByPhotoKey(tx, keyA))).toBe(2);
    expect(await app.withOrg(orgB.id, (tx) => repos.wornPhotoJobs.countByPhotoKey(tx, keyA))).toBe(0);
    await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.claim(tx, j3.id, "2026-11-05T21:30:00.000Z", "noop"));
    await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.finish(tx, j3.id, { status: "refused", finishedAt: "2026-11-05T21:31:00.000Z", error: "aucun fournisseur", keepOverage: false }));
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.purgeFinishedBefore(tx, "2026-11-05T21:00:00.000Z"))).toEqual([]);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.purgeFinishedBefore(tx, "2026-12-06T00:00:00.000Z"))).toEqual([{ id: j3.id, status: "refused", photoKey: keyA, resultKey: null }]);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.byId(tx, j3.id))).toBeNull();
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.byId(tx, j1.id))).not.toBeNull();

    // Dépassement : compté jusqu'à la date limite, rattaché une seule fois à une facture ; lignes supplémentaires gardées.
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.unbilledOverage(tx, "2026-11-04T21:00:00.000Z"))).toEqual([]);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.unbilledOverage(tx, "2026-11-05T09:00:00.000Z"))).toEqual([{ unitCents: 25, quantity: 1 }]);
    const extraLines = [{ kind: "overage" as const, product: "worn_photo" as const, label: "Photos portées au-delà du quota : 1 × 0,25 €", quantity: 1, unitCents: 25, amountCents: 25 }];
    const po = await app.withOrg(orgA.id, (tx) => repos.paymentOrders.create(tx, { orderId: "ord-studio-1", kind: "renewal", plan: "pro", cycle: "monthly", amountCents: 2524, captureMode: "automatic", extraLines }));
    expect(po.extraLines).toEqual(extraLines);
    const inv = await app.withOrg(orgA.id, (tx) => repos.invoices.create(tx, { plan: "pro", cycle: "monthly", amountCents: 2524, vatRate: 20, vatNotice: null, periodStart: "2026-11-05T09:00:00.000Z", periodEnd: "2026-12-05T09:00:00.000Z", orderId: "ord-studio-1", issuedAt: "2026-11-05T09:00:00.000Z", extraLines }));
    expect(inv.extraLines).toEqual(extraLines);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.markOverageBilled(tx, { invoiceId: inv.id, cutoff: "2026-11-05T09:00:00.000Z", unitCents: 25, quantity: 1, at: "2026-11-05T09:00:00.000Z" }))).toBe(1);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.markOverageBilled(tx, { invoiceId: inv.id, cutoff: "2026-11-05T09:00:00.000Z", unitCents: 25, quantity: 1, at: "2026-11-05T09:00:00.000Z" }))).toBe(0);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.unbilledOverage(tx, "2026-12-05T09:00:00.000Z"))).toEqual([]);
    expect((await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.byId(tx, j1.id)))?.billedInvoiceId).toBe(inv.id);
    // Facturée : la purge peut maintenant l'emporter, avec ses deux clés (photo d'origine, résultat).
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.purgeFinishedBefore(tx, "2026-12-06T00:00:00.000Z"))).toEqual([{ id: j1.id, status: "done", photoKey: keyA, resultKey: `org/${orgA.id}/studio-photo/worn-1.jpg` }]);
    expect(await app.withOrg(orgA.id, (tx) => repos.wornPhotoJobs.byId(tx, j1.id))).toBeNull();
    // Une facture d'avant 0014 (sans lignes) se relit avec une liste vide.
    const old = await app.withOrg(orgA.id, (tx) => repos.invoices.create(tx, { plan: "pro", cycle: "monthly", amountCents: 2499, vatRate: 20, vatNotice: null, periodStart: "2026-10-05T09:00:00.000Z", periodEnd: "2026-11-05T09:00:00.000Z", orderId: null, issuedAt: "2026-10-05T09:00:00.000Z" }));
    expect(old.extraLines).toEqual([]);
    // L'organisation supprimée emporte ses préparations et ses demandes, pas les références partagées.
    await owner.withGlobal((tx) => tx.query("delete from organizations where id = $1", [orgA.id]));
    expect(await owner.withGlobal((tx) => tx.count("select count(*) from worn_photo_jobs where org_id = $1", [orgA.id]))).toBe(0);
    expect(await app.withGlobal((tx) => repos.sizeReferences.count(tx))).toBe(2);
  });

  it("0015 : limites de Vinted mesurées (globales en lecture, écriture globale par fonction) et migrations isolées par RLS, entrée brute purgée", async () => {
    if (!available) return;
    await owner.pool.query("delete from negotiation_limits");
    const { orgA, orgB } = await owner.withGlobal(async (tx) => ({
      orgA: await repos.orgs.create(tx, { name: "Org Nego A", slug: "org-nego-a", settings: {} }),
      orgB: await repos.orgs.create(tx, { name: "Org Nego B", slug: "org-nego-b", settings: {} }),
    }));
    const measure = { maxCounterOffersPerConversation: 2, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 90, measuredAt: "2026-11-06T10:00:00.000Z" };

    // Aucune mesure : rien (l'application garde alors les valeurs prudentes « à mesurer »).
    expect(await app.withOrg(orgA.id, (tx) => repos.negotiationLimits.latestForOrg(tx))).toBeNull();
    expect(await app.withOrg(orgA.id, (tx) => repos.negotiationLimits.latestGlobal(tx))).toBeNull();
    // Mesure propre à A : invisible de B ; aucune écriture pour une autre organisation ni globale en direct.
    const own = await app.withOrg(orgA.id, (tx) => repos.negotiationLimits.recordForOrg(tx, { ...measure, measuredBy: "u-1", note: "Compte équipe" }));
    expect(own).toMatchObject({ orgId: orgA.id, source: "measured", maxCounterOffersPerConversation: 2, measuredAt: "2026-11-06T10:00:00.000Z" });
    expect(await app.withOrg(orgB.id, (tx) => repos.negotiationLimits.latestForOrg(tx))).toBeNull();
    expect(await app.withOrg(orgB.id, (tx) => tx.query("select id from negotiation_limits"))).toHaveLength(0);
    await expect(app.withOrg(orgB.id, (tx) => tx.query("insert into negotiation_limits (org_id, max_counter_offers_per_conversation, offer_duration_hours, min_delay_between_messages_seconds, measured_at) values ($1, 1, 1, 1, now())", [orgA.id]))).rejects.toBeInstanceOf(Error);
    await expect(app.withOrg(orgB.id, (tx) => tx.query("insert into negotiation_limits (org_id, max_counter_offers_per_conversation, offer_duration_hours, min_delay_between_messages_seconds, measured_at) values (null, 1, 1, 1, now())"))).rejects.toBeInstanceOf(Error);
    // Historique : ni modification ni suppression par le rôle applicatif.
    await expect(app.withOrg(orgA.id, (tx) => tx.query("update negotiation_limits set offer_duration_hours = 1 where id = $1", [own.id]))).rejects.toBeInstanceOf(Error);
    await expect(app.withOrg(orgA.id, (tx) => tx.query("delete from negotiation_limits where id = $1", [own.id]))).rejects.toBeInstanceOf(Error);
    // Mesure sans date, ou hors bornes : refusée par la base.
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into negotiation_limits (org_id, max_counter_offers_per_conversation, offer_duration_hours, min_delay_between_messages_seconds, source) values ($1, 3, 48, 60, 'measured')", [orgA.id]))).rejects.toMatchObject({ code: "validation" });
    await expect(app.withOrg(orgA.id, (tx) => repos.negotiationLimits.recordForOrg(tx, { ...measure, maxCounterOffersPerConversation: 0 }))).rejects.toMatchObject({ code: "validation" });
    // Mesure globale (équipe) par la fonction : lisible par toutes les organisations.
    const global = await app.withGlobal((tx) => repos.negotiationLimits.recordGlobal(tx, { ...measure, maxCounterOffersPerConversation: 4, measuredBy: "ops" }));
    expect(global).toMatchObject({ orgId: null, source: "measured", maxCounterOffersPerConversation: 4 });
    expect(await app.withOrg(orgB.id, (tx) => repos.negotiationLimits.latestGlobal(tx))).toMatchObject({ id: global.id });
    expect((await app.withOrg(orgB.id, (tx) => repos.negotiationLimits.history(tx))).map((h) => h.id)).toEqual([global.id]);
    expect((await app.withOrg(orgA.id, (tx) => repos.negotiationLimits.history(tx))).map((h) => h.id).sort()).toEqual([global.id, own.id].sort());

    // Migrations : isolées par RLS ; brouillon corrigeable, appliqué une seule fois ; captures jamais stockées.
    const mapping = { source: "bleam", fields: [{ id: "f1", sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 0.9, note: "" }], unknownFields: [], warnings: [] };
    const m = await app.withOrg(orgA.id, (tx) => repos.migrationMappings.create(tx, { source: "bleam", inputKind: "text", mapping, rawInput: "Remise max : 20 %", rawInputPurgeAt: "2026-11-13T10:00:00.000Z", screenshotCount: 0, createdBy: "u-1", createdAt: "2026-11-06T10:00:00.000Z" }));
    expect(m).toMatchObject({ status: "draft", rawInput: "Remise max : 20 %", rawInputPurgeAt: "2026-11-13T10:00:00.000Z", screenshotCount: 0 });
    expect(await app.withOrg(orgB.id, (tx) => repos.migrationMappings.byId(tx, m.id))).toBeNull();
    await expect(app.withOrg(orgB.id, (tx) => tx.query("insert into migration_mappings (org_id, input_kind, mapping) values ($1, 'text', '{}')", [orgA.id]))).rejects.toBeInstanceOf(Error);
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into migration_mappings (org_id, input_kind, mapping, screenshot_count) values ($1, 'screenshot', '{}', 5)", [orgA.id]))).rejects.toMatchObject({ code: "validation" });
    // Entrée brute sans échéance de purge : refusée.
    await expect(app.withOrg(orgA.id, (tx) => tx.query("insert into migration_mappings (org_id, input_kind, mapping, raw_input) values ($1, 'text', '{}', 'x')", [orgA.id]))).rejects.toMatchObject({ code: "validation" });
    const corrected = await app.withOrg(orgA.id, (tx) => repos.migrationMappings.updateDraft(tx, m.id, { mapping: { ...mapping, warnings: ["corrigé"] } }));
    expect(corrected?.mapping).toMatchObject({ warnings: ["corrigé"] });
    const applied = await app.withOrg(orgA.id, (tx) => repos.migrationMappings.markApplied(tx, m.id, { appliedFieldIds: ["f1"], appliedResult: { applied: 1 }, appliedBy: "u-1", appliedAt: "2026-11-06T10:05:00.000Z" }));
    expect(applied).toMatchObject({ status: "applied", appliedFieldIds: ["f1"], appliedAt: "2026-11-06T10:05:00.000Z" });
    expect(await app.withOrg(orgA.id, (tx) => repos.migrationMappings.markApplied(tx, m.id, { appliedFieldIds: [], appliedResult: {}, appliedBy: "u-1", appliedAt: "2026-11-06T10:06:00.000Z" }))).toBeNull();
    expect(await app.withOrg(orgA.id, (tx) => repos.migrationMappings.updateDraft(tx, m.id, { mapping }))).toBeNull();
    // Rétention : avant l'échéance rien ne part ; après, l'entrée brute est effacée (la correspondance reste).
    const b = await app.withOrg(orgB.id, (tx) => repos.migrationMappings.create(tx, { source: "clemz", inputKind: "rgpd_file", mapping, rawInput: "{\"discount\": \"20 %\"}", rawInputPurgeAt: "2026-11-20T10:00:00.000Z" }));
    expect(await app.withGlobal((tx) => repos.migrationMappings.purgeRawInputsAll(tx, "2026-11-10T00:00:00.000Z"))).toBe(0);
    expect(await app.withGlobal((tx) => repos.migrationMappings.purgeRawInputsAll(tx, "2026-11-14T00:00:00.000Z"))).toBe(1);
    expect((await app.withOrg(orgA.id, (tx) => repos.migrationMappings.byId(tx, m.id)))).toMatchObject({ rawInput: null, rawInputPurgeAt: null, status: "applied" });
    expect((await app.withOrg(orgB.id, (tx) => repos.migrationMappings.byId(tx, b.id)))?.rawInput).not.toBeNull();
    expect(await app.withOrg(orgB.id, (tx) => repos.migrationMappings.purgeRawInputs(tx, "2026-11-21T00:00:00.000Z"))).toBe(1);
    // L'organisation supprimée emporte ses mesures et ses migrations, pas la mesure globale.
    await owner.withGlobal((tx) => tx.query("delete from organizations where id = any($1)", [[orgA.id, orgB.id]]));
    expect(await owner.withGlobal((tx) => tx.count("select count(*) from negotiation_limits"))).toBe(1);
    expect(await owner.withGlobal((tx) => tx.count("select count(*) from migration_mappings"))).toBe(0);
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

  it("0016 : rôles élargis (contributeur photos), codes et liens de parrainage globaux, mois offerts isolés par RLS et accordés une fois", async () => {
    if (!available) return;
    const { r1, r2, u } = await owner.withGlobal(async (tx) => {
      const u = await repos.users.create(tx, { email: "photos-0016@test.local", displayName: "Photos", passwordHash: "x", passwordSalt: "y" });
      const r1 = await repos.orgs.create(tx, { name: "Org Marraine", slug: "org-ref-1", settings: {} });
      const r2 = await repos.orgs.create(tx, { name: "Org Filleule", slug: "org-ref-2", settings: {} });
      return { r1, r2, u };
    });
    // Contributeur photos accepté ; un rôle inconnu reste refusé par la contrainte.
    const m = await app.withGlobal((tx) => repos.memberships.create(tx, { orgId: r1.id, userId: u.id, role: "photographer" }));
    expect(m.role).toBe("photographer");
    await expect(app.withGlobal((tx) => tx.query("update memberships set role = 'superadmin' where id = $1", [m.id]))).rejects.toBeInstanceOf(Error);
    // Codes : un par organisation, unique, alphabet lisible imposé par la base.
    expect(await app.withGlobal((tx) => repos.referralCodes.create(tx, r1.id, "AB3K7Q"))).toBe("AB3K7Q");
    expect(await app.withGlobal((tx) => repos.referralCodes.create(tx, r2.id, "AB3K7Q"))).toBeNull();
    expect(await app.withGlobal((tx) => repos.referralCodes.create(tx, r1.id, "ZZ9ZZ9"))).toBeNull();
    await expect(app.withGlobal((tx) => repos.referralCodes.create(tx, r2.id, "AB0OIL"))).rejects.toBeInstanceOf(Error);
    expect(await app.withGlobal((tx) => repos.referralCodes.byCode(tx, "AB3K7Q"))).toEqual({ orgId: r1.id, code: "AB3K7Q" });
    expect(await app.withGlobal((tx) => repos.referralCodes.byOrg(tx, r2.id))).toBeNull();
    // Lien : une filleule une seule fois, jamais soi-même.
    const link = await app.withGlobal((tx) => repos.referrals.create(tx, { code: "AB3K7Q", referrerOrgId: r1.id, referredOrgId: r2.id }));
    expect(link).toMatchObject({ status: "pending", referrerOrgId: r1.id, referredOrgId: r2.id, qualifiedAt: null, creditedAt: null });
    expect(await app.withGlobal((tx) => repos.referrals.create(tx, { code: "AB3K7Q", referrerOrgId: r1.id, referredOrgId: r2.id }))).toBeNull();
    await expect(app.withGlobal((tx) => repos.referrals.create(tx, { code: "AB3K7Q", referrerOrgId: r1.id, referredOrgId: r1.id }))).rejects.toBeInstanceOf(Error);
    expect(await app.withGlobal((tx) => repos.referrals.countByStatus(tx, r1.id))).toEqual({ pending: 1, qualified: 0, credited: 0, refused: 0 });
    // Qualification conditionnelle : une seule fois.
    const at = "2026-11-08T10:00:00.000Z";
    expect((await app.withGlobal((tx) => repos.referrals.markQualified(tx, link!.id, at)))?.status).toBe("qualified");
    expect(await app.withGlobal((tx) => repos.referrals.markQualified(tx, link!.id, at))).toBeNull();
    // Crédits : sous RLS (contexte de l'organisation exigé), un par organisation et par parrainage.
    const grant = (orgId: string) => app.withOrg(orgId, (tx) => repos.subscriptionCredits.grant(tx, { orgId, kind: "referral", months: 1, sourceReferralId: link!.id }));
    const c1 = await grant(r1.id);
    expect(c1).toMatchObject({ orgId: r1.id, kind: "referral", months: 1, consumedAt: null });
    expect(await grant(r1.id)).toBeNull();
    const c2 = await grant(r2.id);
    await expect(app.withOrg(r1.id, (tx) => repos.subscriptionCredits.grant(tx, { orgId: r2.id, kind: "referral", months: 1, sourceReferralId: null }))).rejects.toBeInstanceOf(Error);
    expect(await app.withGlobal((tx) => tx.query("select id from subscription_credits"))).toHaveLength(0);
    expect(await app.withOrg(r1.id, (tx) => repos.subscriptionCredits.list(tx, r1.id))).toHaveLength(1);
    expect(await app.withOrg(r1.id, (tx) => repos.subscriptionCredits.list(tx, r2.id))).toHaveLength(0);
    // Tant qu'un crédit reste à consommer, le parrainage reste « qualified » ; consommés tous les deux : « credited ».
    const invoiceFor = (orgId: string) => app.withOrg(orgId, (tx) => repos.invoices.create(tx, { plan: "pro", cycle: "monthly", amountCents: 0, vatRate: 20, vatNotice: null, periodStart: at, periodEnd: "2026-12-08T10:00:00.000Z", orderId: null, issuedAt: at, extraLines: [{ kind: "credit", product: "referral_month", label: "Mois offert — parrainage", quantity: 1, unitCents: 0, amountCents: 0 }] }));
    const inv1 = await invoiceFor(r1.id);
    expect(inv1.extraLines?.[0]).toMatchObject({ kind: "credit", product: "referral_month" });
    await app.withOrg(r1.id, async (tx) => {
      const taken = await repos.subscriptionCredits.takeAvailable(tx, r1.id);
      expect(taken?.id).toBe(c1!.id);
      expect((await repos.subscriptionCredits.consume(tx, taken!.id, inv1.id, at))?.invoiceId).toBe(inv1.id);
      expect(await repos.subscriptionCredits.consume(tx, taken!.id, inv1.id, at)).toBeNull();
      expect(await repos.subscriptionCredits.countAvailable(tx, r1.id)).toBe(0);
    });
    expect(await app.withGlobal((tx) => repos.referrals.settle(tx, link!.id, at))).toBe("qualified");
    const inv2 = await invoiceFor(r2.id);
    await app.withOrg(r2.id, (tx) => repos.subscriptionCredits.consume(tx, c2!.id, inv2.id, at));
    expect(await app.withGlobal((tx) => repos.referrals.settle(tx, link!.id, at))).toBe("credited");
    expect(await app.withGlobal((tx) => repos.referrals.byReferred(tx, r2.id))).toMatchObject({ status: "credited", creditedAt: at });
  });
});
