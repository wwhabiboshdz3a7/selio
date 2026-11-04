import { createHash } from "node:crypto";
import { flatMetrics, serializePriceModel, trainPriceModel, type PriceReference, type SerializedPriceModel } from "@selio/pricing";
import type { PriceTrainOutcome, PriceTrainingRow } from "@selio/core";

/**
 * Entraînement du modèle de prix, partie pure (aucune base, aucun réseau) : utilisée dans le processus du
 * worker (tests) et dans le fil d'exécution séparé (`pricing-train-thread.ts`) qui garde la boucle
 * d'événements du worker libre pendant le calcul.
 */

/** Graine de l'entraînement : même base, même modèle (déterministe). */
export const PRICING_TRAIN_SEED = 42;

/** Ligne d'entraînement du cœur → référence de @selio/pricing (mêmes champs autorisés, rien d'autre). */
export function toPricingReference(row: PriceTrainingRow): PriceReference {
  return {
    brand: row.brand,
    category: row.category,
    subcategory: row.subcategory,
    size: row.size,
    material: row.material,
    color: row.color,
    condition: row.condition,
    listedPriceCents: row.listedPriceCents,
    finalPriceCents: row.finalPriceCents,
    finalPriceEstimated: row.finalPriceEstimated,
    listedAt: row.listedAt,
    soldAt: row.soldAt,
    photoCount: row.photoCount,
    views: row.views,
    favorites: row.favorites,
    source: row.source,
  };
}

/** Version lisible et unique d'un modèle : date et heure de l'entraînement, origine, empreinte du JSON. */
export function priceModelVersion(model: SerializedPriceModel, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const digest = createHash("sha256").update(serializePriceModel(model), "utf8").digest("hex").slice(0, 10);
  return `gbm-${stamp}-${model.dataOrigin === "real" ? "real" : "demo"}-${digest}`;
}

/** Résumé du rapport d'entraînement (compteurs et mesures seulement, aucune référence). */
export interface PriceTrainReportSummary {
  usable: number;
  nTrain: number;
  nHoldout: number;
  insufficient: boolean;
  dataOrigin: string;
  mdape: number | null;
  within20: number | null;
  coverage50: number | null;
  /** Prix estimés (annonces disparues) utilisés à l'entraînement, et écartés du mois de test. */
  estimatedTrain: number;
  estimatedExcludedFromTest: number;
  durationMs: number;
}

/** Entraîne et met en forme le résultat attendu par le cœur (`PriceTrainOutcome`). */
export function trainOutcome(rows: readonly PriceTrainingRow[], opts: { now: Date; synthetic: boolean; seed?: number }): { outcome: PriceTrainOutcome; summary: PriceTrainReportSummary } {
  const { model, report } = trainPriceModel(rows.map(toPricingReference), { now: opts.now, seed: opts.seed ?? PRICING_TRAIN_SEED });
  const p = report.metrics.price;
  const summary: PriceTrainReportSummary = {
    usable: report.usable, nTrain: report.nTrain, nHoldout: report.nHoldout, insufficient: report.insufficient, dataOrigin: report.dataOrigin,
    mdape: p?.mdape ?? null, within20: p?.within20 ?? null, coverage50: p?.coverage50 ?? null,
    estimatedTrain: report.estimated.train, estimatedExcludedFromTest: report.estimated.excludedFromTest, durationMs: Math.round(report.durationMs),
  };
  if (!model) return { outcome: { ok: false, reason: report.reason ?? "Modèle de prix non entraîné." }, summary };
  return { outcome: { ok: true, version: priceModelVersion(model, opts.now), model, metrics: { ...flatMetrics(report), synthetic: opts.synthetic }, nReferences: model.nReferences }, summary };
}
