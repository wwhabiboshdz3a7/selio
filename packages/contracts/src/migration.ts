import { z } from "zod";

/**
 * Migration depuis un autre outil de gestion Vinted (§5.13) : le client colle ses réglages, envoie des
 * captures d'écran (lues par le modèle 1) ou importe un fichier obtenu au titre de la portabilité RGPD ;
 * mon IA perso propose une correspondance « ancien → nouveau » que le client valide champ par champ.
 *
 * INTERDIT, partout dans le code : demander les identifiants d'un autre outil, se connecter à ses
 * comptes, lire ses serveurs, contourner une protection. Aucune requête réseau vers un concurrent : la
 * migration ne lit que ce que le client lui donne (texte, images, fichier).
 */

export const MIGRATION_SOURCES = ["bleam", "clemz", "vtools", "other", "unknown"] as const;
export const migrationSource = z.enum(MIGRATION_SOURCES);
export type MigrationSource = z.infer<typeof migrationSource>;
export const MIGRATION_SOURCE_LABELS: Record<MigrationSource, string> = {
  bleam: "Bleam",
  clemz: "Clemz",
  vtools: "V-Tools",
  other: "Autre outil",
  unknown: "Outil non identifié",
};

/** Seules entrées acceptées : texte collé, captures d'écran, fichier fourni par le client (portabilité RGPD). */
export const MIGRATION_INPUT_KINDS = ["text", "screenshot", "rgpd_file"] as const;
export const migrationInputKind = z.enum(MIGRATION_INPUT_KINDS);
export type MigrationInputKind = z.infer<typeof migrationInputKind>;

/** Captures d'écran par conversion (réduites comme les photos Studio), taille du texte collé, nombre de champs. */
export const MIGRATION_MAX_SCREENSHOTS = 4;
export const MIGRATION_MAX_TEXT_CHARS = 12_000;
export const MIGRATION_MAX_FIELDS = 60;
export const MIGRATION_MAX_UNKNOWN_FIELDS = 100;
/** Sous ce seuil, un champ proposé par le modèle est rangé dans « champs inconnus » (le client décide). */
export const MIGRATION_MIN_CONFIDENCE = 0.5;

/**
 * Liste FERMÉE des chemins de réglage Selio qu'une migration peut remplir : un chemin absent de cette
 * liste (ou inventé par le modèle) vaut null et le champ va dans `unknownFields`. Les chemins
 * `followUp.*` ne sont pas des réglages d'organisation mais la configuration de la règle d'automatisation
 * « relancer sans réponse » (`follow_up_no_reply`) : `applyMapping` les rend à part.
 */
export const MIGRATION_TARGETS = [
  "marginRules.minMarginRate",
  "marginRules.minMarginCents",
  "marginRules.maxDiscountRate",
  "marginRules.counterStepRate",
  "marginRules.maxRoundsPerCustomer",
  "schedule",
  "schedule.activeFrom",
  "schedule.activeTo",
  "messages.greeting",
  "messages.counter",
  "messages.final",
  "messages.afterFinal",
  "messages.accepted",
  "messages.fallback",
  "autoReply.enabled",
  "autoReply.awayMessage",
  "favorites.enabled",
  "favorites.message",
  "favorites.offerRate",
  "favorites.delayMinutes",
  "lot.enabled",
  "lot.twoItemsRate",
  "lot.threePlusRate",
  "priceDrops.enabled",
  "priceDrops.afterDays",
  "priceDrops.rate",
  "priceDrops.floorRate",
  "timing.minDelayMinutes",
  "timing.maxDelayMinutes",
  "timing.sendOffers",
  "timing.offerValidityHours",
  "afterSale.soldMessage",
  "afterSale.completedMessage",
  "afterSale.pickupReminderText",
  "ai.tone",
  "ai.signature",
  "ai.requireApproval",
  "dressing.republishAfterDays",
  "followUp.delayHours",
  "followUp.template",
] as const;
export const migrationTarget = z.enum(MIGRATION_TARGETS);
export type MigrationTarget = z.infer<typeof migrationTarget>;

/** Nature de la valeur attendue pour une cible (conversion déterministe des valeurs lues). */
export const MIGRATION_VALUE_KINDS = ["rate", "cents", "int", "hour", "schedule", "minutes", "hours", "days", "text", "bool", "tone"] as const;
export type MigrationValueKind = (typeof MIGRATION_VALUE_KINDS)[number];

const confidence = z.number().min(0).max(1);
/** Confiance renvoyée par le modèle : un pourcentage (85) est ramené à 0,85 ; une valeur illisible vaut 0. */
const modelConfidence = z.preprocess((v) => (typeof v === "number" && v > 1 && v <= 100 ? v / 100 : v), confidence).catch(0);

const sourceLabel = z.string().trim().min(1).max(120);
const sourceValue = z.string().trim().max(600);

