import type { FastifyInstance } from "fastify";
import { connections } from "@selio/core";

export default async function connectionRoutes(app: FastifyInstance) {
  app.get("/api/connectors", async () => connections.describe());
  app.get("/api/connections", async (req) => connections.listConnections(app.requireCtx(req)));
  app.post("/api/connections", async (req, reply) => { reply.status(201); return connections.createConnection(app.requireCtx(req), req.body); });
  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (req) => connections.testConnection(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/connections/:id/sync", async (req) => connections.syncConnection(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/connections/:id/disconnect", async (req) => connections.disconnectConnection(app.requireCtx(req), req.params.id));
  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (req, reply) => { await connections.deleteConnection(app.requireCtx(req), req.params.id); reply.status(204); });
  app.get("/api/extension-tokens", async (req) => connections.listTokens(app.requireCtx(req)));
  app.post("/api/extension-tokens", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => { reply.status(201); return connections.createToken(app.requireCtx(req), String((req.body as { label?: string })?.label ?? "")); });
  app.delete<{ Params: { id: string } }>("/api/extension-tokens/:id", async (req, reply) => { await connections.revokeToken(app.requireCtx(req), req.params.id); reply.status(204); });
}
