import type { FastifyInstance } from "fastify";
import type { Role } from "@selio/contracts";
import { org as orgService } from "@selio/core";

export default async function orgRoutes(app: FastifyInstance) {
  app.patch("/api/org", async (req) => orgService.updateOrg(app.requireCtx(req), req.body));
  app.delete("/api/org", async (req, reply) => {
    await orgService.deleteOrganization(app.requireCtx(req), String((req.body as { confirmName?: string })?.confirmName ?? ""));
    reply.clearCookie("selio_session", { path: "/" });
    reply.status(204);
  });
  app.get("/api/org/members", async (req) => orgService.listMembers(app.requireCtx(req)));
  app.post("/api/org/members", async (req, reply) => { reply.status(201); return orgService.inviteMember(app.requireCtx(req), req.body); });
  app.patch<{ Params: { id: string } }>("/api/org/members/:id", async (req, reply) => {
    await orgService.updateMemberRole(app.requireCtx(req), req.params.id, (req.body as { role: Role }).role);
    reply.status(204);
  });
  app.delete<{ Params: { id: string } }>("/api/org/members/:id", async (req, reply) => {
    await orgService.removeMember(app.requireCtx(req), req.params.id);
    reply.status(204);
  });
  app.post<{ Params: { step: string } }>("/api/org/onboarding/:step", async (req) => orgService.completeOnboardingStep(app.requireCtx(req), req.params.step));
  app.get("/api/data/export", async (req, reply) => {
    const data = await orgService.exportAllData(app.requireCtx(req));
    reply.header("content-type", "application/json; charset=utf-8").header("content-disposition", "attachment; filename=selio-export.json");
    return JSON.stringify(data, null, 2);
  });
}
