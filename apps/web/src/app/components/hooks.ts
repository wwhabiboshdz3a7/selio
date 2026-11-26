import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient, type MutateOptions, type UseMutationOptions } from "@tanstack/react-query";
import { useToast } from "@selio/ui";
import { errorMessage } from "../../lib/errors";

/** Clé d'un appel (variables sérialisées) ; null si elles ne se sérialisent pas (jamais dédoublonné alors). */
function callKey(vars: unknown): string | null {
  try {
    return JSON.stringify(vars ?? null) ?? "undefined";
  } catch {
    return null;
  }
}

/**
 * Mutation avec toast d'erreur et invalidation de clés.
 *
 * Anti double envoi : un second appel avec les MÊMES variables pendant que le premier est en cours (double clic,
 * double tap, touche Entrée répétée avant que le bouton ne soit désactivé) ne relance rien : `mutate` l'ignore,
 * `mutateAsync` rend la promesse du premier. Des appels avec d'autres variables (une ligne différente d'une liste)
 * passent normalement. Le serveur refuse aussi le doublon des actions sensibles (`duplicate_request`).
 */
export function useAppMutation<TData, TVars>(fn: (vars: TVars) => Promise<TData>, opts: { invalidate?: string[]; success?: string | ((d: TData) => string | null); onSuccess?: (d: TData, v: TVars) => void } & Omit<UseMutationOptions<TData, unknown, TVars>, "mutationFn" | "onSuccess"> = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { invalidate, success, onSuccess, ...rest } = opts;
  const m = useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async (d, v) => {
      if (invalidate) await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      const msg = typeof success === "function" ? success(d) : success;
      if (msg) toast({ tone: "success", title: msg });
      onSuccess?.(d, v);
    },
    onError: (e) => toast({ tone: "danger", title: "Action impossible", description: errorMessage(e) }),
    ...rest,
  });
  const inFlight = useRef(new Map<string, Promise<TData>>());
  const baseMutateAsync = m.mutateAsync;
  const mutateAsync = useCallback(((vars: TVars, options?: MutateOptions<TData, unknown, TVars>): Promise<TData> => {
    const key = callKey(vars);
    const running = key !== null ? inFlight.current.get(key) : undefined;
    if (running) return running;
    const p = baseMutateAsync(vars, options);
    if (key !== null) {
      inFlight.current.set(key, p);
      p.then(() => inFlight.current.delete(key), () => inFlight.current.delete(key));
    }
    return p;
  }) as typeof m.mutateAsync, [baseMutateAsync]);
  // Comme `mutate` de React Query : l'erreur est traitée par `onError` (toast), jamais relancée à l'appelant.
  const mutate = useCallback(((vars: TVars, options?: MutateOptions<TData, unknown, TVars>): void => {
    mutateAsync(vars, options).catch(() => undefined);
  }) as typeof m.mutate, [mutateAsync]);
  return { ...m, mutate, mutateAsync };
}

/** Valeur recopiée après `ms` millisecondes sans changement (saisie au clavier → une seule requête). */
export function useDebouncedValue<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
