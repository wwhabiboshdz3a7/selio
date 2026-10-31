import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, SecretBox, createPool, runMigrations, MIGRATIONS_DIR, repos, hashPassword } from "@selio/db";
import { createAIService } from "@selio/ai";
import { PaymentApiError, type PaymentOrderInfo, type PaymentProvider, type PaymentState, type SavedPaymentMethod } from "@selio/connectors";
import { quotasForPlan } from "@selio/contracts";
import { billing, type Services } from "@selio/core";
import { NoopEmailProvider } from "@selio/email";
import { automationTick, processJobs, renewSubscriptions, retentionTick, systemContext } from "./tasks";
import { cloud, messaging, type OrgContext } from "@selio/core";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLOUD_CONSENT_VERSION } from "@selio/contracts";
import { FakeRunner } from "@selio/cloud";
import IORedis from "ioredis";
import { CloudTickRunner, RunnerCloudExecutor, cloudLoginTask, cloudTick, createRedisLoginBus, toRunnerAction, type CloudLoginBus, type ScreenMessage } from "./cloud";
import { cloudDrainMs, cloudLoginConcurrency, cloudProfileMaxAgeMs, cloudRunnable, cloudServicesConfig, disabledSchedules, loadEnv, maintenanceSchedules, radarServicesConfig } from "./config";
import { readFileSync } from "node:fs";
import { RadarReader, type BuyInput, type PurchaseResult, type RadarReadResult } from "@selio/cloud";
import { FakePushSender, radar, radarAlerts } from "@selio/core";
import type { RadarSearch } from "@selio/contracts";
import { CloudOffRadarReader, CloudPurchaseAdapter, CloudRadarReader, PageRateLimiter, SingleFlight, alertsTick, radarAutoTick, radarResumeTask, radarTick, toCoreReadOutcome, toCorePurchaseOutcome } from "./radar";

const OWNER_URL = process.env.TEST_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker";
const APP_URL = process.env.TEST_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker";
let services: Services;
let available = true;
let orgId = "";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  const owner = createPool(OWNER_URL, { max: 1 });
  try {
    await runMigrations(owner, MIGRATIONS_DIR);
    // La numérotation des factures (compteur par année) survit à la suppression des organisations : on repart de 000001.
    await owner.query("truncate users, organizations, payment_events, rate_limits, invoice_counters cascade");
  } catch {
    available = false;
    return;
  } finally {
    await owner.end();
  }
  services = { db: new Db(createPool(APP_URL, { max: 2 })), ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }), secrets: new SecretBox(SecretBox.generateKey()), now: () => new Date(), allowAiFallback: false, version: "test" };
  const { hash, salt } = await hashPassword("x".repeat(12));
  orgId = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: "w@test.local", displayName: "W", passwordHash: hash, passwordSalt: salt });
    const o = await repos.orgs.create(tx, { name: "Org W", slug: "org-w", settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return o.id;
  });
});

afterAll(async () => { await services?.db.close(); });

describe("worker", () => {
  it("évalue les règles de toutes les organisations et exécute les tâches échues", async () => {
    if (!available) return;
    const ctx = systemContext(services, orgId);
    await services.db.withOrg(orgId, async (tx) => {
      await repos.connections.create(tx, { id: "c-demo", provider: "demo", label: "Simu", status: "connected", capabilities: [{ capability: "send_message", state: "available", note: "" }, { capability: "read_conversations", state: "available", note: "" }], transport: "simulator" });
      await repos.rules.create(tx, { name: "Accusé", kind: "reply_on_new_message", enabled: true, requiresApproval: false, runsIn: "server", schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, timezone: "UTC" }, limits: { maxPerDay: 5, maxPerCustomerPerDay: 2, minMinutesBetweenActions: 0 }, config: { template: "Bien reçu {{prenom}}" } });
    });
    await messaging.simulateIncoming(ctx, null, "Bonjour, dispo ?");
    const r1 = await automationTick(services, silent);
    expect(r1.created).toBe(1);
    const r2 = await automationTick(services, silent);
    expect(r2.created).toBe(0);
    const jobs = await services.db.withOrg(orgId, (tx) => repos.jobs.list(tx, {}));
    expect(jobs.items[0]?.status).toBe("succeeded");
    expect(await processJobs(services, silent)).toBe(0);
    const clean = await retentionTick(services);
    expect(clean.orgs).toBe(1);
  });
});

/**
 * Fournisseur simulé, sans HTTP (l'environnement de test Revolut n'est pas joignable d'ici) :
 * commandes en mémoire avec leurs tentatives de paiement, débits à l'initiative du marchand scriptés
 * (`outcomes` : état ou erreur), annulations et listes de moyens scriptables en échec. Le préfixe
 * rend les identifiants de commande uniques entre les tests (order_id est unique en base).
 */
interface FakeOrder { orderId: string; state: PaymentState; amountCents: number; captureMode: string; metadata: Record<string, string> | undefined; attempts: number; paymentMethodId: string | null }
const card = (id: string, createdAt: string | null = null): SavedPaymentMethod => ({ id, type: "card", brand: "visa", last4: "4242", expiryMonth: 1, expiryYear: 2030, createdAt });
const transient = (code = "http_503") => new PaymentApiError(503, code, "Revolut indisponible (simulé)", true);
const definitive = (code = "not_cancellable") => new PaymentApiError(422, code, "Refus définitif (simulé)", false);
function fakeProvider(prefix: string) {
  const orders = new Map<string, FakeOrder>();
  const created: FakeOrder[] = [];
  const charges: { orderId: string; paymentMethodId: string }[] = [];
  const outcomes: (PaymentState | Error)[] = [];
  const cancelScript: (Error | null)[] = [];
  const listScript: (Error | null)[] = [];
  const cancelled: string[] = [];
  let methods: SavedPaymentMethod[] = [card("pm_w")];
  const info = (o: FakeOrder): PaymentOrderInfo => ({ orderId: o.orderId, token: null, state: o.state, amountCents: o.amountCents, currency: "EUR", customerId: "cus_w", merchantOrderRef: null, paymentAttempts: o.attempts, paymentMethodId: o.paymentMethodId });
  const payments: PaymentProvider = {
    name: "revolut",
    testMode: true,
    createCustomer: async () => ({ customerId: "cus_w" }),
    createCheckoutOrder: async () => { throw new Error("non utilisé par le worker"); },
    createOrder: async (input) => {
      const o: FakeOrder = { orderId: `ord_${prefix}_${created.length + 1}`, state: "pending", amountCents: input.amountCents, captureMode: input.captureMode, metadata: input.metadata, attempts: 0, paymentMethodId: null };
      orders.set(o.orderId, o);
      created.push(o);
      return info(o);
    },
    chargeSavedMethod: async (input) => {
      charges.push(input);
      const next = outcomes.shift() ?? "completed";
      if (next instanceof Error) throw next;
      const o = orders.get(input.orderId);
      if (o) {
        o.attempts += 1;
        o.state = next;
        if (next === "completed" || next === "authorised") o.paymentMethodId = input.paymentMethodId;
      }
      return { state: next };
    },
    cancelOrder: async (orderId) => {
      const err = cancelScript.shift();
      if (err) throw err;
      cancelled.push(orderId);
      const o = orders.get(orderId);
      if (o) o.state = "cancelled";
      return { state: "cancelled" };
    },
    getOrder: async (orderId) => {
      const o = orders.get(orderId);
      if (!o) throw new PaymentApiError(404, "not_found", "commande inconnue (simulé)", false);
      return info(o);
    },
    listMerchantPaymentMethods: async () => {
      const err = listScript.shift();
      if (err) throw err;
      return methods;
    },
    verifyWebhook: () => ({ ok: false, reason: "non utilisé par le worker" }),
  };
  /** Commande connue du fournisseur sans passer par createOrder (autorisation posée par le formulaire). */
  const seed = (o: Partial<FakeOrder> & { orderId: string }) => { const full: FakeOrder = { state: "authorised", amountCents: 100, captureMode: "manual", metadata: undefined, attempts: 1, paymentMethodId: "pm_w", ...o }; orders.set(full.orderId, full); return full; };
  return { payments, orders, created, charges, outcomes, cancelScript, listScript, cancelled, seed, setMethods: (m: SavedPaymentMethod[]) => { methods = m; } };
}

