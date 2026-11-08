import { useSyncExternalStore } from "react";
import {
  GLASS_MEDIA_QUERIES,
  SAFE_GLASS_CAPABILITIES,
  detectGlassCapabilities,
  glassCapabilitiesKey,
  type GlassCapabilities,
} from "../lib/glass";

/* Instantané mémorisé : useSyncExternalStore exige la même référence tant que rien ne change. */
let cachedKey = "";
let cachedSnapshot: GlassCapabilities = SAFE_GLASS_CAPABILITIES;

function getSnapshot(): GlassCapabilities {
  const next = detectGlassCapabilities();
  const key = glassCapabilitiesKey(next);
  if (key !== cachedKey) {
    cachedKey = key;
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}

function getServerSnapshot(): GlassCapabilities {
  return SAFE_GLASS_CAPABILITIES;
}

/** S'abonne aux changements des préférences système (transparence, mouvement, contraste). */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => undefined;
  const lists = Object.values(GLASS_MEDIA_QUERIES)
    .map((query) => {
      try {
        return window.matchMedia(query);
      } catch {
        return null;
      }
    })
    .filter((list): list is MediaQueryList => Boolean(list));
  for (const list of lists) {
    if (typeof list.addEventListener === "function") list.addEventListener("change", onChange);
    else list.addListener?.(onChange);
  }
  return () => {
    for (const list of lists) {
      if (typeof list.removeEventListener === "function")
        list.removeEventListener("change", onChange);
      else list.removeListener?.(onChange);
    }
  };
}

/**
 * Capacités du navigateur pour le verre liquide : `{ backdrop, reducedTransparency,
 * reducedMotion, moreContrast, refraction }`. Suit en direct les préférences système
 * (matchMedia) ; au rendu serveur et hors navigateur, renvoie des valeurs sûres
 * (surface opaque, sans animation, sans réfraction).
 */
export function useGlassCapabilities(): GlassCapabilities {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
