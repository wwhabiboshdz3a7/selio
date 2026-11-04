/**
 * Entraînement et test du modèle de prix (§5.10, partie 07 du compte rendu).
 *
 * - Nettoyage de la base (`cleanReferences`), puis seules les références **vendues** servent au
 *   modèle de prix (cible : prix final, à défaut prix affiché d'un article vendu).
 * - Entraînement sur le passé, test sur le dernier mois (`holdoutDays`, 30 j) **jamais vu** : la
 *   date d'une référence est sa date de vente. Le modèle renvoyé est exactement celui qui a été
 *   testé : son erreur mesurée est la sienne.
 * - Refus sous 500 ventes avant le mois de test (`report.insufficient`, modèle null).
 * - Validation de l'arrêt anticipé : 15 % des ventes d'entraînement, tirées à graine (jamais le
 *   mois de test).
 * - Trois modèles séparés (τ = 0,25 / 0,5 / 0,75) plutôt qu'un modèle à plusieurs sorties : chacun
 *   choisit ses propres séparations, et les quantiles sont triés à la prédiction pour ne jamais se
 *   croiser. Un quatrième modèle estime le délai médian (τ = 0,5 sur log(1 + jours)).
 * - Rien n'est présenté comme mesuré sans mesure : moins de 30 ventes dans le mois de test ⇒
 *   métriques nulles (« erreur non mesurée ») ; des références `demo` ⇒ `dataOrigin` ≠ « real ».
 * - Prix finals ESTIMÉS (`finalPriceEstimated` : annonces disparues de Track, vendues ou retirées) : jamais
 *   dans le mois de test (l'erreur publiée ne porte que sur des ventes au prix réel) ; à l'entraînement,
 *   seulement si les ventes au prix réel ne suffisent pas (moins de 500), et le rapport le dit.
 */
import { cleanReferences, DAY_MS, median, toTime, type CleanReference, type CleaningReport } from "./clean";
import {
  DELAY_FEATURES,
  PRICE_FEATURES,
  assignFolds,
  delayRow,
  encodePrice,
  fitPriceEncodings,
  fitTargetEncoding,
  fitVocab,
  outOfFoldDelay,
  outOfFoldTargets,
  priceRow,
  toColumns,
  viewOf,
} from "./features";
import { createRng, trainGbm, type GbmDataset } from "./gbm";
import { predictView } from "./predict";
import type { DataOrigin, DateInput, DelayMetrics, PriceMetrics, PriceModelParams, PriceReference, SerializedGbm, SerializedPriceModel } from "./types";

/** Nombre minimal de ventes (avant le mois de test) pour entraîner. */
export const MIN_REFERENCES = 500;
/** Nombre minimal de ventes dans le mois de test pour publier une erreur mesurée. */
export const MIN_HOLDOUT = 30;
/** Nombre minimal de ventes datées pour entraîner le modèle de délai. */
export const MIN_DELAY_REFERENCES = 200;
const FOLDS = 5;

export const DEFAULT_PRICE_MODEL_PARAMS: Readonly<PriceModelParams> = {
  trees: 300,
  learningRate: 0.05,
  maxDepth: 5,
  minLeaf: 20,
  subsample: 0.8,
  maxBins: 64,
  earlyStoppingRounds: 30,
  validationShare: 0.15,
  targetSmoothing: 20,
};

export interface TrainOptions {
  /** Date de l'entraînement : fin du mois de test. Obligatoire (aucune horloge implicite). */
  now: DateInput;
  /** Graine de tous les tirages (42 par défaut). */
  seed?: number;
  /** Durée du test, en jours (30). */
  holdoutDays?: number;
  params?: Partial<PriceModelParams>;
  /** Alias de marque supplémentaires (gardés dans le modèle). */
  brandAliases?: Readonly<Record<string, string>>;
  /** Backtest glissant : `true` = 4 fenêtres d'un mois, ou un nombre de fenêtres (2 à 12). */
  backtest?: boolean | number;
}

export interface BacktestWindow {
  from: string;
  to: string;
  nTrain: number;
  nTest: number;
  insufficient: boolean;
  price: PriceMetrics | null;
  delay: DelayMetrics | null;
}

