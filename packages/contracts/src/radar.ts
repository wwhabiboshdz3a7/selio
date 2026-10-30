import { z } from "zod";
import { id, isoDate, nonNegCents, rate } from "./common";
import { itemCategory, itemCondition } from "./inventory";

// ---------------------------------------------------------------- rythme, garde-fous et textes

/**
 * Source des annonces d'une recherche : le simulateur de démonstration, ou la lecture EN DIRECT des
 * pages de recherche Vinted depuis le compte Achat du client, par Selio Cloud (session chiffrée du
 * compte, accord Cloud enregistré). Jamais depuis un compte Perso ou un compte de vente.
 */
export const RADAR_SOURCES = ["demo", "cloud"] as const;
export const radarSource = z.enum(RADAR_SOURCES);
export type RadarSourceKind = z.infer<typeof radarSource>;

export const RADAR_SOURCE_LABELS: Record<RadarSourceKind, string> = {
  demo: "Simulateur (démonstration)",
  cloud: "En direct, depuis le compte Achat (Selio Cloud)",
};

/** Relecture d'une recherche en direct : toutes les 60 s (Radar). */
export const RADAR_READ_INTERVAL_SECONDS = 60;
/** Relecture d'une recherche prioritaire quand Radar Auto est actif : toutes les 30 s. */
export const RADAR_PRIORITY_INTERVAL_SECONDS = 30;
/** Le simulateur de démonstration garde son rythme d'avant (une fois par heure). */
export const RADAR_DEMO_INTERVAL_SECONDS = 3600;
/** Recherches prioritaires (Radar Auto) par organisation. */
export const RADAR_MAX_PRIORITY_SEARCHES = 3;
/**
 * Ralentissement automatique : au-delà de 1 blocage (CAPTCHA, « trop de requêtes », blocage) pour
 * 1 000 pages lues, sur les 1 000 dernières lectures en direct de l'organisation (fenêtre glissante),
 * l'intervalle double (60 → 120 → 240 s…). Retour progressif : le facteur est divisé par deux par
 * tranche de 24 h sans blocage.
 */
export const RADAR_BLOCKS_PER_1000_THRESHOLD = 1;
export const RADAR_SLOWDOWN_WINDOW_READS = 1000;
export const RADAR_SLOWDOWN_RECOVERY_HOURS = 24;
export const RADAR_MAX_SLOWDOWN_FACTOR = 64;
/** Plafond de pages lues en direct par minute et par organisation (réglage `settings.radar`). */
export const RADAR_DEFAULT_MAX_PAGES_PER_MINUTE = 10;
/**
 * Passage du worker (`radar.tick`) toutes les 30 s : la dernière lecture d'une recherche est datée de
 * l'heure prévue du passage (et non de la fin des lectures précédentes de l'organisation), avec une
 * tolérance de 5 s pour l'horloge des passages. Le plafond de pages par minute reste la limite dure.
 */
export const RADAR_TICK_SECONDS = 30;
export const RADAR_DUE_TOLERANCE_SECONDS = 5;
/**
 * Pages non reconnues (adaptateur à revoir, vérification que le détecteur ne connaît pas), erreurs ou
 * délais dépassés CONSÉCUTIFS sur une recherche en direct : au-delà, la lecture de la recherche est
 * arrêtée (recherche désactivée, client et opérateur alertés) et le ralentissement s'applique.
 */
export const RADAR_MAX_CONSECUTIVE_ANOMALIES = 3;
/**
 * Stock initial : à la première lecture en direct d'une recherche, et pour les annonces publiées avant
 * la lecture précédente (marge de 2 min pour les dates « il y a N min »), ou lues après une coupure de
 * plus de 30 min sans date de publication : pas d'alerte, pas de Radar Auto, hors de la mesure du délai.
 */
export const RADAR_INITIAL_STOCK_GRACE_MINUTES = 2;
export const RADAR_CATCHUP_GAP_MINUTES = 30;
/**
 * Radar Auto : coût total accepté au paiement = coût décidé à la détection + 1 € de marge (arrondis de
 * la protection acheteur), + 8 € si le port n'était pas affiché sur la page de recherche ; jamais
 * au-dessus du prix maximum par article, du reste du plafond du jour, ni d'un coût qui annulerait la
 * marge estimée.
 */
