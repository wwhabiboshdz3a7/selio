import type { Plan, Subscription } from "@selio/contracts";
import { repos } from "@selio/db";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { StripeClient, verifyWebhook, type StripeEvent } from "@selio/connectors/stripe";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services } from "../context";
import type { UsageSummary } from "../types-data";

export interface BillingConfig {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePriceIds?: Partial<Record<Plan, string>>;
  liveAllowed: boolean;
  publicWebUrl: string;
}

export function getSubscription(ctx: OrgContext): Promise<Subscription> {
  return withOrg(ctx, async (tx) => (await repos.subscriptions.get(tx)) ?? repos.subscriptions.upsert(tx, { plan: "free", status: "none", provider: "none", quotas: PLAN_QUOTAS.free, testMode: true }));
}

export function getUsage(ctx: OrgContext): Promise<UsageSummary> {
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const sums = await repos.usage.sumSince(tx, from);
    const sub = (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free;
    return { period: { from, to: now.toISOString() }, aiRequests: sums["ai.request"] ?? 0, automationActions: sums["automation.action"] ?? 0, connectorSyncs: sums["connector.sync"] ?? 0, exports: sums["export.csv"] ?? 0, extensionCaptures: sums["extension.capture"] ?? 0, quotas: sub, itemsCount: await repos.items.countActive(tx), connectionsCount: await repos.connections.count(tx), membersCount: await ctx.services.db.withGlobal((g) => repos.memberships.countOrg(g, ctx.orgId)) };
  });
}

export const listUsageEvents = (ctx: OrgContext, limit: number) => withOrg(ctx, (tx) => repos.usage.list(tx, Math.min(200, Math.max(1, limit))));

export async function startCheckout(ctx: OrgContext, plan: Plan, cfg: BillingConfig): Promise<{ url: string | null; simulated: boolean; message: string }> {
  requireAction(ctx, "billing.manage");
  if (plan !== "starter" && plan !== "pro") throw new AppError("validation", "Plan invalide", 400);
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
      await services.db.withOrg(target.orgId, (tx) => repos.subscriptions.upsert(tx, { provider: "stripe", plan, quotas: PLAN_QUOTAS[plan], status: (["trialing", "active", "past_due", "canceled", "incomplete"].includes(status) ? status : "active") as Subscription["status"], externalRef: ref, currentPeriodEnd: typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000).toISOString() : null, testMode: !event.livemode }));
      return;
    }
    case "customer.subscription.deleted": {
      const ref = typeof obj.id === "string" ? obj.id : null;
      const target = ref ? await services.db.withGlobal((tx) => repos.subscriptions.findByExternalRef(tx, ref)) : null;
      if (!target) return;
      await services.db.withOrg(target.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "free", quotas: PLAN_QUOTAS.free, status: "canceled" }));
      return;
    }
    default:
      return;
  }
}

export function parsePriceIds(env: Record<string, string | undefined>): Partial<Record<Plan, string>> {
  const out: Partial<Record<Plan, string>> = {};
  if (env.STRIPE_PRICE_STARTER) out.starter = env.STRIPE_PRICE_STARTER;
  if (env.STRIPE_PRICE_PRO) out.pro = env.STRIPE_PRICE_PRO;
  return out;
}
