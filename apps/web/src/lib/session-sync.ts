/**
 * Synchronisation de la session entre onglets (même navigateur, même compte) : une déconnexion ou un changement
 * d'organisation fait dans un onglet est annoncé aux autres, qui se mettent à jour au lieu de continuer sur une
 * session fermée ou sur l'organisation précédente. BroadcastChannel quand le navigateur l'a, sinon l'événement
 * `storage` (clé éphémère). Aucune donnée de session n'est transmise : seulement le type d'événement.
 */

export type SessionEventKind = "logout" | "switch-org";
export interface SessionEvent {
  kind: SessionEventKind;
  /** Onglet émetteur (jamais traité par lui-même). */
  tab: string;
  at: number;
}

const CHANNEL = "selio.session";
const STORAGE_KEY = "selio.session.event";
const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    channel = null;
  }
  return channel;
}

function isEvent(v: unknown): v is SessionEvent {
  return !!v && typeof v === "object" && ((v as SessionEvent).kind === "logout" || (v as SessionEvent).kind === "switch-org") && typeof (v as SessionEvent).tab === "string";
}

/** Annonce un événement de session aux autres onglets. Ne lève jamais. */
export function announceSession(kind: SessionEventKind): void {
  const event: SessionEvent = { kind, tab: TAB_ID, at: Date.now() };
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(event);
      return;
    } catch {
      // repli sur le stockage
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stockage indisponible : les autres onglets se mettront à jour à leur prochaine requête (401)
  }
}

/** Écoute les événements des AUTRES onglets ; rend la fonction de désabonnement. */
export function onSessionEvent(handler: (e: SessionEvent) => void): () => void {
  const accept = (v: unknown) => {
    if (isEvent(v) && v.tab !== TAB_ID) handler(v);
  };
  const ch = getChannel();
  const onMessage = (e: MessageEvent) => accept(e.data);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      accept(JSON.parse(e.newValue));
    } catch {
      // valeur illisible : ignorée
    }
  };
  ch?.addEventListener("message", onMessage);
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    ch?.removeEventListener("message", onMessage);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
