import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from "@selio/contracts";
import type { HealthDetailsView, SupervisionCheckView } from "../data/types";

/**
 * Données d'exemple de la démonstration pour l'équipe et l'exploitation : code de parrainage (fixe pour une
 * organisation) et supervision (cibles et vérifications fictives : rien n'est contrôlé, aucune alerte ne part).
 */

/** Code de parrainage stable tiré de l'identifiant d'organisation (alphabet lisible, 6 caractères). */
export function demoReferralCode(orgId: string): string {
  let h = 2166136261;
  for (const ch of orgId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[h % REFERRAL_CODE_ALPHABET.length];
    h = Math.imul(h ^ (i + 31), 2654435761) >>> 0;
  }
  return code;
}

/**
 * Supervision d'exemple : /api/health répond, /api/ai/health a eu une panne la nuit dernière (3 échecs →
 * une alerte, puis « rétabli »). Dates relatives à l'horloge de la démo.
 */
export function demoHealthDetails(now: Date): HealthDetailsView {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const recent: SupervisionCheckView[] = [];
  for (let m = 0; m < 12; m++) {
    recent.push({ target: "API Selio", ok: true, statusCode: 200, latencyMs: 38 + ((m * 7) % 23), error: null, event: null, delivered: null, checkedAt: at(m) });
    recent.push({ target: "Assistant IA", ok: true, statusCode: 200, latencyMs: 120 + ((m * 13) % 60), error: null, event: null, delivered: null, checkedAt: at(m) });
  }
  // Panne de la nuit (hors des dernières vérifications, mais gardée 7 jours dans les alertes) : trois échecs
  // d'affilée, alerte, rappel, puis rétablissement. Deux canaux délivrés à chaque fois (Web Push + email).
  const alerts: SupervisionCheckView[] = [
    { target: "Assistant IA", ok: true, statusCode: 200, latencyMs: 164, error: null, event: "recovered", delivered: 2, checkedAt: at(7 * 60) },
    { target: "Assistant IA", ok: false, statusCode: 503, latencyMs: 41, error: "HTTP 503", event: "reminder", delivered: 2, checkedAt: at(8 * 60) },
    { target: "Assistant IA", ok: false, statusCode: 503, latencyMs: 39, error: "HTTP 503", event: "alert", delivered: 2, checkedAt: at(9 * 60) },
  ];
  recent.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  return {
    simulated: true,
    health: {
      ok: true,
      status: "ok",
      version: "démo",
      uptimeSeconds: 3 * 86_400 + 4 * 3600,
      checkedAt: now.toISOString(),
      checks: { database: "ok", redis: "inline", queue: "inline" },
      latencyMs: { database: 2, redis: null },
    },
    queues: [],
    supervision: {
      failuresBeforeAlert: 3,
      reminderMinutes: 60,
      targets: [
        { name: "API Selio", url: "https://api.exemple.invalid/api/health", status: "up", consecutiveFailures: 0, failingSince: null, downSince: null, lastAlertAt: null, lastCheckedAt: at(0), lastOkAt: at(0), lastStatusCode: 200, lastLatencyMs: 38, lastError: null },
        { name: "Assistant IA", url: "https://api.exemple.invalid/api/ai/health", status: "up", consecutiveFailures: 0, failingSince: null, downSince: null, lastAlertAt: at(8 * 60), lastCheckedAt: at(0), lastOkAt: at(0), lastStatusCode: 200, lastLatencyMs: 120, lastError: null },
      ],
      recent,
      alerts,
    },
  };
}
