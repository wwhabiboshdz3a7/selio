import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, repos, type PgPool } from "@selio/db";
import { RevolutClient, computeRevolutSignature } from "@selio/connectors";
import { billing } from "@selio/core";
import { NoopEmailProvider } from "@selio/email";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Offres commerciales de bout en bout par l'API, sur une base dédiée selio_test_api_offers (créée si besoin) :
 * création par un opérateur « business » (Elias), refus 403 pour un client, bandeau public sans session,
 * vérification d'un code, code à l'inscription, paiement et renouvellement remisés, remise à 100 % (facture à
 * 0 €, aucun débit), maximum atteint, suppression ou archivage. Revolut est simulé en HTTP (client Revolut réel,
 * bac à sable, aucun appel réseau, aucun débit réel), comme dans referral.test.ts ; webhooks signés.
 */
const OWNER_URL = process.env.TEST_API_OFFERS_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_offers";
const APP_URL = process.env.TEST_API_OFFERS_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_offers";
const REVOLUT_KEY = "sk_test_placeholder_offers_0123";
const REVOLUT_WEBHOOK_SECRET = "wsk_test_secret_offers_0123";

let available = true;
let owner: PgPool;
let built: BuiltServer;
const cookies: Record<string, string> = {};
const orgs: Record<string, string> = {};

interface FakeOrder { id: string; token: string; state: string; amount: number; currency: string; capture_mode: string; customer: { id: string }; payments: { id: string; state: string; payment_method: { id: string; type: string } }[] }
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
    if (method === "POST" && url.pathname === "/api/1.0/customers") return json(201, { id: `cus_off_${String(body?.email ?? "x").split("@")[0]}`, email: body?.email });
    if (method === "POST" && url.pathname === "/api/orders") {
      n++;
      const customer = body?.customer as { id?: string } | undefined;
      const o: FakeOrder = { id: `ord_off_${n}`, token: `tok_off_${n}`, state: "pending", amount: Number(body?.amount), currency: "EUR", capture_mode: String(body?.capture_mode), customer: { id: customer?.id ?? "cus_off_x" }, payments: [] };
      orders.set(o.id, o);
      return json(201, o);
    }
    const m = url.pathname.match(/^\/api\/orders\/([^/]+)(?:\/(payments|cancel))?$/);
    if (m) {
      const o = orders.get(m[1]!);
      if (!o) return json(404, { code: "not_found", message: "order" });
      if (method === "POST" && m[2] === "payments") {
        o.payments.push({ id: `pay_${o.id}`, state: "COMPLETED", payment_method: { id: "pm_off_1", type: "CARD" } });
        o.state = "completed";
        return json(201, { id: `pay_${o.id}`, order_id: o.id, state: "COMPLETED" });
      }
      if (method === "POST" && m[2] === "cancel") { o.state = "cancelled"; return json(200, o); }
      if (method === "GET" && !m[2]) return json(200, o);
    }
    if (method === "GET" && /^\/api\/1\.0\/customers\/[^/]+\/payment-methods$/.test(url.pathname)) {
      return json(200, [{ id: "pm_off_1", type: "CARD", created_at: "2026-10-01T10:00:00Z", method_details: { brand: "visa", last4: "4242", expiry_month: 12, expiry_year: 2030 } }]);
    }
    return json(404, { code: "not_found", message: url.pathname });
  };
  const pay = (orderId: string) => {
    const o = orders.get(orderId)!;
    o.payments.push({ id: `pay_${orderId}_${o.payments.length + 1}`, state: "COMPLETED", payment_method: { id: "pm_off_1", type: "CARD" } });
    o.state = "completed";
  };
  return { orders, calls, fetchImpl, pay };
})();
const ordersCreated = () => revolut.calls.filter((c) => c.method === "POST" && c.url === "/api/orders");

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

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body: unknown, who: string | null) {
  const res = await built.app.inject({ method, url, payload: body as object | undefined, headers: who ? { cookie: cookies[who] ?? "" } : {} });
  let json: unknown = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = res.body; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, json: json as any, headers: res.headers, text: res.body };
}

