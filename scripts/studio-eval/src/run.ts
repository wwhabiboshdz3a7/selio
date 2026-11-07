import { LABEL_FIELDS, MEASUREMENT_NAMES, STUDIO_ACCURACY_TARGETS, type GarmentKind, type LabelFieldName, type MeasurementName } from "@selio/contracts";
import { addOutcome, compareLabel, compareMeasurements, emptyTally, type FieldComparison, type MeasureComparison, type Tally } from "./compare";
import type { Dataset, DatasetProblem } from "./dataset";
import { loadModelImage } from "./images";
import { toReaderError, type ReaderInfo, type StudioReader } from "./readers";

/**
 * Déroulé du protocole : chaque photo d'étiquette est lue une fois (`readLabel`), chaque article avec mètre
 * ruban une fois (`readMeasurements`, 1 à 3 photos), puis la lecture est comparée à la vérité terrain. Les
 * lectures se font une à une (une seule carte graphique) ; une erreur « fatale » du lecteur (serveur
 * injoignable, configuration) ou une suite d'erreurs arrête le protocole, ce que le rapport dit.
 */

export interface LabelCaseResult {
  id: string;
  photo: string;
  comparisons: FieldComparison[];
  latencyMs: number;
  ocr: { attempted: boolean; used: boolean };
  questions: number;
  warnings: string[];
}

export interface TapeCaseResult {
  id: string;
  article: string;
  photos: string[];
  garmentKind: GarmentKind;
  tapeVisible: boolean;
  comparisons: MeasureComparison[];
  latencyMs: number;
  questions: number;
  warnings: string[];
}

export interface SkippedCase {
  id: string;
  photo: string;
  reason: string;
}

export interface CaseError {
  id: string;
  photo: string;
  code: string;
  message: string;
}

export interface SectionStats<T> {
  total: number;
  cases: T[];
  skipped: SkippedCase[];
  errors: CaseError[];
  latencyMs: number[];
}

export interface EvalResult {
  generatedAt: string;
  datasetRoot: string;
  reader: ReaderInfo;
  ocrFallback: boolean;
  /** Vrai dès qu'une lecture vient du simulateur : le rapport ne mesure rien. */
  simulated: boolean;
  targets: typeof STUDIO_ACCURACY_TARGETS;
  labels: SectionStats<LabelCaseResult> & { tally: Record<LabelFieldName, Tally>; brandAndSize: Tally; ocr: { attempted: number; used: number } };
  measures: SectionStats<TapeCaseResult> & { tally: Tally; byName: Record<MeasurementName, Tally>; noTape: number };
  datasetProblems: DatasetProblem[];
  /** Raison d'un arrêt avant la fin (null si tout a été parcouru). */
  stopped: string | null;
  durationMs: number;
}

export interface RunOptions {
  dataset: Dataset;
  reader: StudioReader;
  /** OCR d'essai en second recours (lecture directe seulement ; l'API suit sa propre configuration). */
  ocr: boolean;
  now?: () => Date;
  log?: (line: string) => void;
  /** Erreurs consécutives (non fatales) avant d'arrêter : le serveur est sans doute en panne. */
  maxConsecutiveErrors?: number;
}

const OUTCOME_TEXT = { correct: "juste", wrong: "FAUSSE", unread: "non lue", not_evaluated: "—", unexpected: "inattendue" } as const;
const FIELD_SHORT: Record<LabelFieldName, string> = { brand: "marque", size: "taille", material: "matière", reference: "référence" };

