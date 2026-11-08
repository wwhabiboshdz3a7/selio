import type { FastifyInstance } from "fastify";
import { analytics } from "@selio/core";
import { requireFinances } from "../plugins/roles";

export default async function analyticsRoutes(app: FastifyInstance) {
  app.get("/api/analytics/overview", async (req) => analytics.getOverview(app.requireCtx(req), (req.query as { period?: string }).period));
  app.get("/api/analytics", async (req) => analytics.getAnalytics(app.requireCtx(req), req.query as Record<string, unknown>));
  /**
   * Marge de bout en bout (prix d'achat Radar ou saisi → revente) : la page n'est faite que de finances, 403
   * explicite pour l'exécuteur et le contributeur photos (les autres analyses leur arrivent masquées).
   */
  for (const url of ["/api/analytics/margin", "/api/analytics/margins"]) {
    app.get(url, async (req) => {
      const ctx = app.requireCtx(req);
      requireFinances(ctx);
      return analytics.getMargin(ctx, req.query as Record<string, unknown>);
    });
  }
  /** Seuils de déclaration des plateformes (30 ventes ou 2 000 € par an, paramétrables) : information, jamais un conseil fiscal. */
  // Le texte, les ratios et ce qu'il reste avant le seuil permettent de recalculer le chiffre d'affaires de
  // l'année : réservés aux rôles qui voient les finances (l'alerte de la vue d'ensemble a un texte sans montant).
  for (const url of ["/api/thresholds", "/api/analytics/thresholds"]) {
    app.get(url, async (req) => {
      const ctx = app.requireCtx(req);
      requireFinances(ctx);
      return analytics.getThresholds(ctx);
    });
  }
  app.get("/api/analytics/export.csv", async (req, reply) => {
    const csv = await analytics.exportAnalyticsCsv(app.requireCtx(req), req.query as Record<string, unknown>);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=selio-analyses.csv");
    return csv;
  });
}
