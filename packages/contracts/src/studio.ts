import { z } from "zod";
import { id, isoDate, nonNegCents, rate } from "./common";
import { itemCategory, itemCondition } from "./inventory";

/**
 * Générateur d'annonces : l'utilisateur ajoute ses photos, l'IA rédige
 * l'annonce (titre, description, attributs). Le prix n'est jamais inventé
 * par le modèle : il est proposé à partir des ventes comparables.
 */

/** Photo envoyée au générateur : data URL compressée côté navigateur. */
export const generatorPhoto = z.object({
  id,
  url: z.string().max(3_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo JPEG, PNG ou WebP attendue"),
  alt: z.string().max(200).default(""),
});
export type GeneratorPhoto = z.infer<typeof generatorPhoto>;

export const listingGenerationInput = z.object({
  photos: z.array(generatorPhoto).min(1, "Ajoutez au moins une photo").max(12),
  /** Compte de vente visé (connexion Vinted) : plusieurs comptes peuvent être gérés. */
  connectionId: id.nullable().default(null),
  hints: z
    .object({
      brand: z.string().trim().max(80).optional(),
      size: z.string().trim().max(40).optional(),
      notes: z.string().trim().max(500).optional(),
      purchasePriceCents: nonNegCents.optional(),
    })
    .default({}),
});
export type ListingGenerationInput = z.input<typeof listingGenerationInput>;

/** Sortie structurée demandée au modèle (aucun prix). */
export const listingGenerationOutput = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(20).max(2000),
  brand: z.string().trim().max(80).nullable().default(null),
  category: itemCategory,
  size: z.string().trim().max(40).nullable().default(null),
  condition: itemCondition,
  colors: z.array(z.string().trim().min(1).max(30)).max(3).default([]),
  material: z.string().trim().max(60).nullable().default(null),
  hashtags: z.array(z.string().trim().max(30)).max(8).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type ListingGenerationOutput = z.infer<typeof listingGenerationOutput>;

export interface ListingDraft extends ListingGenerationOutput {
  /** Prix conseillé (médiane des ventes comparables, ajustée à l'état). */
  suggestedPriceCents: number;
  priceLowCents: number;
  priceHighCents: number;
  priceMethod: string;
  comparableCount: number;
  /** Origine du texte : modèle IA ou gabarit déterministe (IA indisponible / démonstration). */
  source: "ai" | "fallback";
  provider: string;
  model: string;
  latencyMs: number;
  /** Vrai en démonstration : le simulateur ne voit pas réellement les photos. */
  simulated: boolean;
  warnings: string[];
}

/** Annonce observée sur le marché (radar, extension ou simulateur) : base de l'analyse des revendeurs. */
export const marketObservation = z.object({
  id,
  sellerHandle: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(80).nullable().default(null),
  category: itemCategory.default("other"),
  priceCents: nonNegCents,
  status: z.enum(["listed", "sold"]),
  seenAt: z.string(),
  soldAt: z.string().nullable().default(null),
  favorites: z.number().int().min(0).default(0),
  source: z.enum(["demo_simulator", "extension_capture", "radar"]),
});
export type MarketObservation = z.infer<typeof marketObservation>;

// ---------------------------------------------------------------------------
// Studio façon Kavis (§5.11) : ce que le modèle 1 (vision) produit, et comment
// on l'empêche d'inventer. Tri des photos, lecture des étiquettes, mesures lues
// sur un mètre ruban photographié. Chaque valeur porte sa provenance ; sans
// provenance, elle reste vide et une question est posée au vendeur.
// ---------------------------------------------------------------------------

/** Photos d'une annonce Studio (comme `listingGenerationInput`). */
export const STUDIO_MAX_PHOTOS = 12;
/** Photos envoyées au modèle par appel : 4 à 6 photos réduites, jamais 12 en pleine taille (mémoire de la carte). */
export const STUDIO_MODEL_MAX_PHOTOS = 6;
/** Côté long maximal d'une photo envoyée au modèle (px), après réduction côté navigateur. */
export const STUDIO_MODEL_MAX_SIDE_PX = 1024;
/** Qualité JPEG de la réduction côté navigateur (≈ 80). */
export const STUDIO_MODEL_JPEG_QUALITY = 0.8;
/** Poids maximal d'une photo réduite envoyée au modèle (octets) : une photo de 1 024 px en JPEG 80 pèse ≈ 100 à 300 Ko. */
export const STUDIO_MODEL_MAX_BYTES = 1_000_000;
/** Photos d'étiquette par lecture (1 à 2) et photos avec mètre ruban par lecture de mesures (≤ 3). */
export const STUDIO_LABEL_MAX_PHOTOS = 2;
export const STUDIO_TAPE_MAX_PHOTOS = 3;
/** Sous ce seuil, une lecture est écartée (valeur vide et question au vendeur). */
export const STUDIO_MIN_CONFIDENCE = 0.5;
/** À partir de ce seuil, une lecture de l'étiquette ou du ruban prime sur la base des références et sur le vendeur. */
export const STUDIO_TRUSTED_CONFIDENCE = 0.7;
/** Écart toléré entre deux mesures d'une même grandeur avant de demander au vendeur laquelle est juste (cm). */
export const STUDIO_MEASUREMENT_TOLERANCE_CM = 1;

/**
 * Objectifs de précision (§5.11) : à MESURER avec le protocole sur nos propres photos (200 étiquettes,
 * 50 articles avec mètre ruban). Tant qu'aucun rapport n'existe, l'interface et les documents disent
 * « à mesurer » ; aucune précision n'est promise.
 */
export const STUDIO_ACCURACY_TARGETS = {
  brandAndSizeRate: 0.95,
  measurementRate: 0.9,
  measurementToleranceCm: 1,
  protocol: { labelPhotos: 200, tapeArticles: 50 },
} as const;
export const STUDIO_ACCURACY_TO_MEASURE_LABEL = "Précision à mesurer : objectifs (95 % de marques et tailles justes, 9 mesures sur 10 à 1 cm près) pas encore vérifiés sur nos photos.";

export const studioAccuracy = z.object({
  /** `to_measure` tant qu'aucun rapport de mesure n'existe : jamais de pourcentage affiché sans rapport. */
  status: z.enum(["to_measure", "measured"]).default("to_measure"),
  brandAndSizeRate: rate.nullable().default(null),
  measurementRate: rate.nullable().default(null),
  reportDate: isoDate.nullable().default(null),
});
export type StudioAccuracy = z.infer<typeof studioAccuracy>;

const confidence = z.number().min(0).max(1);
/** Confiance renvoyée par le modèle : un pourcentage (85) est ramené à 0,85 ; une valeur illisible vaut 0. */
const modelConfidence = z.preprocess((v) => (typeof v === "number" && v > 1 && v <= 100 ? v / 100 : v), confidence).catch(0);

// ----------------------------------------------------------------- tri des photos

export const PHOTO_ROLES = ["front", "back", "label", "detail", "defect", "tape", "other"] as const;
export const photoRole = z.enum(PHOTO_ROLES);
export type PhotoRole = z.infer<typeof photoRole>;
export const PHOTO_ROLE_LABELS: Record<PhotoRole, string> = {
  front: "Face",
  back: "Dos",
  label: "Étiquette",
  detail: "Détail",
  defect: "Défaut",
  tape: "Mètre ruban",
  other: "Autre",
};

/** D'où vient le rôle d'une photo : du tri du modèle 1, ou indiqué par le vendeur (« c'est l'étiquette »). */
export const PHOTO_ROLE_SOURCES = ["model", "seller"] as const;
export const photoRoleSource = z.enum(PHOTO_ROLE_SOURCES);
export type PhotoRoleSource = z.infer<typeof photoRoleSource>;

/** Rôle d'une photo et article auquel elle appartient, selon le modèle 1. `index` : position dans l'envoi (0 à N-1). */
export const sortedPhoto = z.object({
  index: z.number().int().min(0).max(11),
  /** Rôle inconnu renvoyé par le modèle : « other » (jamais un rôle inventé). */
  role: photoRole.catch("other"),
  /** Numéro d'article (1, 2, 3…) ; la validation renumérote les groupes dans l'ordre d'apparition. */
  articleGroup: z.number().int().min(0).max(99).catch(1),
  confidence: modelConfidence,
  /**
   * Provenance du rôle, posée par le service (jamais déduite de la confiance) : « seller » quand le vendeur l'a
   * indiqué, « model » sinon. Ce qu'un modèle renverrait ici est écrasé par le service.
   */
  roleSource: photoRoleSource.optional().catch(undefined),
});
export type SortedPhoto = z.infer<typeof sortedPhoto>;

/** Sortie du tri des photos (modèle 1). */
export const photoSortOutput = z.object({
  photos: z.array(sortedPhoto).max(12),
});
export type PhotoSortOutput = z.infer<typeof photoSortOutput>;

// ----------------------------------------------------------------- lecture de l'étiquette

export const LABEL_FIELDS = ["brand", "size", "material", "reference"] as const;
export type LabelFieldName = (typeof LABEL_FIELDS)[number];
export const LABEL_FIELD_LABELS: Record<LabelFieldName, string> = { brand: "Marque", size: "Taille", material: "Matière", reference: "Référence" };

/**
 * Un champ lu sur l'étiquette : la valeur écrite, la confiance du modèle et d'où elle vient. `readFrom`
 * vaut « label » seulement si la valeur est lue sur l'étiquette ; toute autre réponse vaut null, et une
 * valeur sans `readFrom` est écartée par la validation (jamais de déduction depuis le style).
 */
export const labelFieldRead = z.preprocess(
  // Tolère un modèle qui renvoie la valeur seule (« "brand": null » ou « "brand": "Levi's" ») : sans provenance, elle sera écartée.
  (v) => (v === null || v === undefined ? { value: null, confidence: 0, readFrom: null } : typeof v === "string" ? { value: v, confidence: 0, readFrom: null } : v),
  z.object({
    value: z.string().trim().max(80).nullable().catch(null).transform((v) => (v && v.length > 0 ? v : null)),
    confidence: modelConfidence,
    readFrom: z.literal("label").nullable().catch(null),
  }),
);
export type LabelFieldRead = z.infer<typeof labelFieldRead>;

/** Sortie de la lecture d'une étiquette (modèle 1) : uniquement ce qui est écrit, null sinon. */
export const labelReadOutput = z.object({
  brand: labelFieldRead,
  size: labelFieldRead,
  material: labelFieldRead,
  reference: labelFieldRead,
  /** Consignes d'entretien lisibles (« lavage 30 °C »…). */
  careSymbols: z.array(z.string().trim().min(1).max(60)).max(12).optional().catch(undefined),
  /**
   * Transcription du texte lisible de l'étiquette : la validation y cherche la marque, la taille et la référence
   * (sans transcription, rien n'est retenu). Une transcription trop longue est tronquée à 600 caractères, jamais
   * ramenée à null (ce qui exempterait la lecture du contrôle).
   */
  text: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 600) : v ?? null), z.string().nullable()).catch(null),
});
export type LabelReadOutput = z.infer<typeof labelReadOutput>;

