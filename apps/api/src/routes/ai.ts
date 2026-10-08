import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { repos } from "@selio/db";
import { AppError, withOrg } from "@selio/core";

export default async function aiRoutes(app: FastifyInstance, opts: { healthToken?: string }) {
  app.get("/api/ai/status", async (req) => { app.requireCtx(req); return app.services.ai.status(); });
  app.get("/api/ai/requests", async (req) => withOrg(app.requireCtx(req), (tx) => repos.aiRequests.list(tx, 50)));
  /** Endpoint de santé IA protégé par jeton (supervision), avec métriques. */
  app.get("/api/ai/health", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const given = req.headers["x-health-token"];
    const ok = typeof given === "string" && opts.healthToken && given.length === opts.healthToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(opts.healthToken));
    if (!ok) throw new AppError("unauthorized", "Jeton de santé requis.", 401);
    const health = await app.services.ai.health();
    return { ...health, metrics: app.services.ai.metrics.snapshot(), queue: app.services.ai.queue.snapshot(), circuit: app.services.ai.breaker.snapshot() };
  });
}
