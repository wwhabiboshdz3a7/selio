import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, hashPassword, repos, type PgPool } from "@selio/db";
import { DEFAULT_SHORTCUTS, quotasForPlan, type ActivityEntry, type Role } from "@selio/contracts";
import { recordActivity } from "@selio/core";
import { NoopEmailProvider } from "@selio/email";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Selio Manager : journal d'activité (traces existantes + Selio Bot via recordActivity), rôles et finances,
 * raccourcis par utilisateur, compteurs et actions groupées d'« Articles et stock ». Base dédiée
 * selio_test_api_activity (créée si besoin). Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_ACTIVITY_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_activity";
const APP_URL = process.env.TEST_API_ACTIVITY_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_activity";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};
let orgId = "";
let itemId = "";
let conversationId = "";

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

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? "").split(";")[0] ?? "";
}

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, who = "owner") {
  const res = await built.app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[who] ?? "" } });
  let json: unknown = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, json: json as any, text: res.body };
}

async function member(who: string, role: Role): Promise<void> {
  const inv = await call("POST", "/api/org/members", { email: `${who}@activity.test`, role });
  expect(inv.status, inv.text).toBe(201);
  const { hash, salt } = await hashPassword(`${who}-mdp-solide-1`);
  await built.services.db.withGlobal((tx) => repos.users.setPassword(tx, inv.json.user.id, hash, salt));
  const login = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${who}@activity.test`, password: `${who}-mdp-solide-1` } });
  expect(login.statusCode).toBe(200);
  cookies[who] = cookieOf(login);
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { email: new NoopEmailProvider(), payments: null }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "marie@activity.test", password: "motdepasse-A1", displayName: "Marie Lefèvre", orgName: "Boutique Journal" } });
  expect(r.statusCode).toBe(201);
  cookies.owner = cookieOf(r);
  orgId = JSON.parse(r.body).org.id;
  await built.services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
  await member("exec", "operator");
  await member("photo", "photographer");
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

const summaries = (entries: ActivityEntry[]) => entries.map((e) => `${e.actor.name} ${e.summary}`);

describe("journal d'activité (API, base réelle)", () => {
  it("raconte ce que l'équipe a fait : article ajouté, prix, mise en vente, photos, réponse envoyée, vente", async () => {
    if (!available) return;
    const conn = await call("POST", "/api/connections", { provider: "demo", label: "Simulateur" });
    expect(conn.status).toBe(201);
    const item = await call("POST", "/api/items", { title: "Veste en jean Levi's", brand: "Levi's", purchasePriceCents: 1500, listedPriceCents: 4000, floorPriceCents: 3000, status: "in_stock", connectionId: conn.json.id });
    expect(item.status).toBe(201);
    itemId = item.json.id;
    expect((await call("PATCH", `/api/items/${itemId}`, { listedPriceCents: 3800 })).status).toBe(200);
    expect((await call("POST", `/api/items/${itemId}/status`, { status: "listed" })).status).toBe(200);
    expect((await call("POST", `/api/items/${itemId}/photos`, { photos: [{ url: "https://exemple.test/a.jpg" }, { url: "https://exemple.test/b.jpg" }] })).status).toBe(200);
    const conv = await call("POST", "/api/conversations/simulate", { body: "Bonjour, je vous propose 25 € pour la veste, c'est mon dernier prix et voici mon adresse" });
    conversationId = conv.json.id;
    await built.services.db.withOrg(orgId, (tx) => tx.query("update conversations set item_id = $1 where id = $2", [itemId, conversationId]));
    const draft = await call("POST", `/api/conversations/${conversationId}/drafts`, { body: "Bonjour, je peux descendre à 35 €.", offerCents: 3500 });
    expect(draft.status).toBe(201);
    const sent = await call("POST", `/api/messages/${draft.json.id}/send`);
    expect(sent.json.status).toBe("sent");
    const customerId = (await call("GET", `/api/conversations/${conversationId}`)).json.customer.id;
    const order = await call("POST", "/api/orders", { itemId, customerId, salePriceCents: 3500, externalRef: "tx-journal-1" });
    expect(order.status).toBe(201);

    const page = await call("GET", "/api/activity?limit=50");
    expect(page.status).toBe(200);
    const lines = summaries(page.json.entries);
    expect(lines).toContain("Marie Lefèvre a ajouté l'article « Veste en jean Levi's »");
    expect(lines).toContain("Marie Lefèvre a changé le prix de « Veste en jean Levi's » : 40,00 € → 38,00 €");
    expect(lines).toContain("Marie Lefèvre a mis « Veste en jean Levi's » en vente");
    expect(lines).toContain("Marie Lefèvre a ajouté 2 photos à « Veste en jean Levi's »");
    expect(lines.some((l) => /^Marie Lefèvre a envoyé une réponse à \S+ avec une proposition à 35,00 €$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Marie Lefèvre a enregistré la vente de « Veste en jean Levi's » à \S+ pour 35,00 €$/.test(l))).toBe(true);
    // Jamais le texte d'un message d'acheteur.
    expect(page.text).not.toContain("mon adresse");
    expect(page.text).not.toContain("dernier prix");
    const reply = page.json.entries.find((e: ActivityEntry) => e.verb === "message.sent");
    expect(reply.link).toBe(`/app/messages/${conversationId}`);
    expect(page.json.entries.every((e: ActivityEntry) => typeof e.at === "string" && e.actor.name)).toBe(true);
    // Les plus récents d'abord.
    const dates = page.json.entries.map((e: ActivityEntry) => e.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("Selio Bot écrit dans le journal (recordActivity) ; prix d'achat masqué pour l'exécuteur", async () => {
    if (!available) return;
    await recordActivity(built.services, orgId, { verb: "bot.purchase", itemTitle: "Sac Longchamp", purchaseCents: 1200, targetType: "purchase", targetId: "achat-bot-1" });
    await recordActivity(built.services, orgId, { verb: "bot.offer_sent", counterpart: "Léa", priceCents: 2000, itemId, itemTitle: "Veste en jean Levi's", targetType: "conversation", targetId: conversationId });
    await expect(recordActivity(built.services, orgId, { verb: "inconnu" as never })).rejects.toMatchObject({ code: "validation" });

    const ownerPage = await call("GET", "/api/activity?category=bot");
    expect(summaries(ownerPage.json.entries)).toEqual(["Selio Bot a envoyé une offre à Léa : 20,00 €", "Selio Bot a acheté « Sac Longchamp » pour 12,00 €"]);
    expect(ownerPage.json.entries[1].purchaseCents).toBe(1200);
    expect(ownerPage.json.entries.every((e: ActivityEntry) => e.automatic && e.actor.kind === "bot")).toBe(true);

    const execPage = await call("GET", "/api/activity?category=bot", undefined, "exec");
    expect(execPage.status).toBe(200);
    expect(summaries(execPage.json.entries)).toEqual(["Selio Bot a envoyé une offre à Léa : 20,00 €", "Selio Bot a acheté « Sac Longchamp »"]);
    expect(execPage.json.entries[1].purchaseCents).toBeNull();
    expect(execPage.text).not.toContain("12,00");
  });

  it("filtres : type, qui, automatique ou manuel, période ; pagination par curseur sans doublon", async () => {
    if (!available) return;
    const manual = await call("GET", "/api/activity?mode=manual&limit=100");
    expect(manual.json.entries.length).toBeGreaterThan(3);
    expect(manual.json.entries.every((e: ActivityEntry) => e.actor.kind === "member" && !e.automatic)).toBe(true);
    const auto = await call("GET", "/api/activity?mode=auto&limit=100");
    expect(auto.json.entries.every((e: ActivityEntry) => e.automatic)).toBe(true);
    const photos = await call("GET", "/api/activity?category=photos");
    expect(photos.json.entries.map((e: ActivityEntry) => e.verb)).toEqual(["item.photos_added"]);
    const bot = await call("GET", "/api/activity?actor=bot");
    expect(bot.json.entries).toHaveLength(2);
    const session = await call("GET", "/api/auth/session");
    const mine = await call("GET", `/api/activity?actor=${session.json.user.id}&limit=100`);
    expect(mine.json.entries.length).toBe(manual.json.entries.length);
    const future = await call("GET", `/api/activity?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`);
    expect(future.json.entries).toEqual([]);

    const all = (await call("GET", "/api/activity?limit=100")).json.entries.map((e: ActivityEntry) => e.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const p = await call("GET", `/api/activity?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...p.json.entries.map((e: ActivityEntry) => e.id));
      cursor = p.json.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all);
    expect((await call("GET", "/api/activity?cursor=nimporte")).status).toBe(400);
    expect((await call("GET", "/api/activity?category=inconnue")).status).toBe(400);
  });

  it("rôles : le contributeur photos n'a pas accès au journal", async () => {
    if (!available) return;
    expect((await call("GET", "/api/activity", undefined, "photo")).status).toBe(403);
  });
});