export const RADAR_AUTO_PRICE_TOLERANCE_CENTS = 100;
export const RADAR_AUTO_UNSHOWN_SHIPPING_ALLOWANCE_CENTS = 800;
/** Mesures de lecture (`radar_reads`) gardées 90 jours. */
export const RADAR_READS_RETENTION_DAYS = 90;
/**
 * Données du vendeur (pseudo, note, photo de l'annonce) : gardées le temps de l'affaire seulement.
 * Une affaire écartée est supprimée 30 jours après ; les autres perdent ces champs après 30 jours.
 */
export const RADAR_OPPORTUNITY_PERSONAL_DATA_DAYS = 30;
/**
 * Délai laissé au client pour valider un paiement 3-D Secure dans son application bancaire (à mesurer sur
 * un vrai achat). Même valeur que le défaut de CLOUD_3DS_TIMEOUT_MS (600000 ms) : la page Radar Auto
 * affiche le délai que le serveur applique par défaut.
 */
export const RADAR_3DS_TIMEOUT_MINUTES = 10;
/** Une alerte non envoyée après ce délai n'a plus d'intérêt (l'affaire est partie). */
export const RADAR_ALERT_MAX_AGE_HOURS = 12;
/** Estimation par similarité (modèle 2) : 8 ventes les plus proches, similarité cosinus d'au moins 0,6. */
export const RADAR_EMBEDDING_TOP_K = 8;
export const RADAR_EMBEDDING_MIN_SIMILARITY = 0.6;
/** Note minimale par défaut d'une alerte : le seuil « À valider » (REVIEW_THRESHOLD de @selio/domain). */
export const RADAR_ALERT_MIN_SCORE_DEFAULT = 75;

/** Erreur claire quand une recherche en direct n'a pas de compte Achat relié au Cloud. */
export const RADAR_LIVE_REQUIRES_CLOUD = "Radar en direct demande Selio Cloud activé sur le compte Achat";
/** Mention visible : Radar Auto n'est pas ouvert aux clients (décision d'Ibrahim en attente). */
export const RADAR_AUTO_SHARED_ADDRESS_NOTICE =
  "Radar Auto n'est pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché : il reste réservé aux comptes de l'équipe Selio, pour les tests.";

// ---------------------------------------------------------------- recherches

export const radarCriteria = z.object({
  brands: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  categories: z.array(itemCategory).max(10).default([]),
  sizes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  conditions: z.array(itemCondition).max(5).default([]),
  maxPriceCents: nonNegCents.default(5000),
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});
export type RadarCriteria = z.infer<typeof radarCriteria>;

export const radarSearch = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(120),
  criteria: radarCriteria.default({}),
  budgetCents: nonNegCents.default(20000),
  targetMarginRate: rate.default(0.4),
  targetMarginCents: nonNegCents.default(1000),
  enabled: z.boolean().default(true),
  provider: z.enum(["demo", "vinted"]).default("demo"),
  /** Simulateur ou lecture en direct depuis le compte Achat (Selio Cloud). */
  source: radarSource.default("demo"),
  /** Recherche prioritaire de Radar Auto (relue toutes les 30 s) : 3 au plus par organisation. */
  priority: z.boolean().default(false),
  /** Compte Vinted « Achat » lu (null : celui de l'achat automatique, sinon le premier compte Achat actif). */
  connectionId: id.nullable().default(null),
  lastRunAt: isoDate.nullable().default(null),
  /** Intervalle de lecture effectif en secondes (lecture seule, calculé par le serveur). */
  intervalSeconds: z.number().int().min(1).optional(),
  /**
   * Facteur de ralentissement fixé au dernier blocage (1 = rythme normal). Le facteur courant, divisé
   * par deux par tranche de 24 h sans blocage, est rendu par le serveur dans les listes.
   */
  slowdownFactor: z.number().int().min(1).max(RADAR_MAX_SLOWDOWN_FACTOR).default(1),
  /** Dernière lecture (simulée ou en direct). */
  lastReadAt: isoDate.nullable().default(null),
  /** Dernier blocage de Vinted (CAPTCHA, avertissement, « trop de requêtes », blocage) sur une lecture. */
  lastBlockAt: isoDate.nullable().default(null),
  /** Pages réellement lues en direct (le simulateur ne compte pas). */
  pagesRead: z.number().int().min(0).default(0),
  blocksCount: z.number().int().min(0).default(0),
  /** Lectures en direct anormales consécutives (page non reconnue, erreur, délai) : arrêt à RADAR_MAX_CONSECUTIVE_ANOMALIES. */
  consecutiveFailures: z.number().int().min(0).default(0),
  /** Pourquoi la lecture en direct a été arrêtée par Selio (null : pas d'arrêt). Effacé quand le client réactive. */
  suspendedReason: z.string().max(300).nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RadarSearch = z.infer<typeof radarSearch>;

