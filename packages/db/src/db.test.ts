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
    const record = () => app.withGlobal((tx) => repos.paymentEvents.record(tx, { id: "evt_1", provider: "stripe", type: "x", payload: {} }));
    expect(await record()).toBe(true);
    // Reçu mais pas encore traité (traitement en échec) : le renvoi de Stripe doit pouvoir être retraité.
    expect(await record()).toBe(true);
    await app.withGlobal((tx) => repos.paymentEvents.markProcessed(tx, "evt_1"));
    // Traité : un nouveau renvoi est un doublon.
    expect(await record()).toBe(false);
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
