/* Capacités du navigateur pour le verre liquide (essai §6) et choix du rendu.
   Détection par SUPPORT (CSS.supports, matchMedia), jamais par lecture de la chaîne User-Agent.
   Hors navigateur (rendu serveur, tests sans DOM) : valeurs sûres = surface opaque, sans animation. */

export interface GlassCapabilities {
  /** backdrop-filter (ou -webkit-backdrop-filter) ET color-mix() gérés. */
  backdrop: boolean;
  /** prefers-reduced-transparency: reduce. */
  reducedTransparency: boolean;
  /** prefers-reduced-motion: reduce. */
  reducedMotion: boolean;
  /** prefers-contrast: more. */
  moreContrast: boolean;
  /** Réfraction des bords possible : filtre SVG en CSS + moteur Chromium (voir isChromiumEngine). */
  refraction: boolean;
}

/** Valeurs sûres hors navigateur : verre désactivé (opaque), aucune animation, aucune réfraction. */
export const SAFE_GLASS_CAPABILITIES: Readonly<GlassCapabilities> = Object.freeze({
  backdrop: false,
  reducedTransparency: false,
  reducedMotion: true,
  moreContrast: false,
  refraction: false,
});

export const GLASS_MEDIA_QUERIES = {
  reducedTransparency: "(prefers-reduced-transparency: reduce)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  moreContrast: "(prefers-contrast: more)",
} as const;

/** Sous-ensemble de `window` utile à la détection (injectable dans les tests). */
export interface GlassEnvironment {
  matchMedia?: (query: string) => { matches: boolean };
  CSS?: { supports?: (property: string, value: string) => boolean };
  navigator?: unknown;
}

function supports(env: GlassEnvironment, property: string, value: string): boolean {
  try {
    return typeof env.CSS?.supports === "function"
      ? Boolean(env.CSS.supports(property, value))
      : false;
  } catch {
    return false;
  }
}

function matches(env: GlassEnvironment, query: string): boolean {
  try {
    return typeof env.matchMedia === "function" ? Boolean(env.matchMedia(query)?.matches) : false;
  } catch {
    return false;
  }
}

/**
 * Moteur Chromium, détecté par une capacité et non par le User-Agent : l'API
 * « User-Agent Client Hints » (`navigator.userAgentData`) n'existe que dans les
 * moteurs Chromium (Chrome, Edge, Chrome Android, Samsung Internet…). On teste sa
 * présence, on ne lit jamais la chaîne `navigator.userAgent`.
 */
export function isChromiumEngine(env: GlassEnvironment): boolean {
  const nav = env.navigator;
  return (
    typeof nav === "object" &&
    nav !== null &&
    "userAgentData" in nav &&
    Boolean((nav as { userAgentData?: unknown }).userAgentData)
  );
}

/** Lit les capacités dans un environnement donné (par défaut `window`). Fonction pure vis-à-vis de `env`. */
export function detectGlassCapabilities(env?: GlassEnvironment): GlassCapabilities {
  const target: GlassEnvironment | undefined =
    env ?? (typeof window === "undefined" ? undefined : (window as unknown as GlassEnvironment));
  if (!target) return { ...SAFE_GLASS_CAPABILITIES };

  const backdrop =
    (supports(target, "backdrop-filter", "blur(1px)") ||
      supports(target, "-webkit-backdrop-filter", "blur(1px)")) &&
    supports(target, "background-color", "color-mix(in srgb, currentColor 50%, transparent)");
  const reducedTransparency = matches(target, GLASS_MEDIA_QUERIES.reducedTransparency);
  const reducedMotion = matches(target, GLASS_MEDIA_QUERIES.reducedMotion);
  const moreContrast = matches(target, GLASS_MEDIA_QUERIES.moreContrast);
  const refraction =
    backdrop &&
    supports(target, "filter", "url(#selio-glass)") &&
    supports(target, "backdrop-filter", "url(#selio-glass)") &&
    isChromiumEngine(target);

  return { backdrop, reducedTransparency, reducedMotion, moreContrast, refraction };
}

export type GlassMode = "glass" | "opaque";
export type GlassFallbackReason = "no-backdrop" | "reduced-transparency" | "more-contrast";

/** Décide du rendu : verre seulement si le navigateur le permet et que l'utilisateur ne demande pas l'inverse. */
export function glassModeFor(caps: GlassCapabilities): {
  mode: GlassMode;
  reason: GlassFallbackReason | null;
} {
  if (!caps.backdrop) return { mode: "opaque", reason: "no-backdrop" };
  if (caps.reducedTransparency) return { mode: "opaque", reason: "reduced-transparency" };
  if (caps.moreContrast) return { mode: "opaque", reason: "more-contrast" };
  return { mode: "glass", reason: null };
}

/** Clé stable d'un jeu de capacités (pour mémoriser l'instantané de useSyncExternalStore). */
export function glassCapabilitiesKey(caps: GlassCapabilities): string {
  return [
    caps.backdrop,
    caps.reducedTransparency,
    caps.reducedMotion,
    caps.moreContrast,
    caps.refraction,
  ]
    .map((v) => (v ? "1" : "0"))
    .join("");
}
