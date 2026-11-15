import { z } from "zod";
import { id, isoDate, nonNegCents, rate } from "./common";
import { itemCategory, itemCondition } from "./inventory";
import { priceEstimate } from "./pricing";
import { radarCriteria } from "./radar";

/**
 * Selio Track (prompt §5.9, Pro et Agence) : analyse du marché, STATISTIQUES SEULEMENT.
 *
 * - Track ne republie aucune annonce, ne garde aucune photo d'annonce ni aucun pseudo.
 * - Les filtres identiques entre clients sont lus une seule fois (empreinte normalisée des critères).
 * - La lecture en direct des pages publiques du catalogue passe par le lecteur de Selio Cloud, avec les
 *   mêmes garde-fous que Radar (arrêt au premier signal, ralentissement, aucun contournement) et derrière
 *   TRACK_LIVE_ENABLED=false : par défaut, la source est le simulateur.
 * - L'usage des données issues de Vinted est à valider juridiquement (avis de l'avocat attendu).
 */

// ---------------------------------------------------------------- règles et textes

/** Relecture d'une empreinte : toutes les 2 h, avec un écart aléatoire de ± 10 min. */
export const TRACK_READ_INTERVAL_HOURS = 2;
export const TRACK_READ_JITTER_MINUTES = 10;
/** Ralentissement de Track (fenêtre partagée) : facteur plafonné à ×8 (16 h entre deux lectures). */
export const TRACK_MAX_SLOWDOWN_FACTOR = 8;
/** Pause de toutes les lectures en direct de Track après un signal de Vinted (CAPTCHA, blocage…). */
export const TRACK_SIGNAL_PAUSE_MINUTES = 60;
/** Lectures anormales de suite (page non reconnue, erreur, délai) avant de ralentir l'empreinte. */
export const TRACK_MAX_CONSECUTIVE_ANOMALIES = 3;
/** Historique gardé : celui du plan le plus long parmi les organisations qui suivent l'empreinte, 12 mois au plus. */
export const TRACK_MAX_HISTORY_MONTHS = 12;
/** Tendances : 30 jours par défaut (7, 30 ou 90). */
export const TRACK_TRENDS_DAYS = [7, 30, 90] as const;
export const TRACK_TRENDS_DEFAULT_DAYS = 30;
/** Scan de niche : en dessous de ces volumes, « données insuffisantes » (aucune note). */
export const TRACK_SCAN_MIN_REFERENCES = 10;
export const TRACK_SCAN_MIN_SOLD = 3;
/** Fenêtre des références prises en compte par un scan de niche et par le flux des ventes. */
export const TRACK_SCAN_WINDOW_DAYS = 90;
export const TRACK_SALES_FEED_DAYS = 30;
/** Marques gardées dans un instantané (parts de marché, sans pseudo). */
export const TRACK_BRAND_SHARES_MAX = 10;
/**
 * Scans « données insuffisantes » par jour et par organisation (UTC) : ils ne sont pas décomptés du quota
 * du mois et ne rendent aucun chiffre de prix ni de délai ; au-delà, refus jusqu'au lendemain.
 */
export const TRACK_SCAN_INSUFFICIENT_PER_DAY = 20;

export const TRACK_UNAVAILABLE_MESSAGE = "Track est compris à partir de Pro";
export const TRACK_SALES_FEED_AGENCY_ONLY = "Le flux des ventes est compris dans Agence";
export const TRACK_SELLER_ANALYSIS_NOTICE =
  "L'analyse d'un vendeur concurrent est à valider juridiquement (RGPD) : elle n'est pas disponible tant que l'avis n'est pas rendu.";
export const TRACK_LEGAL_NOTICE =
  "Track n'en tire que des statistiques : aucune annonce n'est republiée, aucune photo ni aucun pseudo n'est conservé. L'usage des données issues de Vinted est à valider juridiquement.";
export const TRACK_GONE_NOTICE = "Annonces disparues depuis la lecture précédente : vendues ou retirées (estimation).";
export const TRACK_DEMO_NOTICE = "Données de démonstration : le simulateur remplace la lecture des pages tant que la lecture en direct n'est pas ouverte.";
export const TRACK_INSUFFICIENT_DATA = "Données insuffisantes pour noter cette niche.";
export const TRACK_PHOTO_UNAVAILABLE =
  "Lecture des photos indisponible : aucun modèle de vision n'est branché sur ce serveur. Rien n'est décrit sans voir la photo.";

/** Source des lectures d'une empreinte : le simulateur (par défaut) ou les pages publiques lues par Selio Cloud. */
export const TRACK_SOURCES = ["demo", "cloud"] as const;
export const trackSource = z.enum(TRACK_SOURCES);
export type TrackSource = z.infer<typeof trackSource>;