describe("worker : échéances d'abonnement (horloge injectée, fournisseur simulé sans HTTP)", () => {
  const day = 86_400_000;
  const hour = 3_600_000;
  const getSub = () => services.db.withOrg(orgId, (tx) => repos.subscriptions.get(tx));
  const iso = (ms: number) => new Date(ms).toISOString();
  const activePro = (periodEnd: Date, over: Record<string, unknown> = {}) => services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "active", provider: "revolut", quotas: quotasForPlan("pro"), currentPeriodEnd: periodEnd.toISOString(), cardOnFile: true, revolutCustomerId: "cus_w", paymentMethodId: "pm_w", cycle: "monthly", pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, cancelAtPeriodEnd: false, dataRetentionUntil: null, ...over }));
  const invoicesOf = () => services.db.withOrg(orgId, (tx) => repos.invoices.list(tx));
  const auditActions = async () => (await services.db.withOrg(orgId, (tx) => repos.audit.list(tx, 200))).map((a) => a.action);

  it("relances aux bons délais : échéance, J+1, J+3, J+7 (rien entre deux), puis renouvellement réussi → facture ; résiliation à l'échéance suivante", async () => {
    if (!available) return;
    const T0 = new Date("2026-11-01T05:00:00.000Z");
    let clock = T0;
    const mailbox = new NoopEmailProvider();
    const fake = fakeProvider("a");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments, email: mailbox, publicWebUrl: "https://app.selio.test", billing: { franchiseTva: true } };
    // Abonnement Pro actif chez Revolut, carte enregistrée, échéance à T0.
    await activePro(T0);

    clock = new Date(T0.getTime() - 60_000);
    expect(await renewSubscriptions(svc, silent)).toEqual({ orgs: 1, renewed: 0, failed: 0, ended: 0, skipped: 1, errors: 0 });
    expect(fake.charges).toHaveLength(0);

    // Échéance : débit refusé → relance J+1, email.
    clock = new Date(T0.getTime() + 60_000);
    fake.outcomes.push("failed");
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ failed: 1, renewed: 0 });
    expect(await getSub()).toMatchObject({ status: "past_due", plan: "pro", chargeAttempts: 1, nextChargeAt: iso(T0.getTime() + day) });
    expect(fake.created[0]).toMatchObject({ amountCents: 2499, captureMode: "automatic", metadata: { kind: "renewal", attempt: "1" } });
    expect(fake.charges[0]).toEqual({ orderId: "ord_a_1", paymentMethodId: "pm_w" });
    expect(mailbox.all()).toHaveLength(1);
    expect(mailbox.last()).toMatchObject({ to: "w@test.local" });
    expect(mailbox.last()?.text).toMatch(/le 2 novembre 2026/);

    // Entre deux relances : aucune tentative.
    clock = new Date(T0.getTime() + 12 * hour);
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ skipped: 1, failed: 0 });
    expect(fake.charges).toHaveLength(1);

    // J+1 : échec → J+3.
    clock = new Date(T0.getTime() + day + 1000);
    fake.outcomes.push("failed");
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ failed: 1 });
    expect(await getSub()).toMatchObject({ chargeAttempts: 2, nextChargeAt: iso(T0.getTime() + 3 * day) });
    expect(mailbox.last()?.text).toMatch(/le 4 novembre 2026/);
    clock = new Date(T0.getTime() + 2 * day);
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ skipped: 1 });

    // J+3 : échec → J+7.
    clock = new Date(T0.getTime() + 3 * day + 1000);
    fake.outcomes.push("failed");
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ failed: 1 });
    expect(await getSub()).toMatchObject({ chargeAttempts: 3, nextChargeAt: iso(T0.getTime() + 7 * day) });
    expect(mailbox.last()?.text).toMatch(/le 8 novembre 2026/);
    clock = new Date(T0.getTime() + 5 * day);
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ skipped: 1 });
    expect(fake.charges).toHaveLength(3);

    // J+7 : succès → période prolongée d'un mois depuis l'échéance, facture (franchise de TVA), compteurs remis à zéro.
    clock = new Date(T0.getTime() + 7 * day + 1000);
    fake.outcomes.push("completed");
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ renewed: 1, failed: 0, ended: 0 });
    const renewed = await getSub();
    expect(renewed).toMatchObject({ status: "active", plan: "pro", chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, currentPeriodEnd: "2026-12-01T05:00:00.000Z" });
    expect(fake.charges).toHaveLength(4);
    expect(fake.charges.every((c) => c.paymentMethodId === "pm_w")).toBe(true);
    expect(fake.created.map((o) => o.metadata?.attempt)).toEqual(["1", "2", "3", "4"]);
    const invoices = await invoicesOf();
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ number: "SEL-2026-000001", plan: "pro", cycle: "monthly", amountCents: 2499, vatRate: 0, vatNotice: "TVA non applicable, art. 293 B du CGI", periodStart: T0.toISOString(), periodEnd: "2026-12-01T05:00:00.000Z", orderId: "ord_a_4" });
    expect(mailbox.all()).toHaveLength(3);
    expect(JSON.stringify(mailbox.all())).not.toMatch(/4242|pm_w/);
    clock = new Date(T0.getTime() + 20 * day);
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ skipped: 1 });

    // Résiliation demandée : à l'échéance suivante, accès de base sans débit, données conservées 30 jours.
    await services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { cancelAtPeriodEnd: true }));
    clock = new Date("2026-12-01T06:00:00.000Z");
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ ended: 1, renewed: 0, failed: 0 });
    expect(await getSub()).toMatchObject({ plan: "free", status: "canceled", cancelAtPeriodEnd: false, quotas: quotasForPlan("free"), dataRetentionUntil: iso(clock.getTime() + 30 * day) });
    expect(fake.charges).toHaveLength(4);
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ skipped: 1 });
  });

  it("échéance à 14:00 et passage horaire : les tentatives ont lieu le jour annoncé par email (J+1, J+3, J+7), jamais un jour plus tard", async () => {
    if (!available) return;
    const due = new Date("2026-11-01T14:00:00.000Z");
    let clock = new Date("2026-11-01T00:00:00.000Z");
    const mailbox = new NoopEmailProvider();
    const fake = fakeProvider("b");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments, email: mailbox, publicWebUrl: "https://app.selio.test" };
    await activePro(due);
    fake.outcomes.push("failed", "failed", "failed", "completed");
    const chargedAt: string[] = [];
    const announced: string[] = [];
    // Un passage par heure, du 1er au 9 novembre, comme CRON_BILLING_RENEW=0 * * * *.
    for (; clock <= new Date("2026-11-09T00:00:00.000Z"); clock = new Date(clock.getTime() + hour)) {
      const before = fake.charges.length;
      const r = await renewSubscriptions(svc, silent);
      expect(r.errors).toBe(0);
      if (fake.charges.length > before) {
        chargedAt.push(clock.toISOString());
        const s = await getSub();
        if (s?.nextChargeAt) announced.push(s.nextChargeAt);
      }
    }
    expect(chargedAt).toEqual(["2026-11-01T14:00:00.000Z", "2026-11-02T14:00:00.000Z", "2026-11-04T14:00:00.000Z", "2026-11-08T14:00:00.000Z"]);
    // Les dates annoncées (email et écran « Prochaine tentative ») sont exactement celles des tentatives suivantes.
    expect(announced).toEqual(chargedAt.slice(1));
    expect(mailbox.all().map((m) => m.text?.match(/le (\d+ novembre 2026)/)?.[1])).toEqual(["2 novembre 2026", "4 novembre 2026", "8 novembre 2026"]);
    expect(await getSub()).toMatchObject({ status: "active", chargeAttempts: 0, nextChargeAt: null, currentPeriodEnd: "2026-12-01T14:00:00.000Z" });
    const invoices = await invoicesOf();
    expect(invoices[0]).toMatchObject({ number: "SEL-2026-000002", periodStart: due.toISOString(), periodEnd: "2026-12-01T14:00:00.000Z", orderId: "ord_b_4", vatRate: 20 });
  });

  it("commande jamais présentée à la banque (panne entre la création et le débit) : remplacée au passage suivant, aucun échec compté, aucun email", async () => {
    if (!available) return;
    const due = new Date("2027-01-10T09:00:00.000Z");
    let clock = new Date(due.getTime() + 60_000);
    const mailbox = new NoopEmailProvider();
    const fake = fakeProvider("c");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments, email: mailbox };
    await activePro(due);
    fake.outcomes.push(transient("network"));
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "deferred", reason: "network" });
    expect(await getSub()).toMatchObject({ status: "active", chargeAttempts: 0, nextChargeAt: null, lastChargeError: null });
    expect(fake.orders.get("ord_c_1")).toMatchObject({ state: "pending", attempts: 0 });
    // Passage suivant : la commande est relue (jamais présentée), annulée, et une nouvelle est débitée tout de suite.
    clock = new Date(clock.getTime() + hour);
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toMatchObject({ action: "renewed", invoiceNumber: expect.stringMatching(/^SEL-2027-000001$/) });
    expect(fake.cancelled).toEqual(["ord_c_1"]);
    expect(fake.charges.map((c) => c.orderId)).toEqual(["ord_c_1", "ord_c_2"]);
    expect(await getSub()).toMatchObject({ status: "active", chargeAttempts: 0, currentPeriodEnd: "2027-02-10T09:00:00.000Z" });
    const orders = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.list(tx, 2));
    expect(orders.map((o) => [o.orderId, o.state])).toEqual([["ord_c_2", "completed"], ["ord_c_1", "cancelled"]]);
    expect(mailbox.all()).toHaveLength(0);
    expect((await invoicesOf())[0]?.orderId).toBe("ord_c_2");
  });

  it("commande restée en traitement : on attend, puis on l'annule chez le fournisseur avant de compter l'échec ; impossible à annuler → on attend encore", async () => {
    if (!available) return;
    const due = new Date("2027-03-05T10:00:00.000Z");
    let clock = new Date(due.getTime() + 60_000);
    const mailbox = new NoopEmailProvider();
    const fake = fakeProvider("d");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments, email: mailbox };
    await activePro(due);
    fake.outcomes.push("processing");
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "awaiting_webhook" });
    expect(await getSub()).toMatchObject({ status: "active", chargeAttempts: 0 });
    clock = new Date(clock.getTime() + 2 * hour);
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "awaiting_webhook" });
    expect(fake.charges).toHaveLength(1);
    // Au-delà de 20 h : annulation d'abord. Refusée (encore en traitement) → aucun échec compté.
    clock = new Date(clock.getTime() + 19 * hour);
    fake.cancelScript.push(definitive());
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "awaiting_webhook", reason: "cancel_refused" });
    expect(await getSub()).toMatchObject({ status: "active", chargeAttempts: 0 });
    expect(mailbox.all()).toHaveLength(0);
    // Annulation acceptée → échec compté une fois, relance J+1 à l'heure de l'échéance, email.
    clock = new Date(clock.getTime() + hour);
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toMatchObject({ action: "failed", nextChargeAt: "2027-03-06T10:00:00.000Z" });
    expect(fake.cancelled).toEqual(["ord_d_1"]);
    expect(await getSub()).toMatchObject({ status: "past_due", chargeAttempts: 1, lastChargeError: "Paiement resté en attente chez le fournisseur" });
    expect(mailbox.all()).toHaveLength(1);
    expect((await services.db.withOrg(orgId, (tx) => repos.paymentOrders.byOrderId(tx, "ord_d_1")))?.state).toBe("failed");
  });

  it("deux clôtures simultanées d'une même commande (worker et webhook ORDER_COMPLETED) : une seule facture, un seul audit", async () => {
    if (!available) return;
    const due = new Date("2027-04-01T08:00:00.000Z");
    const clock = new Date(due.getTime() + 60_000);
    const fake = fakeProvider("e");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments };
    await activePro(due);
    const po = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.create(tx, { orderId: "ord_e_direct", kind: "renewal", plan: "pro", cycle: "monthly", amountCents: 2499, captureMode: "automatic", attempt: 1 }));
    const before = (await invoicesOf()).length;
    const audits = (await auditActions()).filter((a) => a === "billing.payment_completed").length;
    const [r1, r2] = await Promise.all([billing.completePaidOrder(svc, orgId, po), billing.completePaidOrder(svc, orgId, po)]);
    expect([r1.invoice, r2.invoice].filter((i) => i !== null)).toHaveLength(1);
    expect((await invoicesOf()).length).toBe(before + 1);
    expect((await auditActions()).filter((a) => a === "billing.payment_completed").length).toBe(audits + 1);
    expect(await getSub()).toMatchObject({ status: "active", currentPeriodEnd: "2027-05-01T08:00:00.000Z" });
    // Une troisième clôture (webhook en retard) ne fait rien non plus.
    expect((await billing.completePaidOrder(svc, orgId, po)).invoice).toBeNull();
  });

  it("autorisation de vérification non annulée au webhook : retentée à chaque passage ; déjà encaissée chez le fournisseur → carte retenue et capture journalisée, jamais de facture", async () => {
    if (!available) return;
    const clock = new Date("2027-05-02T12:00:00.000Z");
    const fake = fakeProvider("f");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments };
    await activePro(new Date("2027-06-01T00:00:00.000Z"));
    fake.seed({ orderId: "ord_f_auth" });
    fake.seed({ orderId: "ord_f_captured", state: "completed", paymentMethodId: "pm_captured" });
    fake.setMethods([card("pm_w", "2027-01-01T00:00:00.000Z"), card("pm_captured", "2027-05-02T11:59:00.000Z")]);
    // Deux transactions : `created_at` (now() de la transaction) doit les ordonner.
    await services.db.withOrg(orgId, (tx) => repos.paymentOrders.create(tx, { orderId: "ord_f_auth", kind: "trial_authorisation", plan: "pro", cycle: "monthly", amountCents: 100, captureMode: "manual", state: "authorised" }));
    await services.db.withOrg(orgId, (tx) => repos.paymentOrders.create(tx, { orderId: "ord_f_captured", kind: "card_update", plan: "pro", cycle: "monthly", amountCents: 100, captureMode: "manual", state: "authorised" }));
    // Fournisseur en panne : rien ne change, on réessaiera.
    fake.cancelScript.push(transient(), transient());
    expect(await billing.releaseStaleAuthorisations(svc, orgId)).toBe(0);
    expect((await services.db.withOrg(orgId, (tx) => repos.paymentOrders.byOrderId(tx, "ord_f_auth")))?.state).toBe("authorised");
    // Première annulée ; la seconde est refusée (déjà encaissée) : état relu, carte retenue, capture journalisée à rembourser.
    fake.cancelScript.push(null, definitive("order_completed"));
    expect(await billing.releaseStaleAuthorisations(svc, orgId)).toBe(1);
    expect(fake.cancelled).toEqual(["ord_f_auth"]);
    const stateOf = async (id: string) => (await services.db.withOrg(orgId, (tx) => repos.paymentOrders.byOrderId(tx, id)))?.state;
    expect(await stateOf("ord_f_auth")).toBe("cancelled");
    expect(await stateOf("ord_f_captured")).toBe("completed");
    expect(await getSub()).toMatchObject({ status: "active", cardOnFile: true, paymentMethodId: "pm_captured" });
    const actions = await auditActions();
    expect(actions).toContain("billing.authorisation_released");
    expect(actions).toContain("billing.unexpected_capture");
    expect((await invoicesOf()).some((i) => i.orderId === "ord_f_captured")).toBe(false);
    // Plus rien à lever ; le passage horaire complet ne touche pas à l'échéance future.
    expect(await billing.releaseStaleAuthorisations(svc, orgId)).toBe(0);
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "skipped", reason: "not_due" });
  });

  it("fin d'essai : carte enregistrée chez le fournisseur mais inconnue de Selio (liste en panne au webhook) → relue avant de conclure ; fournisseur injoignable → l'échéance attend", async () => {
    if (!available) return;
    const end = new Date("2027-07-15T16:00:00.000Z");
    const clock = new Date(end.getTime() + 60_000);
    const mailbox = new NoopEmailProvider();
    const fake = fakeProvider("g");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments, email: mailbox };
    await services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "trialing", provider: "revolut", quotas: quotasForPlan("pro"), currentPeriodEnd: end.toISOString(), cardOnFile: false, paymentMethodId: null, revolutCustomerId: "cus_w", pendingPlan: "agence", cycle: "monthly", chargeAttempts: 0, nextChargeAt: null, cancelAtPeriodEnd: false }));
    fake.setMethods([card("pm_recovered", "2027-07-02T00:00:00.000Z")]);
    fake.listScript.push(transient());
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "deferred", reason: "provider_unreachable" });
    expect(await getSub()).toMatchObject({ status: "trialing", plan: "pro", cardOnFile: false });
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toMatchObject({ action: "renewed" });
    expect(await getSub()).toMatchObject({ status: "active", plan: "agence", cardOnFile: true, paymentMethodId: "pm_recovered", pendingPlan: null });
    expect(fake.charges).toEqual([{ orderId: "ord_g_1", paymentMethodId: "pm_recovered" }]);
    expect(await auditActions()).toContain("billing.card_recovered");
    // Sans aucune carte chez le fournisseur : fin d'essai sans tentative, comme avant.
    fake.setMethods([]);
    await services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "trialing", currentPeriodEnd: end.toISOString(), cardOnFile: false, paymentMethodId: null, pendingPlan: "pro" }));
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toEqual({ action: "trial_ended" });
    expect(await getSub()).toMatchObject({ status: "canceled", plan: "free" });
    expect(fake.charges).toHaveLength(1);
  });

  it("relances épuisées : retour à l'accès de base et carte oubliée ; le paiement suivant retient la carte du formulaire (la plus récente), jamais l'ancienne", async () => {
    if (!available) return;
    const due = new Date("2027-08-01T07:00:00.000Z");
    let clock = new Date(due.getTime() + 60_000);
    const mailbox = new NoopEmailProvider();
    const fake = fakeProvider("h");
    const svc: Services = { ...services, now: () => clock, payments: fake.payments, email: mailbox };
    await activePro(due, { paymentMethodId: "pm_expiree" });
    for (const delay of [0, 1, 3, 7]) {
      clock = new Date(due.getTime() + delay * day + 60_000);
      fake.outcomes.push("failed");
      await billing.processSubscriptionRenewal(svc, orgId);
    }
    expect(fake.charges).toHaveLength(4);
    expect(fake.charges.every((c) => c.paymentMethodId === "pm_expiree")).toBe(true);
    expect(await getSub()).toMatchObject({ status: "canceled", plan: "free", chargeAttempts: 4, cardOnFile: false, paymentMethodId: null, revolutCustomerId: "cus_w" });
    expect(mailbox.all()).toHaveLength(4);
    expect(mailbox.last()?.subject).toMatch(/accès de base/);
    // Le client paie avec une nouvelle carte (commande de formulaire) : c'est elle qui sert ensuite.
    fake.setMethods([card("pm_expiree", "2026-01-01T00:00:00.000Z"), card("pm_nouvelle", "2027-08-09T00:00:00.000Z")]);
    const checkout = fake.seed({ orderId: "ord_h_checkout", state: "completed", captureMode: "automatic", amountCents: 2499, paymentMethodId: "pm_nouvelle" });
    const po = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.create(tx, { orderId: checkout.orderId, kind: "checkout", plan: "pro", cycle: "monthly", amountCents: 2499, captureMode: "automatic" }));
    clock = new Date(due.getTime() + 9 * day);
    const done = await billing.completePaidOrder(svc, orgId, po);
    expect(done.invoice?.periodStart).toBe(clock.toISOString());
    expect(await getSub()).toMatchObject({ status: "active", plan: "pro", cardOnFile: true, paymentMethodId: "pm_nouvelle", chargeAttempts: 0, dataRetentionUntil: null });
    // Échéance suivante : c'est la nouvelle carte qui est débitée.
    clock = new Date(new Date(done.subscription.currentPeriodEnd!).getTime() + 60_000);
    expect(await billing.processSubscriptionRenewal(svc, orgId)).toMatchObject({ action: "renewed" });
    expect(fake.charges.at(-1)).toMatchObject({ paymentMethodId: "pm_nouvelle" });
  });

  it("fin d'essai : sans carte → accès de base sans appel au fournisseur ; avec carte mais sans fournisseur configuré → rien n'est tenté", async () => {
    if (!available) return;
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const mailbox = new NoopEmailProvider();
    const svc: Services = { ...services, now: () => new Date(), payments: null, email: mailbox };
    await services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "trialing", provider: "none", quotas: quotasForPlan("pro"), currentPeriodEnd: past, cardOnFile: false, paymentMethodId: null, revolutCustomerId: null, cancelAtPeriodEnd: false, dataRetentionUntil: null, pendingPlan: "agence" }));
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ ended: 1, failed: 0, errors: 0 });
    expect(await getSub()).toMatchObject({ plan: "free", status: "canceled", pendingPlan: null, dataRetentionUntil: null, quotas: quotasForPlan("free") });
    expect(mailbox.all()).toHaveLength(0);
    // Carte enregistrée mais pas de REVOLUT_SECRET_KEY sur ce serveur : l'essai attend, rien n'est débité ni dégradé.
    await services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "trialing", provider: "revolut", quotas: quotasForPlan("pro"), currentPeriodEnd: past, cardOnFile: true, paymentMethodId: "pm_w", revolutCustomerId: "cus_w" }));
    expect(await renewSubscriptions(svc, silent)).toMatchObject({ skipped: 1, ended: 0 });
    expect(await getSub()).toMatchObject({ plan: "pro", status: "trialing" });
  });
});

