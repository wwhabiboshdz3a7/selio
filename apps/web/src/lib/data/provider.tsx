import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEMO_STORAGE_KEY } from "@selio/demo-data";
import { LoadingState } from "@selio/ui";
import { onSessionEvent } from "../session-sync";
import type { DemoClient } from "../demo/client";
import { ApiClient } from "../api/client";
import { apiBaseUrl, connectedModeAvailable } from "../env";
import type { DataClient, Mode, Session } from "./types";

const MODE_KEY = "selio.mode";

export function readMode(): Mode {
  // Production (build avec API) : pas de démonstration, la session est toujours réelle.
  if (!__SELIO_DEMO__) return "connected";
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
let demoLoading: Promise<DemoClient> | null = null;

/**
 * Client de démonstration, chargé à la demande : seulement dans un build sans API (développement, tests,
 * vidéos). En production (__SELIO_DEMO__ faux au build), cette branche disparaît et son code n'est pas livré.
 */
export function loadDemoClient(): Promise<DemoClient> {
  if (!__SELIO_DEMO__) return Promise.reject(new Error("Démonstration indisponible sur cette installation."));
  if (demoSingleton) return Promise.resolve(demoSingleton);
  demoLoading ??= import("../demo/client").then((m) => (demoSingleton ??= new m.DemoClient()));
  return demoLoading;
}

/** Client de démonstration déjà chargé (loadDemoClient) ; erreur sinon. */
export function getDemoClient(): DemoClient {
  if (!demoSingleton) throw new Error("Client de démonstration pas encore chargé : appeler loadDemoClient() d'abord.");
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
  const [mode, setModeState] = useState<Mode>(() => (forceMode === "demo" && !__SELIO_DEMO__ ? "connected" : forceMode ?? readMode()));
  // Démonstration : client chargé à la demande (déjà prêt s'il a été chargé avant, par exemple dans les tests).
  const [demo, setDemo] = useState<DemoClient | null>(() => demoSingleton);
  useEffect(() => {
    if (mode !== "demo" || demo) return;
    let alive = true;
    void loadDemoClient().then((c) => { if (alive) setDemo(c); });
    return () => { alive = false; };
  }, [mode, demo]);
  const client = useMemo<DataClient | null>(() => (mode === "connected" ? new ApiClient(apiBaseUrl) : demo), [mode, demo]);
  const value = useMemo<DataContextValue | null>(
    () => client ? ({
      client,
      mode,
      setMode: (m) => {
        // Production : jamais de démonstration, quoi qu'on demande.
        if (m === "demo" && !__SELIO_DEMO__) return;
        writeMode(m);
        setModeState(m);
        queryClient.clear();
      },
    }) : null,
    [client, mode],
  );
  useEffect(() => {
    if (mode !== "demo" || !demo) return;
    // Toute mutation du client démo invalide les requêtes (persistance locale).
    return demo.subscribe(() => queryClient.invalidateQueries());
  }, [mode, demo]);
  // Deux onglets : la démonstration enregistrée par l'autre onglet est relue (pas d'écrasement silencieux) ;
  // une déconnexion ou un changement d'organisation fait ailleurs s'applique ici aussi.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (mode === "demo" && demo && e.key === DEMO_STORAGE_KEY) demo.syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    const off = onSessionEvent((e) => {
      if (e.kind === "logout") {
        if (mode === "demo" && demo) demo.forgetSession();
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
  }, [mode, demo]);
  if (!value) return <LoadingState variant="spinner" label="Préparation des données…" className="min-h-dvh" />;
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
