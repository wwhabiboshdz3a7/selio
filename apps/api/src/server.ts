import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { createAIService } from "@selio/ai";
import { Db, SecretBox, createPool } from "@selio/db";
import { wornPhotos, type Services } from "@selio/core";
import { createPaymentProvider, loadPaymentConfig } from "@selio/connectors";
import { createEmailProvider, loadEmailConfig, type EmailLogger } from "@selio/email";
import { createStorageClient, loadStorageConfig } from "@selio/storage";
import { cloudServicesConfig, radarServicesConfig, referralServicesConfig, startupNotices, studioServicesConfig, trackServicesConfig, type ApiEnv } from "./config";
import { errorHandler } from "./errors";
import authPlugin from "./plugins/auth";
import rolesPlugin from "./plugins/roles";
import authRoutes from "./routes/auth";
import orgRoutes from "./routes/org";
import itemRoutes from "./routes/items";
import customerRoutes from "./routes/customers";
import conversationRoutes from "./routes/conversations";
import orderRoutes from "./routes/orders";
import analyticsRoutes from "./routes/analytics";
import automationRoutes from "./routes/automations";
import radarRoutes from "./routes/radar";
import connectionRoutes from "./routes/connections";
import aiRoutes from "./routes/ai";
import billingRoutes from "./routes/billing";
import miscRoutes from "./routes/misc";
import extRoutes from "./routes/ext";
import studioRoutes from "./routes/studio";
import helpRoutes from "./routes/help";
import uploadsRoutes from "./routes/uploads";
import cloudRoutes from "./routes/cloud";
import pushRoutes from "./routes/push";
import trackRoutes from "./routes/track";
import pricingRoutes from "./routes/pricing";
import adminRoutes from "./routes/admin";
import negotiationRoutes from "./routes/negotiation";
import migrationRoutes from "./routes/migration";
import referralRoutes from "./routes/referral";
import comptesRoutes from "./routes/comptes";
import { StoragePhotoStore } from "./studio-photos";
import { MAINTENANCE_QUEUE, RADAR_QUEUE, createQueues, type QueueHandle } from "./queue";
import { PRICE_MODEL_REFRESH_MS, createApiPricingServices, refreshPriceModel, schedulePriceModelRefresh } from "./pricing";
import { WebPushSender, loadVapidConfig } from "./push";
import { CLOUD_LOGIN_QUEUE, createRedisCloudRelay, maskSecretsInUrl, type CloudRelay } from "./cloud-relay";

export const API_VERSION = "0.1.0";

export interface BuiltServer {
  app: FastifyInstance;
  services: Services;
  queues: QueueHandle;
  /** Relais Redis de la fenêtre de connexion du Cloud (null sans CLOUD_ENABLED ou sans REDIS_URL). */
  cloudRelay: CloudRelay | null;
}