// ---------------------------------------------------------------- Selio Cloud

/**
 * Selio Cloud dans le worker : passage du planificateur et fenêtre de connexion avec le FakeRunner
 * de @selio/cloud (aucun navigateur), horloge injectée (10 h à Paris, heures actives), bus en mémoire.
 */
describe("worker : Selio Cloud (FakeRunner, horloge injectée)", () => {
  const T0 = new Date("2026-10-29T09:00:00.000Z");
  const TYPED = "mot-de-passe-tape-dans-la-fenetre";
  let clock = new Date(T0);
  let svc: Services;
  let mailbox: NoopEmailProvider;
  let profileBase = "";
  let seq = 0;
  const logs: { level: string; obj: object; msg: string }[] = [];
  const capture = {
    info: (obj: object, msg: string) => { logs.push({ level: "info", obj, msg }); },
    warn: (obj: object, msg: string) => { logs.push({ level: "warn", obj, msg }); },
    error: (obj: object, msg: string) => { logs.push({ level: "error", obj, msg }); },
  };
  const vintedState = () => ({
    cookies: [
      { name: "_vinted_fr_session", value: "VALEUR-DE-SESSION-SECRETE", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const },
      { name: "NID", value: "cookie-google", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" as const },
    ],
    origins: [{ origin: "https://www.vinted.fr", localStorage: [{ name: "vinted_prefs", value: "fr" }] }],
  });

  beforeAll(async () => {
    if (!available) return;
    mailbox = new NoopEmailProvider();
    svc = { ...services, now: () => new Date(clock), email: mailbox, publicWebUrl: "https://app.selio.test", config: { cloudActiveHours: { startHour: 8, endHour: 23 }, cloudLoginTimeoutMs: 300_000 } };
    profileBase = await mkdtemp(join(tmpdir(), "selio-worker-cloud-test-"));
  });
  afterAll(async () => {
    if (profileBase) await rm(profileBase, { recursive: true, force: true });
  });

  /** Organisation Agence, accord accepté, compte Vinted activé dans le Cloud et connecté (session chiffrée). */
  async function setupCloudOrg(): Promise<{ ctx: OrgContext; accountId: string; connectionId: string }> {
    const n = ++seq;
    const ids = await svc.db.withGlobal(async (tx) => {
      const u = await repos.users.create(tx, { email: `cloud-w${n}@test.local`, displayName: `Cloud ${n}`, passwordHash: "x", passwordSalt: "y" });
      const o = await repos.orgs.create(tx, { name: `Org Cloud W${n}`, slug: `org-cloud-w${n}`, settings: {} });
      await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
      return { orgId: o.id, userId: u.id };
    });
    await svc.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
    const ctx: OrgContext = { services: svc, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.9" };
    const connectionId = `conn-cloud-w${n}`;
    await svc.db.withOrg(ids.orgId, (tx) => repos.connections.create(tx, { id: connectionId, provider: "vinted", label: `Vinted ${n}`, status: "connected", usage: "sale" }));
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, { connectionId });
    const ticket = await cloud.startLogin(ctx, account.id);
    await cloud.completeLogin(svc, ticket.loginSessionId, vintedState());
    return { ctx, accountId: account.id, connectionId };
  }

  /** Conversation Vinted (référence connue) et tâche Cloud « répondre » échue. */
  async function addCloudJob(ctx: OrgContext, accountId: string, connectionId: string): Promise<{ jobId: string; ref: string }> {
    const ref = String(5_000_000 + ++seq);
    const jobId = await svc.db.withOrg(ctx.orgId, async (tx) => {
      const customer = await repos.customers.create(tx, { displayName: "Léa Martin", handle: `lea-w${seq}`, provider: "vinted" });
      const conv = await repos.conversations.create(tx, { customerId: customer.id, connectionId, provider: "vinted", externalRef: ref, unreadCount: 1, lastMessagePreview: "Dispo ?" });
      const job = await repos.jobs.create(tx, {
        kind: "automation.send_message", status: "queued", dedupeKey: `cloud-worker-test:${seq}`, runsIn: "cloud", scheduledFor: clock.toISOString(),
        payload: { conversationId: conv.id, customerId: customer.id, cloudAccountId: accountId, cloudKind: "reply", body: "Bonjour, toujours disponible !", ruleName: "Réponse auto" },
      });
      return job.id;
    });
    return { jobId, ref };
  }

  const deps = (runner: FakeRunner | null) => ({ executor: runner ? new RunnerCloudExecutor(runner, profileBase) : null, concurrency: 2, now: new Date(clock), rng: () => 0 });

  it("tick : une action exécutée dans un navigateur neuf (session vinted.* seulement, profil supprimé), journal et compteur", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId, connectionId } = await setupCloudOrg();
    const { jobId, ref } = await addCloudJob(ctx, accountId, connectionId);
    const runner = new FakeRunner();
    const res = await cloudTick(svc, capture, deps(runner));
    expect(res).toMatchObject({ enabled: true, executed: 1, done: 1, failed: 0, paused: 0, errors: 0 });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toMatchObject({ hadSession: true, action: { kind: "reply", conversationUrl: `https://www.vinted.fr/inbox/${ref}`, id: jobId } });
    // Profil temporaire créé sous CLOUD_PROFILE_DIR pour cette seule action, puis supprimé.
    expect(runner.calls[0]!.profileDir.startsWith(profileBase)).toBe(true);
    expect(existsSync(runner.calls[0]!.profileDir)).toBe(false);
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("succeeded");
    const journal = await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.listAll(tx, {}));
    expect(journal[0]).toMatchObject({ accountId, kind: "reply", level: "light", status: "done", detail: { code: "ok", conversationRef: ref } });
    expect(JSON.stringify(journal)).not.toContain("toujours disponible");
    const usage = await svc.db.withOrg(ctx.orgId, (tx) => tx.query<{ kind: string }>("select kind from usage_events where org_id = $1", [ctx.orgId]));
    expect(usage.map((u) => u.kind)).toContain("cloud.action");
    // Rythme humain : un deuxième passage tout de suite n'ouvre rien (une action par compte, délai minimal).
    await addCloudJob(ctx, accountId, connectionId);
    expect(await cloudTick(svc, capture, deps(runner))).toMatchObject({ executed: 0 });
    expect(runner.calls).toHaveLength(1);
    // Aucun journal ne porte la session ni le texte du message.
    expect(JSON.stringify(logs)).not.toMatch(/VALEUR-DE-SESSION-SECRETE|toujours disponible/);
    // Arrêt en un clic : session effacée, tâches restantes annulées (les tests suivants partent de zéro).
    await cloud.stop(ctx, accountId);
    expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, accountId))).toMatchObject({ status: "stopped", hasSession: false });
  });

  it("tick : CAPTCHA → compte en pause avec la raison, client prévenu, rien n'est retenté", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId, connectionId } = await setupCloudOrg();
    const { jobId } = await addCloudJob(ctx, accountId, connectionId);
    const before = mailbox.all().length;
    const runner = new FakeRunner({ scenarios: ["captcha"] });
    const res = await cloudTick(svc, capture, deps(runner));
    expect(res).toMatchObject({ executed: 1, done: 0, paused: 1 });
    expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, accountId))).toMatchObject({ status: "paused", pausedReason: "captcha", warningsCount: 1 });
    // Rien n'a été cliqué (sideEffects « none ») : la tâche attend la reprise du client, sans nouvel essai.
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("queued");
    expect(mailbox.all().length).toBe(before + 1);
    expect(mailbox.last()?.subject).toMatch(/en pause/);
    expect(logs.some((l) => l.level === "warn" && /pause/.test(l.msg))).toBe(true);
    clock = new Date(T0.getTime() + 30 * 60_000);
    expect(await cloudTick(svc, capture, deps(runner))).toMatchObject({ executed: 0 });
    expect(runner.calls).toHaveLength(1);
  });

  it("tick : Cloud désactivé → rien n'est fait (journal « Cloud désactivé »)", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId, connectionId } = await setupCloudOrg();
    const { jobId } = await addCloudJob(ctx, accountId, connectionId);
    logs.length = 0;
    expect(await cloudTick(svc, capture, deps(null))).toEqual({ enabled: false, orgs: 0, executed: 0, done: 0, failed: 0, paused: 0, needsLogin: 0, requeued: 0, recovered: 0, errors: 0, swept: 0, machinePausedUntil: null });
    expect(logs.some((l) => /Cloud désactivé/.test(l.msg))).toBe(true);
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("queued");
    expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.listAll(tx, {}))).toHaveLength(0);
  });

  it("exécuteur : action sans implémentation navigateur (modifier en masse) refusée sans rien ouvrir", async () => {
    const runner = new FakeRunner();
    const executor = new RunnerCloudExecutor(runner, profileBase || tmpdir());
    expect(toRunnerAction({ id: "j1", kind: "bulk_edit", level: "heavy" })).toBeNull();
    expect(toRunnerAction({ id: "j2", kind: "reply", level: "light", conversationUrl: "https://www.vinted.fr/inbox/1" })).toBeNull();
    expect(toRunnerAction({ id: "j3", kind: "follow_up", level: "light", conversationUrl: "https://www.vinted.fr/inbox/1", text: "Bonjour" })).toEqual({ kind: "follow_up", conversationUrl: "https://www.vinted.fr/inbox/1", text: "Bonjour", id: "j3" });
    // Refus avant tout lancement : rien n'a touché Vinted, l'action ne compte pas dans les plafonds.
    expect(await executor.run({ accountId: "a", session: null, action: { id: "j1", kind: "bulk_edit", level: "heavy" } })).toMatchObject({ ok: false, code: "error", sideEffects: "none", launched: false });
    expect(runner.calls).toHaveLength(0);
  });

  it("un seul passage à la fois : le planning de la minute suivante ne relance pas un passage en cours", async () => {
    let release: () => void = () => {};
    let calls = 0;
    const ticks = new CloudTickRunner(() => { calls++; return new Promise((r) => { release = () => r({ enabled: true, orgs: 0, executed: 0, done: 0, failed: 0, paused: 0, needsLogin: 0, requeued: 0, recovered: 0, errors: 0, swept: 0, machinePausedUntil: null }); }); }, silent);
    expect(ticks.trigger()).toEqual({ started: true });
    expect(ticks.trigger()).toEqual({ started: false });
    release();
    await ticks.drain(1000);
    expect(ticks.trigger()).toEqual({ started: true });
    release();
    await ticks.drain(1000);
    expect(calls).toBe(2);
    // Arrêt du worker : plus aucun passage (celui en cours aurait fini son action).
    ticks.stop();
    expect(ticks.stopping).toBe(true);
    expect(ticks.trigger()).toEqual({ started: false });
    expect(calls).toBe(2);
  });

  /** Bus en mémoire : ce que le worker publie pour l'API, et l'envoi d'un message de l'API au worker. */
  function memoryBus() {
    const screen: { id: string; message: ScreenMessage }[] = [];
    const inputs = new Map<string, (raw: string) => void>();
    const bus: CloudLoginBus = {
      publishScreen: async (id, message) => { screen.push({ id, message }); },
      subscribeInput: async (id, cb) => { inputs.set(id, cb); return async () => { inputs.delete(id); }; },
      close: async () => {},
    };
    return { bus, screen, send: (id: string, payload: unknown) => inputs.get(id)?.(JSON.stringify(payload)), subscribed: (id: string) => inputs.has(id) };
  }
  const waitFor = async (cond: () => boolean, timeoutMs = 3000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) throw new Error("délai dépassé");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("fenêtre de connexion : images publiées, entrées relayées sans journalisation, connexion détectée → session enregistrée et « done »", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId } = await setupCloudOrg();
    await cloud.deleteSession(ctx, accountId);
    const ticket = await cloud.startLogin(ctx, accountId);
    const runner = new FakeRunner({ loginState: vintedState() });
    const mem = memoryBus();
    logs.length = 0;
    const task = cloudLoginTask(svc, { runner, bus: mem.bus, profileBaseDir: profileBase, loginTimeoutMs: 300_000, pollMs: 15, statusPollMs: 30 }, ticket.loginSessionId, capture);
    await waitFor(() => runner.loginWindows.length === 1 && mem.subscribed(ticket.loginSessionId));
    const win = runner.loginWindows[0]!;
    win.emitFrame({ data: "/9j/AAAA", width: 1280, height: 800 });
    mem.send(ticket.loginSessionId, { type: "input", event: { type: "text", text: TYPED } });
    mem.send(ticket.loginSessionId, { type: "input", event: { type: "key", action: "down", key: "Enter" } });
    mem.send(ticket.loginSessionId, { type: "input", event: { type: "mouse", action: "teleport", x: 1, y: 1 } });
    mem.send(ticket.loginSessionId, { type: "hello" });
    await waitFor(() => win.inputCount === 2);
    win.setLoggedIn(true);
    const result = await task;
    expect(result).toMatchObject({ outcome: "done", inputs: 2, rejected: 1, frames: 2 });
    const kinds = mem.screen.map((s) => s.message.type);
    expect(kinds[0]).toBe("status");
    expect(kinds).toContain("frame");
    expect(kinds.at(-1)).toBe("done");
    expect(mem.screen.filter((s) => s.message.type === "frame")).toHaveLength(2); // image renvoyée sur « hello »
    // Session enregistrée (vinted.* seulement, chiffrée), compte actif, fenêtre close en base.
    const account = await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, accountId));
    expect(account).toMatchObject({ status: "active", hasSession: true });
    const blob = await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.session(tx, accountId));
    const saved = JSON.parse(svc.secrets.decrypt(blob!, accountId)) as { cookies: { domain: string }[] };
    expect(saved.cookies.map((c) => c.domain)).toEqual([".vinted.fr"]);
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudLoginSessions.byId(tx, ticket.loginSessionId)))?.status).toBe("done");
    // Journaux : compteurs seulement, jamais la frappe ni la session.
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(TYPED);
    expect(dump).not.toContain("VALEUR-DE-SESSION-SECRETE");
    expect(logs.some((l) => /fenêtre de connexion terminée/.test(l.msg))).toBe(true);
    expect(win.status).toBe("finished");
  });

  it("fenêtre de connexion : expiration, annulation par le client, Cloud désactivé", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId } = await setupCloudOrg();
    const runner = new FakeRunner({ loginState: vintedState() });
    const run = async (opts: { runner: FakeRunner | null }, act: (id: string, mem: ReturnType<typeof memoryBus>) => Promise<void>) => {
      const ticket = await cloud.startLogin(ctx, accountId);
      const mem = memoryBus();
      const task = cloudLoginTask(svc, { runner: opts.runner, bus: mem.bus, profileBaseDir: profileBase, loginTimeoutMs: 300_000, pollMs: 15, statusPollMs: 30 }, ticket.loginSessionId, capture);
      await act(ticket.loginSessionId, mem);
      const result = await task;
      const status = (await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudLoginSessions.byId(tx, ticket.loginSessionId)))?.status;
      return { result, status, last: mem.screen.at(-1)?.message };
    };

    const expired = await run({ runner }, async (id, mem) => {
      await waitFor(() => runner.loginWindows.length === 1 && mem.subscribed(id));
      runner.loginWindows[0]!.expire();
    });
    expect(expired).toMatchObject({ result: { outcome: "expired" }, status: "expired", last: { type: "closed", reason: "expired" } });

    const cancelled = await run({ runner }, async (id, mem) => {
      await waitFor(() => runner.loginWindows.length === 2 && mem.subscribed(id));
      mem.send(id, { type: "cancel" });
    });
    expect(cancelled).toMatchObject({ result: { outcome: "cancelled" }, status: "cancelled", last: { type: "closed", reason: "cancelled" } });
    expect(runner.loginWindows[1]!.status).toBe("cancelled");

    // Annulée côté API (bouton « Annuler » ou compte arrêté) : relue en base, la fenêtre se ferme.
    const viaDb = await run({ runner }, async (id, mem) => {
      await waitFor(() => runner.loginWindows.length === 3 && mem.subscribed(id));
      await cloud.cancelLogin(ctx, id);
    });
    expect(viaDb).toMatchObject({ result: { outcome: "cancelled" }, status: "cancelled" });

    const disabled = await run({ runner: null }, async () => {});
    expect(disabled).toMatchObject({ result: { outcome: "unavailable" }, status: "cancelled", last: { type: "closed", reason: "unavailable" } });
    // Aucun profil temporaire ne reste.
    expect((await readdir(profileBase)).length).toBe(0);
  });

  it("fenêtre de connexion : CAPTCHA de Vinted → fenêtre fermée sans lire la session, compte en pause, client prévenu", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId } = await setupCloudOrg();
    await cloud.deleteSession(ctx, accountId);
    const ticket = await cloud.startLogin(ctx, accountId);
    const runner = new FakeRunner({ loginState: vintedState() });
    const mem = memoryBus();
    const before = mailbox.all().length;
    const task = cloudLoginTask(svc, { runner, bus: mem.bus, profileBaseDir: profileBase, loginTimeoutMs: 300_000, pollMs: 15, statusPollMs: 30 }, ticket.loginSessionId, capture);
    await waitFor(() => runner.loginWindows.length === 1 && mem.subscribed(ticket.loginSessionId));
    const win = runner.loginWindows[0]!;
    // Le client a réussi à se connecter, mais Vinted affiche une vérification : rien n'est enregistré.
    win.setSignal({ code: "captcha", pattern: "captcha.markup.datadome" });
    win.setLoggedIn(true);
    const result = await task;
    expect(result.outcome).toBe("vinted_signal");
    expect(mem.screen.at(-1)?.message).toEqual({ type: "closed", reason: "vinted_signal" });
    expect(win.status).toBe("cancelled");
    expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, accountId))).toMatchObject({ status: "paused", pausedReason: "captcha", hasSession: false });
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudLoginSessions.byId(tx, ticket.loginSessionId)))?.status).toBe("cancelled");
    expect(mailbox.all().length).toBe(before + 1);
    expect(logs.some((l) => l.level === "warn" && /signal de Vinted pendant la connexion/.test(l.msg))).toBe(true);
    await cloud.stop(ctx, accountId);
  });

  it("fenêtre de connexion : navigation hors de Vinted (redirection) → fenêtre fermée, rien enregistré", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId } = await setupCloudOrg();
    await cloud.deleteSession(ctx, accountId);
    const ticket = await cloud.startLogin(ctx, accountId);
    const runner = new FakeRunner({ loginState: vintedState() });
    const mem = memoryBus();
    const task = cloudLoginTask(svc, { runner, bus: mem.bus, profileBaseDir: profileBase, loginTimeoutMs: 300_000, pollMs: 15, statusPollMs: 30 }, ticket.loginSessionId, capture);
    await waitFor(() => runner.loginWindows.length === 1 && mem.subscribed(ticket.loginSessionId));
    runner.loginWindows[0]!.refuse();
    const result = await task;
    expect(result.outcome).toBe("refused");
    expect(mem.screen.at(-1)?.message).toEqual({ type: "closed", reason: "navigation_refused" });
    expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, accountId))).toMatchObject({ status: "needs_login", hasSession: false });
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudLoginSessions.byId(tx, ticket.loginSessionId)))?.status).toBe("cancelled");
    await cloud.stop(ctx, accountId);
  });

  it("tick : aucun navigateur libre → tâche remise en file, non comptée ; dossiers abandonnés balayés à chaque passage", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId, connectionId } = await setupCloudOrg();
    const { jobId } = await addCloudJob(ctx, accountId, connectionId);
    // Dossier laissé par un processus arrêté pendant que celui-ci tournait déjà.
    const stale = join(profileBase, "selio-cloud-abandonne");
    await mkdir(stale);
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(stale, old, old);
    const runner = new FakeRunner({ fallback: "unavailable" });
    logs.length = 0;
    const res = await cloudTick(svc, capture, { ...deps(runner), profiles: { baseDir: profileBase, maxAgeMs: 10 * 60_000 } });
    // D'autres organisations des tests précédents peuvent avoir des tâches en file : on vérifie celle-ci.
    expect(res).toMatchObject({ executed: 0, swept: 1 });
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    expect(existsSync(stale)).toBe(false);
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("queued");
    expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.listAll(tx, {}))).toHaveLength(0);
    expect(logs.some((l) => l.level === "warn" && /aucun navigateur libre/.test(l.msg))).toBe(true);
    // Créneau libre au passage suivant : l'action part sans attendre le délai humain.
    runner.setFallback("ok");
    await cloudTick(svc, capture, deps(runner));
    expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.jobs.byId(tx, jobId))).status).toBe("succeeded");
    await cloud.stop(ctx, accountId);
  });

  it("tick : « trop de requêtes » → coupe-circuit de la machine, alerte de l'opérateur, plus aucune action", async () => {
    if (!available) return;
    clock = new Date(T0);
    const a = await setupCloudOrg();
    const b = await setupCloudOrg();
    await addCloudJob(a.ctx, a.accountId, a.connectionId);
    await addCloudJob(b.ctx, b.accountId, b.connectionId);
    const runner = new FakeRunner({ scenarios: ["rate_limited"], fallback: "ok" });
    logs.length = 0;
    try {
      // Organisations traitées une à une : la première reçoit « trop de requêtes », la seconde n'agit plus.
      const res = await cloudTick(svc, capture, { ...deps(runner), concurrency: 1 });
      expect(res.paused).toBe(1);
      expect(res.machinePausedUntil).not.toBeNull();
      expect(runner.calls).toHaveLength(1);
      expect(logs.some((l) => l.level === "error" && /COUPE-CIRCUIT/.test(l.msg))).toBe(true);
      const next = await cloudTick(svc, capture, deps(runner));
      expect(next).toMatchObject({ orgs: 0, executed: 0 });
      expect(next.machinePausedUntil).toBe(res.machinePausedUntil);
      expect(runner.calls).toHaveLength(1);
    } finally {
      await cloud.clearCircuit(svc);
      await cloud.stop(a.ctx, a.accountId);
      await cloud.stop(b.ctx, b.accountId);
    }
  });

  it("rétention : journal du Cloud gardé 90 jours, fenêtres expirées fermées", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId } = await setupCloudOrg();
    await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.add(tx, { accountId, kind: "reply", level: "light", status: "done", detail: { code: "ok" }, createdAt: new Date(Date.now() - 91 * 86_400_000).toISOString() }));
    await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.add(tx, { accountId, kind: "reply", level: "light", status: "done", detail: { code: "ok" }, createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }));
    const res = await retentionTick({ ...svc, now: () => new Date() });
    expect(res.cloud.purged).toBeGreaterThanOrEqual(1);
    const left = await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudActions.listAll(tx, {}));
    expect(left).toHaveLength(1);
  });
});

