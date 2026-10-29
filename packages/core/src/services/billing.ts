import {
  CARD_ONLY_ORDER_KINDS, CARD_VERIFICATION_AMOUNT_CENTS, DATA_RETENTION_DAYS_AFTER_END, DEFAULT_VAT_RATE, PAID_PLANS, PLAN_LABELS, VAT_FRANCHISE_NOTICE, buildUsageCounter, invoiceAmounts, nextChargeDelayDays, quotasForPlan,
  type BillingCycle, type CheckoutResult, type Invoice, type InvoiceView, type PaidPlan, type PaymentOrder, type Plan, type PlanQuotas, type Subscription, type SubsidiaryUsage, type UsageCounter,
} from "@selio/contracts";
import { PRICING } from "@selio/demo-data";
import { repos } from "@selio/db";
import { effectiveAiQuota } from "@selio/domain";
import { alertEmail, paymentFailedEmail } from "@selio/email";
import { PaymentApiError, type PaymentState, type PaymentWebhookEvent, type SavedPaymentMethod, type WebhookHeaders } from "@selio/connectors";
import { AppError, requireAction, sendEmail, webLink, withOrg, type OrgContext, type Services } from "../context";
import type { UsageSummary } from "../types-data";

export { USAGE_WARNING_RATE, buildUsageCounter, usagePercent } from "@selio/contracts";

/**
 * Utilisation du mois : compteurs historiques, compteurs généraux avec alerte à 80 %
 * (`counters`) et un bloc par filiale (Studio, Track, Cloud). `period` repart du 1er du
 * mois (UTC) ; la date anniversaire reste une décision à prendre (docs §7).
 *
 * `aiRequests` et `counters.aiRequests` suivent la règle du refus (`messaging.suggestReply`,
 * `studio.generateListing`) : requêtes du mois de la table ai_requests (échecs compris, questions
 * d'aide exclues) face au plus petit entre le quota du plan et le réglage de l'organisation
 * (`settings.ai.monthlyRequestQuota`, 500 par défaut). Sinon la page affichait « 500 / 1 500,
 * 33 % » pendant que la 501e requête était refusée, sans jamais passer l'alerte à 80 %.
 */
export interface UsageReport extends UsageSummary, SubsidiaryUsage {
  counters: { aiRequests: UsageCounter; items: UsageCounter; connections: UsageCounter; members: UsageCounter };
  /** Au moins un compteur à 80 % ou plus. */
  warning: boolean;
}

/** Début du mois civil courant (UTC) : remise à zéro de tous les compteurs mensuels. */
export function usagePeriodStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Début du jour courant (UTC) : les plafonds « par jour » (actions Cloud) repartent de là. */
export function usageDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Compteurs par filiale (fonction pure) : totaux du mois par type d'événement, quotas du plan,
 * et actions Cloud du jour (rapportées au plafond journalier d'automatisations du plan).
 * Les filtres Track suivis n'ont pas encore de stockage : 0 utilisé, quota du plan affiché.
 */
export function subsidiaryUsageFrom(sums: Record<string, number>, quotas: PlanQuotas, cloudActionsToday = 0): SubsidiaryUsage {
  const n = (kind: string) => sums[kind] ?? 0;
  return {
    studio: { listings: buildUsageCounter(n("studio.listing"), quotas.studioListingsPerMonth), wornPhotos: buildUsageCounter(n("studio.worn_photo"), quotas.wornPhotosPerMonth) },
    track: { scans: buildUsageCounter(n("track.scan"), quotas.trackScansPerMonth), photoSearches: buildUsageCounter(n("track.photo_search"), quotas.trackPhotoSearchesPerMonth), filtersFollowed: buildUsageCounter(0, quotas.trackFiltersFollowed) },
    cloud: { actions: buildUsageCounter(cloudActionsToday, quotas.automationActionsPerDay), included: quotas.cloudIncluded },
  };
}

export function getSubscription(ctx: OrgContext): Promise<Subscription> {
  return withOrg(ctx, async (tx) => (await repos.subscriptions.get(tx)) ?? repos.subscriptions.upsert(tx, { plan: "free", status: "none", provider: "none", quotas: quotasForPlan("free"), testMode: true }));
}

export function getUsage(ctx: OrgContext): Promise<UsageReport> {
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const from = usagePeriodStart(now);
    const sums = await repos.usage.sumSince(tx, from);
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
    // Même décompte et même limite que le refus avant chaque requête IA.
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const aiRequests = await repos.aiRequests.countSince(tx, from);
    const aiQuota = effectiveAiQuota(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota);
    const itemsCount = await repos.items.countActive(tx);
    const connectionsCount = await repos.connections.count(tx);
    const membersCount = await ctx.services.db.withGlobal((g) => repos.memberships.countOrg(g, ctx.orgId));
    const counters = { aiRequests: buildUsageCounter(aiRequests, aiQuota), items: buildUsageCounter(itemsCount, quotas.items), connections: buildUsageCounter(connectionsCount, quotas.connections), members: buildUsageCounter(membersCount, quotas.members) };
    const subsidiaries = subsidiaryUsageFrom(sums, quotas, await repos.usage.sumKindSince(tx, "cloud.action", usageDayStart(now)));
    const warning = [...Object.values(counters), subsidiaries.studio.listings, subsidiaries.studio.wornPhotos, subsidiaries.track.scans, subsidiaries.track.photoSearches, subsidiaries.cloud.actions].some((c) => c.warning);
    return {
      period: { from, to: now.toISOString() },
      aiRequests,
      automationActions: sums["automation.action"] ?? 0,
      connectorSyncs: sums["connector.sync"] ?? 0,
      exports: sums["export.csv"] ?? 0,
      extensionCaptures: sums["extension.capture"] ?? 0,
      quotas,
      itemsCount,
      connectionsCount,
      membersCount,
      counters,
      ...subsidiaries,
      warning,
    };
  });
}

export const listUsageEvents = (ctx: OrgContext, limit: number) => withOrg(ctx, (tx) => repos.usage.list(tx, Math.min(200, Math.max(1, limit))));

// ---------------------------------------------------------------- tarifs, dates, libellés

const isPaidPlan = (plan: unknown): plan is PaidPlan => typeof plan === "string" && (PAID_PLANS as readonly string[]).includes(plan);

