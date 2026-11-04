import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { PriceFeatures } from "@selio/contracts";
import { loadPriceModel, predictPrice, type SerializedPriceModel } from "@selio/pricing";
import type { PriceModelLike, PricePredictionLike, PriceTrainOutcome, PriceTrainerLike, PriceTrainingRow, PricingServices } from "@selio/core";
import { PRICING_TRAIN_SEED, priceModelVersion, toPricingReference, trainOutcome, type PriceTrainReportSummary } from "./pricing-train";

export { PRICING_TRAIN_SEED, priceModelVersion, toPricingReference };

/**
 * Modèle de prix (§5.10) côté worker : adaptateurs entre le cœur (`services.pricing`, interfaces
 * `PriceModelLike` / `PriceTrainerLike`, qui ne dépendent pas de @selio/pricing) et le gradient boosting
 * quantile de @selio/pricing.
 *
 * - Entraînement : les ventes de la base (sans donnée personnelle) → `trainPriceModel` (P25 / P50 / P75
 *   et délai, test sur le dernier mois jamais vu, refus sous 500 ventes) → modèle JSON enregistré par le cœur
 *   dans `price_models`, mesures à plat (`flatMetrics` : erreurs nulles quand elles ne sont pas mesurées).
 * - Le calcul tourne dans un FIL D'EXÉCUTION SÉPARÉ (worker_threads, `ThreadedPriceTrainer`) : environ 6 s
 *   pour 20 000 références et 37 s pour 100 000 sur le poste de développement (à mesurer sur la machine),
 *   pendant lesquels la boucle d'événements du worker (Radar, Cloud, Track, fenêtres de connexion) reste
 *   libre. Au-delà de PRICING_TRAIN_MAX_MS, le fil est arrêté (« entraînement interrompu ») et l'ancien
 *   modèle reste actif.
 * - Chargement : le JSON enregistré → `loadPriceModel` (vérifié) → prédiction sur le processeur.
 */

/** Durée maximale d'un entraînement par défaut (10 min), au-delà le fil est arrêté. */
export const PRICING_TRAIN_DEFAULT_MAX_MS = 10 * 60_000;
/** Mémoire maximale du fil d'entraînement (Mo). */
const TRAIN_THREAD_MAX_OLD_GEN_MB = 2048;

/** Modèle enregistré et chargé, vu par le cœur. */
export class LoadedPriceModel implements PriceModelLike {
  constructor(
    private readonly model: SerializedPriceModel,
    readonly version: string,
    /** Entraîné sur des données de démonstration (simulateur) : jamais présenté comme mesuré. */
    readonly synthetic: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  predict(features: PriceFeatures): PricePredictionLike {
    const p = predictPrice(this.model, {
      brand: features.brand ?? null,
      category: features.category,
      subcategory: features.subcategory ?? null,
      size: features.size ?? null,
      material: features.material ?? null,
      color: features.color ?? null,
      condition: features.condition ?? null,
      photoCount: features.photoCount ?? null,
    }, { now: this.now() });
    const origin = p.dataOrigin ?? this.model.dataOrigin;
    return { p25: p.p25, p50: p.p50, p75: p.p75, delayDays: p.delayDays, confidence: p.confidence, dataOrigin: this.synthetic ? "demo" : origin };
  }
}

/** Recharge un modèle enregistré (`price_models.model`) ; lève une erreur explicite s'il est invalide. */
export function loadStoredPriceModel(stored: { version: string; model: unknown; synthetic: boolean }, now: () => Date = () => new Date()): PriceModelLike {
  const model = loadPriceModel(stored.model);
  return new LoadedPriceModel(model, stored.version, stored.synthetic || model.dataOrigin !== "real", now);
}

export interface GbmTrainerOptions {
  seed?: number;
  /** Journal du rapport d'entraînement (compteurs et mesures seulement, aucune référence). */
  onReport?: (summary: PriceTrainReportSummary) => void;
}

/**
 * Entraîneur DANS le processus (tests unitaires, outils) : bloque la boucle d'événements le temps du calcul.
 * Le worker utilise `ThreadedPriceTrainer`.
 */
export class GbmPriceTrainer implements PriceTrainerLike {
  constructor(private readonly options: GbmTrainerOptions = {}) {}

