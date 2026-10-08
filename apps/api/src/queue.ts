import { Queue, type QueueOptions } from "bullmq";
import IORedis from "ioredis";
import type { QueueStats } from "@selio/core";

export const QUEUE_NAMES = ["selio-automation", "selio-sync", "selio-maintenance"] as const;

export interface QueueHandle {
  connection: IORedis | null;
  queues: Map<string, Queue>;
  stats: () => Promise<QueueStats[]>;
  ping: () => Promise<number | null>;
  close: () => Promise<void>;
}

/** Connexion Redis optionnelle : sans REDIS_URL, l'API fonctionne en mode inline (pas de worker). */
export function createQueues(redisUrl: string | undefined, logger: { warn: (m: string) => void }): QueueHandle {
  if (!redisUrl) {
    return { connection: null, queues: new Map(), stats: async () => QUEUE_NAMES.map((name) => ({ name, waiting: 0, active: 0, failed: 0, completed: 0, paused: true })), ping: async () => null, close: async () => {} };
  }
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true, enableOfflineQueue: false });
  connection.on("error", (e) => logger.warn(`redis : ${e.message}`));
  const opts: QueueOptions = { connection };
  const queues = new Map(QUEUE_NAMES.map((n) => [n, new Queue(n, opts)]));
  return {
    connection,
    queues,
    stats: async () => {
      const out: QueueStats[] = [];
      for (const [name, q] of queues) {
        try {
          const c = await q.getJobCounts("waiting", "active", "failed", "completed", "delayed");
          out.push({ name, waiting: (c.waiting ?? 0) + (c.delayed ?? 0), active: c.active ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0, paused: await q.isPaused() });
        } catch {
          out.push({ name, waiting: 0, active: 0, failed: 0, completed: 0, paused: true });
        }
      }
      return out;
    },
    ping: async () => {
      const started = Date.now();
      if (connection.status === "wait") await connection.connect();
      await connection.ping();
      return Date.now() - started;
    },
    close: async () => {
      for (const q of queues.values()) await q.close();
      connection.disconnect();
    },
  };
}
