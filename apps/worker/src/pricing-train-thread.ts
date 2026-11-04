import { parentPort, workerData } from "node:worker_threads";
import type { PriceTrainingRow } from "@selio/core";
import { trainOutcome } from "./pricing-train";

/**
 * Fil d'exécution de l'entraînement du modèle de prix (worker_threads) : le calcul (plusieurs secondes à
 * plusieurs dizaines de secondes) ne bloque plus la boucle d'événements du worker (Radar, Cloud, Track,
 * fenêtres de connexion). Reçoit les lignes d'entraînement (sans donnée personnelle) par copie, rend le
 * résultat et le résumé du rapport, puis se termine. Le processus principal l'arrête au-delà de
 * PRICING_TRAIN_MAX_MS.
 */
interface TrainJob {
  rows: PriceTrainingRow[];
  now: string;
  synthetic: boolean;
  seed?: number;
}

const job = workerData as TrainJob;
try {
  const result = trainOutcome(job.rows, { now: new Date(job.now), synthetic: job.synthetic, ...(job.seed !== undefined ? { seed: job.seed } : {}) });
  parentPort?.postMessage({ type: "done", ...result });
} catch (err) {
  parentPort?.postMessage({ type: "error", message: err instanceof Error ? err.message.slice(0, 200) : "erreur" });
}
