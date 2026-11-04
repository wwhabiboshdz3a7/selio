/**
 * Types du modèle de prix de Selio (§5.10 du prompt, partie 07 du compte rendu).
 *
 * Règle non négociable : une référence de prix ne contient AUCUNE donnée personnelle. Ni pseudo,
 * ni profil, ni identifiant d'annonce réutilisable publiquement, ni adresse d'annonce, ni photo :
 * seulement des caractéristiques d'article, des prix, des dates et des compteurs. Le type
 * l'interdit (les champs personnels connus sont typés `never`), le schéma d'exécution
 * (`priceReferenceSchema`, strict) refuse toute clé inconnue, et le nettoyage recopie les seuls
 * champs autorisés.
 */
import { z } from "zod";

/** Origine d'une référence. `demo` = données synthétiques : jamais présentées comme mesurées. */
export const PRICE_REFERENCE_SOURCES = ["client_sale", "extension_capture", "track", "provided_base", "demo"] as const;
export type PriceReferenceSource = (typeof PRICE_REFERENCE_SOURCES)[number];

/** États reconnus, du meilleur au moins bon (codes de `@selio/contracts`, plus l'alias `new`). */
export const PRICE_CONDITIONS = ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] as const;
export type PriceCondition = (typeof PRICE_CONDITIONS)[number];

/** Date ISO 8601 (chaîne) ou objet Date. */
export type DateInput = string | Date;

/**
 * Clés qui porteraient une donnée personnelle ou un identifiant public d'annonce : interdites
 * dans une référence (type `never`, refus à l'exécution).
 */
export const FORBIDDEN_REFERENCE_KEYS = [
  "seller", "sellerId", "sellerLogin", "sellerName", "sellerRating", "username", "userName", "user", "userId",
  "pseudo", "login", "member", "memberId", "profile", "profileUrl", "buyer", "buyerId", "buyerName",
  "itemId", "listingId", "vintedId", "externalId", "url", "listingUrl", "itemUrl",
  "photo", "photos", "photoUrl", "photoUrls", "image", "images", "imageUrl", "thumbnail",
  "title", "description",
] as const;
type ForbiddenKey = (typeof FORBIDDEN_REFERENCE_KEYS)[number];

/** Champs autorisés d'une référence de prix. */
export interface PriceReferenceFields {
  /** Marque telle que saisie ou lue (normalisée par `cleanReferences`). Vide ou « sans marque » accepté. */
  brand: string;
  /** Catégorie (« Jeans », « Baskets »…). */
  category: string;
  subcategory?: string | null;
  /** Taille telle qu'affichée : « M », « W32 L32 », « 38 », « 42,5 », « Taille unique »… */
  size?: string | null;
  /** Matière (« coton », « 80 % laine 20 % polyamide »…). */
  material?: string | null;
  color?: string | null;
  /** État : code Selio (`very_good`…) ou libellé français (« Très bon état ») ; null si inconnu (gardé, ordinal −1). */
  condition: string | null;
  /** Prix affiché, en centimes. */
  listedPriceCents: number;
  /** Prix final de vente, en centimes, quand il est connu. */
  finalPriceCents?: number | null;
  /**
   * Vrai : le prix final est une ESTIMATION (annonce disparue entre deux lectures de Track : vendue ou
   * retirée, prix = dernier prix affiché). Jamais compté dans le mois de test ; à l'entraînement,
   * seulement à défaut d'assez de ventes au prix réel.
   */
  finalPriceEstimated?: boolean | null;
  /** Date de mise en ligne. */
  listedAt: DateInput;
  /** Date de vente, quand l'article est vendu. */
  soldAt?: DateInput | null;
  photoCount?: number | null;
  /** Vues et favoris, s'ils sont visibles. Gardés pour l'étude, jamais utilisés pour prédire (inconnus avant la mise en ligne). */
  views?: number | null;
  favorites?: number | null;
  source: PriceReferenceSource;
}

/** Référence de prix : champs autorisés, et aucun champ personnel possible. */
export type PriceReference = PriceReferenceFields & { [K in ForbiddenKey]?: never };