async function register(who: string, extra: Record<string, unknown> = {}) {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${who}@offers.test`, password: `motdepasse-${who}-1`, displayName: who, orgName: `Boutique ${who}`, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  cookies[who] = cookieOf(r);
  const body = JSON.parse(r.body);
  orgs[who] = body.org.id;
  return body;
}

const past = () => new Date(Date.now() - 3_600_000).toISOString();
const redemptionOf = (who: string) => built.services.db.withOrg(orgs[who]!, (tx) => repos.offerRedemptions.get(tx, orgs[who]!));
/** Fin d'essai sans carte : accès de base, le paiement suivant est immédiat (capture automatique). */
async function endTrial(who: string) {
  await built.services.db.withOrg(orgs[who]!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: past() }));
  expect(await billing.processSubscriptionRenewal(built.services, orgs[who]!)).toEqual({ action: "trial_ended" });
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits, invoice_counters, commercial_offers cascade");
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: "", OPERATOR_BUSINESS_EMAILS: "elias@offers.test", REVOLUT_SECRET_KEY: REVOLUT_KEY, REVOLUT_WEBHOOK_SECRET, REVOLUT_MODE: "sandbox", PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { email: new NoopEmailProvider(), payments: new RevolutClient({ secretKey: REVOLUT_KEY, webhookSecret: REVOLUT_WEBHOOK_SECRET, mode: "sandbox", fetchImpl: revolut.fetchImpl }) }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  await register("elias");
  await register("cliente");
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("offres commerciales (API)", () => {
  let printempsId = "";

  it("Elias (opérateur business) crée une offre ; un client reçoit 403 ; validation claire et code unique sans casse", async () => {
    if (!available) return;
    const created = await call("POST", "/api/admin/offers", { name: "Printemps", code: "printemps", discountPercent: 20, plans: ["pro"], durationMonths: 3, bannerEnabled: true }, "elias");
    expect(created.status, created.text).toBe(201);
    expect(created.json).toMatchObject({ name: "Printemps", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: 3, redemptions: 0, active: true, bannerEnabled: true });
    printempsId = created.json.id;

    expect((await call("POST", "/api/admin/offers", { name: "Pirate", discountPercent: 10 }, "cliente")).status).toBe(403);
    expect((await call("GET", "/api/admin/offers", undefined, "cliente")).status).toBe(403);
    expect((await call("PATCH", `/api/admin/offers/${printempsId}`, { active: false }, "cliente")).status).toBe(403);
    expect((await call("DELETE", `/api/admin/offers/${printempsId}`, undefined, "cliente")).status).toBe(403);

    const both = await call("POST", "/api/admin/offers", { name: "Double", discountPercent: 10, discountCents: 500 }, "elias");
    expect(both.status).toBe(400);
    expect(both.json.error.message).toMatch(/exactement l'un des deux/);
    expect((await call("POST", "/api/admin/offers", { name: "Rien" }, "elias")).status).toBe(400);
    const dup = await call("POST", "/api/admin/offers", { name: "Copie", code: "Printemps", discountCents: 500 }, "elias");
    expect(dup.status).toBe(409);
    expect(dup.json.error.message).toMatch(/PRINTEMPS est déjà utilisé/);

    const list = await call("GET", "/api/admin/offers", undefined, "elias");
    expect(list.status).toBe(200);
    expect(list.json.map((o: { code: string }) => o.code)).toEqual(["PRINTEMPS"]);
    const audit = (await call("GET", "/api/audit?limit=20", undefined, "elias")).json.map((a: { action: string }) => a.action);
    expect(audit).toContain("admin.offer_created");
  });

  it("bandeau public sans session : texte construit, aucune donnée interne, mis en cache court", async () => {
    if (!available) return;
    const r = await call("GET", "/api/offers/banner", undefined, null);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=60");
    expect(r.json.offers).toHaveLength(1);
    expect(r.json.offers[0]).toEqual({ id: printempsId, name: "Printemps", bannerText: "-20 % sur Pro pendant 3 mois avec le code PRINTEMPS", code: "PRINTEMPS", discountPercent: 20, discountCents: null, plans: ["pro"], durationMonths: 3, endsAt: null });
    expect(r.text).not.toMatch(/createdBy|redemptions|maxRedemptions/);
    // Bandeau désactivé : plus rien d'affiché.
    expect((await call("PATCH", `/api/admin/offers/${printempsId}`, { bannerEnabled: false }, "elias")).status).toBe(200);
    expect((await call("GET", "/api/offers/banner", undefined, null)).json.offers).toEqual([]);
    expect((await call("PATCH", `/api/admin/offers/${printempsId}`, { bannerEnabled: true, bannerText: "Le printemps de Selio : -20 % sur Pro" }, "elias")).json.bannerText).toBe("Le printemps de Selio : -20 % sur Pro");
    expect((await call("GET", "/api/offers/banner", undefined, null)).json.offers[0].bannerText).toBe("Le printemps de Selio : -20 % sur Pro");
  });

  it("vérification d'un code : inconnu, mal formé, forfait non concerné, expiré, valable (prix remisés)", async () => {
    if (!available) return;
    expect((await call("POST", "/api/offers/check", { code: "PRINTEMPS" }, null)).status).toBe(401);
    expect((await call("POST", "/api/offers/check", { code: "INCONNU" }, "cliente")).json).toMatchObject({ valid: false, reason: "unknown_code", message: "Code promo inconnu." });
    expect((await call("POST", "/api/offers/check", { code: "!!" }, "cliente")).json).toMatchObject({ valid: false, reason: "invalid_code" });
    expect((await call("POST", "/api/offers/check", { code: "printemps", plan: "starter" }, "cliente")).json).toMatchObject({ valid: false, reason: "plan_not_covered", message: "Ce code promo est valable sur Pro seulement." });
    const ok = await call("POST", "/api/offers/check", { code: " printemps ", plan: "pro" }, "cliente");
    expect(ok.json).toMatchObject({ valid: true, offer: { code: "PRINTEMPS" }, prices: [{ plan: "pro", cycle: "monthly", priceCents: 2499, discountedCents: 1999 }] });
    const expired = await call("POST", "/api/admin/offers", { name: "Hiver", code: "HIVER", discountPercent: 30, startsAt: "2025-01-01T00:00:00.000Z", endsAt: "2025-02-01T00:00:00.000Z" }, "elias");
    expect(expired.status).toBe(201);
    expect((await call("POST", "/api/offers/check", { code: "hiver" }, "cliente")).json).toMatchObject({ valid: false, reason: "expired", message: "Ce code promo a expiré." });
  });

  it("code à l'inscription, puis paiement remisé (facture avec la ligne de remise) et renouvellement remisé", async () => {
    if (!available) return;
    const marie = await register("marie", { promoCode: "printemps" });
    expect(marie.promo).toMatchObject({ applied: true });
    expect(marie.promo.message).toMatch(/PRINTEMPS enregistré/);
    // Code inconnu à l'inscription : ignoré, jamais bloquant.
    const paul = await register("paul", { promoCode: "NIMPORTE" });
    expect(paul.promo).toMatchObject({ applied: false, reason: "unknown_code" });
    expect(paul.promo.message).toMatch(/inscription continue/);
    expect(await redemptionOf("marie")).toMatchObject({ code: "PRINTEMPS", discountPercent: 20, monthsRemaining: 3 });
    expect((await call("GET", "/api/billing/offer", undefined, "marie")).json.redemption).toMatchObject({ name: "Printemps", monthsRemaining: 3 });

    await endTrial("marie");
    const checkout = await call("POST", "/api/billing/checkout", { plan: "pro" }, "marie");
    expect(checkout.status, checkout.text).toBe(200);
    expect(checkout.json).toMatchObject({ captureMode: "automatic", amountCents: 1999 });
    expect(checkout.json.message).toMatch(/remise « Printemps \(PRINTEMPS\) »/);
    expect(revolut.orders.get(checkout.json.orderId)!.amount).toBe(1999);
    // Rien n'est décompté tant que l'échéance n'est pas payée.
    expect((await redemptionOf("marie"))!.monthsRemaining).toBe(3);
    revolut.pay(checkout.json.orderId);
    expect(JSON.parse((await webhook("ORDER_COMPLETED", checkout.json.orderId, orgs.marie!)).body)).toMatchObject({ handled: true });
    expect((await redemptionOf("marie"))!.monthsRemaining).toBe(2);

    const invoices = (await call("GET", "/api/billing/invoices", undefined, "marie")).json;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amountCents: 1999 });
    const view = (await call("GET", `/api/billing/invoices/${invoices[0].id}`, undefined, "marie")).json;
    expect(view.lines.map((l: { kind: string; label: string; amountCents: number }) => [l.kind, l.label, l.amountCents])).toEqual([
      ["plan", "Abonnement Selio Pro — mensuel", 2499],
      ["discount", "Remise : Printemps (PRINTEMPS)", -500],
    ]);
    // TVA calculée sur le total remisé : HT arrondi, TVA = différence, TTC exact.
    expect(view.totals).toEqual({ exclVatCents: 1666, vatCents: 333, inclVatCents: 1999, vatRate: 20 });

    // Renouvellement : débit remisé de la carte enregistrée, un mois de plus décompté.
    await built.services.db.withOrg(orgs.marie!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: past() }));
    expect(await billing.processSubscriptionRenewal(built.services, orgs.marie!)).toMatchObject({ action: "renewed" });
    expect(ordersCreated().at(-1)!.body).toMatchObject({ amount: 1999 });
    expect((await redemptionOf("marie"))!.monthsRemaining).toBe(1);
    // Une seule offre par organisation : un second code est refusé (l'équipe Selio seule peut la remplacer).
    const again = await call("POST", "/api/billing/offer", { code: "PRINTEMPS" }, "marie");
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/une seule offre à la fois/);
    // Dernier mois remisé, puis plein tarif.
    await built.services.db.withOrg(orgs.marie!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: past() }));
    await billing.processSubscriptionRenewal(built.services, orgs.marie!);
    expect(ordersCreated().at(-1)!.body).toMatchObject({ amount: 1999 });
    expect((await redemptionOf("marie"))!.monthsRemaining).toBe(0);
    await built.services.db.withOrg(orgs.marie!, (tx) => repos.subscriptions.upsert(tx, { currentPeriodEnd: past() }));
    await billing.processSubscriptionRenewal(built.services, orgs.marie!);
    expect(ordersCreated().at(-1)!.body).toMatchObject({ amount: 2499 });
    expect((await call("GET", "/api/admin/offers", undefined, "elias")).json.find((o: { id: string }) => o.id === printempsId).redemptions).toBe(1);
  });

  it("remise à 100 % : facture à 0 € sans commande ni débit ; maximum d'utilisations atteint", async () => {
    if (!available) return;
    const free = await call("POST", "/api/admin/offers", { name: "Lancement", code: "LANCEMENT", discountPercent: 100, durationMonths: 1, maxRedemptions: 1 }, "elias");
    expect(free.status).toBe(201);
    await register("lea");
    await register("tom");
    const applied = await call("POST", "/api/billing/offer", { code: "lancement" }, "lea");
    expect(applied.status, applied.text).toBe(200);
    expect(applied.json).toMatchObject({ applied: true, redemption: { discountPercent: 100, monthsRemaining: 1 } });
    const full = await call("POST", "/api/billing/offer", { code: "LANCEMENT" }, "tom");
    expect(full.status).toBe(400);
    expect(full.json.error.message).toBe("Ce code promo a atteint son nombre maximum d'utilisations.");

    await endTrial("lea");
    const before = ordersCreated().length;
    const checkout = await call("POST", "/api/billing/checkout", { plan: "starter" }, "lea");
    expect(checkout.status, checkout.text).toBe(200);
    expect(checkout.json).toMatchObject({ amountCents: 0, orderToken: null, orderId: null });
    expect(ordersCreated().length).toBe(before);
    expect((await call("GET", "/api/billing/subscription", undefined, "lea")).json).toMatchObject({ status: "active", plan: "starter" });
    const invoices = (await call("GET", "/api/billing/invoices", undefined, "lea")).json;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amountCents: 0, orderId: null });
    const view = (await call("GET", `/api/billing/invoices/${invoices[0].id}`, undefined, "lea")).json;
    expect(view.totals).toMatchObject({ inclVatCents: 0, vatCents: 0 });
    expect(view.lines.find((l: { kind: string }) => l.kind === "discount")).toMatchObject({ label: "Remise : Lancement (LANCEMENT)", amountCents: -699 });
    expect((await redemptionOf("lea"))!.monthsRemaining).toBe(0);
    // Le bandeau n'affiche plus une offre pleine.
    expect((await call("GET", "/api/offers/banner", undefined, null)).json.offers.map((o: { code: string }) => o.code)).not.toContain("LANCEMENT");
  });

  it("suppression : réelle si l'offre n'a jamais servi, archivage sinon", async () => {
    if (!available) return;
    const list = (await call("GET", "/api/admin/offers", undefined, "elias")).json as { id: string; code: string }[];
    const hiver = list.find((o) => o.code === "HIVER")!;
    expect((await call("DELETE", `/api/admin/offers/${hiver.id}`, undefined, "elias")).json).toMatchObject({ deleted: true, archived: false });
    const archived = await call("DELETE", `/api/admin/offers/${printempsId}`, undefined, "elias");
    expect(archived.json).toMatchObject({ deleted: false, archived: true, offer: { active: false, bannerEnabled: false } });
    expect(archived.json.offer.archivedAt).toBeTruthy();
    const after = (await call("GET", "/api/admin/offers", undefined, "elias")).json as { id: string }[];
    expect(after.some((o) => o.id === hiver.id)).toBe(false);
    expect(after.some((o) => o.id === printempsId)).toBe(true);
    // L'organisation garde son instantané ; le code ne s'applique plus ailleurs.
    expect((await call("POST", "/api/offers/check", { code: "PRINTEMPS" }, "tom")).json).toMatchObject({ valid: false, reason: "inactive" });
    const audit = (await call("GET", "/api/audit?limit=50", undefined, "elias")).json.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["admin.offer_deleted", "admin.offer_archived", "admin.offer_updated"]));
  });
});
