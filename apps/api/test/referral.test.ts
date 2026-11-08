import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, repos, type PgPool } from "@selio/db";
import { RevolutClient, computeRevolutSignature } from "@selio/connectors";
import { REFERRAL_CODE_RE, REFERRAL_CREDIT_LINE_LABEL } from "@selio/contracts";
import { billing } from "@selio/core";
import { NoopEmailProvider } from "@selio/email";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Parrainage « un mois offert aux deux » de bout en bout par l'API (REFERRAL_ENABLED=true), sur une base
 * dédiée selio_test_api_referral (créée si besoin). Revolut est simulé en HTTP (client Revolut réel, bac à
 * sable, aucun appel réseau, aucun débit réel) ; les webhooks sont signés comme Revolut le fait.
 * Parcours : la marraine A partage son code ; la filleule B s'inscrit avec ; le premier paiement réellement
 * encaissé de B (webhook ORDER_COMPLETED) qualifie le lien et accorde un mois à chacune ; à l'échéance, chacune
 * reçoit une facture à 0 € « Mois offert — parrainage » sans aucun débit, et le parrainage passe « credited ».
 */
const OWNER_URL = process.env.TEST_API_REFERRAL_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_referral";
const APP_URL = process.env.TEST_API_REFERRAL_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_referral";
const REVOLUT_KEY = "sk_test_placeholder_referral_0123";
const REVOLUT_WEBHOOK_SECRET = "wsk_test_secret_referral_0123";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};
const orgs: Record<string, string> = {};

/** Revolut simulé : commandes en mémoire, débits « completed » par défaut, chaque requête enregistrée. */
interface FakeOrder { id: string; token: string; state: string; amount: number; currency: string; capture_mode: string; customer: { id: string }; merchant_order_ext_ref?: string; payments: { id: string; state: string; payment_method: { id: string; type: string } }[] }
const revolut = (() => {
  const orders = new Map<string, FakeOrder>();
  const calls: { method: string; url: string; body: Record<string, unknown> | undefined }[] = [];
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url: url.pathname + url.search, body });
    if (method === "POST" && url.pathname === "/api/1.0/customers") return json(201, { id: `cus_ref_${String(body?.email ?? "x").split("@")[0]}`, email: body?.email });
    if (method === "POST" && url.pathname === "/api/orders") {
      n++;
      const customer = body?.customer as { id?: string } | undefined;
      const o: FakeOrder = { id: `ord_ref_${n}`, token: `tok_ref_${n}`, state: "pending", amount: Number(body?.amount), currency: "EUR", capture_mode: String(body?.capture_mode), customer: { id: customer?.id ?? "cus_ref_x" }, merchant_order_ext_ref: body?.merchant_order_ext_ref as string | undefined, payments: [] };
      orders.set(o.id, o);
      return json(201, o);
    }
    const m = url.pathname.match(/^\/api\/orders\/([^/]+)(?:\/(payments|cancel))?$/);
    if (m) {
      const o = orders.get(m[1]!);
      if (!o) return json(404, { code: "not_found", message: "order" });
      if (method === "POST" && m[2] === "payments") {
        const saved = body?.saved_payment_method as { id?: string } | undefined;
        o.payments.push({ id: `pay_${o.id}`, state: "COMPLETED", payment_method: { id: saved?.id ?? "pm_?", type: "CARD" } });
        o.state = "completed";
        return json(201, { id: `pay_${o.id}`, order_id: o.id, state: "COMPLETED" });
      }
      if (method === "POST" && m[2] === "cancel") { o.state = "cancelled"; return json(200, o); }
      if (method === "GET" && !m[2]) return json(200, o);
    }
    if (method === "GET" && /^\/api\/1\.0\/customers\/[^/]+\/payment-methods$/.test(url.pathname)) {
      return json(200, [{ id: "pm_ref_1", type: "CARD", created_at: "2026-10-01T10:00:00Z", method_details: { brand: "visa", last4: "4242", expiry_month: 12, expiry_year: 2030 } }]);
    }
    return json(404, { code: "not_found", message: url.pathname });
  };
  /** Ce que le formulaire Revolut aurait fait : un paiement sur la commande avec la carte. */
  const pay = (orderId: string, state: "AUTHORISED" | "COMPLETED") => {
    const o = orders.get(orderId)!;
    o.payments.push({ id: `pay_${orderId}_${o.payments.length + 1}`, state, payment_method: { id: "pm_ref_1", type: "CARD" } });
    o.state = state.toLowerCase();
  };
  return { orders, calls, fetchImpl, pay };
})();

