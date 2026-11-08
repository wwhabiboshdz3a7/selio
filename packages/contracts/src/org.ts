import { z } from "zod";
import { currency, email, id, isoDate, nonNegCents, rate, role, slug } from "./common";
import { RADAR_ALERT_MIN_SCORE_DEFAULT, RADAR_DEFAULT_MAX_PAGES_PER_MINUTE } from "./radar";

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
 * Achat automatique (Radar Auto) : au-dessus du seuil de score, l'application achète
 * seule, dans la limite d'un prix maximum par article et d'un plafond journalier, puis
 * laisse un délai pour annuler. Désactivé par défaut, et derrière un second verrou côté
 * serveur (RADAR_AUTO_ENABLED, réservé aux comptes de l'équipe pour les tests).
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
  /**
   * Traçabilité : date et auteur de la dernière activation (absents tant que jamais activé). Fixés
   * par le serveur (`radar.updateRadarSettings`), jamais par le client. Facultatifs dans le type pour
   * que les réglages enregistrés avant ce champ restent lisibles tels quels.
   */
  enabledAt: isoDate.nullable().optional(),
  enabledBy: id.nullable().optional(),
  /**
   * Arrêt automatique de Radar Auto par Selio (réglage remis à « désactivé ») après un achat à l'issue
   * incertaine (« Payer » cliqué sans confirmation, validation 3-D Secure expirée) : date et raison. Le
   * client vérifie dans Vinted puis réactive lui-même (acquittement). Fixés par le serveur seulement.
   */
  suspendedAt: isoDate.nullable().optional(),
  suspendedReason: z.string().max(300).nullable().optional(),
});
export type AutoBuySettings = z.infer<typeof autoBuySettings>;

const hour = z.number().int().min(0).max(23);

/**
 * Heures calmes (fuseau de l'organisation) : aucune notification Radar entre `from` et `to`
 * (par exemple 22 → 8) ; les alertes sont envoyées à la fin de la plage. La lecture continue.
 */
export const radarQuietHours = z.object({ from: hour, to: hour });
export type RadarQuietHours = z.infer<typeof radarQuietHours>;

/** Réglages de Selio Radar : alertes sur le téléphone (PWA) et plafond de lecture. */
export const radarSettings = z.object({
  /** Alertes push des nouvelles affaires. */
  alertsEnabled: z.boolean().default(true),
  /** Note minimale d'une affaire pour déclencher une alerte (75 = seuil « À valider »). */
  alertMinScore: z.number().int().min(0).max(100).default(RADAR_ALERT_MIN_SCORE_DEFAULT),
  /** Heures calmes des alertes (null : aucune). */
  quietHours: radarQuietHours.nullable().default(null),
  /** Pages lues en direct par minute, au plus, pour toute l'organisation. */
  maxPagesPerMinute: z.number().int().min(1).max(60).default(RADAR_DEFAULT_MAX_PAGES_PER_MINUTE),
});
export type RadarSettings = z.infer<typeof radarSettings>;

/**
 * Mise à jour des réglages Radar et Radar Auto (`radar.updateRadarSettings`) : champs facultatifs,
 * sans valeur par défaut (une mise à jour partielle ne remet rien à zéro). La traçabilité de
 * l'activation (`enabledAt`, `enabledBy`) est fixée par le serveur, jamais saisie.
 */
export const radarSettingsUpdate = z.object({
  radar: radarSettings.partial().optional(),
  autoBuy: autoBuySettings.omit({ enabledAt: true, enabledBy: true, suspendedAt: true, suspendedReason: true }).partial().optional(),
});
export type RadarSettingsUpdate = z.infer<typeof radarSettingsUpdate>;

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
 * Lots (négociation sur plusieurs articles, §5.12) : plafond de remise sur le total affiché du lot et
 * nombre minimal d'articles. Le plancher du lot vaut « total affiché × (1 − remise maximale de lot) »,
 * **jamais sous la somme des planchers réels** des articles (`evaluateBundleOffer`, @selio/domain) :
 * la remise de lot ne crée jamais une vente à perte. Mêmes paliers et même approbation que l'article
 * seul ; l'IA rédige, cette politique décide (D07). À ne pas confondre avec `lot` ci-dessous (la remise
 * proposée spontanément à un acheteur qui ajoute un deuxième article) : ici, c'est la borne de ce que la
 * politique accepte quand un acheteur fait une offre sur un lot.
 */
