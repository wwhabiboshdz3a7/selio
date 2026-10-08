import type { FastifyInstance } from "fastify";
import type { Opportunity } from "@selio/contracts";
import { radar } from "@selio/core";

export default async function radarRoutes(app: FastifyInstance) {
  app.get("/api/radar/searches", async (req) => radar.listSearches(app.requireCtx(req)));
  app.post("/api/radar/searches", async (req, reply) => { reply.status(201); return radar.createSearch(app.requireCtx(req), req.body); });
  app.patch<{ Params: { id: string } }>("/api/radar/searches/:id", async (req) => radar.updateSearch(app.requireCtx(req), req.params.id, (req.body ?? {}) as Record<string, unknown>));
  app.delete<{ Params: { id: string } }>("/api/radar/searches/:id", async (req, reply) => { await radar.deleteSearch(app.requireCtx(req), req.params.id); reply.status(204); });
  app.post<{ Params: { id: string } }>("/api/radar/searches/:id/run", async (req) => radar.runSearch(app.requireCtx(req), req.params.id));
  app.get("/api/radar/opportunities", async (req) => radar.listOpportunities(app.requireCtx(req), req.query as { searchId?: string; status?: string }));
  app.post<{ Params: { id: string } }>("/api/radar/opportunities/:id/status", async (req) => radar.setOpportunityStatus(app.requireCtx(req), req.params.id, (req.body as { status: Opportunity["status"] }).status));
  app.get("/api/purchases", async (req) => radar.listPurchases(app.requireCtx(req)));
  app.post("/api/purchases", async (req, reply) => { reply.status(201); return radar.createPurchase(app.requireCtx(req), (req.body ?? {}) as { opportunityId?: string; maxPriceCents?: number; budgetCents?: number }); });
  app.post<{ Params: { id: string } }>("/api/purchases/:id/confirm", async (req) => radar.confirmPurchase(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/purchases/:id/cancel", async (req) => radar.cancelPurchase(app.requireCtx(req), req.params.id));
}
