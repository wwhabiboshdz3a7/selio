/**
 * Rapport d'entraînement en français (script d'évaluation, écrans d'administration).
 * Une erreur n'est affichée comme mesurée que si elle l'a été, et l'origine des données est dite.
 */
import { CLEANING_REASON_LABELS, CLEANING_REASONS } from "./clean";
import type { TrainingReport } from "./train";
import type { PriceMetrics, SerializedPriceModel } from "./types";

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} %`;
const n = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** État du modèle tel qu'il doit être affiché dans l'interface. */
export type ModelStatus = "not_trained" | "demo_data" | "unmeasured" | "measured";

export const MODEL_STATUS_LABELS: Readonly<Record<ModelStatus, string>> = {
  not_trained: "Modèle non entraîné",
  demo_data: "Données de démonstration",
  unmeasured: "Erreur non mesurée",
  measured: "Erreur mesurée sur le dernier mois",
};

/** Statut d'affichage : jamais « mesuré » sans mesure sur de vraies données. */
export function modelStatus(model: Pick<SerializedPriceModel, "dataOrigin" | "metrics"> | null): ModelStatus {
  if (!model) return "not_trained";
  if (model.dataOrigin !== "real") return "demo_data";
  if (!model.metrics.price) return "unmeasured";
  return "measured";
}

function metricsLines(m: PriceMetrics, indent = "  "): string[] {
  const lines = [
    `${indent}Ventes testées : ${n(m.n)}`,
    `${indent}Erreur médiane (MdAPE) : ${pct(m.mdape)}`,
    `${indent}Erreur moyenne (MAPE) : ${pct(m.mape)}`,
    `${indent}Estimations à ±20 % : ${pct(m.within20)}`,
    `${indent}Prix réels dans l'intervalle P25–P75 : ${pct(m.coverage50)} (50 % attendu)`,
  ];
  if (m.baselineMdape !== null) lines.push(`${indent}Pour comparaison, médiane de la marque et de la catégorie : ${pct(m.baselineMdape)} d'erreur médiane`);
  return lines;
}

export function formatTrainingReport(report: TrainingReport): string {
  const out: string[] = [];
  const c = report.cleaning;
  out.push("Nettoyage de la base");
  out.push(`  Lignes lues : ${n(c.input)} ; gardées : ${n(c.kept)} (vendues : ${n(c.sold)}, non vendues : ${n(c.unsold)})`);
  for (const r of CLEANING_REASONS) if (c.dropped[r] > 0) out.push(`  Écartées — ${CLEANING_REASON_LABELS[r]} : ${n(c.dropped[r])}`);
  const sources = Object.entries(c.bySource).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${n(v)}`);
  if (sources.length) out.push(`  Sources : ${sources.join(", ")}`);
  out.push("");
  out.push(`Données : ${report.dataOrigin === "real" ? "réelles" : report.dataOrigin === "demo" ? "DÉMONSTRATION (synthétiques)" : "mêlées (réelles et démonstration)"}`);
  out.push(`Mois de test : du ${report.holdout.from.slice(0, 10)} au ${report.holdout.to.slice(0, 10)} (jamais vu à l'entraînement)`);
  out.push(`Ventes utilisables : ${n(report.usable)} ; entraînement : ${n(report.nTrain)} ; validation (arrêt anticipé) : ${n(report.nValidation)} ; test : ${n(report.nHoldout)}`);
  if (report.estimated.train > 0 || report.estimated.excludedFromTest > 0) out.push(`Prix estimés (annonces disparues) : ${n(report.estimated.train)} à l'entraînement, ${n(report.estimated.excludedFromTest)} écartés du test`);
  if (report.insufficient) {
    out.push("");
    out.push(`MODÈLE NON ENTRAÎNÉ — ${report.reason ?? ""}`);
    return out.join("\n");
  }
  out.push(`Arbres retenus : P25 ${report.trees.p25}, P50 ${report.trees.p50}, P75 ${report.trees.p75}, délai ${report.trees.delay ?? "—"}`);
  out.push("");
  out.push(report.dataOrigin === "real" ? "Prix (dernier mois)" : "Prix (dernier mois, données de démonstration : pas une mesure réelle)");
  if (report.metrics.price) out.push(...metricsLines(report.metrics.price));
  else out.push("  Erreur non mesurée");
  out.push("Délai de vente (dernier mois)");
  if (report.metrics.delay) out.push(`  Ventes testées : ${n(report.metrics.delay.n)} ; erreur médiane : ${report.metrics.delay.mdaeDays.toFixed(1).replace(".", ",")} j ; erreur moyenne : ${report.metrics.delay.maeDays.toFixed(1).replace(".", ",")} j`);
  else out.push("  Erreur non mesurée");
  if (report.backtest) {
    out.push("");
    out.push("Backtest glissant (une fenêtre par mois, du plus récent au plus ancien)");
    for (const w of report.backtest) {
      const head = `  ${w.from.slice(0, 10)} → ${w.to.slice(0, 10)} : entraînement ${n(w.nTrain)}, test ${n(w.nTest)}`;
      if (w.insufficient) out.push(`${head} — pas assez de ventes`);
      else if (!w.price) out.push(`${head} — erreur non mesurée`);
      else out.push(`${head} — MdAPE ${pct(w.price.mdape)}, ±20 % ${pct(w.price.within20)}, P25–P75 ${pct(w.price.coverage50)}`);
    }
  }
  if (report.notes.length) {
    out.push("");
    for (const note of report.notes) out.push(`Remarque : ${note}`);
  }
  out.push(`Durée : ${(report.durationMs / 1000).toFixed(1).replace(".", ",")} s`);
  return out.join("\n");
}

/**
 * Métriques à plat (nombres, textes, booléens ou null) pour un enregistrement en base
 * (`price_models.metrics`). Les erreurs non mesurées valent null, jamais 0.
 */
export function flatMetrics(report: TrainingReport): Record<string, number | string | boolean | null> {
  const p = report.metrics.price;
  const d = report.metrics.delay;
  return {
    dataOrigin: report.dataOrigin,
    measured: p !== null && report.dataOrigin === "real",
    insufficient: report.insufficient,
    usable: report.usable,
    nTrain: report.nTrain,
    nValidation: report.nValidation,
    nHoldout: report.nHoldout,
    holdoutFrom: report.holdout.from,
    holdoutTo: report.holdout.to,
    estimatedTrain: report.estimated.train,
    estimatedExcludedFromTest: report.estimated.excludedFromTest,
    mdape: p?.mdape ?? null,
    mape: p?.mape ?? null,
    within20: p?.within20 ?? null,
    coverage50: p?.coverage50 ?? null,
    baselineMdape: p?.baselineMdape ?? null,
    delayN: d?.n ?? null,
    delayMdaeDays: d?.mdaeDays ?? null,
    delayMaeDays: d?.maeDays ?? null,
    treesP25: report.trees.p25,
    treesP50: report.trees.p50,
    treesP75: report.trees.p75,
    treesDelay: report.trees.delay,
  };
}