/** Champs fixés par le serveur : jamais saisis par le client. */
export const radarSearchCreate = radarSearch.omit({
  id: true, orgId: true, createdAt: true, updatedAt: true, lastRunAt: true,
  intervalSeconds: true, slowdownFactor: true, lastReadAt: true, lastBlockAt: true, pagesRead: true, blocksCount: true,
  consecutiveFailures: true, suspendedReason: true,
});
export type RadarSearchCreate = z.input<typeof radarSearchCreate>;
export const radarSearchUpdate = radarSearchCreate.partial();

// ---------------------------------------------------------------- annonces lues (catalogue)

/**
 * Annonce lue sur une page de recherche Vinted (ou produite par le simulateur). Donnée NON FIABLE :
 * elle vient d'une page tierce, le serveur la valide avant tout usage. Le pseudo, la note du vendeur
 * et la photo ne servent que le temps de l'affaire (purge, voir RADAR_OPPORTUNITY_PERSONAL_DATA_DAYS).
 */
export const radarCatalogItem = z.object({
  /** Identifiant numérique de l'annonce chez Vinted (dédoublonnage). */
  externalRef: z.string().trim().regex(/^\d{1,20}$/).nullable().default(null),
  title: z.string().trim().min(1).max(200),
  priceCents: nonNegCents,
  /** Port affiché (null : non affiché sur la page de recherche). */
  shippingCents: nonNegCents.nullable().default(null),
  brand: z.string().trim().max(80).nullable().default(null),
  size: z.string().trim().max(40).nullable().default(null),
  condition: itemCondition.nullable().default(null),
  category: itemCategory.nullable().default(null),
  url: z.string().trim().max(500).nullable().default(null),
  photoUrl: z.string().trim().max(2000).nullable().default(null),
  photoCount: z.number().int().min(0).max(30).nullable().default(null),
  sellerHandle: z.string().trim().max(80).nullable().default(null),
  sellerRating: z.number().min(0).max(5).nullable().default(null),
  sellerReviews: z.number().int().min(0).nullable().default(null),
  /** Date de publication, si la page la montre (délai publication → détection). */
  publishedAt: isoDate.nullable().default(null),
  /**
   * Origine de la date : horodatage `absolute` de la page, ou estimée depuis un texte `relative`
   * (« il y a 3 min » : à la minute près, « il y a 2 h » : à l'heure près). Seules les dates absolues
   * ou à la minute près entrent dans la médiane publication → détection.
   */
  publishedAtSource: z.enum(["absolute", "relative", "unknown"]).default("unknown"),
});
export type RadarCatalogItem = z.infer<typeof radarCatalogItem>;
export type RadarCatalogItemInput = z.input<typeof radarCatalogItem>;

// ---------------------------------------------------------------- affaires

export const OPPORTUNITY_STATUSES = ["new", "watching", "purchased", "dismissed"] as const;
export const opportunityStatus = z.enum(OPPORTUNITY_STATUSES);

