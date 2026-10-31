import { access, constants } from "node:fs/promises";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { BrowserSlots, PlaywrightRunner, PurchaseRunner, RadarReader, probeChromium, sweepStaleProfiles, type CloudLogger } from "@selio/cloud";
import { createAIService } from "@selio/ai";
import { createPaymentProvider, loadPaymentConfig, paymentStartupNotices } from "@selio/connectors";
import { Db, SecretBox, createPool } from "@selio/db";
import type { Services } from "@selio/core";
import { createEmailProvider, emailStartupWarnings, loadEmailConfig } from "@selio/email";
import { cloudDrainMs, cloudLoginConcurrency, cloudProfileMaxAgeMs, cloudRunnable, cloudServicesConfig, disabledSchedules, loadEnv, maintenanceSchedules, radarBrowsingMaxMs, radarServicesConfig } from "./config";
import { CLOUD_LOGIN_JOB, CLOUD_LOGIN_QUEUE, CloudTickRunner, RunnerCloudExecutor, cloudLoginTask, cloudTick, createRedisLoginBus } from "./cloud";
import { WebPushSender, loadVapidConfig } from "./push";
import { CloudOffRadarReader, CloudPurchaseAdapter, CloudRadarReader, PageRateLimiter, RADAR_QUEUE, RADAR_RESUME_JOB, SingleFlight, alertsTick, radarAutoTick, radarResumeTask, radarTick, type AlertsTickSummary, type RadarAutoTickSummary, type RadarTickSummary } from "./radar";
import { automationTick, connectorSyncTick, processJobs, renewSubscriptions, retentionTick } from "./tasks";

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
    config: { ...cloudServicesConfig(env), ...radarServicesConfig(env) },
  };
  // Notifications Web Push (alertes Radar) : sans clés VAPID, les alertes restent en file.
  const vapid = loadVapidConfig(env);
  if (vapid) services.push = new WebPushSender(vapid);
  log.info({ push: Boolean(vapid), radarAuto: env.RADAR_AUTO_ENABLED, realPurchase: env.RADAR_AUTO_ENABLED && env.RADAR_REAL_PURCHASE, maxPagesPerMinute: env.RADAR_MAX_PAGES_PER_MINUTE_GLOBAL }, vapid ? "Radar : notifications Web Push activées" : "Radar : notifications Web Push désactivées (clés VAPID absentes) — alertes laissées en file");
  if (env.RADAR_AUTO_ENABLED) log.warn({ orgs: env.RADAR_AUTO_ORG_IDS.length }, "Radar Auto OUVERT côté serveur (RADAR_AUTO_ENABLED=true), réservé aux comptes de l'équipe ; achat réel " + (env.RADAR_REAL_PURCHASE ? "ouvert" : "fermé (essai à blanc, D11)"));

  // Selio Cloud : un seul runner Playwright, des créneaux de navigateurs partagés entre les actions
  // et les fenêtres de connexion (CLOUD_MAX_BROWSERS, dont au plus CLOUD_MAX_BROWSERS - 1 pour les
  // fenêtres). Sans CLOUD_ENABLED ni Chromium, ou si Chromium ne démarre pas avec son bac à sable : désactivé.
  let runner: PlaywrightRunner | null = null;
  let cloudLog: CloudLogger | null = null;
  if (cloudRunnable(env)) {
    const chromiumOk = await access(env.CLOUD_CHROMIUM_PATH!, constants.X_OK).then(() => true, () => false);
    // Le worker est seul sur CLOUD_PROFILE_DIR : au démarrage, tout dossier de travail restant vient
    // d'un processus arrêté (quel que soit son âge) et est supprimé.
    const swept = await sweepStaleProfiles(env.CLOUD_PROFILE_DIR, 0);
    const probe = chromiumOk ? await probeChromium({ chromiumPath: env.CLOUD_CHROMIUM_PATH!, sandbox: env.CLOUD_CHROMIUM_SANDBOX, workBaseDir: env.CLOUD_PROFILE_DIR }) : null;
    if (!chromiumOk) {
      log.warn({ path: env.CLOUD_CHROMIUM_PATH }, "Cloud désactivé : CLOUD_CHROMIUM_PATH n'est pas un exécutable");
    } else if (!probe?.ok) {
      log.error({ reason: probe?.reason }, `Cloud désactivé : ${probe?.message ?? "Chromium indisponible"}`);
    } else {
      if (!env.CLOUD_CHROMIUM_SANDBOX) log.warn({}, "Cloud : bac à sable de Chromium DÉSACTIVÉ (développement seulement, refusé en production)");
      // Journal du runner : type d'action, code, hôte — jamais de session ni d'événement clavier.
      cloudLog = { info: (m, d) => log.info(d ?? {}, m), warn: (m, d) => log.warn(d ?? {}, m) };
      runner = new PlaywrightRunner({
        chromiumPath: env.CLOUD_CHROMIUM_PATH!,
        headless: env.CLOUD_HEADLESS,
        actionTimeoutMs: env.CLOUD_ACTION_TIMEOUT_MS,
        loginTimeoutMs: env.CLOUD_LOGIN_TIMEOUT_MS,
        // Créneaux partagés : actions du Cloud, fenêtres de connexion, pages lues et achats de Radar.
        maxBrowsers: new BrowserSlots(env.CLOUD_MAX_BROWSERS),
        heavyActions: env.CLOUD_HEAVY_ACTIONS,
        sandbox: env.CLOUD_CHROMIUM_SANDBOX,
        // Dossiers de travail de Radar (lecture de page, achat) : même dossier, même balayage.
        profileBaseDir: env.CLOUD_PROFILE_DIR,
        // Un navigateur d'achat peut attendre la validation 3-D Secure du client (CLOUD_3DS_TIMEOUT_MS).
        maxBrowsingMs: radarBrowsingMaxMs(env),
        logger: cloudLog,
      });
      log.info(
        { maxBrowsers: env.CLOUD_MAX_BROWSERS, loginWindows: cloudLoginConcurrency(env.CLOUD_MAX_BROWSERS), heavyActions: env.CLOUD_HEAVY_ACTIONS, activeHours: env.CLOUD_ACTIVE_HOURS, sandbox: env.CLOUD_CHROMIUM_SANDBOX, chromium: probe.version, swept },
        "Cloud activé (50 navigateurs simultanés : hypothèse à mesurer)",
      );
    }
  } else {
    log.info({}, "Cloud désactivé (CLOUD_ENABLED=true et CLOUD_CHROMIUM_PATH requis)");
  }
  const executor = runner ? new RunnerCloudExecutor(runner, env.CLOUD_PROFILE_DIR) : null;

  // Selio Radar : lecture en direct et achat par le même navigateur (mêmes créneaux que le Cloud), depuis
  // le compte Achat seulement (vérifié par le cœur). Sans Cloud : seules les recherches du simulateur sont lues.
  // Plafond global de pages par minute de la machine : lectures ET pages ouvertes par les achats.
  const limiter = new PageRateLimiter(env.RADAR_MAX_PAGES_PER_MINUTE_GLOBAL);
  const purchases = runner
    ? new CloudPurchaseAdapter(
        new PurchaseRunner({
          opener: runner,
          // Verrou serveur repris par le navigateur : sans RADAR_AUTO_ENABLED ET RADAR_REAL_PURCHASE, essai à blanc seulement (D11).
          realPurchaseAllowed: env.RADAR_AUTO_ENABLED && env.RADAR_REAL_PURCHASE,
          threeDsTimeoutMs: env.CLOUD_3DS_TIMEOUT_MS,
          purchaseTimeoutMs: env.RADAR_PURCHASE_TIMEOUT_MS,
          ...(cloudLog ? { logger: cloudLog } : {}),
        }),
        log,
        limiter,
        () => services.now(),
      )
    : null;
  services.radar = runner
    ? { reader: new CloudRadarReader(new RadarReader({ fetcher: runner, pageBudgetMs: env.RADAR_PAGE_BUDGET_MS, ...(cloudLog ? { logger: cloudLog } : {}) }), log), ...(purchases ? { purchaser: purchases } : {}) }
    : { reader: new CloudOffRadarReader() };
  const radarTicks: SingleFlight<RadarTickSummary> = new SingleFlight("radar.tick", () => radarTick(services, log, { liveEnabled: runner !== null, limiter, concurrency: env.CLOUD_MAX_BROWSERS, shouldStop: () => radarTicks.stopping, purchases }), log, (r) => {
    if (r.liveReads || r.demoReads || r.blocked || r.errors || r.expired3ds) log.info({ name: "radar.tick", ...r }, "radar : passage");
  });
  const alertTicks: SingleFlight<AlertsTickSummary> = new SingleFlight("alerts.send", () => alertsTick(services, log), log, (r) => {
    if (r.sent || r.failed || r.expired || r.errors) log.info({ name: "alerts.send", ...r }, "alertes : passage");
  });
  const autoTicks: SingleFlight<RadarAutoTickSummary> = new SingleFlight("radar.auto", () => radarAutoTick(services, log, { shouldStop: () => autoTicks.stopping }), log, (r) => {
    if (r.bought || r.awaiting3ds || r.errors) log.info({ name: "radar.auto", ...r }, "radar auto : passage");
  });
  const profiles = { baseDir: env.CLOUD_PROFILE_DIR, maxAgeMs: cloudProfileMaxAgeMs(env) };
  const cloudTicks: CloudTickRunner = new CloudTickRunner(() => cloudTick(services, log, { executor, concurrency: env.CLOUD_MAX_BROWSERS, shouldStop: () => cloudTicks.stopping, profiles }), log);
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", (e) => log.warn({ err: e }, "redis"));

  const maintenance = new Queue("selio-maintenance", { connection });
  for (const s of maintenanceSchedules(env)) {
    // Un seul planning par nom : upsert idempotent (BullMQ Job Scheduler), cron ou intervalle (radar.tick : 30 s).
    const repeat = "every" in s ? { every: s.every } : { pattern: s.pattern };
    await maintenance.upsertJobScheduler(s.name, repeat, { name: s.name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } });
  }
  // Radar Auto fermé : son planning d'un démarrage précédent est retiré.
  for (const name of disabledSchedules(env)) await maintenance.removeJobScheduler(name).catch(() => false);

  const worker = new Worker(
    "selio-maintenance",
    async (job: Job) => {
      const started = Date.now();
      let result: unknown;
      switch (job.name) {
        case "automation.tick": result = await automationTick(services, log); break;
        case "jobs.process": result = await processJobs(services, log); break;
        case "connector.sync": result = await connectorSyncTick(services, log); break;
        // Passages de Radar lancés sans retenir la file (un seul à la fois chacun ; ils journalisent leur bilan).
        case "radar.tick": result = radarTicks.trigger(); break;
        case "alerts.send": result = alertTicks.trigger(); break;
        case "radar.auto": result = env.RADAR_AUTO_ENABLED ? autoTicks.trigger() : { started: false }; break;
        case "retention.cleanup": result = await retentionTick(services, log); break;
        case "billing.renew": result = await renewSubscriptions(services, log); break;
        // Passage du Cloud lancé sans retenir la file (un seul à la fois ; il journalise son bilan).
        case "cloud.tick": result = cloudTicks.trigger(); break;
        default: log.warn({ name: job.name }, "tâche inconnue"); return null;
      }
      log.info({ name: job.name, result, ms: Date.now() - started }, "tâche terminée");
      return result;
    },
    { connection, concurrency: 1, lockDuration: 120_000 },
  );
  worker.on("failed", (job, err) => log.error({ name: job?.name, err }, "tâche en échec"));

  // Fenêtres de connexion du Cloud (job ajouté par l'API au POST login) : au plus CLOUD_MAX_BROWSERS - 1 à la
  // fois sur la machine (un créneau reste toujours aux actions), 2 par organisation (limite du cœur).
  const loginBus = createRedisLoginBus(env.REDIS_URL, log);
  const loginWorker = new Worker(
    CLOUD_LOGIN_QUEUE,
    async (job: Job) => {
      if (job.name !== CLOUD_LOGIN_JOB) return null;
      const id = typeof job.data?.loginSessionId === "string" ? job.data.loginSessionId : "";
      const r = await cloudLoginTask(services, { runner, bus: loginBus, profileBaseDir: env.CLOUD_PROFILE_DIR, loginTimeoutMs: env.CLOUD_LOGIN_TIMEOUT_MS }, id, log);
      return { outcome: r.outcome };
    },
    { connection, concurrency: cloudLoginConcurrency(env.CLOUD_MAX_BROWSERS), lockDuration: 120_000 },
  );
  loginWorker.on("failed", (job, err) => log.error({ name: job?.name, error: err.name }, "cloud : fenêtre de connexion en échec"));

  // Reprise d'un achat Radar Auto après la validation 3-D Secure (job ajouté par l'API) : le navigateur
  // tenu ouvert vit dans ce processus. Jamais retentée automatiquement (attempts: 1 côté API).
  const radarWorker = new Worker(
    RADAR_QUEUE,
    async (job: Job) => {
      if (job.name !== RADAR_RESUME_JOB) return null;
      return radarResumeTask(services, job.data, log);
    },
    { connection, concurrency: 2, lockDuration: 120_000 },
  );
  radarWorker.on("failed", (job, err) => log.error({ name: job?.name, error: err.name }, "radar : reprise en échec"));
  const health = await services.ai.health();
  log.info({ provider: health.provider, model: health.model, status: health.status }, `worker démarré · IA : ${health.message}`);

  const shutdown = async (signal: string) => {
    log.info(`arrêt (${signal})`);
    // Plus aucune nouvelle action Cloud ; celle en cours se termine (son résultat, et surtout un signal de
    // Vinted, est enregistré). Attente : CLOUD_ACTION_TIMEOUT_MS + marge (TimeoutStopSec / stop_grace_period
    // sont réglés au-delà, voir deploy/).
    cloudTicks.stop();
    radarTicks.stop();
    autoTicks.stop();
    alertTicks.stop();
    await worker.close();
    // Fenêtres de connexion et reprises 3-D Secure : attente bornée (le client se reconnectera ; les fenêtres
    // restées ouvertes en base expirent, les dossiers de travail restants sont supprimés au prochain démarrage).
    await Promise.race([Promise.all([loginWorker.close(), radarWorker.close()]), new Promise((r) => setTimeout(r, 10_000))]);
    // Action Cloud, lecture ou achat Radar en cours : leur résultat (et surtout un signal de Vinted) est
    // enregistré. Attentes en parallèle, bornées par la plus longue (action ou achat + marge, sous 150 s).
    await Promise.all([
      cloudTicks.drain(cloudDrainMs(env.CLOUD_ACTION_TIMEOUT_MS)),
      radarTicks.drain(env.RADAR_PAGE_BUDGET_MS + 15_000),
      autoTicks.drain(env.RADAR_PURCHASE_TIMEOUT_MS + 15_000),
      alertTicks.drain(15_000),
    ]);
    // Navigateurs tenus ouverts pour une validation 3-D Secure : fermés (les demandes expireront, avec alerte).
    await purchases?.closeAll();
    await loginBus.close();
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
