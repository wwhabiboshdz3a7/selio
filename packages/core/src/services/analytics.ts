import { repos } from "@selio/db";
import { breakdownBy, daysInStock, orderMargin, periodFromPreset, previousPeriod, salesKpis, salesSeries, stockKpis, toCsv, type PeriodPreset } from "@selio/domain";
import { AppError, requireAction, withOrg, type OrgContext } from "../context";
import type { AnalyticsData, AnalyticsFilters, OverviewData } from "../types-data";

const PRESETS: PeriodPreset[] = ["7d", "30d", "90d", "12m", "ytd", "all"];

function preset(v: unknown): PeriodPreset {
  return PRESETS.includes(v as PeriodPreset) ? (v as PeriodPreset) : "30d";
}

export function getOverview(ctx: OrgContext, rawPeriod: unknown): Promise<OverviewData> {
  const period = preset(rawPeriod);
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const p = periodFromPreset(period, now);
    const orders = await repos.orders.all(tx);
    const items = await repos.items.all(tx);
    const conv = await repos.conversations.counts(tx);
    const jobCounts = await repos.jobs.countByStatus(tx);
    const state = await repos.automationState.get(tx);
    const connections = await repos.connections.list(tx);
    const alerts: OverviewData["alerts"] = [];
    for (const c of connections) {
      if (c.status === "expired" || c.status === "disconnected" || c.status === "degraded") alerts.push({ id: `conn-${c.id}`, tone: c.status === "degraded" ? "warning" : "danger", title: `Connexion « ${c.label} » ${c.status === "degraded" ? "dégradée" : c.status === "expired" ? "expirée" : "déconnectée"}`, description: c.lastError ?? "Vérifiez la connexion dans les paramètres.", to: "/app/settings/connections" });
      if (c.status === "ready") alerts.push({ id: `conn-ready-${c.id}`, tone: "info", title: `Connexion « ${c.label} » en attente de l'extension`, description: "Associez l'extension Selio pour activer la lecture des pages.", to: "/app/settings/connections" });
    }
    if ((jobCounts.failed ?? 0) > 0) alerts.push({ id: "jobs-failed", tone: "danger", title: `${jobCounts.failed} tâche(s) d'automatisation en échec`, description: (await repos.jobs.recentErrors(tx, 1))[0]?.error ?? "", to: "/app/automations?tab=jobs&status=failed" });
    if ((jobCounts.awaiting_approval ?? 0) > 0) alerts.push({ id: "jobs-awaiting", tone: "warning", title: `${jobCounts.awaiting_approval} action(s) automatique(s) à valider`, description: "Ces actions attendent votre validation avant exécution.", to: "/app/automations?tab=jobs&status=awaiting_approval" });
    if (state.globalPaused) alerts.push({ id: "global-pause", tone: "warning", title: "Automatisations en arrêt global", description: "Aucune règle ne s'exécute tant que l'arrêt global est actif.", to: "/app/automations" });
    const ai = await ctx.services.ai.status();
    if (ai.status === "unavailable" || ai.status === "circuit_open") alerts.push({ id: "ai", tone: "warning", title: "Assistant IA indisponible", description: `${ai.message}. Les gabarits déterministes restent utilisables.`, to: "/app/settings/ai" });
    return {
      period, sales: salesKpis(orders, p), previousSales: salesKpis(orders, previousPeriod(p)), stock: stockKpis(items, now),
      series: salesSeries(orders, p, period === "7d" || period === "30d" ? "day" : period === "90d" ? "week" : "month"),
      counts: { openConversations: conv.open, unreadMessages: conv.unread, pendingOrders: await repos.orders.countPending(tx), jobsAwaiting: jobCounts.awaiting_approval ?? 0, jobsFailed: jobCounts.failed ?? 0 },
      alerts, recentOrders: await repos.orders.recent(tx, 5), recentConversations: await repos.conversations.recent(tx, 5),
      staleItems: items.filter((i) => (i.status === "listed" || i.status === "in_stock") && daysInStock(i, now) > 45).slice(0, 5),
    };
  });
}