/** Séparation stricte : ce qui a été observé vs ce qui est estimé. */
export const opportunity = z.object({
  id,
  orgId: id,
  searchId: id,
  title: z.string().trim().min(1).max(200),
  observed: z.object({
    priceCents: nonNegCents,
    shippingCents: nonNegCents.default(0),
    brand: z.string().max(80).nullable().default(null),
    size: z.string().max(40).nullable().default(null),
    condition: itemCondition.nullable().default(null),
    category: itemCategory.nullable().default(null),
    sellerHandle: z.string().max(80).nullable().default(null),
    /** Note moyenne du vendeur (sur 5) et nombre d'évaluations, si visibles. */
    sellerRating: z.number().min(0).max(5).nullable().default(null),
    sellerReviews: z.number().int().min(0).nullable().default(null),
    /** Photo principale de l'annonce observée (URL ou data URL en démo). */
    photoUrl: z.string().max(200_000).nullable().default(null),
    photoCount: z.number().int().min(0).max(30).nullable().default(null),
    url: z.string().max(500).nullable().default(null),
    seenAt: isoDate,
    source: z.enum(["demo_simulator", "extension_capture", "connector"]),
    /** Identifiant de l'annonce chez Vinted (dédoublonnage), si connu. */
    externalRef: z.string().max(40).nullable().optional(),
    /** Publication de l'annonce, si la page la montre. */
    publishedAt: isoDate.nullable().optional(),
    /** Détection par Selio (lecture qui a trouvé l'annonce). */
    detectedAt: isoDate.nullable().optional(),
    /** Origine de la date de publication (voir `radarCatalogItem.publishedAtSource`). */
    publishedAtSource: z.enum(["absolute", "relative", "unknown"]).optional(),
    /** Faux : le port n'était pas affiché sur la page de recherche (compté 0, vérifié au paiement). */
    shippingShown: z.boolean().optional(),
    /**
     * Stock initial (première lecture, annonce publiée avant la lecture précédente, reprise après une
     * coupure) : visible dans la liste, mais ni alerte, ni Radar Auto, ni mesure du délai de détection.
     */
    initialStock: z.boolean().optional(),
  }),
  estimate: z.object({
    resalePriceCents: nonNegCents,
    expectedFeesCents: nonNegCents.default(0),
    marginCents: z.number().int(),
    marginRate: z.number(),
    confidence: z.enum(["low", "medium", "high"]),
    /** « embeddings » (ventes proches, modèle 2) ou « brand_category » (marque et catégorie) ; texte libre pour les anciennes affaires. */
    method: z.string().max(200),
    comparableCount: z.number().int().min(0).default(0),
  }),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().max(200)).default([]),
  /** Détail de la note par critère (points obtenus / maximum). */
  breakdown: z.array(z.object({ key: z.string().max(40), label: z.string().max(80), points: z.number(), max: z.number() })).default([]),
  status: opportunityStatus.default("new"),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Opportunity = z.infer<typeof opportunity>;
/** Forme acceptée à la création (champs munis d'une valeur par défaut facultatifs, y compris dans `observed`). */
export type OpportunityInput = z.input<typeof opportunity>;

/** Méthodes d'estimation de la revente. */
export const ESTIMATE_METHODS = ["embeddings", "brand_category"] as const;
export type EstimateMethod = (typeof ESTIMATE_METHODS)[number];

// ---------------------------------------------------------------- achats

/**
 * Statuts d'une demande d'achat. `awaiting_3ds` : la banque du client demande une validation
 * 3-D Secure ; l'achat attend le client (notification), Selio ne saisit jamais de code à sa place.
 * `draft` sert aussi de réservation pendant qu'un achat automatique est en cours.
 */
export const PURCHASE_STATUSES = ["draft", "awaiting_confirmation", "awaiting_3ds", "simulated", "blocked", "executed", "cancelled"] as const;
export const purchaseStatus = z.enum(PURCHASE_STATUSES);
export type PurchaseStatus = z.infer<typeof purchaseStatus>;

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "En cours",
  awaiting_confirmation: "À confirmer",
  awaiting_3ds: "Validation bancaire attendue",
  simulated: "Acheté (simulé)",
  blocked: "Bloqué",
  executed: "Acheté",
  cancelled: "Annulé",
};