export const TRACK_SOURCE_LABELS: Record<TrackSource, string> = {
  demo: "Simulateur (données de démonstration)",
  cloud: "Pages publiques du catalogue, lues par Selio Cloud",
};

// ---------------------------------------------------------------- filtres suivis

/** Mêmes critères qu'une recherche Radar : mots-clés, marques, catégories, tailles, états, prix. */
export const trackCriteria = radarCriteria;
export type TrackCriteria = z.infer<typeof trackCriteria>;

/** Empreinte normalisée des critères (SHA-256 hexadécimal) : partagée entre organisations. */
export const trackFingerprint = z.string().regex(/^[a-f0-9]{64}$/, "Empreinte invalide");

// ---------------------------------------------------------------- alertes de tendance (par filtre)

/** Une alerte par filtre et par règle au plus toutes les 24 h (pas de rafale de notifications). */
export const TRACK_ALERT_COOLDOWN_HOURS = 24;
/** Référence d'une variation : les instantanés des 7 jours précédents, de même source. */
export const TRACK_ALERT_REFERENCE_DAYS = 7;
/** Instantanés de référence au moins (prix médian, délai de vente) : en dessous, aucune alerte. */
export const TRACK_ALERT_MIN_REFERENCE_SNAPSHOTS = 3;

/**
 * Règles d'une alerte de tendance :
 * - `median_price` : prix médian qui s'écarte de ± X % de la médiane des 7 jours précédents ;
 * - `new_listings` : nouvelles annonces d'une lecture au-dessus d'un seuil ;
 * - `days_to_sell` : délai médian des disparues (estimation) qui baisse de X % face aux 7 jours précédents.
 */
export const TRACK_ALERT_RULES = ["median_price", "new_listings", "days_to_sell"] as const;
export const trackAlertRule = z.enum(TRACK_ALERT_RULES);
export type TrackAlertRule = z.infer<typeof trackAlertRule>;

export const TRACK_ALERT_RULE_LABELS: Record<TrackAlertRule, string> = {
  median_price: "Prix médian qui bouge",
  new_listings: "Nouvelles annonces au-dessus d'un seuil",
  days_to_sell: "Délai de vente qui baisse (estimation)",
};

export const TRACK_ALERT_NOTICE =
  "Une alerte par filtre et par règle au plus toutes les 24 h, évaluée après chaque lecture et envoyée sur les appareils abonnés aux notifications (Radar › Notifications). Les disparitions et le délai de vente restent des estimations.";

/** Réglage des alertes d'un filtre : tout est coupé par défaut ; désactivable d'un geste (`enabled`). */
export const trackAlertRules = z.object({
  enabled: z.boolean().default(false),
  medianPrice: z.object({ enabled: z.boolean().default(false), percent: z.number().int().min(5).max(90).default(15) }).default({}),
  newListings: z.object({ enabled: z.boolean().default(false), threshold: z.number().int().min(1).max(96).default(10) }).default({}),
  daysToSell: z.object({ enabled: z.boolean().default(false), percent: z.number().int().min(10).max(90).default(25) }).default({}),
});
export type TrackAlertRules = z.infer<typeof trackAlertRules>;
export type TrackAlertRulesInput = z.input<typeof trackAlertRules>;

/** Alerte déclenchée (listée dans la page du filtre) : agrégats seulement, aucune annonce. */
export const trackAlertEvent = z.object({
  id,
  orgId: id,
  filterId: id,
  rule: trackAlertRule,
  source: z.enum(["demo", "cloud"]),
  /** Variation (ratio, ex. 0,18) pour le prix et le délai ; nombre d'annonces pour les nouvelles. */
  value: z.number(),
  /** Référence comparée : prix médian (centimes), délai médian (jours) ou seuil. */
  reference: z.number().nullable().default(null),
  message: z.string().max(400),
  /** Notification mise en file (Web Push de la PWA). */
  notified: z.boolean().default(false),
  /** Lecture (instantané) qui a déclenché l'alerte. */
  readAt: isoDate,
  createdAt: isoDate,
});
export type TrackAlertEvent = z.infer<typeof trackAlertEvent>;

/** Réglage et dernières alertes d'un filtre (page du filtre). */
export interface TrackFilterAlerts {
  filterId: string;
  rules: TrackAlertRules;
  events: TrackAlertEvent[];
  cooldownHours: number;
  notices: string[];
}

export const trackFilter = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(120),
  criteria: trackCriteria.default({}),
  fingerprint: trackFingerprint,
  enabled: z.boolean().default(true),
  /** Alertes de tendance du filtre (coupées par défaut). */
  alertRules: trackAlertRules.default({}),
  /** Dernière lecture de l'empreinte (par Selio, quelle que soit l'organisation qui la suit). */
  lastReadAt: isoDate.nullable().default(null),
  /** Prochaine lecture prévue de l'empreinte. */
  nextReadAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type TrackFilter = z.infer<typeof trackFilter>;