export const bundleOfferPolicy = z.object({
  enabled: z.boolean().default(true),
  /** Remise maximale sur le total affiché du lot (toujours bornée par la somme des planchers réels). */
  maxDiscountRate: rate.default(0.25),
  /** En dessous, ce n'est pas un lot : chaque article se négocie seul. */
  minItems: z.number().int().min(2).max(20).default(2),
});
export type BundleOfferPolicy = z.infer<typeof bundleOfferPolicy>;

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
  /** Offre d'un acheteur sur un lot : bornes de la politique (`evaluateBundleOffer`). */
  bundle: bundleOfferPolicy.default({}),
  priceDrops: z.object({
    enabled: z.boolean().default(false),
    afterDays: z.number().int().min(1).max(90).default(10),
    rate: rate.default(0.05),
    /** Jamais en dessous de cette part du prix initial. */
    floorRate: rate.default(0.7),
  }).default({}),
  messages: z.object({
    greeting: message("Bonjour {prenom}, merci pour votre intérêt pour « {article} » !"),
    /** Contre-offre au-dessus du plancher : formule neutre (jamais « meilleur prix » quand le plancher est plus bas). */
    counter: message("Je peux vous le faire à {prix}. Si cela vous convient, faites l'offre à ce montant."),
    /** Offre finale, au prix plancher : seul gabarit qui parle de « dernier prix » ; l'état dépend de l'article, on n'en parle pas. */
    final: message("Je peux aller jusqu'à {prix}, c'est mon dernier prix pour cet article. Si cela vous convient, faites l'offre à ce montant."),
    afterFinal: message("Si vous changez d'avis, l'offre à {prix} reste valable jusqu'à ce soir."),
    accepted: message("Parfait, c'est d'accord pour {prix} ! Je prépare le colis dès votre achat."),
    fallback: message("Je comprends, ce prix est trop bas pour moi. Ajoutez l'article en favori : je vous préviendrai en cas de baisse."),
    /** Lot : contre-offre au-dessus du plancher du lot (formule neutre, D20). Variables : {prenom}, {prix}, {prix_initial}, {nb_articles}. */
    bundleCounter: message("Pour le lot de {nb_articles} articles, je peux vous le faire à {prix}. Si cela vous convient, faites l'offre à ce montant."),
    /** Lot : offre finale, au plancher du lot : seul gabarit de lot qui parle de « dernier prix ». */
    bundleFinal: message("Pour le lot de {nb_articles} articles, je peux aller jusqu'à {prix}, c'est mon dernier prix pour ce lot. Si cela vous convient, faites l'offre à ce montant."),
    bundleAccepted: message("Parfait, c'est d'accord pour le lot de {nb_articles} articles à {prix} ! Je prépare le colis dès votre achat."),
    /**
     * Relance après 24 h sans réponse (`follow_up_24h`) : courte, polie, sans pression, sans prix ni
     * chiffre (la validation de l'IA refuse tout chiffre dans une relance). Variables : {prenom}, {article}.
     */
    followUp: message("Bonjour {prenom}, je me permets un petit message : « {article} » est toujours disponible. Si vous avez une question, je suis là."),
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

/**
 * Situation personnalisée déclenchée par des mots-clés (§5.12). Les mots-clés sont comparés au message
 * de l'acheteur après normalisation (accents, casse, ponctuation) ; le message reste une DONNÉE non
 * fiable : il n'est jamais interprété, seulement comparé. La réponse est un gabarit, ou une rédaction
 * par mon IA perso cadrée par `guidance` (une consigne du vendeur, transmise comme réglage, jamais
 * comme texte libre). `decisionOverride: "escalate"` transmet la conversation au vendeur quelle que
 * soit la décision de prix (ex. « défaut », « remboursement »).
 */
export const SITUATION_MATCH_MODES = ["any", "all"] as const;
export const situationMatchMode = z.enum(SITUATION_MATCH_MODES);
export type SituationMatchMode = z.infer<typeof situationMatchMode>;
export const SITUATION_RESPONSE_KINDS = ["template", "ai"] as const;
export const situationResponseKind = z.enum(SITUATION_RESPONSE_KINDS);
export type SituationResponseKind = z.infer<typeof situationResponseKind>;
export const SITUATION_DECISION_OVERRIDES = ["escalate"] as const;
export const situationDecisionOverride = z.enum(SITUATION_DECISION_OVERRIDES);
export type SituationDecisionOverride = z.infer<typeof situationDecisionOverride>;

export const keywordSituation = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  /** Mots ou expressions (2 à 60 caractères), normalisés à la comparaison. */
  keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(20),
  matchMode: situationMatchMode.default("any"),
  response: z.object({
    kind: situationResponseKind.default("template"),
    /** Gabarit (variables {prenom}, {article}, {prix}) quand `kind` vaut « template ». */
    template: z.string().trim().max(600).optional(),
    tone: z.enum(["neutral", "friendly", "concise"]).optional(),
    /** Consigne du vendeur pour mon IA perso (ton, contenu), 300 caractères au plus. Jamais une décision de prix. */
    guidance: z.string().trim().max(300).optional(),
  }).default({}),
  decisionOverride: situationDecisionOverride.nullable().default(null),
  enabled: z.boolean().default(true),
});
export type KeywordSituation = z.infer<typeof keywordSituation>;
export type KeywordSituationInput = z.input<typeof keywordSituation>;

