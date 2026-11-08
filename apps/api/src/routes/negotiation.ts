import type { FastifyInstance } from "fastify";
import { SUGGESTED_KEYWORD_SITUATIONS, matchSituation } from "@selio/domain";
import { keywordSituation } from "@selio/contracts";
import { bundles, negotiation } from "@selio/core";
import { z } from "zod";

/**
 * Négociation avancée (§5.12) et lots intelligents (§5.14) :
 * - limites de Vinted : lecture (valeurs effectives, statut « à mesurer » ou mesure datée, protocole) et
 *   enregistrement d'une mesure faite à la main (administrateur de l'organisation, ou opérateur ; portée
 *   « global » pour toute l'équipe : opérateur seulement) ;
 * - situations par mots-clés : exemples proposés et test d'un message (comparaison seulement, aucune décision) ;
 * - propositions de lots (le vendeur décide, rien n'est envoyé).
 */
const situationTest = z.object({ text: z.string().max(2000), situations: z.array(keywordSituation).max(50).optional() });

export default async function negotiationRoutes(app: FastifyInstance) {
  app.get("/api/negotiation/limits", async (req) => negotiation.getLimits(app.requireCtx(req)));
  app.post("/api/negotiation/limits", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const view = await negotiation.recordLimits(app.requireCtx(req), req.body);
    reply.status(201);
    return view;
  });
  // Chemin du client web (Paramètres › Limites Vinted) : même enregistrement, portée de l'organisation, rend les limites appliquées.
  app.post("/api/org/vinted-limits", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    return (await negotiation.recordLimits(app.requireCtx(req), { ...body, scope: "org" })).limits;
  });
  app.get("/api/negotiation/situations/suggested", async (req) => {
    app.requireCtx(req);
    return { situations: SUGGESTED_KEYWORD_SITUATIONS };
  });
  /** Test d'un message contre des situations (celles fournies, sinon un tableau vide) : comparaison seulement. */
  app.post("/api/negotiation/situations/test", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    app.requireCtx(req);
    const parsed = situationTest.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { code: "validation", message: "Test invalide", details: parsed.error.flatten() };
    }
    const match = matchSituation(parsed.data.text, parsed.data.situations ?? []);
    return { match: match ? { id: match.situation.id, name: match.situation.name, matchedKeywords: match.matchedKeywords, escalate: match.situation.decisionOverride === "escalate" } : null };
  });
  app.get("/api/bundles/suggest", async (req) => bundles.suggestBundles(app.requireCtx(req)));
  // Chemin du client web : la liste des propositions seulement.
  app.get("/api/items/bundles", async (req) => (await bundles.suggestBundles(app.requireCtx(req))).suggestions);
}
