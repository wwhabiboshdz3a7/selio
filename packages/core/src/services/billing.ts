import { PAID_PLANS, buildUsageCounter, quotasForPlan, type PaidPlan, type Plan, type PlanQuotas, type Subscription, type SubsidiaryUsage, type UsageCounter } from "@selio/contracts";
import { repos } from "@selio/db";
import { effectiveAiQuota } from "@selio/domain";
import { StripeClient, verifyWebhook, type StripeEvent } from "@selio/connectors/stripe";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services } from "../context";
import type { UsageSummary } from "../types-data";

export { USAGE_WARNING_RATE, buildUsageCounter, usagePercent } from "@selio/contracts";

export interface BillingConfig {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePriceIds?: Partial<Record<Plan, string>>;
  liveAllowed: boolean;
  publicWebUrl: string;
}

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

const isPaidPlan = (plan: unknown): plan is PaidPlan => typeof plan === "string" && (PAID_PLANS as readonly string[]).includes(plan);

export async function startCheckout(ctx: OrgContext, plan: Plan, cfg: BillingConfig): Promise<{ url: string | null; simulated: boolean; message: string }> {
  requireAction(ctx, "billing.manage");
  if (!isPaidPlan(plan)) throw new AppError("validation", "Plan invalide : choisissez Starter, Pro ou Agence.", 400);
  const priceId = cfg.stripePriceIds?.[plan];
  if (!cfg.stripeSecretKey || !priceId) {
    await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.checkout_unavailable", targetType: "subscription", meta: { plan }, ip: ctx.ip }));
    return { url: null, simulated: false, message: "Le paiement n'est pas configuré sur ce serveur (STRIPE_SECRET_KEY et identifiants de prix absents). Aucun abonnement n'a été créé." };
  }
  const client = new StripeClient({ secretKey: cfg.stripeSecretKey, webhookSecret: cfg.stripeWebhookSecret ?? "", liveAllowed: cfg.liveAllowed });
  const user = await ctx.services.db.withGlobal((g) => repos.users.byId(g, ctx.userId));
  const session = await client.createCheckoutSession({ priceId, customerEmail: user.email, orgId: ctx.orgId, successUrl: `${cfg.publicWebUrl}/app/settings/billing?checkout=success`, cancelUrl: `${cfg.publicWebUrl}/app/settings/billing?checkout=cancel` }, `checkout:${ctx.orgId}:${plan}:${nowIso(ctx).slice(0, 13)}`);
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "billing.checkout_started", targetType: "subscription", meta: { plan, testMode: client.testMode }, ip: ctx.ip }));
  return { url: session.url, simulated: false, message: client.testMode ? "Redirection vers Stripe en mode test." : "Redirection vers Stripe." };
}

/** Webhook Stripe : signature vérifiée, idempotence par identifiant d'événement. */
export async function handleStripeWebhook(services: Services, cfg: BillingConfig, payload: string, signature: string | undefined): Promise<{ handled: boolean; duplicate: boolean; type?: string }> {
  if (!cfg.stripeWebhookSecret) throw new AppError("conflict", "Webhook Stripe non configuré", 409);
  const verified = verifyWebhook(payload, signature, cfg.stripeWebhookSecret, { now: () => services.now().getTime() });
  if (!verified.ok) throw new AppError("unauthorized", `Webhook refusé : ${verified.reason}`, 400);
  const event = verified.event;
  const fresh = await services.db.withGlobal((tx) => repos.paymentEvents.record(tx, { id: event.id, provider: "stripe", type: event.type, payload: event }));
  if (!fresh) return { handled: false, duplicate: true, type: event.type };
  await applyStripeEvent(services, event);
  await services.db.withGlobal((tx) => repos.paymentEvents.markProcessed(tx, event.id));
  return { handled: true, duplicate: false, type: event.type };
}

async function applyStripeEvent(services: Services, event: StripeEvent): Promise<void> {
  const obj = event.data.object;
  const orgId = (obj.metadata as { orgId?: string } | undefined)?.orgId ?? null;
  const planFromPrice = (priceId: string | undefined, prices: Partial<Record<Plan, string>>): Plan => (Object.entries(prices).find(([, v]) => v === priceId)?.[0] as Plan) ?? "starter";
  const prices = parsePriceIds(process.env);
  switch (event.type) {
    case "checkout.session.completed": {
      if (!orgId) return;
      await services.db.withOrg(orgId, (tx) => repos.subscriptions.upsert(tx, { provider: "stripe", status: "active", externalRef: typeof obj.subscription === "string" ? obj.subscription : null, stripeCustomerId: typeof obj.customer === "string" ? obj.customer : null, testMode: !event.livemode }));
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const ref = typeof obj.id === "string" ? obj.id : null;
      const target = orgId ? { orgId } : ref ? await services.db.withGlobal((tx) => repos.subscriptions.findByExternalRef(tx, ref)) : null;
      if (!target) return;
      const item = (obj.items as { data?: { price?: { id?: string } }[] } | undefined)?.data?.[0];
      const plan = planFromPrice(item?.price?.id, prices);
      const status = typeof obj.status === "string" ? obj.status : "active";
      await services.db.withOrg(target.orgId, (tx) => repos.subscriptions.upsert(tx, { provider: "stripe", plan, quotas: quotasForPlan(plan), status: (["trialing", "active", "past_due", "canceled", "incomplete"].includes(status) ? status : "active") as Subscription["status"], externalRef: ref, currentPeriodEnd: typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000).toISOString() : null, testMode: !event.livemode }));
      return;
    }
    case "customer.subscription.deleted": {
      const ref = typeof obj.id === "string" ? obj.id : null;
      const target = ref ? await services.db.withGlobal((tx) => repos.subscriptions.findByExternalRef(tx, ref)) : null;
      if (!target) return;
      await services.db.withOrg(target.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "free", quotas: quotasForPlan("free"), status: "canceled", cancelAtPeriodEnd: false }));
      return;
    }
    default:
      return;
  }
}

/** Identifiants de prix Stripe par plan payant (STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_AGENCE). */
export function parsePriceIds(env: Record<string, string | undefined>): Partial<Record<Plan, string>> {
  const out: Partial<Record<Plan, string>> = {};
  if (env.STRIPE_PRICE_STARTER) out.starter = env.STRIPE_PRICE_STARTER;
  if (env.STRIPE_PRICE_PRO) out.pro = env.STRIPE_PRICE_PRO;
  if (env.STRIPE_PRICE_AGENCE) out.agence = env.STRIPE_PRICE_AGENCE;
  return out;
}