export interface TrainingReport {
  insufficient: boolean;
  /**
   * Prix finals estimés (annonces disparues) : utilisés à l'entraînement (seulement à défaut d'assez de
   * ventes au prix réel) et écartés du mois de test.
   */
  estimated: { train: number; excludedFromTest: number };
  /** Pourquoi le modèle n'a pas été entraîné (en français), sinon null. */
  reason: string | null;
  minReferences: number;
  cleaning: CleaningReport;
  dataOrigin: DataOrigin;
  /** Ventes nettoyées, datées au plus tard de `now`. */
  usable: number;
  nTrain: number;
  nValidation: number;
  nHoldout: number;
  holdout: { from: string; to: string };
  /** Arbres retenus par modèle (après arrêt anticipé). */
  trees: { p25: number; p50: number; p75: number; delay: number | null };
  metrics: { price: PriceMetrics | null; delay: DelayMetrics | null };
  backtest: BacktestWindow[] | null;
  /** Remarques en français (« erreur non mesurée »…). */
  notes: string[];
  durationMs: number;
}

/** Vérifie les réglages : 150 à 400 arbres, profondeur 4 à 6, au plus 64 classes. */
export function resolveParams(partial: Partial<PriceModelParams> = {}): PriceModelParams {
  const p = { ...DEFAULT_PRICE_MODEL_PARAMS, ...partial };
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new RangeError(`Réglage du modèle de prix invalide : ${what}`);
  };
  check(Number.isInteger(p.trees) && p.trees >= 150 && p.trees <= 400, "trees doit être un entier de 150 à 400");
  check(Number.isInteger(p.maxDepth) && p.maxDepth >= 4 && p.maxDepth <= 6, "maxDepth doit être un entier de 4 à 6");
  check(p.learningRate > 0 && p.learningRate <= 1, "learningRate doit être dans ]0 ; 1]");
  check(Number.isInteger(p.minLeaf) && p.minLeaf >= 1, "minLeaf doit être un entier ≥ 1");
  check(p.subsample > 0 && p.subsample <= 1, "subsample doit être dans ]0 ; 1]");
  check(Number.isInteger(p.maxBins) && p.maxBins >= 2 && p.maxBins <= 64, "maxBins doit être un entier de 2 à 64");
  check(Number.isInteger(p.earlyStoppingRounds) && p.earlyStoppingRounds >= 1, "earlyStoppingRounds doit être un entier ≥ 1");
  check(p.validationShare >= 0 && p.validationShare < 0.5, "validationShare doit être dans [0 ; 0,5[");
  check(p.targetSmoothing >= 0, "targetSmoothing doit être ≥ 0");
  return p;
}

const eventTime = (r: CleanReference) => r.soldAt ?? r.listedAt;
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

function originOf(rows: readonly CleanReference[]): DataOrigin {
  const demo = rows.filter((r) => r.source === "demo").length;
  if (demo === 0) return "real";
  return demo === rows.length ? "demo" : "mixed";
}

function dataset(rows: number[][], width: number): GbmDataset {
  return { n: rows.length, columns: toColumns(rows, width) };
}

