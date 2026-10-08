import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";

const bool = z.string().optional().transform((v) => v === "true" || v === "1");

export const workerEnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1, "REDIS_URL requise pour le worker"),
    SECRETS_ENCRYPTION_KEY: z.string().min(40),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ALLOW_AI_FALLBACK: bool,
    CRON_AUTOMATION_TICK: z.string().default("*/5 * * * *"),
    CRON_JOBS_PROCESS: z.string().default("* * * * *"),
    CRON_CONNECTOR_SYNC: z.string().default("*/15 * * * *"),
    CRON_RADAR: z.string().default("0 * * * *"),
    CRON_RETENTION: z.string().default("0 3 * * *"),
  })
  .merge(aiConfigSchema);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadEnv(env: Record<string, string | undefined> = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Configuration worker invalide :\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  if (parsed.data.NODE_ENV === "production" && (parsed.data.ALLOW_AI_FALLBACK || parsed.data.AI_PROVIDER === "mock")) throw new Error("En production : AI_PROVIDER=ollama et ALLOW_AI_FALLBACK=false.");
  return parsed.data;
}
