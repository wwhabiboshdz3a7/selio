import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { PeriodPreset } from "@selio/domain";
import { Alert, Button, EmptyState, KpiCard, PageHeader, Section, formatCents, formatNumber, formatPercent, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { BarChart } from "../../components/charts";
import { Delta, ItemStatusBadge, OrderStatusBadge, PeriodPicker, QueryBoundary } from "../components/common";

export default function Overview() {
  const client = useClient();
  const session = useRequiredSession();
  const [period, setPeriod] = useState<PeriodPreset>("30d");
  const q = useQuery({ queryKey: ["overview", period], queryFn: () => client.getOverview(period) });
  return (
    <>
      <PageHeader title="Vue d'ensemble" description={`${session.org.name} · chiffres calculés depuis vos données, aucun indicateur simulé.`} actions={<PeriodPicker value={period} onChange={setPeriod} />} />
      <QueryBoundary query={q}>
        {(d) => (
          <div className="flex flex-col gap-6">
            {d.alerts.length > 0 ? (
              <div className="flex flex-col gap-2">
                {d.alerts.map((a) => (
                  <Alert key={a.id} tone={a.tone} title={a.title} action={<Link to={a.to}><Button size="sm" variant="secondary" iconRight={<ArrowRight />}>Voir</Button></Link>}>{a.description}</Alert>
                ))}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Chiffre d'affaires" value={formatCents(d.sales.revenueCents)} delta={{ value: <Delta current={d.sales.revenueCents} previous={d.previousSales.revenueCents} format={(v) => formatCents(v)} />, tone: "neutral" }} />
              <KpiCard label="Marge brute" value={formatCents(d.sales.marginCents)} delta={{ value: `${formatPercent(d.sales.marginRate)} du CA · ${formatNumber(d.sales.orderCount)} vente(s)`, tone: d.sales.marginCents >= 0 ? "success" : "danger" }} />
              <KpiCard label="Stock actif" value={formatNumber(d.stock.activeCount)} hint={`${formatNumber(d.stock.listedCount)} en vente · valeur d'achat ${formatCents(d.stock.stockValueCents, { compact: true })}`} />
              <KpiCard label="À traiter" value={formatNumber(d.counts.unreadMessages + d.counts.pendingOrders + d.counts.jobsAwaiting)} hint={`${d.counts.unreadMessages} message(s) non lu(s) · ${d.counts.pendingOrders} commande(s) en cours · ${d.counts.jobsAwaiting} action(s) à valider`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="card p-4 md:p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-md font-semibold">Ventes et marge brute</h2>
                  <Link to="/app/analytics" className="text-sm text-text-muted hover:text-text">Analyses détaillées</Link>
                </div>
                {d.series.some((s) => s.revenueCents > 0) ? (
                  <BarChart className="mt-4" data={d.series.map((s) => ({ label: s.label, primary: s.revenueCents, secondary: s.marginCents }))} primaryLabel="CA" secondaryLabel="Marge brute" />
                ) : (
                  <EmptyState className="mt-4 border-0" title="Aucune vente sur la période" description="Les ventes apparaissent ici dès qu'une commande est payée." />
                )}
              </div>
              <div className="card p-4 md:p-5">
                <h2 className="text-md font-semibold">Articles dormants</h2>
                <p className="text-sm text-text-muted">En stock depuis plus de 45 jours.</p>
                {d.staleItems.length === 0 ? <p className="mt-4 text-sm text-text-muted">Aucun article dormant.</p> : (
                  <ul className="mt-3 divide-y divide-border">
                    {d.staleItems.map((it) => (
                      <li key={it.id}><Link to={`/app/items/${it.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent"><span className="truncate">{it.title}</span><span className="num shrink-0 text-text-muted">{it.listedPriceCents === null ? "—" : formatCents(it.listedPriceCents)}</span></Link></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Dernières conversations" actions={<Link to="/app/messages" className="text-sm text-text-muted hover:text-text">Tout voir</Link>}>
                <div className="card divide-y divide-border p-0">
                  {d.recentConversations.length === 0 ? <p className="p-4 text-sm text-text-muted">Aucune conversation ouverte.</p> : d.recentConversations.map((c) => (
                    <Link key={c.id} to={`/app/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{c.lastMessagePreview || "(sans message)"}</span>
                        <span className="block text-xs text-text-muted">{c.lastMessageAt ? formatRelative(c.lastMessageAt) : ""}</span>
                      </span>
                      {c.unreadCount > 0 ? <span className="num rounded-sm bg-accent-soft px-1.5 text-xs font-medium text-accent">{c.unreadCount}</span> : null}
                    </Link>
                  ))}
                </div>
              </Section>
              <Section title="Dernières commandes" actions={<Link to="/app/orders" className="text-sm text-text-muted hover:text-text">Tout voir</Link>}>
                <div className="card divide-y divide-border p-0">
                  {d.recentOrders.length === 0 ? <p className="p-4 text-sm text-text-muted">Aucune commande.</p> : d.recentOrders.map((o) => (
                    <Link key={o.id} to={`/app/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-text">{formatRelative(o.createdAt)}</span>
                        <span className="mt-0.5 flex items-center gap-2"><OrderStatusBadge status={o.status} /></span>
                      </span>
                      <span className="num text-sm font-medium">{formatCents(o.salePriceCents)}</span>
                    </Link>
                  ))}
                </div>
              </Section>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="card p-4"><p className="text-sm text-text-muted">Rotation du stock</p><p className="num mt-1 text-lg font-semibold">{d.stock.averageDaysToSell === null ? "—" : `${d.stock.averageDaysToSell} j`}</p><p className="text-xs text-text-muted">Jours moyens entre achat et vente</p></div>
              <div className="card p-4"><p className="text-sm text-text-muted">Taux d'écoulement</p><p className="num mt-1 text-lg font-semibold">{formatPercent(d.stock.sellThroughRate)}</p><p className="text-xs text-text-muted">Vendus / (vendus + actifs)</p></div>
              <div className="card p-4"><p className="text-sm text-text-muted">Panier moyen</p><p className="num mt-1 text-lg font-semibold">{formatCents(d.sales.averageBasketCents)}</p><p className="text-xs text-text-muted">CA / nombre de ventes</p></div>
            </div>
            <p className="text-xs text-text-muted">Statuts du stock : <ItemStatusBadge status="listed" /> compte dans « en vente », <ItemStatusBadge status="reserved" /> aussi. Les commandes annulées ou remboursées n'entrent ni dans le CA ni dans la marge.</p>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
