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

export const trackFilter = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(120),
  criteria: trackCriteria.default({}),
  fingerprint: trackFingerprint,
  enabled: z.boolean().default(true),
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
