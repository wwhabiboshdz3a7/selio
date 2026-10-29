import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";
import { loadPaymentConfig, paymentConfigSchema } from "@selio/connectors";
import { emailConfigSchema, loadEmailConfig } from "@selio/email";

const bool = z.string().optional().transform((v) => v === "true" || v === "1");

export const workerEnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1, "REDIS_URL requise pour le worker"),
    SECRETS_ENCRYPTION_KEY: z.string().min(40),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ALLOW_AI_FALLBACK: bool,
    /** URL publique du site : base des liens dans les emails (échec de paiement). */
    PUBLIC_WEB_URL: z.string().url().default("http://127.0.0.1:5173"),
    /** Franchise en base de TVA (art. 293 B du CGI) : factures de renouvellement à 0 % avec la mention légale. */
    FRANCHISE_TVA: bool,
    CRON_AUTOMATION_TICK: z.string().default("*/5 * * * *"),
    CRON_JOBS_PROCESS: z.string().default("* * * * *"),
    CRON_CONNECTOR_SYNC: z.string().default("*/15 * * * *"),
    CRON_RADAR: z.string().default("0 * * * *"),
    CRON_RETENTION: z.string().default("0 3 * * *"),
    /**
     * Échéances d'abonnement (renouvellements, fins d'essai, relances J+1 / J+3 / J+7, annulation des
     * autorisations restées posées) : toutes les heures. Les relances sont calculées à l'heure de
     * l'échéance ; un passage quotidien les décalerait d'un jour (tentatives le 2, 3, 5 et 9 pour des
     * emails annonçant le 2, 4 et 8). Le traitement est idempotent : rien n'est tenté hors échéance.
     */
    CRON_BILLING_RENEW: z.string().default("0 * * * *"),
  })
  .merge(aiConfigSchema)
  // Paiement Revolut et emails : mêmes variables que l'API (débit mensuel et email d'échec depuis le worker).
  .merge(paymentConfigSchema)
  .merge(emailConfigSchema);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadEnv(env: Record<string, string | undefined> = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Configuration worker invalide :\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  if (parsed.data.NODE_ENV === "production" && (parsed.data.ALLOW_AI_FALLBACK || parsed.data.AI_PROVIDER === "mock")) throw new Error("En production : AI_PROVIDER=ollama et ALLOW_AI_FALLBACK=false.");
  // Paiement ou email à moitié configurés (ou mode live non autorisé) : arrêt explicite, comme l'API.
  try {
    loadPaymentConfig(parsed.data);
    loadEmailConfig(parsed.data);
  } catch (err) {
    throw new Error(`Configuration worker invalide :\n  - ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed.data;
}
