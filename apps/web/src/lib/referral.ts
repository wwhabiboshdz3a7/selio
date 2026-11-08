import { normalizeReferralCode } from "@selio/contracts";

/**
 * Parrainage à l'inscription : le lien partagé est « /inscription?parrain=CODE ». Le code lu dans l'adresse
 * préremplit le champ (facultatif, jamais bloquant : un code inconnu ou refusé est ignoré par le serveur).
 */
export const REFERRAL_QUERY_PARAM = "parrain";

/** Code lu dans une chaîne de requête (« ?parrain=ab3-k7q »), ramené à sa forme canonique, ou "" s'il n'en est pas un. */
export function referralCodeFromSearch(search: string): string {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(REFERRAL_QUERY_PARAM);
  return normalizeReferralCode(raw ?? "") ?? "";
}

/** Valeur envoyée à l'inscription : le code canonique s'il est bien formé, sinon le texte saisi (le serveur répond par un message). */
export function referralCodeForSignup(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return normalizeReferralCode(trimmed) ?? trimmed.slice(0, 32);
}
