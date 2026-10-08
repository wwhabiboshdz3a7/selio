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
    const b = await call("POST", "/api/auth/register", { email: "bob@test.local", password: "motdepasse-B1", displayName: "Bob", orgName: "Boutique B" });
    expect(b.status).toBe(201);
    cookies.b = cookieOf(b.res);
    const dup = await call("POST", "/api/auth/register", { email: "bob@test.local", password: "motdepasse-B1", displayName: "Bob", orgName: "X" });
    expect(dup.status).toBe(409);
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