export const trackFilterCreate = z.object({
  name: z.string().trim().min(1).max(120),
  criteria: trackCriteria.default({}),
  enabled: z.boolean().default(true),
});
export type TrackFilterCreate = z.input<typeof trackFilterCreate>;
export const trackFilterUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  criteria: trackCriteria.optional(),
  enabled: z.boolean().optional(),
});
export type TrackFilterUpdate = z.input<typeof trackFilterUpdate>;

// ---------------------------------------------------------------- instantanés (par empreinte et par lecture)

export const trackBrandShare = z.object({
  brand: z.string().trim().min(1).max(80),
  count: z.number().int().min(0),
  share: rate,
});
export type TrackBrandShare = z.infer<typeof trackBrandShare>;

/**
 * Périmètre d'un instantané : catégories et marques des critères (sert aux scans de niche).
 * `categoriesVerified` faux : les catégories des critères n'ont PAS été appliquées à la page (lecture en
 * direct : la carte d'une annonce ne montre pas sa catégorie et l'adresse ne la filtre pas) ; l'instantané
 * ne compte alors pour aucune catégorie.
 */
export const trackSnapshotScope = z.object({
  categories: z.array(itemCategory).max(10).default([]),
  brands: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  categoriesVerified: z.boolean().default(true),
});

/**
 * Agrégats d'une lecture : aucune annonce, aucun pseudo, aucune photo. `goneCount` compte les annonces
 * disparues depuis la lecture précédente (vendues OU retirées) : c'est une estimation.
 */
export const trackSnapshot = z.object({
  id,
  fingerprint: trackFingerprint,
  source: trackSource,
  readAt: isoDate,
  listedCount: z.number().int().min(0),
  medianPriceCents: nonNegCents.nullable(),
  p25Cents: nonNegCents.nullable(),
  p75Cents: nonNegCents.nullable(),
  newCount: z.number().int().min(0),
  goneCount: z.number().int().min(0),
  medianDaysListed: z.number().min(0).nullable(),
  brandShares: z.array(trackBrandShare).max(TRACK_BRAND_SHARES_MAX).default([]),
  scope: trackSnapshotScope.default({}),
  createdAt: isoDate,
});
export type TrackSnapshot = z.infer<typeof trackSnapshot>;

/** Point d'une tendance (un jour, UTC). */
export interface TrackTrendPoint {
  day: string;
  listedCount: number;
  medianPriceCents: number | null;
  newCount: number;
  /** Estimation : annonces vendues ou retirées. */
  goneCount: number;
}

export interface TrackTrends {
  filterId: string;
  fingerprint: string;
  days: number;
  points: TrackTrendPoint[];
  snapshots: number;
  /** Variation du prix médian entre le premier et le dernier jour (null sans deux points). */
  medianPriceChange: number | null;
  /** Annonces disparues sur la période (estimation). */
  goneTotal: number;
  /** Source des instantanés (null : aucune lecture encore). */
  source: TrackSource | null;
  demo: boolean;
  notices: string[];
}

// ---------------------------------------------------------------- scans de niche

export const trackScanInput = z.object({
  brand: z.string().trim().min(1).max(80).nullable().default(null),
  category: itemCategory,
});
export type TrackScanInput = z.input<typeof trackScanInput>;

const score100 = z.number().int().min(0).max(100);

/** Composantes de la note (0 à 100 chacune), combinées par des poids documentés (TRACK_SCAN_WEIGHTS). */
export const trackScanComponents = z.object({
  demand: score100,
  speed: score100,
  competition: score100,
  margin: score100,
});
export type TrackScanComponents = z.infer<typeof trackScanComponents>;

/** Poids des composantes : demande 35 %, vitesse 25 %, concurrence 20 %, marge 20 %. */
export const TRACK_SCAN_WEIGHTS: Record<keyof TrackScanComponents, number> = { demand: 0.35, speed: 0.25, competition: 0.2, margin: 0.2 };

export const trackScan = z.object({
  id,
  orgId: id,
  brand: z.string().max(80).nullable(),
  category: itemCategory,
  status: z.enum(["ok", "insufficient_data"]),
  /** Note de 0 à 100 (null : données insuffisantes). */
  score: score100.nullable(),
  components: trackScanComponents.nullable(),
  basedOn: z.object({
    references: z.number().int().min(0),
    snapshots: z.number().int().min(0),
    sold: z.number().int().min(0).default(0),
    /** Vrai : références et instantanés viennent du simulateur. */
    demo: z.boolean().default(false),
  }),
  /** Valeurs lisibles derrière la note (délai médian, annonces actives, prix médians). */
  details: z.object({
    medianDaysToSell: z.number().min(0).nullable().default(null),
    activeListings: z.number().int().min(0).default(0),
    medianResaleCents: nonNegCents.nullable().default(null),
    medianBuyCents: nonNegCents.nullable().default(null),
  }).default({}),
  message: z.string().max(300).nullable().default(null),
  createdAt: isoDate,
});
export type TrackScan = z.infer<typeof trackScan>;

