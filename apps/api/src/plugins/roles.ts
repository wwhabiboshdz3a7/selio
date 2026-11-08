import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError, redactForRole, seesFinances, type OrgContext } from "@selio/core";

/**
 * Rôles d'équipe côté API (§5.15), en plus des contrôles `requireAction` des services :
 *
 * 1. Contributeur photos (« photographer ») : liste BLANCHE de routes. Il lit les articles, ajoute des photos et
 *    lance le générateur (Studio), rien d'autre : toute autre route répond 403, y compris les lectures que les
 *    services ne contrôlent pas (commandes, clients, messages, analyses…) et les routes ajoutées plus tard.
 * 2. Finances masquées : pour qui n'a pas « finances.read » (exécuteur, contributeur photos), chaque réponse JSON
 *    passe par `redactForRole` (prix et frais d'achat, coûts, marges, chiffre d'affaires à null, à toute
 *    profondeur : articles, commandes, analyses, mais aussi les articles imbriqués d'une conversation, d'un
 *    client ou du dressing). Exceptions : la session et les réglages de l'organisation, et les recherches et
 *    réglages de Radar (objectifs de marge saisis par l'équipe, ce sont des réglages et non des comptes).
 * Les routes de facturation et la marge de bout en bout répondent 403 explicite (`requireFinances`).
 */

/** Routes permises au contributeur photos (méthode + motif de route Fastify). */
export const PHOTOGRAPHER_ROUTES: ReadonlySet<string> = new Set([
  // Lire les articles (contrôle d'une annonce compris : lecture seule).
  "GET /api/items",
  "GET /api/items/brands",
  "GET /api/items/:id",
  "GET /api/items/:id/history",
  "POST /api/items/:id/checks",
  // Ajouter des photos (téléversement signé, puis ajout à l'article).
  "POST /api/items/:id/photos",
  "GET /api/uploads/policy",
  "POST /api/uploads/presign",
  "GET /api/uploads/read",
  "DELETE /api/uploads/object",
  // Lancer le générateur (Studio).
  "GET /api/studio/limits",
  "POST /api/studio/prepare",
  "GET /api/studio/preps",
  "GET /api/studio/preps/:id",
  "POST /api/studio/preps/:id/validate",
  "POST /api/studio/generate",
  // Garder l'annonce générée : brouillon « en stock », sans prix d'achat ni publication.
  "POST /api/studio/drafts",
  // Commun à tous les membres : offre (fonctions disponibles, sans paiement), compteurs du mois, état du service.
  "GET /api/org/plan",
  "GET /api/billing/usage",
  "GET /api/health",
  "GET /api/status",
]);

/** Préfixes toujours permis : la session et le compte de la personne (connexion, déconnexion, mot de passe). */
const PHOTOGRAPHER_PREFIXES = ["/api/auth/"];

export const PHOTOGRAPHER_FORBIDDEN_MESSAGE = "Le rôle « Contributeur photos » permet seulement de consulter les articles, d'y ajouter des photos et de lancer le générateur.";

export function photographerAllowed(method: string, routeUrl: string): boolean {
  if (PHOTOGRAPHER_PREFIXES.some((p) => routeUrl.startsWith(p))) return true;
  return PHOTOGRAPHER_ROUTES.has(`${method.toUpperCase()} ${routeUrl}`);
}

/** Routes dont la réponse n'est pas masquée (réglages, pas des comptes) : motif exact ou préfixe suivi de « / ». */
const REDACTION_EXEMPT = ["/api/auth", "/api/org", "/api/radar/searches", "/api/radar/settings"];

export function redactionExempt(routeUrl: string): boolean {
  return REDACTION_EXEMPT.some((p) => routeUrl === p || routeUrl.startsWith(`${p}/`));
}

export const FINANCES_FORBIDDEN_MESSAGE = "Les finances (abonnement, factures, marges, chiffre d'affaires, prix d'achat) sont réservées au titulaire, aux administrateurs et à la lecture seule.";

/** 403 explicite pour qui ne voit pas les finances (exécuteur, contributeur photos). */
export function requireFinances(ctx: OrgContext): void {
  if (!seesFinances(ctx.role)) throw new AppError("finances_forbidden", FINANCES_FORBIDDEN_MESSAGE, 403);
}

function routeUrlOf(req: FastifyRequest): string | undefined {
  return req.routeOptions?.url;
}

export default fp(async function rolesPlugin(app: FastifyInstance) {
  // Après le hook d'authentification (enregistré avant) : le contexte d'organisation est connu ici.
  app.addHook("onRequest", async (req) => {
    const ctx = req.orgCtx;
    if (!ctx || ctx.role !== "photographer") return;
    const url = routeUrlOf(req);
    // Route inconnue : le 404 habituel répond.
    if (!url) return;
    if (!photographerAllowed(req.method, url)) throw new AppError("forbidden", PHOTOGRAPHER_FORBIDDEN_MESSAGE, 403);
  });

  app.addHook("preSerialization", async (req, _reply, payload) => {
    const ctx = req.orgCtx;
    if (!ctx || seesFinances(ctx.role) || payload === null || typeof payload !== "object") return payload;
    const url = routeUrlOf(req);
    if (url && redactionExempt(url)) return payload;
    return redactForRole(ctx.role, payload);
  });
});
