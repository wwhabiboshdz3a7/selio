import { z } from "zod";
import { currency, email, id, isoDate, nonNegCents, rate, role, slug } from "./common";

export const user = z.object({
  id,
  email,
  displayName: z.string().trim().min(1).max(80),
  isOperator: z.boolean().default(false),
  createdAt: isoDate,
});
export type User = z.infer<typeof user>;

export const marginRules = z.object({
  /** Marge minimale (taux sur prix de vente) pour accepter une offre sans validation. */
  minMarginRate: rate.default(0.25),
  /** Marge minimale absolue (centimes). */
  minMarginCents: nonNegCents.default(500),
  /** Remise maximale par rapport au prix affiché. */
  maxDiscountRate: rate.default(0.2),
  /** Pas de contre-proposition (taux du prix affiché). */
  counterStepRate: rate.default(0.05),
  /** Nombre de contre-propositions max par acheteur et par article. */
  maxRoundsPerCustomer: z.number().int().min(0).max(10).default(2),
  /** Frais plateforme vendeur par défaut (0 sur Vinted : la protection acheteur est payée par l'acheteur). */
  defaultPlatformFeeRate: rate.default(0),
  /** Coût d'expédition moyen à charge vendeur par défaut (0 : port payé par l'acheteur). */
  defaultShippingCostCents: nonNegCents.default(0),
});
export type MarginRules = z.infer<typeof marginRules>;

export const aiSettings = z.object({
  enabled: z.boolean().default(true),
  tone: z.enum(["neutral", "friendly", "concise"]).default("friendly"),
  language: z.enum(["fr"]).default("fr"),
  /** Validation humaine avant envoi d'un brouillon IA. */
  requireApproval: z.boolean().default(true),
  signature: z.string().max(120).default(""),
  /** Quota mensuel de requêtes IA (0 = illimité, borné par le plan côté serveur). */
  monthlyRequestQuota: z.number().int().min(0).max(100000).default(500),
});
export type AiSettings = z.infer<typeof aiSettings>;

export const notificationSettings = z.object({
  emailDigest: z.boolean().default(false),
  newMessage: z.boolean().default(true),
  automationFailure: z.boolean().default(true),
  connectionExpired: z.boolean().default(true),
});

export const orgSettings = z.object({
  currency: currency.default("EUR"),
  timezone: z.string().min(1).max(64).default("Europe/Paris"),
  locale: z.enum(["fr-FR"]).default("fr-FR"),
  margin: marginRules.default({}),
  ai: aiSettings.default({}),
  notifications: notificationSettings.default({}),
  retentionDays: z.object({
    messages: z.number().int().min(30).max(3650).default(730),
    auditLogs: z.number().int().min(90).max(3650).default(365),
    aiRequests: z.number().int().min(7).max(730).default(90),
  }).default({}),
  onboarding: z.object({
    completedSteps: z.array(z.string().max(40)).default([]),
    dismissed: z.boolean().default(false),
  }).default({}),
});
export type OrgSettings = z.infer<typeof orgSettings>;

export const organization = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  slug,
  settings: orgSettings.default({}),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Organization = z.infer<typeof organization>;

export const membership = z.object({
  id,
  orgId: id,
  userId: id,
  role,
  createdAt: isoDate,
});
export type Membership = z.infer<typeof membership>;

export const PLANS = ["free", "starter", "pro"] as const;
export const plan = z.enum(PLANS);
export type Plan = z.infer<typeof plan>;

export const planQuotas = z.object({
  items: z.number().int().min(0),
  aiRequestsPerMonth: z.number().int().min(0),
  automationActionsPerDay: z.number().int().min(0),
  connections: z.number().int().min(0),
  members: z.number().int().min(0),
});
export type PlanQuotas = z.infer<typeof planQuotas>;

export const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled", "incomplete"] as const;
export const subscription = z.object({
  id,
  orgId: id,
  plan: plan.default("free"),
  status: z.enum(SUBSCRIPTION_STATUSES).default("none"),
  provider: z.enum(["none", "stripe"]).default("none"),
  externalRef: z.string().max(120).nullable().default(null),
  currentPeriodEnd: isoDate.nullable().default(null),
  quotas: planQuotas,
  /** Mode test Stripe uniquement tant que l'activation n'est pas volontaire. */
  testMode: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Subscription = z.infer<typeof subscription>;

export const usageEvent = z.object({
  id,
  orgId: id,
  kind: z.enum(["ai.request", "automation.action", "connector.sync", "export.csv", "extension.capture"]),
  quantity: z.number().int().min(1).default(1),
  meta: z.record(z.unknown()).default({}),
  createdAt: isoDate,
});
export type UsageEvent = z.infer<typeof usageEvent>;

export const auditLog = z.object({
  id,
  orgId: id.nullable().default(null),
  actorUserId: id.nullable().default(null),
  action: z.string().min(1).max(80),
  targetType: z.string().max(40).nullable().default(null),
  targetId: id.nullable().default(null),
  meta: z.record(z.unknown()).default({}),
  ip: z.string().max(64).nullable().default(null),
  createdAt: isoDate,
});
export type AuditLog = z.infer<typeof auditLog>;

export const registerInput = z.object({
  email,
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(1).max(80),
  orgName: z.string().trim().min(1).max(120),
});
export const loginInput = z.object({ email, password: z.string().min(1).max(200) });

export const orgUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: orgSettings.partial().optional(),
});
export const inviteInput = z.object({ email, role });