// ----------------------------------------------------------------- mesures

export const MEASUREMENT_NAMES = ["chest", "length", "shoulders", "sleeve", "waist", "hips", "inseam", "rise", "sole"] as const;
export const measurementName = z.enum(MEASUREMENT_NAMES);
export type MeasurementName = z.infer<typeof measurementName>;
export const MEASUREMENT_LABELS: Record<MeasurementName, string> = {
  chest: "Poitrine",
  length: "Longueur",
  shoulders: "Épaules",
  sleeve: "Manche",
  waist: "Tour de taille",
  hips: "Hanches",
  inseam: "Entrejambe",
  rise: "Montant",
  sole: "Semelle",
};
/** Comment prendre chaque mesure (questions au vendeur, aide de l'écran). */
export const MEASUREMENT_HOWTO: Record<MeasurementName, string> = {
  chest: "d'une aisselle à l'autre, article à plat",
  length: "du haut de l'épaule (ou de la ceinture) jusqu'en bas",
  shoulders: "d'une couture d'épaule à l'autre",
  sleeve: "de la couture d'épaule au bout de la manche",
  waist: "d'un bord à l'autre de la ceinture, article à plat",
  hips: "à l'endroit le plus large, article à plat",
  inseam: "de l'entrejambe jusqu'en bas de la jambe",
  rise: "de l'entrejambe jusqu'en haut de la ceinture",
  sole: "semelle intérieure, du talon à la pointe",
};

