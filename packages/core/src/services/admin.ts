import { PLANS, aiSettings, buildUsageCounter, isPlan, quotasForPlan, resolveQuotas, type Plan, type PlanQuotas, type SubsidiaryUsage, type UsageCounter } from "@selio/contracts";
import { repos } from "@selio/db";
import { effectiveAiQuota } from "@selio/domain";
import { AppError, type OrgContext, type Services } from "../context";
import type { AdminOverview, ServiceStatus } from "../types-data";
import { subsidiaryUsageFrom, usageDayStart, usagePeriodStart } from "./billing";

/** Ligne SQL de la vue administrateur de l'utilisation (repos.admin.orgUsage). */
export type AdminOrgUsageRow = repos.AdminOrgUsageRow;

/**
 * Utilisation d'une organisation vue par l'opérateur (docs §5.2) : même forme de compteurs que
 * `billing.getUsage` (utilisé / quota / pourcentage / alerte à 80 %), plus le compteur le plus
 * avancé pour trier les clients proches de leur limite. Aucun secret, aucun détail d'article.
 */
export interface AdminOrgUsage {
  id: string;
  name: string;
  plan: Plan;
  status: string;
  createdAt: string;
  counters: { aiRequests: UsageCounter; items: UsageCounter; connections: UsageCounter; members: UsageCounter };
  studio: SubsidiaryUsage["studio"];
  track: SubsidiaryUsage["track"];
  cloud: SubsidiaryUsage["cloud"];
  /** Actions automatiques du mois (information, sans quota mensuel). */
  automationActions: number;
  /** Pourcentage du compteur le plus avancé (0–100). */
  maxPercent: number;
  /** Au moins un compteur à 80 % ou plus. */
  warning: boolean;
  /** Au moins un compteur atteint ou dépassé (fonction incluse dans l'offre). */
  exceeded: boolean;
}

export interface AdminUsageReport {
  /** Du 1er du mois (UTC) à maintenant : la date de remise à zéro de tous les compteurs mensuels. */
  period: { from: string; to: string };
  orgs: AdminOrgUsage[];
}

/**
 * Quotas effectifs d'une ligne : le JSON de l'abonnement s'il est complet (devis sur mesure compris),
 * sinon ceux du plan (ancien JSON d'avant les offres 1/3/10, organisation sans abonnement, JSON illisible).
 */
function quotasOfRow(row: Pick<AdminOrgUsageRow, "plan" | "quotas">, plan: Plan): PlanQuotas {
  return resolveQuotas(plan, row.quotas);
}

/** Quota IA mensuel propre à l'organisation (`settings.ai.monthlyRequestQuota`, 0 = limite du plan), avec le défaut du schéma si absent. */
function orgAiMonthlyQuota(raw: unknown): number {
  const parsed = aiSettings.safeParse(raw ?? {});
  return parsed.success ? parsed.data.monthlyRequestQuota : aiSettings.parse({}).monthlyRequestQuota;
}

/**
 * Construit la ligne administrateur à partir de la ligne SQL (fonction pure, testée sans base).
 * Le compteur IA suit la règle du refus (`messaging.suggestReply`, `studio.generateListing`) :
 * requêtes du mois de la table ai_requests (échecs compris, aide exclue) face au plus petit entre
 * le quota du plan et le réglage de l'organisation — jamais « 33 % » quand la 501e requête est refusée.
 */
export function orgUsageFrom(row: AdminOrgUsageRow): AdminOrgUsage {
  const plan: Plan = isPlan(row.plan) ? row.plan : "free";
  const quotas = quotasOfRow(row, plan);
  const month = row.monthUsage ?? {};
  const counters = {
    aiRequests: buildUsageCounter(row.aiRequestsMonth ?? month["ai.request"] ?? 0, effectiveAiQuota(quotas.aiRequestsPerMonth, orgAiMonthlyQuota(row.aiSettings))),
    items: buildUsageCounter(row.items, quotas.items),
    connections: buildUsageCounter(row.connections, quotas.connections),
    members: buildUsageCounter(row.members, quotas.members),
  };
  const { studio, track, cloud } = subsidiaryUsageFrom(month, quotas, row.cloudToday);
  // Les filtres Track suivis n'ont pas encore de stockage (toujours 0) : ils ne pèsent pas dans l'alerte.
  const watched = [...Object.values(counters), studio.listings, studio.wornPhotos, track.scans, track.photoSearches, cloud.actions];
  // Un quota nul (fonction non incluse) et rien d'utilisé : ce n'est pas un dépassement.
  const live = watched.filter((c) => c.quota > 0 || c.used > 0);
  return {
    id: row.id,
    name: row.name,
    plan,
    status: row.status,
    createdAt: row.createdAt,
    counters,
    studio,
    track,
    cloud,
    automationActions: month["automation.action"] ?? 0,
    maxPercent: live.reduce((m, c) => Math.max(m, c.percent), 0),
    warning: live.some((c) => c.warning),
    exceeded: live.some((c) => c.exceeded),
  };
}

/** Vue « utilisation par client » : réservée aux opérateurs, triée du client le plus proche de sa limite au plus loin. */
export async function adminUsage(ctx: OrgContext): Promise<AdminUsageReport> {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
  const now = ctx.services.now();
  const from = usagePeriodStart(now);
  const rows = await ctx.services.db.withGlobal((tx) => repos.admin.orgUsage(tx, from, usageDayStart(now)));
  const orgs = rows.map(orgUsageFrom).sort((a, b) => b.maxPercent - a.maxPercent || a.name.localeCompare(b.name, "fr"));
  return { period: { from, to: now.toISOString() }, orgs };
}

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
    orgs: orgs.map((o) => ({ ...o, plan: (isPlan(o.plan) ? o.plan : "free") as Plan })),
    plans: PLANS.map((plan) => ({ plan, quotas: quotasForPlan(plan), orgCount: orgs.filter((o) => o.plan === plan).length })),
  };
}

export async function adminSetPlan(ctx: OrgContext, orgId: string, plan: Plan): Promise<void> {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
  if (!isPlan(plan)) throw new AppError("validation", "Plan inconnu", 400);
  await ctx.services.db.withGlobal((tx) => repos.orgs.byId(tx, orgId));
  await ctx.services.db.withOrg(orgId, async (tx) => {
    await repos.subscriptions.upsert(tx, { plan, quotas: quotasForPlan(plan) });
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
