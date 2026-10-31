import type { FastifyInstance } from "fastify";
import { automation } from "@selio/core";

export default async function automationRoutes(app: FastifyInstance) {
  app.get("/api/automations/rules", async (req) => automation.listRules(app.requireCtx(req)));
  app.post("/api/automations/rules", async (req, reply) => { reply.status(201); return automation.createRule(app.requireCtx(req), req.body); });
  app.patch<{ Params: { id: string } }>("/api/automations/rules/:id", async (req) => automation.updateRule(app.requireCtx(req), req.params.id, (req.body ?? {}) as Record<string, unknown>));
  app.delete<{ Params: { id: string } }>("/api/automations/rules/:id", async (req, reply) => { await automation.deleteRule(app.requireCtx(req), req.params.id); reply.status(204); });
  app.post<{ Params: { id: string } }>("/api/automations/rules/:id/run", async (req) => automation.runRuleNow(app.requireCtx(req), req.params.id));
  app.get("/api/automations/state", async (req) => automation.getState(app.requireCtx(req)));
  app.post("/api/automations/pause", async (req) => automation.setGlobalPause(app.requireCtx(req), Boolean((req.body as { paused?: boolean })?.paused)));
  app.get("/api/automations/jobs", async (req) => automation.listJobs(app.requireCtx(req), req.query));
  app.post<{ Params: { id: string } }>("/api/automations/jobs/:id/approve", async (req) => automation.approveJob(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/automations/jobs/:id/cancel", async (req) => automation.cancelJob(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/automations/jobs/:id/retry", async (req) => automation.retryJob(app.requireCtx(req), req.params.id));
}
