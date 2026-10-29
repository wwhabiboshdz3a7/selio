import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";
import { loadStorageConfig, storageConfigSchema } from "@selio/storage";
import { emailConfigSchema, emailStartupWarnings, loadEmailConfig } from "@selio/email";
import { loadPaymentConfig, paymentConfigSchema, paymentStartupNotices } from "@selio/connectors";

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
    /** Franchise en base de TVA (art. 293 B du CGI) : factures à 0 % avec la mention légale. */
    FRANCHISE_TVA: bool,
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .merge(aiConfigSchema)
  // Stockage des photos (S3 / MinIO), emails transactionnels et paiement Revolut : blocs facultatifs, validés ci-dessous.
  .merge(storageConfigSchema)
  .merge(emailConfigSchema)
  .merge(paymentConfigSchema);

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
  // Une configuration de stockage, d'email ou de paiement à moitié remplie (ou un mode live non
  // autorisé) arrête le démarrage ici (même format de message).
  try {
    loadStorageConfig(cfg);
    loadEmailConfig(cfg);
    loadPaymentConfig(cfg);
  } catch (err) {
    throw new Error(`Configuration invalide :\n  - ${err instanceof Error ? err.message : String(err)}`);
  }
  return cfg;
}

export interface StartupNotice {
  level: "warn" | "info";
  message: string;
}

/**
 * Messages de démarrage, jamais bloquants : en production, un fournisseur d'email
 * « noop » ou un stockage absent sont signalés en avertissement ; ailleurs, pour information.
 */
export function startupNotices(cfg: ApiEnv): StartupNotice[] {
  const prod = cfg.NODE_ENV === "production";
  const out: StartupNotice[] = [];
  const email = loadEmailConfig(cfg);
  for (const message of emailStartupWarnings(email, cfg.NODE_ENV)) out.push({ level: "warn", message });
  if (!prod) out.push({ level: "info", message: `Emails : fournisseur ${email.provider}${email.provider === "noop" ? " (aucun envoi, journalisation seule)" : ""}.` });
  if (!loadStorageConfig(cfg)) {
    out.push({ level: prod ? "warn" : "info", message: "Stockage des photos non configuré (STORAGE_ENDPOINT absent) : /api/uploads répond 503. Voir docs/STOCKAGE.md (MinIO)." });
  }
  out.push(...paymentStartupNotices(loadPaymentConfig(cfg), cfg.NODE_ENV));
  if (cfg.FRANCHISE_TVA) out.push({ level: "info", message: "FRANCHISE_TVA=true : factures sans TVA (« TVA non applicable, art. 293 B du CGI »)." });
  return out;
}
