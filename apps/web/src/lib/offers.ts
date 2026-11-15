import { discountedPriceCents, normalizeOfferCode, offerCoversPlan, type BillingCycle, type PaidPlan, type PublicOffer } from "@selio/contracts";
import { ApiClient } from "./api/client";
import type { DataClient, Mode } from "./data/types";
import { apiBaseUrl } from "./env";

/**
 * Offres commerciales côté navigateur : bandeau (vitrine et application), fermeture mémorisée par offre,
 * prix remisés des pages de prix, code promo lu dans l'adresse (« /inscription?code=PRINTEMPS »).
 */

export const PROMO_QUERY_PARAM = "code";
export const DISMISSED_OFFERS_KEY = "selio.offers.dismissed";

/** Code promo lu dans une chaîne de requête (« ?code=printemps »), en forme canonique, ou "" s'il n'en est pas un. */
export function promoCodeFromSearch(search: string): string {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(PROMO_QUERY_PARAM);
  return normalizeOfferCode(raw ?? "") ?? "";
}

/** Valeur envoyée à l'inscription : le code canonique s'il est bien formé, sinon le texte saisi (le serveur répond par un message). */
export function promoCodeForSignup(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return normalizeOfferCode(trimmed) ?? trimmed.slice(0, 40);
}

/** Offres refermées par la personne (identifiants), lues sans jamais lever (stockage bloqué, navigation privée). */
export function readDismissedOffers(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(DISMISSED_OFFERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

export function dismissOffer(id: string): string[] {
  const next = [...new Set([...readDismissedOffers(), id])].slice(-50);
  try {
    globalThis.localStorage?.setItem(DISMISSED_OFFERS_KEY, JSON.stringify(next));
  } catch {
    // stockage indisponible : le bandeau reste fermé jusqu'au rechargement
  }
  return next;
}

/** Première offre publique qui concerne ce forfait (pour afficher le prix remisé), ou null. */
export function offerForPlan(offers: readonly PublicOffer[] | undefined, plan: PaidPlan): PublicOffer | null {
  return offers?.find((o) => offerCoversPlan(o.plans, plan)) ?? null;
}

/** Prix d'une échéance après la remise d'une offre publique (null : aucune offre ne concerne le forfait). */
export function discountedFor(offers: readonly PublicOffer[] | undefined, plan: PaidPlan, priceCents: number): { offer: PublicOffer; cents: number } | null {
  const offer = offerForPlan(offers, plan);
  if (!offer) return null;
  const cents = discountedPriceCents(priceCents, offer);
  return cents < priceCents ? { offer, cents } : null;
}

/** « avec le code PRINTEMPS », « pendant 3 mois avec le code PRINTEMPS », « offre Printemps ». */
export function offerConditionLabel(offer: PublicOffer, cycle: BillingCycle = "monthly"): string {
  const parts: string[] = [];
  if (offer.durationMonths !== null) parts.push(cycle === "yearly" ? "sur la première année" : `pendant ${offer.durationMonths} mois`);
  parts.push(offer.code ? `avec le code ${offer.code}` : `offre ${offer.name}`);
  return parts.join(" ");
}

let publicApi: ApiClient | null = null;

/**
 * Offres du bandeau. Application (session) : celles du client courant. Vitrine : les visiteurs sont en
 * démonstration par défaut ; si la démonstration n'a aucune offre (cas normal), les offres réelles sont lues
 * sur l'API publique quand une adresse d'API est configurée (VITE_API_BASE_URL : site déployé). Ne lève
 * jamais : sans réponse, aucun bandeau.
 */
export async function loadOfferBanner(client: DataClient, mode: Mode, scope: "app" | "vitrine"): Promise<PublicOffer[]> {
  try {
    const own = await client.getOfferBanner();
    if (own.length > 0 || mode === "connected" || scope === "app" || apiBaseUrl === "") return own;
  } catch {
    if (mode === "connected" || scope === "app" || apiBaseUrl === "") return [];
  }
  try {
    publicApi ??= new ApiClient(apiBaseUrl);
    return await publicApi.getOfferBanner();
  } catch {
    return [];
  }
}
