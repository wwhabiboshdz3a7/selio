import type { FastifyInstance } from "fastify";
import type { Shipment } from "@selio/contracts";
import { orders } from "@selio/core";

export default async function orderRoutes(app: FastifyInstance) {
  app.get("/api/orders", async (req) => orders.listOrders(app.requireCtx(req), req.query));
  app.post("/api/orders", async (req, reply) => { const r = await orders.createOrder(app.requireCtx(req), req.body); reply.status(r.created ? 201 : 200); return r; });
  app.get<{ Params: { id: string } }>("/api/orders/:id", async (req) => orders.getOrder(app.requireCtx(req), req.params.id));
  app.patch<{ Params: { id: string } }>("/api/orders/:id", async (req) => orders.updateOrder(app.requireCtx(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>("/api/orders/:id/transition", async (req) => orders.transition(app.requireCtx(req), req.params.id, req.body));
  app.patch<{ Params: { id: string } }>("/api/orders/:id/shipment", async (req) => orders.updateShipment(app.requireCtx(req), req.params.id, (req.body ?? {}) as Partial<Pick<Shipment, "carrier" | "trackingNumber" | "status">>));
  app.post<{ Params: { id: string } }>("/api/orders/:id/shipping-document", async (req) => orders.requestShippingDocument(app.requireCtx(req), req.params.id));
}
