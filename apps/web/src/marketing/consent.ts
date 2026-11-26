/**
 * Consentement aux cookies de la vitrine (RGPD, recommandations de la CNIL).
 *
 * Rien n'est actif par défaut : la mesure d'audience (Google Analytics 4) et la publicité
 * (Google Ads, pixel Meta) ne se chargent qu'avec DEUX conditions réunies :
 *  1. un identifiant public fourni au build par une variable Vite (vide par défaut) ;
 *  2. l'accord explicite du visiteur pour la catégorie concernée.
 * Sans identifiant, aucun bandeau n'est affiché (il n'y a rien à accepter) et aucun appel
 * réseau n'est fait. Refuser est aussi simple qu'accepter ; le choix est gardé six mois
 * dans le navigateur, puis redemandé.
 */

/** Catégories soumises au consentement : la mesure d'audience et la publicité. */
export type ConsentCategory = "mesure" | "publicite";

export interface ConsentChoice {
  /** Version du format enregistré. */
  v: 1;
  /** Date du choix (ISO). */
  date: string;
  mesure: boolean;
  publicite: boolean;
}

export const CONSENT_STORAGE_KEY = "selio.consentement";
/** Durée de validité d'un choix : six mois, puis le bandeau revient. */
export const CONSENT_MAX_AGE_DAYS = 182;

/** Identifiants publics des outils de mesure et de publicité (jamais un secret). */
export interface TrackingConfig {
  /** Google Analytics 4 : « G-XXXXXXX ». */
  ga4Id: string | null;
  /** Google Ads : « AW-123456789 ». */
  adsId: string | null;
  /** Étiquette de conversion Google Ads de l'inscription réussie. */
  adsSignupLabel: string | null;
  /** Étiquette de conversion Google Ads du clic sur l'essai. */
  adsTrialLabel: string | null;
  /** Pixel Meta : identifiant numérique. */
  metaPixelId: string | null;
}

const PATTERNS = {
  ga4: /^G-[A-Z0-9]{4,20}$/,
  ads: /^AW-\d{6,15}$/,
  label: /^[A-Za-z0-9_-]{4,40}$/,
  meta: /^\d{6,20}$/,
} as const;

/** Une valeur au bon format, sinon rien (une valeur mal formée ne charge aucun script). */
function pick(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return pattern.test(v) ? v : null;
}

/** Lit la configuration depuis les variables Vite (import.meta.env), vides par défaut. */
export function trackingConfig(env: Record<string, unknown>): TrackingConfig {
  return {
    ga4Id: pick(env.VITE_GA4_ID, PATTERNS.ga4),
    adsId: pick(env.VITE_GOOGLE_ADS_ID, PATTERNS.ads),
    adsSignupLabel: pick(env.VITE_GOOGLE_ADS_SIGNUP_LABEL, PATTERNS.label),
    adsTrialLabel: pick(env.VITE_GOOGLE_ADS_TRIAL_LABEL, PATTERNS.label),
    metaPixelId: pick(env.VITE_META_PIXEL_ID, PATTERNS.meta),
  };
}

/** Configuration du site, figée au build. */
export const TRACKING: TrackingConfig = trackingConfig((import.meta.env ?? {}) as Record<string, unknown>);

/** Les catégories réellement utilisées par la configuration (vide : aucun bandeau). */
export function categoriesInUse(cfg: TrackingConfig): ConsentCategory[] {
  const out: ConsentCategory[] = [];
  if (cfg.ga4Id) out.push("mesure");
  if (cfg.adsId || cfg.metaPixelId) out.push("publicite");
  return out;
}

export const CATEGORY_LABELS: Record<ConsentCategory, { title: string; text: (cfg: TrackingConfig) => string }> = {
  mesure: {
    title: "Mesure d'audience",
    text: () => "Google Analytics : pages vues et provenance des visites, pour savoir quelles pages aident vraiment.",
  },
  publicite: {
    title: "Publicité",
    text: (cfg) => {
      const tools = [cfg.adsId ? "Google Ads" : null, cfg.metaPixelId ? "Meta (Facebook, Instagram)" : null].filter(Boolean).join(" et ");
      return `${tools} : savoir quelle annonce vous a amené ici et si elle a mené à une inscription.`;
    },
  },
};

function isChoice(value: unknown): value is ConsentChoice {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return c.v === 1 && typeof c.date === "string" && typeof c.mesure === "boolean" && typeof c.publicite === "boolean";
}

/** Choix enregistré et encore valable, sinon null (aucun choix, format inconnu, plus de six mois). */
export function parseConsent(raw: string | null, now: number = Date.now()): ConsentChoice | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isChoice(value)) return null;
    const at = Date.parse(value.date);
    if (!Number.isFinite(at) || now - at > CONSENT_MAX_AGE_DAYS * 86_400_000 || at - now > 86_400_000) return null;
    return value;
  } catch {
    return null;
  }
}

let current: ConsentChoice | null | undefined;
const listeners = new Set<() => void>();
const openListeners = new Set<() => void>();

function readStored(): ConsentChoice | null {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Le choix du visiteur (null : pas encore de choix). Stable entre deux changements. */
export function getConsent(): ConsentChoice | null {
  if (current === undefined) current = typeof window === "undefined" ? null : readStored();
  return current;
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Enregistre le choix. Si le stockage est indisponible (navigation privée, blocage), le choix
 * vaut pour la visite en cours et le bandeau reviendra à la prochaine.
 */
export function saveConsent(choice: { mesure: boolean; publicite: boolean }, now: Date = new Date()): ConsentChoice {
  const value: ConsentChoice = { v: 1, date: now.toISOString(), mesure: choice.mesure, publicite: choice.publicite };
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // stockage indisponible : le choix reste en mémoire pour cette visite
  }
  current = value;
  for (const l of listeners) l();
  return value;
}

/** Oublie le choix (tests, ou « redemander »). */
export function resetConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // rien à faire
  }
  current = null;
  for (const l of listeners) l();
}

/** Rouvre le panneau des préférences (lien « Cookies » du pied de page). */
export function openConsentPreferences(): void {
  for (const l of openListeners) l();
}

export function onOpenConsentPreferences(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/** Tests : remet l'état en mémoire à zéro (relu depuis le stockage au prochain accès). */
export function __resetConsentMemory(): void {
  current = undefined;
}
