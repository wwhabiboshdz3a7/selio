import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { REFERRAL_CODE_RE, REFERRAL_MAX_CREDITS_PER_REFERRER, canonicalEmail, normalizeReferralCode, quotasForPlan, type Plan } from "@selio/contracts";
import type { PaymentProvider } from "@selio/connectors";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { OrgContext, Services } from "../context";
import * as billing from "./billing";
import * as referral from "./referral";

/**
 * Parrainage « un mois offert aux deux » de bout en bout sur PostgreSQL (base dédiée selio_test_core_referral,
 * créée si besoin : Vitest 3 en espace de travail peut lancer les fichiers en parallèle). Paiement factice,
 * horloge injectée : aucun débit réel, aucun service payant. Les tests sur la base sont ignorés si elle n'est
 * pas joignable ; les fonctions pures tournent toujours.
 */
const OWNER_URL = process.env.TEST_CORE_REFERRAL_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_referral";
const APP_URL = process.env.TEST_CORE_REFERRAL_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_referral";
const T0 = new Date("2026-11-08T10:00:00.000Z");

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
let seq = 0;
let orders: { amountCents: number; orgId: string; description: string }[] = [];

const payments = {
  name: "revolut", testMode: true,
  createOrder: async (input: { amountCents: number; orgId: string; description: string }) => {
    orders.push(input);
    return { orderId: `ord_ref_${orders.length}_${seq}`, token: null, state: "pending", amountCents: input.amountCents, currency: "EUR", customerId: null, merchantOrderRef: null, paymentAttempts: 0, paymentMethodId: null };
  },
  chargeSavedMethod: async () => ({ state: "completed" }),
  cancelOrder: async () => ({ state: "cancelled" }),
  getOrder: async (orderId: string) => ({ orderId, state: "completed", paymentAttempts: 1 }),
  listMerchantPaymentMethods: async () => [],
} as unknown as PaymentProvider;

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

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 2 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  services = {
    db: new Db(createPool(APP_URL, { max: 4 })),
    ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }),
    secrets: new SecretBox(SecretBox.generateKey()),
    now: () => new Date(clock),
    allowAiFallback: false,
    version: "test",
    publicWebUrl: "https://selio.example",
    payments,
    config: { referralEnabled: true },
  };
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

beforeEach(() => {
  clock = new Date(T0);
  orders = [];
  if (services) services.config = { referralEnabled: true };
});

interface OrgSetup { ctx: OrgContext; userId: string }