/** Montant TTC d'une échéance (centimes) : mensuel = PRICING, annuel = 10 mois payés sur 12. */
export function planPriceCents(plan: PaidPlan, cycle: BillingCycle): number {
  const monthly = PRICING.monthlyCents[plan];
  return cycle === "yearly" ? monthly * PRICING.annualMonthsCharged : monthly;
}

/** Ajoute des mois en UTC en gardant le jour quand il existe (31 janvier + 1 mois = 28 ou 29 février). */
export function addMonthsUtc(from: Date, months: number): Date {
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), daysInTarget));
  return target;
}

/** Fin de la période suivante : +1 mois ou +1 an. */
export function addCycle(from: Date, cycle: BillingCycle): Date {
  return addMonthsUtc(from, cycle === "yearly" ? 12 : 1);
}

/** Date de la prochaine tentative après `failures` débits échoués sur une échéance ; null quand les relances sont épuisées. */
export function nextChargeDate(periodEnd: Date, failures: number): Date | null {
  const delay = nextChargeDelayDays(failures);
  return delay === null ? null : new Date(periodEnd.getTime() + delay * 86_400_000);
}

export const cycleLabel = (cycle: BillingCycle): string => (cycle === "yearly" ? "annuel" : "mensuel");
export const formatEuros = (cents: number): string => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
export const formatDateFr = (d: Date): string => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(d);

const PAYMENT_UNCONFIGURED_MESSAGE = "Le paiement n'est pas configuré sur ce serveur (REVOLUT_SECRET_KEY absente). Aucun abonnement n'a été créé.";
const RETRYING_STATES: readonly PaymentState[] = ["pending", "processing", "authorised"];
/**
 * Au-delà, une commande de renouvellement restée « en traitement » chez le fournisseur est annulée
 * puis comptée comme un échec. Marge sous 24 h : avec la tâche horaire, le passage suivant la
 * retrouve sans perdre un jour de plus.
 */
const OPEN_ORDER_MAX_AGE_MS = 20 * 3_600_000;

function vatFor(services: Services): { vatRate: number; vatNotice: string | null } {
  return services.billing?.franchiseTva ? { vatRate: 0, vatNotice: VAT_FRANCHISE_NOTICE } : { vatRate: DEFAULT_VAT_RATE, vatNotice: null };
}

function requirePayments(services: Services) {
  if (!services.payments) throw new AppError("payments_unconfigured", PAYMENT_UNCONFIGURED_MESSAGE, 409);
  return services.payments;
}

async function loadSubscription(services: Services, orgId: string): Promise<Subscription> {
  return services.db.withOrg(orgId, async (tx) => (await repos.subscriptions.get(tx)) ?? repos.subscriptions.upsert(tx, { plan: "free", status: "none", provider: "none", quotas: quotasForPlan("free"), testMode: true }));
}

/** Adresses des propriétaires de l'organisation (destinataires des emails de facturation). */
async function ownerEmails(services: Services, orgId: string): Promise<string[]> {
  const members = await services.db.withGlobal((tx) => repos.memberships.listOrg(tx, orgId));
  const owners = members.filter((m) => m.role === "owner").map((m) => m.user.email);
  return owners.length ? owners : members.slice(0, 1).map((m) => m.user.email);
}

const isCardOnly = (kind: PaymentOrder["kind"]): boolean => CARD_ONLY_ORDER_KINDS.includes(kind);
/** Panne passagère du fournisseur (réseau, 5xx, 429) : à retenter, jamais à interpréter comme « aucune carte ». */
const isTransient = (err: unknown): boolean => err instanceof PaymentApiError && err.retryable;

/** Client Revolut de l'organisation, créé au premier formulaire. */
async function ensureCustomer(ctx: OrgContext, sub: Subscription): Promise<{ customerId: string; email: string; displayName: string }> {
  const payments = requirePayments(ctx.services);
  const user = await ctx.services.db.withGlobal((g) => repos.users.byId(g, ctx.userId));
  let customerId = sub.revolutCustomerId;
  if (!customerId) {
    customerId = (await payments.createCustomer({ email: user.email, fullName: user.displayName })).customerId;
    await withOrg(ctx, (tx) => repos.subscriptions.upsert(tx, { revolutCustomerId: customerId }));
  }
  return { customerId, email: user.email, displayName: user.displayName };
}

// ---------------------------------------------------------------- démarrage du paiement

/**
 * Démarre un paiement depuis l'application : crée le client Revolut au besoin, puis une commande.
 * Pendant l'essai, la commande est en capture manuelle d'un montant de vérification (1 €, jamais le
 * prix de l'offre) : le formulaire enregistre la carte « pour le marchand », l'autorisation est
 * annulée dès que la carte est enregistrée (webhook ORDER_AUTHORISED) ; rien n'est débité avant la
 * fin de l'essai. Hors essai, capture automatique du prix de l'offre : le paiement ouvre la période
 * immédiatement. Une période déjà payée n'est jamais écrasée : changement d'offre ou de carte à la
 * place (409). Sans configuration, aucune commande n'est créée et le message le dit.
 */
