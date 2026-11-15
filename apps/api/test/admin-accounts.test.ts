import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, repos, type PgPool } from "@selio/db";
import { ACCOUNT_BLOCKED_MESSAGE, GRANT_NO_END } from "@selio/contracts";
import { billing } from "@selio/core";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Selio Admin : rôles d'opérateur tirés de la configuration (« tech », « business »), matrice des droits (403),
 * qualification des comptes, accès offert (jamais débité, retour à l'accès de base à l'échéance), prolongation
 * d'essai, blocage et historique. Base dédiée selio_test_api_admin (créée si besoin). Aucun paiement configuré.
 * Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_ADMIN_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_admin";
const APP_URL = process.env.TEST_API_ADMIN_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_admin";
const ENCRYPTION_KEY = SecretBox.generateKey();

const TECH = "ibrahim@admin.test";
const BUSINESS = "elias@admin.test";

let available = true;
let owner: PgPool;
let built: BuiltServer;
/** Horloge des services, avancée par les tests de l'échéance d'un accès offert. */
let clock = new Date("2026-11-15T10:00:00.000Z");
const cookies: Record<string, string> = {};
const orgs = { tech: "", business: "", client: "", trial: "" };

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

function envWith(business: string) {
  return loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_ENV: "test", LOG_LEVEL: "error", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", OPERATOR_EMAILS: TECH, OPERATOR_BUSINESS_EMAILS: business, PUBLIC_WEB_URL: "https://app.selio.test" });
}

const call = (who: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  built.app.inject({ method, url, headers: { cookie: cookies[who] ?? "" }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

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
  // Premier démarrage : Elias n'est pas encore dans OPERATOR_BUSINESS_EMAILS quand il s'inscrit.
  built = await buildServer(envWith(""), { now: () => clock }, { priceModelRefreshMs: 0 });
  await built.app.ready();
  for (const [who, email] of [["tech", TECH], ["business", BUSINESS], ["client", "client@admin.test"], ["trial", "essai@admin.test"]] as const) {
    const r = await built.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "motdepasse-A1", displayName: who, orgName: `Boutique ${who}` } });
    expect(r.statusCode).toBe(201);
    cookies[who] = cookieOf(r);
    orgs[who] = JSON.parse(r.body).org.id;
  }
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
});

describe("Selio Admin : rôles d'opérateur tirés de la configuration", () => {
  it("rôle recalculé à chaque requête : un compte déjà créé devient opérateur « business » sans réinscription", async () => {
    if (!available) return;
    const before = JSON.parse((await call("business", "GET", "/api/auth/session")).body);
    expect(before.user).toMatchObject({ email: BUSINESS, isOperator: false, operatorRole: null });
    const tech = JSON.parse((await call("tech", "GET", "/api/auth/session")).body);
    expect(tech.user).toMatchObject({ isOperator: true, operatorRole: "tech" });
    // Nouvelle configuration (OPERATOR_BUSINESS_EMAILS) puis relance de l'API, même base, même session.
    await built.app.close();
    built = await buildServer(envWith(BUSINESS), { now: () => clock }, { priceModelRefreshMs: 0 });
    await built.app.ready();
    const after = JSON.parse((await call("business", "GET", "/api/auth/session")).body);
    expect(after.user).toMatchObject({ email: BUSINESS, isOperator: true, operatorRole: "business" });
    // Le drapeau en base n'est pas modifié : la configuration est la source de vérité.
    const flag = await owner.query("select is_operator from users where email = $1", [BUSINESS]);
    expect(flag.rows[0].is_operator).toBe(false);
  });

  it("403 pour un non-opérateur sur toutes les routes de Selio Admin", async () => {
    if (!available) return;
    for (const url of ["/api/admin/growth", "/api/admin/accounts", `/api/admin/accounts/${orgs.client}`, "/api/admin/usage", "/api/admin/overview"]) {
      const r = await call("client", "GET", url);
      expect(r.statusCode, url).toBe(403);
      expect(JSON.parse(r.body).error.code).toBe("forbidden");
    }
    const q = await call("client", "POST", `/api/admin/accounts/${orgs.client}/qualification`, { qualification: "equipe" });
    expect(q.statusCode).toBe(403);
  });

  it("403 pour « business » sur une route technique ; accès aux comptes, à la croissance et à l'usage", async () => {
    if (!available) return;
    for (const url of ["/api/admin/overview", "/api/health/details", "/api/admin/pricing", "/api/admin/audit", "/api/admin/size-references", "/api/admin/radar"]) {
      const r = await call("business", "GET", url);
      expect(r.statusCode, url).toBe(403);
      expect(JSON.parse(r.body).error.message).toContain("opérateur technique");
    }
    expect((await call("business", "POST", `/api/admin/orgs/${orgs.client}/plan`, { plan: "agence" })).statusCode).toBe(403);
    for (const url of ["/api/admin/growth", "/api/admin/accounts", `/api/admin/accounts/${orgs.client}`, "/api/admin/usage"]) {
      expect((await call("business", "GET", url)).statusCode, url).toBe(200);
    }
    expect((await call("tech", "GET", "/api/admin/overview")).statusCode).toBe(200);
  });
});

