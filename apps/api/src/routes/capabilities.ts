import type { FastifyInstance } from "fastify";
import { capabilities } from "@selio/core";

/**
 * GET /api/capabilities (public, sans session ni secret) : ce qui est réellement branché sur ce serveur (Track en
 * direct, Cloud, Radar en direct, vision, modèle de prix, paiement réel ou simulé, emails). L'application le lit
 * pour afficher « En cours d'activation » au lieu de chiffres simulés. Un frontal plus récent que l'API reçoit
 * un 404 ici : il sait alors que le serveur n'est pas à jour.
 */
export default async function capabilitiesRoutes(app: FastifyInstance, opts: { trackLive: boolean; cloud: boolean }) {
  app.get("/api/capabilities", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return capabilities.serverCapabilities(app.services, { trackLive: opts.trackLive, cloud: opts.cloud });
  });
}
