import type { FastifyInstance } from "fastify";
import { analytics } from "@selio/core";

export default async function analyticsRoutes(app: FastifyInstance) {
  app.get("/api/analytics/overview", async (req) => analytics.getOverview(app.requireCtx(req), (req.query as { period?: string }).period));
  app.get("/api/analytics", async (req) => analytics.getAnalytics(app.requireCtx(req), req.query as Record<string, unknown>));
  app.get("/api/analytics/export.csv", async (req, reply) => {
    const csv = await analytics.exportAnalyticsCsv(app.requireCtx(req), req.query as Record<string, unknown>);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=selio-analyses.csv");
    return csv;
  });
}
