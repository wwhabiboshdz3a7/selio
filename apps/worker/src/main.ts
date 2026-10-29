import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { createAIService } from "@selio/ai";
import { createPaymentProvider, loadPaymentConfig, paymentStartupNotices } from "@selio/connectors";
import { Db, SecretBox, createPool } from "@selio/db";
import type { Services } from "@selio/core";
import { createEmailProvider, emailStartupWarnings, loadEmailConfig } from "@selio/email";
import { loadEnv } from "./config";
import { automationTick, connectorSyncTick, processJobs, radarTick, renewSubscriptions, retentionTick } from "./tasks";

/**
 * Worker Selio : tâches planifiées et traitements asynchrones (BullMQ/Redis).
 * - Chaque tick est un job répétable BullMQ (idempotent : un seul job par cadence).
 * - Les tâches métier sont persistées dans la table `jobs` (état observable,
 *   clé d'idempotence, tentatives) ; BullMQ ne sert qu'au déclenchement.
 */
async function main() {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL, ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}) });
  // Paiement (Revolut) et emails : mêmes variables que l'API ; sans clé, les échéances sont lues mais aucun débit n'est tenté.
  const paymentConfig = loadPaymentConfig(env);
  const emailConfig = loadEmailConfig(env);
  for (const n of paymentStartupNotices(paymentConfig, env.NODE_ENV)) log[n.level](n.message);
  for (const m of emailStartupWarnings(emailConfig, env.NODE_ENV)) log.warn(m);
  const services: Services = {
    db: new Db(createPool(env.DATABASE_URL, { max: 5 })),
    ai: createAIService({ config: env, allowFallback: env.ALLOW_AI_FALLBACK }),
    secrets: new SecretBox(env.SECRETS_ENCRYPTION_KEY),
    now: () => new Date(),
    allowAiFallback: env.ALLOW_AI_FALLBACK,
    version: "0.1.0",
    email: createEmailProvider(emailConfig, { logger: log }),
    publicWebUrl: env.PUBLIC_WEB_URL,
    payments: createPaymentProvider(paymentConfig, { logger: log }),
    billing: { franchiseTva: env.FRANCHISE_TVA },
  };
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", (e) => log.warn({ err: e }, "redis"));

  const maintenance = new Queue("selio-maintenance", { connection });
  const schedules: { name: string; pattern: string }[] = [
    { name: "automation.tick", pattern: env.CRON_AUTOMATION_TICK },
    { name: "jobs.process", pattern: env.CRON_JOBS_PROCESS },
    { name: "connector.sync", pattern: env.CRON_CONNECTOR_SYNC },
    { name: "radar.tick", pattern: env.CRON_RADAR },
    { name: "retention.cleanup", pattern: env.CRON_RETENTION },
    { name: "billing.renew", pattern: env.CRON_BILLING_RENEW },
  ];
  for (const s of schedules) {
    // Un seul planning par nom : upsert idempotent (BullMQ Job Scheduler).
    await maintenance.upsertJobScheduler(s.name, { pattern: s.pattern }, { name: s.name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } });
  }

  const worker = new Worker(
    "selio-maintenance",
    async (job: Job) => {
      const started = Date.now();
      let result: unknown;
      switch (job.name) {
        case "automation.tick": result = await automationTick(services, log); break;
        case "jobs.process": result = await processJobs(services, log); break;
        case "connector.sync": result = await connectorSyncTick(services, log); break;
        case "radar.tick": result = await radarTick(services, log); break;
        case "retention.cleanup": result = await retentionTick(services); break;
        case "billing.renew": result = await renewSubscriptions(services, log); break;
        default: log.warn({ name: job.name }, "tâche inconnue"); return null;
      }
      log.info({ name: job.name, result, ms: Date.now() - started }, "tâche terminée");
      return result;
    },
    { connection, concurrency: 1, lockDuration: 120_000 },
  );
  worker.on("failed", (job, err) => log.error({ name: job?.name, err }, "tâche en échec"));
  const health = await services.ai.health();
  log.info({ provider: health.provider, model: health.model, status: health.status }, `worker démarré · IA : ${health.message}`);

  const shutdown = async (signal: string) => {
    log.info(`arrêt (${signal})`);
    await worker.close();
    await maintenance.close();
    connection.disconnect();
    await services.db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