export async function startCheckout(ctx: OrgContext, plan: Plan | string, opts: { cycle?: BillingCycle } = {}): Promise<CheckoutResult> {
  requireAction(ctx, "billing.manage");
  if (!isPaidPlan(plan)) throw new AppError("validation", "Plan invalide : choisissez Starter, Pro ou Agence.", 400);
  const cycle: BillingCycle = opts.cycle === "yearly" ? "yearly" : "monthly";
  const planAmountCents = planPriceCents(plan, cycle);
  const payments = ctx.services.payments;
  if (!payments) {
    await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.checkout_unavailable", targetType: "subscription", meta: { plan, cycle }, ip: ctx.ip }));
    return { orderToken: null, orderId: null, mode: null, amountCents: planAmountCents, captureMode: null, simulated: false, message: PAYMENT_UNCONFIGURED_MESSAGE };
  }
  const now = ctx.services.now();
  const sub = await getSubscription(ctx);
  const inTrial = sub.status === "trialing" && !!sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now;
  // Carte déjà enregistrée et abonnement en cours : un changement d'offre suffit, pas de nouveau formulaire.
  if (sub.cardOnFile && sub.paymentMethodId && sub.provider === "revolut" && (sub.status === "active" || sub.status === "past_due" || inTrial)) {
    await changePlan(ctx, plan);
    return { orderToken: null, orderId: null, mode: payments.testMode ? "sandbox" : "live", amountCents: planAmountCents, captureMode: null, simulated: false, message: inTrial ? `Offre ${PLAN_LABELS[plan]} retenue : elle sera débitée à la fin de l'essai avec la carte enregistrée.` : `Changement d'offre enregistré : ${PLAN_LABELS[plan]} s'appliquera au prochain renouvellement.` };
  }
  // Période déjà payée : un paiement à capture automatique maintenant écraserait les jours restants (payés deux fois).
  if (sub.status === "active" && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now) {
    throw new AppError("conflict", `Votre offre ${PLAN_LABELS[sub.plan]} est déjà payée jusqu'au ${formatDateFr(new Date(sub.currentPeriodEnd))} : changez d'offre (appliqué au prochain renouvellement) ou mettez votre carte à jour, sans nouveau paiement.`, 409);
  }
  const { customerId, email } = await ensureCustomer(ctx, sub);
  const captureMode = inTrial ? "manual" : "automatic";
  const kind: PaymentOrder["kind"] = inTrial ? "trial_authorisation" : "checkout";
  const amountCents = inTrial ? CARD_VERIFICATION_AMOUNT_CENTS : planAmountCents;
  const description = inTrial
    ? `Selio ${PLAN_LABELS[plan]} — vérification de la carte pendant l'essai (${formatEuros(amountCents)} autorisé puis annulé, aucun débit avant la fin de l'essai)`
    : `Selio ${PLAN_LABELS[plan]} — abonnement ${cycleLabel(cycle)}`;
  const order = await payments.createCheckoutOrder({ orgId: ctx.orgId, plan, amountCents, currency: "EUR", customerId, customerEmail: email, captureMode, description, metadata: { kind, cycle, planAmountCents: String(planAmountCents) }, merchantOrderRef: ctx.orgId });
  await withOrg(ctx, async (tx) => {
    await repos.paymentOrders.create(tx, { orderId: order.orderId, kind, plan, cycle, amountCents, captureMode, createdAt: now.toISOString() });
    await repos.subscriptions.upsert(tx, { revolutCustomerId: order.customerId ?? customerId, pendingPlan: plan, cycle, testMode: payments.testMode });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.checkout_started", targetType: "subscription", meta: { plan, cycle, captureMode, kind, amountCents, planAmountCents, testMode: payments.testMode }, ip: ctx.ip });
  });
  const sandbox = payments.testMode ? " (bac à sable Revolut)" : "";
  return {
    orderToken: order.token,
    orderId: order.orderId,
    mode: payments.testMode ? "sandbox" : "live",
    amountCents,
    captureMode,
    simulated: false,
    message: inTrial
      ? `Carte à enregistrer pour l'offre ${PLAN_LABELS[plan]} : une autorisation de ${formatEuros(amountCents)} vérifie la carte puis est annulée aussitôt. Rien n'est débité avant la fin de l'essai (${formatEuros(planAmountCents)} ${cycleLabel(cycle)} ensuite).${sandbox}`
      : `Paiement de ${formatEuros(amountCents)} (${PLAN_LABELS[plan]}, ${cycleLabel(cycle)}).${sandbox}`,
  };
}

/**
 * Changement de carte sans paiement (abonnement en cours : essai, actif ou en retard) : commande de
 * vérification en capture manuelle (1 €), carte enregistrée « pour le marchand » par le formulaire,
 * autorisation annulée au webhook ORDER_AUTHORISED. En retard de paiement, le débit en attente est
 * retenté dans l'heure avec la nouvelle carte.
 */
export async function startCardUpdate(ctx: OrgContext): Promise<CheckoutResult> {
  requireAction(ctx, "billing.manage");
  const amountCents = CARD_VERIFICATION_AMOUNT_CENTS;
  const payments = ctx.services.payments;
  if (!payments) {
    await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.card_update_unavailable", targetType: "subscription", meta: {}, ip: ctx.ip }));
    return { orderToken: null, orderId: null, mode: null, amountCents, captureMode: null, simulated: false, message: PAYMENT_UNCONFIGURED_MESSAGE };
  }
  const sub = await getSubscription(ctx);
  if (sub.status !== "trialing" && sub.status !== "active" && sub.status !== "past_due") throw new AppError("conflict", "Aucun abonnement en cours : choisissez une offre, le paiement enregistre la carte.", 409);
  const { customerId, email } = await ensureCustomer(ctx, sub);
  const plan: Plan = isPaidPlan(sub.pendingPlan) ? sub.pendingPlan : sub.plan;
  const order = await payments.createCheckoutOrder({ orgId: ctx.orgId, plan, amountCents, currency: "EUR", customerId, customerEmail: email, captureMode: "manual", description: `Selio — changement de carte (${formatEuros(amountCents)} autorisé puis annulé, aucun débit)`, metadata: { kind: "card_update", cycle: sub.cycle }, merchantOrderRef: ctx.orgId });
  await withOrg(ctx, async (tx) => {
    await repos.paymentOrders.create(tx, { orderId: order.orderId, kind: "card_update", plan, cycle: sub.cycle, amountCents, captureMode: "manual", createdAt: ctx.services.now().toISOString() });
    await repos.subscriptions.upsert(tx, { revolutCustomerId: order.customerId ?? customerId, testMode: payments.testMode });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.card_update_started", targetType: "subscription", meta: { status: sub.status, amountCents, testMode: payments.testMode }, ip: ctx.ip });
  });
  return {
    orderToken: order.token,
    orderId: order.orderId,
    mode: payments.testMode ? "sandbox" : "live",
    amountCents,
    captureMode: "manual",
    simulated: false,
    message: `Nouvelle carte : une autorisation de ${formatEuros(amountCents)} la vérifie puis est annulée aussitôt, rien n'est débité.${sub.status === "past_due" ? " Le paiement en retard sera retenté dans l'heure avec cette carte." : ""}${payments.testMode ? " (bac à sable Revolut)" : ""}`,
  };
}

// ---------------------------------------------------------------- webhooks

export interface WebhookOutcome {
  handled: boolean;
  duplicate: boolean;
  /** Commande inconnue de Selio : accusé de réception sans effet. */
  ignored?: boolean;
  event?: PaymentWebhookEvent;
  orderId?: string;
}

/**
 * Webhook Revolut : signature vérifiée (corps brut), réservation atomique de l'événement par
 * (fournisseur, commande, événement) dans payment_events (deux livraisons simultanées n'en traitent
 * qu'une), puis application à l'abonnement de l'organisation retrouvée par l'identifiant de
 * commande. Un traitement en échec relâche la réservation et répond 5xx : Revolut relivre.
 */
