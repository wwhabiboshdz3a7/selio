import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createAIService } from "@selio/ai";
import { Db, SecretBox, createPool } from "@selio/db";
import { billing, type Services } from "@selio/core";
import type { ApiEnv } from "./config";
import { errorHandler } from "./errors";
import authPlugin from "./plugins/auth";
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
import { createQueues, type QueueHandle } from "./queue";

export const API_VERSION = "0.1.0";

export interface BuiltServer {
  app: FastifyInstance;
  services: Services;
  queues: QueueHandle;
}

export function buildServices(env: ApiEnv, overrides: Partial<Services> = {}): Services {
  const db = overrides.db ?? new Db(createPool(env.DATABASE_URL));
  const ai = overrides.ai ?? createAIService({ config: env, allowFallback: env.ALLOW_AI_FALLBACK });
  return { db, ai, secrets: overrides.secrets ?? new SecretBox(env.SECRETS_ENCRYPTION_KEY), now: overrides.now ?? (() => new Date()), allowAiFallback: env.ALLOW_AI_FALLBACK, version: API_VERSION };
}

export async function buildServer(env: ApiEnv, overrides: Partial<Services> = {}): Promise<BuiltServer> {
  const services = buildServices(env, overrides);
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Journalisation sans contenu sensible : cookies, autorisations et corps ne sont jamais loggés.
      redact: { paths: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-health-token']", "res.headers['set-cookie']"], censor: "[masqué]" },
      ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}),
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });
  const queues = createQueues(env.REDIS_URL, { warn: (m) => app.log.warn(m) });
  const origins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cors, { origin: origins, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", allowList: [], keyGenerator: (req) => req.ip });
  await app.register(authPlugin, { services, operatorEmails: env.OPERATOR_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "not_found", message: `Route inconnue : ${req.method} ${req.url}` } }));

  const operatorEmails = env.OPERATOR_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const billingConfig: billing.BillingConfig = { stripeSecretKey: env.STRIPE_SECRET_KEY || undefined, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined, stripePriceIds: billing.parsePriceIds({ STRIPE_PRICE_STARTER: env.STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO: env.STRIPE_PRICE_PRO }), liveAllowed: env.STRIPE_LIVE_ALLOWED, publicWebUrl: env.PUBLIC_WEB_URL };

  await app.register(authRoutes, { cookieSecure: env.COOKIE_SECURE, operatorEmails });
  await app.register(orgRoutes);
  await app.register(itemRoutes);
  await app.register(customerRoutes);
  await app.register(conversationRoutes);
  await app.register(orderRoutes);
  await app.register(analyticsRoutes);
  await app.register(automationRoutes);
  await app.register(radarRoutes);
  await app.register(connectionRoutes);
  await app.register(aiRoutes, { healthToken: env.AI_HEALTH_TOKEN });
  await app.register(billingRoutes, { config: billingConfig });
  await app.register(miscRoutes, { queues: queues.stats, redisPing: queues.ping, version: API_VERSION });
  await app.register(extRoutes);

  app.addHook("onClose", async () => {
    await queues.close();
    await services.db.close();
  });
  return { app, services, queues };
}
