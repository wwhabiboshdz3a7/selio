import type { FastifyInstance } from "fastify";
import { repos } from "@selio/db";
import { admin, withOrg } from "@selio/core";
import type { QueueStatsProvider } from "@selio/core";

export default async function miscRoutes(app: FastifyInstance, opts: { queues: QueueStatsProvider; redisPing: () => Promise<number | null>; version: string }) {
  app.get("/api/health", async () => ({ ok: true, version: opts.version, checkedAt: app.services.now().toISOString() }));
  app.get("/api/status", async (req) => {
    app.requireCtx(req);
    return admin.serviceStatus(app.services, { redis: opts.redisPing });
  });
  app.get("/api/audit", async (req) => withOrg(app.requireCtx(req), (tx) => repos.audit.list(tx, Math.min(500, Number((req.query as { limit?: string }).limit ?? 100)))));
  app.get("/api/admin/overview", async (req) => admin.adminOverview(app.requireCtx(req), { queues: opts.queues, redis: opts.redisPing }));
  app.post<{ Params: { id: string } }>("/api/admin/orgs/:id/plan", async (req, reply) => { await admin.adminSetPlan(app.requireCtx(req), req.params.id, (req.body as { plan: "free" | "starter" | "pro" }).plan); reply.status(204); });
  app.get("/api/admin/audit", async (req) => admin.adminAudit(app.requireCtx(req), Number((req.query as { limit?: string }).limit ?? 100)));
}
