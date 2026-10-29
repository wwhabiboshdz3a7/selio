import { randomBytes } from "node:crypto";
import IORedis from "ioredis";
import type { Queue } from "bullmq";
import { z } from "zod";

/**
 * Relais de la fenêtre de connexion de Selio Cloud entre le navigateur du client (WebSocket de
 * l'API) et le worker qui pilote Chromium (Redis).
 *
 * Protocole (le même que apps/worker/src/cloud-login.ts, à garder aligné) :
 * - `cloud:screen:<id>` (worker → API) : `frame` (JPEG base64 + taille), `status`, `done` (connexion
 *   détectée et session enregistrée), `closed` (fenêtre fermée sans connexion) ;
 * - `cloud:input:<id>` (API → worker) : `input` (événement souris / clavier / texte déjà validé),
 *   `hello` (un client vient de se brancher : renvoyer la dernière image), `cancel`.
 *
 * Aucun contenu d'événement clavier n'est journalisé ni gardé : il traverse Redis en pub/sub
 * (jamais stocké) et seul le worker le transmet à Chromium. Le ticket n'apparaît jamais ici : la
 * file ne porte que l'identifiant de la fenêtre.
 */

export const CLOUD_LOGIN_QUEUE = "selio-cloud-login";
export const CLOUD_LOGIN_JOB = "cloud.login";

export const cloudScreenChannel = (loginSessionId: string) => `cloud:screen:${loginSessionId}`;
export const cloudInputChannel = (loginSessionId: string) => `cloud:input:${loginSessionId}`;
const socketLockKey = (loginSessionId: string) => `cloud:login:ws:${loginSessionId}`;

const coord = z.number().finite().min(0).max(16384);
const modifiers = z.number().int().min(0).max(15).optional();

/**
 * Messages du navigateur du client (donnée non fiable) : validation stricte, types et bornes ;
 * toute clé inconnue est refusée. Mêmes bornes que `loginInputEventSchema` de @selio/cloud, qui
 * revalide côté worker avant de transmettre à Chromium.
 */
export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mouse"),
      action: z.enum(["move", "down", "up", "wheel"]),
      x: coord,
      y: coord,
      button: z.enum(["none", "left", "middle", "right"]).optional(),
      clickCount: z.number().int().min(0).max(3).optional(),
      deltaX: z.number().finite().min(-4096).max(4096).optional(),
      deltaY: z.number().finite().min(-4096).max(4096).optional(),
      modifiers,
    })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      action: z.enum(["down", "up"]),
      key: z.string().min(1).max(32),
      code: z.string().max(32).optional(),
      keyCode: z.number().int().min(0).max(255).optional(),
      text: z.string().max(8).optional(),
      modifiers,
    })
    .strict(),
  /** Texte collé (presse-papiers du client), borné. */
  z.object({ type: z.literal("text"), text: z.string().min(1).max(256) }).strict(),
  /** Le client ferme la fenêtre sans se connecter. */
  z.object({ type: z.literal("cancel") }).strict(),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
export type LoginInputMessage = Exclude<WsClientMessage, { type: "cancel" }>;

/** Messages publiés par le worker (source de confiance, revalidés pour ne relayer que des champs connus). */
export const workerScreenMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("frame"), data: z.string().min(1).max(4_000_000).regex(/^[A-Za-z0-9+/=]+$/), width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384) }),
  z.object({ type: z.literal("status"), status: z.enum(["starting", "open"]) }),
  z.object({ type: z.literal("done") }),
  /**
   * `vinted_signal` : Vinted a affiché un CAPTCHA, un blocage, un avertissement ou « trop de requêtes »
   * pendant la connexion (fenêtre fermée, rien enregistré, compte en pause) ; `navigation_refused` : la
   * page est allée hors de Vinted et des fournisseurs de connexion (fenêtre fermée).
   */
  z.object({ type: z.literal("closed"), reason: z.enum(["expired", "cancelled", "error", "no_session", "unavailable", "vinted_signal", "navigation_refused"]) }),
]);
export type WorkerScreenMessage = z.infer<typeof workerScreenMessageSchema>;

