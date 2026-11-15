import type { FastifyInstance, FastifyRequest } from "fastify";
import { adminAccounts } from "@selio/core";

/**
 * Selio Admin (back-office des fondateurs) : tableau de croissance, comptes (liste, fiche), qualification et
 * note interne, accès offert, prolongation d'essai. Opérateurs « business » et « tech » (matrice des droits de
 * @selio/domain, gardes dans @selio/core) ; un non-opérateur reçoit 403. Chaque action est journalisée
 * dans le journal du compte (`admin.*`, acteur, avant/après).
 */

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

type WithId = { Params: { id: string } };

export default async function adminAccountsRoutes(app: FastifyInstance) {
  app.get("/api/admin/growth", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return adminAccounts.adminGrowth(app.requireCtx(req));
  });
  app.get("/api/admin/accounts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return adminAccounts.listAccounts(app.requireCtx(req), req.query ?? {});
  });
  app.get<WithId>("/api/admin/accounts/:id", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return adminAccounts.getAccount(app.requireCtx(req), req.params.id);
  });
  const write = perUser("admin-accounts", 60, "1 minute");
  app.post<WithId>("/api/admin/accounts/:id/qualification", { config: write }, async (req) => adminAccounts.qualifyAccount(app.requireCtx(req), req.params.id, req.body));
  app.post<WithId>("/api/admin/accounts/:id/note", { config: write }, async (req) => adminAccounts.setAccountNote(app.requireCtx(req), req.params.id, req.body));
  app.post<WithId>("/api/admin/accounts/:id/grant", { config: write }, async (req) => adminAccounts.grantAccess(app.requireCtx(req), req.params.id, req.body));
  app.delete<WithId>("/api/admin/accounts/:id/grant", { config: write }, async (req) => adminAccounts.revokeAccess(app.requireCtx(req), req.params.id));
  app.post<WithId>("/api/admin/accounts/:id/extend-trial", { config: write }, async (req) => adminAccounts.extendTrial(app.requireCtx(req), req.params.id, req.body));
}