export async function handleRevolutWebhook(services: Services, rawBody: string, headers: WebhookHeaders): Promise<WebhookOutcome> {
  const payments = requirePayments(services);
  const verified = payments.verifyWebhook(rawBody, headers, services.now());
  if (!verified.ok) throw new AppError("unauthorized", `Webhook refusé : ${verified.reason}`, 400);
  const { event, orderId } = verified;
  const eventId = repos.paymentEvents.eventId(payments.name, orderId, event);
  const fresh = await services.db.withGlobal((tx) => repos.paymentEvents.record(tx, { id: eventId, provider: payments.name, type: event, orderId, payload: { event, orderId, merchantOrderRef: verified.merchantOrderRef } }));
  if (!fresh) return { handled: false, duplicate: true, event, orderId };
  const found = await services.db.withGlobal((tx) => repos.paymentOrders.findGlobal(tx, orderId));
  if (!found) {
    await services.db.withGlobal((tx) => repos.paymentEvents.markProcessed(tx, eventId));
    return { handled: false, duplicate: false, ignored: true, event, orderId };
  }
  try {
    await applyOrderEvent(services, found.orgId, orderId, event);
  } catch (err) {
    await services.db.withGlobal((tx) => repos.paymentEvents.release(tx, eventId)).catch(() => {});
    if (err instanceof PaymentApiError) throw new AppError("payment_provider_unavailable", `Fournisseur de paiement indisponible pendant le traitement du webhook (${err.code}) : livraison à rejouer.`, 503);
    throw err;
  }
  await services.db.withGlobal((tx) => repos.paymentEvents.markProcessed(tx, eventId));
  return { handled: true, duplicate: false, event, orderId };
}

async function applyOrderEvent(services: Services, orgId: string, orderId: string, event: PaymentWebhookEvent): Promise<void> {
  const po = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.byOrderId(tx, orderId));
  if (!po) return;
  switch (event) {
    case "ORDER_AUTHORISED":
      if (isCardOnly(po.kind)) await confirmCardAuthorisation(services, orgId, po);
      else if (po.state === "pending") await services.db.withOrg(orgId, (tx) => repos.paymentOrders.update(tx, po.id, { state: "authorised" }));
      return;
    case "ORDER_COMPLETED":
      if (isCardOnly(po.kind)) await settleUnexpectedCapture(services, orgId, po);
      else await completePaidOrder(services, orgId, po);
      return;
    case "ORDER_PAYMENT_DECLINED":
      await failOrder(services, orgId, po, "Paiement refusé par la banque");
      return;
    case "ORDER_PAYMENT_FAILED":
      await failOrder(services, orgId, po, "Le paiement n'a pas abouti");
      return;
    case "ORDER_CANCELLED":
      await services.db.withOrg(orgId, (tx) => repos.paymentOrders.cancel(tx, po.id));
      return;
  }
}

// ---------------------------------------------------------------- moyens de paiement enregistrés

/** Moyens « pour le marchand » du client ; une panne passagère est relevée, une erreur définitive (client inconnu) vaut « aucun ». */
async function listMerchantMethods(services: Services, customerId: string): Promise<SavedPaymentMethod[]> {
  try {
    return await requirePayments(services).listMerchantPaymentMethods(customerId);
  } catch (err) {
    if (isTransient(err)) throw err;
    return [];
  }
}

/** La carte la plus récente (date d'enregistrement quand le fournisseur la donne, sinon la dernière de la liste), cartes avant les autres moyens. */
export function mostRecentMethod(methods: SavedPaymentMethod[]): SavedPaymentMethod | null {
  if (methods.length === 0) return null;
  const pool = methods.some((m) => m.type === "card") ? methods.filter((m) => m.type === "card") : methods;
  const dated = pool.filter((m) => m.createdAt !== null);
  if (dated.length === 0) return pool[pool.length - 1] ?? null;
  return dated.reduce((best, m) => (m.createdAt! > best.createdAt! ? m : best));
}

/**
 * Carte à retenir après un formulaire : celle de la tentative aboutie de la commande (lue chez le
 * fournisseur), à condition qu'elle figure parmi les moyens « pour le marchand » du client ; sinon
 * le moyen « pour le marchand » le plus récent. Une panne passagère est relevée (le webhook répond
 * 5xx et Revolut relivre) plutôt que conclure à tort « aucune carte » et perdre la carte.
 */
async function resolvePaymentMethod(services: Services, customerId: string | null, orderId: string | null): Promise<SavedPaymentMethod | null> {
  if (!customerId || !services.payments) return null;
  const methods = await listMerchantMethods(services, customerId);
  if (methods.length === 0) return null;
  if (methods.length === 1 || !orderId) return mostRecentMethod(methods);
  let usedId: string | null = null;
  try {
    usedId = (await services.payments.getOrder(orderId)).paymentMethodId;
  } catch (err) {
    if (isTransient(err)) throw err;
  }
  return methods.find((m) => m.id === usedId) ?? mostRecentMethod(methods);
}

const methodMeta = (m: SavedPaymentMethod | null) => (m ? { type: m.type, brand: m.brand, last4: m.last4 } : null);

/**
 * Carte enregistrée par une commande de vérification (essai ou changement de carte) : l'autorisation
 * vient de passer. On retient le moyen utilisable à l'initiative du marchand, on annule l'autorisation
 * (rien n'est débité) et l'abonnement passe en « carte enregistrée » : pendant l'essai, l'offre
 * choisie attend la fin de l'essai ; en retard de paiement, le débit est retenté dans l'heure.
 * Une commande « failed » (première carte refusée dans le même formulaire) est acceptée : Revolut
 * autorise plusieurs tentatives sur une commande ; seules « completed » et « cancelled » sont closes.
 * Si l'annulation échoue, la commande reste « authorised » et le worker la réannule à chaque passage.
 */
