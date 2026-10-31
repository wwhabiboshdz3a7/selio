import type { FastifyInstance } from "fastify";
import { orgUpdate, type Role } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, org as orgService, radar, requireAction, withOrg } from "@selio/core";

export default async function orgRoutes(app: FastifyInstance) {
  /**
   * Paramètres de l'organisation. Les réglages de Selio Radar (`settings.radar`) et de Radar Auto
   * (`settings.autoBuy`) passent par `radar.updateRadarSettings` : droits propres (Radar Auto : propriétaire),
   * verrou serveur à l'activation (RADAR_AUTO_ENABLED, mention de l'adresse partagée), date et auteur de
   * l'activation enregistrés par le serveur. Le reste suit le chemin habituel.
   */
  app.patch("/api/org", async (req) => {
    const ctx = app.requireCtx(req);
    const body = req.body && typeof req.body === "object" ? (req.body as { name?: unknown; settings?: unknown }) : {};
    const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? { ...(body.settings as Record<string, unknown>) } : null;
    if (!settings || (!("radar" in settings) && !("autoBuy" in settings))) return orgService.updateOrg(ctx, req.body);
    const { radar: radarSettings, autoBuy, ...rest } = settings;
    const restBody = { ...(body.name !== undefined ? { name: body.name } : {}), settings: rest };
    const hasRest = body.name !== undefined || Object.keys(rest).length > 0;
    // Le reste est vérifié (droits, schéma) avant d'enregistrer quoi que ce soit : pas de mise à jour à moitié faite.
    if (hasRest) {
      requireAction(ctx, "org.update");
      const parsed = orgUpdate.safeParse(restBody);
      if (!parsed.success) throw new AppError("validation", "Paramètres invalides", 400, parsed.error.flatten());
    }
    await radar.updateRadarSettings(ctx, { ...(radarSettings !== undefined ? { radar: radarSettings } : {}), ...(autoBuy !== undefined ? { autoBuy } : {}) });
    if (hasRest) return orgService.updateOrg(ctx, restBody);
    return withOrg(ctx, (tx) => repos.orgs.byId(tx, ctx.orgId));
  });
  app.delete("/api/org", async (req, reply) => {
    await orgService.deleteOrganization(app.requireCtx(req), String((req.body as { confirmName?: string })?.confirmName ?? ""));
    reply.clearCookie("selio_session", { path: "/" });
    reply.status(204);
  });
  app.get("/api/org/members", async (req) => orgService.listMembers(app.requireCtx(req)));
  // Invitation : chaque appel envoie un email (aller-retour SMTP hors transaction) → 20 par quart d'heure et par adresse IP.
  app.post("/api/org/members", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => { reply.status(201); return orgService.inviteMember(app.requireCtx(req), req.body); });
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
