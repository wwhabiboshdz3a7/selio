import type { FastifyInstance } from "fastify";
import { customers } from "@selio/core";

export default async function customerRoutes(app: FastifyInstance) {
  app.get("/api/customers", async (req) => customers.listCustomers(app.requireCtx(req), req.query));
  app.post("/api/customers", async (req, reply) => { reply.status(201); return customers.createCustomer(app.requireCtx(req), req.body); });
  app.get<{ Params: { id: string } }>("/api/customers/:id/timeline", async (req) => customers.getCustomerTimeline(app.requireCtx(req), req.params.id));
  app.patch<{ Params: { id: string } }>("/api/customers/:id", async (req) => customers.updateCustomer(app.requireCtx(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>("/api/customers/:id/merge", async (req) => customers.mergeCustomers(app.requireCtx(req), req.params.id, String((req.body as { mergeId?: string })?.mergeId ?? "")));
}