/** Une mesure lue sur le ruban photographié. `evidence` vaut « tape_photo » ; toute autre réponse vaut null et la mesure est écartée. */
export const measurementRead = z.object({
  name: measurementName,
  valueCm: z.number().min(0).max(500).nullable().catch(null),
  confidence: modelConfidence,
  evidence: z.literal("tape_photo").nullable().catch(null),
});
export type MeasurementRead = z.infer<typeof measurementRead>;

/** Sortie de la lecture des mesures (modèle 1). Sans mètre ruban visible : `tapeVisible` faux et aucune mesure. */
export const measurementsOutput = z.object({
  tapeVisible: z.boolean().catch(false),
  // Une entrée illisible (nom de mesure inconnu…) est ignorée plutôt que de faire échouer toute la lecture.
  measurements: z
    .array(z.unknown())
    .max(20)
    .catch([])
    .transform((list) => list.flatMap((m) => {
      const p = measurementRead.safeParse(m);
      return p.success ? [p.data] : [];
    })),
});
export type MeasurementsOutput = z.infer<typeof measurementsOutput>;

// ----------------------------------------------------------------- champs avec provenance

/** D'où vient une mesure : lue sur un mètre ruban photographié, retrouvée dans la base par la référence, ou saisie par le vendeur. */
export const MEASUREMENT_SOURCES = ["tape_photo", "reference_db", "seller"] as const;
export const measurementSource = z.enum(MEASUREMENT_SOURCES);
export type MeasurementSource = z.infer<typeof measurementSource>;
/** D'où vient une marque, une taille, une matière ou une référence : lue sur l'étiquette, ou indiquée par le vendeur. */
export const TEXT_FIELD_SOURCES = ["label", "seller"] as const;
export const textFieldSource = z.enum(TEXT_FIELD_SOURCES);
export type TextFieldSource = z.infer<typeof textFieldSource>;
export const FIELD_SOURCE_LABELS: Record<MeasurementSource | TextFieldSource, string> = {
  tape_photo: "Lue sur le mètre ruban",
  reference_db: "Base des références",
  seller: "Indiquée par le vendeur",
  label: "Lue sur l'étiquette",
};