describe("Selio Admin : comptes", () => {
  it("croissance : chiffres réels de la base (4 comptes en essai, aucun payant, revenu mensuel nul)", async () => {
    if (!available) return;
    const g = JSON.parse((await call("tech", "GET", "/api/admin/growth")).body);
    expect(g.accounts).toMatchObject({ total: 4, trialing: 4, paying: 0, granted: 0, blocked: 0 });
    expect(g.byQualification.client).toBe(4);
    expect(g.signups.last7Days).toBe(4);
    expect(g.mrrCents).toBe(0);
    expect(g.referrals).toEqual({ pending: 0, qualified: 0, credited: 0, refused: 0 });
  });

  it("liste cherchable et filtrable, fiche avec membres (email, rôle, rôle d'opérateur)", async () => {
    if (!available) return;
    const all = JSON.parse((await call("business", "GET", "/api/admin/accounts")).body);
    expect(all).toHaveLength(4);
    const found = JSON.parse((await call("business", "GET", "/api/admin/accounts?q=ESSAI@admin")).body);
    expect(found.map((a: { id: string }) => a.id)).toEqual([orgs.trial]);
    expect(JSON.parse((await call("business", "GET", "/api/admin/accounts?status=trialing&plan=pro")).body)).toHaveLength(4);
    expect((await call("business", "GET", "/api/admin/accounts?qualification=inconnue")).statusCode).toBe(400);
    const detail = JSON.parse((await call("business", "GET", `/api/admin/accounts/${orgs.tech}`)).body);
    expect(detail.team).toEqual([expect.objectContaining({ email: TECH, role: "owner", operatorRole: "tech" })]);
    expect(detail).toMatchObject({ qualification: "client", plan: "pro", status: "trialing", ownerEmail: TECH });
    expect((await call("business", "GET", "/api/admin/accounts/inconnu")).statusCode).toBe(404);
  });

  it("qualification et note interne : journalisées (avant/après), absentes du journal et de la session du client", async () => {
    if (!available) return;
    const r = await call("business", "POST", `/api/admin/accounts/${orgs.client}/qualification`, { qualification: "beta", note: "Rencontrée au salon, retours précieux." });
    expect(r.statusCode).toBe(200);
    const d = JSON.parse(r.body);
    expect(d).toMatchObject({ qualification: "beta", qualificationNote: "Rencontrée au salon, retours précieux.", qualifiedByEmail: BUSINESS });
    expect(d.history[0]).toMatchObject({ action: "admin.account_qualified", actorEmail: BUSINESS, meta: { before: { qualification: "client" }, after: { qualification: "beta" } } });
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/note`, { note: "x".repeat(501) })).statusCode).toBe(400);
    const n = JSON.parse((await call("business", "POST", `/api/admin/accounts/${orgs.client}/note`, { note: "Relancer en décembre." })).body);
    expect(n.qualificationNote).toBe("Relancer en décembre.");
    expect(n.history[0]).toMatchObject({ action: "admin.account_note_updated", meta: { before: { note: "Rencontrée au salon, retours précieux." }, after: { note: "Relancer en décembre." } } });
    const audit = (await call("client", "GET", "/api/audit")).body;
    expect(audit).not.toContain("admin.account_");
    expect((await call("client", "GET", "/api/auth/session")).body).not.toContain("Relancer");
  });

  it("accès offert : plan actif sans fournisseur de paiement ; sans fin réservé à l'équipe ; jamais un paiement par carte", async () => {
    if (!available) return;
    const until = new Date(clock.getTime() + 30 * 86_400_000).toISOString();
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/grant`, { plan: "agence", until: null })).statusCode).toBe(400);
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/grant`, { plan: "free", until })).statusCode).toBe(400);
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/grant`, { plan: "pro", until: "2026-01-01T00:00:00.000Z" })).statusCode).toBe(400);
    const g = JSON.parse((await call("business", "POST", `/api/admin/accounts/${orgs.client}/grant`, { plan: "pro", until })).body);
    expect(g).toMatchObject({ plan: "pro", status: "active", provider: "none", grantedUntil: until, grantedByEmail: BUSINESS });
    expect(g.history[0]).toMatchObject({ action: "admin.access_granted", meta: { before: { status: "trialing" }, after: { plan: "pro", grantedUntil: until } } });
    const sub = JSON.parse((await call("client", "GET", "/api/billing/subscription")).body);
    expect(sub).toMatchObject({ plan: "pro", status: "active", provider: "none", grantedUntil: until });
    // Équipe Selio : Ibrahim qualifie son propre compte, puis Agence offert sans fin (plus d'essai).
    expect((await call("tech", "POST", `/api/admin/accounts/${orgs.tech}/qualification`, { qualification: "equipe" })).statusCode).toBe(200);
    const team = JSON.parse((await call("tech", "POST", `/api/admin/accounts/${orgs.tech}/grant`, { plan: "agence", until: null })).body);
    expect(team).toMatchObject({ qualification: "equipe", plan: "agence", status: "active", grantedUntil: GRANT_NO_END });
    // Un accès offert ne se prolonge pas comme un essai.
    expect((await call("tech", "POST", `/api/admin/accounts/${orgs.tech}/extend-trial`, { days: 10 })).statusCode).toBe(409);
    const growth = JSON.parse((await call("business", "GET", "/api/admin/growth")).body);
    expect(growth.accounts).toMatchObject({ granted: 2, trialing: 2, paying: 0 });
    expect(growth.mrrCents).toBe(0);
    // Paiement par carte en cours : refus (l'accès offert le ferait perdre à l'échéance).
    await owner.query("update subscriptions set provider = 'revolut', status = 'active', granted_until = null, plan = 'starter' where org_id = $1", [orgs.trial]);
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.trial}/grant`, { plan: "pro", until })).statusCode).toBe(409);
    expect(JSON.parse((await call("business", "GET", "/api/admin/growth")).body)).toMatchObject({ mrrCents: 699, payingByPlan: { starter: 1 } });
    await owner.query("update subscriptions set provider = 'none', status = 'trialing', plan = 'pro' where org_id = $1", [orgs.trial]);
  });

  it("accès offert jamais débité ni rétrogradé avant sa fin ; à l'échéance, accès de base avec une ligne d'audit", async () => {
    if (!available) return;
    const running = await billing.processSubscriptionRenewal(built.services, orgs.client);
    expect(running).toEqual({ action: "skipped", reason: "granted_running" });
    // Sans fin (équipe) : jamais, même dans dix ans.
    const saved = clock;
    clock = new Date("2036-11-15T10:00:00.000Z");
    expect(await billing.processSubscriptionRenewal(built.services, orgs.tech)).toEqual({ action: "skipped", reason: "granted_running" });
    clock = new Date(saved.getTime() + 31 * 86_400_000);
    const ended = await billing.processSubscriptionRenewal(built.services, orgs.client);
    expect(ended).toEqual({ action: "ended", reason: "granted_ended" });
    const sub = await built.services.db.withOrg(orgs.client, (tx) => repos.subscriptions.get(tx));
    expect(sub).toMatchObject({ plan: "free", status: "canceled", grantedUntil: null });
    const orders = await owner.query("select count(*)::int as n from payment_orders where org_id = $1", [orgs.client]);
    expect(orders.rows[0].n).toBe(0);
    const audit = await owner.query("select action, meta from audit_logs where org_id = $1 and action = 'billing.grant_ended'", [orgs.client]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].meta).toMatchObject({ previousPlan: "pro" });
    // Second passage : plus rien à faire (pas d'abonnement payant).
    expect((await billing.processSubscriptionRenewal(built.services, orgs.client)).action).toBe("skipped");
    clock = saved;
  });

  it("retrait d'un accès offert : accès de base tout de suite, journalisé", async () => {
    if (!available) return;
    const until = new Date(clock.getTime() + 10 * 86_400_000).toISOString();
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/grant`, { plan: "starter", until })).statusCode).toBe(200);
    const r = JSON.parse((await call("business", "DELETE", `/api/admin/accounts/${orgs.client}/grant`)).body);
    expect(r).toMatchObject({ plan: "free", status: "canceled", grantedUntil: null });
    expect(r.history[0].action).toBe("admin.access_revoked");
    expect((await call("business", "DELETE", `/api/admin/accounts/${orgs.client}/grant`)).statusCode).toBe(409);
  });

  it("prolonger l'essai de 1 à 90 jours : à partir de sa fin, ou nouvel essai après la fin", async () => {
    if (!available) return;
    const before = JSON.parse((await call("tech", "GET", `/api/admin/accounts/${orgs.trial}`)).body);
    for (const days of [0, 91, 2.5]) expect((await call("business", "POST", `/api/admin/accounts/${orgs.trial}/extend-trial`, { days })).statusCode, String(days)).toBe(400);
    const r = JSON.parse((await call("business", "POST", `/api/admin/accounts/${orgs.trial}/extend-trial`, { days: 10 })).body);
    expect(new Date(r.currentPeriodEnd).getTime() - new Date(before.currentPeriodEnd).getTime()).toBe(10 * 86_400_000);
    expect(r.history[0]).toMatchObject({ action: "admin.trial_extended", meta: { days: 10, restarted: false } });
    // Essai terminé (accès de base) : nouvel essai Pro à partir d'aujourd'hui.
    const restarted = JSON.parse((await call("business", "POST", `/api/admin/accounts/${orgs.client}/extend-trial`, { days: 7 })).body);
    expect(restarted).toMatchObject({ status: "trialing", plan: "pro", currentPeriodEnd: new Date(clock.getTime() + 7 * 86_400_000).toISOString() });
  });

  it("compte bloqué : session et connexion refusées avec un message clair, sauf pour un opérateur ; débloqué ensuite", async () => {
    if (!available) return;
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/qualification`, { qualification: "bloque" })).statusCode).toBe(200);
    const s = await call("client", "GET", "/api/auth/session");
    expect(s.statusCode).toBe(403);
    expect(JSON.parse(s.body).error).toMatchObject({ code: "account_blocked", message: ACCOUNT_BLOCKED_MESSAGE });
    const login = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "client@admin.test", password: "motdepasse-A1" } });
    expect(login.statusCode).toBe(403);
    expect((await call("client", "POST", "/api/auth/logout")).statusCode).toBe(204);
    // Un opérateur dont le compte est bloqué garde l'accès (il ne peut pas s'enfermer dehors).
    expect((await call("tech", "POST", `/api/admin/accounts/${orgs.tech}/qualification`, { qualification: "bloque" })).statusCode).toBe(200);
    expect((await call("tech", "GET", "/api/auth/session")).statusCode).toBe(200);
    await call("tech", "POST", `/api/admin/accounts/${orgs.tech}/qualification`, { qualification: "equipe" });
    expect(JSON.parse((await call("business", "GET", "/api/admin/growth")).body).accounts.blocked).toBe(1);
    expect((await call("business", "POST", `/api/admin/accounts/${orgs.client}/qualification`, { qualification: "client" })).statusCode).toBe(200);
    const again = await built.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "client@admin.test", password: "motdepasse-A1" } });
    expect(again.statusCode).toBe(200);
  });

  it("historique de la fiche : toutes les actions de l'opérateur, dans l'ordre", async () => {
    if (!available) return;
    const d = JSON.parse((await call("tech", "GET", `/api/admin/accounts/${orgs.client}`)).body);
    const actions = d.history.map((h: { action: string }) => h.action);
    for (const a of ["admin.account_qualified", "admin.account_note_updated", "admin.access_granted", "admin.access_revoked", "admin.trial_extended", "billing.grant_ended"]) expect(actions, a).toContain(a);
    expect(d.history.every((h: { createdAt: string }, i: number, arr: { createdAt: string }[]) => i === 0 || arr[i - 1]!.createdAt >= h.createdAt)).toBe(true);
  });
});
