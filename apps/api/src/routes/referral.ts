import type { FastifyInstance } from "fastify";
import { AppError, referral } from "@selio/core";

/**
 * Parrainage « un mois offert aux deux » (§5.15). Tant que REFERRAL_ENABLED est faux, toutes les routes
 * répondent 404 (ni code ni page). Code et statut : titulaire et administrateurs ; mois offerts (finances) :
 * qui voit les finances. Aucune donnée sur les organisations filleules au-delà de leur nombre par état.
 */
export default async function referralRoutes(app: FastifyInstance) {
  const requireEnabled = () => {
    if (!referral.referralEnabled(app.services)) throw new AppError("not_found", "Le parrainage n'est pas ouvert pour le moment.", 404);
  };
  app.get("/api/referral", async (req) => {
    const ctx = app.requireCtx(req);
    requireEnabled();
    return referral.getOverview(ctx);
  });
  app.get("/api/referral/credits", async (req) => {
    const ctx = app.requireCtx(req);
    requireEnabled();
    return referral.listCredits(ctx);
  });
}
