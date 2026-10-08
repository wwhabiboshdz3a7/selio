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
    const first = await app.withGlobal((tx) => repos.paymentEvents.record(tx, { id: "evt_1", provider: "stripe", type: "x", payload: {} }));
    const second = await app.withGlobal((tx) => repos.paymentEvents.record(tx, { id: "evt_1", provider: "stripe", type: "x", payload: {} }));
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("limite le débit par fenêtre", async () => {
    if (!available) return;
    const a = await app.withGlobal((tx) => repos.rateLimits.hit(tx, "test:ip", 60_000));
    const b = await app.withGlobal((tx) => repos.rateLimits.hit(tx, "test:ip", 60_000));
    expect(b).toBe(a + 1);
  });
});