function webhook(event: string, orderId: string, orgId: string) {
  const payload = JSON.stringify({ event, order_id: orderId, merchant_order_ext_ref: orgId });
  const ts = Date.now();
  return built.app.inject({ method: "POST", url: "/api/billing/webhook/revolut", payload, headers: { "content-type": "application/json", "revolut-request-timestamp": String(ts), "revolut-signature": `v1=${computeRevolutSignature(REVOLUT_WEBHOOK_SECRET, ts, payload)}` } });
}

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

async function call(method: "GET" | "POST", url: string, body: unknown, who: string) {
  const res = await built.app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[who] ?? "" } });
  let json: unknown = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, json: json as any, text: res.body };
}

async function register(who: string, referralCode?: string) {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${who}@referral.test`, password: `motdepasse-${who}-1`, displayName: who, orgName: `Boutique ${who}`, ...(referralCode !== undefined ? { referralCode } : {}) } });
  expect(r.statusCode, r.body).toBe(201);
  cookies[who] = cookieOf(r);
  const body = JSON.parse(r.body);
  orgs[who] = body.org.id;
  return body;
}

const past = () => new Date(Date.now() - 3_600_000).toISOString();
const ordersCreated = () => revolut.calls.filter((c) => c.method === "POST" && c.url === "/api/orders").length;

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
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "", REVOLUT_SECRET_KEY: REVOLUT_KEY, REVOLUT_WEBHOOK_SECRET, REVOLUT_MODE: "sandbox", PUBLIC_WEB_URL: "https://app.selio.test", REFERRAL_ENABLED: "true" });
  built = await buildServer(env, { email: new NoopEmailProvider(), payments: new RevolutClient({ secretKey: REVOLUT_KEY, webhookSecret: REVOLUT_WEBHOOK_SECRET, mode: "sandbox", fetchImpl: revolut.fetchImpl }) }, { priceModelRefreshMs: 0 });
  await built.app.ready();
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("parrainage de bout en bout (API, REFERRAL_ENABLED=true)", () => {
  let code = "";

  it("code de la marraine ; inscription avec le code (saisie tolérante) ; codes inconnus ou mal formés ignorés sans bloquer", async () => {
    if (!available) return;
    await register("alice");
    const overview = await call("GET", "/api/referral", undefined, "alice");
    expect(overview.status).toBe(200);
    expect(overview.json).toMatchObject({ enabled: true, referred: { pending: 0, qualified: 0, credited: 0, refused: 0 }, creditsAvailable: 0, referredBy: null });
    code = overview.json.code;
    expect(code).toMatch(REFERRAL_CODE_RE);
    expect(overview.json.shareUrl).toBe(`https://app.selio.test/inscription?parrain=${code}`);
    // Même code à chaque lecture.
    expect((await call("GET", "/api/referral", undefined, "alice")).json.code).toBe(code);

    const typed = `${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()}`;
    const bob = await register("bob", typed);
    expect(bob.referral).toMatchObject({ applied: true });
    // Aucune donnée de la marraine dans la réponse (ni identifiant, ni nom).
    expect(Object.keys(bob.referral).sort()).toEqual(["applied", "message"]);
    expect(JSON.stringify(bob.referral)).not.toContain(orgs.alice!);
    expect(bob.referral.message).toMatch(/un mois vous sera offert/);
    const unknown = await register("carl", "ZZZZZZ");
    expect(unknown.referral).toMatchObject({ applied: false, reason: "unknown_code" });
    const malformed = await register("dora", "AB");
    expect(malformed.referral).toMatchObject({ applied: false, reason: "invalid_code" });
    expect(malformed.referral.message).toMatch(/inscription continue/);

    expect((await call("GET", "/api/referral", undefined, "alice")).json.referred).toEqual({ pending: 1, qualified: 0, credited: 0, refused: 0 });
    expect((await call("GET", "/api/referral", undefined, "bob")).json.referredBy).toEqual({ status: "pending" });
    expect((await call("GET", "/api/referral/credits", undefined, "bob")).json).toEqual([]);
  });

  it("la vérification de carte pendant l'essai ne qualifie pas le parrainage", async () => {
    if (!available) return;
    // Emma s'inscrit avec le code et enregistre sa carte pendant l'essai (1 € autorisé puis annulé).
    const emma = await register("emma", code);
    expect(emma.referral.applied).toBe(true);
    const checkout = await call("POST", "/api/billing/checkout", { plan: "pro" }, "emma");
    expect(checkout.json).toMatchObject({ captureMode: "manual", amountCents: 100 });
    revolut.pay(checkout.json.orderId, "AUTHORISED");
    expect(JSON.parse((await webhook("ORDER_AUTHORISED", checkout.json.orderId, orgs.emma!)).body)).toMatchObject({ handled: true });
    expect((await call("GET", "/api/billing/subscription", undefined, "emma")).json).toMatchObject({ status: "trialing", cardOnFile: true });
    expect((await call("GET", "/api/referral", undefined, "emma")).json).toMatchObject({ referredBy: { status: "pending" }, creditsAvailable: 0 });
    expect((await call("GET", "/api/referral", undefined, "alice")).json.referred).toEqual({ pending: 2, qualified: 0, credited: 0, refused: 0 });
  });

  it("premier paiement encaissé de la filleule (webhook Revolut) : un mois offert à chacune, une seule fois", async () => {
    if (!available) return;
    // Bob termine son essai sans carte (accès de base), puis paie Pro : paiement réel, capture automatique.
    await built.services.db.withOrg(orgs.bob!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: past() }));
    expect(await billing.processSubscriptionRenewal(built.services, orgs.bob!)).toEqual({ action: "trial_ended" });
    const checkout = await call("POST", "/api/billing/checkout", { plan: "pro" }, "bob");
    expect(checkout.status).toBe(200);
    expect(checkout.json).toMatchObject({ captureMode: "automatic", amountCents: 2499 });
    revolut.pay(checkout.json.orderId, "COMPLETED");
    const done = await webhook("ORDER_COMPLETED", checkout.json.orderId, orgs.bob!);
    expect(JSON.parse(done.body)).toMatchObject({ handled: true, duplicate: false });
    const invoices = (await call("GET", "/api/billing/invoices", undefined, "bob")).json;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amountCents).toBe(2499);

    expect((await call("GET", "/api/referral", undefined, "alice")).json).toMatchObject({ referred: { pending: 1, qualified: 1, credited: 0, refused: 0 }, creditsAvailable: 1, creditsConsumed: 0 });
    expect((await call("GET", "/api/referral", undefined, "bob")).json).toMatchObject({ referredBy: { status: "qualified" }, creditsAvailable: 1 });
    const credits = (await call("GET", "/api/referral/credits", undefined, "bob")).json;
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ kind: "referral", months: 1, consumedAt: null });

    // Webhook rejoué : doublon, aucun crédit de plus.
    expect(JSON.parse((await webhook("ORDER_COMPLETED", checkout.json.orderId, orgs.bob!)).body)).toMatchObject({ duplicate: true });
    expect((await call("GET", "/api/referral", undefined, "alice")).json.creditsAvailable).toBe(1);
    const audit = (await call("GET", "/api/audit?limit=50", undefined, "alice")).json.map((a: { action: string }) => a.action);
    expect(audit.filter((a: string) => a === "referral.credit_granted")).toHaveLength(1);
  });

  it("renouvellement à 0 € : mois offert consommé à la place du débit, période prolongée d'un mois, parrainage « credited »", async () => {
    if (!available) return;
    // Bob : échéance passée → mois offert, aucune commande Revolut, facture à 0 € avec la ligne du parrainage.
    const subBob = (await call("GET", "/api/billing/subscription", undefined, "bob")).json;
    const due = past();
    await built.services.db.withOrg(orgs.bob!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: due }));
    const before = ordersCreated();
    const renewed = await billing.processSubscriptionRenewal(built.services, orgs.bob!);
    expect(renewed).toMatchObject({ action: "renewed", reason: "referral_credit" });
    expect(ordersCreated()).toBe(before);
    const after = (await call("GET", "/api/billing/subscription", undefined, "bob")).json;
    expect(after).toMatchObject({ status: "active", plan: subBob.plan, chargeAttempts: 0 });
    expect(new Date(after.currentPeriodEnd).getTime()).toBe(billing.addMonthsUtc(new Date(due), 1).getTime());
    const invoices = (await call("GET", "/api/billing/invoices", undefined, "bob")).json;
    expect(invoices).toHaveLength(2);
    const free = invoices.find((i: { amountCents: number }) => i.amountCents === 0);
    expect(free).toMatchObject({ amountCents: 0, orderId: null });
    const view = await call("GET", `/api/billing/invoices/${free.id}`, undefined, "bob");
    expect(view.json.totals).toMatchObject({ inclVatCents: 0 });
    expect(view.json.lines.some((l: { kind: string; label: string }) => l.kind === "credit" && l.label === REFERRAL_CREDIT_LINE_LABEL)).toBe(true);
    expect((await call("GET", "/api/referral", undefined, "bob")).json).toMatchObject({ creditsAvailable: 0, creditsConsumed: 1, referredBy: { status: "qualified" } });

    // Alice : fin d'essai avec carte enregistrée → le mois offert remplace le premier débit.
    await built.services.db.withOrg(orgs.alice!, (tx) => repos.subscriptions.upsert(tx, { provider: "revolut", cardOnFile: true, paymentMethodId: "pm_ref_1", revolutCustomerId: "cus_ref_alice", pendingPlan: "pro", currentPeriodEnd: past() }));
    const beforeA = ordersCreated();
    expect(await billing.processSubscriptionRenewal(built.services, orgs.alice!)).toMatchObject({ action: "renewed", reason: "referral_credit" });
    expect(ordersCreated()).toBe(beforeA);
    expect((await call("GET", "/api/billing/subscription", undefined, "alice")).json).toMatchObject({ status: "active", plan: "pro" });
    const invA = (await call("GET", "/api/billing/invoices", undefined, "alice")).json;
    expect(invA).toHaveLength(1);
    expect(invA[0]).toMatchObject({ amountCents: 0, orderId: null });

    // Les deux mois offerts appliqués : parrainage « credited ».
    expect((await call("GET", "/api/referral", undefined, "alice")).json).toMatchObject({ referred: { pending: 1, qualified: 0, credited: 1, refused: 0 }, creditsAvailable: 0, creditsConsumed: 1 });
    expect((await call("GET", "/api/referral", undefined, "bob")).json.referredBy).toEqual({ status: "credited" });

    // Échéance suivante : plus de crédit, débit normal de la carte.
    await built.services.db.withOrg(orgs.bob!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: past() }));
    const charged = await billing.processSubscriptionRenewal(built.services, orgs.bob!);
    expect(charged).toMatchObject({ action: "renewed" });
    expect(charged).not.toMatchObject({ reason: "referral_credit" });
    expect(ordersCreated()).toBe(beforeA + 1);
  });

  it("droits : page et code pour titulaire et administrateurs ; mois offerts pour qui voit les finances", async () => {
    if (!available) return;
    // Un exécuteur dans l'organisation d'Alice.
    const inv = await call("POST", "/api/org/members", { email: "exec@referral.test", role: "operator" }, "alice");
    expect(inv.status).toBe(201);
    const { hashPassword } = await import("@selio/db");
    const { hash, salt } = await hashPassword("exec-mdp-solide-1");
    await built.services.db.withGlobal((tx) => repos.users.setPassword(tx, inv.json.user.id, hash, salt));
    const login = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "exec@referral.test", password: "exec-mdp-solide-1" } });
    cookies.exec = cookieOf(login);
    expect((await call("GET", "/api/referral", undefined, "exec")).status).toBe(403);
    expect((await call("GET", "/api/referral/credits", undefined, "exec")).status).toBe(403);
    expect((await call("GET", "/api/referral", undefined, "anonyme")).status).toBe(401);
  });
});
