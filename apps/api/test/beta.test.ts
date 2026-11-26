import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, type PgPool } from "@selio/db";
import { BETA_CODE, BETA_INVOICE_LINE_LABEL, INVOICE_NUMBER_RE } from "@selio/contracts";
import { billing } from "@selio/core";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Bêta Selio (code BETA2026SELIO, migration 0024) en paiement simulé (aucune clé Revolut, comme la production de
 * lundi) : inscription avec et sans code, code invalide, deuxième utilisation refusée, facture à 0 €, rappels,
 * fin du mois → 402 `beta_ended` sur une action métier, prolongation par un opérateur → débloqué, page de paiement
 * après la fin → débloqué, maximum d'utilisations et désactivation depuis Selio Admin › Offres.
 * Base dédiée selio_test_api_beta (créée si besoin). Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_BETA_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_beta";
const APP_URL = process.env.TEST_API_BETA_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_beta";
const ENCRYPTION_KEY = SecretBox.generateKey();
const TECH = "ibrahim@beta.test";
const DAY = 86_400_000;

let available = true;
let owner: PgPool;
let built: BuiltServer;
const start = new Date("2026-11-30T09:00:00.000Z");
let clock = new Date(start);
const cookies: Record<string, string> = {};
const orgs: Record<string, string> = {};

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