function parseFilters(raw: Record<string, unknown>): AnalyticsFilters {
  const granularity = raw.granularity === "day" || raw.granularity === "week" || raw.granularity === "month" ? raw.granularity : undefined;
  return { period: preset(raw.period), category: typeof raw.category === "string" && raw.category ? raw.category.slice(0, 40) : undefined, channel: typeof raw.channel === "string" && raw.channel ? raw.channel.slice(0, 40) : undefined, granularity };
}

export function getAnalytics(ctx: OrgContext, raw: Record<string, unknown>): Promise<AnalyticsData> {
  const filters = parseFilters(raw);
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const p = periodFromPreset(filters.period, now);
    const items = await repos.items.all(tx);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    let orders = await repos.orders.all(tx);
    if (filters.category) orders = orders.filter((o) => itemMap.get(o.itemId)?.category === filters.category);
    if (filters.channel) orders = orders.filter((o) => o.provider === filters.channel);
    const granularity = filters.granularity ?? (filters.period === "7d" || filters.period === "30d" ? "day" : filters.period === "90d" ? "week" : "month");
    const inPeriod = orders.filter((o) => new Date(o.createdAt) >= p.from && new Date(o.createdAt) < p.to && o.status !== "cancelled" && o.status !== "refunded");
    return {
      period: filters.period, sales: salesKpis(orders, p), previousSales: salesKpis(orders, previousPeriod(p)), stock: stockKpis(items, now, { period: p }),
      series: salesSeries(orders, p, granularity),
      byCategory: breakdownBy(orders, (o) => itemMap.get(o.itemId)?.category ?? "other", p),
      byChannel: breakdownBy(orders, (o) => o.provider, p),
      byBrand: breakdownBy(orders, (o) => itemMap.get(o.itemId)?.brand ?? "—", p).slice(0, 8),
      topItems: inPeriod.map((o) => ({ item: itemMap.get(o.itemId)!, order: o, marginCents: orderMargin(o).marginCents })).filter((x) => x.item).sort((a, b) => b.marginCents - a.marginCents).slice(0, 5),
    };
  });
}

export function exportAnalyticsCsv(ctx: OrgContext, raw: Record<string, unknown>): Promise<string> {
  requireAction(ctx, "analytics.export");
  const filters = parseFilters(raw);
  return withOrg(ctx, async (tx) => {
    const p = periodFromPreset(filters.period, ctx.services.now());
    const items = new Map((await repos.items.all(tx)).map((i) => [i.id, i]));
    const rows: (string | number | null)[][] = [["Date", "Article", "Marque", "Catégorie", "Canal", "Statut", "Prix de vente", "Frais plateforme", "Port vendeur", "Autres coûts", "Coût d'acquisition", "Marge brute", "Taux de marge"]];
    let revenue = 0, margin = 0, count = 0;
    for (const o of await repos.orders.all(tx)) {
      if (new Date(o.createdAt) < p.from || new Date(o.createdAt) >= p.to) continue;
      const it = items.get(o.itemId);
      if (filters.category && it?.category !== filters.category) continue;
      if (filters.channel && o.provider !== filters.channel) continue;
      const m = orderMargin(o);
      if (o.status !== "cancelled" && o.status !== "refunded") { revenue += o.salePriceCents; margin += m.marginCents; count++; }
      rows.push([o.createdAt.slice(0, 10), it?.title ?? "", it?.brand ?? "", it?.category ?? "", o.provider, o.status, (o.salePriceCents / 100).toFixed(2), (o.platformFeeCents / 100).toFixed(2), (o.shippingCostCents / 100).toFixed(2), (o.otherCostsCents / 100).toFixed(2), (m.acquisitionCents / 100).toFixed(2), (m.marginCents / 100).toFixed(2), (m.marginRate * 100).toFixed(1)]);
    }
    rows.push([], ["Total CA", (revenue / 100).toFixed(2)], ["Total marge brute", (margin / 100).toFixed(2)], ["Commandes", count]);
    await repos.usage.record(tx, "export.csv", { kind: "analytics" });
    return toCsv(rows);
  });
}

export function assertPeriod(v: unknown): PeriodPreset {
  if (!PRESETS.includes(v as PeriodPreset)) throw new AppError("validation", "Période inconnue", 400);
  return v as PeriodPreset;
}