const dateInput = z.union([z.string().min(1), z.date()]);
const optText = z.string().max(200).nullish();
const optCount = z.number().int().min(0).max(1_000_000).nullish();

/**
 * Schéma d'exécution d'une référence (lecture d'un fichier, d'une API). Strict : toute clé
 * inconnue, et en particulier un pseudo, un identifiant ou une photo, est refusée.
 */
export const priceReferenceSchema = z
  .object({
    brand: z.string().max(200),
    category: z.string().min(1).max(200),
    subcategory: optText,
    size: optText,
    material: optText,
    color: optText,
    condition: z.string().min(1).max(100).nullable(),
    listedPriceCents: z.number().int(),
    finalPriceCents: z.number().int().nullish(),
    finalPriceEstimated: z.boolean().nullish(),
    listedAt: dateInput,
    soldAt: dateInput.nullish(),
    photoCount: optCount,
    views: optCount,
    favorites: optCount,
    source: z.enum(PRICE_REFERENCE_SOURCES),
  })
  .strict();

/** Ce que l'on sait d'un article à estimer (avant sa mise en ligne). */
export interface PriceFeatures {
  brand?: string | null;
  category: string;
  subcategory?: string | null;
  size?: string | null;
  material?: string | null;
  color?: string | null;
  condition?: string | null;
  /** Date de mise en ligne prévue (saison). Par défaut : maintenant. */
  listedAt?: DateInput | null;
  photoCount?: number | null;
}

/** Niveau de confiance, même échelle que les estimations de Radar (`@selio/domain`). */
export type PriceConfidence = "low" | "medium" | "high";

/** Origine des données d'entraînement d'un modèle. */
export type DataOrigin = "real" | "demo" | "mixed";

/** Facteur d'explication d'un prix (pour mon IA perso, qui l'exprime en mots sans changer les chiffres). */
export interface PriceFactor {
  key: "brand" | "category" | "condition" | "size" | "season" | "material" | "photos" | "comparables" | "model_error";
  /** Libellé court en français (« Marque », « État »…). */
  label: string;
  /** Valeur de l'article (« Levi's », « Très bon état », « Hiver »…). */
  value: string;
  /** Effet estimé sur le prix médian, en fraction (+0,12 = +12 %), par rapport à la référence indiquée. Null si non chiffrable. */
  effect: number | null;
  /** Point de comparaison de l'effet (« une marque inconnue de la même catégorie »…). */
  versus?: string;
  /** Nombre de ventes de la base derrière ce facteur, quand il a un sens. */
  support?: number;
}

/** Prédiction du modèle entraîné pour un article. Prix en centimes. */
export interface PricePrediction {
  p25: number;
  p50: number;
  p75: number;
  /** Délai de vente médian estimé au prix P50, en jours. Null si le modèle de délai n'est pas entraîné. */
  delayDays: number | null;
  /** Délai médian estimé à chacun des trois prix (vente rapide, standard, marge maximale). */
  delayAt?: { p25: number; p50: number; p75: number } | null;
  confidence: PriceConfidence;
  method: "model";
  /** Version du modèle et origine de ses données (« demo » ⇒ « données de démonstration » à l'écran). */
  modelTrainedAt?: string;
  dataOrigin?: DataOrigin;
  /** Erreur médiane mesurée sur le dernier mois jamais vu ; null si elle n'a pas pu être mesurée. */
  measuredMdape?: number | null;
  factors?: PriceFactor[];
}

// ------------------------------------------------------------------ modèle sérialisé

/** Nature d'une variable du modèle : numérique (séparation x ≤ seuil) ou modale (séparation x = modalité, équivalent one-hot). */
export type FeatureKind = "numeric" | "onehot";

export interface FeatureSpec {
  name: string;
  kind: FeatureKind;
}

/** Arbre de régression à plat : `feature[i] = -1` pour une feuille (valeur dans `value[i]`). */
export interface SerializedTree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

