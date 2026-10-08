import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";

const bool = z.string().optional().transform((v) => v === "true" || v === "1");

export const apiEnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().default("0.0.0.0"),
    CORS_ORIGINS: z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
    PUBLIC_WEB_URL: z.string().url().default("http://127.0.0.1:5173"),
    TRUST_PROXY: bool,
    COOKIE_SECURE: bool,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL requise"),
    REDIS_URL: z.string().optional(),
    SECRETS_ENCRYPTION_KEY: z.string().min(40, "SECRETS_ENCRYPTION_KEY : clé base64 de 32 octets requise"),
    OPERATOR_EMAILS: z.string().default(""),
    ALLOW_AI_FALLBACK: bool,
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_STARTER: z.string().optional(),
    STRIPE_PRICE_PRO: z.string().optional(),
    STRIPE_LIVE_ALLOWED: bool,
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .merge(aiConfigSchema);

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Configuration validée au démarrage : toute incohérence arrête le processus avec un message explicite. */
export function loadEnv(env: Record<string, string | undefined> = process.env): ApiEnv {
  const parsed = apiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (cfg.ALLOW_AI_FALLBACK) throw new Error("ALLOW_AI_FALLBACK doit être false en production : aucun résultat simulé ne doit remplacer l'IA.");
    if (cfg.AI_PROVIDER === "mock") throw new Error("AI_PROVIDER=mock est interdit en production (simulateur).");
    if (!cfg.COOKIE_SECURE) throw new Error("COOKIE_SECURE doit être true en production (HTTPS).");
  }
  return cfg;
}
