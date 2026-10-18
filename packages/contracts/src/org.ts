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

/**
 * Frais payés par l'acheteur en plus du prix et du port (ex. « Protection
 * acheteurs » sur Vinted : part fixe + pourcentage du prix). Valeurs
 * modifiables : elles servent à calculer le coût réel d'un achat.
 */
export const buyerFees = z.object({
  fixedCents: nonNegCents.max(10_000).default(70),
  rate: rate.default(0.05),
});
export type BuyerFees = z.infer<typeof buyerFees>;

/**
 * Achat automatique : au-dessus du seuil de score, l'application achète
 * seule, dans la limite d'un plafond journalier, puis laisse un délai pour
 * annuler. Désactivé par défaut.
 */
export const autoBuySettings = z.object({
  enabled: z.boolean().default(false),
  /** Score minimal (sur 100) pour déclencher un achat automatique. */
  threshold: z.number().int().min(50).max(100).default(85),
  /** Plafond de dépense par jour (port et frais inclus). */
  dailyCapCents: nonNegCents.default(15_000),
  /** Prix maximal par article (port et frais inclus). */
  maxItemCents: nonNegCents.default(6_000),
  /** Délai pendant lequel l'achat automatique peut être annulé. */
  cancelWindowMinutes: z.number().int().min(0).max(1440).default(30),
  /** Compte « Achat » utilisé (null = le premier compte Achat actif). Jamais un compte Perso. */
  connectionId: id.nullable().default(null),
});
export type AutoBuySettings = z.infer<typeof autoBuySettings>;

/** Dressing intelligent : à partir de quand une annonce est à republier. */
export const dressingSettings = z.object({
  republishAfterDays: z.number().int().min(1).max(90).default(7),
});
export type DressingSettings = z.infer<typeof dressingSettings>;

/** Tranche de prix : jusqu'à `upToCents` (null = au-delà), marge de négociation accordée. */
export const priceBand = z.object({
  upToCents: nonNegCents.nullable(),
  /** Marge de négociation : remise maximale accordée sur le prix affiché. */
  marginRate: rate,
});
export type PriceBand = z.infer<typeof priceBand>;

const message = (fallback: string) => z.string().trim().max(600).default(fallback);

/**
 * Négociation automatique, réglée étape par étape (Automatisation ›
 * Négociation automatique) : marge par tranche de prix, paliers de
 * réduction, lots, baisses de prix, messages et délais.
 */
export const negotiationAutomation = z.object({
  enabled: z.boolean().default(true),
  bands: z.array(priceBand).min(1).max(8).default([
    { upToCents: 999, marginRate: 0.1 },
    { upToCents: 1999, marginRate: 0.15 },
    { upToCents: 4999, marginRate: 0.2 },
    { upToCents: null, marginRate: 0.25 },
  ]),
  /** Paliers : part de la marge accordée à chaque contre-offre (0,6 → 60 %). Le dernier vaut 1. */
  steps: z.array(z.number().min(0.05).max(1)).min(1).max(5).default([0.6, 0.75, 1]),
  lot: z.object({
    enabled: z.boolean().default(true),
    twoItemsRate: rate.default(0.1),
    threePlusRate: rate.default(0.15),
  }).default({}),
  priceDrops: z.object({
    enabled: z.boolean().default(false),
    afterDays: z.number().int().min(1).max(90).default(10),
    rate: rate.default(0.05),
    /** Jamais en dessous de cette part du prix initial. */
    floorRate: rate.default(0.7),
  }).default({}),
  messages: z.object({
    greeting: message("Bonjour {prenom}, merci pour votre intérêt pour « {article} » !"),
    counter: message("Je ne peux pas descendre jusque-là, mais je vous propose {prix}. Ça vous va ?"),
    final: message("C'est mon dernier prix : {prix}. Je ne peux pas faire mieux, l'article est en très bon état."),
    afterFinal: message("Si vous changez d'avis, l'offre à {prix} reste valable jusqu'à ce soir."),
    accepted: message("Parfait, c'est d'accord pour {prix} ! Je prépare le colis dès votre achat."),
    fallback: message("Je comprends, ce prix est trop bas pour moi. Ajoutez l'article en favori : je vous préviendrai en cas de baisse."),
  }).default({}),
  timing: z.object({
    minDelayMinutes: z.number().int().min(0).max(240).default(2),
    maxDelayMinutes: z.number().int().min(0).max(480).default(15),
    activeFrom: z.number().int().min(0).max(23).default(8),
    activeTo: z.number().int().min(1).max(24).default(22),
    /** Envoyer la contre-offre comme offre Vinted (bouton « Acheter à ce prix »), pas seulement en message. */
    sendOffers: z.boolean().default(true),
    offerValidityHours: z.number().int().min(1).max(72).default(24),
  }).default({}),
});
export type NegotiationAutomation = z.infer<typeof negotiationAutomation>;