const provenanceRule = <T extends { source: unknown }>(f: T, value: unknown) => (value === null) === (f.source === null);
const PROVENANCE_MESSAGE = "Une valeur porte toujours sa provenance ; sans provenance, elle reste vide.";

/** Une mesure avec sa provenance, ou vide avec une question au vendeur. Jamais de mesure sans provenance. */
export const measurementField = z
  .object({
    valueCm: z.number().positive().max(300).nullable(),
    source: measurementSource.nullable(),
    confidence: confidence.optional(),
    question: z.string().trim().max(300).optional(),
  })
  .refine((f) => provenanceRule(f, f.valueCm), PROVENANCE_MESSAGE);
export type MeasurementField = z.infer<typeof measurementField>;

/** Mesure nommée (liste affichée par Studio). */
export const namedMeasurementField = z
  .object({
    name: measurementName,
    valueCm: z.number().positive().max(300).nullable(),
    source: measurementSource.nullable(),
    confidence: confidence.optional(),
    question: z.string().trim().max(300).optional(),
  })
  .refine((f) => provenanceRule(f, f.valueCm), PROVENANCE_MESSAGE);
export type NamedMeasurementField = z.infer<typeof namedMeasurementField>;

/** Marque, taille, matière ou référence avec sa provenance, ou vide avec une question au vendeur. */
export const studioTextField = z
  .object({
    value: z.string().trim().min(1).max(80).nullable(),
    source: textFieldSource.nullable(),
    confidence: confidence.optional(),
    question: z.string().trim().max(300).optional(),
  })
  .refine((f) => provenanceRule(f, f.value), PROVENANCE_MESSAGE);
export type StudioTextField = z.infer<typeof studioTextField>;

export const studioFields = z.object({ brand: studioTextField, size: studioTextField, material: studioTextField, reference: studioTextField });
export type StudioFields = z.infer<typeof studioFields>;

/** Familles de pièces : elles fixent les mesures attendues (haut : poitrine, longueur, épaules ; bas : taille, entrejambe ; chaussures : semelle…). */
export const GARMENT_KINDS = ["top", "outerwear", "dress", "bottom", "shoes", "bag", "accessory", "other"] as const;
export const garmentKind = z.enum(GARMENT_KINDS);
export type GarmentKind = z.infer<typeof garmentKind>;
export const GARMENT_KIND_LABELS: Record<GarmentKind, string> = {
  top: "Haut",
  outerwear: "Veste ou manteau",
  dress: "Robe ou combinaison",
  bottom: "Bas",
  shoes: "Chaussures",
  bag: "Sac",
  accessory: "Accessoire",
  other: "Autre",
};

const cm = z.number().positive().max(300);
/** Mesures en cm par grandeur (toutes facultatives). */
export const measurementValues = z
  .object({ chest: cm, length: cm, shoulders: cm, sleeve: cm, waist: cm, hips: cm, inseam: cm, rise: cm, sole: cm })
  .partial()
  .strict();
export type MeasurementValues = z.infer<typeof measurementValues>;

/** Base des références : mesures connues d'un modèle (marque + référence, et taille quand les mesures en dépendent). */
export const sizeReference = z.object({
  brand: z.string().trim().min(1).max(80),
  reference: z.string().trim().min(1).max(80),
  /** Taille mesurée ; null si les mesures ne dépendent pas de la taille (sac…). */
  size: z.string().trim().min(1).max(40).nullable().default(null),
  category: garmentKind,
  measurements: measurementValues,
});
export type SizeReference = z.infer<typeof sizeReference>;

