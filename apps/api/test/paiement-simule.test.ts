import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, type PgPool } from "@selio/db";
import { SIMULATED_PAYMENT_NOTICE } from "@selio/contracts";
import { billing } from "@selio/core";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Paiement simulé en attendant Revolut (REVOLUT_* vides) ; capacités du serveur ; inscription d'un opérateur
 * « business » visible dans Selio Admin ; invitation avec lien à copier (email « noop ») ; « Ajouter cette
 * personne à mon organisation ». Base dédiée selio_test_api_paiement_simule (créée si besoin).
 * Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_SIMULATED_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_paiement_simule";
const APP_URL = process.env.TEST_API_SIMULATED_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_paiement_simule";
const ENCRYPTION_KEY = SecretBox.generateKey();

const TECH = "ibrahim@simule.test";
const BUSINESS = "elias@simule.test";

let available = true;
let owner: PgPool;
let built: BuiltServer;
let clock = new Date("2026-11-16T10:00:00.000Z");
const cookies: Record<string, string> = {};
const orgs: Record<string, string> = {};
const users: Record<string, string> = {};

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

const call = (who: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  built.app.inject({ method, url, headers: { cookie: cookies[who] ?? "" }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const json = async (who: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) => {
  const r = await call(who, method, url, payload);
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

async function register(who: string, email: string) {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "motdepasse-S1", displayName: who, orgName: `Boutique ${who}` } });
  expect(r.statusCode).toBe(201);
  cookies[who] = cookieOf(r);
  const body = JSON.parse(r.body);
  orgs[who] = body.org.id;
  users[who] = body.user.id;
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits, referrals cascade");
  } catch {
    available = false;
    return;
  }
  // Configuration de production d'Ibrahim : aucune clé Revolut, emails « noop », Elias opérateur « business ».
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: TECH, OPERATOR_BUSINESS_EMAILS: ` ${BUSINESS.toUpperCase()} `, PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { now: () => clock }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  await register("tech", TECH);
  await register("client", "client@simule.test");
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("capacités du serveur", () => {
  it("public, sans secret : Track, Cloud, vision et modèle de prix pas branchés, paiement simulé, emails journalisés", async () => {
    if (!available) return;
    const r = await built.app.inject({ method: "GET", url: "/api/capabilities" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(r.body)).toEqual({ demo: false, version: expect.any(String), trackLive: false, cloud: false, radarLive: false, vision: false, pricingModel: false, payment: "simulated", paymentSandbox: null, email: false });
    expect(r.body).not.toContain(ENCRYPTION_KEY);
  });
});

describe("inscription d'un opérateur « business » (Elias)", () => {
  it("apparaît dans Selio Admin › Comptes (en tête, sans filtre) et dans le tableau de bord", async () => {
    if (!available) return;
    const before = await json("tech", "GET", "/api/admin/growth");
    expect(before.status).toBe(200);
    await register("business", BUSINESS);
    const session = await json("business", "GET", "/api/auth/session");
    expect(session.body.user).toMatchObject({ operatorRole: "business" });
    for (const who of ["tech", "business"]) {
      const list = await json(who, "GET", "/api/admin/accounts");
      expect(list.status).toBe(200);
      expect(list.body[0]).toMatchObject({ id: orgs.business, ownerEmail: BUSINESS, status: "trialing", plan: "pro" });
      const found = await json(who, "GET", `/api/admin/accounts?q=${encodeURIComponent("elias")}`);
      expect(found.body.map((a: { id: string }) => a.id)).toEqual([orgs.business]);
      const growth = await json(who, "GET", "/api/admin/growth");
      expect(growth.body.accounts.total).toBe(before.body.accounts.total + 1);
      expect(growth.body.accounts.trialing).toBe(before.body.accounts.trialing + 1);
      expect(growth.body.signups.last7Days).toBe(before.body.signups.last7Days + 1);
    }
  });

  it("son organisation est la sienne : « mon équipe » (Ibrahim) ne le contient pas tant qu'il n'y est pas ajouté", async () => {
    if (!available) return;
    const team = await json("tech", "GET", "/api/org/members");
    expect(team.body.map((m: { user: { email: string } }) => m.user.email)).toEqual([TECH]);
  });

  it("« Ajouter cette personne à mon organisation » depuis la fiche : membre avec le rôle choisi, sans nouveau mot de passe", async () => {
    if (!available) return;
    const denied = await json("client", "POST", `/api/admin/accounts/${orgs.business}/add-to-my-org`, { userId: users.business, role: "admin" });
    expect(denied.status).toBe(403);
    const owner = await json("tech", "POST", `/api/admin/accounts/${orgs.business}/add-to-my-org`, { userId: users.business, role: "owner" });
    expect(owner.status).toBe(400);
    const stranger = await json("tech", "POST", `/api/admin/accounts/${orgs.business}/add-to-my-org`, { userId: users.client, role: "admin" });
    expect(stranger.status).toBe(404);
    const ok = await json("tech", "POST", `/api/admin/accounts/${orgs.business}/add-to-my-org`, { userId: users.business, role: "admin" });
    expect(ok.status).toBe(200);
    const again = await json("tech", "POST", `/api/admin/accounts/${orgs.business}/add-to-my-org`, { userId: users.business, role: "admin" });
    expect(again.status).toBe(409);
    const team = await json("tech", "GET", "/api/org/members");
    expect(team.body.find((m: { user: { email: string } }) => m.user.email === BUSINESS)).toMatchObject({ role: "admin" });
    // Elias voit les deux organisations et passe dans celle d'Ibrahim.
    const session = await json("business", "GET", "/api/auth/session");
    expect(session.body.memberships.map((m: { orgId: string }) => m.orgId).sort()).toEqual([orgs.business, orgs.tech].sort());
    const switched = await json("business", "POST", "/api/auth/switch-org", { orgId: orgs.tech });
    expect(switched.status).toBe(200);
    expect(switched.body.org.id).toBe(orgs.tech);
    await json("business", "POST", "/api/auth/switch-org", { orgId: orgs.business });
  });
});

describe("invitation par email avec lien à copier (email « noop »)", () => {
  it("nouveau compte : lien d'invitation rendu, email non délivré ; compte existant : ajouté sans lien", async () => {
    if (!available) return;
    const fresh = await json("tech", "POST", "/api/org/members", { email: "nouvelle@simule.test", role: "operator" });
    expect(fresh.status).toBe(201);
    expect(fresh.body.invite).toMatchObject({ existingAccount: false, emailDelivered: false, link: expect.stringMatching(/^https:\/\/app\.selio\.test\/invitation\?token=[\w-]{20,}$/), expiresAt: expect.any(String) });
    // Le lien copié fonctionne : la personne choisit son mot de passe et arrive dans l'organisation.
    const token = new URL(fresh.body.invite.link).searchParams.get("token");
    const accepted = await built.app.inject({ method: "POST", url: "/api/auth/invite/accept", payload: { token, password: "motdepasse-I1", displayName: "Nouvelle" } });
    expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(accepted.body).org.id).toBe(orgs.tech);
    // (L'organisation d'Ibrahim a atteint son quota de membres : l'invitation suivante part de celle d'Elias.)
    const existing = await json("business", "POST", "/api/org/members", { email: "client@simule.test", role: "viewer" });
    expect(existing.status).toBe(201);
    expect(existing.body.invite).toEqual({ existingAccount: true, emailDelivered: false, link: null, expiresAt: null });
  });
});

describe("paiement simulé (REVOLUT_* vides)", () => {
  it("récapitulatif : forfait, prix, fin d'essai, aucune carte", async () => {
    if (!available) return;
    const p = await json("client", "GET", "/api/billing/checkout/preview?plan=starter&cycle=monthly");
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ plan: "starter", cycle: "monthly", planLabel: "Starter", paymentMode: "simulated", noCardRequired: true, startsTrial: false, blockedReason: null, discount: null });
    expect(p.body.priceCents).toBeGreaterThan(0);
    expect(p.body.dueCents).toBe(p.body.priceCents);
    expect(p.body.trialEndsAt).toBe("2026-11-30T10:00:00.000Z");
  });

  it("confirmation : offre retenue sans carte ni débit, essai inchangé, journalisé", async () => {
    if (!available) return;
    const r = await json("client", "POST", "/api/billing/checkout", { plan: "starter", cycle: "yearly" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ simulated: true, orderToken: null, orderId: null, mode: null, captureMode: null, amountCents: 0, trialEndsAt: "2026-11-30T10:00:00.000Z" });
    expect(r.body.message).toContain(SIMULATED_PAYMENT_NOTICE);
    const sub = await json("client", "GET", "/api/billing/subscription");
    expect(sub.body).toMatchObject({ status: "trialing", plan: "pro", pendingPlan: "starter", cycle: "yearly", cardOnFile: false, provider: "none", awaitingPaymentSince: null });
    expect(sub.body.simulatedCheckoutAt).toBe(clock.toISOString());
    const orders = await owner.query("select count(*)::int as n from payment_orders where org_id = $1", [orgs.client]);
    expect(orders.rows[0].n).toBe(0);
    const audit = await json("client", "GET", "/api/audit?limit=20");
    expect(audit.body.some((a: { action: string }) => a.action === "billing.simulated_checkout")).toBe(true);
    // Changement de carte : rien à enregistrer.
    const card = await json("client", "POST", "/api/billing/card");
    expect(card.body).toMatchObject({ simulated: true, orderToken: null });
  });

  it("fin d'essai : aucun débit, accès de base « en attente du paiement », offre gardée ; l'opérateur prolonge", async () => {
    if (!available) return;
    clock = new Date("2026-12-01T10:00:00.000Z");
    const outcome = await billing.processSubscriptionRenewal(built.services, orgs.client!);
    expect(outcome).toEqual({ action: "trial_ended", reason: "awaiting_payment" });
    const sub = await json("client", "GET", "/api/billing/subscription");
    expect(sub.body).toMatchObject({ status: "canceled", plan: "free", pendingPlan: "starter", cycle: "yearly", awaitingPaymentSince: clock.toISOString() });
    expect((await owner.query("select count(*)::int as n from payment_orders where org_id = $1", [orgs.client])).rows[0].n).toBe(0);
    // Une nouvelle confirmation ne relance pas un essai : refus clair.
    const again = await json("client", "POST", "/api/billing/checkout", { plan: "pro" });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/essai est terminé/);
    // Selio Admin voit l'attente et prolonge l'essai : la marque disparaît.
    const row = (await json("tech", "GET", "/api/admin/accounts")).body.find((a: { id: string }) => a.id === orgs.client);
    expect(row.awaitingPaymentSince).toBe(clock.toISOString());
    const ext = await json("tech", "POST", `/api/admin/accounts/${orgs.client}/extend-trial`, { days: 7 });
    expect(ext.status).toBe(200);
    expect(ext.body).toMatchObject({ status: "trialing", awaitingPaymentSince: null });
    // Le worker ne débite jamais en mode simulé, même pendant la prolongation.
    expect(await billing.processSubscriptionRenewal(built.services, orgs.client!)).toEqual({ action: "skipped", reason: "trial_running" });
  });
});
