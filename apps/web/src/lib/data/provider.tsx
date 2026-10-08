import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
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

export const queryClient = new QueryClient({
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

export function useClient(): DataClient {
  return useData().client;
}

export const sessionKey = ["session"] as const;

export function useSession() {
  const { client, mode } = useData();
  return useQuery({ queryKey: [...sessionKey, mode], queryFn: () => client.getSession(), staleTime: 60_000 });
}

export function useRequiredSession(): Session {
  const q = useSession();
  if (!q.data) throw new Error("Session requise");
  return q.data;
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