/** Entraîne les quatre modèles sur des ventes nettoyées (toutes antérieures au mois de test). */
function fitModel(
  rows: readonly CleanReference[],
  params: PriceModelParams,
  seed: number,
  meta: { now: number; cutoff: number; nReferences: number; dataOrigin: DataOrigin; brandAliases: Record<string, string> },
): { model: SerializedPriceModel; nTrain: number; nValidation: number } {
  const rng = createRng(seed);
  const isVal = rows.map(() => rng() < params.validationShare);
  let fitRows = rows.filter((_, i) => !isVal[i]);
  let valRows = rows.filter((_, i) => isVal[i]);
  if (valRows.length < 30) {
    fitRows = [...rows];
    valRows = [];
  }
  const fitViews = fitRows.map(viewOf);
  const valViews = valRows.map(viewOf);
  const fitLog = Float64Array.from(fitRows, (r) => Math.log(r.targetPriceCents!));
  const valLog = Float64Array.from(valRows, (r) => Math.log(r.targetPriceCents!));

  const vocab = fitVocab(fitViews);
  const encodings = fitPriceEncodings(fitViews, fitLog, params.targetSmoothing);
  const folds = assignFolds(fitRows.length, FOLDS, seed + 7);
  const oof = outOfFoldTargets(fitViews, fitLog, params.targetSmoothing, folds, FOLDS);
  const valTe = valViews.map((v) => encodePrice(encodings, v));

  const W = PRICE_FEATURES.length;
  const trainX = dataset(fitViews.map((v, i) => priceRow(v, oof[i]!, vocab)), W);
  const validX = dataset(valViews.map((v, i) => priceRow(v, valTe[i]!, vocab)), W);
  const gbm = (alpha: number, s: number, X: GbmDataset, y: Float64Array, vX: GbmDataset, vy: Float64Array, features = PRICE_FEATURES): SerializedGbm =>
    trainGbm({ X, y }, vX.n > 0 ? { X: vX, y: vy } : null, { ...params, features, alpha, seed: s });
  const p25 = gbm(0.25, seed + 1, trainX, fitLog, validX, valLog);
  const p50 = gbm(0.5, seed + 2, trainX, fitLog, validX, valLog);
  const p75 = gbm(0.75, seed + 3, trainX, fitLog, validX, valLog);

  // Délai : ventes datées seulement, cible log(1 + jours), quantile 0,5 (délai médian).
  const dIdx = fitRows.map((r, i) => (r.delayDays !== null ? i : -1)).filter((i) => i >= 0);
  const dValIdx = valRows.map((r, i) => (r.delayDays !== null ? i : -1)).filter((i) => i >= 0);
  const dLog = Float64Array.from(dIdx, (i) => Math.log1p(fitRows[i]!.delayDays!));
  const dViews = dIdx.map((i) => fitViews[i]!);
  const brandDelay = fitTargetEncoding(dViews.map((v) => v.brand), dLog, params.targetSmoothing);
  let delay: SerializedGbm | null = null;
  if (dIdx.length >= MIN_DELAY_REFERENCES) {
    const dFolds = Int32Array.from(dIdx, (i) => folds[i]!);
    const dOof = outOfFoldDelay(dViews, dLog, params.targetSmoothing, dFolds, FOLDS);
    const DW = DELAY_FEATURES.length;
    const dX = dataset(
      dIdx.map((i, k) => {
        const row = delayRow(fitViews[i]!, oof[i]!, vocab, brandDelay, Math.log(fitRows[i]!.listedPriceCents));
        row[DW - 2] = dOof[k]!;
        return row;
      }),
      DW,
    );
    const dvX = dataset(dValIdx.map((i) => delayRow(valViews[i]!, valTe[i]!, vocab, brandDelay, Math.log(valRows[i]!.listedPriceCents))), DW);
    const dvY = Float64Array.from(dValIdx, (i) => Math.log1p(valRows[i]!.delayDays!));
    delay = gbm(0.5, seed + 4, dX, dLog, dvX, dvY, DELAY_FEATURES);
  }

  const model: SerializedPriceModel = {
    format: "selio-price-model",
    version: 1,
    trainedAt: new Date(meta.now).toISOString(),
    trainedUntil: new Date(meta.cutoff).toISOString(),
    nReferences: meta.nReferences,
    nTrain: rows.length,
    dataOrigin: meta.dataOrigin,
    seed,
    params,
    features: { price: PRICE_FEATURES.map((f) => ({ ...f })), delay: DELAY_FEATURES.map((f) => ({ ...f })) },
    encodings: {
      ...encodings,
      brandDelay,
      categories: vocab.categories,
      materials: vocab.materials,
      colors: vocab.colors,
      brandCounts: vocab.brandCounts,
      brandAliases: meta.brandAliases,
    },
    models: { p25, p50, p75, delay },
    metrics: { price: null, delay: null },
  };
  return { model, nTrain: fitRows.length, nValidation: valRows.length };
}

