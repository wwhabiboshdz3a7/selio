import { repos } from "@selio/db";
import {
  PERIOD_PRESETS, breakdownBy, buildDashboard, buildDressing, comparablesFromSales, daysInStock, granularityFor, itemMargins, marginsByPeriod, marginTotals, orderMargin, periodFromPreset, periodLabel, previousPeriod, salesKpis, salesSeries, stockKpis, thresholdStatusForOrders, toCsv,
  type EndToEndMargin, type MarginTotals, type MarginsByPeriod, type PeriodPreset, type ThresholdStatus,
} from "@selio/domain";
import { AppError, requireAction, withOrg, type OrgContext } from "../context";
import type { AnalyticsData, AnalyticsFilters, OverviewData } from "../types-data";

const PRESETS: readonly PeriodPreset[] = PERIOD_PRESETS;

function preset(v: unknown): PeriodPreset {
  return PRESETS.includes(v as PeriodPreset) ? (v as PeriodPreset) : "30d";
}

export async function getOverview(ctx: OrgContext, rawPeriod: unknown): Promise<OverviewData> {
  const period = preset(rawPeriod);
  // Lu avant la transaction : un contrôle de santé lent ne doit pas immobiliser une connexion à la base.
  const ai = await ctx.services.ai.status();
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
      if (c.status === "expired" || c.status === "disconnected" || c.status === "degraded") alerts.push({ id: `conn-${c.id}`, tone: c.status === "degraded" ? "warning" : "danger", title: `Connexion « ${c.label} » ${c.status === "degraded" ? "dégradée" : c.status === "expired" ? "expirée" : "déconnectée"}`, description: c.lastError ?? "Vérifiez le compte dans « Comptes Vinted ».", to: "/app/accounts" });
      if (c.status === "ready") alerts.push({ id: `conn-ready-${c.id}`, tone: "info", title: `Connexion « ${c.label} » en attente de l'extension`, description: "Associez l'extension Selio pour activer la lecture des pages.", to: "/app/accounts" });
    }
    if ((jobCounts.failed ?? 0) > 0) alerts.push({ id: "jobs-failed", tone: "danger", title: `${jobCounts.failed} tâche(s) d'automatisation en échec`, description: (await repos.jobs.recentErrors(tx, 1))[0]?.error ?? "", to: "/app/automations?tab=jobs&status=failed" });
    if ((jobCounts.awaiting_approval ?? 0) > 0) alerts.push({ id: "jobs-awaiting", tone: "warning", title: `${jobCounts.awaiting_approval} action(s) automatique(s) à valider`, description: "Ces actions attendent votre validation avant exécution.", to: "/app/automations?tab=jobs&status=awaiting_approval" });
    if (state.globalPaused) alerts.push({ id: "global-pause", tone: "warning", title: "Automatisations en arrêt global", description: "Aucune règle ne s'exécute tant que l'arrêt global est actif.", to: "/app/automations" });
    if (ai.status === "unavailable" || ai.status === "circuit_open") alerts.push({ id: "ai", tone: "warning", title: "Assistant IA indisponible", description: `${ai.message}. Les gabarits déterministes restent utilisables.`, to: "/app/settings/ai" });
    const org = await repos.orgs.byId(tx, ctx.orgId);
    // Seuils de déclaration (30 ventes ou 2 000 € par an) : information factuelle, jamais un conseil fiscal.
    if (org.settings.thresholds.enabled) {
      const t = thresholdStatusForOrders(orders, org.settings.thresholds, now);
      if (t.level !== "none") alerts.push({ id: "declaration-thresholds", tone: t.level === "reached" ? "warning" : "info", title: t.level === "reached" ? "Seuil de déclaration des plateformes atteint" : "Vous approchez d'un seuil de déclaration des plateformes", description: t.text, to: "/app/analytics" });
    }
    const sales = comparablesFromSales(orders, new Map(items.map((i) => [i.id, i])));
    return {
      period, sales: salesKpis(orders, p), previousSales: salesKpis(orders, previousPeriod(p, period)), stock: stockKpis(items, now),
      series: salesSeries(orders, p, granularityFor(period)),
      periodLabel: periodLabel(period, now),
      dashboard: buildDashboard(items, orders, p, now, { timezone: org.settings.timezone, granularity: granularityFor(period) }),
      dressing: buildDressing(items, sales, { now, rules: org.settings.margin, republishAfterDays: org.settings.dressing.republishAfterDays }).summary,
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
    const granularity = filters.granularity ?? granularityFor(filters.period);
    const inPeriod = orders.filter((o) => new Date(o.createdAt) >= p.from && new Date(o.createdAt) < p.to && o.status !== "cancelled" && o.status !== "refunded");
    return {
      period: filters.period, sales: salesKpis(orders, p), previousSales: salesKpis(orders, previousPeriod(p, filters.period)), stock: stockKpis(items, now, { period: p }),
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

// ---------------------------------------------------------------- marge de bout en bout et seuils (§5.14)

export interface MarginItemView {
  itemId: string;
  title: string;
  status: string;
  /** Article acheté avec Selio Radar (prix d'achat reporté automatiquement). */
  fromRadar: boolean;
  at: string | null;
  margin: EndToEndMargin;
}

export interface MarginRow {
  itemId: string;
  title: string;
  status: "projected" | "realized";
  /** Origine du prix d'achat : achat Radar ou saisie dans le stock. */
  purchaseSource: "radar" | "manual";
  at: string | null;
  costCents: number;
  revenueCents: number;
  marginCents: number;
  marginRate: number;
  priceKnown: boolean;
}

export interface MarginData extends MarginsByPeriod {
  /** Lignes à plat (forme de l'écran des analyses). */
  rows: MarginRow[];
  period: PeriodPreset;
  periodLabel: string;
  /** Vendus dans la période (marges réalisées) et stock actuel (marges projetées). */
  totals: MarginsByPeriod;
  /** Articles achetés avec Selio Radar : achat → revente. */
  radar: MarginTotals;
  items: MarginItemView[];
  note: string;
}

/**
 * Marge de bout en bout : du prix d'achat (Radar, achat assisté ou saisi) à la revente. Réalisée une fois
 * la vente payée (prix de vente, frais et port à la charge du vendeur déduits), projetée sinon (prix affiché).
 * Marge brute opérationnelle, pas un bénéfice net.
 */
export function getMargin(ctx: OrgContext, raw: Record<string, unknown> = {}): Promise<MarginData> {
  requireAction(ctx, "analytics.read");
  const period = preset(raw.period);
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const p = periodFromPreset(period, now);
    const items = await repos.items.all(tx);
    const byId = new Map(items.map((i) => [i.id, i]));
    // Mêmes règles que « CA et marge brute » (instantané de la commande) et que la marge projetée du Stock (frais attendus).
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const entries = itemMargins(items, await repos.orders.all(tx), null, org.settings.margin);
    const views: MarginItemView[] = entries.map((e) => {
      const it = byId.get(e.itemId)!;
      return { itemId: e.itemId, title: it.title, status: it.status, fromRadar: it.tags.includes("radar"), at: e.at, margin: e.margin };
    });
    const visible = views.filter((v) => v.margin.status === "projected" || (v.at !== null && new Date(v.at) >= p.from && new Date(v.at) < p.to));
    const totals = marginsByPeriod(entries, p);
    const sorted = [...visible].sort((a, b) => b.margin.marginCents - a.margin.marginCents).slice(0, 200);
    return {
      ...totals,
      rows: sorted.map((v) => ({ itemId: v.itemId, title: v.title, status: v.margin.status, purchaseSource: v.fromRadar ? "radar" : "manual", at: v.at, costCents: v.margin.costCents, revenueCents: v.margin.revenueCents, marginCents: v.margin.marginCents, marginRate: v.margin.marginRate, priceKnown: v.margin.priceKnown })),
      period, periodLabel: periodLabel(period, now),
      totals,
      radar: marginTotals(visible.filter((v) => v.fromRadar).map((v) => v.margin)),
      items: sorted,
      note: "Marge brute : prix de vente (ou prix affiché tant que l'article n'est pas vendu) moins prix d'achat, frais d'achat, frais et port à la charge du vendeur. Ni impôts ni cotisations.",
    };
  });
}

/** Seuils de déclaration des plateformes (30 ventes ou 2 000 € par an, paramétrables) : information, jamais un conseil fiscal. */
export function getThresholds(ctx: OrgContext): Promise<ThresholdStatus & { enabled: boolean; approachingRate: number }> {
  requireAction(ctx, "analytics.read");
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const status = thresholdStatusForOrders(await repos.orders.all(tx), org.settings.thresholds, ctx.services.now());
    return { ...status, enabled: org.settings.thresholds.enabled, approachingRate: org.settings.thresholds.approachingRate };
  });
}