export const purchaseRequest = z.object({
  id,
  orgId: id,
  opportunityId: id,
  dedupeKey: z.string().min(1).max(200),
  maxPriceCents: nonNegCents,
  budgetCents: nonNegCents,
  status: purchaseStatus.default("draft"),
  /** manual = validé à la main (« À valider ») ; auto = déclenché par l'achat automatique. */
  mode: z.enum(["manual", "auto"]).default("manual"),
  /** Fin du délai d'annulation d'un achat automatique (null = pas de délai). */
  cancelableUntil: isoDate.nullable().default(null),
  /** Compte Vinted « Achat » utilisé (null = aucun compte Achat au moment de l'achat simulé). */
  connectionId: id.nullable().default(null),
  checks: z
    .array(z.object({ code: z.string().max(60), ok: z.boolean(), label: z.string().max(200) }))
    .default([]),
  /** Achat réel : désactivé par défaut, exige connecteur autorisé + confirmation explicite (D11). */
  realPurchaseEnabled: z.boolean().default(false),
  confirmedAt: isoDate.nullable().default(null),
  executedAt: isoDate.nullable().default(null),
  resultNote: z.string().max(500).nullable().default(null),
  /** Montant total payé (prix + port + protection) : réel après un achat, estimé pour un achat validé à la main. */
  totalCents: nonNegCents.nullable().optional(),
  /** Référence de la commande chez Vinted (achat réel seulement). */
  orderRef: z.string().max(120).nullable().optional(),
  /** Article créé dans Manager avec le prix d'achat (suivi de la marge jusqu'à la revente). */
  reportedItemId: id.nullable().optional(),
  /** Fin du délai laissé au client pour valider le paiement 3-D Secure (statut awaiting_3ds). */
  awaiting3dsUntil: isoDate.nullable().optional(),
  /**
   * Vrai dès que « Payer » a été cliqué par le navigateur (achat réel) : le paiement a pu partir. La
   * demande reste alors comptée dans le plafond du jour, même bloquée ou annulée, jusqu'à vérification.
   */
  paymentAttempted: z.boolean().optional(),
  /** Compte Selio Cloud qui a ouvert le navigateur de l'achat (la reprise 3-D Secure n'en accepte pas d'autre). */
  cloudAccountId: id.nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type PurchaseRequest = z.infer<typeof purchaseRequest>;

// ---------------------------------------------------------------- mesures de lecture

/** Résultat d'une lecture : `blocked` regroupe blocage et avertissement de Vinted. */
export const RADAR_READ_OUTCOMES = ["ok", "blocked", "captcha", "rate_limited", "page_changed", "error", "timeout"] as const;
export const radarReadOutcome = z.enum(RADAR_READ_OUTCOMES);
export type RadarReadOutcome = z.infer<typeof radarReadOutcome>;
/** Lectures arrêtées par Vinted : elles comptent dans le taux de blocage et déclenchent l'arrêt. */
export const RADAR_BLOCK_OUTCOMES = ["blocked", "captcha", "rate_limited"] as const satisfies readonly RadarReadOutcome[];

export const RADAR_READ_OUTCOME_LABELS: Record<RadarReadOutcome, string> = {
  ok: "Lue",
  blocked: "Bloquée ou avertissement de Vinted",
  captcha: "CAPTCHA affiché par Vinted",
  rate_limited: "« Trop de requêtes » de Vinted",
  page_changed: "Page non reconnue (adaptateur à revoir)",
  error: "Erreur technique",
  timeout: "Délai dépassé",
};

/** Ce qu'une mesure compte : la lecture d'une page de recherche, ou les pages ouvertes par un achat Radar Auto. */
export const RADAR_READ_KINDS = ["search", "purchase"] as const;

export const radarRead = z.object({
  id,
  orgId: id,
  kind: z.enum(RADAR_READ_KINDS).default("search"),
  searchId: id.nullable().default(null),
  connectionId: id.nullable().default(null),
  source: radarSource,
  readAt: isoDate,
  durationMs: z.number().int().min(0).default(0),
  outcome: radarReadOutcome,
  itemsSeen: z.number().int().min(0).default(0),
  itemsNew: z.number().int().min(0).default(0),
  /** Pages Vinted chargées (1 pour une page de recherche ; annonce, paiement, confirmation pour un achat). */
  pages: z.number().int().min(0).default(1),
  /** Facteur de ralentissement en vigueur pendant la lecture. */
  factor: z.number().int().min(1).default(1),
  createdAt: isoDate,
});
export type RadarRead = z.infer<typeof radarRead>;

/**
 * Statistiques de Radar : rien n'est présenté comme mesuré tant qu'aucune lecture EN DIRECT n'existe
 * (le simulateur ne compte jamais). Chaque valeur vaut null et `status` « to_measure » (« à mesurer »).
 */
export interface RadarMetrics {
  days: number;
  status: "measured" | "to_measure";
  /** « à mesurer » quand aucune lecture en direct n'existe sur la période. */
  label: string;
  /** Pages lues en direct : pages de recherche et pages ouvertes par les achats de Radar Auto. */
  liveReads: number;
  blocks: number;
  /** Blocages pour 1 000 pages lues en direct. */
  blockRatePer1000: number | null;
  /**
   * Délai médian publication → détection : affaires lues en direct hors stock initial, dont la date de
   * publication est absolue ou à la minute près (« il y a 3 min »).
   */
  medianPublishToDetectSeconds: number | null;
  /** Délai médian détection → achat (achats réels seulement). */
  medianDetectToPurchaseSeconds: number | null;
  readsPerDay: { day: string; reads: number; blocks: number }[];
  /** Facteur de ralentissement courant et intervalle effectif par recherche en direct. */
  searches: { id: string; name: string; factor: number; intervalSeconds: number; lastBlockAt: string | null }[];
}

// ---------------------------------------------------------------- notifications (PWA)

/** Abonnement Web Push d'un appareil (PWA). Les clés ne quittent jamais le serveur. */
export const pushSubscriptionInput = z.object({
  endpoint: z.string().trim().url().max(1000).refine((u) => u.startsWith("https://"), "Adresse https attendue"),
  keys: z.object({
    p256dh: z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_=+/-]+$/),
    auth: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_=+/-]+$/),
  }),
  userAgent: z.string().max(400).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