export function buildServices(env: ApiEnv, overrides: Partial<Services> = {}, logger?: EmailLogger): Services {
  const db = overrides.db ?? new Db(createPool(env.DATABASE_URL));
  const ai = overrides.ai ?? createAIService({ config: env, allowFallback: env.ALLOW_AI_FALLBACK });
  // Emails : « noop » (journalisé, adresse masquée) tant qu'aucun SMTP n'est configuré ; les tests injectent le leur.
  const email = overrides.email ?? createEmailProvider(loadEmailConfig(env), { logger });
  // Paiement Revolut : null sans REVOLUT_SECRET_KEY (aucune commande créée) ; les tests injectent un client à HTTP simulé.
  const payments = overrides.payments !== undefined ? overrides.payments : createPaymentProvider(loadPaymentConfig(env), { logger });
  // Notifications Web Push (alertes Radar, notification de test) : absent sans clés VAPID ; les tests injectent le leur.
  const vapid = loadVapidConfig(env);
  const push = "push" in overrides ? overrides.push : vapid ? new WebPushSender(vapid) : undefined;
  const now = overrides.now ?? (() => new Date());
  return {
    db,
    ai,
    secrets: overrides.secrets ?? new SecretBox(env.SECRETS_ENCRYPTION_KEY),
    now,
    allowAiFallback: env.ALLOW_AI_FALLBACK,
    version: API_VERSION,
    email,
    publicWebUrl: overrides.publicWebUrl ?? env.PUBLIC_WEB_URL,
    payments,
    billing: overrides.billing ?? { franchiseTva: env.FRANCHISE_TVA },
    // Réglages du Cloud (actions lourdes, comptes par organisation, navigateurs, option Pro, heures, ticket),
    // de Radar (verrous de Radar Auto, achat réel, délai 3-D Secure) et de Track (lecture en direct, analyse
    // d'un vendeur). Aucun navigateur dans l'API : `cloud`, `radar` et `track` restent absents (sauf
    // injection par les tests), seul le worker lit et achète.
    // Studio : dépassement des photos portées fermé par défaut, 0,25 € la photo (proposition), file de nuit 22 h – 6 h.
    config: overrides.config ?? { ...cloudServicesConfig(env), ...radarServicesConfig(env), ...trackServicesConfig(env), ...studioServicesConfig(env), ...referralServicesConfig(env) },
    // Modèle de prix : chargé depuis `price_models` (jamais entraîné ici) ; les tests injectent le leur.
    pricing: overrides.pricing ?? createApiPricingServices(now),
    // Photos portées : AUCUN fournisseur choisi (décision d'Ibrahim) ; « noop » refuse proprement, « mock » pour les
    // tests. L'API ne produit rien (le worker traite la file la nuit), elle enregistre seulement le fournisseur prévu.
    wornPhotos: overrides.wornPhotos ?? wornPhotos.createWornPhotoProvider(env.WORN_PHOTO_PROVIDER, { production: env.NODE_ENV === "production" }),
    ...(push ? { push } : {}),
    ...(overrides.radar ? { radar: overrides.radar } : {}),
    ...(overrides.track ? { track: overrides.track } : {}),
    // Studio : lecture des photos (modèle 1, sinon prise sur `ai`), photos stockées lues par leur clé (branché
    // dans buildServer avec le stockage), aucun réducteur d'image côté serveur (une photo trop grande est refusée).
    ...(overrides.studio ? { studio: overrides.studio } : {}),
  };
}

export interface BuildServerOptions {
  /** Rechargement du modèle de prix actif (ms) : toutes les heures par défaut ; 0 = jamais (tests). */
  priceModelRefreshMs?: number;
}

