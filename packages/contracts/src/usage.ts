import { z } from "zod";

/**
 * Compteurs d'utilisation partagés (page « Mon utilisation », API, vue administrateur).
 * Un compteur rapproche l'utilisé du quota du plan ; l'alerte se déclenche à 80 %.
 */

/** Part du quota à partir de laquelle un compteur passe en alerte. */
export const USAGE_WARNING_RATE = 0.8;

/**
 * Pourcentage d'utilisation, entier entre 0 et 100 (plafonné : un dépassement vaut 100).
 * Un quota nul (fonction non incluse) donne 0 tant que rien n'est utilisé, 100 sinon.
 */
export function usagePercent(used: number, quota: number): number {
  const u = Number.isFinite(used) ? Math.max(0, used) : 0;
  if (!Number.isFinite(quota) || quota <= 0) return u > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((u / quota) * 100)));
}

/** Alerte à partir de 80 % du quota (ou dès la première unité quand la fonction n'est pas incluse). */
export function usageWarning(used: number, quota: number): boolean {
  return quota > 0 ? used >= quota * USAGE_WARNING_RATE : used > 0;
}

export const usageCounter = z.object({
  used: z.number().int().min(0),
  quota: z.number().int().min(0),
  /** Entier 0–100, plafonné. */
  percent: z.number().int().min(0).max(100),
  /** À partir de 80 % du quota. */
  warning: z.boolean(),
  /** Quota atteint ou dépassé : l'action suivante est refusée. */
  exceeded: z.boolean(),
});
export type UsageCounter = z.infer<typeof usageCounter>;

/** Construit un compteur complet à partir de l'utilisé et du quota. */
export function buildUsageCounter(used: number, quota: number): UsageCounter {
  const u = Math.max(0, Math.round(used));
  const q = Math.max(0, Math.round(quota));
  return { used: u, quota: q, percent: usagePercent(u, q), warning: usageWarning(u, q), exceeded: u >= q };
}

/** Utilisation par filiale, renvoyée par GET /api/billing/usage en plus des compteurs historiques. */
export const subsidiaryUsage = z.object({
  studio: z.object({ listings: usageCounter, wornPhotos: usageCounter }),
  track: z.object({ scans: usageCounter, photoSearches: usageCounter, filtersFollowed: usageCounter }),
  cloud: z.object({ actions: usageCounter, included: z.boolean() }),
});
export type SubsidiaryUsage = z.infer<typeof subsidiaryUsage>;