async function confirmCardAuthorisation(services: Services, orgId: string, po: PaymentOrder): Promise<void> {
  if (po.state === "completed" || po.state === "cancelled") return;
  const payments = requirePayments(services);
  const now = services.now();
  const sub = await loadSubscription(services, orgId);
  const method = await resolvePaymentMethod(services, sub.revolutCustomerId, po.orderId);
  let cancelled = false;
  try {
    await payments.cancelOrder(po.orderId);
    cancelled = true;
  } catch {
    // L'autorisation reste posée : releaseStaleAuthorisations (worker) la réannule jusqu'à la levée.
  }
  const paymentMethodId = method?.id ?? sub.paymentMethodId;
  await services.db.withOrg(orgId, async (tx) => {
    await repos.paymentOrders.update(tx, po.id, { state: cancelled ? "cancelled" : "authorised", error: null });
    const patch: Partial<Subscription> = { provider: "revolut", cardOnFile: paymentMethodId !== null, paymentMethodId, testMode: payments.testMode };
    if (po.kind === "trial_authorisation") Object.assign(patch, { pendingPlan: po.plan, cycle: po.cycle, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null });
    else if (method && sub.status === "past_due") patch.nextChargeAt = now.toISOString();
    await repos.subscriptions.upsert(tx, patch);
    await repos.audit.add(tx, { actorUserId: null, action: method ? "billing.card_saved" : "billing.card_not_saved", targetType: "subscription", meta: { kind: po.kind, plan: po.plan, cycle: po.cycle, orderId: po.orderId, method: methodMeta(method), authorisationCancelled: cancelled, retryWithinHour: po.kind === "card_update" && !!method && sub.status === "past_due" } });
  });
}

/**
 * Capture inattendue d'une commande de vérification (clic « Capture » dans Revolut Business, moyen de
 * paiement qui ignore la capture manuelle) : le montant de vérification a été encaissé. Ce n'est pas
 * un paiement d'abonnement : aucune activation, aucune facture, aucun jour d'essai perdu. La carte
 * est retenue comme après une autorisation ; l'encaissement est journalisé pour remboursement manuel
 * depuis Revolut Business.
 */
async function settleUnexpectedCapture(services: Services, orgId: string, po: PaymentOrder): Promise<void> {
  const sub = await loadSubscription(services, orgId);
  const method = await resolvePaymentMethod(services, sub.revolutCustomerId, po.orderId);
  const paymentMethodId = method?.id ?? sub.paymentMethodId;
  await services.db.withOrg(orgId, async (tx) => {
    const closed = await repos.paymentOrders.complete(tx, po.id);
    if (!closed) return;
    const patch: Partial<Subscription> = { provider: "revolut", cardOnFile: paymentMethodId !== null, paymentMethodId };
    if (po.kind === "trial_authorisation") Object.assign(patch, { pendingPlan: po.plan, cycle: po.cycle });
    await repos.subscriptions.upsert(tx, patch);
    await repos.audit.add(tx, { actorUserId: null, action: "billing.unexpected_capture", targetType: "subscription", meta: { kind: po.kind, orderId: po.orderId, amountCents: po.amountCents, method: methodMeta(method), toRefund: true } });
  });
}

/**
 * Paiement encaissé (formulaire hors essai, renouvellement ou relance) : la commande est close,
 * l'abonnement devient actif sur l'offre payée, la période est prolongée d'un mois ou d'un an
 * à partir de l'échéance (renouvellement, retard de paiement) ou de maintenant (premier paiement),
 * sans jamais raccourcir une période déjà payée ; une facture numérotée est émise.
 * Idempotent et atomique : la clôture est un UPDATE conditionnel dans la transaction (worker et
 * webhook ORDER_COMPLETED concurrents : une seule facture) ; une commande déjà close ne produit rien.
 * Formulaire : la carte utilisée devient celle des renouvellements (remplace une carte expirée après
 * un retour à l'accès de base).
 */
export async function completePaidOrder(services: Services, orgId: string, po: PaymentOrder): Promise<{ invoice: Invoice | null; subscription: Subscription }> {
  const now = services.now();
  const before = await loadSubscription(services, orgId);
  if (po.state === "completed") return { invoice: null, subscription: before };
  const plan = isPaidPlan(po.plan) ? po.plan : null;
  if (!plan) throw new AppError("conflict", "Commande de paiement sans offre payante.", 409);
  const method = po.kind === "checkout" ? await resolvePaymentMethod(services, before.revolutCustomerId, po.orderId) : null;
  const { vatRate, vatNotice } = vatFor(services);
  return services.db.withOrg(orgId, async (tx) => {
    const closed = await repos.paymentOrders.complete(tx, po.id);
    if (!closed) return { invoice: null, subscription: (await repos.subscriptions.get(tx)) ?? before };
    const sub = (await repos.subscriptions.get(tx)) ?? before;
    const previousEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    const paidUntil = previousEnd && previousEnd > now && (sub.status === "active" || sub.status === "past_due") ? previousEnd : null;
    const start = po.kind === "renewal" || sub.status === "past_due" ? (previousEnd ?? now) : (paidUntil ?? now);
    const end = addCycle(start, po.cycle);
    const paymentMethodId = method?.id ?? sub.paymentMethodId ?? null;
    const invoice = await repos.invoices.create(tx, { plan, cycle: po.cycle, amountCents: po.amountCents, vatRate, vatNotice, periodStart: start.toISOString(), periodEnd: end.toISOString(), orderId: po.orderId, issuedAt: now.toISOString() });
    const subscription = await repos.subscriptions.upsert(tx, {
      plan,
      quotas: quotasForPlan(plan),
      status: "active",
      provider: "revolut",
      currentPeriodEnd: end.toISOString(),
      cycle: po.cycle,
      pendingPlan: null,
      cardOnFile: paymentMethodId !== null,
      paymentMethodId,
      chargeAttempts: 0,
      nextChargeAt: null,
      lastChargeError: null,
      dataRetentionUntil: null,
      testMode: services.payments?.testMode ?? sub.testMode,
    });
    await repos.audit.add(tx, { actorUserId: null, action: "billing.payment_completed", targetType: "invoice", targetId: invoice.id, meta: { plan, cycle: po.cycle, amountCents: po.amountCents, orderId: po.orderId, kind: po.kind, invoiceNumber: invoice.number, periodStart: start.toISOString(), periodEnd: end.toISOString(), extendedPaidPeriod: paidUntil !== null, lateCompletion: po.state === "failed", method: methodMeta(method) } });
    return { invoice, subscription };
  });
}

/**
 * Paiement refusé ou échoué : la commande passe « failed » si elle était encore ouverte (transition
 * conditionnelle : un renouvellement ne compte qu'un seul débit échoué, même si le worker et le
 * webhook le constatent en même temps). Retourne vrai si c'est cette fois-ci que l'échec est acté.
 */
