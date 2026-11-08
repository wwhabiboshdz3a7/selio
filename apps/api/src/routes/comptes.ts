import type { FastifyInstance, FastifyRequest } from "fastify";
import { comptes } from "@selio/core";

/**
 * Selio Comptes (ex « Générateur », §5.15) : checklist de mise en place d'une boutique Vinted, progression
 * (cases cochées par organisation) et textes à recopier rédigés par mon IA perso (quota IA). Aucune route
 * n'agit sur Vinted : ni compte créé, ni connexion, ni appel vers Vinted.
 */
function abortOnClose(req: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  req.raw.on("close", () => { if (req.raw.destroyed) controller.abort(); });
  return controller.signal;
}

export default async function comptesRoutes(app: FastifyInstance) {
  app.get("/api/comptes/checklist", async (req) => comptes.getChecklist(app.requireCtx(req)));
  app.get("/api/comptes/progress", async (req) => comptes.getProgress(app.requireCtx(req)));
  app.post("/api/comptes/progress", async (req) => comptes.setProgress(app.requireCtx(req), req.body ?? {}));
  // Une requête IA par appel (décomptée du quota) : 20 par minute et par adresse IP au plus.
  app.post("/api/comptes/texts", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => comptes.generateTexts(app.requireCtx(req), req.body ?? {}, abortOnClose(req)));
}
