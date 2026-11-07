import {
  FIELD_SOURCE_LABELS, LABEL_FIELDS, LABEL_FIELD_LABELS, MEASUREMENT_LABELS, MEASUREMENT_NAMES, STUDIO_TRUSTED_CONFIDENCE,
  type GarmentKind, type LabelFieldName, type MeasurementName, type MeasurementSource, type NamedMeasurementField, type StudioFields, type TextFieldSource,
} from "@selio/contracts";
import { EXPECTED_MEASUREMENTS } from "@selio/domain";
import type { StudioPrepAnswersInput, WornPhotoStatusView, WornPhotoView, WornPose } from "../data/types";

/**
 * Studio façon Kavis (§5.11), côté écran : provenance des champs, réponses du vendeur, mesures saisies,
 * fenêtre de nuit et quota des photos portées. Fonctions pures, partagées par les pages et la démonstration.
 * Règle : aucune valeur par défaut. Un champ sans provenance reste vide et pose sa question.
 */

// ---------------------------------------------------------------- provenance

export type FieldSource = MeasurementSource | TextFieldSource;

/** Libellé court affiché à côté d'une valeur (« Lue sur l'étiquette », « Mètre ruban »…). */
export const PROVENANCE_SHORT: Record<FieldSource, string> = {
  label: "Étiquette",
  tape_photo: "Mètre ruban",
  reference_db: "Base des références",
  seller: "Vous",
};

/** « Lue sur l'étiquette · confiance 92 % » ; « À renseigner » sans provenance. */
export function provenanceText(source: FieldSource | null, confidence?: number): string {
  if (source === null) return "À renseigner";
  const base = FIELD_SOURCE_LABELS[source];
  return confidence !== undefined && (source === "label" || source === "tape_photo") ? `${base} · confiance ${Math.round(confidence * 100)} %` : base;
}

/** Lecture à confirmer : lue avec une confiance entre 0,5 et 0,7. */
export function needsConfirmation(source: FieldSource | null, confidence?: number): boolean {
  return (source === "label" || source === "tape_photo") && confidence !== undefined && confidence < STUDIO_TRUSTED_CONFIDENCE;
}

// ---------------------------------------------------------------- saisie des mesures

/**
 * Mesure saisie par le vendeur (cm, virgule ou point) : null si le champ est vide, « invalid » si ce n'est
 * pas une longueur plausible (0 < v ≤ 300). Arrondie au demi-centimètre, comme le serveur.
 */
export function parseCm(raw: string): number | null | "invalid" {
  const s = raw.trim().replace(/\s/g, "").replace(/cm$/i, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return "invalid";
  const v = Number(s);
  if (!(v > 0) || v > 300) return "invalid";
  return Math.round(v * 2) / 2;
}

/** 41.5 → « 41,5 » (champ de saisie), "" pour une mesure vide : jamais de valeur par défaut. */
export function cmInputValue(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v).replace(".", ",");
}

/** Mesures à afficher : celles de la préparation, plus celles attendues pour la famille de la pièce (vides). */
export function measurementRows(measurements: readonly NamedMeasurementField[], kind: GarmentKind, extra: readonly MeasurementName[] = []): NamedMeasurementField[] {
  const byName = new Map(measurements.map((m) => [m.name, m]));
  const names = new Set<MeasurementName>([...measurements.map((m) => m.name), ...EXPECTED_MEASUREMENTS[kind], ...extra]);
  return MEASUREMENT_NAMES.filter((n) => names.has(n)).map((n) => byName.get(n) ?? { name: n, valueCm: null, source: null });
}

/** Mesures attendues pour la famille de la pièce (haut : poitrine, longueur, épaules…). */
export function expectedFor(kind: GarmentKind): readonly MeasurementName[] {
  return EXPECTED_MEASUREMENTS[kind];
}

// ---------------------------------------------------------------- réponses du vendeur

/** Ce que le vendeur a tapé dans l'écran (texte brut), par champ ; absent = pas touché. */
export interface PrepEdits {
  fields: Partial<Record<LabelFieldName, string>>;
  measurements: Partial<Record<MeasurementName, string>>;
  garmentKind?: GarmentKind;
  shareMeasurements?: boolean;
  /**
   * Lectures peu sûres (0,5 à 0,7) ou en désaccord avec une autre source que le vendeur a confirmées telles
   * quelles : la valeur est renvoyée au serveur et devient « vous ». Sans confirmation ni correction, le serveur
   * refuse la validation (409) : le silence ne vaut jamais confirmation.
   */
  confirmed?: Partial<Record<LabelFieldName | MeasurementName, boolean>>;
}

export const emptyEdits = (): PrepEdits => ({ fields: {}, measurements: {} });

export type AnswersResult = { ok: true; answers: StudioPrepAnswersInput } | { ok: false; errors: Partial<Record<MeasurementName, string>> };

