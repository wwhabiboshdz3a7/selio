import { z } from "zod";
import { id, isoDate, nonNegCents } from "./common";
import { itemCategory, itemCondition } from "./inventory";

/**
 * Estimation des prix (prompt §5.10).
 *
 * Deux moteurs : les comparables (ventes de l'organisation et base de références, affinés par le
 * modèle 2 quand il est disponible) et un modèle de prix entraîné qui prédit les quantiles
 * P25 / P50 / P75 et le délai de vente. Trois stratégies en découlent : vente rapide (P25), standard
 * (P50), marge maximale (P75). Mon IA perso explique le prix en mots ; elle ne le choisit jamais
 * (D07 : l'IA rédige, la politique décide).
 *
 * Honnêteté : rien n'est présenté comme mesuré sans mesure. L'erreur du modèle vient de son test sur
 * le dernier mois de la vraie base ; tant que la base est vide ou synthétique, l'interface affiche
 * « modèle non entraîné » ou « données de démonstration ».
 */

// ---------------------------------------------------------------- base de références

/**
 * Origine d'une référence : `track` (annonce lue par Selio Track), `sale` (vente réelle d'une
 * organisation, sans donnée personnelle), `demo` (simulateur : jamais comptée comme une donnée réelle),
 * `import` (lot importé par l'équipe).
 */
export const PRICE_REFERENCE_SOURCES = ["track", "sale", "demo", "import"] as const;
export const priceReferenceSource = z.enum(PRICE_REFERENCE_SOURCES);
export type PriceReferenceSource = z.infer<typeof priceReferenceSource>;

/**
 * État d'une référence : `listed` (annonce vue en ligne), `sold` (vente connue, prix final réel),
 * `gone` (annonce disparue entre deux lectures de Track : vendue ou retirée, prix final ESTIMÉ au
 * dernier prix affiché).
 */
export const PRICE_REFERENCE_STATUSES = ["listed", "sold", "gone"] as const;
export const priceReferenceStatus = z.enum(PRICE_REFERENCE_STATUSES);
export type PriceReferenceStatus = z.infer<typeof priceReferenceStatus>;

const attr = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);

/**
 * Une référence de prix. AUCUNE donnée personnelle : ni pseudo, ni identifiant d'annonce réutilisable
 * publiquement (la clé de dédoublonnage est une empreinte salée côté base, irréversible sans le sel),
 * ni photo, ni titre libre. Seulement marque, catégorie, sous-catégorie, taille, matière, couleur, état,
 * prix affiché, prix final (quand il est connu), dates, nombre de photos, vues et favoris (si visibles)
 * et source.
 */