/** Ensemble d'arbres (gradient boosting) pour une cible et une perte. */
export interface SerializedGbm {
  objective: { type: "quantile"; alpha: number };
  /** Score initial (quantile de la cible). */
  base: number;
  learningRate: number;
  trees: SerializedTree[];
  /** Nombre d'arbres retenus par l'arrêt anticipé, et nombre d'arbres essayés. */
  bestIteration: number;
  triedIterations: number;
  /** Perte de validation au meilleur arbre (perte quantile sur la cible transformée). */
  validationLoss: number | null;
  /** Variables, dans l'ordre des colonnes (rend l'ensemble autonome). */
  features: FeatureSpec[];
}

/** Encodage cible lissé : moyenne de la cible par modalité, rapprochée de l'a priori pour les modalités rares. */
export interface SerializedTargetEncoding {
  smoothing: number;
  prior: number;
  /** modalité → [somme de la cible, effectif] */
  stats: Record<string, [number, number]>;
}

/** Métriques mesurées sur le dernier mois, jamais vu à l'entraînement. */
export interface PriceMetrics {
  /** Nombre de ventes du mois de test. */
  n: number;
  /** Erreur absolue relative médiane du P50 (0,18 = 18 %). */
  mdape: number;
  /** Erreur absolue relative moyenne du P50. */
  mape: number;
  /** Part des estimations P50 à ±20 % du prix réel. */
  within20: number;
  /** Part des prix réels dans l'intervalle P25–P75 (50 % attendu si le modèle est calibré). */
  coverage50: number;
  /** Erreur médiane d'une estimation naïve (médiane de la marque et de la catégorie) sur le même mois, pour comparaison. */
  baselineMdape: number | null;
}

export interface DelayMetrics {
  n: number;
  /** Erreur absolue médiane du délai, en jours. */
  mdaeDays: number;
  /** Erreur absolue moyenne du délai, en jours. */
  maeDays: number;
}

export interface SerializedPriceModel {
  format: "selio-price-model";
  version: 1;
  trainedAt: string;
  /** Fin de la période d'entraînement (début du mois de test). */
  trainedUntil: string;
  nReferences: number;
  nTrain: number;
  dataOrigin: DataOrigin;
  seed: number;
  params: PriceModelParams;
  features: { price: FeatureSpec[]; delay: FeatureSpec[] };
  encodings: {
    brand: SerializedTargetEncoding;
    category: SerializedTargetEncoding;
    brandCategory: SerializedTargetEncoding;
    subcategory: SerializedTargetEncoding;
    brandDelay: SerializedTargetEncoding;
    /** Modalités retenues pour les variables modales (index = code ; la dernière est « autre »). */
    categories: string[];
    materials: string[];
    colors: string[];
    /** Effectif par marque (support de l'explication et de la confiance). */
    brandCounts: Record<string, number>;
    /** Alias de marque personnalisés utilisés à l'entraînement (repris à la prédiction). */
    brandAliases: Record<string, string>;
  };
  models: {
    p25: SerializedGbm;
    p50: SerializedGbm;
    p75: SerializedGbm;
    delay: SerializedGbm | null;
  };
  metrics: { price: PriceMetrics | null; delay: DelayMetrics | null };
}

/** Réglages du gradient boosting (valeurs par défaut dans `DEFAULT_PRICE_MODEL_PARAMS`). */
export interface PriceModelParams {
  /** Nombre maximal d'arbres par modèle (150 à 400). */
  trees: number;
  learningRate: number;
  /** Profondeur des arbres (4 à 6). */
  maxDepth: number;
  /** Effectif minimal d'une feuille. */
  minLeaf: number;
  /** Part des lignes tirées pour chaque arbre. */
  subsample: number;
  /** Nombre maximal de classes par variable numérique (≤ 64). */
  maxBins: number;
  /** Arrêt anticipé : nombre d'arbres sans amélioration de la validation. */
  earlyStoppingRounds: number;
  /** Part des lignes d'entraînement réservée à la validation de l'arrêt anticipé. */
  validationShare: number;
  /** Lissage de l'encodage cible (effectif équivalent de l'a priori). */
  targetSmoothing: number;
}
