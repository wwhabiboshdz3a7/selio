import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEMO_STORAGE_KEY } from "@selio/demo-data";
import { onSessionEvent } from "../session-sync";
import { DemoClient } from "../demo/client";
import { ApiClient } from "../api/client";
import { apiBaseUrl, connectedModeAvailable } from "../env";
import type { DataClient, Mode, Session } from "./types";

const MODE_KEY = "selio.mode";

export function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "connected" && connectedModeAvailable) return "connected";
  } catch {
    // ignore
  }
  return "demo";
}

export function writeMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

interface DataContextValue {
  client: DataClient;
  mode: Mode;
  setMode: (m: Mode) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

let demoSingleton: DemoClient | null = null;
export function getDemoClient(): DemoClient {
  if (!demoSingleton) demoSingleton = new DemoClient();
  return demoSingleton;
}

/**
 * Session fermée côté serveur pendant que la page était ouverte (déconnexion dans un autre onglet ou un autre
 * appareil, session expirée, mot de passe changé) : toute réponse 401 relit la session, et RequireSession ramène
 * à la connexion (avec la page en cours comme page de retour) au lieu de laisser des écrans en erreur.
 */
function onUnauthorized(err: unknown, key?: readonly unknown[]): void {
  if ((err as { status?: number } | null)?.status !== 401 || key?.[0] === sessionKey[0]) return;
  void queryClient.invalidateQueries({ queryKey: [...sessionKey] });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err, query) => onUnauthorized(err, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (err) => onUnauthorized(err) }),
  defaultOptions: {
    queries: { staleTime: 5_000, retry: (count, err) => count < 1 && (err as { status?: number }).status !== 401 && (err as { status?: number }).status !== 403 && (err as { status?: number }).status !== 404, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

export function DataProvider({ children, forceMode }: { children: ReactNode; forceMode?: Mode }) {
  const [mode, setModeState] = useState<Mode>(() => forceMode ?? readMode());
  const client = useMemo<DataClient>(() => (mode === "connected" ? new ApiClient(apiBaseUrl) : getDemoClient()), [mode]);
  const value = useMemo<DataContextValue>(
    () => ({
      client,
      mode,
      setMode: (m) => {
        writeMode(m);
        setModeState(m);
        queryClient.clear();
      },
    }),
    [client, mode],
  );
  useEffect(() => {
    if (mode !== "demo") return;
    // Toute mutation du client démo invalide les requêtes (persistance locale).
    return getDemoClient().subscribe(() => queryClient.invalidateQueries());
  }, [mode]);
  // Deux onglets : la démonstration enregistrée par l'autre onglet est relue (pas d'écrasement silencieux) ;
  // une déconnexion ou un changement d'organisation fait ailleurs s'applique ici aussi.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (mode === "demo" && e.key === DEMO_STORAGE_KEY) getDemoClient().syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    const off = onSessionEvent((e) => {
      if (e.kind === "logout") {
        if (mode === "demo") getDemoClient().forgetSession();
        // La session relue (absente) ramène à la connexion, avec la page en cours comme page de retour.
        void queryClient.invalidateQueries({ queryKey: [...sessionKey] });
      } else {
        // Autre organisation : tout est relu pour la nouvelle (jamais d'écran mêlant les deux).
        void queryClient.invalidateQueries();
      }
    });
    return () => {
      window.removeEventListener("storage", onStorage);
      off();
    };
  }, [mode]);
  return (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={value}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData doit être utilisé dans <DataProvider>");
  return ctx;
}

/** Mode courant, ou « demo » hors de <DataProvider> (composants rendus seuls dans les tests). */
export function useDataMode(): "demo" | "connected" {
  return useContext(DataContext)?.mode ?? "demo";
}

export function useClient(): DataClient {
  return useData().client;
}

export const sessionKey = ["session"] as const;

export function useSession() {
  const { client, mode } = useData();
  return useQuery({ queryKey: [...sessionKey, mode], queryFn: () => client.getSession(), staleTime: 60_000 });
}

/**
 * Session d'un écran protégé par RequireSession. À la fin de la session (déconnexion, suppression
 * de l'organisation), chaque composant abonné peut être rendu une dernière fois avant que
 * RequireSession ne redirige : on garde alors la dernière session connue au lieu de lever une erreur
 * (qui affichait « Cette page a rencontré un problème » le temps de la redirection).
 */
export function useRequiredSession(): Session {
  const q = useSession();
  const [last, setLast] = useState<Session | null>(q.data ?? null);
  if (q.data && q.data !== last) setLast(q.data);
  const session = q.data ?? last;
  if (!session) throw new Error("Session requise");
  return session;
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
