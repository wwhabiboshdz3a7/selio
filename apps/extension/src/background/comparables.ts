import { apiRequest, ExtApiError } from "../shared/api";
import { COMPARABLES_MESSAGES, TRACK_UNAVAILABLE_MESSAGE, comparablesRequest, comparablesResponse, type ComparablesRequest, type ComparablesResponse } from "../shared/comparables";

/**
 * Comparables du panneau, côté service worker (seul détenteur du jeton) : `POST /api/ext/comparables`
 * avec les six champs de l'article, rien d'autre ; réponse revalidée avant d'être rendue au content script.
 */
export async function fetchComparables(baseUrl: string, token: string, request: ComparablesRequest): Promise<ComparablesResponse> {
  // Revalidation (strict) : même si l'appelant se trompe, aucune autre donnée de la page ne part.
  const body = comparablesRequest.parse(request);
  const raw = await apiRequest<unknown>(baseUrl, token, "POST", "/api/ext/comparables", body);
  const parsed = comparablesResponse.safeParse(raw);
  if (!parsed.success) throw new ExtApiError("invalid_response", COMPARABLES_MESSAGES.invalid, 200);
  return parsed.data;
}

/** Erreur de l'appel → code et message normalisés pour le panneau (hors ligne, non relié, Track non compris…). */
export function comparablesFailure(e: unknown): { code: string; message: string } {
  if (!(e instanceof ExtApiError)) return { code: "internal", message: e instanceof Error ? e.message : "Erreur inconnue" };
  if (e.code === "network") return { code: "offline", message: COMPARABLES_MESSAGES.offline };
  if (e.code === "unpaired") return { code: "unpaired", message: COMPARABLES_MESSAGES.unpaired };
  if (e.status === 401) return { code: "unpaired", message: COMPARABLES_MESSAGES.revoked };
  if (e.code === "track_unavailable") return { code: "track_unavailable", message: TRACK_UNAVAILABLE_MESSAGE };
  if (e.status === 429 || e.code === "rate_limited") return { code: "rate_limited", message: COMPARABLES_MESSAGES.rateLimited };
  return { code: e.code, message: e.message };
}

/** « Track non compris » n'est pas une panne de liaison : il ne s'affiche pas comme dernière erreur dans le popup. */
export function isQuietComparablesError(e: ExtApiError): boolean {
  return e.code === "track_unavailable" || e.status === 429;
}
