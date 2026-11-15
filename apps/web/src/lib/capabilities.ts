import { useQuery } from "@tanstack/react-query";
import type { ServerCapabilities } from "@selio/contracts";
import { useData } from "./data/provider";

/**
 * Capacités du serveur (GET /api/capabilities) : ce qui est réellement branché. Règle d'honnêteté : une fonction
 * qui n'est pas encore branchée en réel affiche « En cours d'activation », jamais les chiffres du simulateur.
 * En démonstration (sans API), tout reste visible : les données y sont fictives et signalées comme telles.
 */
export type LiveFeature = "trackLive" | "cloud" | "radarLive" | "vision" | "pricingModel";

export const CAPABILITIES_KEY = ["capabilities"] as const;

export function useCapabilities() {
  const { client, mode } = useData();
  return useQuery({ queryKey: [...CAPABILITIES_KEY, mode], queryFn: () => client.getCapabilities(), staleTime: 5 * 60_000, retry: 1 });
}

/** Une fonction est-elle branchée en réel ? Démonstration : toujours. Capacités illisibles : non (prudence). */
export function isFeatureLive(caps: ServerCapabilities | undefined, feature: LiveFeature, mode: "demo" | "connected"): boolean {
  if (mode === "demo") return true;
  if (!caps) return false;
  return caps.demo || caps[feature] === true;
}

/**
 * État d'une fonction pour l'écran : `pending` tant que les capacités ne sont pas lues (afficher un chargement,
 * jamais les chiffres), puis `live` (écran réel) ou non (état « En cours d'activation »).
 */
export function useFeature(feature: LiveFeature): { pending: boolean; live: boolean } {
  const { mode } = useData();
  const q = useCapabilities();
  if (mode === "demo") return { pending: false, live: true };
  if (q.isPending) return { pending: true, live: false };
  return { pending: false, live: isFeatureLive(q.data, feature, mode) };
}

/** Paiement simulé sur ce serveur (Revolut pas encore configuré) : aucune carte, aucun débit. */
export function usePaymentSimulated(): boolean {
  const { mode } = useData();
  const q = useCapabilities();
  return mode === "connected" && q.data?.payment === "simulated";
}