describe("worker : bus Redis de la fenêtre de connexion", () => {
  it("publie les images sur cloud:screen:<id> et reçoit les entrées de cloud:input:<id> (ignoré sans Redis)", async () => {
    const url = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
    const probe = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000, retryStrategy: () => null });
    probe.on("error", () => {});
    const ok = await probe.connect().then(() => probe.ping()).then(() => true, () => false);
    if (!ok) { probe.disconnect(); return; }
    const id = "0b0e2a4c-1d2f-4a5b-8c6d-7e8f9a0b1c2d";
    const bus = createRedisLoginBus(url, silent);
    const seen: string[] = [];
    try {
      await probe.subscribe(`cloud:screen:${id}`);
      probe.on("message", (_c: string, raw: string) => seen.push(raw));
      const got: string[] = [];
      const unsub = await bus.subscribeInput(id, (raw) => got.push(raw));
      const pub = new IORedis(url, { maxRetriesPerRequest: 1 });
      await pub.publish(`cloud:input:${id}`, JSON.stringify({ type: "hello" }));
      await bus.publishScreen(id, { type: "frame", data: "/9j/AA==", width: 10, height: 10 });
      const start = Date.now();
      while ((got.length === 0 || seen.length === 0) && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 10));
      expect(got).toEqual([JSON.stringify({ type: "hello" })]);
      expect(JSON.parse(seen[0]!)).toEqual({ type: "frame", data: "/9j/AA==", width: 10, height: 10 });
      await unsub();
      await pub.publish(`cloud:input:${id}`, JSON.stringify({ type: "cancel" }));
      await new Promise((r) => setTimeout(r, 50));
      expect(got).toHaveLength(1);
      pub.disconnect();
    } finally {
      await bus.close();
      probe.disconnect();
    }
  });
});