export const priceReference = z.object({
  id,
  /** Empreinte de dédoublonnage (`track:<sha256>`, `sale:<sha256>`, `demo:<…>`) : jamais un identifiant Vinted. */
  dedupeKey: z.string().min(8).max(120),
  source: priceReferenceSource,
  status: priceReferenceStatus.default("listed"),
  brand: attr(80),
  category: itemCategory,
  subcategory: attr(60),
  size: attr(40),
  material: attr(60),
  color: attr(30),
  condition: itemCondition.nullable().default(null),
  listedPriceCents: nonNegCents.nullable().default(null),
  finalPriceCents: nonNegCents.nullable().default(null),
  /** Vrai : le prix final est une estimation (dernier prix affiché d'une annonce disparue). */
  finalPriceEstimated: z.boolean().default(false),
  listedAt: isoDate.nullable().default(null),
  soldAt: isoDate.nullable().default(null),
  photoCount: z.number().int().min(0).max(30).nullable().default(null),
  views: z.number().int().min(0).nullable().default(null),
  favorites: z.number().int().min(0).nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type PriceReference = z.infer<typeof priceReference>;

/** Champs d'une référence à l'écriture (le serveur fixe l'identifiant et les dates d'enregistrement). */
export const priceReferenceInput = priceReference.omit({ id: true, createdAt: true, updatedAt: true });
export type PriceReferenceInput = z.input<typeof priceReferenceInput>;

/**
 * Conservation de la base de références : 24 mois après la vente (ou la mise en ligne), puis effacement
 * (passage de rétention du worker). Les dates des sources `track` et `sale` sont gardées AU JOUR (UTC) et
 * le nombre de photos par tranches (0, 1, 2–3, 4–5, 6–9, 10 et plus) : moins de quasi-identifiants.
 */
export const PRICE_REFERENCE_RETENTION_MONTHS = 24;

/**
 * Ventes d'une autre organisation : jamais servies une à une (comparables, scans, flux, tendances) ;
 * seulement l'entraînement agrégé du modèle, et seulement si l'organisation a donné son accord
 * (`settings.pricing.shareSales`, désactivé par défaut, à valider juridiquement).
 */
export const PRICE_SHARE_SALES_NOTICE =
  "Vos ventes payées sont versées chaque nuit dans la base de références commune, sans client, titre, identifiant ni photo, pour entraîner le modèle de prix. Elles ne sont jamais montrées une à une à une autre organisation. Désactivé, elles sont retirées de la base. Usage à valider juridiquement.";

/** Clés autorisées d'une référence : sert aux tests « aucune donnée personnelle » (aucune autre clé). */
export const PRICE_REFERENCE_KEYS = Object.keys(priceReference.shape) as readonly (keyof PriceReference)[];

// ---------------------------------------------------------------- caractéristiques d'un article

/** Ce que l'estimation sait de l'article (titre facultatif : affinage par similarité, modèle 2). */
export const priceFeatures = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  brand: z.string().trim().min(1).max(80).nullable().optional(),
  category: itemCategory,
  subcategory: z.string().trim().min(1).max(60).nullable().optional(),
  size: z.string().trim().min(1).max(40).nullable().optional(),
  material: z.string().trim().min(1).max(60).nullable().optional(),
  color: z.string().trim().min(1).max(30).nullable().optional(),
  condition: itemCondition.nullable().optional(),
  photoCount: z.number().int().min(0).max(30).nullable().optional(),
});
export type PriceFeatures = z.infer<typeof priceFeatures>;

// ---------------------------------------------------------------- estimation

/**
 * Méthode d'une estimation : `embeddings` (ventes et références proches par similarité de titre,
 * modèle 2), `comparables` (même marque et catégorie), `model` (modèle de prix seul, aucun comparable),
 * `blend` (comparables et modèle combinés), `none` (pas assez de références : aucun prix proposé).
 */
export const PRICE_METHODS = ["embeddings", "comparables", "model", "blend", "none"] as const;
export const priceMethod = z.enum(PRICE_METHODS);
export type PriceMethod = z.infer<typeof priceMethod>;

export const PRICE_METHOD_LABELS: Record<PriceMethod, string> = {
  embeddings: "Ventes proches (similarité des titres)",
  comparables: "Ventes de même marque et catégorie",
  model: "Modèle de prix",
  blend: "Ventes comparables et modèle de prix",
  none: "Pas assez de références",
};

/** Message affiché quand aucun prix ne peut être proposé. */
export const PRICE_NOT_ENOUGH_REFERENCES = "Pas assez de références pour proposer un prix : fixez-le à la main.";
/** Mentions honnêtes de l'état du modèle de prix. */
export const PRICE_MODEL_NOT_TRAINED = "Modèle non entraîné";
export const PRICE_MODEL_DEMO_DATA = "Données de démonstration";

/** Les trois stratégies, en centimes, arrondies : vente rapide (P25), standard (P50), marge maximale (P75). */
export const priceStrategies = z.object({
  fast: nonNegCents,
  standard: nonNegCents,
  max: nonNegCents,
});
export type PriceStrategies = z.infer<typeof priceStrategies>;

export const PRICE_STRATEGY_LABELS: Record<keyof PriceStrategies, string> = {
  fast: "Vente rapide",
  standard: "Standard",
  max: "Marge maximale",
};

export const PRICE_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type PriceConfidenceLevel = (typeof PRICE_CONFIDENCE_LEVELS)[number];