async function failOrder(services: Services, orgId: string, po: PaymentOrder, reason: string): Promise<boolean> {
  const failed = await services.db.withOrg(orgId, async (tx) => {
    const row = await repos.paymentOrders.fail(tx, po.id, reason);
    if (row && po.kind !== "renewal") await repos.audit.add(tx, { actorUserId: null, action: "billing.checkout_failed", targetType: "subscription", meta: { kind: po.kind, plan: po.plan, orderId: po.orderId, reason } });
    return row !== null;
  });
  if (failed && po.kind === "renewal") await registerChargeFailure(services, orgId, reason);
  return failed;
}

export interface ChargeFailureOutcome {
  attempts: number;
  nextChargeAt: string | null;
  /** Relances épuisées : retour à l'accès de base. */
  ended: boolean;
}

/**
 * Débit échoué sur l'échéance en cours : compte la tentative, programme la relance (J+1, J+3,
 * J+7 après l'échéance) et prévient par email. Quand les relances sont épuisées (l'échéance puis
 * trois relances), l'espace repasse à l'accès de base, la carte qui échoue est oubliée (le prochain
 * paiement enregistre celle que le client saisira) ; les données sont conservées 30 jours.
 */
export async function registerChargeFailure(services: Services, orgId: string, reason: string): Promise<ChargeFailureOutcome> {
  const now = services.now();
  const sub = await loadSubscription(services, orgId);
  const attempts = sub.chargeAttempts + 1;
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : now;
  const next = nextChargeDate(periodEnd, attempts);
  const plan = isPaidPlan(sub.pendingPlan) ? sub.pendingPlan : isPaidPlan(sub.plan) ? sub.plan : "starter";
  const error = reason.slice(0, 500);
  await services.db.withOrg(orgId, async (tx) => {
    if (next === null) {
      await repos.subscriptions.upsert(tx, { plan: "free", quotas: quotasForPlan("free"), status: "canceled", pendingPlan: null, chargeAttempts: attempts, nextChargeAt: null, lastChargeError: error, cancelAtPeriodEnd: false, cardOnFile: false, paymentMethodId: null, dataRetentionUntil: new Date(now.getTime() + DATA_RETENTION_DAYS_AFTER_END * 86_400_000).toISOString() });
      await repos.audit.add(tx, { actorUserId: null, action: "billing.subscription_ended", targetType: "subscription", meta: { reason: "payment_failed", attempts, lastError: error, previousPlan: sub.plan, paymentMethodForgotten: sub.paymentMethodId !== null } });
    } else {
      await repos.subscriptions.upsert(tx, { status: "past_due", chargeAttempts: attempts, nextChargeAt: next.toISOString(), lastChargeError: error });
      await repos.audit.add(tx, { actorUserId: null, action: "billing.charge_failed", targetType: "subscription", meta: { attempts, nextChargeAt: next.toISOString(), lastError: error, plan } });
    }
  });
  // Email après la transaction, au mieux (l'échec d'envoi est journalisé par l'appelant via l'audit).
  const org = await services.db.withGlobal((tx) => repos.orgs.byId(tx, orgId));
  const link = webLink(services, "/app/settings/billing");
  const rendered = next === null
    ? alertEmail({
        title: `Votre espace « ${org.name} » est passé à l'accès de base`,
        body: `Le paiement de l'abonnement ${PLAN_LABELS[plan]} n'a pas abouti malgré trois nouvelles tentatives.\n\nVotre espace Selio continue en accès de base ; vos données sont conservées ${DATA_RETENTION_DAYS_AFTER_END} jours. Pour reprendre votre offre, enregistrez un nouveau moyen de paiement.`,
        link,
        linkLabel: "Reprendre mon abonnement",
      })
    : paymentFailedEmail({ orgName: org.name, planLabel: PLAN_LABELS[plan], amountLabel: formatEuros(planPriceCents(plan, sub.cycle)), nextAttemptLabel: `le ${formatDateFr(next)}`, link });
  for (const to of await ownerEmails(services, orgId)) await sendEmail(services, { to, ...rendered });
  return { attempts, nextChargeAt: next?.toISOString() ?? null, ended: next === null };
}

// ---------------------------------------------------------------- renouvellement (worker)

export type RenewalAction = "skipped" | "trial_ended" | "ended" | "renewed" | "failed" | "awaiting_webhook" | "deferred";
export interface RenewalOutcome {
  action: RenewalAction;
  reason?: string;
  invoiceNumber?: string;
  nextChargeAt?: string | null;
}

/**
 * Autorisations de vérification (essai, changement de carte) restées posées parce que l'annulation a
 * échoué au moment du webhook : retentées à chaque passage du worker jusqu'à la levée. Une commande
 * entre-temps annulée, encaissée ou échouée chez le fournisseur est remise en accord localement.
 * Retourne le nombre d'autorisations levées.
 */
export async function releaseStaleAuthorisations(services: Services, orgId: string): Promise<number> {
  const payments = services.payments;
  if (!payments) return 0;
  const open = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.listByState(tx, [...CARD_ONLY_ORDER_KINDS], "authorised"));
  let released = 0;
  for (const po of open) {
    try {
      await payments.cancelOrder(po.orderId);
    } catch (err) {
      if (isTransient(err)) continue;
      // Refus définitif : la commande n'est plus annulable ; on relit son état et on s'aligne dessus.
      let fresh;
      try {
        fresh = await payments.getOrder(po.orderId);
      } catch {
        continue;
      }
      if (fresh.state === "completed") {
        await settleUnexpectedCapture(services, orgId, po);
        continue;
      }
      if (fresh.state === "failed") {
        await services.db.withOrg(orgId, (tx) => repos.paymentOrders.fail(tx, po.id, "Autorisation expirée ou refusée chez le fournisseur"));
        continue;
      }
      if (fresh.state !== "cancelled") continue;
    }
    await services.db.withOrg(orgId, async (tx) => {
      await repos.paymentOrders.cancel(tx, po.id);
      await repos.audit.add(tx, { actorUserId: null, action: "billing.authorisation_released", targetType: "subscription", meta: { kind: po.kind, orderId: po.orderId, amountCents: po.amountCents } });
    });
    released++;
  }
  return released;
}

/**
 * Échéance d'une organisation (tâche horaire du worker) :
 * - autorisations de vérification restées posées → annulation retentée ;
 * - essai terminé sans carte → accès de base, sans tentative (après relecture des moyens « pour le
 *   marchand » quand un client Revolut existe : une carte enregistrée pendant une panne n'est pas
 *   perdue) ; avec carte → premier débit ;
 * - abonnement Revolut échu (ou relance due) → commande + débit du moyen enregistré, à
 *   l'initiative du marchand ; succès → période prolongée et facture ; échec → relance ;
 * - résiliation demandée → fin à l'échéance, accès de base, données conservées 30 jours.
 * Une commande de renouvellement encore ouverte est relue chez le fournisseur avant toute
 * nouvelle tentative (jamais deux débits pour une même échéance).
 */
