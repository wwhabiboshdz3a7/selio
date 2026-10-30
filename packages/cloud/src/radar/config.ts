/**
 * Réglages navigateur de Selio Radar, lus dans l'environnement du worker. Aucun secret.
 *
 * `RADAR_AUTO_ENABLED` (faux par défaut) est le verrou SERVEUR de Radar Auto : réservé aux comptes de
 * l'équipe pour les tests, et pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim
 * n'a pas tranché. Le worker le passe à `PurchaseRunner` (`realPurchaseAllowed`) ; le réglage de
 * l'organisation et `realPurchaseEnabled` (D11, faux par défaut) sont vérifiés par le cœur. Sans les
 * trois, tout achat est un essai à blanc (`dryRun`) qui s'arrête avant le bouton de paiement.
 */
export interface RadarBrowserConfig {
  /** RADAR_AUTO_ENABLED : verrou serveur de l'achat réel (faux par défaut). */
  autoEnabled: boolean;
  /** CLOUD_3DS_TIMEOUT_MS : attente de la validation 3-D Secure par le client (10 min par défaut). */
  threeDsTimeoutMs: number;
  /** RADAR_PAGE_BUDGET_MS : budget d'une lecture de page, navigateur compris (30 s par défaut). */
  pageBudgetMs: number;
  /** RADAR_PURCHASE_TIMEOUT_MS : durée d'un achat jusqu'au paiement, hors attente 3-D Secure (90 s). */
  purchaseTimeoutMs: number;
}

export const RADAR_BROWSER_DEFAULTS = Object.freeze({
  autoEnabled: false,
  threeDsTimeoutMs: 10 * 60_000,
  pageBudgetMs: 30_000,
  purchaseTimeoutMs: 90_000,
});

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Seule la valeur explicite « true » (ou 1, oui, on) ouvre le verrou ; tout le reste le garde fermé. */
function flag(raw: string | undefined): boolean {
  return raw !== undefined && /^(1|true|yes|oui|on)$/i.test(raw.trim());
}

export function loadRadarBrowserConfig(env: Record<string, string | undefined> = process.env): RadarBrowserConfig {
  return {
    autoEnabled: flag(env.RADAR_AUTO_ENABLED),
    threeDsTimeoutMs: int(env.CLOUD_3DS_TIMEOUT_MS, RADAR_BROWSER_DEFAULTS.threeDsTimeoutMs, 60_000, 30 * 60_000),
    pageBudgetMs: int(env.RADAR_PAGE_BUDGET_MS, RADAR_BROWSER_DEFAULTS.pageBudgetMs, 5_000, 120_000),
    purchaseTimeoutMs: int(env.RADAR_PURCHASE_TIMEOUT_MS, RADAR_BROWSER_DEFAULTS.purchaseTimeoutMs, 20_000, 300_000),
  };
}
