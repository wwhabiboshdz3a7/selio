/**
 * @selio/pricing — le modèle de prix de Selio (§5.10), en TypeScript pur, sur le processeur.
 *
 * Base de références sans donnée personnelle → nettoyage → gradient boosting quantile
 * (P25 / P50 / P75) et modèle du délai de vente → test sur le dernier mois jamais vu →
 * combinaison avec les comparables (modèle 2) → trois stratégies et une explication structurée
 * pour mon IA perso, qui l'exprime en mots sans jamais choisir le prix.
 *
 * Les données synthétiques (`@selio/pricing/synthetic`) ne sont pas exportées ici : elles servent
 * aux tests et au script d'évaluation, avec la source `demo`.
 */
export * from "./types";
export {
  CLEANING_REASONS,
  CLEANING_REASON_LABELS,
  CONDITION_LABELS,
  CONDITION_ORDINAL,
  DEFAULT_BRAND_ALIASES,
  NO_BRAND,
  SEASONS,
  SEASON_LABELS,
  SIZE_SYSTEMS,
  cleanReferences,
  isBundleCategory,
  isShoeCategory,
  normalizeBrand,
  normalizeCategory,
  normalizeColor,
  normalizeMaterial,
  normalizeText,
  parseCondition,
  parseSize,
  seasonOf,
  type CleanOptions,
  type CleanReference,
  type CleaningReason,
  type CleaningReport,
  type ParsedSize,
  type Season,
  type SizeSystem,
} from "./clean";
export { createRng, pinballLoss, predictGbm, quantileSorted, trainGbm, validateGbm, type GbmDataset, type GbmOptions } from "./gbm";
export {
  DEFAULT_PRICE_MODEL_PARAMS,
  MIN_DELAY_REFERENCES,
  MIN_HOLDOUT,
  MIN_REFERENCES,
  evaluateModel,
  resolveParams,
  trainPriceModel,
  type BacktestWindow,
  type TrainOptions,
  type TrainingReport,
} from "./train";
export { brandLevel, explainView, loadPriceModel, modelConfidence, predictDelay, predictPrice, serializePriceModel, viewOfFeatures } from "./predict";
export {
  EXPLANATION_RULES,
  STRATEGY_LABELS,
  blendEstimate,
  comparablesWeight,
  formatEuros,
  roundPsychological,
  summarizeComparables,
  type BlendOptions,
  type BlendedEstimate,
  type ComparablesSummary,
  type PriceExplanation,
  type PriceStrategy,
  type StrategyKey,
} from "./blend";
export { ACCEPTED_COLUMNS, PersonalDataError, parseCsv, parseReferencesCsv, parseReferencesJson, type ParseError, type ParseResult } from "./io";
export { MODEL_STATUS_LABELS, flatMetrics, formatTrainingReport, modelStatus, type ModelStatus } from "./report";