/**
 * Limites de Vinted sur la messagerie (contre-offres par conversation, durée d'une offre, délai entre
 * deux messages). **INCONNUES tant qu'elles n'ont pas été mesurées sur un vrai compte** : les valeurs
 * par défaut sont prudentes (`source: "default_conservative"`), jamais présentées comme vérifiées. Le
 * protocole de mesure est dans `packages/domain/src/negotiation-limits.ts` et docs/NEGOCIATION.md ; les
 * valeurs mesurées s'enregistrent avec leur date (`source: "measured"`, `measuredAt`).
 */
export const VINTED_LIMIT_SOURCES = ["default_conservative", "measured"] as const;
export const vintedLimitSource = z.enum(VINTED_LIMIT_SOURCES);
export type VintedLimitSource = z.infer<typeof vintedLimitSource>;

/** Les trois valeurs mesurables, avec leurs bornes (sans valeur par défaut : une mesure se saisit en entier). */
const vintedLimitValues = {
  /** Contre-offres qu'un vendeur peut envoyer dans une même conversation. */
  maxCounterOffersPerConversation: z.number().int().min(1).max(20),
  /** Durée pendant laquelle une offre envoyée reste valable (heures). */
  offerDurationHours: z.number().int().min(1).max(168),
  /** Délai minimal entre deux messages sortants dans une conversation (secondes). */
  minDelayBetweenMessagesSeconds: z.number().int().min(0).max(3600),
};

export const vintedLimits = z.object({
  /** Valeur prudente : 3 contre-offres. */
  maxCounterOffersPerConversation: vintedLimitValues.maxCounterOffersPerConversation.default(3),
  /** Valeur prudente : 48 h. */
  offerDurationHours: vintedLimitValues.offerDurationHours.default(48),
  /** Valeur prudente : 60 s. */
  minDelayBetweenMessagesSeconds: vintedLimitValues.minDelayBetweenMessagesSeconds.default(60),
  /** Date de la dernière mesure sur un vrai compte (null : jamais mesuré). */
  measuredAt: isoDate.nullable().default(null),
  source: vintedLimitSource.default("default_conservative"),
});
export type VintedLimits = z.infer<typeof vintedLimits>;
/** Valeurs prudentes par défaut, marquées « à mesurer ». */
export const VINTED_LIMITS_DEFAULTS: VintedLimits = vintedLimits.parse({});