export async function processSubscriptionRenewal(services: Services, orgId: string): Promise<RenewalOutcome> {
  const now = services.now();
  let sub = await services.db.withOrg(orgId, (tx) => repos.subscriptions.get(tx));
  if (!sub) return { action: "skipped", reason: "no_subscription" };
  await releaseStaleAuthorisations(services, orgId).catch(() => 0);
  if (sub.status === "trialing") {
    if (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > now) return { action: "skipped", reason: "trial_running" };
    if (!sub.paymentMethodId && sub.revolutCustomerId && services.payments && !sub.cancelAtPeriodEnd) {
      const recovered = await recoverSavedCard(services, orgId, sub);
      if (recovered === null) return { action: "deferred", reason: "provider_unreachable" };
      sub = recovered;
    }
    if (!sub.cardOnFile || !sub.paymentMethodId || sub.cancelAtPeriodEnd) {
      await endSubscription(services, orgId, sub, sub.cancelAtPeriodEnd ? "cancelled" : "trial_ended", false);
      return { action: "trial_ended" };
    }
    return chargeDue(services, orgId, sub);
  }
  if (sub.provider !== "revolut") return { action: "skipped", reason: "not_revolut" };
  if (sub.status !== "active" && sub.status !== "past_due") return { action: "skipped", reason: `status_${sub.status}` };
  const dueAt = sub.status === "past_due" && sub.nextChargeAt ? new Date(sub.nextChargeAt) : sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  if (!dueAt || dueAt > now) return { action: "skipped", reason: "not_due" };
  if (sub.cancelAtPeriodEnd) {
    await endSubscription(services, orgId, sub, "cancelled", true);
    return { action: "ended", reason: "cancelled" };
  }
  return chargeDue(services, orgId, sub);
}

/**
 * Carte enregistrée chez le fournisseur mais inconnue de Selio (liste en panne au moment du webhook) :
 * relue avant de conclure « sans carte ». Fournisseur injoignable → null (l'échéance attend le
 * passage suivant plutôt que de fermer l'essai à tort).
 */
async function recoverSavedCard(services: Services, orgId: string, sub: Subscription): Promise<Subscription | null> {
  let method: SavedPaymentMethod | null;
  try {
    method = await resolvePaymentMethod(services, sub.revolutCustomerId, null);
  } catch {
    return null;
  }
  if (!method) return sub;
  return services.db.withOrg(orgId, async (tx) => {
    const updated = await repos.subscriptions.upsert(tx, { provider: "revolut", cardOnFile: true, paymentMethodId: method.id });
    await repos.audit.add(tx, { actorUserId: null, action: "billing.card_recovered", targetType: "subscription", meta: { method: methodMeta(method) } });
    return updated;
  });
}

async function endSubscription(services: Services, orgId: string, sub: Subscription, reason: "trial_ended" | "cancelled", retainData: boolean): Promise<void> {
  const now = services.now();
  await services.db.withOrg(orgId, async (tx) => {
    await repos.subscriptions.upsert(tx, { plan: "free", quotas: quotasForPlan("free"), status: "canceled", pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, cancelAtPeriodEnd: false, dataRetentionUntil: retainData ? new Date(now.getTime() + DATA_RETENTION_DAYS_AFTER_END * 86_400_000).toISOString() : null });
    await repos.audit.add(tx, { actorUserId: null, action: reason === "trial_ended" ? "billing.trial_ended" : "billing.subscription_ended", targetType: "subscription", meta: { reason, previousPlan: sub.plan, cardOnFile: sub.cardOnFile } });
  });
}

async function chargeDue(services: Services, orgId: string, sub: Subscription): Promise<RenewalOutcome> {
  const payments = services.payments;
  if (!payments) return { action: "skipped", reason: "payments_unconfigured" };
  const plan = isPaidPlan(sub.pendingPlan) ? sub.pendingPlan : isPaidPlan(sub.plan) ? sub.plan : null;
  if (!plan) return { action: "skipped", reason: "no_paid_plan" };
  const cycle = sub.cycle;
  const now = services.now();

  // Une commande de renouvellement déjà ouverte : on la relit plutôt que d'en créer une seconde.
  const open = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.latest(tx, "renewal"));
  if (open && RETRYING_STATES.includes(open.state)) {
    let fresh;
    try {
      fresh = await payments.getOrder(open.orderId);
    } catch {
      return { action: "deferred", reason: "provider_unreachable" };
    }
    if (fresh.state === "completed") {
      const done = await completePaidOrder(services, orgId, open);
      return { action: "renewed", invoiceNumber: done.invoice?.number };
    }
    const neverPresented = fresh.paymentAttempts === 0 && (fresh.state === "pending" || fresh.state === "cancelled");
    if (neverPresented) {
      // Jamais présentée à une banque (panne entre la création de la commande et le débit) : annulée et
      // remplacée tout de suite par une nouvelle commande, sans échec compté ni email.
      if (fresh.state === "pending") await payments.cancelOrder(open.orderId).catch(() => undefined);
      await services.db.withOrg(orgId, (tx) => repos.paymentOrders.cancel(tx, open.id, "Commande jamais présentée à la banque : remplacée"));
    } else if (fresh.state === "failed" || fresh.state === "cancelled") {
      await failOrder(services, orgId, open, "Le paiement n'a pas abouti");
      return { action: "failed", nextChargeAt: (await loadSubscription(services, orgId)).nextChargeAt };
    } else {
      if (now.getTime() - new Date(open.createdAt).getTime() < OPEN_ORDER_MAX_AGE_MS) return { action: "awaiting_webhook" };
      // Restée en traitement trop longtemps : annulée chez le fournisseur AVANT d'être comptée échouée
      // (un encaissement tardif ferait sinon un double débit). Impossible à annuler : on attend encore.
      try {
        await payments.cancelOrder(open.orderId);
      } catch {
        return { action: "awaiting_webhook", reason: "cancel_refused" };
      }
      await failOrder(services, orgId, open, "Paiement resté en attente chez le fournisseur");
      const after = await loadSubscription(services, orgId);
      return { action: after.status === "canceled" ? "ended" : "failed", nextChargeAt: after.nextChargeAt };
    }
  }

  if (!sub.paymentMethodId || !sub.revolutCustomerId) {
    const r = await registerChargeFailure(services, orgId, "Aucun moyen de paiement enregistré");
    return { action: r.ended ? "ended" : "failed", reason: "no_payment_method", nextChargeAt: r.nextChargeAt };
  }
  const amountCents = planPriceCents(plan, cycle);
  const attempt = sub.chargeAttempts + 1;
  let orderId: string;
  try {
    const order = await payments.createOrder({ orgId, plan, amountCents, currency: "EUR", customerId: sub.revolutCustomerId, captureMode: "automatic", description: `Selio ${PLAN_LABELS[plan]} — renouvellement ${cycleLabel(cycle)}`, metadata: { kind: "renewal", cycle, attempt: String(attempt) }, merchantOrderRef: orgId });
    orderId = order.orderId;
  } catch (err) {
    if (isTransient(err)) return { action: "deferred", reason: (err as PaymentApiError).code };
    const r = await registerChargeFailure(services, orgId, err instanceof Error ? err.message : "Création de la commande refusée");
    return { action: r.ended ? "ended" : "failed", nextChargeAt: r.nextChargeAt };
  }
  const po = await services.db.withOrg(orgId, (tx) => repos.paymentOrders.create(tx, { orderId, kind: "renewal", plan, cycle, amountCents, captureMode: "automatic", attempt, createdAt: now.toISOString() }));
  let state: PaymentState;
  let error: string | null = null;
  try {
    state = (await payments.chargeSavedMethod({ orderId, paymentMethodId: sub.paymentMethodId })).state;
  } catch (err) {
    // Fournisseur injoignable ou en panne : la commande reste ouverte, relue au prochain passage (aucun échec compté).
    if (isTransient(err)) return { action: "deferred", reason: (err as PaymentApiError).code };
    state = "failed";
    error = err instanceof Error ? err.message : "Débit refusé";
  }
  if (state === "completed") {
    const done = await completePaidOrder(services, orgId, po);
    return { action: "renewed", invoiceNumber: done.invoice?.number };
  }
  if (state === "failed" || state === "cancelled") {
    await failOrder(services, orgId, po, error ?? "Paiement refusé");
    const after = await loadSubscription(services, orgId);
    return { action: after.status === "canceled" ? "ended" : "failed", nextChargeAt: after.nextChargeAt };
  }
  return { action: "awaiting_webhook" };
}

