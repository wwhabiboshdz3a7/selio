import webpush, { type Urgency } from "web-push";
import type { RadarAlertPayload } from "@selio/contracts";
import type { PushSendResult, PushSender, PushTarget } from "@selio/core";

/**
 * Notifications Web Push de la PWA (alertes Selio Radar), avec la bibliothèque `web-push` et les clés
 * VAPID du serveur (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Sans clés, le push est
 * désactivé : GET /api/push/config répond `{ enabled: false }` et les alertes restent en file.
 *
 * Le même module existe dans apps/worker/src/push.ts (envoi des alertes) : à garder aligné.
 *
 * - Contenu minimal (JSON `{ title, body, url }`) : jamais de pseudo, de note ni de photo du vendeur.
 * - TTL d'une heure (une affaire plus vieille n'a plus d'intérêt), urgence « high » pour les affaires et
 *   les paiements 3-D Secure à valider, « normal » sinon.
 * - L'adresse d'un abonnement vient du navigateur (donnée non fiable) : seuls les services de
 *   notification connus sont acceptés (Google, Mozilla, Microsoft, Apple), en https sur le port par
 *   défaut. Le serveur n'envoie jamais de requête vers une autre adresse (machine, réseau local…).
 * - Les erreurs ne gardent que le statut HTTP : jamais l'adresse de l'abonnement ni ses clés.
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` ou `https:` (contact de l'émetteur, exigé par les services de notification). */
  subject: string;
}

/** Durée de conservation d'une notification par le service de notification (secondes). */
export const PUSH_TTL_SECONDS = 3600;
/** Délai de la requête vers le service de notification (ms). */
export const PUSH_TIMEOUT_MS = 10_000;

/** Services de notification acceptés (hôte exact ou sous-domaine). */
export const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"] as const;

/** Adresse d'abonnement acceptée : https, port par défaut, sans identifiants, hôte d'un service de notification connu. */
export function isAllowedPushEndpoint(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || (u.port !== "" && u.port !== "443") || u.username !== "" || u.password !== "") return false;
  const host = u.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Urgence de la notification : « high » pour une affaire ou un paiement à valider, « normal » sinon. */
export function pushUrgency(payload: Pick<RadarAlertPayload, "url">): Urgency {
  return payload.url.startsWith("/app/radar/affaires/") || payload.url.startsWith("/app/radar/achats/") ? "high" : "normal";
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const decodedLength = (s: string) => Buffer.from(s, "base64url").length;

/**
 * Lit les clés VAPID : toutes absentes → null (push désactivé) ; à moitié remplies ou mal formées →
 * erreur explicite (le démarrage s'arrête). Clé publique : point P-256 non compressé (65 octets),
 * clé privée : 32 octets, en base64 « url ».
 */
export function loadVapidConfig(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) throw new Error("VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY vont ensemble (générer : npx web-push generate-vapid-keys).");
  if (!B64URL.test(publicKey) || decodedLength(publicKey) !== 65) throw new Error("VAPID_PUBLIC_KEY invalide : clé publique P-256 en base64 « url » (65 octets) attendue.");
  if (!B64URL.test(privateKey) || decodedLength(privateKey) !== 32) throw new Error("VAPID_PRIVATE_KEY invalide : clé privée P-256 en base64 « url » (32 octets) attendue.");
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject)) throw new Error("VAPID_SUBJECT doit être une adresse « mailto:contact@exemple.fr » ou une URL https.");
  return { publicKey, privateKey, subject };
}

type SendFn = typeof webpush.sendNotification;

/** Envoi Web Push réel (bibliothèque web-push). `send` est injectable pour les tests (aucun réseau). */
export class WebPushSender implements PushSender {
  private readonly send_: SendFn;
  private readonly timeoutMs: number;

  constructor(private readonly vapid: VapidConfig, options: { send?: SendFn; timeoutMs?: number } = {}) {
    this.send_ = options.send ?? webpush.sendNotification;
    this.timeoutMs = options.timeoutMs ?? PUSH_TIMEOUT_MS;
  }

  async send(subscription: PushTarget, payload: RadarAlertPayload): Promise<PushSendResult> {
    // Adresse hors des services de notification connus : jamais contactée, abonnement traité comme disparu.
    if (!isAllowedPushEndpoint(subscription.endpoint)) return { ok: false, statusCode: 410, message: "Adresse de notification refusée." };
    const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url });
    try {
      const res = await this.send_({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, body, {
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        TTL: PUSH_TTL_SECONDS,
        urgency: pushUrgency(payload),
        timeout: this.timeoutMs,
        contentEncoding: "aes128gcm",
      });
      return { ok: true, statusCode: res.statusCode };
    } catch (err) {
      const raw = (err as { statusCode?: unknown } | null)?.statusCode;
      const statusCode = typeof raw === "number" ? raw : null;
      // Le message d'une erreur peut contenir l'adresse de l'abonnement : seul le statut (ou le type) est gardé.
      return { ok: false, statusCode, message: `Service de notification : ${statusCode ?? (err instanceof Error ? err.name : "erreur")}` };
    }
  }
}
