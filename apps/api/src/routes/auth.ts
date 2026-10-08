import type { FastifyInstance } from "fastify";
import { AppError, auth, org as orgService } from "@selio/core";
import { SESSION_COOKIE } from "../plugins/auth";

export default async function authRoutes(app: FastifyInstance, opts: { cookieSecure: boolean; operatorEmails: string[] }) {
  const cookieOpts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: opts.cookieSecure, maxAge: 30 * 86_400 };
  const sessionOf = async (req: Parameters<typeof app.requireCtx>[0]) => orgService.getSession(app.requireCtx(req));

  app.post("/api/auth/register", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const s = await auth.register(app.services, req.body, { ip: req.ip, userAgent: req.headers["user-agent"]?.slice(0, 200) ?? null, operatorEmails: opts.operatorEmails });
    reply.setCookie(SESSION_COOKIE, s.sessionId, cookieOpts);
    reply.status(201);
    return bootstrapSession(app, req, s.orgId!, s);
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const s = await auth.login(app.services, req.body, { ip: req.ip, userAgent: req.headers["user-agent"]?.slice(0, 200) ?? null });
    reply.setCookie(SESSION_COOKIE, s.sessionId, cookieOpts);
    if (!s.orgId) throw new AppError("forbidden", "Ce compte n'appartient à aucune organisation.", 403);
    return bootstrapSession(app, req, s.orgId, s);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) await auth.logout(app.services, sid);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.status(204);
  });

  app.get("/api/auth/session", async (req) => {
    if (!req.orgCtx) return null;
    return sessionOf(req);
  });

  app.post("/api/auth/switch-org", async (req) => {
    if (!req.sessionInfo) throw new AppError("unauthorized", "Authentification requise.", 401);
    const { orgId } = (req.body ?? {}) as { orgId?: string };
    if (!orgId) throw new AppError("validation", "orgId requis", 400);
    const s = await auth.switchOrg(app.services, req.sessionInfo, orgId);
    return bootstrapSession(app, req, orgId, s);
  });

  app.post("/api/auth/password", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    await auth.changePassword(app.services, ctx.userId, (req.body ?? {}) as { current?: string; next?: string });
    reply.status(204);
  });
}

/** Construit le contexte juste après connexion (le hook onRequest a tourné avant la pose du cookie). */
async function bootstrapSession(app: FastifyInstance, req: Parameters<typeof app.requireCtx>[0], orgId: string, s?: auth.SessionInfo) {
  const { repos } = await import("@selio/db");
  const userId = s?.userId ?? req.sessionInfo?.userId;
  if (!userId) throw new AppError("unauthorized", "Session introuvable", 401);
  const m = await app.services.db.withGlobal((tx) => repos.memberships.get(tx, orgId, userId));
  const user = await app.services.db.withGlobal((tx) => repos.users.byId(tx, userId));
  if (!m) throw new AppError("forbidden", "Aucune appartenance à cette organisation.", 403);
  req.orgCtx = { services: app.services, orgId, userId, role: m.role, isOperator: user.isOperator, ip: req.ip };
  return orgService.getSession(req.orgCtx);
}
