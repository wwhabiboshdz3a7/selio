/**
 * Prédiction avec un modèle de prix sérialisé : trois quantiles du prix (P25 / P50 / P75), délai
 * de vente médian à chacun de ces prix, niveau de confiance et facteurs d'explication.
 *
 * Moins de 5 ms par article : quatre ensembles d'au plus 400 arbres de profondeur 6, parcourus
 * sans allocation notable. Aucune entrée/sortie, aucun hasard.
 */
import {
  CONDITION_LABELS,
  CONDITION_ORDINAL,
  DEFAULT_BRAND_ALIASES,
  SEASON_LABELS,
  SEASONS,
  normalizeBrand,
  normalizeCategory,
  normalizeColor,
  normalizeMaterial,
  parseCondition,
  parseSize,
  seasonOf,
  toTime,
} from "./clean";
import { delayRow, encodePrice, encodeTarget, priceRow, type EncodedTargets, type ItemView, type Vocab } from "./features";
import { predictGbm, validateGbm } from "./gbm";
import type { DateInput, PriceConfidence, PriceFactor, PriceFeatures, PricePrediction, SerializedGbm, SerializedPriceModel } from "./types";

const vocabOf = (m: SerializedPriceModel): Vocab => ({
  categories: m.encodings.categories,
  materials: m.encodings.materials,
  colors: m.encodings.colors,
  brandCounts: m.encodings.brandCounts,
});

/** Article à estimer → vue normalisée, avec les alias de marque du modèle. */
export function viewOfFeatures(model: SerializedPriceModel, f: PriceFeatures, now?: DateInput): ItemView {
  const aliases = { ...DEFAULT_BRAND_ALIASES, ...model.encodings.brandAliases };
  const category = normalizeCategory(f.category);
  const subcategory = normalizeCategory(f.subcategory) || null;
  const condition = parseCondition(f.condition);
  const listed = toTime(f.listedAt ?? null) ?? toTime(now ?? null) ?? Date.now();
  const photos = typeof f.photoCount === "number" && Number.isFinite(f.photoCount) && f.photoCount >= 0 ? Math.round(f.photoCount) : null;
  return {
    brand: normalizeBrand(f.brand ?? "", aliases),
    category,
    subcategory,
    size: parseSize(f.size, category, subcategory),
    material: normalizeMaterial(f.material),
    color: normalizeColor(f.color),
    conditionOrdinal: condition ? CONDITION_ORDINAL[condition] : -1,
    season: seasonOf(listed),
    photoCount: photos,
  };
}

/** Quantiles (logarithme du prix en centimes), triés pour éviter tout croisement. */
function logQuantiles(model: SerializedPriceModel, row: number[]): [number, number, number] {
  const q = [predictGbm(model.models.p25, row), predictGbm(model.models.p50, row), predictGbm(model.models.p75, row)].sort((a, b) => a - b);
  return [q[0]!, q[1]!, q[2]!];
}

const toCents = (logCents: number) => Math.max(1, Math.round(Math.exp(logCents)));

/** Délai médian (jours) au prix donné, ou null sans modèle de délai. */
function delayAt(model: SerializedPriceModel, view: ItemView, te: EncodedTargets, priceCents: number, delayModel: SerializedGbm | null): number | null {
  if (!delayModel) return null;
  const row = delayRow(view, te, vocabOf(model), model.encodings.brandDelay, Math.log(priceCents));
  const days = Math.expm1(predictGbm(delayModel, row));
  return Math.round(Math.max(0, days) * 10) / 10;
}

/** Prédiction brute d'une vue (utilisée aussi par l'évaluation de l'entraînement). */
export function predictView(model: SerializedPriceModel, view: ItemView, listedPriceCents?: number): { p25: number; p50: number; p75: number; delayDays: number | null; delayAt: { p25: number; p50: number; p75: number } | null; delayAtListed: number | null } {
  const te = encodePrice(model.encodings, view);
  const row = priceRow(view, te, vocabOf(model));
  const [l25, l50, l75] = logQuantiles(model, row);
  const p25 = toCents(l25);
  const p50 = toCents(l50);
  const p75 = toCents(l75);
  const d = model.models.delay;
  const d50 = delayAt(model, view, te, p50, d);
  const at = d ? { p25: delayAt(model, view, te, p25, d)!, p50: d50!, p75: delayAt(model, view, te, p75, d)! } : null;
  const delayAtListed = listedPriceCents !== undefined ? delayAt(model, view, te, listedPriceCents, d) : null;
  return { p25, p50, p75, delayDays: d50, delayAt: at, delayAtListed };
}

/**
 * Confiance (heuristique, jamais présentée comme une mesure) : faible tant que le modèle n'a pas
 * d'erreur mesurée sur de vraies données ; sinon selon l'historique de la marque, la largeur de
 * l'intervalle P25–P75 et l'erreur mesurée.
 */
export function modelConfidence(model: SerializedPriceModel, brandSupport: number, p25: number, p75: number): PriceConfidence {
  const mdape = model.metrics.price?.mdape ?? null;
  if (mdape === null || model.dataOrigin !== "real") return "low";
  const ratio = p25 > 0 ? p75 / p25 : Infinity;
  if (brandSupport >= 30 && ratio <= 1.6 && mdape <= 0.25) return "high";
  if (brandSupport >= 5 && ratio <= 2.2) return "medium";
  return "low";
}

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

function p50Log(model: SerializedPriceModel, view: ItemView): number {
  return predictGbm(model.models.p50, priceRow(view, encodePrice(model.encodings, view), vocabOf(model)));
}

