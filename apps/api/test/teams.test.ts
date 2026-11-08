import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, hashPassword, repos, type PgPool } from "@selio/db";
import { ACCOUNT_CHECKLIST_STEP_IDS, COMPTES_INDEPENDENCE_NOTICE, quotasForPlan, type Role } from "@selio/contracts";
import { NoopEmailProvider } from "@selio/email";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";
import { PHOTOGRAPHER_ROUTES, photographerAllowed, redactionExempt } from "../src/plugins/roles";

/**
 * Rôles d'équipe (§5.15), finances masquées, Selio Comptes et connexion Vinted Pro, de bout en bout sur une
 * base dédiée selio_test_api_teams (créée si besoin : jamais celle de api.test.ts, qui peut tourner en même
 * temps). IA : simulateur ; aucun paiement configuré ; aucun appel réseau (fetch surveillé). Ignoré si
 * PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_TEAMS_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_teams";
const APP_URL = process.env.TEST_API_TEAMS_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_teams";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};
const mailbox = new NoopEmailProvider();
let orgId = "";
let itemId = "";
let orderId = "";
let conversationId = "";
let customerId = "";

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

/** Invite un membre (titulaire), lui donne un mot de passe connu et ouvre sa session. */
async function member(who: string, role: Role): Promise<string> {
  const inv = await call("POST", "/api/org/members", { email: `${who}@teams.test`, role });
  expect(inv.status, `${who} : ${inv.text}`).toBe(201);
  expect(inv.json.role).toBe(role);
  const { hash, salt } = await hashPassword(`${who}-mdp-solide-1`);
  await built.services.db.withGlobal((tx) => repos.users.setPassword(tx, inv.json.user.id, hash, salt));
  const login = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${who}@teams.test`, password: `${who}-mdp-solide-1` } });
  expect(login.statusCode).toBe(200);
  cookies[who] = cookieOf(login);
  return inv.json.id as string;
}

const memberships: Record<string, string> = {};

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits, invoice_counters cascade");
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "ops@teams.test", PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { email: mailbox, payments: null }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "titulaire@teams.test", password: "motdepasse-T1", displayName: "Titulaire", orgName: "Boutique Équipe" } });
  expect(r.statusCode).toBe(201);
  cookies.owner = cookieOf(r);
  orgId = JSON.parse(r.body).org.id;
  // Agence : 10 membres, rôles d'équipe.
  await built.services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (built) await built.app.close();
  await owner?.end();
});

describe("liste blanche du contributeur photos (fonctions pures)", () => {
  it("articles en lecture, photos, générateur et session seulement ; masquage sauf session, réglages et Radar", () => {
    expect(photographerAllowed("GET", "/api/items")).toBe(true);
    expect(photographerAllowed("POST", "/api/items/:id/photos")).toBe(true);
    expect(photographerAllowed("POST", "/api/studio/generate")).toBe(true);
    expect(photographerAllowed("POST", "/api/auth/logout")).toBe(true);
    expect(photographerAllowed("POST", "/api/items")).toBe(false);
    expect(photographerAllowed("PATCH", "/api/items/:id")).toBe(false);
    expect(photographerAllowed("GET", "/api/orders")).toBe(false);
    expect(photographerAllowed("GET", "/api/comptes/checklist")).toBe(false);
    expect([...PHOTOGRAPHER_ROUTES].every((r) => /^(GET|POST|DELETE) \/api\//.test(r))).toBe(true);
    expect([...PHOTOGRAPHER_ROUTES].some((r) => /orders|customers|conversations|analytics|subscription|invoices|members|referral|comptes/.test(r))).toBe(false);
    expect(redactionExempt("/api/auth/session")).toBe(true);
    expect(redactionExempt("/api/org")).toBe(true);
    expect(redactionExempt("/api/radar/searches/:id")).toBe(true);
    expect(redactionExempt("/api/orders")).toBe(false);
    expect(redactionExempt("/api/organisation")).toBe(false);
  });
});

describe("rôles d'équipe et finances (API, base réelle)", () => {
  it("invitations avec les nouveaux rôles ; titulaire jamais par invitation ; changement de rôle", async () => {
    if (!available) return;
    memberships.admin = await member("admin", "admin");
    memberships.exec = await member("exec", "operator");
    memberships.photo = await member("photo", "photographer");
    memberships.compta = await member("compta", "viewer");
    expect((await call("POST", "/api/org/members", { email: "x@teams.test", role: "superadmin" })).status).toBe(400);
    // Un administrateur ne peut pas inviter un titulaire (403) ; le titulaire non plus par invitation (400).
    const byAdmin = await call("POST", "/api/org/members", { email: "titu2@teams.test", role: "owner" }, "admin");
    expect(byAdmin.status).toBe(403);
    expect((await call("POST", "/api/org/members", { email: "titu2@teams.test", role: "owner" })).status).toBe(400);
    // Un administrateur invite un contributeur photos ; l'exécuteur n'invite personne.
    const extra = await call("POST", "/api/org/members", { email: "photo2@teams.test", role: "photographer" }, "admin");
    expect(extra.status).toBe(201);
    expect(extra.json.role).toBe("photographer");
    expect((await call("POST", "/api/org/members", { email: "photo3@teams.test", role: "photographer" }, "exec")).status).toBe(403);
    // Changement de rôle vers le contributeur photos, puis retour.
    expect((await call("PATCH", `/api/org/members/${extra.json.id}`, { role: "viewer" })).status).toBe(204);
    expect((await call("PATCH", `/api/org/members/${extra.json.id}`, { role: "photographer" }, "admin")).status).toBe(204);
    const list = await call("GET", "/api/org/members");
    expect(list.json.map((m: { role: string }) => m.role).sort()).toEqual(["admin", "operator", "owner", "photographer", "photographer", "viewer"]);
    // Les sessions portent le rôle.
    expect((await call("GET", "/api/auth/session", undefined, "photo")).json.role).toBe("photographer");
    expect((await call("GET", "/api/auth/session", undefined, "exec")).json.role).toBe("operator");
  });

  it("données de la boutique (titulaire) : article avec prix d'achat, conversation, commande payée", async () => {
    if (!available) return;
    const conn = await call("POST", "/api/connections", { provider: "demo", label: "Simulateur" });
    expect(conn.status).toBe(201);
    const item = await call("POST", "/api/items", { title: "Veste en jean Levi's", brand: "Levi's", purchasePriceCents: 1500, purchaseFeesCents: 100, listedPriceCents: 4000, floorPriceCents: 3000, status: "listed", connectionId: conn.json.id });
    expect(item.status).toBe(201);
    expect(item.json.purchasePriceCents).toBe(1500);
    itemId = item.json.id;
    const conv = await call("POST", "/api/conversations/simulate", { body: "Bonjour, je vous propose 25 € pour la veste" });
    conversationId = conv.json.id;
    await built.services.db.withOrg(orgId, (tx) => tx.query("update conversations set item_id = $1 where id = $2", [itemId, conversationId]));
    customerId = (await call("GET", `/api/conversations/${conversationId}`)).json.customer.id;
    const o = await call("POST", "/api/orders", { itemId, customerId, salePriceCents: 3800, platformFeeCents: 200, externalRef: "tx-teams-1" });
    expect(o.status).toBe(201);
    orderId = o.json.order.id;
    expect((await call("POST", `/api/orders/${orderId}/transition`, { status: "paid" })).json.status).toBe("paid");
  });

  it("exécuteur : ni prix d'achat, ni frais, ni marges, ni chiffre d'affaires ; prix de vente et prix affiché visibles", async () => {
    if (!available) return;
    const list = await call("GET", "/api/items", undefined, "exec");
    expect(list.status).toBe(200);
    const it0 = list.json.items.find((i: { id: string }) => i.id === itemId);
    expect(it0).toMatchObject({ title: "Veste en jean Levi's", listedPriceCents: 4000, purchasePriceCents: null, purchaseFeesCents: null });
    const detail = await call("GET", `/api/items/${itemId}`, undefined, "exec");
    expect(detail.json).toMatchObject({ listedPriceCents: 4000, purchasePriceCents: null, purchaseFeesCents: null });
    // Tri par marge ramené au tri par défaut (sans révéler l'ordre des marges).
    expect((await call("GET", "/api/items?sort=margin_desc", undefined, "exec")).status).toBe(200);
    const history = await call("GET", `/api/items/${itemId}/history`, undefined, "exec");
    expect(history.status).toBe(200);

    const orders = await call("GET", "/api/orders", undefined, "exec");
    const o = orders.json.items.find((x: { id: string }) => x.id === orderId);
    expect(o).toMatchObject({ salePriceCents: 3800, purchasePriceCents: null, purchaseFeesCents: null, platformFeeCents: null, shippingCostCents: null, otherCostsCents: null });
    const od = await call("GET", `/api/orders/${orderId}`, undefined, "exec");
    expect(od.json).toMatchObject({ marginCents: null, order: { salePriceCents: 3800, purchasePriceCents: null }, item: { purchasePriceCents: null } });

    const analytics = await call("GET", "/api/analytics?period=30d", undefined, "exec");
    expect(analytics.status).toBe(200);
    expect(analytics.json.sales).toMatchObject({ orderCount: 1, revenueCents: null, marginCents: null });
    expect(analytics.json.topItems[0]).toMatchObject({ marginCents: null, item: { purchasePriceCents: null }, order: { purchasePriceCents: null } });
    const overview = await call("GET", "/api/analytics/overview?period=30d", undefined, "exec");
    expect(overview.status).toBe(200);
    expect(overview.json.sales.revenueCents).toBeNull();
    expect(overview.json.stock.stockValueCents).toBeNull();
    // Vue d'ensemble construite sans finances côté service : aucun montant connu (prix d'achat 1500, coût
    // 1600, prix de vente 3800 agrégé en CA, marge 2000) dans les graphiques, objectif du mois vide.
    const dash = JSON.stringify(overview.json.dashboard);
    expect(dash).not.toMatch(/\b(1500|1600|3800|2000|4180)\b/);
    // Vidés par le service (ou mis à null par le masquage de sortie pour les clés déjà listées).
    for (const k of ["cumulativeMargin", "marginRateSeries", "basketSeries", "categoryMix", "brandMargin", "stockValueByCategory", "buyVsSell"]) expect(overview.json.dashboard[k] ?? [], k).toEqual([]);
    expect(overview.json.dashboard.monthlyGoal).toMatchObject({ targetCents: null, achievedCents: null, previousMonthCents: null });
    expect(overview.json.dashboard.weekday.reduce((n: number, w: { value: number }) => n + w.value, 0)).toBe(1);
    expect(overview.json.dashboard.stockAging.every((b: Record<string, unknown>) => !("secondary" in b))).toBe(true);
    expect(JSON.stringify(overview.json.sales)).not.toMatch(/\b(1500|1600|3800|2000|200)\b/);
    expect(overview.text).not.toMatch(/€ encaissés/);
    expect(JSON.stringify(analytics.json.byCategory)).not.toMatch(/\b(1500|1600|3800|2000)\b/);
    // Seuils de déclaration : le texte et les ratios redonnent le CA de l'année → 403 explicite.
    for (const url of ["/api/analytics/thresholds", "/api/thresholds"]) {
      const thresholds = await call("GET", url, undefined, "exec");
      expect(thresholds.status, url).toBe(403);
      expect(thresholds.json.error.code, url).toBe("finances_forbidden");
      expect(thresholds.text, url).not.toMatch(/€ encaissés/);
    }
    // Négociation : la simulation d'offre ne chiffre plus la marge ; le plancher reste visible (règle de prix).
    const ev = await call("POST", `/api/conversations/${conversationId}/evaluate`, { offerCents: 3600 }, "exec");
    expect(ev.status).toBe(200);
    expect(ev.json).toMatchObject({ marginAtOfferCents: null, marginRateAtOffer: null });
    expect(ev.json.floorCents).toEqual(expect.any(Number));
    expect(ev.text).not.toMatch(/Marge conservée|Marge absolue|Taux de marge/);
    const evLow = await call("POST", `/api/conversations/${conversationId}/evaluate`, { offerCents: 1700 }, "exec");
    expect(evLow.text).not.toMatch(/Marge absolue insuffisante|Taux de marge insuffisant/);
    expect((await call("POST", `/api/conversations/${conversationId}/evaluate`, { offerCents: 3600 }, "compta")).status).toBe(403);
    const evOwner = await call("POST", `/api/conversations/${conversationId}/evaluate`, { offerCents: 3600 });
    expect(evOwner.json.reasons.join(" ")).toMatch(/Marge conservée/);
    // Journal d'audit : montants de facturation et parrainage retirés pour l'exécuteur ; « org.read » exigé.
    await built.services.db.withOrg(orgId, (tx) => repos.audit.add(tx, { actorUserId: null, action: "billing.payment_completed", targetType: "invoice", targetId: null, meta: { amountCents: 2499, invoiceNumber: "SEL-2026-000042", method: { type: "card", last4: "4242" } } }));
    await built.services.db.withOrg(orgId, (tx) => repos.audit.add(tx, { actorUserId: null, action: "purchase.confirmed", targetType: "purchase", targetId: null, meta: { totalCents: 1650 } }));
    const auditExec = await call("GET", "/api/audit", undefined, "exec");
    expect(auditExec.status).toBe(200);
    expect(auditExec.json.some((a: { action: string }) => a.action.startsWith("billing.") || a.action.startsWith("referral."))).toBe(false);
    expect(auditExec.text).not.toMatch(/2499|SEL-2026-000042|4242|"totalCents":1650/);
    expect(auditExec.json.some((a: { action: string }) => a.action === "purchase.confirmed")).toBe(true);
    const auditOwner = await call("GET", "/api/audit");
    expect(auditOwner.text).toMatch(/SEL-2026-000042/);
    expect((await call("GET", "/api/audit", undefined, "photo")).status).toBe(403);
    // Achats Radar : le prix payé (totalCents) est masqué.
    const purchases = await call("GET", "/api/purchases", undefined, "exec");
    expect(purchases.status).toBe(200);
    expect(purchases.text).not.toMatch(/"totalCents":\d/);
    const margin = await call("GET", "/api/analytics/margin", undefined, "exec");
    expect(margin.status).toBe(403);
    expect(margin.json.error.code).toBe("finances_forbidden");
    expect((await call("GET", "/api/analytics/export.csv", undefined, "exec")).status).toBe(403);
    expect((await call("GET", "/api/items/export.csv", undefined, "exec")).status).toBe(403);

    // Articles imbriqués : conversation, fiche client, dressing.
    const conv = await call("GET", `/api/conversations/${conversationId}`, undefined, "exec");
    expect(conv.status).toBe(200);
    if (conv.json.item) expect(conv.json.item.purchasePriceCents).toBeNull();
    if (conv.json.lastOffer?.evaluation && "marginAtOfferCents" in conv.json.lastOffer.evaluation) expect(conv.json.lastOffer.evaluation.marginAtOfferCents).toBeNull();
    const timeline = await call("GET", `/api/customers/${customerId}/timeline`, undefined, "exec");
    expect(timeline.status).toBe(200);
    expect(timeline.text).not.toMatch(/"purchasePriceCents":1500/);
    const dressing = await call("GET", "/api/dressing", undefined, "exec");
    expect(dressing.status).toBe(200);
    expect(dressing.text).not.toMatch(/"purchasePriceCents":1500/);
    for (const r of [list, detail, orders, od, analytics, overview]) expect(r.text).not.toMatch(/"purchasePriceCents":1500|"marginCents":2[0-9]{3}\b/);

    // Facturation : 403 explicite ; compteurs du mois et offre (sans paiement) lisibles.
    for (const url of ["/api/billing/subscription", "/api/billing/invoices", "/api/billing/usage-events"]) {
      const r = await call("GET", url, undefined, "exec");
      expect(r.status, url).toBe(403);
      expect(r.json.error.code, url).toBe("finances_forbidden");
    }
    expect((await call("POST", "/api/billing/checkout", { plan: "pro" }, "exec")).json.error.code).toBe("finances_forbidden");
    expect((await call("GET", "/api/billing/usage", undefined, "exec")).status).toBe(200);
    const plan = await call("GET", "/api/org/plan", undefined, "exec");
    expect(plan.json).toMatchObject({ plan: "agence", planLabel: "Agence", status: "active", quotas: { members: quotasForPlan("agence").members } });
    expect(plan.json).not.toHaveProperty("cardOnFile");
    expect(plan.json).not.toHaveProperty("revolutCustomerId");
    expect((await call("GET", "/api/referral/credits", undefined, "exec")).status).toBe(404);

    // L'exécuteur publie et répond : il écrit toujours (réponse masquée).
    const patched = await call("PATCH", `/api/items/${itemId}`, { title: "Veste en jean Levi's bleue" }, "exec");
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ title: "Veste en jean Levi's bleue", purchasePriceCents: null });
    const created = await call("POST", "/api/items", { title: "Pull marin", purchasePriceCents: 700, listedPriceCents: 2500 }, "exec");
    expect(created.status).toBe(201);
    expect(created.json.purchasePriceCents).toBeNull();
    expect((await call("POST", `/api/conversations/${conversationId}/drafts`, { body: "Bonjour, la veste est disponible." }, "exec")).status).toBeLessThan(300);
  });

  it("titulaire, administrateur et lecture seule (le comptable) voient les finances", async () => {
    if (!available) return;
    for (const who of ["owner", "admin", "compta"]) {
      const detail = await call("GET", `/api/items/${itemId}`, undefined, who);
      expect(detail.json.purchasePriceCents, who).toBe(1500);
      const od = await call("GET", `/api/orders/${orderId}`, undefined, who);
      expect(od.json.marginCents, who).toBe(3800 - 200 - 1500 - 100);
      const analytics = await call("GET", "/api/analytics?period=30d", undefined, who);
      expect(analytics.json.sales.revenueCents, who).toBe(3800);
      expect((await call("GET", "/api/analytics/margin", undefined, who)).status, who).toBe(200);
      expect((await call("GET", "/api/billing/subscription", undefined, who)).status, who).toBe(200);
    }
    // Factures : réservées au titulaire (paiement), la lecture seule reçoit 403 du service.
    expect((await call("GET", "/api/billing/invoices")).status).toBe(200);
    expect((await call("GET", "/api/billing/invoices", undefined, "compta")).status).toBe(403);
    // Lecture seule : aucune écriture.
    expect((await call("PATCH", `/api/items/${itemId}`, { title: "non" }, "compta")).status).toBe(403);
    expect((await call("POST", `/api/items/${itemId}/photos`, { photos: [{ url: "https://cdn.exemple.test/a.jpg" }] }, "compta")).status).toBe(403);
  });

  it("contributeur photos : lit les articles, ajoute des photos, lance le générateur ; 403 partout ailleurs", async () => {
    if (!available) return;
    const list = await call("GET", "/api/items", undefined, "photo");
    expect(list.status).toBe(200);
    expect(list.json.items.every((i: { purchasePriceCents: unknown }) => i.purchasePriceCents === null)).toBe(true);
    expect((await call("GET", `/api/items/${itemId}`, undefined, "photo")).json.purchasePriceCents).toBeNull();
    expect((await call("GET", "/api/items/brands", undefined, "photo")).status).toBe(200);

    // Ajout de photos : seule écriture permise ; rien d'autre ne change.
    const jpeg = `data:image/jpeg;base64,${Buffer.from("photo-veste-dos").toString("base64")}`;
    const added = await call("POST", `/api/items/${itemId}/photos`, { photos: [{ url: jpeg, alt: "Dos de la veste" }, { url: "https://cdn.exemple.test/etiquette.jpg", alt: "Étiquette" }] }, "photo");
    expect(added.status).toBe(200);
    expect(added.json.photos.map((p: { alt: string }) => p.alt)).toEqual(["Dos de la veste", "Étiquette"]);
    expect(added.json).toMatchObject({ title: "Veste en jean Levi's bleue", listedPriceCents: 4000, purchasePriceCents: null });
    expect((await call("GET", `/api/items/${itemId}`)).json).toMatchObject({ purchasePriceCents: 1500, listedPriceCents: 4000 });
    expect((await call("POST", `/api/items/${itemId}/photos`, { photos: [{ url: "javascript:alert(1)" }] }, "photo")).status).toBe(400);
    expect((await call("POST", `/api/items/${itemId}/photos`, { photos: [{ url: "org/autre-org/item-photo/x.jpg" }] }, "photo")).status).toBe(400);
    expect((await call("POST", `/api/items/${itemId}/photos`, { photos: [] }, "photo")).status).toBe(400);
    // L'exécuteur peut aussi ajouter des photos.
    expect((await call("POST", `/api/items/${itemId}/photos`, { photos: [{ url: "https://cdn.exemple.test/face.jpg" }] }, "exec")).status).toBe(200);
    const audit = await call("GET", "/api/audit?limit=50");
    expect(audit.json.some((a: { action: string }) => a.action === "item.photos_added")).toBe(true);

    // Générateur (Studio) et téléversement : permis (503 ici faute de stockage, jamais 403).
    const gen = await call("POST", "/api/studio/generate", { photos: [{ id: "p1", url: `data:image/jpeg;base64,${Buffer.from("photo-de-test-ralph-lauren").toString("base64")}`, alt: "ralph-lauren-pull-bleu-marine-M.jpg" }] }, "photo");
    expect(gen.status, gen.text).toBe(200);
    expect(gen.json.source).toBe("ai");
    expect((await call("GET", "/api/studio/limits", undefined, "photo")).status).toBe(200);
    expect((await call("GET", "/api/studio/preps", undefined, "photo")).status).toBe(200);
    const presign = await call("POST", "/api/uploads/presign", { kind: "item-photo", contentType: "image/jpeg", size: 1000 }, "photo");
    expect(presign.status).toBe(503);
    expect((await call("GET", "/api/billing/usage", undefined, "photo")).status).toBe(200);
    expect((await call("GET", "/api/org/plan", undefined, "photo")).status).toBe(200);

    // Garder l'annonce générée : brouillon « en stock », sans prix d'achat, sans plancher, sans compte, jamais publié.
    const photoUrl = `data:image/jpeg;base64,${Buffer.from("photo-brouillon").toString("base64")}`;
    const draftRes = await call("POST", "/api/studio/drafts", { title: "Pull Ralph Lauren bleu marine M", description: "Pull en laine.", brand: "Ralph Lauren", size: "M", listedPriceCents: 2500, photos: [{ url: photoUrl, alt: "face" }], status: "listed", purchasePriceCents: 900, connectionId: "pas-un-compte" }, "photo");
    expect(draftRes.status, draftRes.text).toBe(201);
    expect(draftRes.json).toMatchObject({ title: "Pull Ralph Lauren bleu marine M", status: "in_stock", listedPriceCents: 2500, floorPriceCents: null, connectionId: null, purchasePriceCents: null });
    const draftOwner = await call("GET", `/api/items/${draftRes.json.id}`);
    expect(draftOwner.json).toMatchObject({ status: "in_stock", purchasePriceCents: 0, listedAt: null });
    expect(draftOwner.json.photos).toHaveLength(1);
    expect((await call("POST", "/api/studio/drafts", { title: "Pull", photos: [{ url: "javascript:alert(1)" }] }, "photo")).status).toBe(400);
    expect((await call("POST", "/api/studio/drafts", { title: "Interdit" }, "compta")).status).toBe(403);
    expect(photographerAllowed("POST", "/api/studio/drafts")).toBe(true);

    // Tout le reste : 403.
    const forbidden: [("GET" | "POST" | "PATCH" | "DELETE"), string, unknown?][] = [
      ["POST", "/api/items", { title: "Interdit" }],
      ["PATCH", `/api/items/${itemId}`, { title: "Interdit" }],
      ["POST", `/api/items/${itemId}/status`, { status: "archived" }],
      ["DELETE", `/api/items/${itemId}`],
      ["POST", "/api/items/bulk", { ids: [itemId], action: "archive" }],
      ["GET", "/api/orders"],
      ["GET", `/api/orders/${orderId}`],
      ["GET", "/api/customers"],
      ["GET", "/api/conversations"],
      ["POST", `/api/conversations/${conversationId}/drafts`, { body: "Bonjour" }],
      ["GET", "/api/analytics?period=30d"],
      ["GET", "/api/analytics/overview"],
      ["GET", "/api/dressing"],
      ["GET", "/api/billing/subscription"],
      ["GET", "/api/billing/invoices"],
      ["GET", "/api/org/members"],
      ["PATCH", "/api/org", { name: "Pirate" }],
      ["GET", "/api/connections"],
      ["POST", "/api/extension-tokens", { label: "x" }],
      ["GET", "/api/radar/opportunities"],
      ["GET", "/api/automations/rules"],
      ["GET", "/api/comptes/checklist"],
      ["POST", "/api/comptes/texts", { style: "femme" }],
      ["GET", "/api/referral"],
      ["GET", "/api/audit"],
      ["POST", "/api/help/ask", { question: "Comment ça marche ?" }],
      ["POST", "/api/studio/worn", {}],
      ["GET", "/api/data/export"],
    ];
    for (const [method, url, body] of forbidden) {
      const r = await call(method, url, body, "photo");
      expect(r.status, `${method} ${url}`).toBe(403);
    }
    // Message explicite ; une route inconnue reste un 404.
    expect((await call("GET", "/api/orders", undefined, "photo")).json.error.message).toMatch(/Contributeur photos/);
    expect((await call("GET", "/api/route-inexistante", undefined, "photo")).status).toBe(404);
  });
});

describe("Selio Comptes (API) : checklist, progression, textes ; jamais d'appel vers Vinted", () => {
  it("checklist et progression par organisation ; cocher réservé au titulaire et à l'administrateur", async () => {
    if (!available) return;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const view = await call("GET", "/api/comptes/checklist");
    expect(view.status).toBe(200);
    expect(view.json.steps.map((s: { id: string }) => s.id)).toEqual([...ACCOUNT_CHECKLIST_STEP_IDS]);
    expect(view.json.independenceNotice).toBe(COMPTES_INDEPENDENCE_NOTICE);
    expect(view.json.progress).toMatchObject({ done: 0, total: 8 });
    const p = await call("POST", "/api/comptes/progress", { stepId: "username", done: true });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ done: 1, total: 8, percent: 13 });
    expect((await call("POST", "/api/comptes/progress", { stepId: "presentation", done: true }, "admin")).json.done).toBe(2);
    expect((await call("GET", "/api/comptes/progress", undefined, "exec")).json.done).toBe(2);
    expect((await call("GET", "/api/comptes/checklist", undefined, "compta")).status).toBe(200);
    expect((await call("POST", "/api/comptes/progress", { stepId: "username", done: false }, "exec")).status).toBe(403);
    expect((await call("POST", "/api/comptes/progress", { stepId: "username", done: false }, "compta")).status).toBe(403);
    expect((await call("POST", "/api/comptes/progress", { stepId: "pas-une-etape", done: true })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("textes par mon IA perso (quota IA) : titulaire et exécuteur ; lecture seule refusée ; aucun appel réseau", async () => {
    if (!available) return;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = await built.services.db.withOrg(orgId, (tx) => tx.count("select count(*) from ai_requests where org_id = $1", [orgId]));
    const r = await call("POST", "/api/comptes/texts", { style: "vintage", tone: "friendly", shopName: "Chez Lou" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ source: "ai", style: "vintage", tone: "friendly", simulated: true, independenceNotice: COMPTES_INDEPENDENCE_NOTICE });
    expect(r.json.texts.presentation).toContain("Chez Lou");
    expect(r.json.texts.cannedReplies.length).toBeGreaterThanOrEqual(3);
    expect(r.json.texts.cannedReplies.length).toBeLessThanOrEqual(5);
    expect(r.json.message).toMatch(/Selio ne publie rien à votre place/);
    const after = await built.services.db.withOrg(orgId, (tx) => tx.count("select count(*) from ai_requests where org_id = $1", [orgId]));
    expect(after).toBe(before + 1);
    expect((await call("POST", "/api/comptes/texts", { style: "sport" }, "exec")).json.source).toBe("ai");
    expect((await call("POST", "/api/comptes/texts", { style: "sport" }, "compta")).status).toBe(403);
    expect((await call("POST", "/api/comptes/texts", { style: "bijoux" })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("connexion Vinted Pro (API officielle, accès à obtenir)", () => {
  it("création « needs_access », test sans appel, aucune autre capacité ; clé chiffrée jamais rendue", async () => {
    if (!available) return;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const created = await call("POST", "/api/connections", { provider: "vinted_pro", label: "Boutique Pro", config: { proAccountId: "PRO-TEST-1" }, secret: "cle-factice-vinted-pro-0123" });
    expect(created.status, created.text).toBe(201);
    expect(created.json).toMatchObject({ provider: "vinted_pro", status: "not_configured", accessStatus: "needs_access", transport: "server", hasSecret: true });
    expect(created.json.capabilities.every((c: { state: string }) => c.state === "unavailable")).toBe(true);
    expect(created.text).not.toContain("cle-factice-vinted-pro-0123");
    const id = created.json.id as string;
    const tested = await call("POST", `/api/connections/${id}/test`);
    expect(tested.status).toBe(200);
    expect(tested.json).toMatchObject({ ok: false, status: "not_configured", accessStatus: "needs_access", simulated: false });
    // La clé enregistrée est bien transmise au connecteur (côté serveur) : seule l'adresse de l'API manque.
    expect(tested.json.message).toMatch(/adresse de l'API/);
    expect(tested.json.message).not.toMatch(/clé API/);
    expect(tested.text).not.toContain("cle-factice-vinted-pro-0123");
    const listed = (await call("GET", "/api/connections")).json.find((c: { id: string }) => c.id === id);
    expect(listed).toMatchObject({ status: "not_configured", accessStatus: "needs_access" });
    // Pas d'autre capacité tant que l'accès manque.
    expect((await call("POST", `/api/connections/${id}/sync`)).status).toBe(409);
    // Adresse de l'API limitée à HTTPS sous vinted.com.
    expect((await call("POST", "/api/connections", { provider: "vinted_pro", label: "Pirate", config: { apiBaseUrl: "https://evil.example/api" } })).status).toBe(400);
    expect((await call("POST", "/api/connections", { provider: "vinted_pro", label: "Pro 2" }, "exec")).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("parrainage fermé par défaut (REFERRAL_ENABLED absent)", () => {
  it("GET /api/referral 404 ; un code saisi à l'inscription est ignoré avec un message, l'inscription continue", async () => {
    if (!available) return;
    expect((await call("GET", "/api/referral")).status).toBe(404);
    const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "filleule@teams.test", password: "motdepasse-F1", displayName: "Filleule", orgName: "Boutique Filleule", referralCode: "ab3-k7q" } });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.org.name).toBe("Boutique Filleule");
    expect(body.referral).toMatchObject({ applied: false, reason: "disabled" });
    expect(body.referral.message).toMatch(/inscription continue/);
    const plain = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "sanscode@teams.test", password: "motdepasse-S1", displayName: "Sans code", orgName: "Boutique Sans Code" } });
    expect(plain.statusCode).toBe(201);
    expect(JSON.parse(plain.body)).not.toHaveProperty("referral");
  });
});
