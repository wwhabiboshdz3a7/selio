import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { beta, type Services } from "@selio/core";

/**
 * Fin du mois de bêta sans moyen de paiement : l'API refuse les actions métier (pas seulement l'interface) avec
 * 402 `beta_ended` et un message clair. Les lectures restent permises (les données sont conservées et l'écran de
 * blocage de l'application n'ouvre que l'abonnement, les factures et l'export).
 *
 * Restent ouvertes, même bloqué : la session (connexion, déconnexion, changement d'organisation, mot de passe),
 * l'abonnement et le paiement (`/api/billing/…`, code promo), l'accès bêta lui-même (écran de bienvenue), les
 * notifications (désabonnement à la déconnexion), Selio Admin (opérateurs), et la suppression de l'organisation
 * (droit à l'effacement). Une requête de plus seulement pour les écritures d'un compte connecté.
 */
const OPEN_PREFIXES = ["/api/auth/", "/api/billing/", "/api/beta", "/api/offers/", "/api/admin/", "/api/push/", "/api/health", "/api/capabilities"];
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function betaGateApplies(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  const path = url.split("?")[0] ?? url;
  if (OPEN_PREFIXES.some((p) => path === p || path.startsWith(p))) return false;
  // Supprimer l'organisation (Paramètres › Données) reste possible.
  if (method.toUpperCase() === "DELETE" && path === "/api/org") return false;
  return true;
}

export default fp(async function betaGatePlugin(app: FastifyInstance, opts: { services: Services }) {
  // Après l'authentification (enregistrée avant) : le contexte d'organisation est connu ici.
  app.addHook("onRequest", async (req) => {
    const ctx = req.orgCtx;
    if (!ctx || !betaGateApplies(req.method, req.url)) return;
    const since = await beta.betaBlockedSince(opts.services, ctx.orgId);
    if (since) throw beta.betaEndedError(since);
  });
});
