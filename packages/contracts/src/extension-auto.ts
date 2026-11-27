import { z } from "zod";
import { id, isoDate } from "./common";
import { cloudInboxSnapshot, cloudPauseReason, cloudRunCode } from "./cloud";

/**
 * Automatisation complète par l'extension (D64) : tant que le Chrome du vendeur est ouvert, l'extension lit
 * la messagerie Vinted et envoie les réponses automatiques depuis le navigateur du vendeur, dans un onglet
 * en arrière-plan qu'elle ouvre puis referme. Toute la décision (heures actives, pause, coupe-circuit,
 * plafond horaire, délai humain, plafond du jour) est prise PAR LE SERVEUR (`GET /api/ext/auto/next`) :
 * l'extension ne fait qu'exécuter l'action rendue, puis en rend compte (`POST /api/ext/auto/report`).
 * Interrupteur « Automatisation complète dans ce navigateur » désactivé par défaut ; activable seulement
 * avec l'accord courant (même texte que Selio Cloud).
 */

/** L'extension est « vue récemment » (tâches routées vers le navigateur) si son dernier contact date de moins de N minutes. */
export const EXTENSION_AUTO_SEEN_MINUTES = 30;
/** Hôtes Vinted où le script de l'extension est présent (manifeste) : l'automatisation complète n'agit que là. */
export const EXTENSION_AUTO_HOSTS = ["www.vinted.fr", "www.vinted.be", "www.vinted.com"] as const;

export const extensionAuto = z.object({
  id,
  orgId: id,
  connectionId: id,
  enabled: z.boolean().default(false),
  enabledAt: isoDate.nullable().default(null),
  enabledBy: z.string().nullable().default(null),
  pausedReason: cloudPauseReason.nullable().default(null),
  pausedAt: isoDate.nullable().default(null),
  warningsCount: z.number().int().min(0).default(0),
  lastSeenAt: isoDate.nullable().default(null),
  lastActionAt: isoDate.nullable().default(null),
  nextActionAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ExtensionAuto = z.infer<typeof extensionAuto>;

/** État vu par les options et le popup de l'extension. */
export const extensionAutoState = z.object({
  consentCurrent: z.boolean(),
  consentVersion: z.string(),
  /** Minutes entre deux lectures de la messagerie (CLOUD_INBOX_SYNC_MINUTES). */
  intervalMinutes: z.number().int().min(0),
  connections: z.array(
    z.object({
      connectionId: id,
      label: z.string(),
      enabled: z.boolean(),
      pausedReason: cloudPauseReason.nullable(),
      pausedLabel: z.string().nullable(),
      lastSeenAt: isoDate.nullable(),
      lastActionAt: isoDate.nullable(),
      /** Compte déjà actif dans Selio Cloud : le Cloud passe en premier. */
      cloudActive: z.boolean(),
    }),
  ),
});
export type ExtensionAutoState = z.infer<typeof extensionAutoState>;

export const extensionAutoSetInput = z.object({ connectionId: id, enabled: z.boolean() }).strict();
export const extensionAutoResumeInput = z.object({ connectionId: id, acknowledge: z.boolean().default(false) }).strict();

const retry = z.number().min(0.5).max(240);

/** Réponse de `GET /api/ext/auto/next` : attendre, lire la messagerie, ou envoyer un message préparé. */
export const extensionAutoNext = z.discriminatedUnion("action", [
  z.object({ action: z.literal("wait"), reason: z.string().max(60), retryInMinutes: retry }),
  z.object({ action: z.literal("sync_inbox"), jobId: id, inboxUrl: z.string().url().max(300), maxConversations: z.number().int().min(1).max(20), retryInMinutes: retry }),
  z.object({ action: z.literal("send"), jobId: id, conversationUrl: z.string().url().max(300), text: z.string().trim().min(1).max(2000), retryInMinutes: retry }),
]);
export type ExtensionAutoNext = z.infer<typeof extensionAutoNext>;

/** Compte rendu de l'extension (`POST /api/ext/auto/report`). Jamais de texte de la page hors messages lus. */
export const extensionAutoReport = z
  .object({
    jobId: id,
    code: cloudRunCode,
    /** « none » : rien n'a été cliqué ; « unknown » : le clic a eu lieu sans confirmation (jamais renvoyé). */
    sideEffects: z.enum(["none", "unknown"]).default("none"),
    durationMs: z.number().int().min(0).max(3_600_000).optional(),
    inbox: cloudInboxSnapshot.optional(),
  })
  .strict();
export type ExtensionAutoReport = z.infer<typeof extensionAutoReport>;
