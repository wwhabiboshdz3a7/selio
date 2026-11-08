import type { FastifyInstance } from "fastify";
import type { Plan } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, admin, isFinanceAuditAction, requireAction, seesFinances, supervision, withOrg } from "@selio/core";
import type { QueueStatsProvider } from "@selio/core";

export default async function miscRoutes(app: FastifyInstance, opts: { queues: QueueStatsProvider; redisPing: () => Promise<number | null>; version: string }) {
  // Démarrage du processus : durée de fonctionnement de /api/health.
  const startedAt = new Date(Date.now() - Math.round(process.uptime() * 1000));
  const healthDeps = { version: opts.version, startedAt, redis: opts.redisPing, queues: opts.queues };
  /**
   * Santé publique (supervision, sondes) : base, Redis, file de tâches, version, durée de fonctionnement.
   * Aucun secret, aucun message d'erreur ni adresse interne. 503 si un composant est en panne.
   */
  app.get("/api/health", async (_req, reply) => {
    const h = await supervision.healthReport(app.services, healthDeps);
    reply.header("cache-control", "no-store");
    if (!h.ok) reply.status(503);
    return { ok: h.ok, status: h.status, version: h.version, uptimeSeconds: h.uptimeSeconds, checkedAt: h.checkedAt, checks: h.checks };
  });
  /** Détail pour les opérateurs : latences, files, état de chaque cible supervisée et dernières vérifications. */
  app.get("/api/health/details", async (req, reply) => {
    const ctx = app.requireCtx(req);
    if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
    const [health, queues, checks] = await Promise.all([
      supervision.healthReport(app.services, healthDeps),
      opts.queues().catch(() => []),
      supervision.supervisionDetails(app.services, { perTarget: Number((req.query as { perTarget?: string }).perTarget ?? 20) || 20 }),
    ]);
    reply.header("cache-control", "no-store");
    return { health, queues, supervision: { failuresBeforeAlert: supervision.SUPERVISION_FAILURES_BEFORE_ALERT, reminderMinutes: supervision.SUPERVISION_REMINDER_MINUTES, ...checks } };
  });
  app.get("/api/status", async (req) => {
    app.requireCtx(req);
    return admin.serviceStatus(app.services, { redis: opts.redisPing });
  });
  /**
   * Journal d'audit de l'organisation (« org.read »). Pour un rôle sans « finances.read » (exécuteur), les
   * entrées de facturation, de parrainage et de changement d'offre sont retirées (montants, numéros de
   * facture, moyen de paiement) ; les autres passent par le masquage habituel (amountCents, totalCents…).
   */
  app.get("/api/audit", async (req) => {
    const ctx = app.requireCtx(req);
    requireAction(ctx, "org.read");
    const list = await withOrg(ctx, (tx) => repos.audit.list(tx, Math.min(500, Number((req.query as { limit?: string }).limit ?? 100))));
    return seesFinances(ctx.role) ? list : list.filter((a) => !isFinanceAuditAction(a.action));
  });
  app.get("/api/admin/overview", async (req) => admin.adminOverview(app.requireCtx(req), { queues: opts.queues, redis: opts.redisPing }));
  app.post<{ Params: { id: string } }>("/api/admin/orgs/:id/plan", async (req, reply) => { await admin.adminSetPlan(app.requireCtx(req), req.params.id, (req.body as { plan: Plan }).plan); reply.status(204); });
  app.get("/api/admin/audit", async (req) => admin.adminAudit(app.requireCtx(req), Number((req.query as { limit?: string }).limit ?? 100)));
  // Utilisation par client (compteurs du mois, pourcentage, alerte à 80 %) : opérateurs seulement.
  app.get("/api/admin/usage", async (req) => admin.adminUsage(app.requireCtx(req)));
}
