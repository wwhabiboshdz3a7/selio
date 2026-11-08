import type { FastifyInstance } from "fastify";
import type { MarketplaceConnection } from "@selio/contracts";
import { VINTED_PRO_ACCESS_NOTE, type ConnectorAccessStatus } from "@selio/connectors";
import { connections } from "@selio/core";

/**
 * Vinted Pro (API officielle, squelette sans appel tant que l'accès n'est pas obtenu) : la connexion est
 * enregistrée « not_configured » (le statut « needs_access » n'existe pas encore dans les contrats ni en base) et
 * l'API ajoute le statut d'accès `accessStatus: "needs_access"` avec sa note, comme le test de connexion.
 */
export type ConnectionView = MarketplaceConnection & { accessStatus?: ConnectorAccessStatus; accessNote?: string };

export function withAccessStatus(c: MarketplaceConnection): ConnectionView {
  if (c.provider !== "vinted_pro" || c.status === "connected" || c.status === "disconnected") return c;
  return { ...c, accessStatus: "needs_access", accessNote: `${VINTED_PRO_ACCESS_NOTE} : aucune autre capacité tant que l'accès manque.` };
}

export default async function connectionRoutes(app: FastifyInstance) {
  app.get("/api/connectors", async () => connections.describe());
  app.get("/api/connections", async (req) => (await connections.listConnections(app.requireCtx(req))).map(withAccessStatus));
  app.post("/api/connections", async (req, reply) => { const c = await connections.createConnection(app.requireCtx(req), req.body); reply.status(201); return withAccessStatus(c); });
  app.get("/api/connections/stats", async (req) => connections.connectionStats(app.requireCtx(req)));
  app.patch<{ Params: { id: string } }>("/api/connections/:id", async (req) => withAccessStatus(await connections.updateConnection(app.requireCtx(req), req.params.id, req.body)));
  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (req) => connections.testConnection(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/connections/:id/sync", async (req) => connections.syncConnection(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/connections/:id/disconnect", async (req) => connections.disconnectConnection(app.requireCtx(req), req.params.id));
  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (req, reply) => { await connections.deleteConnection(app.requireCtx(req), req.params.id); reply.status(204); });
  app.get("/api/extension-tokens", async (req) => connections.listTokens(app.requireCtx(req)));
  app.post("/api/extension-tokens", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => { reply.status(201); return connections.createToken(app.requireCtx(req), String((req.body as { label?: string })?.label ?? "")); });
  app.delete<{ Params: { id: string } }>("/api/extension-tokens/:id", async (req, reply) => { await connections.revokeToken(app.requireCtx(req), req.params.id); reply.status(204); });
}
