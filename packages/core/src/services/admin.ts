import type { Plan } from "@selio/contracts";
import { repos } from "@selio/db";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, type OrgContext, type Services } from "../context";
import type { AdminOverview, ServiceStatus } from "../types-data";

export interface QueueStats { name: string; waiting: number; active: number; failed: number; completed: number; paused: boolean }
export type QueueStatsProvider = () => Promise<QueueStats[]>;

export async function serviceStatus(services: Services, extra: { redis?: () => Promise<number | null> } = {}): Promise<ServiceStatus[]> {
  const at = services.now().toISOString();
  const out: ServiceStatus[] = [];
  try {
    const ms = await services.db.ping();
    out.push({ name: "Base de données", ok: true, status: "ok", message: "PostgreSQL joignable", latencyMs: ms, checkedAt: at });
  } catch (e) {
    out.push({ name: "Base de données", ok: false, status: "down", message: (e as Error).message, latencyMs: null, checkedAt: at });
  }
  if (extra.redis) {
    try {
      const ms = await extra.redis();
      out.push(ms === null ? { name: "File de tâches (Redis)", ok: true, status: "inline", message: "Redis non configuré : exécution inline des tâches", latencyMs: null, checkedAt: at } : { name: "File de tâches (Redis)", ok: true, status: "ok", message: "Redis joignable", latencyMs: ms, checkedAt: at });
    } catch (e) {
      out.push({ name: "File de tâches (Redis)", ok: false, status: "down", message: (e as Error).message, latencyMs: null, checkedAt: at });
    }
  }
  const ai = await services.ai.status();
  out.push({ name: "Assistant IA", ok: ai.status === "healthy" || ai.status === "mock", status: ai.status, message: ai.message, latencyMs: ai.latencyMs, checkedAt: at });
  out.push({ name: "Connecteur Vinted", ok: false, status: "experimental", message: "Non vérifié en réel : nécessite l'extension et une validation navigateur", latencyMs: null, checkedAt: at });
  return out;
}

export async function adminOverview(ctx: OrgContext, deps: { queues: QueueStatsProvider; redis?: () => Promise<number | null> }): Promise<AdminOverview> {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
  const services = ctx.services;
  const orgs = await services.db.withGlobal((tx) => repos.admin.orgSummary(tx));
  const since = new Date(services.now().getTime() - 86_400_000).toISOString();
  const ai = await services.ai.status();
  const metrics = services.ai.metrics.snapshot();
  const byOrg: AdminOverview["ai"]["byOrg"] = [];
  const errors: AdminOverview["errors"] = [];
  const connectorsCount: Record<string, { connections: number; byStatus: Record<string, number> }> = { demo: { connections: 0, byStatus: {} }, vinted: { connections: 0, byStatus: {} } };
  let requests24h = 0, failures24h = 0, tokens24h = 0;
  for (const o of orgs) {
    await services.db.withOrg(o.id, async (tx) => {
      const reqs = (await repos.aiRequests.list(tx, 200)).filter((r) => r.createdAt >= since);
      requests24h += reqs.length;
      failures24h += reqs.filter((r) => r.status !== "succeeded").length;
      tokens24h += reqs.reduce((s, r) => s + r.promptTokens + r.outputTokens, 0);
      byOrg.push({ orgId: o.id, orgName: o.name, requests: reqs.length });
      for (const j of await repos.jobs.recentErrors(tx, 5)) errors.push({ at: j.updatedAt, source: `job ${j.kind}`, message: j.error!, orgId: o.id });
      for (const c of await repos.connections.list(tx)) { const e = connectorsCount[c.provider]!; e.connections++; e.byStatus[c.status] = (e.byStatus[c.status] ?? 0) + 1; }
    });
  }
  return {
    services: await serviceStatus(services, { redis: deps.redis }),
    queues: await deps.queues(),
    connectors: Object.entries(connectorsCount).map(([provider, v]) => ({ provider, ...v })),
    ai: { status: ai, requests24h, failures24h, tokens24h: tokens24h + metrics.promptTokens * 0, byOrg: byOrg.sort((a, b) => b.requests - a.requests).slice(0, 20) },
    errors: errors.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
    orgs: orgs.map((o) => ({ ...o, plan: o.plan as Plan })),
    plans: (["free", "starter", "pro"] as const).map((plan) => ({ plan, quotas: PLAN_QUOTAS[plan], orgCount: orgs.filter((o) => o.plan === plan).length })),
  };
}

export async function adminSetPlan(ctx: OrgContext, orgId: string, plan: Plan): Promise<void> {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
  if (!(plan in PLAN_QUOTAS)) throw new AppError("validation", "Plan inconnu", 400);
  await ctx.services.db.withGlobal((tx) => repos.orgs.byId(tx, orgId));
  await ctx.services.db.withOrg(orgId, async (tx) => {
    await repos.subscriptions.upsert(tx, { plan, quotas: PLAN_QUOTAS[plan] });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "admin.plan_changed", targetType: "organization", targetId: orgId, meta: { plan }, ip: ctx.ip });
  });
}

export async function adminAudit(ctx: OrgContext, limit: number) {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
  return ctx.services.db.withGlobal((tx) => tx.query("select * from audit_logs where action like 'admin.%' or action like 'auth.%' or action like 'token.%' or action like 'connection.%' order by created_at desc limit $1", [Math.min(500, limit)]));
}

/** Nettoyage selon les durées de conservation de chaque organisation (worker quotidien). */
export async function retentionCleanup(services: Services): Promise<{ orgs: number; messages: number; audit: number; ai: number; sessions: number }> {
  const orgs = await services.db.withGlobal((tx) => repos.admin.orgSummary(tx));
  let messages = 0, audit = 0, ai = 0;
  for (const o of orgs) {
    const org = await services.db.withGlobal((tx) => repos.orgs.byId(tx, o.id));
    await services.db.withOrg(o.id, async (tx) => {
      messages += await repos.messages.purgeOlderThan(tx, org.settings.retentionDays.messages);
      audit += await repos.audit.purgeOlderThan(tx, org.settings.retentionDays.auditLogs);
      ai += await repos.aiRequests.purgeOlderThan(tx, org.settings.retentionDays.aiRequests);
    });
  }
  const sessions = await services.db.withGlobal((tx) => repos.sessions.purgeExpired(tx));
  return { orgs: orgs.length, messages, audit, ai, sessions };
}