/** Enregistrement d'une mesure (écran « Limites Vinted ») : les trois valeurs, obligatoires ; la source et la date sont fixées par le serveur. */
export const vintedLimitsMeasurementInput = z.object(vintedLimitValues);
export type VintedLimitsMeasurementInput = z.infer<typeof vintedLimitsMeasurementInput>;

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
    /** Situations personnalisées par mots-clés (vide par défaut ; `SUGGESTED_KEYWORD_SITUATIONS` propose des exemples). */
    situations: z.array(keywordSituation).max(50).default([]),
  }).default({}),
  negotiation: negotiationAutomation.default({}),
  /** Limites de Vinted : valeurs prudentes « à mesurer » tant qu'aucune mesure n'est enregistrée. */
  vintedLimits: vintedLimits.default({}),
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

/**
 * Estimation des prix : partage des ventes de l'organisation avec la base de références commune.
 * DÉSACTIVÉ par défaut (accord explicite de l'organisation, à faire valider juridiquement, partie 7) :
 * activé, les ventes payées sont versées chaque nuit dans la base SANS donnée personnelle et servent
 * seulement à l'entraînement agrégé du modèle de prix (jamais montrées une à une à une autre
 * organisation) ; désactivé, les ventes déjà versées sont retirées de la base.
 */
export const pricingSettings = z.object({
  shareSales: z.boolean().default(false),
});
export type PricingSettings = z.infer<typeof pricingSettings>;

/**
 * Seuils de déclaration (§5.14) : à partir de 2026, les plateformes transmettent à l'administration
 * les vendeurs qui dépassent, sur l'année, 30 ventes OU 2 000 € encaissés. Selio informe quand on s'en
 * approche ; ce n'est jamais un conseil fiscal (« renseignez-vous auprès de l'administration »).
 * Paramétrables au cas où les seuils changent ; `year` : année d'entrée en vigueur des valeurs par défaut.
 */
export const DECLARATION_THRESHOLDS_2026 = { salesCount: 30, revenueCents: 200_000, year: 2026 } as const;
export const declarationThresholds = z.object({
  /** Alerte affichée dans les analyses et le tableau de bord. */
  enabled: z.boolean().default(true),
  salesCount: z.number().int().min(1).max(100_000).default(DECLARATION_THRESHOLDS_2026.salesCount),
  revenueCents: nonNegCents.min(100).default(DECLARATION_THRESHOLDS_2026.revenueCents),
  /** Part du seuil à partir de laquelle on prévient (0,8 = 80 %). */
  approachingRate: rate.min(0.1).max(0.99).default(0.8),
});
export type DeclarationThresholds = z.infer<typeof declarationThresholds>;

/**
 * Lots intelligents (§5.14) : propositions de lots à partir des signaux (même acheteur intéressé par
 * plusieurs articles, même marque et taille, articles anciens). Les remises de lot restent celles de
 * `automation.negotiation.lot` et ne descendent jamais sous le plancher de lot (somme des planchers).
 */
export const bundleSettings = z.object({
  enabled: z.boolean().default(true),
  /** Articles au plus dans une proposition. */
  maxItems: z.number().int().min(2).max(6).default(4),
  /** Un article est « ancien » au-delà de ce nombre de jours en ligne (sinon en stock). */
  staleAfterDays: z.number().int().min(7).max(365).default(60),
  /** Nombre d'articles d'un même acheteur à partir duquel on propose un lot. */
  sameBuyerMinItems: z.number().int().min(2).max(6).default(2),
  /** Propositions au plus par passage. */
  maxSuggestions: z.number().int().min(1).max(50).default(10),
});
export type BundleSettings = z.infer<typeof bundleSettings>;