describe("worker : configuration du Cloud", () => {
  const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://127.0.0.1:6379", SECRETS_ENCRYPTION_KEY: "k".repeat(44) };
  it("valeurs prudentes par défaut et plage horaire validée", () => {
    const env = loadEnv(base);
    expect(env.CLOUD_CHROMIUM_PATH).toBeUndefined();
    expect(env).toMatchObject({ CLOUD_ENABLED: false, CLOUD_HEADLESS: true, CLOUD_MAX_BROWSERS: 5, CLOUD_MAX_ACCOUNTS_PER_ORG: 10, CLOUD_HEAVY_ACTIONS: false, CLOUD_PRO_OPTION: false, CLOUD_ACTIVE_HOURS: { startHour: 8, endHour: 23 }, CLOUD_LOGIN_TIMEOUT_MS: 300_000, CLOUD_ACTION_TIMEOUT_MS: 90_000, CRON_CLOUD: "* * * * *" });
    expect(env.CLOUD_PROFILE_DIR).toBe(join(tmpdir(), "selio-cloud"));
    expect(cloudRunnable(env)).toBe(false);
    expect(cloudRunnable(loadEnv({ ...base, CLOUD_ENABLED: "true" }))).toBe(false);
    expect(cloudRunnable(loadEnv({ ...base, CLOUD_ENABLED: "true", CLOUD_CHROMIUM_PATH: "/opt/chromium/chrome" }))).toBe(true);
    expect(loadEnv({ ...base, CLOUD_ACTIVE_HOURS: "9-18" }).CLOUD_ACTIVE_HOURS).toEqual({ startHour: 9, endHour: 18 });
    expect(() => loadEnv({ ...base, CLOUD_ACTIVE_HOURS: "23-8" })).toThrow(/CLOUD_ACTIVE_HOURS/);
    expect(() => loadEnv({ ...base, CLOUD_PROFILE_DIR: "profils" })).toThrow(/CLOUD_PROFILE_DIR/);
    expect(cloudServicesConfig(env)).toEqual({ cloudHeavyActions: false, cloudMaxAccountsPerOrg: 10, cloudMaxBrowsers: 5, cloudProOption: false, cloudActiveHours: { startHour: 8, endHour: 23 }, cloudLoginTimeoutMs: 300_000 });
  });

  it("bac à sable de Chromium : actif par défaut, désactivation refusée en production", () => {
    expect(loadEnv(base).CLOUD_CHROMIUM_SANDBOX).toBe(true);
    expect(loadEnv({ ...base, CLOUD_CHROMIUM_SANDBOX: "false" }).CLOUD_CHROMIUM_SANDBOX).toBe(false);
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AI_PROVIDER: "ollama", CLOUD_CHROMIUM_SANDBOX: "false" })).toThrow(/CLOUD_CHROMIUM_SANDBOX/);
  });

  it("créneaux, arrêt et balayage : un navigateur reste toujours aux actions, l'arrêt attend une action entière", () => {
    expect(cloudLoginConcurrency(5)).toBe(4);
    expect(cloudLoginConcurrency(2)).toBe(1);
    expect(cloudLoginConcurrency(1)).toBe(1);
    const env = loadEnv(base);
    expect(cloudDrainMs(env.CLOUD_ACTION_TIMEOUT_MS)).toBeGreaterThan(env.CLOUD_ACTION_TIMEOUT_MS);
    // Arrêt Docker / systemd réglé au-delà (150 s) : jamais de SIGKILL pendant une action.
    expect(cloudDrainMs(env.CLOUD_ACTION_TIMEOUT_MS)).toBeLessThan(150_000);
    expect(cloudProfileMaxAgeMs(env)).toBeGreaterThan(Math.max(env.CLOUD_ACTION_TIMEOUT_MS, env.CLOUD_LOGIN_TIMEOUT_MS));
  });
});