export async function buildServer(env: ApiEnv, overrides: Partial<Services> = {}, options: BuildServerOptions = {}): Promise<BuiltServer> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Journalisation sans contenu sensible : cookies, autorisations et corps ne sont jamais loggés.
      redact: { paths: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-health-token']", "res.headers['set-cookie']"], censor: "[masqué]" },
      // Le ticket de la fenêtre de connexion du Cloud (?ticket=…) n'apparaît jamais dans les journaux.
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, url: maskSecretsInUrl(req.url), host: req.host, remoteAddress: req.ip, remotePort: req.socket?.remotePort }),
      },
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}),
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });
  // Les services sont construits après l'application : le fournisseur d'email journalise via app.log.
  const services = buildServices(env, overrides, app.log);
  for (const n of startupNotices(env)) app.log[n.level](n.message);
  const queues = createQueues(env.REDIS_URL, { warn: (m) => app.log.warn(m) });
  // Stockage des photos (S3 / MinIO) : null tant que STORAGE_ENDPOINT est absent, la route répond alors 503.
  const storage = createStorageClient(loadStorageConfig(env), services.now);
  // Studio : photos envoyées par clé de stockage (`org/<org>/studio-photo/…`) lues par l'API avec une URL signée courte.
  if (storage && !services.studio?.photos) services.studio = { ...services.studio, photos: new StoragePhotoStore(storage) };
  const origins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cors, { origin: origins, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", allowList: [], keyGenerator: (req) => req.ip });
  // WebSocket de la fenêtre de connexion du Cloud : messages d'entrée courts (4 Kio au plus).
  await app.register(websocket, { options: { maxPayload: 4096 } });
  await app.register(authPlugin, { services, operatorEmails: env.OPERATOR_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) });
  // Rôles d'équipe : contributeur photos limité à sa liste de routes, finances masquées pour qui ne les voit pas.
  await app.register(rolesPlugin);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "not_found", message: `Route inconnue : ${req.method} ${req.url}` } }));

  const operatorEmails = env.OPERATOR_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  await app.register(authRoutes, { cookieSecure: env.COOKIE_SECURE, operatorEmails });
  await app.register(orgRoutes);
  await app.register(itemRoutes);
  await app.register(customerRoutes);
  await app.register(conversationRoutes);
  await app.register(orderRoutes);
  await app.register(analyticsRoutes);
  await app.register(automationRoutes);
  // Négociation avancée (limites de Vinted, situations, lots) et migration depuis un autre outil (sans connexion à celui-ci).
  await app.register(negotiationRoutes);
  await app.register(migrationRoutes);
  // Reprise d'un achat après la validation 3-D Secure : le navigateur tenu ouvert vit dans le worker (file « selio-radar »).
  await app.register(radarRoutes, { radarQueue: queues.queues.get(RADAR_QUEUE) ?? null });
  await app.register(connectionRoutes);
  await app.register(aiRoutes, { healthToken: env.AI_HEALTH_TOKEN });
  await app.register(billingRoutes);
  await app.register(miscRoutes, { queues: queues.stats, redisPing: queues.ping, version: API_VERSION });
  await app.register(extRoutes);
  await app.register(studioRoutes);
  await app.register(helpRoutes);
  await app.register(uploadsRoutes, { storage });
  // Selio Cloud : la fenêtre de connexion exige CLOUD_ENABLED et Redis (relais vers le worker).
  const loginQueue = queues.queues.get(CLOUD_LOGIN_QUEUE);
  const cloudRelay = env.CLOUD_ENABLED && env.REDIS_URL && loginQueue ? createRedisCloudRelay(env.REDIS_URL, loginQueue, { warn: (m) => app.log.warn(m) }) : null;
  await app.register(cloudRoutes, { enabled: env.CLOUD_ENABLED, relay: cloudRelay, activeHours: env.CLOUD_ACTIVE_HOURS, allowedOrigins: origins });
  // Notifications de la PWA (clé publique VAPID seulement ; la clé privée ne quitte jamais le serveur).
  const vapid = loadVapidConfig(env);
  await app.register(pushRoutes, { publicKey: vapid?.publicKey ?? null });
  // Selio Track (statistiques seulement ; aucune page lue ici) et estimation des prix.
  await app.register(trackRoutes, { liveEnabled: services.config?.trackLiveEnabled === true });
  await app.register(pricingRoutes, { maintenanceQueue: queues.queues.get(MAINTENANCE_QUEUE) ?? null, minReferences: env.PRICING_MIN_REFERENCES });
  // Administration de la base des références de tailles (Studio) : import CSV / JSON par un opérateur, sans donnée personnelle.
  await app.register(adminRoutes);
  // Parrainage (404 tant que REFERRAL_ENABLED est faux) et Selio Comptes (checklists et textes, aucune action sur Vinted).
  await app.register(referralRoutes);
  await app.register(comptesRoutes);

  // Modèle de prix actif : chargé au démarrage (jamais bloquant), puis rechargé toutes les heures (nouvel
  // entraînement du worker le dimanche).
  await refreshPriceModel(services, app.log);
  const refreshEvery = options.priceModelRefreshMs ?? PRICE_MODEL_REFRESH_MS;
  const stopPriceRefresh = refreshEvery > 0 ? schedulePriceModelRefresh(services, app.log, refreshEvery) : () => {};

  app.addHook("onClose", async () => {
    stopPriceRefresh();
    await cloudRelay?.close();
    await queues.close();
    await services.db.close();
  });
  return { app, services, queues, cloudRelay };
}