describe("raccourcis par utilisateur", () => {
  it("par défaut, enregistrés, retrouvés à la session suivante ; propres à chaque personne ; validés", async () => {
    if (!available) return;
    expect((await call("GET", "/api/auth/preferences")).json).toEqual({ shortcuts: null });
    const saved = await call("PATCH", "/api/auth/preferences", { shortcuts: ["studio", "orders_to_ship", "journal"] });
    expect(saved.status).toBe(200);
    expect(saved.json.shortcuts).toEqual(["studio", "orders_to_ship", "journal"]);
    // Nouvelle connexion (autre appareil) : mêmes raccourcis.
    const login = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "marie@activity.test", password: "motdepasse-A1" } });
    cookies.phone = cookieOf(login);
    expect((await call("GET", "/api/auth/preferences", undefined, "phone")).json.shortcuts).toEqual(["studio", "orders_to_ship", "journal"]);
    // Chacun les siens ; le contributeur photos peut garder les siens.
    expect((await call("GET", "/api/auth/preferences", undefined, "exec")).json.shortcuts).toBeNull();
    expect((await call("PATCH", "/api/auth/preferences", { shortcuts: ["studio"] }, "photo")).status).toBe(200);
    // Refus : raccourci inconnu, doublon, trop nombreux.
    expect((await call("PATCH", "/api/auth/preferences", { shortcuts: ["inconnu"] })).status).toBe(400);
    expect((await call("PATCH", "/api/auth/preferences", { shortcuts: ["studio", "studio"] })).status).toBe(400);
    expect((await call("PATCH", "/api/auth/preferences", { shortcuts: [...DEFAULT_SHORTCUTS, "dressing", "purchase", "customers", "analytics", "journal"] })).status).toBe(400);
    // Retour aux raccourcis par défaut.
    expect((await call("PATCH", "/api/auth/preferences", { shortcuts: null })).json.shortcuts).toBeNull();
  });
});

