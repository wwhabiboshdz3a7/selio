import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox } from "@selio/db";
import { computeSignature } from "@selio/connectors/stripe";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

const OWNER_URL = process.env.TEST_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api";
const APP_URL = process.env.TEST_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api";

let built: BuiltServer;
let available = true;
const cookies: Record<string, string> = {};

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? "").split(";")[0] ?? "";
}

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, who = "a", headers: Record<string, string> = {}) {
  const res = await built.app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[who] ?? "", ...headers } });
  const text = res.body;
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, json: json as any, text, res };
}

beforeAll(async () => {
  const owner = createPool(OWNER_URL, { max: 1 });
  try {
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  } finally {
    await owner.end();
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "ops@test.local", STRIPE_WEBHOOK_SECRET: "whsec_test", AI_HEALTH_TOKEN: "jeton-de-sante-de-test-0123" });
  built = await buildServer(env);
  await built.app.ready();
});

afterAll(async () => {
  if (built) await built.app.close();
});

describe("API Selio (mode connecté, base réelle)", () => {
  it("inscrit, connecte et isole deux organisations", async () => {
    if (!available) return;
    const a = await call("POST", "/api/auth/register", { email: "ops@test.local", password: "motdepasse-A1", displayName: "Alice", orgName: "Boutique A" });
    expect(a.status).toBe(201);
    cookies.a = cookieOf(a.res);
    orgIdA = a.json.org.id;
    expect(a.json.org.name).toBe("Boutique A");
    expect(a.json.user.isOperator).toBe(true);
    const b = await call("POST", "/api/auth/register", { email: "bob@test.local", password: "motdepasse-B1", displayName: "Bob", orgName: "Boutique B", trialDays: 30 });
    expect(b.status).toBe(201);
    cookies.b = cookieOf(b.res);
    const dup = await call("POST", "/api/auth/register", { email: "bob@test.local", password: "motdepasse-B1", displayName: "Bob", orgName: "X" });
    expect(dup.status).toBe(409);
    // Essai Découverte : fonctions du plan Pro, 1 semaine par défaut ou 1 mois, sans paiement.
    const days = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
    const subA = await call("GET", "/api/billing/subscription");
    expect(subA.json).toMatchObject({ plan: "pro", status: "trialing", provider: "none", quotas: { connections: 5, members: 10 } });
    expect(days(subA.json.currentPeriodEnd)).toBe(7);
    expect(days((await call("GET", "/api/billing/subscription", undefined, "b")).json.currentPeriodEnd)).toBe(30);
    expect((await call("POST", "/api/auth/register", { email: "carl@test.local", password: "motdepasse-C1", displayName: "Carl", orgName: "C", trialDays: 12 }, "none")).status).toBe(400);
    const bad = await call("POST", "/api/auth/login", { email: "bob@test.local", password: "mauvais" }, "none");
    expect(bad.status).toBe(401);
    const anon = await call("GET", "/api/items", undefined, "none");
    expect(anon.status).toBe(401);
  });

  it("parcours : article → conversation → suggestion validée → envoi simulé → commande sans doublon → analyses", async () => {
    if (!available) return;
    const conn = await call("POST", "/api/connections", { provider: "demo", label: "Simulateur" });
    expect(conn.status).toBe(201);
    const item = await call("POST", "/api/items", { title: "Veste en jean Levi's", brand: "Levi's", purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000, status: "listed", connectionId: conn.json.id });
    expect(item.status).toBe(201);
    expect(item.json.sku).toMatch(/^OTH-\d{4}$/);
    const other = await call("GET", `/api/items/${item.json.id}`, undefined, "b");
    expect(other.status).toBe(404);
    const otherPatch = await call("PATCH", `/api/items/${item.json.id}`, { title: "pirate" }, "b");
    expect(otherPatch.status).toBe(404);

    const conv = await call("POST", "/api/conversations/simulate", { body: "Bonjour, je vous propose 25 € pour la veste" });
    expect(conv.status).toBe(200);
    await call("PATCH", `/api/items/${item.json.id}`, {});
    // Lie la conversation à l'article (le simulateur ne connaît pas l'article)
    const detail0 = await call("GET", `/api/conversations/${conv.json.id}`);
    expect(detail0.json.messages[0].offerCents).toBe(2500);
    await built.services.db.withOrg(a_org(), async (tx) => { await tx.query("update conversations set item_id = $1 where id = $2", [item.json.id, conv.json.id]); });
    const detail = await call("GET", `/api/conversations/${conv.json.id}`);
    expect(detail.json.lastOffer.evaluation.decision).toBe("counter");
    expect(detail.json.lastOffer.evaluation.counterCents).toBe(3800);

    const sug = await call("POST", `/api/conversations/${conv.json.id}/suggest`);
    expect(sug.status).toBe(200);
    expect(sug.json.source).toBe("ai");
    expect(sug.json.validated).toBe(true);
    expect(sug.json.suggestion.intent).toBe("counter_offer");
    expect(sug.json.draft.status).toBe("draft");

    const updated = await call("PATCH", `/api/messages/${sug.json.draft.id}`, { body: sug.json.draft.body + " Bonne journée." });
    expect(updated.status).toBe(200);
    const sent = await call("POST", `/api/messages/${sug.json.draft.id}/send`);
    expect(sent.json.status).toBe("sent");
    expect(sent.json.simulated).toBe(true);
    const again = await call("POST", `/api/messages/${sug.json.draft.id}/send`);
    expect(again.status).toBe(409);

    const fail = await call("POST", `/api/conversations/${conv.json.id}/drafts`, { body: "test [échec]" });
    const failedSend = await call("POST", `/api/messages/${fail.json.id}/send`);
    expect(failedSend.json.status).toBe("failed");
    expect(failedSend.json.error).toMatch(/refusé/);

    const customerId = detail.json.customer.id;
    const o1 = await call("POST", "/api/orders", { itemId: item.json.id, customerId, salePriceCents: 3800, externalRef: "tx-42" });
    expect(o1.status).toBe(201);
    const o2 = await call("POST", "/api/orders", { itemId: item.json.id, customerId, salePriceCents: 3800, externalRef: "tx-42" });
    expect(o2.status).toBe(200);
    expect(o2.json.created).toBe(false);
    expect(o2.json.order.id).toBe(o1.json.order.id);
    const paid = await call("POST", `/api/orders/${o1.json.order.id}/transition`, { status: "paid" });
    expect(paid.json.status).toBe("paid");
    const badT = await call("POST", `/api/orders/${o1.json.order.id}/transition`, { status: "completed" });
    expect(badT.status).toBe(400);
    const itemAfter = await call("GET", `/api/items/${item.json.id}`);
    expect(itemAfter.json.status).toBe("sold");

    const analytics = await call("GET", "/api/analytics?period=30d");
    expect(analytics.json.sales.orderCount).toBe(1);
    expect(analytics.json.sales.revenueCents).toBe(3800);
    expect(analytics.json.sales.marginCents).toBe(2300);
    const csv = await call("GET", "/api/analytics/export.csv?period=30d");
    expect(csv.text).toContain("Marge brute");
    const timeline = await call("GET", `/api/customers/${customerId}/timeline`);
    expect(timeline.json.totals.orders).toBe(1);
  });

  it("automatisations : règle, exécution idempotente, validation, arrêt global", async () => {
    if (!available) return;
    const rule = await call("POST", "/api/automations/rules", { name: "Accusé de réception", kind: "reply_on_new_message", enabled: true, requiresApproval: true, runsIn: "browser", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "Europe/Paris" }, limits: { maxPerDay: 10, maxPerCustomerPerDay: 2, minMinutesBetweenActions: 0 }, config: { template: "Bonjour {{prenom}}, bien reçu." } });
    expect(rule.status).toBe(201);
    await call("POST", "/api/conversations/simulate", { body: "Est-ce toujours disponible ?" });
    const run1 = await call("POST", `/api/automations/rules/${rule.json.id}/run`);
    expect(run1.json.created).toBeGreaterThan(0);
    const run2 = await call("POST", `/api/automations/rules/${rule.json.id}/run`);
    expect(run2.json.created).toBe(0);
    expect(run2.json.skipped.some((s: { reason: string }) => /idempotence/.test(s.reason))).toBe(true);
    const jobs = await call("GET", "/api/automations/jobs?status=awaiting_approval");
    expect(jobs.json.total).toBeGreaterThan(0);
    const approved = await call("POST", `/api/automations/jobs/${jobs.json.items[0].id}/approve`);
    expect(approved.json.status).toBe("succeeded");
    expect(approved.json.result.simulated).toBe(true);
    const paused = await call("POST", "/api/automations/pause", { paused: true });
    expect(paused.json.globalPaused).toBe(true);
    await call("POST", "/api/conversations/simulate", { body: "Encore dispo ?" });
    const run3 = await call("POST", `/api/automations/rules/${rule.json.id}/run`);
    expect(run3.json.created).toBe(0);
    expect(run3.json.skipped.some((s: { reason: string }) => s.reason === "global_pause")).toBe(true);
    await call("POST", "/api/automations/pause", { paused: false });
  });

  it("rôles : un lecteur ne peut pas écrire", async () => {
    if (!available) return;
    // Sans abonnement (accès de base, hors essai) : une seule personne.
    expect((await call("POST", `/api/admin/orgs/${a_org()}/plan`, { plan: "free" })).status).toBe(204);
    const quota = await call("POST", "/api/org/members", { email: "lecteur@test.local", role: "viewer" });
    expect(quota.status).toBe(402);
    const plan = await call("POST", `/api/admin/orgs/${a_org()}/plan`, { plan: "starter" });
    expect(plan.status).toBe(204);
    const inv = await call("POST", "/api/org/members", { email: "lecteur@test.local", role: "viewer" });
    expect(inv.status).toBe(201);
    // Le lecteur reçoit un mot de passe aléatoire : on le force pour le test via la base.
    const { hashPassword, repos } = await import("@selio/db");
    const { hash, salt } = await hashPassword("lecteur-mdp-1");
    await built.services.db.withGlobal((tx) => repos.users.setPassword(tx, inv.json.user.id, hash, salt));
    const login = await call("POST", "/api/auth/login", { email: "lecteur@test.local", password: "lecteur-mdp-1" }, "none");
    expect(login.status).toBe(200);
    cookies.v = cookieOf(login.res);
    const list = await call("GET", "/api/items", undefined, "v");
    expect(list.status).toBe(200);
    const create = await call("POST", "/api/items", { title: "Interdit" }, "v");
    expect(create.status).toBe(403);
    const adminB = await call("GET", "/api/admin/overview", undefined, "b");
    expect(adminB.status).toBe(403);
    const adminA = await call("GET", "/api/admin/overview");
    expect(adminA.status).toBe(200);
    expect(adminA.json.orgs.length).toBe(2);
  });

  it("comptes Vinted : catégories vente / achat / perso, modification, chiffres et droits", async () => {
    if (!available) return;
    // Création : catégorie explicite ou « Vente » par défaut ; le pseudo affiché est normalisé.
    const sale = await call("POST", "/api/connections", { provider: "vinted", label: "Boutique principale", usage: "sale", config: { displayHandle: "@ma.boutique" } });
    expect(sale.status).toBe(201);
    expect(sale.json.usage).toBe("sale");
    expect(sale.json.config.displayHandle).toBe("ma.boutique");
    const other = await call("POST", "/api/connections", { provider: "vinted", label: "Second compte" });
    expect(other.status).toBe(201);
    expect(other.json.usage).toBe("sale");
    expect((await call("POST", "/api/connections", { provider: "vinted", label: "Mauvais", usage: "pro" })).status).toBe(400);
    // Quota du plan Essentiel : 2 comptes ; le simulateur créé plus haut n'y compte pas.
    const third = await call("POST", "/api/connections", { provider: "vinted", label: "Troisième" });
    expect(third.status).toBe(402);
    expect((await call("POST", "/api/connections", { provider: "demo", label: "Second simulateur" })).status).toBe(409);

    // Changement de catégorie en un clic, renommage et pseudo.
    const toPurchase = await call("PATCH", `/api/connections/${other.json.id}`, { usage: "purchase" });
    expect(toPurchase.status).toBe(200);
    expect(toPurchase.json.usage).toBe("purchase");
    const renamed = await call("PATCH", `/api/connections/${other.json.id}`, { label: "Compte achats", displayHandle: "marie.chineuse" });
    expect(renamed.json).toMatchObject({ label: "Compte achats", usage: "purchase", config: { displayHandle: "marie.chineuse" } });
    expect((await call("PATCH", `/api/connections/${other.json.id}`, { usage: "bogus" })).status).toBe(400);
    expect((await call("PATCH", `/api/connections/${other.json.id}`, {})).status).toBe(400);
    expect((await call("PATCH", `/api/connections/${other.json.id}`, { status: "connected" })).status).toBe(400);
    expect((await call("PATCH", `/api/connections/${other.json.id}`, { usage: "personal" }, "b")).status).toBe(404);

    // Lecture seule : voit les comptes et leur catégorie, ne peut pas les modifier.
    const seen = await call("GET", "/api/connections", undefined, "v");
    expect(seen.status).toBe(200);
    expect(seen.json.find((c: { id: string }) => c.id === other.json.id).usage).toBe("purchase");
    const denied = await call("PATCH", `/api/connections/${sale.json.id}`, { usage: "personal" }, "v");
    expect(denied.status).toBe(403);
    expect((await call("GET", "/api/connections", undefined, "v")).json.find((c: { id: string }) => c.id === sale.json.id).usage).toBe("sale");

    // Audit de la modification.
    const audit = await call("GET", "/api/audit?limit=50");
    expect(audit.json.some((a: { action: string; targetId: string; meta: { usage?: string; previousUsage?: string } }) => a.action === "connection.updated" && a.targetId === other.json.id && a.meta.usage === "purchase" && a.meta.previousUsage === "sale")).toBe(true);

    // Chiffres par compte : un article en ligne rattaché au compte Vente.
    const item = await call("POST", "/api/items", { title: "Chemise en lin", purchasePriceCents: 500, listedPriceCents: 2500, floorPriceCents: 1800, status: "listed", connectionId: sale.json.id });
    expect(item.status).toBe(201);
    const stats = await call("GET", "/api/connections/stats");
    expect(stats.status).toBe(200);
    expect(stats.json.find((s: { connectionId: string }) => s.connectionId === sale.json.id)).toMatchObject({ listedItems: 1, salesThisMonth: 0, purchases: 0 });
    const usage = await call("GET", "/api/billing/usage");
    expect(usage.json.connectionsCount).toBe(2);

    // Achat auto : utilise le compte Achat, jamais un compte Perso.
    const run = await call("POST", "/api/purchases/auto-run");
    expect(run.status).toBe(200);
    expect(run.json.account).toEqual({ id: other.json.id, label: "Compte achats" });
    await call("PATCH", `/api/connections/${other.json.id}`, { usage: "personal" });
    expect((await call("POST", "/api/purchases/auto-run")).json.account).toBeNull();
    await call("PATCH", `/api/connections/${other.json.id}`, { usage: "purchase" });

    // Automatisations : une conversation d'un compte Perso est ignorée.
    await call("PATCH", `/api/connections/${sale.json.id}`, { usage: "personal" });
    const conv = await call("POST", "/api/conversations/simulate", { body: "Bonjour, toujours disponible ?" });
    await built.services.db.withOrg(a_org(), (tx) => tx.query("update conversations set connection_id = $1 where id = $2", [sale.json.id, conv.json.id]));
    const rule = await call("POST", "/api/automations/rules", { name: "Réponse perso", kind: "reply_on_new_message", enabled: true, requiresApproval: true, runsIn: "server", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "Europe/Paris" }, limits: { maxPerDay: 50, maxPerCustomerPerDay: 5, minMinutesBetweenActions: 0 }, config: { template: "Bonjour {{prenom}}." } });
    expect(rule.status).toBe(201);
    const ran = await call("POST", `/api/automations/rules/${rule.json.id}/run`);
    expect(ran.json.skipped.some((s: { reason: string }) => /Compte Perso/.test(s.reason))).toBe(true);
    const jobs = await call("GET", `/api/automations/jobs?ruleId=${rule.json.id}`);
    expect(jobs.json.items.some((j: { payload: { conversationId?: string } }) => j.payload.conversationId === conv.json.id)).toBe(false);
    await call("PATCH", `/api/automations/rules/${rule.json.id}`, { enabled: false });
    await call("PATCH", `/api/connections/${sale.json.id}`, { usage: "sale" });
  });

  it("jeton d'extension : association, capture, règles, révocation", async () => {
    if (!available) return;
    const tok = await call("POST", "/api/extension-tokens", { label: "Chrome test" });
    expect(tok.status).toBe(201);
    const bearer = { authorization: `Bearer ${tok.json.secret}` };
    const ping = await call("GET", "/api/ext/ping", undefined, "none", bearer);
    expect(ping.status).toBe(200);
    expect(ping.json.orgName).toBe("Boutique A");
    const cap = await call("POST", "/api/ext/capture", { title: "Baskets Nike Air Max", brand: "Nike", size: "42", condition: "very_good", priceCents: 4500, purchasePriceCents: 3000, photoUrls: ["https://images.example.invalid/1.jpg"], externalRef: "123456", url: "https://www.vinted.fr/items/123456-baskets", adapterVersion: "vinted-dom-v1" }, "none", bearer);
    expect(cap.status).toBe(201);
    expect(cap.json.tags).toContain("capture-extension");
    const dup = await call("POST", "/api/ext/capture", { title: "Baskets Nike Air Max", externalRef: "123456", url: "https://www.vinted.fr/items/123456-baskets", adapterVersion: "vinted-dom-v1" }, "none", bearer);
    expect(dup.status).toBe(409);
    const rules = await call("POST", "/api/ext/rules", { externalRef: "123456", offerCents: 1000 }, "none", bearer);
    expect(rules.json.known).toBe(true);
    expect(rules.json.offerCheck.ok).toBe(false);
    const noScope = await call("GET", "/api/items", undefined, "none", bearer);
    expect(noScope.status).toBe(401);
    const rev = await call("DELETE", `/api/extension-tokens/${tok.json.token.id}`);
    expect(rev.status).toBe(204);
    const after = await call("GET", "/api/ext/ping", undefined, "none", bearer);
    expect(after.status).toBe(401);
    const forged = await call("GET", "/api/ext/ping", undefined, "none", { authorization: "Bearer slx_abcd.nimportequoi" });
    expect(forged.status).toBe(401);
  });

  it("webhook Stripe : signature, idempotence, et endpoint de santé IA protégé", async () => {
    if (!available) return;
    const payload = JSON.stringify({ id: "evt_test_1", type: "checkout.session.completed", created: 1, livemode: false, data: { object: { metadata: { orgId: a_org() }, subscription: "sub_1", customer: "cus_1" } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${computeSignature("whsec_test", t, payload)}`;
    const ok = await built.app.inject({ method: "POST", url: "/api/billing/webhook", payload, headers: { "content-type": "application/json", "stripe-signature": sig } });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).duplicate).toBe(false);
    const dupe = await built.app.inject({ method: "POST", url: "/api/billing/webhook", payload, headers: { "content-type": "application/json", "stripe-signature": sig } });
    expect(JSON.parse(dupe.body).duplicate).toBe(true);
    const bad = await built.app.inject({ method: "POST", url: "/api/billing/webhook", payload, headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=deadbeef` } });
    expect(bad.statusCode).toBe(400);
    const sub = await call("GET", "/api/billing/subscription");
    expect(sub.json.provider).toBe("stripe");
    expect(sub.json.testMode).toBe(true);
    const health = await built.app.inject({ method: "GET", url: "/api/ai/health" });
    expect(health.statusCode).toBe(401);
    const health2 = await built.app.inject({ method: "GET", url: "/api/ai/health", headers: { "x-health-token": "jeton-de-sante-de-test-0123" } });
    expect(health2.statusCode).toBe(200);
    expect(JSON.parse(health2.body).status).toBe("mock");
  });

  it("état de l'IA et négociation : taux, quota du mois, limites, droits", async () => {
    if (!available) return;
    const { repos } = await import("@selio/db");
    // La suggestion réussie du parcours, plus une requête au délai dépassé.
    await built.services.db.withOrg(a_org(), (tx) => repos.aiRequests.create(tx, { kind: "reply_suggestion", provider: "mock", model: "selio-mock-v1", status: "timeout", latencyMs: 45_000 }));
    const stats = await call("GET", "/api/ai/stats?days=30");
    expect(stats.status).toBe(200);
    expect(stats.json.windowDays).toBe(30);
    expect(stats.json.finished).toBe(2);
    expect(stats.json.succeeded).toBe(1);
    expect(stats.json.timeouts).toBe(1);
    expect(stats.json.availabilityRate).toBeCloseTo(0.5);
    expect(stats.json.validatedRate).toBe(1);
    expect(stats.json.quota.used).toBe(2);
    expect(stats.json.quota.limit).toBe(Math.min(stats.json.quota.planLimit, stats.json.quota.orgLimit));
    expect(stats.json.limits.timeoutMs).toBeGreaterThanOrEqual(1000);
    expect(stats.json.limits.concurrency).toBeGreaterThan(0);
    // Isolation : l'autre organisation ne voit rien, et aucun taux n'est inventé sans requête.
    const statsB = await call("GET", "/api/ai/stats", undefined, "b");
    expect(statsB.json.finished).toBe(0);
    expect(statsB.json.availabilityRate).toBeNull();
    expect((await call("GET", "/api/ai/stats", undefined, "v")).status).toBe(200);
    expect((await call("GET", "/api/ai/stats", undefined, "none")).status).toBe(401);
    // Négociation et marges : l'objet complet est enregistré tel quel ; un lecteur ne peut que consulter.
    const margin = { minMarginRate: 0.35, minMarginCents: 800, maxDiscountRate: 0.1, counterStepRate: 0.04, maxRoundsPerCustomer: 1, defaultPlatformFeeRate: 0, defaultShippingCostCents: 250 };
    expect((await call("PATCH", "/api/org", { settings: { margin } }, "v")).status).toBe(403);
    const saved = await call("PATCH", "/api/org", { settings: { margin } });
    expect(saved.status).toBe(200);
    expect(saved.json.settings.margin).toEqual(margin);
    expect(saved.json.settings.ai.enabled).toBe(true);
    const session = await call("GET", "/api/auth/session");
    expect(session.json.org.settings.margin.maxDiscountRate).toBe(0.1);
    // Comptes et accès : un administrateur ne peut ni changer ni retirer le propriétaire.
    const members = await call("GET", "/api/org/members");
    const ownerM = members.json.find((m: { role: string }) => m.role === "owner");
    const viewerM = members.json.find((m: { user: { email: string } }) => m.user.email === "lecteur@test.local");
    expect((await call("PATCH", `/api/org/members/${viewerM.id}`, { role: "superadmin" })).status).toBe(400);
    expect((await call("PATCH", `/api/org/members/${viewerM.id}`, { role: "admin" })).status).toBe(204);
    expect((await call("PATCH", `/api/org/members/${ownerM.id}`, { role: "viewer" }, "v")).status).toBe(403);
    expect((await call("DELETE", `/api/org/members/${ownerM.id}`, undefined, "v")).status).toBe(403);
    expect((await call("PATCH", `/api/org/members/${viewerM.id}`, { role: "viewer" })).status).toBe(204);
    // Retour aux règles par défaut pour la suite du parcours.
    const restored = await call("PATCH", "/api/org", { settings: { margin: { minMarginRate: 0.25, minMarginCents: 500, maxDiscountRate: 0.2, counterStepRate: 0.05, maxRoundsPerCustomer: 2, defaultPlatformFeeRate: 0, defaultShippingCostCents: 0 } } });
    expect(restored.status).toBe(200);
  });

  it("générateur d'annonces, dressing intelligent, republication, bonnes affaires, achat auto, marché", async () => {
    if (!available) return;
    const { repos } = await import("@selio/db");
    // Générateur : photos → annonce (simulateur IA côté serveur de test), prix issu des comparables.
    const photo = "data:image/jpeg;base64," + Buffer.from("photo-de-test-ralph-lauren").toString("base64");
    const gen = await call("POST", "/api/studio/generate", { photos: [{ id: "p1", url: photo, alt: "ralph-lauren-pull-bleu-marine-M.jpg" }], hints: { notes: "pull torsadé" } });
    expect(gen.status).toBe(200);
    expect(gen.json.source).toBe("ai");
    expect(gen.json.brand).toBe("Ralph Lauren");
    expect(gen.json.suggestedPriceCents).toBeGreaterThan(0);
    const badGen = await call("POST", "/api/studio/generate", { photos: [] });
    expect(badGen.status).toBe(400);

    // Dressing : annonce en ligne depuis 10 jours → à republier, 10 variantes prêtes.
    const it0 = await call("POST", "/api/items", { title: "Pull torsadé Ralph Lauren", brand: "Ralph Lauren", size: "M", category: "men", purchasePriceCents: 1200, listedPriceCents: 4500, floorPriceCents: 3000, status: "listed", listingStats: { views: 50, favorites: 6, offers: 0 } });
    expect(it0.status).toBe(201);
    await built.services.db.withOrg(a_org(), (tx) => tx.query("update inventory_items set listed_at = now() - interval '10 days' where id = $1", [it0.json.id]));
    const due = await call("GET", "/api/dressing?filter=due");
    expect(due.status).toBe(200);
    const listing = due.json.listings.find((l: { item: { id: string } }) => l.item.id === it0.json.id);
    expect(listing.performance.republishDue).toBe(true);
    expect(listing.performance.score).toBeGreaterThan(0);
    expect(listing.plan.variants.length).toBeGreaterThanOrEqual(8);
    const online = await call("GET", "/api/items?minDaysOnline=7&sort=online_desc");
    expect(online.json.items.some((i: { id: string }) => i.id === it0.json.id)).toBe(true);
    const v2 = listing.plan.variants.find((v: { id: string }) => v.id === "v2");
    const rep = await call("POST", `/api/items/${it0.json.id}/republish`, { variantId: "v2" });
    expect(rep.status).toBe(200);
    expect(rep.json.title).toBe(v2.title);
    expect(rep.json.republications).toHaveLength(1);
    expect(rep.json.republications[0]).toMatchObject({ variantId: "v2", mode: "manual", before: { views: 50, favorites: 6 } });
    expect(rep.json.listingStats.views).toBe(0);
    const after = await call("GET", "/api/dressing?filter=due");
    expect(after.json.listings.some((l: { item: { id: string } }) => l.item.id === it0.json.id)).toBe(false);
    const all = await call("GET", "/api/dressing");
    expect(all.json.listings.find((l: { item: { id: string } }) => l.item.id === it0.json.id).plan.variants.find((v: { id: string }) => v.id === "v2").uses).toBe(1);
    expect((await call("POST", `/api/items/${it0.json.id}/republish`, { variantId: "v99" })).status).toBe(404);
    expect((await call("POST", `/api/items/${it0.json.id}/republish`, { variantId: "x" })).status).toBe(400);
    expect((await call("POST", `/api/items/${it0.json.id}/republish`, { variantId: "v1" }, "v")).status).toBe(403);

    // Bonnes affaires : validation en un clic (achat simulé), sans doublon.
    const search = await call("POST", "/api/radar/searches", { name: "Pulls", criteria: { brands: ["Ralph Lauren"], categories: ["men"], maxPriceCents: 3000 }, budgetCents: 20000, targetMarginRate: 0.3, targetMarginCents: 1000 });
    expect(search.status).toBe(201);
    const mk = (title: string, score: number) => built.services.db.withOrg(a_org(), (tx) => repos.opportunities.create(tx, { searchId: search.json.id, title, observed: { priceCents: 2000, shippingCents: 450, brand: "Ralph Lauren", size: "M", condition: "very_good", category: "men", sellerHandle: "vendeur_1", sellerRating: 4.9, sellerReviews: 50, photoUrl: null, photoCount: 6, url: null, seenAt: new Date().toISOString(), source: "extension_capture" }, estimate: { resalePriceCents: 6000, expectedFeesCents: 0, marginCents: 3380, marginRate: 0.56, confidence: "high", method: "test", comparableCount: 3 }, score, reasons: [], breakdown: [], status: "new" }));
    const manual = await mk("Pull torsadé à valider", 80);
    const bought = await call("POST", `/api/radar/opportunities/${manual.id}/buy`);
    expect(bought.status).toBe(200);
    expect(bought.json.status).toBe("simulated");
    expect(bought.json.mode).toBe("manual");
    expect(bought.json.maxPriceCents).toBe(2620);
    expect((await call("POST", `/api/radar/opportunities/${manual.id}/buy`)).status).toBe(409);
    expect((await call("POST", `/api/purchases/${bought.json.id}/cancel`)).status).toBe(409);

    // Achat auto : désactivé par défaut, puis seuil 85 avec délai d'annulation.
    const auto = await mk("Pull exceptionnel", 92);
    const off = await call("POST", "/api/purchases/auto-run");
    expect(off.json.bought).toBe(0);
    const cfg = await call("PATCH", "/api/org", { settings: { autoBuy: { enabled: true, threshold: 85, dailyCapCents: 20000, maxItemCents: 8000, cancelWindowMinutes: 30 } } });
    expect(cfg.status).toBe(200);
    const on = await call("POST", "/api/purchases/auto-run");
    expect(on.json.bought).toBe(1);
    const list = await call("GET", "/api/purchases");
    const autoBuy = list.json.find((x: { opportunityId: string }) => x.opportunityId === auto.id);
    expect(autoBuy.mode).toBe("auto");
    expect(new Date(autoBuy.cancelableUntil).getTime()).toBeGreaterThan(Date.now());
    const cancelled = await call("POST", `/api/purchases/${autoBuy.id}/cancel`);
    expect(cancelled.json.status).toBe("cancelled");
    const oppAfter = await call("GET", "/api/radar/opportunities");
    expect(oppAfter.json.find((o: { id: string }) => o.id === auto.id).status).toBe("dismissed");

    // Marché : uniquement des annonces réellement observées (ici 2 captures de test).
    const market = await call("GET", "/api/market/insights?windowDays=30");
    expect(market.status).toBe(200);
    expect(market.json.source).toBe("observations");
    expect(market.json.observedCount).toBe(2);

    // Vue d'ensemble « ce mois-ci » avec graphiques et rendement du dressing.
    const ov = await call("GET", "/api/analytics/overview?period=month");
    expect(ov.status).toBe(200);
    expect(ov.json.period).toBe("month");
    expect(ov.json.periodLabel).toMatch(/20\d\d/);
    expect(ov.json.dashboard.weekday).toHaveLength(7);
    expect(ov.json.dressing.listed).toBeGreaterThan(0);
  });

  it("export, suppression avec confirmation et déconnexion", async () => {
    if (!available) return;
    const exp = await call("GET", "/api/data/export", undefined, "b");
    expect(exp.status).toBe(200);
    expect(exp.json.mode).toBe("connected");
    const wrong = await call("DELETE", "/api/org", { confirmName: "pas le bon nom" }, "b");
    expect(wrong.status).toBe(400);
    const del = await call("DELETE", "/api/org", { confirmName: "Boutique B" }, "b");
    expect(del.status).toBe(204);
    const out = await call("POST", "/api/auth/logout");
    expect(out.status).toBe(204);
    const after = await call("GET", "/api/auth/session");
    expect(after.json).toBeNull();
  });
});

let orgIdA = "";
function a_org(): string {
  return orgIdA;
}
