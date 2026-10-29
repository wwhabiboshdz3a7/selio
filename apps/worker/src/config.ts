import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";
import { loadPaymentConfig, paymentConfigSchema } from "@selio/connectors";
import { emailConfigSchema, loadEmailConfig } from "@selio/email";

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
    /**
     * Selio Cloud : le worker ouvre Chromium seulement pour agir (une action, puis fermeture) ou pour
     * la fenêtre de connexion du client. Sans CLOUD_ENABLED=true ET CLOUD_CHROMIUM_PATH, rien ne
     * s'exécute (« Cloud désactivé »).
     */
    CLOUD_ENABLED: bool,
    /** Exécutable Chromium installé sur la machine : aucun navigateur n'est téléchargé. */
    CLOUD_CHROMIUM_PATH: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
    /** Navigateur sans fenêtre (vrai par défaut). */
    CLOUD_HEADLESS: z.string().optional().transform((v) => (v === undefined || v.trim() === "" ? true : /^(1|true|yes|oui|on)$/i.test(v.trim()))),
    /**
     * Bac à sable de Chromium (vrai par défaut). `false` n'est accepté qu'hors production (poste de
     * développement en root) : sans bac à sable, une faille d'un moteur de rendu donnerait accès au worker.
     */
    CLOUD_CHROMIUM_SANDBOX: z.string().optional().transform((v) => (v === undefined || v.trim() === "" ? true : !/^(0|false|no|non|off)$/i.test(v.trim()))),
    /** Navigateurs simultanés, actions et fenêtres de connexion confondues (défaut prudent 5 ; 50 = hypothèse à mesurer). */
    CLOUD_MAX_BROWSERS: z.coerce.number().int().min(1).max(200).default(5),
    CLOUD_MAX_ACCOUNTS_PER_ORG: z.coerce.number().int().min(1).max(100).default(10),
    /** Actions lourdes (republier, modifier en masse) : à décider par Ibrahim. */
    CLOUD_HEAVY_ACTIONS: bool,
    /** Cloud en option avec Pro (prix à décider, rien n'est facturé). */
    CLOUD_PRO_OPTION: bool,
    CLOUD_ACTIVE_HOURS: activeHoursSchema,
    /** Expiration de la fenêtre de connexion. */
    CLOUD_LOGIN_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(30 * 60_000).default(300_000),
    /** Durée maximale d'une action, navigateur compris. */
    CLOUD_ACTION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(90_000),
    /** Cadence du planificateur du Cloud (UTC) : une action au plus par compte et par passage. */
    CRON_CLOUD: z.string().default("* * * * *"),
    /** Dossier des profils temporaires (un par exécution, supprimé à la fin). */
    CLOUD_PROFILE_DIR: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : join(tmpdir(), "selio-cloud")))
      .refine((v) => isAbsolute(v), "CLOUD_PROFILE_DIR doit être un chemin absolu"),
  })
  .merge(aiConfigSchema)
  // Paiement Revolut et emails : mêmes variables que l'API (débit mensuel et email d'échec depuis le worker).
  .merge(paymentConfigSchema)
  .merge(emailConfigSchema);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Réglages Cloud transmis au cœur (`services.config`) : tout ce qui ouvre davantage est faux par défaut. */
export function cloudServicesConfig(cfg: Pick<WorkerEnv, "CLOUD_HEAVY_ACTIONS" | "CLOUD_MAX_ACCOUNTS_PER_ORG" | "CLOUD_MAX_BROWSERS" | "CLOUD_PRO_OPTION" | "CLOUD_ACTIVE_HOURS" | "CLOUD_LOGIN_TIMEOUT_MS">) {
  return {
    cloudHeavyActions: cfg.CLOUD_HEAVY_ACTIONS,
    cloudMaxAccountsPerOrg: cfg.CLOUD_MAX_ACCOUNTS_PER_ORG,
    cloudMaxBrowsers: cfg.CLOUD_MAX_BROWSERS,
    cloudProOption: cfg.CLOUD_PRO_OPTION,
    cloudActiveHours: cfg.CLOUD_ACTIVE_HOURS,
    cloudLoginTimeoutMs: cfg.CLOUD_LOGIN_TIMEOUT_MS,
  };
}

/**
 * Fenêtres de connexion simultanées sur la machine : jamais tous les navigateurs, un créneau reste
 * toujours aux actions (CLOUD_MAX_BROWSERS - 1, au moins 1). La limite par organisation est dans le cœur.
 */
export function cloudLoginConcurrency(maxBrowsers: number): number {
  return Math.max(1, Math.floor(maxBrowsers) - 1);
}

/** Délai d'attente du passage du Cloud à l'arrêt : l'action en cours (CLOUD_ACTION_TIMEOUT_MS) plus une marge. */
export function cloudDrainMs(actionTimeoutMs: number): number {
  return actionTimeoutMs + 15_000;
}

/** Âge au-delà duquel un dossier de travail Chromium est forcément abandonné (action ou fenêtre la plus longue + marge). */
export function cloudProfileMaxAgeMs(cfg: Pick<WorkerEnv, "CLOUD_ACTION_TIMEOUT_MS" | "CLOUD_LOGIN_TIMEOUT_MS">): number {
  return Math.max(cfg.CLOUD_ACTION_TIMEOUT_MS, cfg.CLOUD_LOGIN_TIMEOUT_MS) + 3 * 60_000;
}

/** Le Cloud n'agit que si CLOUD_ENABLED=true et qu'un Chromium local est indiqué. */
export function cloudRunnable(cfg: Pick<WorkerEnv, "CLOUD_ENABLED" | "CLOUD_CHROMIUM_PATH">): boolean {
  return cfg.CLOUD_ENABLED && !!cfg.CLOUD_CHROMIUM_PATH;
}

export function loadEnv(env: Record<string, string | undefined> = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Configuration worker invalide :\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  if (parsed.data.NODE_ENV === "production" && (parsed.data.ALLOW_AI_FALLBACK || parsed.data.AI_PROVIDER === "mock")) throw new Error("En production : AI_PROVIDER=ollama et ALLOW_AI_FALLBACK=false.");
  if (parsed.data.NODE_ENV === "production" && !parsed.data.CLOUD_CHROMIUM_SANDBOX) throw new Error("En production : CLOUD_CHROMIUM_SANDBOX=false est refusé (Chromium ne tourne jamais sans son bac à sable).");
  // Paiement ou email à moitié configurés (ou mode live non autorisé) : arrêt explicite, comme l'API.
  try {
    loadPaymentConfig(parsed.data);
    loadEmailConfig(parsed.data);
  } catch (err) {
    throw new Error(`Configuration worker invalide :\n  - ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed.data;
}
