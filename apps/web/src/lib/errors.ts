import { DataError } from "./data/types";

export function errorMessage(err: unknown): string {
  if (err instanceof DataError) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") return (err as { message: string }).message;
  return "Une erreur inattendue est survenue.";
}

export function errorCode(err: unknown): string | null {
  return err instanceof DataError ? err.code : null;
}