export const priceEstimate = z.object({
  /** Quantiles du prix de vente en centimes (null : méthode « none »). */
  p25: nonNegCents.nullable(),
  p50: nonNegCents.nullable(),
  p75: nonNegCents.nullable(),
  /** Délai de vente estimé en jours (null : inconnu). */
  delayDays: z.number().min(0).max(3650).nullable(),
  /** Confiance de 0 à 1, et son niveau lisible. */
  confidence: z.number().min(0).max(1),
  confidenceLevel: z.enum(PRICE_CONFIDENCE_LEVELS),
  method: priceMethod,
  strategies: priceStrategies.nullable(),
  comparableCount: z.number().int().min(0),
  /** Version du modèle de prix utilisé (absente sans modèle). */
  modelVersion: z.string().max(80).nullable().optional(),
  /** Explication en mots par mon IA perso (facultative, jamais bloquante). */
  explanation: z.string().max(1200).nullable().optional(),
  /** Origine de l'explication : mon IA perso, ou un texte fixe quand elle est indisponible. */
  explanationSource: z.enum(["ai", "template"]).nullable().optional(),
  /** Facteurs pris en compte (données fournies à l'explication, jamais inventées). */
  factors: z.array(z.string().max(200)).max(12).default([]),
  /** Vrai : l'estimation repose sur des données de démonstration (modèle entraîné sur le simulateur). */
  demo: z.boolean().default(false),
  /** Message pour l'interface (« pas assez de références », données de démonstration…). */
  message: z.string().max(300).nullable().default(null),
});
export type PriceEstimate = z.infer<typeof priceEstimate>;

/** Demande d'estimation (API) : caractéristiques et explication facultative. */
export const priceEstimateInput = priceFeatures.extend({
  explain: z.boolean().default(false),
});
export type PriceEstimateInput = z.input<typeof priceEstimateInput>;

/** Sortie de mon IA perso pour l'explication d'un prix : un texte, aucun prix nouveau, aucun facteur nouveau. */
export const priceExplanationOutput = z.object({
  explanation: z.string().trim().min(20).max(800),
});
export type PriceExplanationOutput = z.infer<typeof priceExplanationOutput>;

// ---------------------------------------------------------------- modèle de prix

/**
 * Références nécessaires (réelles, ou de démonstration faute de mieux) pour entraîner un modèle : même
 * seuil que l'entraîneur de @selio/pricing (MIN_REFERENCES), qui peut aussi refuser de lui-même.
 */
export const PRICE_MODEL_MIN_REFERENCES = 500;
/** Ré-entraînement chaque semaine (planning du worker). */
export const PRICE_MODEL_RETRAIN_DAYS = 7;

export const PRICE_MODEL_STATUSES = ["active", "archived"] as const;

/** Mesures du test du modèle (calculées par l'entraîneur sur le dernier mois) : nombres, textes ou booléens. */
export const priceModelMetrics = z.record(z.union([z.number(), z.string(), z.boolean(), z.null()]));
export type PriceModelMetrics = z.infer<typeof priceModelMetrics>;

export const priceModelRecord = z.object({
  id,
  version: z.string().min(1).max(80),
  trainedAt: isoDate,
  nReferences: z.number().int().min(0),
  metrics: priceModelMetrics.default({}),
  status: z.enum(PRICE_MODEL_STATUSES),
  /** Vrai : entraîné sur des données de démonstration (simulateur), aucune mesure réelle. */
  synthetic: z.boolean().default(false),
  createdAt: isoDate,
});
export type PriceModelRecord = z.infer<typeof priceModelRecord>;

/** État du modèle de prix affiché dans l'interface. */
export const priceModelStatus = z.object({
  trained: z.boolean(),
  version: z.string().nullable(),
  trainedAt: isoDate.nullable(),
  nReferences: z.number().int().min(0),
  metrics: priceModelMetrics.nullable(),
  synthetic: z.boolean(),
  /** « Modèle non entraîné », « Données de démonstration » ou « Modèle entraîné le … ». */
  label: z.string(),
});
export type PriceModelStatus = z.infer<typeof priceModelStatus>;