/** Une valeur lue à confirmer : peu sûre (0,5 à 0,7) ou en désaccord avec une autre source (question portée par le champ). */
export function needsExplicitConfirmation(field: { value?: string | null; valueCm?: number | null; source: FieldSource | null; confidence?: number; question?: string }): boolean {
  // Un champ de l'étiquette porte `value`, une mesure `valueCm` : une valeur vide (question « à renseigner ») n'a rien à confirmer.
  const value = field.value !== undefined ? field.value : field.valueCm ?? null;
  return value !== null && (needsConfirmation(field.source, field.confidence) || Boolean(field.question));
}

export interface PendingConfirmation {
  field: LabelFieldName | MeasurementName;
  label: string;
  step: "label" | "measures";
  /** Valeur lue, telle qu'elle serait confirmée. */
  value: string;
}

/**
 * Champs et mesures encore à confirmer avant de générer : lus avec peu de certitude ou en désaccord avec une
 * autre source, ni corrigés ni confirmés à l'écran. Tant que la liste n'est pas vide, « Générer l'annonce »
 * reste fermé (et le serveur refuserait la validation).
 */
export function pendingConfirmations(current: { fields: StudioFields; measurements: readonly NamedMeasurementField[] }, edits: PrepEdits): PendingConfirmation[] {
  const out: PendingConfirmation[] = [];
  for (const key of LABEL_FIELDS) {
    const f = current.fields[key];
    if (!needsExplicitConfirmation(f) || edits.confirmed?.[key]) continue;
    const typed = edits.fields[key];
    if (typed !== undefined && typed.trim() !== f.value) continue;
    out.push({ field: key, label: LABEL_FIELD_LABELS[key], step: "label", value: f.value! });
  }
  for (const m of current.measurements) {
    if (!needsExplicitConfirmation(m) || edits.confirmed?.[m.name]) continue;
    const typed = edits.measurements[m.name];
    if (typed !== undefined && parseCm(typed) !== m.valueCm) continue;
    out.push({ field: m.name, label: MEASUREMENT_LABELS[m.name], step: "measures", value: cmInputValue(m.valueCm) });
  }
  return out;
}

/**
 * Réponses envoyées au serveur : seulement les champs modifiés ou confirmés. Une valeur lue laissée telle quelle
 * garde sa provenance (étiquette, ruban, base) ; une valeur changée ou confirmée devient « vous » ; un champ vidé
 * devient vide (« je ne sais pas »). Une mesure illisible bloque l'envoi (jamais de valeur devinée à la place).
 */
