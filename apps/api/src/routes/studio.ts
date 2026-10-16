import type { FastifyInstance } from "fastify";
import { dressing, market, studio } from "@selio/core";

/** Générateur d'annonces, dressing intelligent et analyse des revendeurs. */
export default async function studioRoutes(app: FastifyInstance) {
  // Photos compressées côté navigateur (~300 Ko chacune, 12 au plus).
  app.post("/api/studio/generate", { bodyLimit: 20 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const controller = new AbortController();
    req.raw.on("close", () => { if (req.raw.destroyed) controller.abort(); });
    return studio.generateListing(app.requireCtx(req), req.body, controller.signal);
  });
  app.get("/api/dressing", async (req) => dressing.getDressing(app.requireCtx(req), req.query as Record<string, unknown>));
  app.post<{ Params: { id: string } }>("/api/items/:id/republish", async (req) => dressing.republishItem(app.requireCtx(req), req.params.id, (req.body as { variantId?: unknown } | null)?.variantId));
  app.get("/api/market/insights", async (req) => market.getMarketInsights(app.requireCtx(req), req.query as Record<string, unknown>));
}