/** Facteurs d'explication : effet de chaque caractéristique sur le prix médian, par comparaison à une référence neutre. */
export function explainView(model: SerializedPriceModel, view: ItemView, features: PriceFeatures): PriceFactor[] {
  const base = p50Log(model, view);
  const effect = (alt: ItemView) => round3(Math.exp(base - p50Log(model, alt)) - 1);
  const support = model.encodings.brandCounts[view.brand] ?? 0;
  const factors: PriceFactor[] = [];
  factors.push({
    key: "brand",
    label: "Marque",
    value: features.brand?.trim() || "Sans marque",
    effect: effect({ ...view, brand: "\u0000inconnue" }),
    versus: "une marque sans historique, même catégorie",
    support,
  });
  const condition = parseCondition(features.condition);
  factors.push({
    key: "condition",
    label: "État",
    value: condition ? CONDITION_LABELS[condition] : "Non renseigné",
    effect: condition && condition !== "very_good" ? effect({ ...view, conditionOrdinal: CONDITION_ORDINAL.very_good }) : condition ? 0 : null,
    versus: "très bon état",
  });
  factors.push({
    key: "size",
    label: "Taille",
    value: features.size?.trim() || "Non renseignée",
    effect: view.size.system === "unknown" ? null : effect({ ...view, size: { system: "unknown", ordinal: -1, key: "unknown" } }),
    versus: "taille non renseignée",
  });
  const seasonal = SEASONS.map((s) => p50Log(model, { ...view, season: s }));
  const avg = seasonal.reduce((a, b) => a + b, 0) / seasonal.length;
  factors.push({ key: "season", label: "Saison", value: SEASON_LABELS[view.season], effect: round3(Math.exp(base - avg) - 1), versus: "la moyenne des quatre saisons" });
  if (view.material !== null) factors.push({ key: "material", label: "Matière", value: features.material?.trim() || view.material, effect: effect({ ...view, material: null }), versus: "matière non renseignée" });
  const mdape = model.metrics.price?.mdape ?? null;
  factors.push({
    key: "model_error",
    label: "Erreur du modèle",
    value: mdape === null ? "Non mesurée" : `${Math.round(mdape * 100)} % d'erreur médiane sur le dernier mois${model.dataOrigin === "real" ? "" : " (données de démonstration)"}`,
    effect: null,
  });
  return factors;
}

/** Prédit le prix d'un article (P25 / P50 / P75 en centimes) et son délai de vente médian. */
export function predictPrice(model: SerializedPriceModel, features: PriceFeatures, options: { explain?: boolean; now?: DateInput } = {}): PricePrediction {
  const view = viewOfFeatures(model, features, options.now);
  const p = predictView(model, view);
  const support = model.encodings.brandCounts[view.brand] ?? 0;
  const out: PricePrediction = {
    p25: p.p25,
    p50: p.p50,
    p75: p.p75,
    delayDays: p.delayDays,
    delayAt: p.delayAt,
    confidence: modelConfidence(model, support, p.p25, p.p75),
    method: "model",
    modelTrainedAt: model.trainedAt,
    dataOrigin: model.dataOrigin,
    measuredMdape: model.metrics.price?.mdape ?? null,
  };
  if (options.explain) out.factors = explainView(model, view, features);
  return out;
}

/** Délai de vente médian estimé si l'article est affiché à `priceCents` (null sans modèle de délai). */
export function predictDelay(model: SerializedPriceModel, features: PriceFeatures, priceCents: number, options: { now?: DateInput } = {}): number | null {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null;
  const view = viewOfFeatures(model, features, options.now);
  return delayAt(model, view, encodePrice(model.encodings, view), priceCents, model.models.delay);
}

/** Valeur lissée de la marque (logarithme du prix), exposée pour les tests et les écrans d'administration. */
export function brandLevel(model: SerializedPriceModel, brand: string): number {
  const key = normalizeBrand(brand, { ...DEFAULT_BRAND_ALIASES, ...model.encodings.brandAliases });
  return encodeTarget(model.encodings.brand, key);
}

// ------------------------------------------------------------------ sérialisation

/** Texte JSON du modèle (à stocker tel quel). */
export function serializePriceModel(model: SerializedPriceModel): string {
  return JSON.stringify(model);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Recharge et vérifie un modèle sérialisé (texte JSON ou objet). Lève une erreur explicite s'il est invalide. */
export function loadPriceModel(json: string | unknown): SerializedPriceModel {
  const raw: unknown = typeof json === "string" ? JSON.parse(json) : json;
  if (!isRecord(raw) || raw.format !== "selio-price-model") throw new Error("Modèle de prix invalide : format inconnu");
  if (raw.version !== 1) throw new Error(`Modèle de prix : version ${String(raw.version)} non prise en charge`);
  const m = raw as unknown as SerializedPriceModel;
  if (!isRecord(m.models) || !isRecord(m.encodings) || !isRecord(m.metrics)) throw new Error("Modèle de prix invalide : sections manquantes");
  for (const k of ["brand", "category", "brandCategory", "subcategory", "brandDelay"] as const) {
    const e = m.encodings[k];
    if (!isRecord(e) || !isRecord(e.stats) || typeof e.prior !== "number" || typeof e.smoothing !== "number") throw new Error(`Modèle de prix invalide : encodage ${k}`);
  }
  if (!Array.isArray(m.encodings.categories) || !Array.isArray(m.encodings.materials) || !Array.isArray(m.encodings.colors)) throw new Error("Modèle de prix invalide : modalités");
  for (const k of ["p25", "p50", "p75"] as const) {
    if (!isRecord(m.models[k])) throw new Error(`Modèle de prix invalide : modèle ${k}`);
    validateGbm(m.models[k]);
  }
  if (m.models.delay !== null) validateGbm(m.models.delay);
  return m;
}