/** Onglet Automatisation : messages, négociation, après-vente et stock automatique. */
export const automationSettings = z.object({
  favorites: z.object({
    enabled: z.boolean().default(true),
    delayMinutes: z.number().int().min(0).max(1440).default(30),
    /** Remise proposée avec le message (0 = message seul). */
    offerRate: rate.default(0.1),
    message: message("Bonjour {prenom} ! J'ai vu que « {article} » vous plaît : je peux vous le laisser à {prix}, livraison rapide."),
    onlyOncePerBuyer: z.boolean().default(true),
  }).default({}),
  autoReply: z.object({
    enabled: z.boolean().default(true),
    /** Réponses IA envoyées seules (sinon : brouillon à valider). */
    sendWithoutApproval: z.boolean().default(false),
    topics: z.object({
      availability: z.boolean().default(true),
      size: z.boolean().default(true),
      condition: z.boolean().default(true),
      shipping: z.boolean().default(true),
      bundle: z.boolean().default(true),
      photos: z.boolean().default(false),
    }).default({}),
    awayMessage: message("Merci pour votre message ! Je vous réponds dès demain matin."),
  }).default({}),
  negotiation: negotiationAutomation.default({}),
  afterSale: z.object({
    autoLabels: z.boolean().default(true),
    autoPrint: z.boolean().default(false),
    printer: z.string().trim().max(80).default(""),
    soldMessage: z.object({ enabled: z.boolean().default(true), text: message("Merci pour votre achat ! Je prépare votre colis, je vous l'envoie très vite.") }).default({}),
    completedMessage: z.object({ enabled: z.boolean().default(true), text: message("Merci d'avoir validé la commande, j'espère que l'article vous plaît ! À bientôt, abonnez-vous si vous voulez : j'en mettrai d'autres.") }).default({}),
    pickupReminder: z.object({ enabled: z.boolean().default(true), afterHours: z.number().int().min(1).max(168).default(24), text: message("Bonjour {prenom}, votre colis vous attend au point relais depuis hier : pensez à le récupérer !") }).default({}),
  }).default({}),
  stock: z.object({
    enabled: z.boolean().default(false),
    /** Remettre en ligne seulement s'il reste du stock (quantité > 1). */
    onlyWithStock: z.boolean().default(true),
    delayMinutes: z.number().int().min(0).max(1440).default(10),
    /** Comptes dont les ventes déclenchent la remise en ligne (vide = tous les comptes Vente). */
    connectionIds: z.array(id).max(50).default([]),
  }).default({}),
});
export type AutomationSettings = z.infer<typeof automationSettings>;

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
  buyerFees: buyerFees.default({}),
  autoBuy: autoBuySettings.default({}),
  dressing: dressingSettings.default({}),
  automation: automationSettings.default({}),
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

/** Quotas par plan (partagés web, API, worker). */
export const PLAN_QUOTAS: Record<Plan, PlanQuotas> = {
  free: { items: 50, aiRequestsPerMonth: 50, automationActionsPerDay: 10, connections: 1, members: 1 },
  starter: { items: 500, aiRequestsPerMonth: 500, automationActionsPerDay: 100, connections: 2, members: 3 },
  pro: { items: 5000, aiRequestsPerMonth: 3000, automationActionsPerDay: 500, connections: 5, members: 10 },
};

export const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled", "incomplete"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Offre Découverte : essai gratuit de toutes les fonctions du plan Pro, d'une durée
 * choisie à l'inscription (1 semaine par défaut, ou 1 mois). Aucun paiement.
 */
export const TRIAL_DAYS_OPTIONS = [7, 30] as const;
export type TrialDays = (typeof TRIAL_DAYS_OPTIONS)[number];
export const DEFAULT_TRIAL_DAYS: TrialDays = 7;
export const TRIAL_PLAN: Plan = "pro";
export const trialDays = z.union([z.literal(7), z.literal(30)]);

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
  /** Durée de l'essai Découverte choisie à l'inscription. */
  trialDays: trialDays.default(DEFAULT_TRIAL_DAYS),
});
export const loginInput = z.object({ email, password: z.string().min(1).max(200) });

export const orgUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: orgSettings.partial().optional(),
});
export const inviteInput = z.object({ email, role });
