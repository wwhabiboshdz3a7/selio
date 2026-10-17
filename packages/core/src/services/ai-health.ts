import { repos } from "@selio/db";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { effectiveAiQuota, summarizeAiRequests } from "@selio/domain";
import { withOrg, type OrgContext } from "../context";
import type { AiHealthData } from "../types-data";

/**
 * État de l'IA de l'organisation : taux calculés sur le journal des requêtes
 * (même fonction que la démonstration), quota du mois civil (même calcul que le
 * contrôle fait avant chaque requête) et limites de la passerelle.
 */
export function getAiHealth(ctx: OrgContext, rawWindowDays?: unknown): Promise<AiHealthData> {
  const n = Number(rawWindowDays ?? 30);
  const windowDays = Number.isFinite(n) ? Math.min(90, Math.max(1, Math.round(n))) : 30;
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const from = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free;
    const summary = summarizeAiRequests(await repos.aiRequests.listSince(tx, from), { now, windowDays });
    const used = await repos.aiRequests.countSince(tx, monthStart);
    return {
      ...summary,
      quota: { used, limit: effectiveAiQuota(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota), planLimit: quotas.aiRequestsPerMonth, orgLimit: org.settings.ai.monthlyRequestQuota, monthStart },
      limits: ctx.services.ai.limits,
    };
  });
}
