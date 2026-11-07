import { LABEL_FIELDS, type LabelFieldName, type MeasurementName, type NamedMeasurementField, type PhotoRole, type PhotoRoleSource, type StudioAccuracy, type StudioPrepArticle } from "@selio/contracts";
import { studioQuestion } from "@selio/domain";
import type { StudioPrepArticleView, StudioPrepResultView } from "../data/types";

/**
 * Parcours Studio côté écran : une préparation (un ou plusieurs envois) vue comme une liste d'articles,
 * chacun avec ses photos (par identifiant) et leurs rôles. Le tri corrigé par le vendeur (glisser une photo
 * vers un autre article, changer son rôle) est relu par le serveur article par article.
 */

export interface UiArticle {
  prepId: string;
  article: StudioPrepArticleView;
  /** Photos de l'article (identifiants donnés par le navigateur), dans l'ordre d'envoi. */
  photoIds: string[];
  /** Rôle de chaque photo, confiance du tri et provenance du rôle (modèle ou vendeur, posée par le serveur, jamais déduite de la confiance). */
  roles: Record<string, { role: PhotoRole; confidence: number; source: PhotoRoleSource }>;
}

export interface UiPrep {
  articles: UiArticle[];
  warnings: string[];
  simulated: boolean;
  ocr: { configured: boolean; used: boolean };
  accuracy: StudioAccuracy;
}

/** Résultat du serveur → articles de l'écran ; `sentIds` : identifiants des photos dans l'ordre d'envoi. */
export function toUiPrep(result: StudioPrepResultView, sentIds: readonly string[]): UiPrep {
  const byIndex = new Map(result.photos.map((p) => [p.index, p]));
  return {
    articles: result.articles.map((a) => {
      const photoIds = a.photoIndexes.flatMap((i) => (sentIds[i] ? [sentIds[i]!] : []));
      const roles: UiArticle["roles"] = {};
      for (const i of a.photoIndexes) {
        const id = sentIds[i];
        if (id) roles[id] = { role: byIndex.get(i)?.role ?? "other", confidence: byIndex.get(i)?.confidence ?? 0, source: byIndex.get(i)?.roleSource ?? "model" };
      }
      return { prepId: a.prepId, article: a, photoIds, roles };
    }),
    warnings: [...result.warnings],
    simulated: result.simulated,
    ocr: result.ocr,
    accuracy: result.accuracy,
  };
}

/** Plusieurs relectures (une par article corrigé) réunies : articles dans l'ordre, avertissements sans doublon. */
export function mergeUiPreps(preps: readonly UiPrep[]): UiPrep {
  return {
    articles: preps.flatMap((p) => p.articles),
    warnings: [...new Set(preps.flatMap((p) => p.warnings))],
    simulated: preps.some((p) => p.simulated),
    ocr: { configured: preps.some((p) => p.ocr.configured), used: preps.some((p) => p.ocr.used) },
    accuracy: preps[0]?.accuracy ?? { status: "to_measure", brandAndSizeRate: null, measurementRate: null, reportDate: null },
  };
}

/** Tri tel que le vendeur le voit et le corrige : pour chaque photo, son article (1, 2…) et son rôle. */
export type SortAssignment = Record<string, { group: number; role: PhotoRole }>;

export function assignmentFrom(prep: UiPrep): SortAssignment {
  const out: SortAssignment = {};
  prep.articles.forEach((a, i) => {
    for (const id of a.photoIds) out[id] = { group: i + 1, role: a.roles[id]?.role ?? "other" };
  });
  return out;
}

/** Le vendeur a-t-il changé un rôle ou déplacé une photo d'un article à un autre ? */
export function assignmentChanged(prep: UiPrep, assignment: SortAssignment): boolean {
  const before = assignmentFrom(prep);
  const ids = new Set([...Object.keys(before), ...Object.keys(assignment)]);
  for (const id of ids) {
    const a = before[id];
    const b = assignment[id];
    if (!a || !b || a.group !== b.group || a.role !== b.role) return true;
  }
  return false;
}

/** Articles du tri corrigé, renumérotés 1, 2… dans l'ordre de leur première photo ; un article vide disparaît. */
export function groupsFrom(assignment: SortAssignment, order: readonly string[]): { group: number; photoIds: string[] }[] {
  const groups = new Map<number, string[]>();
  for (const id of order) {
    const a = assignment[id];
    if (!a) continue;
    groups.set(a.group, [...(groups.get(a.group) ?? []), id]);
  }
  return [...groups.values()].map((photoIds, i) => ({ group: i + 1, photoIds }));
}

/** Prochain numéro d'article libre (« Nouvel article »). */
export function nextGroup(assignment: SortAssignment): number {
  return Math.max(0, ...Object.values(assignment).map((a) => a.group)) + 1;
}

/** Ordre des photos de l'annonce : face d'abord (couverture), puis dos, détails, défauts, étiquette, mètre, autres. */
const ITEM_PHOTO_ORDER: readonly PhotoRole[] = ["front", "back", "detail", "defect", "label", "tape", "other"];
export function coverFirst(photoIds: readonly string[], roles: UiArticle["roles"]): string[] {
  return [...photoIds].sort((a, b) => ITEM_PHOTO_ORDER.indexOf(roles[a]?.role ?? "other") - ITEM_PHOTO_ORDER.indexOf(roles[b]?.role ?? "other") || photoIds.indexOf(a) - photoIds.indexOf(b));
}

/**
 * Question au vendeur pour un champ de l'étiquette : celle portée par le champ, sinon celle de la liste ; un
 * champ vide sans question (ou vidé à l'écran par le vendeur, `cleared`) reçoit la question standard. Jamais de valeur proposée.
 */
export function fieldQuestion(article: Pick<StudioPrepArticle, "fields" | "questions">, key: LabelFieldName, opts: { cleared?: boolean } = {}): string | null {
  const own = article.fields[key].question ?? article.questions.find((q) => q.field === key)?.text ?? null;
  if (own) return own;
  return article.fields[key].value === null || opts.cleared ? studioQuestion(key, "missing").text : null;
}

/**
 * Question pour une mesure : celle portée par la mesure, sinon celle de la liste ; une mesure vide sans
 * question (famille changée à l'écran, mesure ajoutée) reçoit la question standard. Jamais de valeur proposée.
 */
export function measurementQuestion(article: Pick<StudioPrepArticle, "questions" | "tapeVisible">, m: NamedMeasurementField): string | null {
  if (m.question) return m.question;
  const listed = article.questions.find((q) => q.field === m.name)?.text;
  if (listed) return listed;
  return m.valueCm === null ? studioQuestion(m.name, article.tapeVisible ? "missing" : "no_tape").text : null;
}

/** Champs encore vides après la préparation (pour le résumé « n questions »). */
export function openQuestionsCount(article: Pick<StudioPrepArticle, "questions">): number {
  return article.questions.length;
}

export const LABEL_FIELD_ORDER: readonly LabelFieldName[] = LABEL_FIELDS;
export type { MeasurementName };