// ---------------------------------------------------------------- Selio Radar

/**
 * Selio Radar dans le worker, sur PostgreSQL local avec une horloge simulée : lecteur de @selio/cloud sur
 * FakeRunner (page catalogue de fixture, jamais vinted.fr), envoi des notifications simulé, exécuteur
 * d'achat simulé (aucun achat réel). Chaque test désactive ses recherches à la fin (passages globaux).
 */
describe("worker : Selio Radar (FakeRunner, horloge simulée)", () => {
  const T0 = new Date("2026-10-29T09:00:00.000Z");
  const CATALOG_HTML = readFileSync(new URL("../../../packages/connectors/src/vinted/fixtures/catalog-page.v1.html", import.meta.url), "utf8");
  const ENDPOINT = "https://fcm.googleapis.com/fcm/send/radar-worker-appareil";
  const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  let clock = new Date(T0);
  let svc: Services;
  let seq = 0;
  const logs: { level: string; obj: object; msg: string }[] = [];
  const capture = {
    info: (obj: object, msg: string) => { logs.push({ level: "info", obj, msg }); },
    warn: (obj: object, msg: string) => { logs.push({ level: "warn", obj, msg }); },
    error: (obj: object, msg: string) => { logs.push({ level: "error", obj, msg }); },
  };
  const advance = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };
  const vintedState = () => ({
    cookies: [{ name: "_vinted_fr_session", value: "SESSION-RADAR-WORKER", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }],
    origins: [],
  });

  beforeAll(() => {
    if (!available) return;
    svc = { ...services, now: () => new Date(clock), email: new NoopEmailProvider(), publicWebUrl: "https://app.selio.test", config: {} };
  });

  /** Organisation Agence, compte Vinted « Achat » relié à un compte Cloud actif (accord, session), recherches en direct. */
  async function liveOrg(searches: { name: string; priority?: boolean }[]): Promise<{ ctx: OrgContext; accountId: string; connectionId: string; searches: RadarSearch[] }> {
    const n = ++seq;
    const ids = await svc.db.withGlobal(async (tx) => {
      const u = await repos.users.create(tx, { email: `radar-w${n}@test.local`, displayName: `Radar ${n}`, passwordHash: "x", passwordSalt: "y" });
      const o = await repos.orgs.create(tx, { name: `Org Radar W${n}`, slug: `org-radar-w${n}`, settings: {} });
      await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
      return { orgId: o.id, userId: u.id };
    });
    await svc.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
    const ctx: OrgContext = { services: svc, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: null };
    const connectionId = `conn-radar-w${n}`;
    await svc.db.withOrg(ids.orgId, (tx) => repos.connections.create(tx, { id: connectionId, provider: "vinted", label: `Achats ${n}`, status: "connected", usage: "purchase" }));
    await cloud.acceptConsent(ctx, { version: CLOUD_CONSENT_VERSION, accepted: true });
    const account = await cloud.enableAccount(ctx, { connectionId });
    const ticket = await cloud.startLogin(ctx, account.id);
    await cloud.completeLogin(svc, ticket.loginSessionId, vintedState());
    const created: RadarSearch[] = [];
    for (const s of searches) created.push(await radar.createSearch(ctx, { name: s.name, source: "cloud", connectionId, priority: s.priority === true, criteria: { maxPriceCents: 10_000 }, budgetCents: 20_000 }));
    return { ctx, accountId: account.id, connectionId, searches: created };
  }

  /** Fin de test : plus aucune recherche active ni Radar Auto pour cette organisation. */
  async function retire(ctx: OrgContext): Promise<void> {
    await svc.db.withOrg(ctx.orgId, async (tx) => {
      for (const s of await repos.searches.list(tx)) await repos.searches.update(tx, s.id, { enabled: false });
      const org = await repos.orgs.byId(tx, ctx.orgId);
      await repos.orgs.update(tx, ctx.orgId, { settings: { ...org.settings, autoBuy: { ...org.settings.autoBuy, enabled: false } } });
    });
  }

  const readerOn = (runner: FakeRunner) => new CloudRadarReader(new RadarReader({ fetcher: runner, now: () => new Date(clock) }), capture);
  const readsOf = (ctx: OrgContext, searchId: string) => svc.db.withOrg(ctx.orgId, (tx) => repos.radarReads.list(tx, { searchId }));

  it("tick toutes les 30 s : une recherche prioritaire (Radar Auto actif) est lue deux fois plus souvent qu'une normale", async () => {
    if (!available) return;
    clock = new Date(T0);
    svc.config = { radarAutoEnabled: true };
    const { ctx, searches } = await liveOrg([{ name: "Prioritaire", priority: true }, { name: "Normale" }]);
    await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true } });
    const runner = new FakeRunner({ pageHtml: CATALOG_HTML });
    svc.radar = { reader: readerOn(runner) };
    const limiter = new PageRateLimiter(30);
    try {
      let found = 0;
      // Cinq minutes de passages toutes les 30 s.
      for (let i = 0; i < 10; i++) {
        const r = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
        expect(r.errors).toBe(0);
        found += r.found;
        advance(30);
      }
      const [prio, normal] = searches;
      const prioReads = await readsOf(ctx, prio!.id);
      const normalReads = await readsOf(ctx, normal!.id);
      expect(prioReads).toHaveLength(10);
      expect(normalReads).toHaveLength(5);
      expect(prioReads.every((r) => r.source === "cloud" && r.outcome === "ok" && r.factor === 1)).toBe(true);
      expect(runner.fetchCalls).toHaveLength(15);
      expect(runner.fetchCalls.every((c) => c.hadSession && c.url.startsWith("https://www.vinted.fr/catalog?"))).toBe(true);
      // Les annonces de la page deviennent des affaires une seule fois (dédoublonnage par référence Vinted).
      expect(found).toBeGreaterThan(0);
      const opps = await svc.db.withOrg(ctx.orgId, (tx) => repos.opportunities.list(tx, {}));
      expect(opps).toHaveLength(found);
      expect(new Set(opps.map((o) => o.observed.externalRef)).size).toBe(opps.length);
      // Journal du worker : jamais de pseudo, de titre ni de session.
      const logged = JSON.stringify(logs);
      expect(logged).not.toContain("SESSION-RADAR-WORKER");
      for (const o of opps) {
        expect(logged).not.toContain(o.title);
        if (o.observed.sellerHandle) expect(logged).not.toContain(o.observed.sellerHandle);
      }
      const metrics = await radar.radarMetrics(ctx);
      expect(metrics).toMatchObject({ status: "measured", liveReads: 15, blocks: 0, blockRatePer1000: 0 });
    } finally {
      await retire(ctx);
      svc.config = {};
    }
  });

  it("erreur après le chargement de la page : la place du plafond de la machine n'est pas rendue, la recherche n'est pas relue au passage suivant", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, searches } = await liveOrg([{ name: "Panne" }]);
    const runner = new FakeRunner({ pageHtml: CATALOG_HTML });
    svc.radar = { reader: readerOn(runner) };
    const limiter = new PageRateLimiter(30);
    const original = repos.orders.all;
    repos.orders.all = async () => { throw new Error("panne"); };
    try {
      const r = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
      expect(r).toMatchObject({ errors: 1, liveReads: 0 });
      expect(limiter.used(clock)).toBe(1);
      expect((await readsOf(ctx, searches[0]!.id)).map((x) => x.outcome)).toEqual(["ok"]);
      advance(30);
      repos.orders.all = original;
      const next = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
      expect(next.liveReads).toBe(0);
      expect(runner.fetchCalls).toHaveLength(1);
    } finally {
      repos.orders.all = original;
      await retire(ctx);
    }
  });

  it("blocage : CAPTCHA → lecture arrêtée, compte Achat en pause, alerte au client, mesure enregistrée, rien n'est relu", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, accountId, searches } = await liveOrg([{ name: "Bloquée" }]);
    await radarAlerts.subscribePush(ctx, { endpoint: ENDPOINT, keys: KEYS });
    const push = new FakePushSender();
    svc.push = push;
    const runner = new FakeRunner({ pageHtml: CATALOG_HTML, fetchScenarios: ["blocked"] });
    svc.radar = { reader: readerOn(runner) };
    const limiter = new PageRateLimiter(30);
    logs.length = 0;
    try {
      const r = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
      expect(r).toMatchObject({ liveReads: 1, blocked: 1, found: 0, circuitUntil: null });
      const account = await svc.db.withOrg(ctx.orgId, (tx) => repos.cloudAccounts.byId(tx, accountId));
      expect(account).toMatchObject({ status: "paused", pausedReason: "captcha" });
      const reads = await readsOf(ctx, searches[0]!.id);
      expect(reads.map((x) => x.outcome)).toEqual(["captcha"]);
      const search = await svc.db.withOrg(ctx.orgId, (tx) => repos.searches.byId(tx, searches[0]!.id));
      expect(search).toMatchObject({ blocksCount: 1, pagesRead: 1, lastBlockAt: T0.toISOString() });
      expect(logs.some((l) => l.level === "warn" && /aucun contournement/.test(l.msg))).toBe(true);
      // Alerte envoyée par le passage « alerts.send ».
      const sent = await alertsTick(svc, capture, { now: new Date(clock) });
      expect(sent).toMatchObject({ pushEnabled: true, sent: 1 });
      expect(push.sent.map((s) => s.payload.title)).toEqual(["Radar en pause : Vinted a demandé une vérification"]);
      expect(push.sent[0]!.payload.url).toBe("/app/cloud");
      // Passages suivants : le compte est en pause, aucune page n'est relue (rien n'est retenté).
      for (let i = 0; i < 4; i++) {
        advance(60);
        const next = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
        expect(next.liveReads).toBe(0);
      }
      expect(runner.fetchCalls).toHaveLength(1);
    } finally {
      await retire(ctx);
      delete svc.push;
    }
  });

  it("blocage : « trop de requêtes » → coupe-circuit de la machine (alerte de l'opérateur), plus aucune lecture en direct", async () => {
    if (!available) return;
    clock = new Date(T0);
    const a = await liveOrg([{ name: "A" }]);
    const b = await liveOrg([{ name: "B" }]);
    const runner = new FakeRunner({ pageHtml: CATALOG_HTML, fetchScenarios: ["rate_limited"] });
    svc.radar = { reader: readerOn(runner) };
    logs.length = 0;
    try {
      const r = await radarTick(svc, capture, { liveEnabled: true, limiter: new PageRateLimiter(30), concurrency: 1, now: () => new Date(clock) });
      expect(r.blocked).toBe(1);
      expect(r.circuitUntil).not.toBeNull();
      expect(r.skipped.machine_paused).toBe(1);
      expect(runner.fetchCalls).toHaveLength(1);
      expect(logs.some((l) => l.level === "error" && /COUPE-CIRCUIT/.test(l.msg))).toBe(true);
      expect(await cloud.machinePausedUntil(svc)).not.toBeNull();
    } finally {
      await cloud.clearCircuit(svc);
      await retire(a.ctx);
      await retire(b.ctx);
    }
  });

  it("plafond de pages par minute : machine (RADAR_MAX_PAGES_PER_MINUTE_GLOBAL) puis organisation (réglage)", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, searches } = await liveOrg([{ name: "P1" }, { name: "P2" }, { name: "P3" }, { name: "P4" }]);
    const runner = new FakeRunner({ pageHtml: CATALOG_HTML });
    svc.radar = { reader: readerOn(runner) };
    const limiter = new PageRateLimiter(2);
    try {
      const first = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
      expect(first).toMatchObject({ liveReads: 2, skipped: { global_pages_per_minute: 2 } });
      advance(30);
      // Toujours dans la même minute : le plafond de la machine est atteint.
      const second = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
      expect(second.liveReads).toBe(0);
      expect(limiter.used(clock)).toBe(2);
      advance(31);
      const third = await radarTick(svc, capture, { liveEnabled: true, limiter, concurrency: 1, now: () => new Date(clock) });
      expect(third.liveReads).toBe(2);
      const counts = await Promise.all(searches.map((s) => readsOf(ctx, s.id).then((x) => x.length)));
      expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
      expect(counts.every((c) => c >= 1)).toBe(true);
      // Plafond de l'organisation : 1 page par minute.
      await radar.updateRadarSettings(ctx, { radar: { maxPagesPerMinute: 1 } });
      advance(120);
      const fourth = await radarTick(svc, capture, { liveEnabled: true, limiter: new PageRateLimiter(30), concurrency: 1, now: () => new Date(clock) });
      expect(fourth.liveReads).toBe(1);
      expect(fourth.skipped.pages_per_minute).toBe(1);
      expect(runner.fetchCalls).toHaveLength(5);
    } finally {
      await retire(ctx);
    }
  });

  it("Cloud désactivé : seules les recherches du simulateur sont lues, rien n'est compté comme mesuré", async () => {
    if (!available) return;
    clock = new Date(T0);
    const { ctx, searches } = await liveOrg([{ name: "En direct" }]);
    const demo = await radar.createSearch(ctx, { name: "Simulateur", criteria: { brands: ["Nike"], maxPriceCents: 4000 } });
    svc.radar = { reader: new CloudOffRadarReader() };
    try {
      const r = await radarTick(svc, capture, { liveEnabled: false, limiter: new PageRateLimiter(30), concurrency: 1, now: () => new Date(clock) });
      expect(r).toMatchObject({ liveReads: 0, demoReads: 1, skipped: { cloud_disabled: 1 } });
      expect(await readsOf(ctx, searches[0]!.id)).toEqual([]);
      expect((await readsOf(ctx, demo.id)).map((x) => x.source)).toEqual(["demo"]);
      expect((await radar.radarMetrics(ctx)).status).toBe("to_measure");
      // Le lecteur de garde ne lance rien.
      expect(await new CloudOffRadarReader().read()).toMatchObject({ ok: false, code: "unavailable", launched: false });
    } finally {
      await retire(ctx);
    }
  });

  /** Navigateur d'achat simulé (interface de @selio/cloud) : aucun achat réel. */
  class StubPurchases {
    readonly buys: Omit<BuyInput, "session">[] = [];
    readonly resumes: string[] = [];
    readonly cancels: string[] = [];
    readonly next: PurchaseResult[] = [];
    readonly resumeNext: PurchaseResult[] = [];
    async buy(input: BuyInput): Promise<PurchaseResult> {
      const { session: _s, ...rest } = input;
      this.buys.push(rest);
      return this.next.shift() ?? { outcome: "dry_run", totalCents: 2620, itemPriceCents: 2000, walletOffered: true, walletSelected: true, durationMs: 5 };
    }
    async resume(token: string): Promise<PurchaseResult> {
      this.resumes.push(token);
      return this.resumeNext.shift() ?? { outcome: "failed", code: "3ds_timeout", message: "Attente introuvable.", sideEffects: "unknown", launched: true, stop: null, durationMs: 0 };
    }
    async cancel(token: string): Promise<boolean> {
      this.cancels.push(token);
      return true;
    }
  }
  const awaiting = (token: string): PurchaseResult => ({ outcome: "awaiting_3ds", resumeToken: token, totalCents: 2620, expiresAt: new Date(clock.getTime() + 600_000).toISOString(), durationMs: 5 });
  const addOpportunity = (ctx: OrgContext, searchId: string, ref: string) => svc.db.withOrg(ctx.orgId, (tx) => repos.opportunities.create(tx, {
    searchId, title: `Pull Ralph Lauren ${ref}`,
    observed: { priceCents: 2000, shippingCents: 450, brand: "Ralph Lauren", size: "M", condition: "very_good", category: "men", sellerHandle: "vendeur_w", sellerRating: 4.8, sellerReviews: 40, photoUrl: null, photoCount: 6, url: `https://www.vinted.fr/items/${ref}-pull`, seenAt: clock.toISOString(), source: "connector", externalRef: ref },
    estimate: { resalePriceCents: 6000, expectedFeesCents: 0, marginCents: 3380, marginRate: 0.56, confidence: "high", method: "brand_category", comparableCount: 3 },
    score: 92, reasons: [], breakdown: [], status: "new",
  }));

  it("Radar Auto : passage seulement si RADAR_AUTO_ENABLED ; 3-D Secure → le client valide, reprise par la file ; annulé → navigateur fermé ; délai CLOUD_3DS_TIMEOUT_MS → abandon avec alerte", async () => {
    if (!available) return;
    clock = new Date(T0);
    svc.config = {};
    const stub = new StubPurchases();
    const adapter = new CloudPurchaseAdapter(stub, capture);
    svc.radar = { purchaser: adapter };
    expect(await radarAutoTick(svc, capture, { now: new Date(clock) })).toMatchObject({ enabled: false, bought: 0 });
    svc.config = radarServicesConfig({ RADAR_AUTO_ENABLED: true, RADAR_AUTO_ORG_IDS: [], RADAR_REAL_PURCHASE: true, CLOUD_3DS_TIMEOUT_MS: 600_000 });
    const { ctx, searches } = await liveOrg([{ name: "Auto" }]);
    try {
      await radar.updateRadarSettings(ctx, { autoBuy: { enabled: true, threshold: 85, maxItemCents: 8000, dailyCapCents: 20_000 } });
      await radarAlerts.subscribePush(ctx, { endpoint: ENDPOINT, keys: KEYS });
      const push = new FakePushSender();
      svc.push = push;
      // 1) Validation 3-D Secure demandée puis validée par le client : reprise par la file « selio-radar ».
      await addOpportunity(ctx, searches[0]!.id, "4242");
      stub.next.push(awaiting("tok-1"));
      expect(await radarAutoTick(svc, capture, { now: new Date(clock) })).toMatchObject({ enabled: true, orgs: 1, awaiting3ds: 1, bought: 0 });
      // Coût décidé (26,20 €) + 1 € : une hausse de prix au paiement au-delà arrête l'achat avant de payer.
      expect(stub.buys[0]).toMatchObject({ dryRun: false, maxTotalCents: 2720, itemUrl: "https://www.vinted.fr/items/4242-pull" });
      expect(adapter.pendingCount).toBe(1);
      const first = (await radar.listPurchases(ctx))[0]!;
      expect(first).toMatchObject({ status: "awaiting_3ds", awaiting3dsUntil: new Date(T0.getTime() + 600_000).toISOString() });
      // Le client est prévenu tout de suite (sans attendre « alerts.send ») ; aucun code n'est saisi à sa place.
      expect(push.sent.map((x) => x.payload)).toEqual([expect.objectContaining({ title: "Validez le paiement dans votre application bancaire", url: `/app/radar/achats/${first.id}` })]);
      advance(90);
      stub.resumeNext.push({ outcome: "purchased", orderRef: "V-42", totalCents: 2620, walletSelected: true, durationMs: 5 });
      expect(await radarResumeTask(svc, { orgId: ctx.orgId, purchaseId: first.id, userId: ctx.userId }, capture)).toEqual({ status: "executed" });
      expect(stub.resumes).toEqual(["tok-1"]);
      expect(adapter.pendingCount).toBe(0);
      expect(await radarResumeTask(svc, { orgId: ctx.orgId, purchaseId: first.id, userId: "inconnu" }, capture)).toEqual({ status: null, error: "not_member" });
      expect(await radarResumeTask(svc, { orgId: ctx.orgId }, capture)).toEqual({ status: null, error: "invalid_job" });

      // 2) En attente, puis annulé par le client : le navigateur tenu ouvert est fermé au passage suivant.
      await addOpportunity(ctx, searches[0]!.id, "4343");
      stub.next.push(awaiting("tok-2"));
      await radarAutoTick(svc, capture, { now: new Date(clock) });
      const second = (await radar.listPurchases(ctx)).find((p) => p.status === "awaiting_3ds")!;
      await radar.cancelPurchase(ctx, second.id);
      const tick = await radarTick(svc, capture, { liveEnabled: false, limiter: new PageRateLimiter(30), concurrency: 1, now: () => new Date(clock), purchases: adapter });
      expect(tick.released3ds).toBe(1);
      expect(stub.cancels).toEqual(["tok-2"]);

      // 3) En attente, jamais validé : délai passé → achat abandonné, affaire en observation, alerte, navigateur fermé.
      const opp3 = await addOpportunity(ctx, searches[0]!.id, "4444");
      stub.next.push(awaiting("tok-3"));
      await radarAutoTick(svc, capture, { now: new Date(clock) });
      const third = (await radar.listPurchases(ctx)).find((p) => p.status === "awaiting_3ds")!;
      expect(third.opportunityId).toBe(opp3.id);
      advance(11 * 60);
      const late = await radarTick(svc, capture, { liveEnabled: false, limiter: new PageRateLimiter(30), concurrency: 1, now: () => new Date(clock), purchases: adapter });
      expect(late).toMatchObject({ expired3ds: 1, released3ds: 1 });
      expect(stub.cancels).toEqual(["tok-2", "tok-3"]);
      expect((await radar.listPurchases(ctx)).find((p) => p.id === third.id)).toMatchObject({ status: "cancelled" });
      expect((await svc.db.withOrg(ctx.orgId, (tx) => repos.opportunities.byId(tx, opp3.id))).status).toBe("watching");
      const alerts = await svc.db.withOrg(ctx.orgId, (tx) => repos.radarAlerts.list(tx));
      expect(alerts.some((a) => a.kind === "payment_3ds" && a.dedupeKey === `payment_3ds_expired:${third.id}`)).toBe(true);
      // 3-D Secure expirée : le paiement a pu partir, Radar Auto est arrêté jusqu'à la vérification du client.
      expect(await radarAutoTick(svc, capture, { now: new Date(clock) })).toMatchObject({ orgs: 0, bought: 0 });
      expect((await radar.autoStatus(ctx)).settings).toMatchObject({ enabled: false, suspendedReason: expect.stringContaining("3-D Secure") });
      // Aucun achat réel n'a été exécuté : tout passe par le navigateur simulé.
      expect(stub.buys).toHaveLength(3);
    } finally {
      await retire(ctx);
      svc.config = {};
      delete svc.push;
    }
  });

  it("releaseSettled : jamais de fermeture d'un navigateur dont la demande est encore « en cours » (draft) ; plafond de pages de la machine partagé avec les achats", async () => {
    if (!available) return;
    clock = new Date(T0);
    const stub = new StubPurchases();
    const limiter = new PageRateLimiter(4);
    const adapter = new CloudPurchaseAdapter(stub, capture, limiter, () => new Date(clock));
    const { ctx, searches, accountId, connectionId } = await liveOrg([{ name: "Brouillon" }]);
    try {
      const opp = await addOpportunity(ctx, searches[0]!.id, "4545");
      const draft = await svc.db.withOrg(ctx.orgId, (tx) => repos.purchases.create(tx, { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: 2720, budgetCents: 5000, status: "draft", mode: "auto" }));
      stub.next.push({ ...awaiting("tok-d"), pages: 3 });
      const input = { orgId: ctx.orgId, purchaseId: draft.id, cloudAccountId: accountId, connectionId, session: vintedState(), itemUrl: "https://www.vinted.fr/items/4545-pull", externalRef: "4545", maxTotalCents: 2720, dryRun: false, paymentMethod: "vinted_wallet" as const };
      expect(await adapter.buy(input)).toMatchObject({ status: "awaiting_3ds", pages: 3 });
      // La base n'a pas encore écrit « awaiting_3ds » (fenêtre entre le navigateur et la transaction) : rien n'est fermé.
      expect(await adapter.releaseSettled(svc)).toBe(0);
      expect(stub.cancels).toEqual([]);
      // Pages de l'achat comptées dans le plafond de la machine ; plafond atteint → aucun achat lancé.
      expect(limiter.used(clock)).toBe(3);
      limiter.record(clock, 1);
      expect(await adapter.buy({ ...input, purchaseId: "autre" })).toMatchObject({ status: "failed", code: "unavailable", launched: false });
      expect(stub.buys).toHaveLength(1);
      // Demande terminée (bloquée) : le navigateur est fermé.
      await svc.db.withOrg(ctx.orgId, (tx) => repos.purchases.update(tx, draft.id, { status: "blocked" }));
      expect(await adapter.releaseSettled(svc)).toBe(1);
      expect(stub.cancels).toEqual(["tok-d"]);
    } finally {
      await retire(ctx);
    }
  });

  it("rétention : mesures de lecture gardées 90 jours, affaires écartées supprimées après 30 jours", async () => {
    if (!available) return;
    // Horloge réelle : les dates de la base (now()) et celles du service coïncident.
    clock = new Date();
    const { ctx, searches } = await liveOrg([{ name: "Rétention" }]);
    try {
      await svc.db.withOrg(ctx.orgId, async (tx) => {
        await repos.radarReads.add(tx, { searchId: searches[0]!.id, connectionId: null, source: "cloud", readAt: new Date(clock.getTime() - 91 * 86_400_000).toISOString(), durationMs: 900, outcome: "ok", itemsSeen: 3, itemsNew: 0, factor: 1 });
        await repos.radarReads.add(tx, { searchId: searches[0]!.id, connectionId: null, source: "cloud", readAt: new Date(clock.getTime() - 2 * 86_400_000).toISOString(), durationMs: 900, outcome: "ok", itemsSeen: 3, itemsNew: 0, factor: 1 });
      });
      const old = await addOpportunity(ctx, searches[0]!.id, "7070");
      await svc.db.withOrg(ctx.orgId, (tx) => tx.query("update opportunities set status = 'dismissed', updated_at = now() - interval '31 days', created_at = now() - interval '31 days' where id = $1", [old.id]));
      const res = await retentionTick(svc, capture);
      expect(res.radar.errors).toBe(0);
      expect(res.radar.reads).toBeGreaterThanOrEqual(1);
      expect(res.radar.deleted).toBeGreaterThanOrEqual(1);
      expect(await readsOf(ctx, searches[0]!.id)).toHaveLength(1);
      expect(await svc.db.withOrg(ctx.orgId, (tx) => repos.opportunities.byId(tx, old.id)).catch(() => null)).toBeNull();
    } finally {
      await retire(ctx);
    }
  });
});

