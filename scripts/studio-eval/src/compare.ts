import { LABEL_FIELDS, MEASUREMENT_NAMES, type LabelFieldName, type MeasurementName } from "@selio/contracts";
import { simplifyText } from "@selio/domain";

/**
 * Comparaison d'une lecture avec la vérité terrain (fonctions pures, testées à part).
 *
 * - Étiquette : une valeur lue est « juste » si elle égale la vérité une fois simplifiée (sans accents, casse,
 *   ponctuation ni espaces : « Levi's » = « LEVIS », « W32 L32 » = « W32/L32 ») ; « fausse » sinon ; « non lue »
 *   quand le champ est resté vide (question au vendeur). Une vérité vide n'est pas évaluée.
 * - Mesures : « juste » à ± 1 cm (inclus), « fausse » au-delà, « non lue » quand la mesure attendue manque,
 *   « inattendue » quand le modèle lit une mesure dont la vérité n'est pas connue (comptée à part, jamais
 *   comme juste).
 *
 * Une lecture FAUSSE est la seule vraie faute du point de vue de la règle « jamais inventé » : une valeur vide
 * avec une question au vendeur est honnête, une valeur fausse ne l'est pas.
 */

export type Outcome = "correct" | "wrong" | "unread" | "not_evaluated";
export type MeasureOutcome = "correct" | "wrong" | "unread" | "unexpected";

export function normalizeText(s: string): string {
  return simplifyText(s).replace(/\s+/g, "");
}

export function sameText(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return na.length > 0 && na === nb;
}

export type LabelTruth = Record<LabelFieldName, string | null>;
export type ReadFields = Record<LabelFieldName, { value: string | null; confidence: number }>;

export interface FieldComparison {
  field: LabelFieldName;
  expected: string | null;
  read: string | null;
  confidence: number;
  outcome: Outcome;
}

export function compareLabel(truth: LabelTruth, read: ReadFields): FieldComparison[] {
  return LABEL_FIELDS.map((field) => {
    const expected = truth[field];
    const r = read[field];
    let outcome: Outcome;
    if (expected === null || expected.trim().length === 0) outcome = "not_evaluated";
    else if (r.value === null) outcome = "unread";
    else outcome = sameText(expected, r.value) ? "correct" : "wrong";
    return { field, expected, read: r.value, confidence: r.confidence, outcome };
  });
}

export interface MeasureComparison {
  name: MeasurementName;
  expected: number | null;
  read: number | null;
  confidence: number | null;
  outcome: MeasureOutcome;
}

export function compareMeasurements(
  truth: Partial<Record<MeasurementName, number>>,
  read: readonly { name: MeasurementName; valueCm: number; confidence: number }[],
  toleranceCm = 1,
): MeasureComparison[] {
  const byName = new Map<MeasurementName, { valueCm: number; confidence: number }>();
  for (const m of read) if (!byName.has(m.name)) byName.set(m.name, m);
  const out: MeasureComparison[] = [];
  for (const name of MEASUREMENT_NAMES) {
    const expected = truth[name];
    const r = byName.get(name);
    if (expected === undefined) {
      if (r) out.push({ name, expected: null, read: r.valueCm, confidence: r.confidence, outcome: "unexpected" });
      continue;
    }
    if (!r) out.push({ name, expected, read: null, confidence: null, outcome: "unread" });
    else out.push({ name, expected, read: r.valueCm, confidence: r.confidence, outcome: Math.abs(r.valueCm - expected) <= toleranceCm + 1e-9 ? "correct" : "wrong" });
  }
  return out;
}

export interface Tally {
  expected: number;
  correct: number;
  wrong: number;
  unread: number;
  unexpected: number;
}

export const emptyTally = (): Tally => ({ expected: 0, correct: 0, wrong: 0, unread: 0, unexpected: 0 });

export function addOutcome(t: Tally, outcome: Outcome | MeasureOutcome): void {
  if (outcome === "not_evaluated") return;
  if (outcome === "unexpected") {
    t.unexpected += 1;
    return;
  }
  t.expected += 1;
  if (outcome === "correct") t.correct += 1;
  else if (outcome === "wrong") t.wrong += 1;
  else t.unread += 1;
}

export function addTally(into: Tally, from: Tally): void {
  into.expected += from.expected;
  into.correct += from.correct;
  into.wrong += from.wrong;
  into.unread += from.unread;
  into.unexpected += from.unexpected;
}

/** Part de justes parmi les attendues (vides comptées comme non justes), ou null sans attendue. */
export function rate(t: Tally): number | null {
  return t.expected > 0 ? t.correct / t.expected : null;
}

/** Part de justes parmi les valeurs effectivement lues, ou null si rien n'a été lu. */
export function readRate(t: Tally): number | null {
  const readCount = t.correct + t.wrong;
  return readCount > 0 ? t.correct / readCount : null;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}
