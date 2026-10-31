import type { FastifyInstance } from "fastify";
import { help } from "@selio/core";

/**
 * Assistant d'aide. Décision (docs/DECISIONS.md, D16) : la route exige une session.
 * La vitrine publique ne l'appelle pas : elle répond par recherche locale sur la même FAQ
 * (packages/domain/help), sans IA anonyme (coût, abus, file Ollama partagée avec les
 * organisations). Débit limité à 10 questions par minute et par adresse.
 */
export default async function helpRoutes(app: FastifyInstance) {
  app.post("/api/help/ask", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = app.requireCtx(req);
    const controller = new AbortController();
    req.raw.on("close", () => { if (req.raw.destroyed) controller.abort(); });
    return help.askHelp(ctx, req.body, controller.signal);
  });
}