export const pushSubscription = z.object({
  id,
  orgId: id,
  userId: id,
  endpoint: z.string().max(1000),
  p256dh: z.string().max(200),
  auth: z.string().max(100),
  /** Navigateur, en court (120 caractères au plus), pour reconnaître l'appareil. */
  userAgent: z.string().max(120).nullable().default(null),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable().default(null),
  /** Échecs d'envoi consécutifs. */
  failures: z.number().int().min(0).default(0),
  /** Désactivé : le service de notification a répondu 404 ou 410, ou trop d'échecs. */
  disabledAt: isoDate.nullable().default(null),
});
export type PushSubscription = z.infer<typeof pushSubscription>;
/** Vue renvoyée au navigateur : sans les clés de chiffrement de l'abonnement. */
export type PushSubscriptionView = Omit<PushSubscription, "p256dh" | "auth">;

export const RADAR_ALERT_KINDS = ["opportunity", "blocked", "payment_3ds"] as const;
export const radarAlertKind = z.enum(RADAR_ALERT_KINDS);
export type RadarAlertKind = z.infer<typeof radarAlertKind>;
export const RADAR_ALERT_CHANNELS = ["push", "email"] as const;
export const RADAR_ALERT_STATUSES = ["queued", "sent", "failed"] as const;

/** Contenu d'une notification : jamais de pseudo, de note ni de photo du vendeur. */
export const radarAlertPayload = z.object({
  title: z.string().max(200),
  body: z.string().max(400),
  /** Chemin relatif dans l'application (jamais une adresse externe). */
  url: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).max(300),
});
export type RadarAlertPayload = z.infer<typeof radarAlertPayload>;

export const radarAlert = z.object({
  id,
  orgId: id,
  opportunityId: id.nullable().default(null),
  /** Demande d'achat concernée (alerte de paiement 3-D Secure). */
  purchaseId: id.nullable().default(null),
  /** Destinataire unique (null : tous les appareils abonnés de l'organisation). */
  userId: id.nullable().default(null),
  kind: radarAlertKind.default("opportunity"),
  channel: z.enum(RADAR_ALERT_CHANNELS).default("push"),
  status: z.enum(RADAR_ALERT_STATUSES).default("queued"),
  /** Une alerte par affaire (`opportunity:<id>`), par demande d'achat (`payment_3ds:<id>`)… */
  dedupeKey: z.string().min(1).max(200),
  payload: radarAlertPayload,
  /** Envoi prévu : tout de suite, ou à la fin des heures calmes. */
  scheduledFor: isoDate,
  attempts: z.number().int().min(0).default(0),
  error: z.string().max(300).nullable().default(null),
  sentAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RadarAlert = z.infer<typeof radarAlert>;