describe("worker : Selio Radar (adaptateurs, plafond, plannings, configuration)", () => {
  const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://127.0.0.1:6379", SECRETS_ENCRYPTION_KEY: "k".repeat(44) };
  const read = (over: Partial<RadarReadResult>): RadarReadResult => ({ outcome: "ok", items: [], seenCount: 0, blocked: null, stop: null, measure: null, pageOk: true, durationMs: 1200, finalUrl: null, status: 200, launched: true, observedAt: "2026-10-29T09:00:00.000Z", message: "", missing: [], warnings: [], adapterVersion: "test", ...over });

  it("lecture : résultats de @selio/cloud traduits pour le cœur (signal → pause, aucun navigateur → rien de compté)", () => {
    const item = { externalRef: "5012345601", url: "https://www.vinted.fr/items/5012345601-veste", title: "Veste en jean", brand: "Levi's", size: "M", condition: "very_good" as const, priceCents: 2500, shippingCents: 399, sellerHandle: "vendeur", sellerRating: 4.5, sellerReviews: 12, photoCount: 4, photoUrl: null, publishedAt: "2026-10-29T08:55:00.000Z", publishedAtSource: "relative" as const, observedAt: "2026-10-29T09:00:00.000Z" };
    expect(toCoreReadOutcome(read({ items: [item] }))).toMatchObject({ ok: true, durationMs: 1200, items: [{ externalRef: "5012345601", category: null, shippingCents: 399, publishedAt: "2026-10-29T08:55:00.000Z" }] });
    expect(toCoreReadOutcome(read({ outcome: "blocked", blocked: { code: "rate_limited", pattern: "status.429", message: "" } }))).toMatchObject({ ok: false, code: "rate_limited", launched: true });
    expect(toCoreReadOutcome(read({ outcome: "blocked", blocked: { code: "captcha", pattern: "x", message: "" }, launched: false }))).toMatchObject({ ok: false, code: "captcha", launched: true });
    expect(toCoreReadOutcome(read({ outcome: "unavailable", launched: false }))).toMatchObject({ ok: false, code: "unavailable", launched: false });
    expect(toCoreReadOutcome(read({ outcome: "page_changed" }))).toMatchObject({ ok: false, code: "selector_missing" });
    expect(toCoreReadOutcome(read({ outcome: "not_logged_in" }))).toMatchObject({ ok: false, code: "not_logged_in" });
  });

  it("achat : résultats de @selio/cloud traduits pour le cœur (après « Payer », effets inconnus : jamais racheté)", () => {
    expect(toCorePurchaseOutcome({ outcome: "dry_run", totalCents: 2620, itemPriceCents: 2000, walletOffered: true, walletSelected: true, durationMs: 1 }, 8000)).toMatchObject({ status: "dry_run", totalCents: 2620 });
    expect(toCorePurchaseOutcome({ outcome: "purchased", orderRef: "V-1", totalCents: null, walletSelected: true, durationMs: 1 }, 8000)).toMatchObject({ status: "purchased", totalCents: 8000, orderRef: "V-1" });
    expect(toCorePurchaseOutcome({ outcome: "price_changed", stage: "checkout", displayedCents: 9000, maxTotalCents: 8000, durationMs: 1 }, 8000)).toMatchObject({ status: "failed", code: "price_changed", sideEffects: "none" });
    expect(toCorePurchaseOutcome({ outcome: "failed", code: "item_unavailable", unavailable: "sold", message: "", sideEffects: "none", launched: true, stop: null, durationMs: 1 }, 8000)).toMatchObject({ status: "unavailable", reason: "sold" });
    expect(toCorePurchaseOutcome({ outcome: "failed", code: "unconfirmed", message: "", sideEffects: "unknown", launched: true, stop: null, durationMs: 1 }, 8000)).toMatchObject({ status: "failed", code: "timeout", sideEffects: "unknown" });
    expect(toCorePurchaseOutcome({ outcome: "failed", code: "payment_failed", message: "", sideEffects: "none", launched: true, stop: null, durationMs: 1 }, 8000)).toMatchObject({ status: "failed", code: "payment_error" });
    expect(toCorePurchaseOutcome({ outcome: "failed", code: "unavailable", message: "", sideEffects: "none", launched: false, stop: null, durationMs: 0 }, 8000)).toMatchObject({ status: "failed", code: "unavailable", launched: false });
    expect(toCorePurchaseOutcome({ outcome: "failed", code: "real_purchase_disabled", message: "", sideEffects: "none", launched: false, stop: null, durationMs: 0 }, 8000)).toMatchObject({ status: "failed", code: "error" });
  });

  it("plafond de pages par minute : fenêtre glissante, place rendue quand rien n'est lu", () => {
    const limiter = new PageRateLimiter(2);
    const t = new Date("2026-10-29T09:00:00.000Z");
    const a = limiter.tryTake(t);
    expect(a).not.toBeNull();
    expect(limiter.tryTake(t)).not.toBeNull();
    expect(limiter.tryTake(t)).toBeNull();
    limiter.release(a!);
    expect(limiter.used(t)).toBe(1);
    expect(limiter.tryTake(new Date(t.getTime() + 1000))).not.toBeNull();
    expect(limiter.tryTake(new Date(t.getTime() + 30_000))).toBeNull();
    expect(limiter.tryTake(new Date(t.getTime() + 60_001))).not.toBeNull();
  });

  it("un seul passage à la fois : le planning suivant ne relance pas un passage en cours ; arrêt", async () => {
    let release: () => void = () => {};
    let runs = 0;
    const flight = new SingleFlight("radar.tick", () => { runs++; return new Promise<number>((r) => { release = () => r(runs); }); }, silent);
    expect(flight.trigger()).toEqual({ started: true });
    expect(flight.trigger()).toEqual({ started: false });
    release();
    await flight.drain(1000);
    expect(flight.trigger()).toEqual({ started: true });
    release();
    await flight.drain(1000);
    flight.stop();
    expect(flight.trigger()).toEqual({ started: false });
    expect(runs).toBe(2);
  });

  it("configuration : radar.tick toutes les 30 s, alertes chaque minute, Radar Auto et achat réel fermés par défaut", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ RADAR_TICK_EVERY_MS: 30_000, CRON_ALERTS: "* * * * *", RADAR_AUTO_ENABLED: false, RADAR_REAL_PURCHASE: false, RADAR_MAX_PAGES_PER_MINUTE_GLOBAL: 30, CLOUD_3DS_TIMEOUT_MS: 600_000, RADAR_PAGE_BUDGET_MS: 30_000, RADAR_PURCHASE_TIMEOUT_MS: 90_000 });
    expect(radarServicesConfig(env)).toEqual({ radarAutoEnabled: false, radarAutoOrgIds: undefined, radarRealPurchase: false, radar3dsTimeoutMs: 600_000 });
    const schedules = maintenanceSchedules(env);
    expect(schedules.find((s) => s.name === "radar.tick")).toEqual({ name: "radar.tick", every: 30_000 });
    expect(schedules.find((s) => s.name === "alerts.send")).toEqual({ name: "alerts.send", pattern: "* * * * *" });
    expect(schedules.some((s) => s.name === "radar.auto")).toBe(false);
    expect(disabledSchedules(env)).toEqual(["radar.auto"]);
    // Le balayage des dossiers de travail n'emporte jamais un navigateur d'achat qui attend la banque.
    expect(cloudProfileMaxAgeMs(env)).toBeGreaterThan(env.RADAR_PURCHASE_TIMEOUT_MS + env.CLOUD_3DS_TIMEOUT_MS);
    expect(cloudProfileMaxAgeMs(loadEnv({ ...base, CLOUD_3DS_TIMEOUT_MS: "1800000" }))).toBeGreaterThan(30 * 60_000);
    const on = loadEnv({ ...base, RADAR_AUTO_ENABLED: "true", RADAR_AUTO_ORG_IDS: "org-1,org-2" });
    expect(maintenanceSchedules(on).find((s) => s.name === "radar.auto")).toEqual({ name: "radar.auto", every: 30_000 });
    expect(disabledSchedules(on)).toEqual([]);
    expect(radarServicesConfig(on)).toMatchObject({ radarAutoEnabled: true, radarAutoOrgIds: ["org-1", "org-2"] });
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AI_PROVIDER: "ollama", RADAR_AUTO_ENABLED: "true" })).toThrow(/RADAR_AUTO_ORG_IDS/);
    expect(() => loadEnv({ ...base, CLOUD_3DS_TIMEOUT_MS: "5000" })).toThrow(/CLOUD_3DS_TIMEOUT_MS/);
    expect(() => loadEnv({ ...base, VAPID_PUBLIC_KEY: "abc" })).toThrow(/VAPID/);
  });
});
