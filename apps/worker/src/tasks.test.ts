import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, SecretBox, createPool, runMigrations, MIGRATIONS_DIR, repos, hashPassword } from "@selio/db";
import { createAIService } from "@selio/ai";
import { PaymentApiError, type PaymentOrderInfo, type PaymentProvider, type PaymentState, type SavedPaymentMethod } from "@selio/connectors";
import { quotasForPlan } from "@selio/contracts";
import { billing, type Services } from "@selio/core";
import { NoopEmailProvider } from "@selio/email";
import { automationTick, processJobs, renewSubscriptions, retentionTick, systemContext } from "./tasks";
import { messaging } from "@selio/core";

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