type Method = "GET" | "POST" | "PATCH" | "DELETE";
async function json(who: string | null, method: Method, url: string, payload?: unknown) {
  const r = await built.app.inject({ method, url, headers: who ? { cookie: cookies[who] ?? "" } : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function register(who: string, promoCode?: string) {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${who}@beta.test`, password: "motdepasse-S1", displayName: who, orgName: `Boutique ${who}`, ...(promoCode !== undefined ? { promoCode } : {}) } });
  expect(r.statusCode).toBe(201);
  cookies[who] = cookieOf(r);
  const body = JSON.parse(r.body);
  orgs[who] = body.org.id;
  return body;
}

let itemSeq = 0;
const createItem = (who: string) => json(who, "POST", "/api/items", { title: `Veste bêta ${++itemSeq}`, listedPriceCents: 2500, status: "in_stock" });

/** Session de 30 jours : après un grand saut d'horloge, on se reconnecte (comme la personne le ferait). */
async function relogin(who: string) {
  const r = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: who === "tech" ? TECH : `${who}@beta.test`, password: "motdepasse-S1" } });
  expect(r.statusCode).toBe(200);
  cookies[who] = cookieOf(r);
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits, invoice_counters, commercial_offers cascade");
    // La migration 0024 est rejouable : elle recrée le code de la bêta (comme en production lundi), sans doublon.
    const sql = await readFile(join(MIGRATIONS_DIR, "0024_beta.sql"), "utf8");
    await owner.query(sql);
    await owner.query(sql);
  } catch {
    available = false;
    return;
  }
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: TECH, PUBLIC_WEB_URL: "https://app.selio.test" });
  built = await buildServer(env, { now: () => clock }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: TECH, password: "motdepasse-S1", displayName: "Ibrahim", orgName: "Selio" } });
  cookies.tech = cookieOf(r);
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("code de la bêta créé par la migration", () => {
  it("une seule offre BETA2026SELIO, sorte « beta », 30 jours, visible dans Selio Admin › Offres, absente du bandeau public", async () => {
    if (!available) return;
    const list = await json("tech", "GET", "/api/admin/offers");
    expect(list.status).toBe(200);
    const betas = list.body.filter((o: { code: string | null }) => o.code === BETA_CODE);
    expect(betas).toHaveLength(1);
    expect(betas[0]).toMatchObject({ kind: "beta", betaDays: 30, active: true, redemptions: 0, maxRedemptions: null, endsAt: null });
    await json("tech", "PATCH", `/api/admin/offers/${betas[0].id}`, { bannerEnabled: true });
    const banner = await json(null, "GET", "/api/offers/banner");
    expect(banner.body.offers).toEqual([]);
    await json("tech", "PATCH", `/api/admin/offers/${betas[0].id}`, { bannerEnabled: false });
  });

  it("vérification à l'inscription, sans session : casse, espaces et tirets ignorés ; un code faux a un message clair", async () => {
    if (!available) return;
    for (const code of ["beta2026selio", "BETA-2026-SELIO", " Beta 2026 Selio "]) {
      const ok = await json(null, "POST", "/api/offers/check-signup", { code });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ valid: true, beta: { days: 30, plan: "pro" } });
      expect(ok.body.message).toMatch(/sans carte bancaire/);
    }
    const bad = await json(null, "POST", "/api/offers/check-signup", { code: "BETA2025SELIO" });
    expect(bad.body.valid).toBe(false);
    expect(bad.body.message).toMatch(/inconnu.*videz le champ pour commencer l'essai gratuit/);
  });
});

describe("inscription avec le code", () => {
  it("accès bêta de 30 jours à Pro, sans carte, compte qualifié « Bêta », facture à 0,00 € numérotée", async () => {
    if (!available) return;
    const body = await register("alice", "beta2026selio");
    expect(body.promo).toMatchObject({ applied: true, beta: { days: 30, plan: "pro" } });
    expect(body.promo.message).toMatch(/Bienvenue dans la bêta.*30\/12\/2026.*sans carte bancaire/);
    expect(body.beta).toMatchObject({ code: BETA_CODE, plan: "pro", state: "running", blocked: false, daysLeft: 30, reminder: null, paymentReady: false, welcomeSeen: false, endsAt: new Date(start.getTime() + 30 * DAY).toISOString() });
    expect(body.beta.invoiceNumber).toMatch(INVOICE_NUMBER_RE);
    const sub = await json("alice", "GET", "/api/billing/subscription");
    expect(sub.body).toMatchObject({ plan: "pro", status: "trialing", provider: "none", cardOnFile: false, currentPeriodEnd: body.beta.endsAt });
    const invoices = await json("alice", "GET", "/api/billing/invoices");
    expect(invoices.body).toHaveLength(1);
    expect(invoices.body[0]).toMatchObject({ number: body.beta.invoiceNumber, amountCents: 0, plan: "pro", orderId: null, extraLines: [{ kind: "discount", product: "beta_access", label: BETA_INVOICE_LINE_LABEL }] });
    const view = await json("alice", "GET", `/api/billing/invoices/${invoices.body[0].id}`);
    expect(view.body.totals.inclVatCents).toBe(0);
    expect(view.body.lines.map((l: { label: string }) => l.label)).toContain(BETA_INVOICE_LINE_LABEL);
    expect(view.body.paymentProvider).toBeNull();
    const account = await json("tech", "GET", `/api/admin/accounts/${orgs.alice}`);
    expect(account.body).toMatchObject({ qualification: "beta", betaStartedAt: start.toISOString(), betaEndsAt: body.beta.endsAt, betaBlocked: false });
    expect(account.body.history.map((e: { action: string }) => e.action)).toContain("billing.beta_started");
  });

  it("tirets acceptés ; les utilisations sont comptées dans Selio Admin", async () => {
    if (!available) return;
    const body = await register("bruno", "BETA-2026-SELIO");
    expect(body.promo.applied).toBe(true);
    expect(body.beta.state).toBe("running");
    const list = await json("tech", "GET", "/api/admin/offers");
    expect(list.body.find((o: { code: string }) => o.code === BETA_CODE).redemptions).toBe(2);
  });

  it("code faux : l'inscription continue en essai normal de 14 jours, avec un message clair", async () => {
    if (!available) return;
    const body = await register("chloe", "BETA2025SELIO");
    expect(body.promo).toMatchObject({ applied: false, reason: "unknown_code" });
    expect(body.promo.message).toMatch(/inconnu.*Votre inscription continue/);
    expect(body.beta).toBeNull();
    const sub = await json("chloe", "GET", "/api/billing/subscription");
    expect(sub.body).toMatchObject({ status: "trialing", plan: "pro", currentPeriodEnd: new Date(start.getTime() + 14 * DAY).toISOString() });
    expect((await json("chloe", "GET", "/api/billing/invoices")).body).toEqual([]);
  });

  it("sans code : essai normal, aucune facture, aucune bêta", async () => {
    if (!available) return;
    const body = await register("david");
    expect(body.promo).toBeUndefined();
    expect(body.beta).toBeNull();
  });

  it("deuxième utilisation refusée (une fois par compte) ; un compte existant ne l'active pas depuis l'abonnement", async () => {
    if (!available) return;
    const again = await json("alice", "POST", "/api/billing/offer", { code: "beta2026selio" });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatchObject({ code: "promo_refused", details: { reason: "beta_already_used" } });
    const existing = await json("chloe", "POST", "/api/billing/offer", { code: BETA_CODE });
    expect(existing.status).toBe(400);
    expect(existing.body.error.details.reason).toBe("beta_signup_only");
    expect((await json("tech", "GET", "/api/admin/offers")).body.find((o: { code: string }) => o.code === BETA_CODE).redemptions).toBe(2);
  });
});

describe("écran de bienvenue et rappels", () => {
  it("« Bienvenue dans la bêta » vu une fois, pour l'organisation", async () => {
    if (!available) return;
    const seen = await json("alice", "POST", "/api/beta/welcome");
    expect(seen.status).toBe(200);
    expect(seen.body.beta.welcomeSeen).toBe(true);
    expect((await json("alice", "GET", "/api/auth/session")).body.beta.welcomeSeen).toBe(true);
    expect((await json("chloe", "POST", "/api/beta/welcome")).status).toBe(404);
  });

  it("bandeau J-7 puis J-1 (aucun email : l'envoi n'est pas configuré)", async () => {
    if (!available) return;
    clock = new Date(start.getTime() + 23 * DAY + 3_600_000);
    expect((await json("alice", "GET", "/api/beta")).body.beta).toMatchObject({ reminder: 7, daysLeft: 7 });
    clock = new Date(start.getTime() + 29 * DAY + 12 * 3_600_000);
    expect((await json("alice", "GET", "/api/beta")).body.beta).toMatchObject({ reminder: 1, daysLeft: 1 });
    expect(await billing.processSubscriptionRenewal(built.services, orgs.alice!)).toMatchObject({ action: "skipped", reason: "trial_running" });
    const history = await json("tech", "GET", `/api/admin/accounts/${orgs.alice}`);
    expect(history.body.history.map((e: { action: string }) => e.action)).not.toContain("billing.beta_reminder_sent");
  });
});

describe("fin du mois de bêta sans moyen de paiement", () => {
  it("le worker bloque : 402 beta_ended sur une action métier, lectures, factures et export permis, données conservées", async () => {
    if (!available) return;
    clock = new Date(start.getTime() + 29 * DAY);
    const before = await createItem("alice");
    expect(before.status).toBeLessThan(300);
    clock = new Date(start.getTime() + 30 * DAY + 3_600_000);
    expect(await billing.processSubscriptionRenewal(built.services, orgs.alice!)).toEqual({ action: "trial_ended", reason: "beta_ended" });
    const session = await json("alice", "GET", "/api/auth/session");
    expect(session.body.beta).toMatchObject({ state: "ended", blocked: true, blockedSince: clock.toISOString(), reminder: null });
    const denied = await createItem("alice");
    expect(denied.status).toBe(402);
    expect(denied.body.error).toMatchObject({ code: "beta_ended", message: expect.stringMatching(/mois de bêta est terminé.*moyen de paiement/) });
    expect((await json("alice", "GET", "/api/items")).body.items.map((i: { id: string }) => i.id)).toContain(before.body.id);
    expect((await json("alice", "GET", "/api/billing/invoices")).status).toBe(200);
    expect((await json("alice", "GET", "/api/billing/subscription")).body).toMatchObject({ status: "canceled", plan: "free", awaitingPaymentSince: clock.toISOString() });
    expect((await built.app.inject({ method: "GET", url: "/api/data/export", headers: { cookie: cookies.alice! } })).statusCode).toBe(200);
    // Les autres comptes ne sont pas touchés.
    await relogin("chloe");
    expect((await createItem("chloe")).status).toBeLessThan(300);
  });

  it("Selio Admin voit le compte bloqué (liste filtrée et tableau de bord)", async () => {
    if (!available) return;
    const blocked = await json("tech", "GET", "/api/admin/accounts?status=beta_blocked");
    expect(blocked.body.map((a: { id: string }) => a.id)).toEqual([orgs.alice]);
    expect(blocked.body[0]).toMatchObject({ betaBlocked: true, betaEndsAt: null });
    const running = await json("tech", "GET", "/api/admin/accounts?status=beta");
    expect(running.body.map((a: { id: string }) => a.id)).toEqual([orgs.bruno]);
    const growth = await json("tech", "GET", "/api/admin/growth");
    // Le mois de Bruno vient aussi de finir (le worker ne l'a pas encore traité) : listé « bêta », plus compté « en cours ».
    expect(growth.body.beta).toEqual({ total: 2, running: 0, endingSoon: 0, blocked: 1 });
  });

  it("une prolongation par un opérateur débloque tout de suite", async () => {
    if (!available) return;
    const ext = await json("tech", "POST", `/api/admin/accounts/${orgs.alice}/extend-trial`, { days: 7 });
    expect(ext.status).toBe(200);
    expect(ext.body).toMatchObject({ status: "trialing", plan: "pro", betaBlocked: false });
    expect((await createItem("alice")).status).toBeLessThan(300);
    expect((await json("alice", "GET", "/api/beta")).body.beta).toMatchObject({ state: "running", blocked: false, daysLeft: 7, reminder: 7 });
  });

  it("page de paiement après la fin (paiement simulé) : forfait retenu sans carte, rien débité, débloqué", async () => {
    if (!available) return;
    clock = new Date(start.getTime() + 31 * DAY);
    await relogin("bruno");
    expect(await billing.processSubscriptionRenewal(built.services, orgs.bruno!)).toMatchObject({ reason: "beta_ended" });
    expect((await createItem("bruno")).status).toBe(402);
    const preview = await json("bruno", "GET", "/api/billing/checkout/preview?plan=pro&cycle=monthly");
    expect(preview.body).toMatchObject({ afterBeta: true, blockedReason: null, noCardRequired: true, paymentMode: "simulated" });
    const confirm = await json("bruno", "POST", "/api/billing/checkout", { plan: "pro", cycle: "monthly" });
    expect(confirm.status).toBe(200);
    expect(confirm.body).toMatchObject({ simulated: true, amountCents: 0, orderToken: null });
    expect((await json("bruno", "GET", "/api/beta")).body.beta).toMatchObject({ state: "converted", blocked: false });
    expect((await createItem("bruno")).status).toBeLessThan(300);
    expect((await json("bruno", "GET", "/api/billing/invoices")).body).toHaveLength(1);
  });

  it("avec un forfait retenu pendant le mois (paiement simulé), la fin ne bloque pas : en attente du paiement", async () => {
    if (!available) return;
    clock = new Date(start.getTime() + 31 * DAY);
    await register("emma", BETA_CODE);
    const chosen = await json("emma", "POST", "/api/billing/checkout", { plan: "starter", cycle: "monthly" });
    expect(chosen.body.simulated).toBe(true);
    expect((await json("emma", "GET", "/api/beta")).body.beta).toMatchObject({ paymentReady: true, reminder: null });
    clock = new Date(start.getTime() + 62 * DAY);
    await relogin("emma");
    await relogin("tech");
    expect(await billing.processSubscriptionRenewal(built.services, orgs.emma!)).toMatchObject({ action: "trial_ended", reason: "awaiting_payment" });
    expect((await json("emma", "GET", "/api/beta")).body.beta).toMatchObject({ state: "converted", blocked: false });
    expect((await createItem("emma")).status).toBeLessThan(300);
  });
});

describe("Selio Admin › Offres : l'offre bêta se règle sans code", () => {
  it("durée modifiable, remise non ; maximum atteint et désactivation refusent proprement le code (inscription maintenue)", async () => {
    if (!available) return;
    const offer = (await json("tech", "GET", "/api/admin/offers")).body.find((o: { code: string }) => o.code === BETA_CODE);
    expect((await json("tech", "PATCH", `/api/admin/offers/${offer.id}`, { discountPercent: 50 })).status).toBe(400);
    const days = await json("tech", "PATCH", `/api/admin/offers/${offer.id}`, { betaDays: 45 });
    expect(days.body).toMatchObject({ betaDays: 45, kind: "beta" });
    await json("tech", "PATCH", `/api/admin/offers/${offer.id}`, { maxRedemptions: offer.redemptions });
    const full = await register("fanny", BETA_CODE);
    expect(full.promo).toMatchObject({ applied: false, reason: "exhausted" });
    expect(full.promo.message).toMatch(/places de la bêta/);
    expect(full.beta).toBeNull();
    await json("tech", "PATCH", `/api/admin/offers/${offer.id}`, { maxRedemptions: null, active: false });
    expect((await json(null, "POST", "/api/offers/check-signup", { code: BETA_CODE })).body.valid).toBe(false);
    await json("tech", "PATCH", `/api/admin/offers/${offer.id}`, { active: true });
    const gaby = await register("gaby", BETA_CODE);
    expect(gaby.beta).toMatchObject({ daysLeft: 45 });
  });
});

describe("worker : rappels par email et fin en mode Revolut", () => {
  it("rappels J-7 puis J-1 envoyés une seule fois chacun quand l'envoi d'emails est configuré", async () => {
    if (!available) return;
    clock = new Date(start.getTime() + 70 * DAY);
    await register("ines", BETA_CODE);
    const sent: { to: string; subject: string }[] = [];
    const withEmail = { ...built.services, email: { delivers: true, send: async (m: { to: string; subject: string }) => { sent.push({ to: m.to, subject: m.subject }); return { id: `e${sent.length}` }; } } };
    clock = new Date(start.getTime() + 70 * DAY + 10 * DAY);
    expect(await billing.processSubscriptionRenewal(withEmail, orgs.ines!)).toMatchObject({ reason: "trial_running" });
    expect(sent).toEqual([]);
    clock = new Date(start.getTime() + 70 * DAY + 38 * DAY + 3_600_000);
    await billing.processSubscriptionRenewal(withEmail, orgs.ines!);
    await billing.processSubscriptionRenewal(withEmail, orgs.ines!);
    expect(sent).toEqual([{ to: "ines@beta.test", subject: expect.stringMatching(/se termine dans 7 jours/) }]);
    clock = new Date(start.getTime() + 70 * DAY + 44 * DAY + 12 * 3_600_000);
    await billing.processSubscriptionRenewal(withEmail, orgs.ines!);
    await billing.processSubscriptionRenewal(withEmail, orgs.ines!);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toMatch(/se termine demain/);
    // Chaque rappel est noté dans l'historique du compte (Selio Admin).
    await relogin("tech");
    expect((await json("tech", "GET", `/api/admin/accounts/${orgs.ines}`)).body.history.filter((e: { action: string }) => e.action === "billing.beta_reminder_sent")).toHaveLength(2);
  });

  it("Revolut configuré mais aucune carte à la fin du mois : accès bêta terminé aussi", async () => {
    if (!available) return;
    const revolut = { ...built.services, billing: { franchiseTva: false, paymentMode: "revolut" as const } };
    clock = new Date(start.getTime() + 70 * DAY + 45 * DAY + 3_600_000);
    expect(await billing.processSubscriptionRenewal(revolut, orgs.ines!)).toEqual({ action: "trial_ended", reason: "beta_ended" });
    await relogin("ines");
    expect((await json("ines", "GET", "/api/beta")).body.beta).toMatchObject({ state: "ended", blocked: true });
    expect((await createItem("ines")).status).toBe(402);
    // Un accès offert par l'équipe Selio débloque aussi.
    await relogin("tech");
    const grant = await json("tech", "POST", `/api/admin/accounts/${orgs.ines}/grant`, { plan: "pro", until: new Date(clock.getTime() + 14 * DAY).toISOString() });
    expect(grant.status).toBe(200);
    expect((await createItem("ines")).status).toBeLessThan(300);
    expect((await json("ines", "GET", "/api/beta")).body.beta).toMatchObject({ state: "running", blocked: false, paymentReady: true, daysLeft: 14 });
  });
});