export type RelayInputMessage = { type: "input"; event: LoginInputMessage } | { type: "hello" } | { type: "cancel" };

export interface CloudRelay {
  /** Met en file l'ouverture de la fenêtre par le worker (identifiant seulement, jamais le ticket). */
  enqueueLogin(loginSessionId: string): Promise<void>;
  publishInput(loginSessionId: string, message: RelayInputMessage): Promise<void>;
  /** Abonne un récepteur aux messages du worker ; renvoie la fonction de désabonnement. */
  subscribeScreen(loginSessionId: string, onMessage: (raw: string) => void): Promise<() => Promise<void>>;
  /** Une seule WebSocket par fenêtre (toutes instances de l'API confondues) : jeton du verrou ou null. */
  acquireSocket(loginSessionId: string, ttlMs: number): Promise<string | null>;
  releaseSocket(loginSessionId: string, token: string): Promise<void>;
  close(): Promise<void>;
}

const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Relais Redis : une connexion d'abonnement partagée par toutes les fenêtres ouvertes sur cette instance. */
export function createRedisCloudRelay(redisUrl: string, loginQueue: Queue, logger: { warn: (m: string) => void }): CloudRelay {
  const pub = new IORedis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  pub.on("error", (e) => logger.warn(`redis (cloud) : ${e.message}`));
  let sub: IORedis | null = null;
  let subReady: Promise<IORedis> | null = null;
  const listeners = new Map<string, Set<(raw: string) => void>>();

  let pubReady: Promise<void> | null = null;
  const publisher = async () => {
    if (pub.status === "wait") {
      pubReady ??= pub.connect().catch((err: unknown) => {
        pubReady = null;
        throw err;
      });
    }
    if (pubReady) await pubReady;
    return pub;
  };
  const subscriber = () => {
    subReady ??= (async () => {
      const s = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
      s.on("error", (e) => logger.warn(`redis (cloud, abonnement) : ${e.message}`));
      s.on("message", (channel: string, raw: string) => {
        for (const cb of listeners.get(channel) ?? []) {
          try {
            cb(raw);
          } catch {
            // un récepteur défaillant n'empêche pas les autres
          }
        }
      });
      await s.connect();
      sub = s;
      return s;
    })().catch((err: unknown) => {
      subReady = null;
      throw err;
    });
    return subReady;
  };

  return {
    async enqueueLogin(loginSessionId) {
      await loginQueue.add(CLOUD_LOGIN_JOB, { loginSessionId }, { jobId: loginSessionId, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    },
    async publishInput(loginSessionId, message) {
      await (await publisher()).publish(cloudInputChannel(loginSessionId), JSON.stringify(message));
    },
    async subscribeScreen(loginSessionId, onMessage) {
      const channel = cloudScreenChannel(loginSessionId);
      const s = await subscriber();
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await s.subscribe(channel);
      }
      set.add(onMessage);
      let done = false;
      return async () => {
        if (done) return;
        done = true;
        const current = listeners.get(channel);
        current?.delete(onMessage);
        if (current && current.size === 0) {
          listeners.delete(channel);
          await s.unsubscribe(channel).catch(() => {});
        }
      };
    },
    async acquireSocket(loginSessionId, ttlMs) {
      const token = randomBytes(16).toString("hex");
      const ok = await (await publisher()).set(socketLockKey(loginSessionId), token, "PX", Math.max(1_000, Math.round(ttlMs)), "NX");
      return ok === "OK" ? token : null;
    },
    async releaseSocket(loginSessionId, token) {
      await (await publisher()).eval(RELEASE_LOCK, 1, socketLockKey(loginSessionId), token);
    },
    async close() {
      listeners.clear();
      sub?.disconnect();
      pub.disconnect();
    },
  };
}

/** Masque le ticket de la fenêtre de connexion dans une URL journalisée (`?ticket=…`). */
export function maskSecretsInUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/([?&]ticket=)[^&#]*/gi, "$1[masqué]");
}
