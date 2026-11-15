import type { FastifyInstance } from "fastify";
import { activity, preferences } from "@selio/core";

/**
 * Selio Manager : journal d'activité (lu dans les traces existantes, rôles et finances respectés) et
 * préférences de l'utilisateur connecté (raccourcis). Les préférences vivent sous /api/auth/ : elles
 * appartiennent à la personne, quel que soit son rôle (contributeur photos compris, pour son dock).
 */
export default async function activityRoutes(app: FastifyInstance) {
  app.get("/api/activity", async (req) => activity.listActivity(app.requireCtx(req), req.query ?? {}));
  app.get("/api/auth/preferences", async (req) => preferences.getPreferences(app.services, app.requireCtx(req).userId));
  app.patch("/api/auth/preferences", async (req) => preferences.updatePreferences(app.services, app.requireCtx(req).userId, req.body ?? {}));
}
