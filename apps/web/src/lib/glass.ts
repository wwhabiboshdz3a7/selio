import { useCallback, useSyncExternalStore } from "react";
import { env } from "./env";

/**
 * Essai « verre liquide » (§6) : désactivé par défaut, réglé dans Paramètres › Apparence et mémorisé PAR
 * UTILISATEUR sur cet appareil (localStorage, clé propre à l'utilisateur). Aucune préférence d'utilisateur
 * n'existe côté serveur aujourd'hui : l'ajouter demanderait une migration et une route, ce que l'essai ne
 * justifie pas (à reprendre si l'essai est gardé).
 *
 * VITE_EXPERIMENT_GLASS=true (démo, captures) active l'essai par défaut ; un choix explicite de
 * l'utilisateur l'emporte toujours. Quand l'essai est inactif, rien ne change dans l'application : aucune
 * surface de verre n'est rendue.
 */

export type GlassPreference = "on" | "off";

/** Valeur par défaut de l'essai, lue dans la configuration publique (fausse sans VITE_EXPERIMENT_GLASS=true). */
export const glassDefaultFromEnv: boolean = env.VITE_EXPERIMENT_GLASS === "true";

const PREFIX = "selio.glass.";
const CHANGE_EVENT = "selio:glass-change";

export function glassStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/** Choix enregistré pour cet utilisateur (null : aucun choix, la valeur par défaut s'applique). */
export function readGlassPreference(userId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): GlassPreference | null {
  try {
    const v = storage?.getItem(glassStorageKey(userId));
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function writeGlassPreference(userId: string, pref: GlassPreference, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(glassStorageKey(userId), pref);
  } catch {
    // stockage indisponible : le choix vaut pour cette visite seulement
    memory.set(userId, pref);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Essai actif ? Le choix de l'utilisateur, sinon la valeur par défaut (configuration). */
export function glassEnabled(pref: GlassPreference | null, envDefault: boolean = glassDefaultFromEnv): boolean {
  return pref === null ? envDefault : pref === "on";
}

const memory = new Map<string, GlassPreference>();

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Réglage de l'essai pour un utilisateur, suivi en direct (autres onglets compris). */
export function useGlassExperiment(userId: string): { enabled: boolean; preference: GlassPreference | null; envDefault: boolean; setEnabled: (on: boolean) => void } {
  const preference = useSyncExternalStore(subscribe, () => readGlassPreference(userId) ?? memory.get(userId) ?? null, () => null);
  const setEnabled = useCallback((on: boolean) => writeGlassPreference(userId, on ? "on" : "off"), [userId]);
  return { enabled: glassEnabled(preference), preference, envDefault: glassDefaultFromEnv, setEnabled };
}
