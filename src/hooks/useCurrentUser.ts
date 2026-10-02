import { useQuery, useQueryClient } from "@tanstack/react-query";

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const res = await fetch("/api/user", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Impossible de charger l'utilisateur");
  const data = (await res.json()) as { ok: boolean; user: CurrentUser | null };
  return data.user ?? null;
}

export function useCurrentUser() {
  return useQuery({ queryKey: ["current-user"], queryFn: fetchCurrentUser, staleTime: 60_000, retry: false });
}

export function useInvalidateCurrentUser() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["current-user"] });
}
