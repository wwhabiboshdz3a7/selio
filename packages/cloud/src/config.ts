import { ACTION_LEVELS, type CloudActionKind } from "./types";

/**
 * Réglages du Cloud, lus dans l'environnement (API et worker). Aucun secret ici :
 * la clé de chiffrement des sessions (SECRETS_ENCRYPTION_KEY) est lue par
 * `@selio/db`, jamais par ce paquet.
 */
export interface CloudConfig {
  /** Chemin de l'exécutable Chromium (CLOUD_CHROMIUM_PATH) ; null = Cloud indisponible sur cette machine. */
  chromiumPath: string | null;
  /** CLOUD_HEADLESS (vrai par défaut). */
  headless: boolean;
  /** Durée maximale d'une action, navigateur compris (CLOUD_ACTION_TIMEOUT_MS, 90 s par défaut). */
  actionTimeoutMs: number;
  /** Expiration de la fenêtre de connexion (CLOUD_LOGIN_TIMEOUT_MS, 5 min par défaut). */
  loginTimeoutMs: number;
  /**
   * Navigateurs ouverts en même temps (CLOUD_MAX_BROWSERS). Défaut prudent : 5.
   * La cible de 50 est une hypothèse à mesurer (`pnpm cloud:bench`), pas un chiffre mesuré.
   */
  maxBrowsers: number;
  /** Actions lourdes (republier, modifier en masse) : CLOUD_HEAVY_ACTIONS=false par défaut, à décider par Ibrahim. */
  heavyActions: boolean;
  /** Comptes Cloud au plus par organisation (CLOUD_MAX_ACCOUNTS_PER_ORG, 10 par défaut). */
  maxAccountsPerOrg: number;
}

export const CLOUD_DEFAULTS = Object.freeze({
  headless: true,
  actionTimeoutMs: 90_000,
  loginTimeoutMs: 5 * 60_000,
  maxBrowsers: 5,
  heavyActions: false,
  maxAccountsPerOrg: 10,
});

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^(1|true|yes|oui|on)$/i.test(raw.trim());
}

export function loadCloudConfig(env: Record<string, string | undefined> = process.env): CloudConfig {
  const path = env.CLOUD_CHROMIUM_PATH?.trim();
  return {
    chromiumPath: path ? path : null,
    headless: bool(env.CLOUD_HEADLESS, CLOUD_DEFAULTS.headless),
    actionTimeoutMs: int(env.CLOUD_ACTION_TIMEOUT_MS, CLOUD_DEFAULTS.actionTimeoutMs, 10_000, 600_000),
    loginTimeoutMs: int(env.CLOUD_LOGIN_TIMEOUT_MS, CLOUD_DEFAULTS.loginTimeoutMs, 60_000, 30 * 60_000),
    maxBrowsers: int(env.CLOUD_MAX_BROWSERS, CLOUD_DEFAULTS.maxBrowsers, 1, 100),
    heavyActions: bool(env.CLOUD_HEAVY_ACTIONS, CLOUD_DEFAULTS.heavyActions),
    maxAccountsPerOrg: int(env.CLOUD_MAX_ACCOUNTS_PER_ORG, CLOUD_DEFAULTS.maxAccountsPerOrg, 1, 100),
  };
}

/**
 * Adresse IP partagée au lancement : seules les actions légères passent ; une
 * action lourde exige `heavyActions` (CLOUD_HEAVY_ACTIONS=true), à décider par Ibrahim.
 */
export function isActionAllowed(kind: CloudActionKind, config: Pick<CloudConfig, "heavyActions">): boolean {
  return ACTION_LEVELS[kind] === "light" || config.heavyActions;
}
