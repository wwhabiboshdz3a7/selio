import type { PushSubscriptionInput, RadarAlertPayload } from "@selio/contracts";
import type { DataClient } from "./data/types";

/**
 * Notifications de la PWA (alertes Radar sur le téléphone). Le navigateur s'abonne avec la clé PUBLIQUE
 * VAPID du serveur (`/api/push/config`) puis envoie l'abonnement à l'API ; la clé privée ne quitte
 * jamais le serveur. Les notifications reçues sont affichées par le gestionnaire importé par le service
 * worker (`public/push-handler.js`). Aucun processus permanent ici : rien ne tourne en arrière-plan.
 */

/** Ce dont la page a besoin du navigateur (injectable dans les tests). */
export interface PushEnv {
  isSecureContext: boolean;
  serviceWorker: Pick<ServiceWorkerContainer, "ready" | "getRegistration"> | null;
  /** `window.PushManager` (présence seulement). */
  hasPushManager: boolean;
  Notification: Pick<typeof Notification, "permission" | "requestPermission"> | null;
  userAgent: string;
}

export function browserPushEnv(): PushEnv {
  const w = typeof window !== "undefined" ? window : undefined;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    isSecureContext: w?.isSecureContext === true,
    serviceWorker: nav && "serviceWorker" in nav ? nav.serviceWorker : null,
    hasPushManager: w !== undefined && "PushManager" in w,
    Notification: w && "Notification" in w ? w.Notification : null,
    userAgent: nav?.userAgent ?? "",
  };
}

export type PushPermission = NotificationPermission | "unsupported";

export interface PushSupport {
  supported: boolean;
  /** Pourquoi ce navigateur ne peut pas recevoir les alertes (null s'il le peut). */
  reason: string | null;
}

/** Ce navigateur peut-il recevoir des notifications push ? (iPhone : seulement l'application ajoutée à l'écran d'accueil.) */
export function pushSupport(env: PushEnv = browserPushEnv()): PushSupport {
  if (!env.isSecureContext) return { supported: false, reason: "Les notifications exigent une connexion sécurisée (https)." };
  if (!env.serviceWorker || !env.hasPushManager || !env.Notification) {
    return { supported: false, reason: "Ce navigateur ne reçoit pas les notifications. Sur iPhone, ajoutez d'abord Selio à l'écran d'accueil (Partager › Sur l'écran d'accueil), puis ouvrez-le depuis l'icône." };
  }
  return { supported: true, reason: null };
}

export function permissionOf(env: PushEnv = browserPushEnv()): PushPermission {
  return env.Notification ? env.Notification.permission : "unsupported";
}

/** Clé publique VAPID (base64url) en octets, comme l'attend `PushManager.subscribe`. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Enregistrement du service worker ; null s'il n'existe pas (mode développement) ou ne répond pas à temps. */
export async function swRegistration(env: PushEnv = browserPushEnv(), timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!env.serviceWorker) return null;
  const existing = await env.serviceWorker.getRegistration().catch(() => undefined);
  if (!existing) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([env.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Abonnement push actuel de CET appareil (null s'il n'y en a pas). */
export async function currentSubscription(env: PushEnv = browserPushEnv()): Promise<PushSubscription | null> {
  const reg = await swRegistration(env);
  if (!reg?.pushManager) return null;
  return reg.pushManager.getSubscription().catch(() => null);
}

/** Ce que l'API reçoit : adresse du service de notification et clés de chiffrement de l'abonnement, rien d'autre. */
export function subscriptionToInput(sub: PushSubscription, userAgent: string): PushSubscriptionInput {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("Abonnement du navigateur incomplet");
  return { endpoint: json.endpoint, keys: { p256dh, auth }, userAgent: userAgent.slice(0, 400) || undefined };
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "no_service_worker" | "no_key"; message: string };

/**
 * Active les alertes sur CET appareil : permission demandée (seulement à ce clic), abonnement avec la clé
 * publique du serveur, abonnement envoyé à l'API. Une erreur de l'API défait l'abonnement local.
 */
export async function enablePush(client: Pick<DataClient, "subscribePush">, publicKey: string | null, env: PushEnv = browserPushEnv()): Promise<EnableResult> {
  const support = pushSupport(env);
  if (!support.supported) return { ok: false, reason: "unsupported", message: support.reason! };
  if (!publicKey) return { ok: false, reason: "no_key", message: "Le serveur n'a pas de clé de notification : les alertes ne sont pas activables." };
  const permission = env.Notification!.permission === "granted" ? "granted" : await env.Notification!.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied", message: "Notifications refusées dans le navigateur : autorisez-les dans les réglages du site, puis réessayez." };
  const reg = await swRegistration(env);
  if (!reg?.pushManager) return { ok: false, reason: "no_service_worker", message: "Le service worker de Selio n'est pas actif sur cet appareil : rechargez la page (ou installez l'application), puis réessayez." };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  try {
    await client.subscribePush(subscriptionToInput(sub, env.userAgent));
  } catch (e) {
    await sub.unsubscribe().catch(() => false);
    throw e;
  }
  return { ok: true };
}

/** Nom lisible d'un appareil abonné, d'après son navigateur (rien d'autre n'est connu). */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPhone|iPad/.test(ua) ? "iPhone ou iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [browser, os].filter(Boolean).join(" sur ") || "Appareil inconnu";
}

/** Désactive les alertes sur CET appareil : désabonnement local puis côté serveur. */
export async function disablePush(client: Pick<DataClient, "unsubscribePush">, env: PushEnv = browserPushEnv()): Promise<boolean> {
  const sub = await currentSubscription(env);
  if (!sub) return false;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await client.unsubscribePush(endpoint);
  return true;
}

/**
 * Déconnexion : les alertes de CET appareil sont retirées d'abord (abonnement local et côté serveur),
 * sans jamais empêcher la déconnexion (erreur ignorée, délai court). Un appareil partagé ne reçoit
 * plus les affaires, paiements et pauses du compte après la déconnexion.
 */
export async function unsubscribeOnLogout(client: Pick<DataClient, "unsubscribePush">, env: PushEnv = browserPushEnv(), timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([disablePush(client, env).catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Affiche une notification sur cet appareil sans serveur (démonstration) : par le service worker si
 * possible, sinon par l'API Notification. Rend faux sans permission : la page montre alors un bandeau.
 */
export async function showLocalNotification(payload: RadarAlertPayload, env: PushEnv = browserPushEnv()): Promise<boolean> {
  if (!env.Notification || env.Notification.permission !== "granted") return false;
  const options: NotificationOptions = { body: payload.body, icon: "/icon-192.png", badge: "/favicon-64.png", data: { url: payload.url }, lang: "fr", tag: "selio-radar-test" };
  const reg = await swRegistration(env, 1500);
  if (reg) {
    await reg.showNotification(payload.title, options);
    return true;
  }
  try {
    new Notification(payload.title, options);
    return true;
  } catch {
    return false;
  }
}
