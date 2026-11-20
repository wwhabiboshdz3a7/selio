import { DataError } from "./data/types";

export function errorMessage(err: unknown): string {
  if (err instanceof DataError) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") return (err as { message: string }).message;
  return "Une erreur inattendue est survenue.";
}

export function errorCode(err: unknown): string | null {
  return err instanceof DataError ? err.code : null;
}

/** Problème de validation (forme minimale d'une « issue » zod), pour un message clair en français sous le champ. */
export interface ValidationIssue {
  code: string;
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  type?: string;
  validation?: unknown;
}

/** Message d'un champ invalide, en français (les messages par défaut de zod sont en anglais). */
export function fieldErrorMessage(issue: ValidationIssue): string {
  if (issue.code === "custom") return issue.message;
  if (issue.code === "too_small") {
    if (issue.type === "string") return Number(issue.minimum) <= 1 ? "Champ obligatoire." : `Au moins ${issue.minimum} caractères.`;
    return `Valeur trop petite (minimum ${issue.minimum}).`;
  }
  if (issue.code === "too_big") {
    if (issue.type === "string") return `${issue.maximum} caractères maximum.`;
    if (issue.type === "array") return `${issue.maximum} éléments maximum.`;
    return `Valeur trop grande (maximum ${issue.maximum}).`;
  }
  if (issue.code === "invalid_string" && issue.validation === "url") return "Adresse web invalide : elle doit commencer par https://";
  if (issue.code === "invalid_type") return "Champ obligatoire.";
  return "Valeur invalide.";
}
