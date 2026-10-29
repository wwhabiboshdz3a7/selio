import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";
import { loadStorageConfig, storageConfigSchema } from "@selio/storage";
import { emailConfigSchema, emailStartupWarnings, loadEmailConfig } from "@selio/email";
import { loadPaymentConfig, paymentConfigSchema, paymentStartupNotices } from "@selio/connectors";

const bool = z.string().optional().transform((v) => v === "true" || v === "1");

/** Plage horaire « début-fin » en heures entières (ex. « 8-23 » : de 8 h à 23 h, fuseau de l'organisation). */
export const activeHoursSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const v = raw && raw.trim() ? raw : "8-23";
    const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(v);
    const startHour = m ? Number(m[1]) : NaN;
    const endHour = m ? Number(m[2]) : NaN;
    if (!m || startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24 || startHour >= endHour) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "format attendu « début-fin » en heures, ex. 8-23 (début < fin ≤ 24)" });
      return z.NEVER;
    }
    return { startHour, endHour };
  });

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
    /**
     * Selio Cloud. L'API n'ouvre jamais de navigateur : elle enregistre l'accord, les comptes et les
     * réglages, met en file la fenêtre de connexion (file « selio-cloud-login ») et relaie ses images
     * et entrées par Redis. Désactivé par défaut ; activé, il exige REDIS_URL.
     */
    CLOUD_ENABLED: bool,
    /** Navigateurs simultanés sur la machine (défaut prudent 5 ; la cible de 50 est une hypothèse à mesurer). */
    CLOUD_MAX_BROWSERS: z.coerce.number().int().min(1).max(200).default(5),
    /** Comptes Cloud par organisation (jamais au-delà des comptes Vinted de l'offre). */
    CLOUD_MAX_ACCOUNTS_PER_ORG: z.coerce.number().int().min(1).max(100).default(10),
    /** Actions lourdes (republier, modifier en masse) sur l'adresse partagée : à décider par Ibrahim. */
    CLOUD_HEAVY_ACTIONS: bool,
    /** Cloud en option avec Pro (prix à décider, rien n'est facturé). */
    CLOUD_PRO_OPTION: bool,
    /** Heures actives du Cloud (fuseau de l'organisation), « début-fin ». */
    CLOUD_ACTIVE_HOURS: activeHoursSchema,
    /** Validité d'une fenêtre de connexion (ticket et fenêtre du worker), en ms. */
    CLOUD_LOGIN_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(30 * 60_000).default(300_000),
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
  // La fenêtre de connexion du Cloud passe par Redis (file du worker, images et entrées relayées).
  if (cfg.CLOUD_ENABLED && !cfg.REDIS_URL) throw new Error("Configuration invalide :\n  - CLOUD_ENABLED=true exige REDIS_URL (fenêtre de connexion relayée par le worker).");
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

/** Réglages Cloud transmis au cœur (`services.config`) : tout ce qui ouvre davantage est faux par défaut. */
export function cloudServicesConfig(cfg: Pick<ApiEnv, "CLOUD_HEAVY_ACTIONS" | "CLOUD_MAX_ACCOUNTS_PER_ORG" | "CLOUD_MAX_BROWSERS" | "CLOUD_PRO_OPTION" | "CLOUD_ACTIVE_HOURS" | "CLOUD_LOGIN_TIMEOUT_MS">) {
  return {
    cloudHeavyActions: cfg.CLOUD_HEAVY_ACTIONS,
    cloudMaxAccountsPerOrg: cfg.CLOUD_MAX_ACCOUNTS_PER_ORG,
    cloudMaxBrowsers: cfg.CLOUD_MAX_BROWSERS,
    cloudProOption: cfg.CLOUD_PRO_OPTION,
    cloudActiveHours: cfg.CLOUD_ACTIVE_HOURS,
    cloudLoginTimeoutMs: cfg.CLOUD_LOGIN_TIMEOUT_MS,
  };
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
  out.push({ level: "info", message: cfg.CLOUD_ENABLED ? `Selio Cloud activé : fenêtres de connexion relayées par Redis, ${cfg.CLOUD_MAX_BROWSERS} navigateurs au plus (hypothèse à mesurer), actions lourdes ${cfg.CLOUD_HEAVY_ACTIONS ? "ouvertes" : "fermées"}.` : "Selio Cloud désactivé (CLOUD_ENABLED=false) : réglages consultables, aucune fenêtre de connexion ouverte." });
  if (cfg.FRANCHISE_TVA) out.push({ level: "info", message: "FRANCHISE_TVA=true : factures sans TVA (« TVA non applicable, art. 293 B du CGI »)." });
  return out;
}