const ms = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ms`;

export async function runEval(opts: RunOptions): Promise<EvalResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => undefined);
  const maxConsecutive = opts.maxConsecutiveErrors ?? 5;
  const startedAt = now();
  const started = Date.now();
  const reader = await opts.reader.info();

  const labels: EvalResult["labels"] = {
    total: opts.dataset.labels.length,
    cases: [],
    skipped: [],
    errors: [],
    latencyMs: [],
    tally: Object.fromEntries(LABEL_FIELDS.map((f) => [f, emptyTally()])) as Record<LabelFieldName, Tally>,
    brandAndSize: emptyTally(),
    ocr: { attempted: 0, used: 0 },
  };
  const measures: EvalResult["measures"] = {
    total: opts.dataset.tapes.length,
    cases: [],
    skipped: [],
    errors: [],
    latencyMs: [],
    tally: emptyTally(),
    byName: Object.fromEntries(MEASUREMENT_NAMES.map((n) => [n, emptyTally()])) as Record<MeasurementName, Tally>,
    noTape: 0,
  };
  let simulated = reader.simulated;
  let stopped: string | null = null;
  let consecutive = 0;

  const failure = (err: unknown, section: "étiquettes" | "mesures", id: string, photo: string, errors: CaseError[]): boolean => {
    const e = toReaderError(err);
    errors.push({ id, photo, code: e.code, message: e.message });
    log(`[${section}] ${photo} : erreur ${e.code} — ${e.message}`);
    if (e.fatal) {
      stopped = `Arrêt sur une erreur du lecteur (${e.code}) : ${e.message}`;
      return true;
    }
    consecutive += 1;
    if (consecutive >= maxConsecutive) {
      stopped = `Arrêt après ${consecutive} erreurs consécutives (dernière : ${e.code}).`;
      return true;
    }
    return false;
  };

  for (let i = 0; i < opts.dataset.labels.length && !stopped; i++) {
    const c = opts.dataset.labels[i]!;
    const prefix = `[étiquettes ${i + 1}/${opts.dataset.labels.length}] ${c.photo}`;
    const load = await loadModelImage(c.file);
    if (!load.ok) {
      labels.skipped.push({ id: c.id, photo: c.photo, reason: `${load.code} : ${load.reason}` });
      log(`${prefix} : écartée (${load.reason})`);
      continue;
    }
    try {
      const r = await opts.reader.readLabel(load.image, { ocr: opts.ocr });
      consecutive = 0;
      simulated ||= r.simulated;
      const comparisons = compareLabel(c.truth, r.fields);
      for (const cmp of comparisons) {
        addOutcome(labels.tally[cmp.field], cmp.outcome);
        if (cmp.field === "brand" || cmp.field === "size") addOutcome(labels.brandAndSize, cmp.outcome);
      }
      if (r.ocr.attempted) labels.ocr.attempted += 1;
      if (r.ocr.used) labels.ocr.used += 1;
      labels.latencyMs.push(r.latencyMs);
      labels.cases.push({ id: c.id, photo: c.photo, comparisons, latencyMs: r.latencyMs, ocr: r.ocr, questions: r.questions, warnings: r.warnings });
      log(`${prefix} · ${comparisons.filter((x) => x.outcome !== "not_evaluated").map((x) => `${FIELD_SHORT[x.field]} : ${OUTCOME_TEXT[x.outcome]}`).join(" · ")} · ${ms(r.latencyMs)}`);
    } catch (err) {
      if (failure(err, "étiquettes", c.id, c.photo, labels.errors)) break;
    }
  }

  for (let i = 0; i < opts.dataset.tapes.length && !stopped; i++) {
    const c = opts.dataset.tapes[i]!;
    const photoList = c.photos.join(" | ");
    const prefix = `[mesures ${i + 1}/${opts.dataset.tapes.length}] ${c.article}`;
    const images = [];
    let skipReason: string | null = null;
    for (let p = 0; p < c.files.length; p++) {
      const load = await loadModelImage(c.files[p]!);
      if (!load.ok) {
        skipReason = `${c.photos[p]} : ${load.code} : ${load.reason}`;
        break;
      }
      images.push(load.image);
    }
    if (skipReason) {
      measures.skipped.push({ id: c.id, photo: photoList, reason: skipReason });
      log(`${prefix} : écarté (${skipReason})`);
      continue;
    }
    try {
      const r = await opts.reader.readMeasurements(images, c.garmentKind);
      consecutive = 0;
      simulated ||= r.simulated;
      if (!r.tapeVisible) measures.noTape += 1;
      const comparisons = compareMeasurements(c.truth, r.measurements, STUDIO_ACCURACY_TARGETS.measurementToleranceCm);
      for (const cmp of comparisons) {
        addOutcome(measures.tally, cmp.outcome);
        addOutcome(measures.byName[cmp.name], cmp.outcome);
      }
      measures.latencyMs.push(r.latencyMs);
      measures.cases.push({ id: c.id, article: c.article, photos: c.photos, garmentKind: c.garmentKind, tapeVisible: r.tapeVisible, comparisons, latencyMs: r.latencyMs, questions: r.questions, warnings: r.warnings });
      const summary = r.tapeVisible ? comparisons.map((x) => `${x.name} : ${OUTCOME_TEXT[x.outcome]}`).join(" · ") : "aucun mètre ruban vu";
      log(`${prefix} · ${summary} · ${ms(r.latencyMs)}`);
    } catch (err) {
      if (failure(err, "mesures", c.id, photoList, measures.errors)) break;
    }
  }

  return {
    generatedAt: startedAt.toISOString(),
    datasetRoot: opts.dataset.root,
    reader,
    ocrFallback: opts.ocr,
    simulated,
    targets: STUDIO_ACCURACY_TARGETS,
    labels,
    measures,
    datasetProblems: opts.dataset.problems,
    stopped,
    durationMs: Date.now() - started,
  };
}
