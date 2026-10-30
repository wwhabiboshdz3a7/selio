import { z } from "zod";
import { aiConfigSchema } from "@selio/ai";
import { loadStorageConfig, storageConfigSchema } from "@selio/storage";
import { emailConfigSchema, emailStartupWarnings, loadEmailConfig } from "@selio/email";
import { loadPaymentConfig, paymentConfigSchema, paymentStartupNotices } from "@selio/connectors";
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
    /**
     * Notifications Web Push de la PWA (alertes Radar) : clés VAPID du serveur (générer une fois avec
     * `npx web-push generate-vapid-keys`) et contact de l'émetteur (`mailto:`). Absentes : push désactivé,
     * GET /api/push/config répond `{ enabled: false }`. Mêmes valeurs dans le worker.
     */
    VAPID_PUBLIC_KEY: optionalText,
    VAPID_PRIVATE_KEY: optionalText,
    VAPID_SUBJECT: optionalText,
    /**
     * Radar Auto (achat automatique), premier verrou côté serveur : faux par défaut, réservé aux comptes
     * de l'équipe pour les tests ; pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim
     * n'a pas tranché. En production, il exige RADAR_AUTO_ORG_IDS (organisations de l'équipe).
     */
    RADAR_AUTO_ENABLED: bool,
    /** Organisations (comptes de l'équipe) autorisées pour Radar Auto, séparées par des virgules. */
    RADAR_AUTO_ORG_IDS: z.string().optional().transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    /** Achat réel (D11) : faux par défaut ; sans lui, l'achat s'arrête avant le bouton de paiement (« simulé »). */
    RADAR_REAL_PURCHASE: bool,
    /** Attente de la validation 3-D Secure par le client (ms) : même valeur que le worker. */
    CLOUD_3DS_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(30 * 60_000).default(600_000),
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
  // Radar Auto reste réservé aux comptes de l'équipe : en production, la liste est obligatoire.
  if (cfg.NODE_ENV === "production" && cfg.RADAR_AUTO_ENABLED && cfg.RADAR_AUTO_ORG_IDS.length === 0) {
    throw new Error("Configuration invalide :\n  - RADAR_AUTO_ENABLED=true exige RADAR_AUTO_ORG_IDS en production (Radar Auto réservé aux comptes de l'équipe, pas aux clients sur l'adresse partagée).");
  }
  // Une configuration de stockage, d'email, de paiement ou de notifications à moitié remplie (ou un
  // mode live non autorisé) arrête le démarrage ici (même format de message).
  try {
    loadStorageConfig(cfg);
    loadEmailConfig(cfg);
    loadPaymentConfig(cfg);
    loadVapidConfig(cfg);
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

/**
 * Réglages Radar transmis au cœur (`services.config`) : Radar Auto et l'achat réel fermés par défaut,
 * délai 3-D Secure aligné sur le worker (le navigateur et la demande d'achat expirent ensemble).
 */
export function radarServicesConfig(cfg: Pick<ApiEnv, "RADAR_AUTO_ENABLED" | "RADAR_AUTO_ORG_IDS" | "RADAR_REAL_PURCHASE" | "CLOUD_3DS_TIMEOUT_MS">): Pick<ServicesConfig, "radarAutoEnabled" | "radarAutoOrgIds" | "radarRealPurchase"> & radar.RadarRuntimeConfig {
  return {
    radarAutoEnabled: cfg.RADAR_AUTO_ENABLED,
    radarAutoOrgIds: cfg.RADAR_AUTO_ORG_IDS.length > 0 ? [...cfg.RADAR_AUTO_ORG_IDS] : undefined,
    radarRealPurchase: cfg.RADAR_REAL_PURCHASE,
    radar3dsTimeoutMs: cfg.CLOUD_3DS_TIMEOUT_MS,
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
  out.push({ level: !loadVapidConfig(cfg) && prod ? "warn" : "info", message: loadVapidConfig(cfg) ? "Notifications Web Push activées (clés VAPID)." : "Notifications Web Push désactivées (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes) : les alertes Radar restent en file." });
  if (cfg.RADAR_AUTO_ENABLED) {
    out.push({ level: "warn", message: `Radar Auto OUVERT côté serveur (RADAR_AUTO_ENABLED=true) pour ${cfg.RADAR_AUTO_ORG_IDS.length > 0 ? `${cfg.RADAR_AUTO_ORG_IDS.length} organisation(s) de l'équipe` : "toutes les organisations (hors production)"} ; achat réel ${cfg.RADAR_REAL_PURCHASE ? "ouvert" : "fermé (essai à blanc, D11)"}.` });
  } else if (cfg.RADAR_REAL_PURCHASE) {
    out.push({ level: "warn", message: "RADAR_REAL_PURCHASE=true sans RADAR_AUTO_ENABLED : sans effet, aucun achat réel." });
  }
  return out;
}