  async train(rows: readonly PriceTrainingRow[], opts: { now: Date; synthetic: boolean }): Promise<PriceTrainOutcome> {
    await new Promise((resolve) => setImmediate(resolve));
    const { outcome, summary } = trainOutcome(rows, { now: opts.now, synthetic: opts.synthetic, ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}) });
    this.options.onReport?.(summary);
    return outcome;
  }
}

export interface ThreadedTrainerOptions extends GbmTrainerOptions {
  /** Durée maximale d'un entraînement (PRICING_TRAIN_MAX_MS) : au-delà, le fil est arrêté. */
  maxMs?: number;
}

/** Fichier du fil et options : `dist/pricing-train-thread.js` en production, amorce tsx sur les sources. */
function threadTarget(): { url: URL; workerData: Record<string, unknown> } {
  const here = import.meta.url;
  if (!/\.ts$/.test(new URL(here).pathname)) return { url: new URL("./pricing-train-thread.js", here), workerData: {} };
  const tsxPackage = createRequire(here).resolve("tsx/package.json");
  return {
    url: new URL("./pricing-train-boot.mjs", here),
    workerData: { tsxApi: new URL("dist/esm/api/index.mjs", pathToFileURL(tsxPackage)).href, entry: new URL("./pricing-train-thread.ts", here).href },
  };
}

type ThreadMessage = ({ type: "done" } & ReturnType<typeof trainOutcome>) | { type: "error"; message: string };

/**
 * Entraîneur du worker : `trainPriceModel` dans un fil worker_threads (lignes copiées, sans donnée
 * personnelle), arrêté au-delà de `maxMs`. Un échec ou un dépassement rend `{ ok: false }` : le cœur garde
 * alors l'ancien modèle actif (rien n'est rechargé).
 */
export class ThreadedPriceTrainer implements PriceTrainerLike {
  constructor(private readonly options: ThreadedTrainerOptions = {}) {}

  train(rows: readonly PriceTrainingRow[], opts: { now: Date; synthetic: boolean }): Promise<PriceTrainOutcome> {
    const maxMs = Math.max(1, Math.round(this.options.maxMs ?? PRICING_TRAIN_DEFAULT_MAX_MS));
    let target: ReturnType<typeof threadTarget>;
    try {
      target = threadTarget();
    } catch {
      return Promise.resolve({ ok: false, reason: "Entraînement impossible : fil d'exécution introuvable." });
    }
    return new Promise<PriceTrainOutcome>((resolve) => {
      let settled = false;
      const worker = new Worker(target.url, {
        workerData: { ...target.workerData, rows: [...rows], now: opts.now.toISOString(), synthetic: opts.synthetic, ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}) },
        resourceLimits: { maxOldGenerationSizeMb: TRAIN_THREAD_MAX_OLD_GEN_MB },
      });
      const finish = (out: PriceTrainOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate().catch(() => undefined);
        resolve(out);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: `Entraînement interrompu : plus de ${Math.round(maxMs / 1000)} s (PRICING_TRAIN_MAX_MS). L'ancien modèle reste actif.` }), maxMs);
      timer.unref?.();
      worker.once("message", (msg: ThreadMessage) => {
        if (msg.type === "done") {
          this.options.onReport?.(msg.summary);
          finish(msg.outcome);
        } else finish({ ok: false, reason: `Entraînement en échec : ${msg.message}` });
      });
      worker.once("error", (err) => finish({ ok: false, reason: `Entraînement en échec : ${err instanceof Error ? err.message.slice(0, 200) : "erreur"}` }));
      worker.once("exit", (code) => finish({ ok: false, reason: `Entraînement interrompu (fil arrêté, code ${code}).` }));
    });
  }
}

/**
 * `services.pricing` du worker : aucun modèle tant que le modèle actif n'est pas rechargé
 * (`pricing.refreshActiveModel` au démarrage), entraîneur dans un fil séparé et chargeur de @selio/pricing.
 */
export function createPricingServices(now: () => Date, options: ThreadedTrainerOptions = {}): PricingServices {
  return { model: null, trainer: new ThreadedPriceTrainer(options), loader: (stored) => loadStoredPriceModel(stored, now) };
}