describe("Articles et stock : compteurs, filtres rapides et actions groupées", () => {
  it("compteurs (valeur du stock masquée pour l'exécuteur), sans photo, marge, prix et republication en lot", async () => {
    if (!available) return;
    const nophoto = await call("POST", "/api/items", { title: "Pull sans photo", purchasePriceCents: 2000, listedPriceCents: 1500, status: "listed" });
    expect(nophoto.status).toBe(201);
    const s = await call("GET", "/api/items/summary");
    expect(s.status).toBe(200);
    // La veste est réservée par sa commande en attente : elle reste dans le stock (valeur d'achat) et en ligne.
    expect(s.json).toMatchObject({ active: 2, listed: 1, reserved: 1, withoutPhoto: 1, stockValueCents: 3500, listedValueCents: 5300 });
    expect(s.json.soldThisMonth).toBeGreaterThanOrEqual(0);
    const sExec = await call("GET", "/api/items/summary", undefined, "exec");
    expect(sExec.json.stockValueCents).toBeNull();
    expect(sExec.json.listedValueCents).toBe(5300);

    expect((await call("GET", "/api/items?photos=none")).json.items.map((i: { title: string }) => i.title)).toEqual(["Pull sans photo"]);
    expect((await call("GET", "/api/items?margin=negative")).json.items.map((i: { title: string }) => i.title)).toEqual(["Pull sans photo"]);
    // Filtre par marge ignoré pour l'exécuteur (il révélerait les prix d'achat).
    expect((await call("GET", "/api/items?margin=negative", undefined, "exec")).json.total).toBe(2);

    const raise = await call("POST", "/api/items/bulk", { ids: [nophoto.json.id], action: "adjust_price", priceRate: 0.1 });
    expect(raise.json.affected).toBe(1);
    expect((await call("GET", `/api/items/${nophoto.json.id}`)).json.listedPriceCents).toBe(1650);
    expect((await call("POST", "/api/items/bulk", { ids: [nophoto.json.id], action: "set_price", listedPriceCents: 2900 })).json.affected).toBe(1);
    expect((await call("POST", "/api/items/bulk", { ids: [nophoto.json.id], action: "set_price" })).status).toBe(400);
    const rep = await call("POST", "/api/items/bulk", { ids: [nophoto.json.id], action: "republish" });
    expect(rep.json.affected).toBe(1);
    const after = (await call("GET", `/api/items/${nophoto.json.id}`)).json;
    expect(after.republications).toHaveLength(1);
    const lines = summaries((await call("GET", "/api/activity?limit=100")).json.entries);
    expect(lines.some((l) => l.startsWith("Marie Lefèvre a republié « "))).toBe(true);
    expect(lines).toContain("Marie Lefèvre a modifié 1 article d'un coup (republication)");
  });
});