export function buildPrepAnswers(current: { fields: StudioFields; measurements: readonly NamedMeasurementField[] }, edits: PrepEdits): AnswersResult {
  const answers: StudioPrepAnswersInput = { fields: {}, measurements: {} };
  for (const key of LABEL_FIELDS) {
    const typed = edits.fields[key];
    if (typed === undefined) {
      if (edits.confirmed?.[key] && current.fields[key].value !== null) answers.fields![key] = current.fields[key].value;
      continue;
    }
    const value = typed.trim().slice(0, key === "size" ? 40 : 80);
    const before = current.fields[key].value ?? "";
    if (value === before) {
      if (edits.confirmed?.[key] && value !== "") answers.fields![key] = value;
      continue;
    }
    answers.fields![key] = value === "" ? null : value;
  }
  const errors: Partial<Record<MeasurementName, string>> = {};
  const byName = new Map(current.measurements.map((m) => [m.name, m]));
  for (const name of MEASUREMENT_NAMES) {
    const typed = edits.measurements[name];
    const before = byName.get(name)?.valueCm ?? null;
    if (typed === undefined) {
      if (edits.confirmed?.[name] && before !== null) answers.measurements![name] = before;
      continue;
    }
    const parsed = parseCm(typed);
    if (parsed === "invalid") {
      errors[name] = "Indiquez une longueur en cm (par exemple 52 ou 41,5).";
      continue;
    }
    if (parsed === before) {
      if (edits.confirmed?.[name] && before !== null) answers.measurements![name] = before;
      continue;
    }
    answers.measurements![name] = parsed;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (edits.garmentKind) answers.garmentKind = edits.garmentKind;
  if (edits.shareMeasurements !== undefined) answers.shareMeasurements = edits.shareMeasurements;
  return { ok: true, answers };
}

// ---------------------------------------------------------------- photos portées

export const WORN_POSE_LABELS: Record<WornPose, string> = { front: "De face", three_quarter: "De trois quarts", back: "De dos" };
export const WORN_STATUS_LABELS: Record<WornPhotoView["status"], string> = {
  queued: "En file pour la nuit",
  running: "En cours",
  done: "Terminée",
  failed: "Échec (quota rendu)",
  refused: "Refusée (quota rendu)",
};

/** Ce que l'écran permet pour une nouvelle demande, selon le quota du mois et le réglage du dépassement. */
export interface WornRequestState {
  /** Une demande est possible (dans le quota, ou au-delà avec accord). */
  canRequest: boolean;
  /** Quota du mois atteint. */
  atQuota: boolean;
  /** La case d'accord du dépassement est utilisable (réglage serveur activé et abonnement facturable). */
  consentEnabled: boolean;
  /** Pourquoi la case est désactivée ou la demande impossible. */
  reason: string | null;
}

export function wornRequestState(status: WornPhotoStatusView, consent: boolean): WornRequestState {
  const { counter, overage } = status;
  if (counter.quota <= 0) return { canRequest: false, atQuota: true, consentEnabled: false, reason: "Les photos portées ne sont pas incluses dans votre offre (Pro : 10 par mois, Agence : 30)." };
  const atQuota = counter.used >= counter.quota;
  if (!atQuota) return { canRequest: true, atQuota: false, consentEnabled: false, reason: null };
  if (!overage.enabled) return { canRequest: false, atQuota: true, consentEnabled: false, reason: "Quota du mois atteint. Le dépassement est désactivé sur ce serveur (réglage WORN_OVERAGE_ENABLED) : attendez la remise à zéro ou changez d'offre." };
  if (!overage.billable) return { canRequest: false, atQuota: true, consentEnabled: false, reason: "Quota du mois atteint. Le dépassement est facturé au prochain renouvellement : il faut un abonnement en cours, non résilié, avec une carte enregistrée." };
  return { canRequest: consent, atQuota: true, consentEnabled: true, reason: consent ? null : "Quota du mois atteint : cochez l'accord pour demander une photo de plus." };
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

function tzOffsetMs(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 60_000) * 60_000;
}

function zonedHour(base: ZonedParts, addDays: number, hour: number, timezone: string): Date {
  const guess = Date.UTC(base.year, base.month - 1, base.day + addDays, hour, 0);
  const first = guess - tzOffsetMs(new Date(guess), timezone);
  return new Date(guess - tzOffsetMs(new Date(first), timezone));
}

function hourInWindow(hour: number, w: { startHour: number; endHour: number }): boolean {
  return w.startHour < w.endHour ? hour >= w.startHour && hour < w.endHour : hour >= w.startHour || hour < w.endHour;
}

/** Fenêtre de nuit par défaut (WORN_NIGHT_WINDOW, WORN_NIGHT_TIMEZONE) : 22 h – 6 h, heure de Paris. */
export const WORN_NIGHT_DEFAULT = { startHour: 22, endHour: 6, timezone: "Europe/Paris" } as const;

/**
 * Prochaine fenêtre de nuit (miroir de `nextNightWindow`, packages/core/src/services/worn-photos.ts) : si
 * `now` y est déjà, elle commence maintenant ; sinon au prochain `startHour` local. Changements d'heure gérés.
 */
export function nextNightWindow(now: Date, timezone: string = WORN_NIGHT_DEFAULT.timezone, hours: { startHour: number; endHour: number } = WORN_NIGHT_DEFAULT): { start: Date; end: Date; inWindow: boolean } {
  const p = zonedParts(now, timezone);
  const overnight = hours.startHour > hours.endHour;
  if (hourInWindow(p.hour, hours)) {
    const endDay = overnight && p.hour >= hours.startHour ? 1 : 0;
    return { start: new Date(now), end: zonedHour(p, endDay, hours.endHour, timezone), inWindow: true };
  }
  const startDay = p.hour < hours.startHour ? 0 : 1;
  return { start: zonedHour(p, startDay, hours.startHour, timezone), end: zonedHour(p, startDay + (overnight ? 1 : 0), hours.endHour, timezone), inWindow: false };
}

export function inNightWindow(now: Date, w: { startHour: number; endHour: number; timezone: string } = WORN_NIGHT_DEFAULT): boolean {
  return hourInWindow(zonedParts(now, w.timezone).hour, w);
}

const hourLabel = (h: number) => `${h} h`;

/** « entre 22 h et 6 h (heure de Paris) ». */
export function nightWindowLabel(w: { startHour: number; endHour: number; timezone: string }): string {
  const zone = w.timezone === "Europe/Paris" ? "heure de Paris" : w.timezone;
  return `entre ${hourLabel(w.startHour)} et ${hourLabel(w.endHour)} (${zone})`;
}

/** « ce soir à 22:00 », « cette nuit », « demain à 22:00 » ou « le 6 nov. à 22:00 », dans le fuseau de la fenêtre. */
export function scheduledLabel(iso: string, now: Date, timezone: string = WORN_NIGHT_DEFAULT.timezone): string {
  const at = new Date(iso);
  if (at.getTime() <= now.getTime()) return "dès que possible cette nuit";
  const day = (d: Date) => new Intl.DateTimeFormat("fr-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(at);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (day(at) === day(now)) return `ce soir à ${time}`;
  if (day(at) === day(tomorrow)) return `demain à ${time}`;
  return `le ${new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, day: "numeric", month: "short" }).format(at)} à ${time}`;
}

/** 25 → « 0,25 € ». */
export function euros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}
