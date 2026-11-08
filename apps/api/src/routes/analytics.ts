import type { FastifyInstance } from "fastify";
import { analytics } from "@selio/core";

export default async function analyticsRoutes(app: FastifyInstance) {
  app.get("/api/analytics/overview", async (req) => analytics.getOverview(app.requireCtx(req), (req.query as { period?: string }).period));
  app.get("/api/analytics", async (req) => analytics.getAnalytics(app.requireCtx(req), req.query as Record<string, unknown>));
  /** Marge de bout en bout (prix d'achat Radar ou saisi → revente). */
  for (const url of ["/api/analytics/margin", "/api/analytics/margins"]) app.get(url, async (req) => analytics.getMargin(app.requireCtx(req), req.query as Record<string, unknown>));
  /** Seuils de déclaration des plateformes (30 ventes ou 2 000 € par an, paramétrables) : information, jamais un conseil fiscal. */
  for (const url of ["/api/thresholds", "/api/analytics/thresholds"]) app.get(url, async (req) => analytics.getThresholds(app.requireCtx(req)));
  app.get("/api/analytics/export.csv", async (req, reply) => {
    const csv = await analytics.exportAnalyticsCsv(app.requireCtx(req), req.query as Record<string, unknown>);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=selio-analyses.csv");
    return csv;
  });
}
