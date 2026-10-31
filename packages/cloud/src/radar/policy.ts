import { BLOCK_MESSAGES } from "../guard";

/**
 * Ce que Selio fait quand Vinted dit « stop » pendant une lecture Radar ou un achat Radar Auto.
 * Mêmes règles que les actions du Cloud (docs/CLOUD.md §1.5), sans exception pour Radar :
 *
 * - CAPTCHA, avertissement, blocage, « trop de requêtes » : la lecture s'arrête AUSSITÔT, le compte
 *   Cloud (Achat) passe en pause avec la raison (fonction système de pause du service Cloud, écrite
 *   d'abord), le client est prévenu, et la mesure de blocage est enregistrée. Rien n'est retenté ;
 *   aucune tentative de résolution ou de contournement.
 * - « Trop de requêtes » et blocage visent souvent l'adresse (partagée) : ils déclenchent en plus le
 *   coupe-circuit de la machine (`tripCircuit`), comme pour les actions du Cloud.
 *
 * Ce paquet décide seulement QUOI faire ; la pause, le coupe-circuit, l'alerte et l'écriture de la
 * mesure sont faits par le cœur (`packages/core`), qui détient la base.
 */
export const RADAR_STOP_CODES = ["captcha", "warning", "blocked", "rate_limited"] as const;
export type RadarStopCode = (typeof RADAR_STOP_CODES)[number];

/** Codes qui déclenchent aussi le coupe-circuit de la machine (même liste que le service Cloud). */
export const MACHINE_CIRCUIT_CODES: ReadonlySet<RadarStopCode> = new Set<RadarStopCode>(["rate_limited", "blocked"]);

export interface RadarStop {
  code: RadarStopCode;
  /** Toujours vrai : le compte Cloud (Achat) est mis en pause avec la raison, rien n'est retenté. */
  pauseAccount: true;
  /** Toujours vrai : le client reçoit une alerte. */
  alertClient: true;
  /** Toujours vrai : la page compte comme « bloquée » dans les mesures (taux pour 1 000 pages). */
  recordBlock: true;
  /** Coupe-circuit de la machine (adresse partagée) : « trop de requêtes » et blocage. */
  tripMachineCircuit: boolean;
  /** Message pour le client et le journal (aucune donnée de la page). */
  message: string;
}

export function isRadarStopCode(code: string): code is RadarStopCode {
  return (RADAR_STOP_CODES as readonly string[]).includes(code);
}

/** Conduite imposée pour un code, ou `null` si le code n'impose pas d'arrêt (délai, page changée…). */
export function radarStopFor(code: string): RadarStop | null {
  if (!isRadarStopCode(code)) return null;
  return { code, pauseAccount: true, alertClient: true, recordBlock: true, tripMachineCircuit: MACHINE_CIRCUIT_CODES.has(code), message: BLOCK_MESSAGES[code] };
}
