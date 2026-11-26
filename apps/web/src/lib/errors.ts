import { DataError } from "./data/types";

export const UNEXPECTED_ERROR_MESSAGE = "Une erreur inattendue est survenue. Réessayez ; si le problème continue, rechargez la page.";

/** Erreur du navigateur ou du code (« Failed to fetch », « Cannot read properties of undefined »…) : jamais montrée telle quelle. */
const TECHNICAL_MESSAGE = /fetch|NetworkError|undefined|null\b|is not (a function|defined|iterable)|Cannot (read|set)|Unexpected (token|end)|JSON|Internal Server Error|^Erreur \d{3}$|stack|\bat \S+:\d+/i;
const TECHNICAL_NAMES = new Set(["TypeError", "ReferenceError", "SyntaxError", "RangeError", "EvalError", "URIError"]);

export function errorMessage(err: unknown): string {
  if (err instanceof DataError) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    const e = err as { message: string; name?: unknown };
    if ((typeof e.name === "string" && TECHNICAL_NAMES.has(e.name)) || TECHNICAL_MESSAGE.test(e.message) || !e.message.trim()) return UNEXPECTED_ERROR_MESSAGE;
    return e.message;
  }
  return UNEXPECTED_ERROR_MESSAGE;
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