// ---------------------------------------------------------------- recherche par photo

/** Photo envoyée (data URL compressée par le navigateur). Elle n'est JAMAIS conservée. */
export const trackPhotoSearchInput = z.object({
  photo: z.string().max(3_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo JPEG, PNG ou WebP attendue"),
  hints: z.object({
    brand: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(300).optional(),
  }).default({}),
});
export type TrackPhotoSearchInput = z.input<typeof trackPhotoSearchInput>;

/** Description de l'article lue par le modèle 1 (vision) : sans aucun prix. */
export const photoDescription = z.object({
  title: z.string().trim().min(3).max(100),
  brand: z.string().trim().max(80).nullable().default(null),
  category: itemCategory,
  subcategory: z.string().trim().max(60).nullable().default(null),
  material: z.string().trim().max(60).nullable().default(null),
  color: z.string().trim().max(30).nullable().default(null),
  condition: itemCondition.nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type PhotoDescription = z.infer<typeof photoDescription>;

export const trackPhotoSearch = z.object({
  id,
  orgId: id,
  description: photoDescription,
  estimate: priceEstimate,
  /** Vrai en démonstration : le simulateur ne voit pas réellement la photo. */
  simulated: z.boolean().default(false),
  createdAt: isoDate,
});
export type TrackPhotoSearch = z.infer<typeof trackPhotoSearch>;

// ---------------------------------------------------------------- Agence : flux des ventes

/** Ventes (ou disparitions, estimées) récentes agrégées par marque et catégorie : aucun pseudo, aucune annonce. */
export interface TrackSalesFeedRow {
  brand: string;
  category: z.infer<typeof itemCategory>;
  sold: number;
  /** Part des ventes dont le prix final est une estimation (annonces disparues). */
  estimatedShare: number;
  medianPriceCents: number | null;
  lastSoldAt: string | null;
}

export interface TrackSalesFeed {
  days: number;
  rows: TrackSalesFeedRow[];
  demo: boolean;
  notices: string[];
}

// ---------------------------------------------------------------- administration (opérateurs Selio)

/** Pause manuelle de Track posée par un opérateur « tech » : respectée par le worker sans redémarrage. */
export const trackManualPauseInput = z.object({
  reason: z.string().trim().min(3, "Indiquez la raison de la pause (3 caractères au moins).").max(300),
});
export type TrackManualPauseInput = z.input<typeof trackManualPauseInput>;

/** Lecture récente (journal partagé, 7 jours) : empreinte abrégée, résultat, compteurs. Aucune donnée de personne. */
export interface TrackAdminRead {
  fingerprint: string;
  readAt: string;
  source: TrackSource;
  outcome: string;
  listed: number;
  newCount: number;
  goneCount: number;
  factor: number;
  message: string | null;
}

/** Utilisation de Track par client (filtres suivis, scans et recherches par photo du mois face aux quotas). */
export interface TrackAdminOrgUsage {
  orgId: string;
  name: string;
  plan: string;
  filters: { used: number; quota: number; enabled: number };
  scans: { used: number; quota: number };
  photoSearches: { used: number; quota: number };
  /** Filtres avec des alertes de tendance actives. */
  alertFilters: number;
}

/** Vue « Track » de l'administration. */
export interface TrackAdminStatus {
  /** Source effective du worker : simulateur tant que l'interrupteur est fermé. */
  source: TrackSource;
  sourceLabel: string;
  /** Interrupteur TRACK_LIVE_ENABLED tel que lu par l'API (le worker lit le sien au démarrage). */
  liveEnabled: boolean;
  /** Pause manuelle posée par un opérateur (respectée par le worker, toutes sources). */
  manualPause: { paused: boolean; since: string | null; by: string | null; reason: string | null };
  /** Pause automatique après un signal de Vinted (lectures en direct seulement). */
  signalPause: { until: string | null; reason: string | null; active: boolean };
  /** Coupe-circuit de la machine (Cloud, Radar et Track en direct). */
  machinePausedUntil: string | null;
  slowdown: { factor: number; storedFactor: number; lastBlockAt: string | null; windowReads: number; windowBlocks: number; blocksPer1000: number | null };
  fingerprints: { followed: number; due: number; slowed: number };
  last24h: { reads: number; ok: number; anomalies: number; blocked: number; skipped: number };
  recentReads: TrackAdminRead[];
  recentProblems: TrackAdminRead[];
  usage: TrackAdminOrgUsage[];
  /** Le rôle de l'opérateur permet la pause et la reprise (rôle « tech »). */
  canControl: boolean;
  notices: string[];
}