// ---------------------------------------------------------------- résiliation, changement d'offre, factures

/** Résiliation : l'accès continue jusqu'à la fin de la période payée (ou de l'essai), puis accès de base. */
export async function cancelSubscription(ctx: OrgContext): Promise<Subscription> {
  requireAction(ctx, "billing.manage");
  const sub = await getSubscription(ctx);
  if (sub.status !== "trialing" && sub.status !== "active" && sub.status !== "past_due") throw new AppError("conflict", "Aucun abonnement en cours à résilier.", 409);
  if (sub.cancelAtPeriodEnd) return sub;
  return withOrg(ctx, async (tx) => {
    const updated = await repos.subscriptions.upsert(tx, { cancelAtPeriodEnd: true });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.cancel_requested", targetType: "subscription", meta: { plan: sub.plan, periodEnd: sub.currentPeriodEnd }, ip: ctx.ip });
    return updated;
  });
}

/** Annule une résiliation demandée tant que la période n'est pas terminée. */
export async function reactivateSubscription(ctx: OrgContext): Promise<Subscription> {
  requireAction(ctx, "billing.manage");
  const sub = await getSubscription(ctx);
  if (!sub.cancelAtPeriodEnd) return sub;
  return withOrg(ctx, async (tx) => {
    const updated = await repos.subscriptions.upsert(tx, { cancelAtPeriodEnd: false });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.reactivated", targetType: "subscription", meta: { plan: sub.plan }, ip: ctx.ip });
    return updated;
  });
}

/** Changement d'offre : appliqué au prochain renouvellement (ou à la fin de l'essai), avec la carte enregistrée. */
export async function changePlan(ctx: OrgContext, plan: Plan): Promise<Subscription> {
  requireAction(ctx, "billing.manage");
  if (!isPaidPlan(plan)) throw new AppError("validation", "Plan invalide : choisissez Starter, Pro ou Agence.", 400);
  const sub = await getSubscription(ctx);
  const running = sub.status === "trialing" || sub.status === "active" || sub.status === "past_due";
  if (!running || !sub.cardOnFile) throw new AppError("conflict", "Choisissez d'abord une offre et enregistrez une carte (paiement) avant de changer d'offre.", 409);
  const pendingPlan = sub.status === "active" && plan === sub.plan ? null : plan;
  return withOrg(ctx, async (tx) => {
    const updated = await repos.subscriptions.upsert(tx, { pendingPlan });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.plan_change_requested", targetType: "subscription", meta: { from: sub.plan, to: plan, pendingPlan }, ip: ctx.ip });
    return updated;
  });
}

export function listInvoices(ctx: OrgContext): Promise<Invoice[]> {
  requireAction(ctx, "billing.manage");
  return withOrg(ctx, (tx) => repos.invoices.list(tx));
}

/** Données d'une facture pour un rendu HTML imprimable (le serveur ne produit pas de PDF). */
export async function getInvoice(ctx: OrgContext, id: string): Promise<InvoiceView> {
  requireAction(ctx, "billing.manage");
  const invoice = await withOrg(ctx, (tx) => repos.invoices.byId(tx, id));
  if (!invoice) throw new AppError("not_found", "Facture introuvable.", 404);
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  const email = (await ownerEmails(ctx.services, ctx.orgId))[0] ?? null;
  const totals = invoiceAmounts(invoice.amountCents, invoice.vatRate);
  const start = new Date(invoice.periodStart);
  const end = new Date(invoice.periodEnd);
  return {
    invoice,
    issuer: { name: "Selio", vatNotice: invoice.vatNotice },
    customer: { orgName: org.name, email },
    lines: [{ label: `Abonnement Selio ${PLAN_LABELS[invoice.plan]} — ${cycleLabel(invoice.cycle)}`, periodLabel: `du ${formatDateFr(start)} au ${formatDateFr(end)}`, amountCents: invoice.amountCents }],
    totals: { ...totals, vatRate: invoice.vatRate },
    paymentProvider: invoice.orderId ? "revolut" : null,
  };
}
