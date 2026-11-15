import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { repos } from "@selio/db";
import { AppError, adminAccounts, auth, connections as connectionsService, type OrgContext, type Services } from "@selio/core";

export const SESSION_COOKIE = "selio_session";

declare module "fastify" {
  interface FastifyRequest {
    sessionInfo: auth.SessionInfo | null;
    orgCtx: OrgContext | null;
    extScopes: string[] | null;
  }
  interface FastifyInstance {
    services: Services;
    requireCtx: (req: FastifyRequest) => OrgContext;
  }
}

/** Adresses qui restent ouvertes (sans contexte) à un membre d'un compte bloqué : se déconnecter, se reconnecter, santé. */
const OPEN_WHEN_BLOCKED = ["/api/auth/logout", "/api/auth/login", "/api/auth/register", "/api/health"];

export function clientIp(req: FastifyRequest): string | null {
  return req.ip ?? null;
}

/** Résout la session (cookie) ou le jeton d'extension (Authorization: Bearer) en contexte d'organisation. */
export default fp(async function authPlugin(app: FastifyInstance, opts: { services: Services }) {
  app.decorate("services", opts.services);
  app.decorateRequest("sessionInfo", null);
  app.decorateRequest("orgCtx", null);
  app.decorateRequest("extScopes", null);

  app.addHook("onRequest", async (req) => {
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : null;
    if (bearer && req.url.startsWith("/api/ext/")) {
      const tok = await connectionsService.authenticateToken(opts.services, bearer);
      if (!tok) throw new AppError("unauthorized", "Jeton d'extension invalide, expiré ou révoqué.", 401);
      const m = await opts.services.db.withGlobal((tx) => repos.memberships.get(tx, tok.orgId, tok.userId));
      if (!m) throw new AppError("unauthorized", "Le jeton ne correspond plus à un membre actif.", 401);
      const access = await adminAccounts.sessionAccess(opts.services, tok.userId, tok.orgId);
      if (access.blocked) throw adminAccounts.accountBlockedError();
      req.orgCtx = { services: opts.services, orgId: tok.orgId, userId: tok.userId, role: m.role, isOperator: access.operatorRole !== null, operatorRole: access.operatorRole, ip: clientIp(req) };
      req.extScopes = tok.scopes;
      return;
    }
    const sid = req.cookies[SESSION_COOKIE];
    if (!sid) return;
    const session = await auth.resolveSession(opts.services, sid);
    if (!session) return;
    req.sessionInfo = session;
    if (!session.orgId) return;
    const m = await opts.services.db.withGlobal((tx) => repos.memberships.get(tx, session.orgId!, session.userId));
    if (!m) return;
    // Rôle d'opérateur recalculé depuis la configuration (OPERATOR_EMAILS, OPERATOR_BUSINESS_EMAILS) à chaque
    // requête ; compte qualifié « bloqué » : session refusée (sauf opérateur), la déconnexion reste possible.
    const access = await adminAccounts.sessionAccess(opts.services, session.userId, session.orgId);
    if (access.blocked) {
      if (OPEN_WHEN_BLOCKED.some((p) => req.url.startsWith(p))) return;
      throw adminAccounts.accountBlockedError();
    }
    req.orgCtx = { services: opts.services, orgId: session.orgId, userId: session.userId, role: m.role, isOperator: access.operatorRole !== null, operatorRole: access.operatorRole, ip: clientIp(req) };
  });

  app.decorate("requireCtx", (req: FastifyRequest): OrgContext => {
    if (!req.orgCtx) throw new AppError("unauthorized", "Authentification requise.", 401);
    return req.orgCtx;
  });
});
