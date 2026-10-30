import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";
import { loadPaymentConfig, paymentConfigSchema } from "@selio/connectors";
import { emailConfigSchema, loadEmailConfig } from "@selio/email";
import type { ServicesConfig, radar } from "@selio/core";
import { loadVapidConfig } from "./push";

const bool = z.string().optional().transform((v) => v === "true" || v === "1");
/** Texte facultatif : vide ou blanc = absent. */
const optionalText = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));

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
    /**
     * Selio Radar : passage toutes les 30 s (planning BullMQ `every`) — recherches dues selon leur rythme
     * (60 s en direct, 30 s pour les prioritaires de Radar Auto, 1 h pour le simulateur, × facteur de
     * ralentissement), dans le plafond de pages par minute.
     */
    RADAR_TICK_EVERY_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(30_000),
    /** Envoi des alertes Radar en file (notifications de la PWA) : chaque minute. */
    CRON_ALERTS: z.string().default("* * * * *"),
    /** Passage de Radar Auto (seulement si RADAR_AUTO_ENABLED) : toutes les 30 s. */
    RADAR_AUTO_EVERY_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(30_000),
    /**
     * Radar Auto, premier verrou côté serveur : faux par défaut, réservé aux comptes de l'équipe pour les
     * tests ; pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché.
     */
    RADAR_AUTO_ENABLED: bool,
    /** Organisations de l'équipe autorisées (virgules) ; obligatoire en production si RADAR_AUTO_ENABLED=true. */
    RADAR_AUTO_ORG_IDS: z.string().optional().transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    /** Achat réel (D11) : faux par défaut ; sans lui, le parcours s'arrête avant le bouton de paiement. */
    RADAR_REAL_PURCHASE: bool,
    /** Pages lues en direct par minute sur toute la machine (toutes organisations ; défaut prudent 30). */
    RADAR_MAX_PAGES_PER_MINUTE_GLOBAL: z.coerce.number().int().min(1).max(600).default(30),
    /** Attente de la validation 3-D Secure par le client, navigateur tenu ouvert (ms). */
    CLOUD_3DS_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(30 * 60_000).default(600_000),
    /** Budget d'une lecture de page Radar, navigateur compris (ms). */
    RADAR_PAGE_BUDGET_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
    /** Durée d'un achat Radar Auto jusqu'au paiement, hors attente 3-D Secure (ms). */
    RADAR_PURCHASE_TIMEOUT_MS: z.coerce.number().int().min(20_000).max(300_000).default(90_000),
    /** Notifications Web Push (alertes Radar) : mêmes clés VAPID que l'API ; absentes = alertes laissées en file. */
    VAPID_PUBLIC_KEY: optionalText,
    VAPID_PRIVATE_KEY: optionalText,
    VAPID_SUBJECT: optionalText,
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
 * Réglages Radar transmis au cœur (`services.config`) : verrous de Radar Auto et achat réel fermés par
 * défaut ; délai 3-D Secure (la demande d'achat expire en même temps que le navigateur tenu ouvert).
 */
export function radarServicesConfig(cfg: Pick<WorkerEnv, "RADAR_AUTO_ENABLED" | "RADAR_AUTO_ORG_IDS" | "RADAR_REAL_PURCHASE" | "CLOUD_3DS_TIMEOUT_MS">): Pick<ServicesConfig, "radarAutoEnabled" | "radarAutoOrgIds" | "radarRealPurchase"> & radar.RadarRuntimeConfig {
  return {
    radarAutoEnabled: cfg.RADAR_AUTO_ENABLED,
    radarAutoOrgIds: cfg.RADAR_AUTO_ORG_IDS.length > 0 ? [...cfg.RADAR_AUTO_ORG_IDS] : undefined,
    radarRealPurchase: cfg.RADAR_REAL_PURCHASE,
    radar3dsTimeoutMs: cfg.CLOUD_3DS_TIMEOUT_MS,
  };
}

/** Plannings de la file « selio-maintenance » : cron (`pattern`) ou intervalle (`every`, en ms). */
export type MaintenanceSchedule = { name: string; pattern: string } | { name: string; every: number };

/**
 * Plannings du worker. « radar.tick » tourne toutes les 30 s, « alerts.send » chaque minute ;
 * « radar.auto » n'existe que si RADAR_AUTO_ENABLED (sinon son planning est retiré au démarrage).
 */
export function maintenanceSchedules(env: WorkerEnv): MaintenanceSchedule[] {
  return [
    { name: "automation.tick", pattern: env.CRON_AUTOMATION_TICK },
    { name: "jobs.process", pattern: env.CRON_JOBS_PROCESS },
    { name: "connector.sync", pattern: env.CRON_CONNECTOR_SYNC },
    { name: "radar.tick", every: env.RADAR_TICK_EVERY_MS },
    { name: "alerts.send", pattern: env.CRON_ALERTS },
    ...(env.RADAR_AUTO_ENABLED ? [{ name: "radar.auto", every: env.RADAR_AUTO_EVERY_MS }] : []),
    { name: "retention.cleanup", pattern: env.CRON_RETENTION },
    { name: "billing.renew", pattern: env.CRON_BILLING_RENEW },
    { name: "cloud.tick", pattern: env.CRON_CLOUD },
  ];
}

/** Plannings retirés au démarrage quand ils ne doivent plus tourner (Radar Auto fermé). */
export function disabledSchedules(env: WorkerEnv): string[] {
  return env.RADAR_AUTO_ENABLED ? [] : ["radar.auto"];
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

/**
 * Durée de vie maximale d'un navigateur d'achat Radar Auto : parcours jusqu'au paiement, attente de la
 * validation 3-D Secure (navigateur tenu ouvert), plus une marge pour relire la confirmation.
 */
export function radarBrowsingMaxMs(cfg: Pick<WorkerEnv, "RADAR_PURCHASE_TIMEOUT_MS" | "CLOUD_3DS_TIMEOUT_MS">): number {
  return cfg.RADAR_PURCHASE_TIMEOUT_MS + cfg.CLOUD_3DS_TIMEOUT_MS + 60_000;
}

/**
 * Âge au-delà duquel un dossier de travail Chromium est forcément abandonné : action, fenêtre de
 * connexion, page Radar ou achat Radar Auto le plus long (attente 3-D Secure comprise), plus une marge.
 * Un navigateur d'achat qui attend la banque n'écrit rien dans son dossier : le balayage ne doit
 * jamais le supprimer sous lui.
 */
export function cloudProfileMaxAgeMs(cfg: Pick<WorkerEnv, "CLOUD_ACTION_TIMEOUT_MS" | "CLOUD_LOGIN_TIMEOUT_MS" | "RADAR_PAGE_BUDGET_MS" | "RADAR_PURCHASE_TIMEOUT_MS" | "CLOUD_3DS_TIMEOUT_MS">): number {
  return Math.max(cfg.CLOUD_ACTION_TIMEOUT_MS, cfg.CLOUD_LOGIN_TIMEOUT_MS, cfg.RADAR_PAGE_BUDGET_MS, radarBrowsingMaxMs(cfg)) + 3 * 60_000;
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
  // Radar Auto reste réservé aux comptes de l'équipe : en production, la liste est obligatoire (comme l'API).
  if (parsed.data.NODE_ENV === "production" && parsed.data.RADAR_AUTO_ENABLED && parsed.data.RADAR_AUTO_ORG_IDS.length === 0) {
    throw new Error("Configuration worker invalide :\n  - RADAR_AUTO_ENABLED=true exige RADAR_AUTO_ORG_IDS en production (Radar Auto réservé aux comptes de l'équipe, pas aux clients sur l'adresse partagée).");
  }
  // Paiement, email ou notifications à moitié configurés (ou mode live non autorisé) : arrêt explicite, comme l'API.
  try {
    loadPaymentConfig(parsed.data);
    loadEmailConfig(parsed.data);
    loadVapidConfig(parsed.data);
  } catch (err) {
    throw new Error(`Configuration worker invalide :\n  - ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed.data;
}