/** Organisation avec son titulaire et un abonnement (actif par défaut, Revolut, carte enregistrée). */
async function setupOrg(sub: Record<string, unknown> = {}, opts: { plan?: Plan; userId?: string } = {}): Promise<OrgSetup> {
  const n = ++seq;
  const plan = opts.plan ?? "pro";
  const ids = await services.db.withGlobal(async (tx) => {
    const userId = opts.userId ?? (await repos.users.create(tx, { email: `ref${n}@test.local`, displayName: `Titulaire ${n}`, passwordHash: "x", passwordSalt: "y" })).id;
    const o = await repos.orgs.create(tx, { name: `Org Parrainage ${n}`, slug: `org-ref-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId, role: "owner" });
    return { userId, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", provider: "revolut", quotas: quotasForPlan(plan), cardOnFile: true, paymentMethodId: `pm_${n}`, revolutCustomerId: `cus_${n}`, currentPeriodEnd: "2026-11-20T10:00:00.000Z", cycle: "monthly", ...sub }));
  return { ctx: { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.9" }, userId: ids.userId };
}

const subOf = (orgId: string) => services.db.withOrg(orgId, (tx) => repos.subscriptions.get(tx));
const invoicesOf = (orgId: string) => services.db.withOrg(orgId, (tx) => repos.invoices.list(tx));
const creditsOf = (orgId: string) => services.db.withOrg(orgId, (tx) => repos.subscriptionCredits.list(tx, orgId));
const linkOf = (orgId: string) => services.db.withGlobal((tx) => repos.referrals.byReferred(tx, orgId));
const auditOf = async (orgId: string) => (await services.db.withOrg(orgId, (tx) => repos.audit.list(tx, 200))).map((a) => a.action);

// ---------------------------------------------------------------- fonctions pures

describe("parrainage : code et réglage (fonctions pures)", () => {
  it("code de 6 caractères lisibles, saisie tolérante, réglage désactivé par défaut", () => {
    for (let i = 0; i < 200; i++) expect(referral.generateReferralCode()).toMatch(REFERRAL_CODE_RE);
    expect(normalizeReferralCode(" ab3-k7q ")).toBe("AB3K7Q");
    expect(normalizeReferralCode("AB3 K7Q")).toBe("AB3K7Q");
    expect(normalizeReferralCode("AB0OIL")).toBeNull();
    expect(normalizeReferralCode("ABC")).toBeNull();
    expect(normalizeReferralCode(42)).toBeNull();
    expect(referral.referralConfigFromEnv({})).toEqual({ referralEnabled: false });
    expect(referral.referralConfigFromEnv({ REFERRAL_ENABLED: "true" })).toEqual({ referralEnabled: true });
    expect(referral.referralConfigFromEnv({ REFERRAL_ENABLED: "1" })).toEqual({ referralEnabled: false });
    expect(referral.referralEnabled({ config: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------- base de données

describe("parrainage sur PostgreSQL", () => {
  it("désactivé (REFERRAL_ENABLED absent) : ni code, ni page, ni lien, ni crédit", async () => {
    if (!available) return;
    services.config = {};
    const a = await setupOrg();
    const b = await setupOrg({ status: "trialing", provider: "none" });
    expect(await referral.getOverview(a.ctx)).toMatchObject({ enabled: false, code: null, shareUrl: null });
    await expect(referral.getOrCreateCode(a.ctx)).rejects.toMatchObject({ code: "referral_disabled", status: 404 });
    expect(await services.db.withGlobal((tx) => repos.referralCodes.byOrg(tx, a.ctx.orgId))).toBeNull();
    const out = await referral.applyCodeAtSignup(services, b.ctx.orgId, "AB3K7Q");
    expect(out).toMatchObject({ applied: false, reason: "disabled" });
    expect(out.message).toContain("pas été pris en compte");
    expect(await linkOf(b.ctx.orgId)).toBeNull();
    expect(await referral.qualify(services, b.ctx.orgId)).toEqual({ qualified: false, reason: "disabled" });
  });

  it("code : créé une fois, stable, réservé au titulaire et à l'administrateur", async () => {
    if (!available) return;
    const a = await setupOrg();
    const code = await referral.getOrCreateCode(a.ctx);
    expect(code).toMatch(REFERRAL_CODE_RE);
    expect(await referral.getOrCreateCode(a.ctx)).toBe(code);
    expect(await referral.getOrCreateCode({ ...a.ctx, role: "admin" })).toBe(code);
    for (const role of ["operator", "photographer", "viewer"] as const) await expect(referral.getOrCreateCode({ ...a.ctx, role })).rejects.toMatchObject({ status: 403 });
    const overview = await referral.getOverview(a.ctx);
    expect(overview).toEqual({ enabled: true, code, shareUrl: `https://selio.example/inscription?parrain=${code}`, referred: { pending: 0, qualified: 0, credited: 0, refused: 0 }, creditsAvailable: 0, creditsConsumed: 0, referredBy: null });
    expect(await auditOf(a.ctx.orgId)).toContain("referral.code_created");
  });

  it("inscription : code vide, mal formé ou inconnu ignoré avec un message ; auto-parrainage refusé ; une seule marraine", async () => {
    if (!available) return;
    const a = await setupOrg();
    const code = await referral.getOrCreateCode(a.ctx);
    const b = await setupOrg({ status: "trialing" });
    expect(await referral.applyCodeAtSignup(services, b.ctx.orgId, "")).toMatchObject({ applied: false, reason: "empty" });
    expect(await referral.applyCodeAtSignup(services, b.ctx.orgId, undefined)).toMatchObject({ applied: false, reason: "empty" });
    expect(await referral.applyCodeAtSignup(services, b.ctx.orgId, "pas-un-code")).toMatchObject({ applied: false, reason: "invalid_code" });
    const unknown = await referral.applyCodeAtSignup(services, b.ctx.orgId, code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ");
    expect(unknown).toMatchObject({ applied: false, reason: "unknown_code" });
    expect(unknown.message).toContain("inconnu");
    // Son propre code (même organisation), ou celui d'une organisation dont on est déjà membre.
    expect(await referral.applyCodeAtSignup(services, a.ctx.orgId, code)).toMatchObject({ applied: false, reason: "self_referral" });
    const second = await setupOrg({ status: "trialing" }, { userId: a.userId });
    expect(await referral.applyCodeAtSignup(services, second.ctx.orgId, code)).toMatchObject({ applied: false, reason: "self_referral" });
    expect(await linkOf(second.ctx.orgId)).toBeNull();
    expect(await auditOf(second.ctx.orgId)).toContain("referral.self_referral_refused");
    // Saisie tolérante (minuscules, tiret) : lien en attente, une seule fois.
    const lower = `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase();
    const ok = await referral.applyCodeAtSignup(services, b.ctx.orgId, lower);
    expect(ok).toMatchObject({ applied: true, referral: { status: "pending", referrerOrgId: a.ctx.orgId, referredOrgId: b.ctx.orgId, code } });
    expect(await referral.applyCodeAtSignup(services, b.ctx.orgId, code)).toMatchObject({ applied: false, reason: "already_referred" });
    expect((await referral.getOverview(a.ctx)).referred).toEqual({ pending: 1, qualified: 0, credited: 0, refused: 0 });
    expect((await referral.getOverview(b.ctx)).referredBy).toEqual({ status: "pending" });
    expect(await auditOf(a.ctx.orgId)).toContain("referral.signup");
    expect(await auditOf(b.ctx.orgId)).toContain("referral.linked");
  });

  it("pending → qualified au premier paiement de la filleule → deux crédits → renouvellements sans débit → credited", async () => {
    if (!available) return;
    // Marraine : abonnée, échéance le 20 novembre. Filleule : essai jusqu'au 10 novembre, carte enregistrée.
    const a = await setupOrg({ currentPeriodEnd: "2026-11-20T10:00:00.000Z" });
    const code = await referral.getOrCreateCode(a.ctx);
    const b = await setupOrg({ status: "trialing", plan: "pro", pendingPlan: "pro", currentPeriodEnd: "2026-11-10T10:00:00.000Z" });
    expect((await referral.applyCodeAtSignup(services, b.ctx.orgId, code)).applied).toBe(true);

    // Essai en cours (carte autorisée, rien d'encaissé) : le lien reste en attente.
    expect((await billing.processSubscriptionRenewal(services, b.ctx.orgId)).action).toBe("skipped");
    expect((await linkOf(b.ctx.orgId))?.status).toBe("pending");

    // Fin de l'essai : premier débit réel de la filleule → qualifié, un mois offert à chacune.
    clock = new Date("2026-11-10T11:00:00.000Z");
    const first = await billing.processSubscriptionRenewal(services, b.ctx.orgId);
    expect(first.action).toBe("renewed");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.amountCents).toBe(billing.planPriceCents("pro", "monthly"));
    const link = await linkOf(b.ctx.orgId);
    expect(link).toMatchObject({ status: "qualified", qualifiedAt: "2026-11-10T11:00:00.000Z" });
    expect(await creditsOf(a.ctx.orgId)).toMatchObject([{ kind: "referral", months: 1, sourceReferralId: link!.id, consumedAt: null }]);
    expect(await creditsOf(b.ctx.orgId)).toMatchObject([{ kind: "referral", months: 1, sourceReferralId: link!.id, consumedAt: null }]);
    expect(await auditOf(a.ctx.orgId)).toContain("referral.credit_granted");

    // Idempotence : nouvelle qualification sans effet, aucun crédit de plus.
    expect(await referral.qualify(services, b.ctx.orgId)).toMatchObject({ qualified: false, reason: "already_qualified" });
    expect(await creditsOf(a.ctx.orgId)).toHaveLength(1);
    expect(await creditsOf(b.ctx.orgId)).toHaveLength(1);
    expect((await referral.getOverview(a.ctx))).toMatchObject({ referred: { pending: 0, qualified: 1, credited: 0, refused: 0 }, creditsAvailable: 1, creditsConsumed: 0 });

    // Échéance de la marraine : le mois offert remplace le débit (aucune commande), facture à 0 €.
    clock = new Date("2026-11-20T11:00:00.000Z");
    const renewedA = await billing.processSubscriptionRenewal(services, a.ctx.orgId);
    expect(renewedA).toMatchObject({ action: "renewed", reason: "referral_credit" });
    expect(orders).toHaveLength(1);
    const subA = await subOf(a.ctx.orgId);
    expect(subA).toMatchObject({ status: "active", currentPeriodEnd: "2026-12-20T10:00:00.000Z", chargeAttempts: 0 });
    const [invA] = await invoicesOf(a.ctx.orgId);
    expect(invA).toMatchObject({ amountCents: 0, number: renewedA.invoiceNumber, periodStart: "2026-11-20T10:00:00.000Z", periodEnd: "2026-12-20T10:00:00.000Z", orderId: null });
    expect(invA!.extraLines).toEqual([{ kind: "credit", product: "referral_month", label: "Mois offert — parrainage", quantity: 1, unitCents: 0, amountCents: 0 }]);
    const view = await billing.getInvoice(a.ctx, invA!.id);
    expect(view.lines.map((l) => [l.kind, l.label, l.amountCents])).toEqual([
      ["plan", "Abonnement Selio Pro — mensuel", 0],
      ["credit", "Mois offert — parrainage", 0],
    ]);
    expect(view.totals).toMatchObject({ inclVatCents: 0, vatCents: 0 });
    expect(view.paymentProvider).toBeNull();
    expect((await creditsOf(a.ctx.orgId))[0]).toMatchObject({ invoiceId: invA!.id, consumedAt: "2026-11-20T11:00:00.000Z" });
    expect(await auditOf(a.ctx.orgId)).toContain("billing.referral_credit_applied");
    // Un seul crédit consommé sur deux : le parrainage reste « qualified ».
    expect((await linkOf(b.ctx.orgId))?.status).toBe("qualified");

    // Rejoué au même moment (worker et relance concurrents) : rien n'est dû, aucune seconde facture.
    expect((await billing.processSubscriptionRenewal(services, a.ctx.orgId)).action).toBe("skipped");
    expect(await invoicesOf(a.ctx.orgId)).toHaveLength(1);

    // Échéance suivante de la filleule : son mois offert, puis « credited ».
    clock = new Date("2026-12-10T12:00:00.000Z");
    expect(await billing.processSubscriptionRenewal(services, b.ctx.orgId)).toMatchObject({ action: "renewed", reason: "referral_credit" });
    expect(orders).toHaveLength(1);
    // Premier débit : du 10 novembre (fin de l'essai) au 10 décembre ; mois offert : jusqu'au 10 janvier.
    expect((await subOf(b.ctx.orgId))?.currentPeriodEnd).toBe("2027-01-10T10:00:00.000Z");
    expect(await linkOf(b.ctx.orgId)).toMatchObject({ status: "credited", creditedAt: "2026-12-10T12:00:00.000Z" });
    expect((await referral.getOverview(a.ctx)).referred).toEqual({ pending: 0, qualified: 0, credited: 1, refused: 0 });

    // Plus aucun crédit : l'échéance de la marraine est de nouveau débitée, sans nouvelle qualification.
    clock = new Date("2026-12-20T11:00:00.000Z");
    expect(await billing.processSubscriptionRenewal(services, a.ctx.orgId)).toMatchObject({ action: "renewed" });
    expect(orders).toHaveLength(2);
    expect(orders[1]!.orgId).toBe(a.ctx.orgId);
    expect((await invoicesOf(a.ctx.orgId))[0]!.amountCents).toBe(billing.planPriceCents("pro", "monthly"));
    expect(await creditsOf(a.ctx.orgId)).toHaveLength(1);
  });

  it("paiement encaissé rejoué : une seule facture, une seule qualification", async () => {
    if (!available) return;
    const a = await setupOrg();
    const code = await referral.getOrCreateCode(a.ctx);
    const b = await setupOrg({ currentPeriodEnd: "2026-11-08T09:00:00.000Z" });
    await referral.applyCodeAtSignup(services, b.ctx.orgId, code);
    expect((await billing.processSubscriptionRenewal(services, b.ctx.orgId)).action).toBe("renewed");
    const po = await services.db.withOrg(b.ctx.orgId, (tx) => repos.paymentOrders.latest(tx, "renewal"));
    // ORDER_COMPLETED livré une seconde fois (commande déjà close) : rien.
    const again = await billing.completePaidOrder(services, b.ctx.orgId, { ...po!, state: "authorised" });
    expect(again.invoice).toBeNull();
    expect(await invoicesOf(b.ctx.orgId)).toHaveLength(1);
    expect(await creditsOf(a.ctx.orgId)).toHaveLength(1);
    expect(await creditsOf(b.ctx.orgId)).toHaveLength(1);
  });

  it("parrainage désactivé entre-temps : pas de qualification, mais un mois déjà accordé est bien consommé", async () => {
    if (!available) return;
    const a = await setupOrg({ currentPeriodEnd: "2026-11-09T10:00:00.000Z" });
    const code = await referral.getOrCreateCode(a.ctx);
    const b = await setupOrg({ currentPeriodEnd: "2026-11-08T09:00:00.000Z" });
    const c = await setupOrg({ currentPeriodEnd: "2026-11-08T09:00:00.000Z" });
    await referral.applyCodeAtSignup(services, b.ctx.orgId, code);
    await referral.applyCodeAtSignup(services, c.ctx.orgId, code);
    // b paie pendant que le parrainage est ouvert : crédits accordés.
    await billing.processSubscriptionRenewal(services, b.ctx.orgId);
    expect((await linkOf(b.ctx.orgId))?.status).toBe("qualified");
    // Fermé ensuite : c paie, son lien reste en attente, aucun crédit.
    services.config = {};
    await billing.processSubscriptionRenewal(services, c.ctx.orgId);
    expect((await linkOf(c.ctx.orgId))?.status).toBe("pending");
    expect(await creditsOf(c.ctx.orgId)).toHaveLength(0);
    // La marraine garde son mois offert, consommé à son échéance sans débit.
    clock = new Date("2026-11-09T11:00:00.000Z");
    const before = orders.length;
    expect(await billing.processSubscriptionRenewal(services, a.ctx.orgId)).toMatchObject({ action: "renewed", reason: "referral_credit" });
    expect(orders).toHaveLength(before);
    expect(await creditsOf(a.ctx.orgId)).toMatchObject([{ consumedAt: "2026-11-09T11:00:00.000Z" }]);
  });

  it("relance après un débit échoué : le mois offert couvre l'échéance et remet l'abonnement à jour", async () => {
    if (!available) return;
    const a = await setupOrg({ status: "past_due", currentPeriodEnd: "2026-11-05T10:00:00.000Z", chargeAttempts: 1, nextChargeAt: "2026-11-06T10:00:00.000Z", lastChargeError: "Paiement refusé" });
    await services.db.withOrg(a.ctx.orgId, (tx) => repos.subscriptionCredits.grant(tx, { orgId: a.ctx.orgId, kind: "referral", months: 1, sourceReferralId: null }));
    expect(await billing.processSubscriptionRenewal(services, a.ctx.orgId)).toMatchObject({ action: "renewed", reason: "referral_credit" });
    expect(orders).toHaveLength(0);
    expect(await subOf(a.ctx.orgId)).toMatchObject({ status: "active", currentPeriodEnd: "2026-12-05T10:00:00.000Z", chargeAttempts: 0, nextChargeAt: null, lastChargeError: null });
  });

  it("même titulaire sous un autre email (alias Gmail) : refusé au premier paiement, aucun crédit, audit", async () => {
    if (!available) return;
    const mk = (email: string) => services.db.withGlobal(async (tx) => (await repos.users.create(tx, { email, displayName: "Alice", passwordHash: "x", passwordSalt: "y" })).id);
    const tag = `t${Date.now()}`;
    const a = await setupOrg({}, { userId: await mk(`alice.martin.${tag}@gmail.com`) });
    const code = await referral.getOrCreateCode(a.ctx);
    // Inscription avec « alice.martin+2@googlemail.com » : organisation et utilisateur tout neufs, le contrôle
    // à l'inscription ne voit rien.
    const b = await setupOrg({ currentPeriodEnd: "2026-11-08T09:00:00.000Z" }, { userId: await mk(`AliceMartin.${tag}+2@googlemail.com`) });
    expect((await referral.applyCodeAtSignup(services, b.ctx.orgId, code)).applied).toBe(true);
    // Premier débit de B : refusé, aucun mois offert ni pour A ni pour B.
    expect((await billing.processSubscriptionRenewal(services, b.ctx.orgId)).action).toBe("renewed");
    expect(await linkOf(b.ctx.orgId)).toMatchObject({ status: "refused", refusedReason: "same_email", refusedAt: T0.toISOString() });
    expect(await creditsOf(a.ctx.orgId)).toHaveLength(0);
    expect(await creditsOf(b.ctx.orgId)).toHaveLength(0);
    expect(await auditOf(a.ctx.orgId)).toContain("referral.refused");
    expect(await auditOf(b.ctx.orgId)).toContain("referral.refused");
    // Rejoué : toujours refusé, jamais qualifié ensuite.
    expect(await referral.qualify(services, b.ctx.orgId)).toMatchObject({ qualified: false, reason: "refused" });
    expect((await referral.getOverview(a.ctx)).referred).toEqual({ pending: 0, qualified: 0, credited: 0, refused: 1 });
  });

  it("compte principal invité dans la filleule après l'inscription, ou même client Revolut : refusé", async () => {
    if (!available) return;
    const a = await setupOrg();
    const code = await referral.getOrCreateCode(a.ctx);
    const b = await setupOrg();
    expect((await referral.applyCodeAtSignup(services, b.ctx.orgId, code)).applied).toBe(true);
    await services.db.withGlobal((tx) => repos.memberships.create(tx, { orgId: b.ctx.orgId, userId: a.userId, role: "admin" }));
    expect(await referral.qualify(services, b.ctx.orgId)).toMatchObject({ qualified: false, reason: "refused", refusal: "shared_member" });

    const c = await setupOrg();
    const sub = await subOf(a.ctx.orgId);
    await services.db.withOrg(c.ctx.orgId, (tx) => repos.subscriptions.upsert(tx, { revolutCustomerId: sub!.revolutCustomerId }));
    expect((await referral.applyCodeAtSignup(services, c.ctx.orgId, code)).applied).toBe(true);
    expect(await referral.qualify(services, c.ctx.orgId)).toMatchObject({ qualified: false, reason: "refused", refusal: "same_payment" });
    const d = await setupOrg({ paymentMethodId: sub!.paymentMethodId });
    expect((await referral.applyCodeAtSignup(services, d.ctx.orgId, code)).applied).toBe(true);
    expect(await referral.qualify(services, d.ctx.orgId)).toMatchObject({ qualified: false, reason: "refused", refusal: "same_payment" });
    expect(await creditsOf(a.ctx.orgId)).toHaveLength(0);
  });

  it(`plafond : au plus ${REFERRAL_MAX_CREDITS_PER_REFERRER} mois offerts par marraine sur 12 mois`, async () => {
    if (!available) return;
    const a = await setupOrg();
    const code = await referral.getOrCreateCode(a.ctx);
    for (let i = 0; i < REFERRAL_MAX_CREDITS_PER_REFERRER; i++) {
      const f = await setupOrg();
      await owner.query("insert into referrals (code, referrer_org_id, referred_org_id, status, qualified_at) values ($1, $2, $3, 'qualified', $4)", [code, a.ctx.orgId, f.ctx.orgId, T0.toISOString()]);
    }
    const last = await setupOrg();
    expect((await referral.applyCodeAtSignup(services, last.ctx.orgId, code)).applied).toBe(true);
    expect(await referral.qualify(services, last.ctx.orgId)).toMatchObject({ qualified: false, reason: "refused", refusal: "cap_reached" });
    // Un an plus tard, les anciens parrainages ne comptent plus : une nouvelle filleule est qualifiée.
    clock = new Date("2027-11-09T10:00:00.000Z");
    const later = await setupOrg();
    expect((await referral.applyCodeAtSignup(services, later.ctx.orgId, code)).applied).toBe(true);
    expect(await referral.qualify(services, later.ctx.orgId)).toMatchObject({ qualified: true });
  });

  it("email canonique : minuscules, sans +alias, sans points pour Gmail seulement", () => {
    expect(canonicalEmail(" Alice.Martin+vinted@Gmail.com ")).toBe("alicemartin@gmail.com");
    expect(canonicalEmail("alice.martin@googlemail.com")).toBe("alicemartin@gmail.com");
    expect(canonicalEmail("alice.martin+2@exemple.fr")).toBe("alice.martin@exemple.fr");
    expect(canonicalEmail("pas-un-email")).toBe("pas-un-email");
  });
});