export const orgSettings = z.object({
  currency: currency.default("EUR"),
  timezone: z.string().min(1).max(64).default("Europe/Paris"),
  locale: z.enum(["fr-FR"]).default("fr-FR"),
  margin: marginRules.default({}),
  ai: aiSettings.default({}),
  notifications: notificationSettings.default({}),
  buyerFees: buyerFees.default({}),
  autoBuy: autoBuySettings.default({}),
  radar: radarSettings.default({}),
  dressing: dressingSettings.default({}),
  automation: automationSettings.default({}),
  pricing: pricingSettings.default({}),
  thresholds: declarationThresholds.default({}),
  bundles: bundleSettings.default({}),
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

export const PLANS = ["free", "starter", "pro", "agence"] as const;
export const plan = z.enum(PLANS);
export type Plan = z.infer<typeof plan>;

/** Plans payants (ceux qu'un paiement peut ouvrir) ; « free » est l'accès de base sans abonnement. */
export const PAID_PLANS = ["starter", "pro", "agence"] as const;
export const paidPlan = z.enum(PAID_PLANS);
export type PaidPlan = z.infer<typeof paidPlan>;

/** Relance après 24 h sans réponse : absente, proposée (brouillon) ou automatique (via le Cloud). */
export const FOLLOW_UP_24H_MODES = ["none", "suggested", "auto"] as const;
export const followUp24hMode = z.enum(FOLLOW_UP_24H_MODES);
export type FollowUp24hMode = z.infer<typeof followUp24hMode>;

const quota = z.number().int().min(0);

/**
 * Quotas d'un plan. Les champs par filiale (Studio, Track, Cloud, relance) sont arrivés après
 * les premiers abonnements : ils sont optionnels à la lecture, avec 0 / false / « none » par
 * défaut, pour que le JSON `quotas` déjà en base reste lisible par le schéma. `quotasForPlan`
 * donne le jeu complet ; `resolveQuotas` remplace un ancien JSON par les quotas du plan.
 */
export const planQuotas = z.object({
  items: quota,
  aiRequestsPerMonth: quota,
  automationActionsPerDay: quota,
  connections: quota,
  members: quota,
  /** Selio Studio : annonces générées par mois (0 = Studio non inclus). */
  studioListingsPerMonth: quota.default(0),
  /** Selio Studio : photos portées par mois. */
  wornPhotosPerMonth: quota.default(0),
  /** Selio Track : filtres suivis en permanence. */
  trackFiltersFollowed: quota.default(0),
  /** Selio Track : scans de niche par mois. */
  trackScansPerMonth: quota.default(0),
  /** Selio Track : recherches par photo par mois. */
  trackPhotoSearchesPerMonth: quota.default(0),
  /** Selio Track : profondeur d'historique, en mois. */
  trackHistoryMonths: quota.default(0),
  /** Selio Cloud compris dans l'offre (sinon en option). */
  cloudIncluded: z.boolean().default(false),
  followUp24h: followUp24hMode.default("none"),
});
export type PlanQuotas = z.infer<typeof planQuotas>;
/** Forme acceptée en entrée (anciens JSON sans les champs par filiale). */
export type PlanQuotasInput = z.input<typeof planQuotas>;

/** Quotas par plan (partagés web, API, worker). */
export const PLAN_QUOTAS: Record<Plan, PlanQuotas> = {
  free: { items: 50, aiRequestsPerMonth: 50, automationActionsPerDay: 10, connections: 1, members: 1, studioListingsPerMonth: 0, wornPhotosPerMonth: 0, trackFiltersFollowed: 0, trackScansPerMonth: 0, trackPhotoSearchesPerMonth: 0, trackHistoryMonths: 0, cloudIncluded: false, followUp24h: "none" },
  starter: { items: 500, aiRequestsPerMonth: 300, automationActionsPerDay: 100, connections: 1, members: 1, studioListingsPerMonth: 0, wornPhotosPerMonth: 0, trackFiltersFollowed: 0, trackScansPerMonth: 0, trackPhotoSearchesPerMonth: 0, trackHistoryMonths: 0, cloudIncluded: false, followUp24h: "none" },
  pro: { items: 5000, aiRequestsPerMonth: 1500, automationActionsPerDay: 500, connections: 3, members: 3, studioListingsPerMonth: 20, wornPhotosPerMonth: 10, trackFiltersFollowed: 5, trackScansPerMonth: 10, trackPhotoSearchesPerMonth: 30, trackHistoryMonths: 3, cloudIncluded: false, followUp24h: "suggested" },
  agence: { items: 20000, aiRequestsPerMonth: 5000, automationActionsPerDay: 2000, connections: 10, members: 10, studioListingsPerMonth: 60, wornPhotosPerMonth: 30, trackFiltersFollowed: 25, trackScansPerMonth: 50, trackPhotoSearchesPerMonth: 150, trackHistoryMonths: 12, cloudIncluded: true, followUp24h: "auto" },
};

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

/** Jeu complet de quotas d'un plan (copie) ; un plan inconnu reçoit l'accès de base. */
export function quotasForPlan(plan: Plan | string): PlanQuotas {
  return { ...PLAN_QUOTAS[isPlan(plan) ? plan : "free"] };
}

/** Complète un JSON de quotas (ancien abonnement) avec les valeurs par défaut des champs manquants. */
export function completeQuotas(raw: PlanQuotasInput): PlanQuotas {
  return planQuotas.parse(raw);
}

/**
 * Un JSON de quotas est « ancien » s'il date d'avant les offres 1/3/10 (semaine 1) : il n'a pas
 * les champs par filiale. Ses valeurs (3 000 réponses, 5 comptes, 10 membres pour l'ancien Pro)
 * ne correspondent plus à aucune offre et ne valent pas « sur mesure » : on repart du plan.
 */
export function isLegacyQuotas(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !("studioListingsPerMonth" in raw);
}

/**
 * Quotas effectifs d'un abonnement : le JSON stocké s'il est complet (devis sur mesure compris),
 * ceux du plan s'il est ancien ou illisible. La migration 0008 réécrit les anciens JSON en base ;
 * cette fonction protège aussi les lignes qu'elle n'aurait pas vues (fixtures, insertions directes).
 */
export function resolveQuotas(plan: Plan | string, raw: unknown): PlanQuotas {
  if (isLegacyQuotas(raw)) return quotasForPlan(plan);
  const parsed = planQuotas.safeParse(raw);
  return parsed.success ? parsed.data : quotasForPlan(plan);
}

export const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled", "incomplete"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Fournisseurs de paiement : « none » (aucun paiement réel, essai ou accès de base) et Revolut
 * (Merchant API). L'ancien adaptateur de test a été retiré ; la migration 0009 ramène les
 * lignes d'un fournisseur disparu à « none ».
 */
export const SUBSCRIPTION_PROVIDERS = ["none", "revolut"] as const;
export const subscriptionProvider = z.enum(SUBSCRIPTION_PROVIDERS);
export type SubscriptionProvider = z.infer<typeof subscriptionProvider>;

/** Périodicité de l'abonnement : au mois, ou à l'année (10 mois payés sur 12). */
export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export const billingCycle = z.enum(BILLING_CYCLES);
export type BillingCycle = z.infer<typeof billingCycle>;

/**
 * Essai gratuit : un seul choix, 14 jours, avec toutes les fonctions et limites du plan Pro.
 * La carte est enregistrée dès le début (`subscription.cardOnFile`) et rien n'est débité
 * avant la fin de l'essai. Les anciennes durées (7 et 30 jours, offre Découverte) ne sont
 * plus proposées : un client web pas encore mis à jour qui les envoie est ramené à 14 jours.
 */
export const TRIAL_DAYS = 14;
export const TRIAL_DAYS_OPTIONS = [TRIAL_DAYS] as const;
export type TrialDays = (typeof TRIAL_DAYS_OPTIONS)[number];
export const DEFAULT_TRIAL_DAYS: TrialDays = TRIAL_DAYS;
export const TRIAL_PLAN: Plan = "pro";
/** Anciennes durées encore tolérées en entrée (ramenées à 14). */
export const LEGACY_TRIAL_DAYS = [7, 30] as const;
export const trialDays = z.preprocess(
  (v) => ((LEGACY_TRIAL_DAYS as readonly number[]).includes(v as number) ? TRIAL_DAYS : v),
  z.literal(TRIAL_DAYS),
);

export const subscription = z.object({
  id,
  orgId: id,
  plan: plan.default("free"),
  status: z.enum(SUBSCRIPTION_STATUSES).default("none"),
  provider: subscriptionProvider.default("none"),
  externalRef: z.string().max(120).nullable().default(null),
  currentPeriodEnd: isoDate.nullable().default(null),
  quotas: planQuotas,
  /** Carte enregistrée chez le fournisseur de paiement (demandée dès l'essai, rien débité avant la fin). */
  cardOnFile: z.boolean().default(false),
  /** Résiliation demandée : l'abonnement s'arrête à la fin de la période en cours. */
  cancelAtPeriodEnd: z.boolean().default(false),
  /** Mode test du fournisseur (bac à sable Revolut) tant que l'activation du mode live n'est pas volontaire. */
  testMode: z.boolean().default(true),
  /** Identifiant du client chez Revolut (créé au premier paiement). Jamais une donnée de carte. */
  revolutCustomerId: z.string().max(120).nullable().default(null),
  /** Identifiant du moyen de paiement enregistré « pour le marchand » chez Revolut ; jamais le numéro de carte. */
  paymentMethodId: z.string().max(120).nullable().default(null),
  cycle: billingCycle.default("monthly"),
  /** Offre choisie pour le prochain renouvellement (changement d'offre, ou offre retenue pendant l'essai). */
  pendingPlan: plan.nullable().default(null),
  /** Débits échoués sur l'échéance en cours (0 quand le dernier débit a réussi). */
  chargeAttempts: z.number().int().min(0).default(0),
  /** Prochaine tentative de débit après un échec (J+1, J+3, J+7 après l'échéance). */
  nextChargeAt: isoDate.nullable().default(null),
  /** Motif du dernier échec de débit, sans donnée de carte. */
  lastChargeError: z.string().max(500).nullable().default(null),
  /** Après le retour à l'accès de base : les données sont conservées jusqu'à cette date. */
  dataRetentionUntil: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Subscription = z.infer<typeof subscription>;

/**
 * Compteurs d'utilisation. Les compteurs par filiale (Studio, Track, Cloud) sont remis à zéro
 * le 1er du mois (UTC), comme les requêtes IA.
 */
export const USAGE_EVENT_KINDS = [
  "ai.request",
  "automation.action",
  "connector.sync",
  "export.csv",
  "extension.capture",
  "studio.listing",
  "studio.worn_photo",
  "track.scan",
  "track.photo_search",
  /**
   * Empreinte de filtre Track retirée (filtre supprimé, ou critères changés) : sert au rythme des
   * lectures (une empreinte retirée garde sa place 2 h), jamais facturé.
   */
  "track.filter_change",
  "cloud.action",
] as const;
export const usageEventKind = z.enum(USAGE_EVENT_KINDS);
export type UsageEventKind = z.infer<typeof usageEventKind>;

export const usageEvent = z.object({
  id,
  orgId: id,
  kind: usageEventKind,
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
  /** Durée de l'essai : 14 jours (seul choix ; 7 et 30 envoyés par d'anciens clients sont ramenés à 14). */
  trialDays: trialDays.default(DEFAULT_TRIAL_DAYS),
});
export const loginInput = z.object({ email, password: z.string().min(1).max(200) });

export const orgUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: orgSettings.partial().optional(),
});
export const inviteInput = z.object({ email, role });
