import { useMutation, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { useToast } from "@selio/ui";
import { errorMessage } from "../../lib/errors";

/** Mutation avec toast d'erreur et invalidation de clés. */
export function useAppMutation<TData, TVars>(fn: (vars: TVars) => Promise<TData>, opts: { invalidate?: string[]; success?: string | ((d: TData) => string | null); onSuccess?: (d: TData, v: TVars) => void } & Omit<UseMutationOptions<TData, unknown, TVars>, "mutationFn" | "onSuccess"> = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { invalidate, success, onSuccess, ...rest } = opts;
  return useMutation<TData, unknown, TVars>({
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
}