/** Valeur Selio proposée : nombre (taux 0–1, centimes, heures…), texte ou booléen ; null si inconvertible. */
export const migrationTargetValue = z.union([z.number(), z.boolean(), z.string().max(600)]).nullable();
export type MigrationTargetValue = z.infer<typeof migrationTargetValue>;

/** Un champ proposé par le modèle (ou par le catalogue déterministe) : sans identifiant, celui-ci est posé par la normalisation. */
export const migrationFieldOutput = z.object({
  sourceLabel,
  sourceValue: z.preprocess((v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v ?? ""), sourceValue),
  /** Cible Selio ; un chemin hors de la liste fermée vaut null (le champ ira dans unknownFields). */
  target: migrationTarget.nullable().catch(null),
  targetValue: migrationTargetValue.catch(null).default(null),
  confidence: modelConfidence,
  note: z.string().trim().max(300).catch("").default(""),
});
export type MigrationFieldOutput = z.infer<typeof migrationFieldOutput>;

/** Un réglage lu mais sans équivalent Selio : montré au client tel quel, jamais appliqué. */
export const migrationUnknownField = z.object({
  sourceLabel,
  sourceValue: z.preprocess((v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v ?? ""), sourceValue),
  note: z.string().trim().max(300).catch("").default(""),
});
export type MigrationUnknownField = z.infer<typeof migrationUnknownField>;

/** Sortie structurée attendue du modèle (tolérante : une entrée illisible est ignorée, jamais inventée). */
export const migrationMappingOutput = z.object({
  source: migrationSource.catch("unknown").default("unknown"),
  fields: z
    .array(z.unknown())
    .max(MIGRATION_MAX_FIELDS)
    .catch([])
    .transform((list) => list.flatMap((f) => {
      const p = migrationFieldOutput.safeParse(f);
      return p.success ? [p.data] : [];
    })),
  unknownFields: z
    .array(z.unknown())
    .max(MIGRATION_MAX_UNKNOWN_FIELDS)
    .catch([])
    .transform((list) => list.flatMap((f) => {
      const p = migrationUnknownField.safeParse(f);
      return p.success ? [p.data] : [];
    })),
  warnings: z.array(z.string().trim().max(300)).max(30).catch([]).default([]),
});
export type MigrationMappingOutput = z.infer<typeof migrationMappingOutput>;

/** Champ normalisé : identifiant stable (`f1`, `f2`…) que l'écran « ancien → nouveau » renvoie dans `acceptedFieldIds`. */
export const migrationField = migrationFieldOutput.extend({
  id: z.string().trim().min(1).max(40),
});
export type MigrationField = z.infer<typeof migrationField>;

/** Correspondance « ancien → nouveau » normalisée : ce que l'écran de validation affiche et renvoie. */
export const migrationMapping = z.object({
  source: migrationSource,
  fields: z.array(migrationField).max(MIGRATION_MAX_FIELDS),
  unknownFields: z.array(migrationUnknownField).max(MIGRATION_MAX_UNKNOWN_FIELDS),
  warnings: z.array(z.string().trim().max(300)).max(60),
});
export type MigrationMapping = z.infer<typeof migrationMapping>;

/** Application d'une correspondance : seuls les champs acceptés par le client sont écrits. */
export const migrationApplyInput = z.object({
  /** Correspondance enregistrée par la conversion (obligatoire) : jamais une correspondance venue entièrement du client. */
  mappingId: z.string().trim().min(1).max(64),
  /** Corrections de l'écran « ancien → nouveau » : seules la cible et la valeur des champs DÉJÀ proposés sont reprises. */
  mapping: migrationMapping,
  acceptedFieldIds: z.array(z.string().trim().min(1).max(40)).max(MIGRATION_MAX_FIELDS),
});
export type MigrationApplyInput = z.infer<typeof migrationApplyInput>;

/** Conversion demandée par le client : texte collé et/ou captures (data URL réduites), outil déclaré. */
export const migrationConvertInput = z
  .object({
    text: z.string().max(MIGRATION_MAX_TEXT_CHARS).default(""),
    screenshots: z.array(z.string().max(3_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Capture JPEG, PNG ou WebP attendue")).max(MIGRATION_MAX_SCREENSHOTS).default([]),
    declaredSource: migrationSource.nullable().default(null),
  })
  .refine((v) => v.text.trim().length > 0 || v.screenshots.length > 0, "Collez vos réglages ou ajoutez une capture d'écran");
export type MigrationConvertInput = z.input<typeof migrationConvertInput>;

/** Import d'un fichier obtenu au titre de la portabilité RGPD (JSON ou CSV, format libre). */
export const migrationFileInput = z.object({
  fileName: z.string().trim().max(200).default(""),
  content: z.string().max(2_000_000),
  declaredSource: migrationSource.nullable().default(null),
});
export type MigrationFileInput = z.input<typeof migrationFileInput>;