/** Indications saisies par le vendeur : source « seller ». */
export const studioSellerHints = z.object({
  brand: z.string().trim().max(80).optional(),
  size: z.string().trim().max(40).optional(),
  material: z.string().trim().max(80).optional(),
  reference: z.string().trim().max(80).optional(),
  measurements: measurementValues.optional(),
});
export type StudioSellerHints = z.infer<typeof studioSellerHints>;

// ----------------------------------------------------------------- questions au vendeur

export const STUDIO_QUESTION_REASONS = ["missing", "low_confidence", "conflict", "no_tape", "rejected"] as const;
export const studioQuestionReason = z.enum(STUDIO_QUESTION_REASONS);
export type StudioQuestionReason = z.infer<typeof studioQuestionReason>;
export const STUDIO_QUESTION_FIELDS = [...LABEL_FIELDS, ...MEASUREMENT_NAMES] as const;
export const studioQuestionField = z.enum(STUDIO_QUESTION_FIELDS);
export type StudioQuestionField = z.infer<typeof studioQuestionField>;

export const sellerQuestion = z.object({
  field: studioQuestionField,
  reason: studioQuestionReason,
  text: z.string().trim().min(1).max(300),
});
export type SellerQuestion = z.infer<typeof sellerQuestion>;

// ----------------------------------------------------------------- résultat complet

/** Un article retrouvé dans les photos : ses photos, ses champs lus avec provenance, ses mesures, les questions. */
export const studioPrepArticle = z.object({
  articleGroup: z.number().int().min(1).max(12),
  photoIndexes: z.array(z.number().int().min(0).max(11)).max(12),
  /** Photos retenues pour le modèle (≤ 6, priorité face, étiquette, mètre, dos, détail). */
  modelPhotoIndexes: z.array(z.number().int().min(0).max(11)).max(STUDIO_MODEL_MAX_PHOTOS),
  garmentKind,
  fields: studioFields,
  careSymbols: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  tapeVisible: z.boolean(),
  measurements: z.array(namedMeasurementField).max(MEASUREMENT_NAMES.length),
  /** Référence de la base utilisée pour les mesures (marque et référence), ou null. */
  sizeReference: z.object({ brand: z.string().max(80), reference: z.string().max(80), size: z.string().max(40).nullable() }).nullable().default(null),
  questions: z.array(sellerQuestion).max(40),
  warnings: z.array(z.string().max(300)).max(20),
});
export type StudioPrepArticle = z.infer<typeof studioPrepArticle>;

/** Préparation Studio complète : rôles des photos, articles, champs et mesures avec provenance, questions, avertissements. */
export const studioPrep = z.object({
  photos: z.array(sortedPhoto).max(12),
  articles: z.array(studioPrepArticle).max(12),
  warnings: z.array(z.string().max(300)).max(30),
  /** Vrai en démonstration : le simulateur ne voit pas réellement les photos. */
  simulated: z.boolean().default(false),
  /** OCR d'essai (OLLAMA_OCR_MODEL) : configuré, et utilisé en second recours pour au moins une étiquette. */
  ocr: z.object({ configured: z.boolean(), used: z.boolean() }).default({ configured: false, used: false }),
  accuracy: studioAccuracy.default({}),
});
export type StudioPrep = z.infer<typeof studioPrep>;

// ----------------------------------------------------------------- photos portées

/**
 * Photos portées : aucun modèle ni service choisi (décision d'Ibrahim, partie 7). Une demande est mise en file
 * et traitée la nuit par un fournisseur derrière une interface ; le fournisseur « noop » refuse proprement.
 */
export const WORN_PHOTO_STATUSES = ["queued", "running", "done", "failed", "refused"] as const;
export const wornPhotoStatus = z.enum(WORN_PHOTO_STATUSES);
export type WornPhotoStatus = z.infer<typeof wornPhotoStatus>;

export const wornPhotoJob = z.object({
  id,
  orgId: id,
  itemId: id.nullable().default(null),
  /** Clé de la photo source dans le stockage (`org/<orgId>/studio-photo/…`). */
  photoKey: z.string().trim().min(1).max(300),
  status: wornPhotoStatus,
  /** Fournisseur qui a traité ou refusé la demande (« noop », « mock »…). */
  provider: z.string().trim().min(1).max(40),
  resultKey: z.string().trim().min(1).max(300).nullable().default(null),
  error: z.string().max(500).nullable().default(null),
  /** Début du créneau de nuit prévu pour le traitement. */
  scheduledFor: isoDate,
  createdAt: isoDate,
});
export type WornPhotoJob = z.infer<typeof wornPhotoJob>;
