import { z } from "zod";

/** Enveloppe d'erreur API uniforme. */
export const apiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "rate_limited",
  "quota_exceeded",
  "connector_unavailable",
  "ai_unavailable",
  "ai_invalid_output",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const healthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  mode: z.literal("connected"),
  services: z.record(z.object({ ok: z.boolean(), latencyMs: z.number().nullable(), message: z.string().optional() })),
  checkedAt: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponse>;