/** Erreur d'une estimation naïve : médiane des ventes d'entraînement de même marque et catégorie (à défaut marque, catégorie, tout). */
function baselinePredictor(train: readonly CleanReference[]): (r: CleanReference) => number {
  const groups = new Map<string, number[]>();
  const add = (k: string, v: number) => {
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  for (const r of train) {
    add(`bc|${r.brand}|${r.category}`, r.targetPriceCents!);
    add(`b|${r.brand}`, r.targetPriceCents!);
    add(`c|${r.category}`, r.targetPriceCents!);
    add("*", r.targetPriceCents!);
  }
  const med = new Map<string, number>();
  for (const [k, v] of groups) med.set(k, median(v));
  return (r) => {
    const bc = groups.get(`bc|${r.brand}|${r.category}`);
    if (bc && bc.length >= 3) return med.get(`bc|${r.brand}|${r.category}`)!;
    const b = groups.get(`b|${r.brand}`);
    if (b && b.length >= 3) return med.get(`b|${r.brand}`)!;
    return med.get(`c|${r.category}`) ?? med.get("*")!;
  };
}

/** Mesure le modèle sur des ventes jamais vues. Null sous MIN_HOLDOUT ventes. */
export function evaluateModel(model: SerializedPriceModel, test: readonly CleanReference[], train: readonly CleanReference[] = []): { price: PriceMetrics | null; delay: DelayMetrics | null } {
  const sold = test.filter((r) => r.targetPriceCents !== null);
  if (sold.length < MIN_HOLDOUT) return { price: null, delay: null };
  const baseline = train.length ? baselinePredictor(train) : null;
  const ape: number[] = [];
  const baseApe: number[] = [];
  let inside = 0;
  const delayErr: number[] = [];
  for (const r of sold) {
    const actual = r.targetPriceCents!;
    const p = predictView(model, viewOf(r), r.listedPriceCents);
    ape.push(Math.abs(p.p50 - actual) / actual);
    if (actual >= p.p25 && actual <= p.p75) inside++;
    if (baseline) baseApe.push(Math.abs(baseline(r) - actual) / actual);
    if (r.delayDays !== null && p.delayAtListed !== null) delayErr.push(Math.abs(p.delayAtListed - r.delayDays));
  }
  const price: PriceMetrics = {
    n: sold.length,
    mdape: round4(median(ape)),
    mape: round4(mean(ape)),
    within20: round4(ape.filter((e) => e <= 0.2).length / ape.length),
    coverage50: round4(inside / sold.length),
    baselineMdape: baseApe.length ? round4(median(baseApe)) : null,
  };
  const delay: DelayMetrics | null = delayErr.length >= MIN_HOLDOUT ? { n: delayErr.length, mdaeDays: round2(median(delayErr)), maeDays: round2(mean(delayErr)) } : null;
  return { price, delay };
}

interface WindowResult {
  model: SerializedPriceModel | null;
  nTrain: number;
  nValidation: number;
  nTest: number;
  /** Lignes d'entraînement au prix estimé, et ventes estimées du mois de test écartées de la mesure. */
  nEstimatedTrain: number;
  nEstimatedExcluded: number;
  metrics: { price: PriceMetrics | null; delay: DelayMetrics | null };
}

function runWindow(
  sold: readonly CleanReference[],
  from: number,
  to: number,
  params: PriceModelParams,
  seed: number,
  meta: { now: number; nReferences: number; brandAliases: Record<string, string> },
): WindowResult {
  const before = sold.filter((r) => eventTime(r) < from);
  const realBefore = before.filter((r) => !r.finalPriceEstimated);
  // Prix estimés à l'entraînement seulement à défaut d'assez de ventes au prix réel.
  const train = realBefore.length >= MIN_REFERENCES ? realBefore : before;
  const inWindow = sold.filter((r) => eventTime(r) >= from && eventTime(r) <= to);
  // Mois de test : ventes au prix RÉEL seulement (l'erreur publiée n'est jamais mesurée sur des prix supposés).
  const test = inWindow.filter((r) => !r.finalPriceEstimated);
  const estimated = { nEstimatedTrain: train.length - train.filter((r) => !r.finalPriceEstimated).length, nEstimatedExcluded: inWindow.length - test.length };
  if (train.length < MIN_REFERENCES) return { model: null, nTrain: train.length, nValidation: 0, nTest: test.length, ...estimated, metrics: { price: null, delay: null } };
  const fitted = fitModel(train, params, seed, { ...meta, cutoff: from, dataOrigin: originOf(train) });
  const metrics = evaluateModel(fitted.model, test, train);
  fitted.model.metrics = metrics;
  return { model: fitted.model, nTrain: fitted.nTrain, nValidation: fitted.nValidation, nTest: test.length, ...estimated, metrics };
}

/**
 * Entraîne le modèle de prix sur le passé et le teste sur le dernier mois jamais vu.
 * Renvoie `model: null` (et `report.insufficient = true`) sous 500 ventes d'entraînement.
 */
export function trainPriceModel(references: readonly PriceReference[], options: TrainOptions): { model: SerializedPriceModel | null; report: TrainingReport } {
  const started = performance.now();
  const now = toTime(options.now);
  if (now === null) throw new RangeError("trainPriceModel : date « now » invalide");
  const seed = options.seed ?? 42;
  const holdoutDays = options.holdoutDays ?? 30;
  if (!(holdoutDays > 0 && holdoutDays <= 366)) throw new RangeError("trainPriceModel : holdoutDays doit être entre 1 et 366");
  const params = resolveParams(options.params);
  const brandAliases = { ...(options.brandAliases ?? {}) };
  const { references: clean, report: cleaning } = cleanReferences(references, { now: new Date(now), brandAliases });
  const sold = clean.filter((r) => r.targetPriceCents !== null && eventTime(r) <= now);
  const cutoff = now - holdoutDays * DAY_MS;
  const meta = { now, nReferences: references.length, brandAliases };
  const notes: string[] = [];
  const dataOrigin = originOf(sold);
  if (dataOrigin !== "real") notes.push(dataOrigin === "demo" ? "Données de démonstration : aucune erreur n'est une mesure réelle." : "Base mêlant données réelles et données de démonstration : l'erreur n'est pas une mesure réelle.");

  const main = runWindow(sold, cutoff, now, params, seed, meta);
  const holdout = { from: new Date(cutoff).toISOString(), to: new Date(now).toISOString() };
  const baseReport = {
    minReferences: MIN_REFERENCES,
    cleaning,
    dataOrigin,
    usable: sold.length,
    nTrain: main.nTrain,
    nValidation: main.nValidation,
    nHoldout: main.nTest,
    holdout,
    estimated: { train: main.nEstimatedTrain, excludedFromTest: main.nEstimatedExcluded },
  };
  if (main.nEstimatedExcluded > 0) notes.push(`${main.nEstimatedExcluded} vente(s) du mois de test au prix estimé (annonces disparues, vendues ou retirées) écartée(s) de la mesure.`);
  if (main.nEstimatedTrain > 0) notes.push(`Moins de ${MIN_REFERENCES} ventes au prix réel : ${main.nEstimatedTrain} prix estimé(s) (annonces disparues) utilisé(s) à l'entraînement.`);
  if (!main.model) {
    const reason = `Pas assez de ventes pour entraîner : ${main.nTrain} avant le ${holdout.from.slice(0, 10)}, il en faut au moins ${MIN_REFERENCES}. Modèle non entraîné.`;
    return {
      model: null,
      report: { ...baseReport, insufficient: true, reason, trees: { p25: 0, p50: 0, p75: 0, delay: null }, metrics: { price: null, delay: null }, backtest: null, notes: [...notes, reason], durationMs: Math.round(performance.now() - started) },
    };
  }
  if (!main.metrics.price) notes.push(`Moins de ${MIN_HOLDOUT} ventes dans le mois de test (${main.nTest}) : erreur non mesurée.`);
  if (!main.model.models.delay) notes.push(`Moins de ${MIN_DELAY_REFERENCES} ventes datées : modèle de délai non entraîné.`);
  else if (!main.metrics.delay) notes.push("Erreur du délai non mesurée (trop peu de ventes datées dans le mois de test).");

  let backtest: BacktestWindow[] | null = null;
  if (options.backtest) {
    const windows = options.backtest === true ? 4 : Math.max(2, Math.min(12, Math.floor(options.backtest)));
    backtest = [];
    for (let k = 0; k < windows; k++) {
      const to = now - k * holdoutDays * DAY_MS;
      const from = to - holdoutDays * DAY_MS;
      const w = k === 0 ? main : runWindow(sold, from, to, params, seed, meta);
      backtest.push({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), nTrain: w.nTrain + w.nValidation, nTest: w.nTest, insufficient: w.model === null, price: w.metrics.price, delay: w.metrics.delay });
    }
  }

  const m = main.model;
  return {
    model: m,
    report: {
      ...baseReport,
      insufficient: false,
      reason: null,
      trees: { p25: m.models.p25.trees.length, p50: m.models.p50.trees.length, p75: m.models.p75.trees.length, delay: m.models.delay ? m.models.delay.trees.length : null },
      metrics: main.metrics,
      backtest,
      notes,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
