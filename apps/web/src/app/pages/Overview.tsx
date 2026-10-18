import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, Clock, Coins, Gauge as GaugeIcon, Hourglass, Info, LayoutGrid, LineChart, Package, PieChart, Plus, Radar, Shirt, ShoppingBag, Sparkles, Store, Tags, Target, TrendingUp, Trophy, Wallet, X, XCircle } from "lucide-react";
import type { PeriodPreset } from "@selio/domain";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@selio/contracts";
import { Button, Dialog, EmptyState, IconTile, PageHeader, StatStrip, Tag, cn, formatCents, formatNumber, formatPercent, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import type { OverviewData } from "../../lib/data/types";
import { AreaChart, BarChart, ColumnChart, DonutChart, Gauge, HorizontalBars, ScoreRing, Sparkline, StackedBar, scoreTone } from "../../components/charts";
import { Delta, OrderStatusBadge, PeriodPicker, QueryBoundary } from "../components/common";
import { useNavCounts } from "../layout";

type WidgetId = "sales" | "cumulative" | "goal" | "categoryMix" | "weekday" | "hours" | "stockAging" | "daysToSell" | "brandMargin" | "priceBands" | "buyVsSell" | "sellThrough" | "stockValue" | "marginRate" | "basket" | "dressing" | "orderStatus" | "stale";

interface WidgetDef {
  id: WidgetId;
  title: string;
  description: string;
  icon: ReactNode;
  wide?: boolean;
  render: (d: OverviewData) => ReactNode;
}

const pct = (v: number) => formatPercent(v);
const WIDGETS: WidgetDef[] = [
  { id: "sales", title: "Ventes et marge brute", description: "Chiffre d'affaires et marge par jour, semaine ou mois.", icon: <BarChart3 />, wide: true,
    render: (d) => d.series.some((s) => s.revenueCents > 0) ? <BarChart data={d.series.map((s) => ({ label: s.label, primary: s.revenueCents, secondary: s.marginCents }))} primaryLabel="CA" secondaryLabel="Marge brute" /> : <Empty text="Aucune vente sur la période." /> },
  { id: "cumulative", title: "Bénéfice cumulé", description: "La marge brute qui s'additionne vente après vente.", icon: <TrendingUp />, wide: true,
    render: (d) => <AreaChart data={d.dashboard.cumulativeMargin.map((x) => ({ label: x.label, value: x.value }))} label="Bénéfice cumulé" /> },
  { id: "goal", title: "Objectif du mois", description: "CA du mois en cours face à l'objectif (mois précédent + 10 %).", icon: <Target />,
    render: (d) => { const g = d.dashboard.monthlyGoal; const pace = g.daysElapsed / Math.max(1, g.daysInMonth); return <div className="flex flex-col items-center"><Gauge value={g.achievedCents} max={g.targetCents} label={`${formatCents(g.achievedCents, { compact: true })} sur ${formatCents(g.targetCents, { compact: true })}`} sublabel={`Jour ${g.daysElapsed}/${g.daysInMonth} · rythme attendu ${Math.round(pace * 100)} %`} tone={g.achievedCents >= g.targetCents ? "var(--gold)" : "var(--accent-vivid)"} /><p className="mt-2 text-xs text-text-muted">Mois précédent : {formatCents(g.previousMonthCents, { compact: true })}</p></div>; } },
  { id: "categoryMix", title: "Ventes par catégorie", description: "Part de chaque catégorie dans le chiffre d'affaires.", icon: <PieChart />,
    render: (d) => d.dashboard.categoryMix.length ? <DonutChart rows={d.dashboard.categoryMix.map((r) => ({ label: r.label, value: r.value }))} centerLabel="de CA" /> : <Empty text="Aucune vente." /> },
  { id: "weekday", title: "Meilleurs jours de vente", description: "Chiffre d'affaires par jour de la semaine.", icon: <CalendarDays />,
    render: (d) => <ColumnChart rows={d.dashboard.weekday.map((w) => ({ label: w.label, value: w.value }))} formatValue={(v) => formatCents(v, { compact: true })} /> },
  { id: "hours", title: "Heures des ventes", description: "À quelle heure vos articles partent (heure de Paris).", icon: <Clock />,
    render: (d) => <ColumnChart rows={d.dashboard.hours.map((h) => ({ label: h.label, value: h.value }))} /> },
  { id: "stockAging", title: "Ancienneté du stock", description: "Articles actifs par nombre de jours depuis l'achat.", icon: <Hourglass />,
    render: (d) => <ColumnChart rows={d.dashboard.stockAging.map((b) => ({ label: b.label, value: b.value }))} /> },
  { id: "daysToSell", title: "Délai de vente", description: "En combien de jours vos ventes de la période sont parties.", icon: <Clock />,
    render: (d) => <ColumnChart rows={d.dashboard.daysToSell.map((b) => ({ label: b.label, value: b.value }))} /> },
  { id: "brandMargin", title: "Marques les plus rentables", description: "Marge brute cumulée par marque.", icon: <Trophy />,
    render: (d) => d.dashboard.brandMargin.length ? <HorizontalBars rows={d.dashboard.brandMargin.map((r) => ({ label: r.label, value: r.value }))} /> : <Empty text="Aucune vente." /> },
  { id: "priceBands", title: "Ventes par tranche de prix", description: "Où se situent vos prix de vente.", icon: <Tags />,
    render: (d) => <ColumnChart rows={d.dashboard.priceBands.map((b) => ({ label: b.label, value: b.value }))} /> },
  { id: "buyVsSell", title: "Achat vs vente par catégorie", description: "Prix d'achat moyen comparé au prix de vente moyen.", icon: <Coins />, wide: true,
    render: (d) => d.dashboard.buyVsSell.length ? <BarChart data={d.dashboard.buyVsSell.map((r) => ({ label: r.label, primary: r.secondary ?? 0, secondary: r.value }))} primaryLabel="Vente moyenne" secondaryLabel="Achat moyen" height={200} /> : <Empty text="Aucune vente." /> },
  { id: "sellThrough", title: "Taux d'écoulement par catégorie", description: "Vendus / (vendus + en stock).", icon: <GaugeIcon />,
    render: (d) => <HorizontalBars rows={d.dashboard.sellThroughByCategory.map((r) => ({ label: r.label, value: r.value }))} formatValue={pct} /> },
  { id: "stockValue", title: "Valeur du stock", description: "Valeur d'achat du stock actif par catégorie.", icon: <Wallet />,
    render: (d) => d.dashboard.stockValueByCategory.length ? <DonutChart rows={d.dashboard.stockValueByCategory.map((r) => ({ label: r.label, value: r.value }))} centerLabel="en stock" /> : <Empty text="Stock vide." /> },
  { id: "marginRate", title: "Taux de marge", description: "Marge brute / chiffre d'affaires, dans le temps.", icon: <LineChart />, wide: true,
    render: (d) => <AreaChart data={d.dashboard.marginRateSeries.map((x) => ({ label: x.label, value: Math.round(x.value * 1000) }))} formatValue={(v) => `${Math.round(v / 10)} %`} label="Taux de marge" /> },
  { id: "basket", title: "Panier moyen", description: "Montant moyen d'une vente dans le temps.", icon: <ShoppingBag />, wide: true,
    render: (d) => <AreaChart data={d.dashboard.basketSeries.map((x) => ({ label: x.label, value: x.value }))} label="Panier moyen" /> },
  { id: "dressing", title: "Rendement du dressing", description: "Note moyenne des annonces et annonces à republier.", icon: <Shirt />,
    render: (d) => <div className="flex flex-col gap-3"><div className="flex items-center gap-4"><ScoreRing score={d.dressing.averageScore} size={72} stroke={6} scale="listing" /><div><p className="num text-lg font-semibold">{d.dressing.toRepublish} à republier</p><p className="text-xs text-text-muted">{d.dressing.listed} annonces · {d.dressing.viewsPerDay.toFixed(1).replace(".", ",")} vues/jour · {pct(d.dressing.favoriteRate)} de favoris</p></div></div><StackedBar rows={[{ label: "Excellentes", value: d.dressing.byBand.excellent, tone: scoreTone(80, "listing") }, { label: "Bonnes", value: d.dressing.byBand.good, tone: scoreTone(60, "listing") }, { label: "À améliorer", value: d.dressing.byBand.improve, tone: scoreTone(40, "listing") }, { label: "Faibles", value: d.dressing.byBand.weak, tone: scoreTone(0, "listing") }]} /><Link to="/app/dressing" className="text-sm font-medium text-accent">Ouvrir le dressing →</Link></div> },
  { id: "orderStatus", title: "Commandes par statut", description: "Où en sont les commandes de la période.", icon: <Package />,
    render: (d) => d.dashboard.orderStatus.length ? <HorizontalBars rows={d.dashboard.orderStatus.map((r) => ({ label: ORDER_STATUS_LABELS[r.key as OrderStatus] ?? r.label, value: r.value }))} formatValue={(v) => String(v)} /> : <Empty text="Aucune commande." /> },
  { id: "stale", title: "Articles dormants", description: "En stock depuis plus de 45 jours : à baisser ou republier.", icon: <AlertTriangle />,
    render: (d) => d.staleItems.length === 0 ? <Empty text="Aucun article dormant." /> : <ul className="divide-y divide-border">{d.staleItems.map((it) => <li key={it.id}><Link to={`/app/items/${it.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-accent">{it.photos[0] ? <img src={it.photos[0].url} alt="" className="size-9 rounded-md object-cover" /> : null}<span className="min-w-0 flex-1 truncate">{it.title}</span><span className="num shrink-0 text-text-muted">{it.listedPriceCents === null ? "—" : formatCents(it.listedPriceCents)}</span></Link></li>)}</ul> },
];

const DEFAULT_WIDGETS: WidgetId[] = ["sales", "goal", "cumulative", "categoryMix", "weekday", "dressing", "stockAging", "brandMargin"];

const ALERT_ORDER = { danger: 0, warning: 1, info: 2 } as const;
function sortAlerts(list: OverviewData["alerts"]): OverviewData["alerts"] {
  return [...list].sort((a, b) => ALERT_ORDER[a.tone] - ALERT_ORDER[b.tone]);
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-text-muted">{text}</p>;
}

function useWidgets(orgId: string): [WidgetId[], (ids: WidgetId[]) => void] {
  const key = `selio.dashboard.${orgId}`;
  const [ids, setIds] = useState<WidgetId[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "null") as WidgetId[] | null;
      if (Array.isArray(raw)) return raw.filter((id) => WIDGETS.some((w) => w.id === id));
    } catch {
      // stockage indisponible : widgets par défaut
    }
    return DEFAULT_WIDGETS;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ }
  }, [key, ids]);
  return [ids, setIds];
}

export default function Overview() {
  const client = useClient();
  const session = useRequiredSession();
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const q = useQuery({ queryKey: ["overview", period], queryFn: () => client.getOverview(period) });
  const counts = useNavCounts();
  const market = useQuery({ queryKey: ["market", "overview"], queryFn: () => client.getMarketInsights({ windowDays: 30 }) });
  const [widgets, setWidgets] = useWidgets(session.org.id);
  const [gallery, setGallery] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const first = session.user.displayName.split(" ")[0];
  const active = useMemo(() => widgets.map((id) => WIDGETS.find((w) => w.id === id)!).filter(Boolean), [widgets]);
  const toggle = (id: WidgetId) => setWidgets(widgets.includes(id) ? widgets.filter((x) => x !== id) : [...widgets, id]);

  return (
    <>
      <PageHeader
        title={`Bonjour ${first}`}
        description={q.data ? <>Vos chiffres de <strong className="font-semibold text-text">{q.data.periodLabel}</strong> · {session.org.name} · calculés depuis vos données</> : `${session.org.name}`}
        actions={<><PeriodPicker value={period} onChange={setPeriod} /><Button variant="secondary" icon={<LayoutGrid />} onClick={() => setGallery(true)}>Personnaliser</Button></>}
      />

      <nav aria-label="Raccourcis" className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border xl:grid-cols-4">
        <FeatureTile to="/studio" icon={<Sparkles />} title="Générer une annonce" text="Vos photos → annonce rédigée par l'IA, en brouillon ou publiée." cta="Commencer" primary />
        <FeatureTile to="/app/dressing?filter=due" icon={<Shirt />} title="Dressing intelligent" text={q.data ? `Note moyenne ${q.data.dressing.averageScore}/100 · ${counts.data?.dressingDue ?? q.data.dressing.toRepublish} annonce(s) à republier` : "Notes et rendement de vos annonces"} cta="Republier" />
        <FeatureTile to="/app/purchase" icon={<Radar />} title="Bonnes affaires" text={counts.data ? `${counts.data.toReview} affaire(s) notée(s) 75/100 ou plus à valider` : "Le radar note chaque affaire sur 100"} cta="Valider" />
        <FeatureTile to="/app/market" icon={<Store />} title="Analyse revendeurs" text={market.data?.opportunities[0] ? `Niche à saisir : ${market.data.opportunities[0].label} (demande ${market.data.opportunities[0].demand}/100)` : "Top vendeurs et niches en hausse"} cta="Explorer" />
      </nav>

      <QueryBoundary query={q}>
        {(d) => (
          <div className="flex flex-col gap-8">
            <StatStrip
              className="grid-cols-2 lg:grid-cols-5"
              items={[
                { label: "Chiffre d'affaires", value: formatCents(d.sales.revenueCents), sub: <Delta current={d.sales.revenueCents} previous={d.previousSales.revenueCents} format={(v) => formatCents(v)} />, extra: <Spark values={d.series.map((s) => s.revenueCents)} /> },
                { label: "Bénéfice (marge brute)", value: formatCents(d.sales.marginCents), sub: <span className={d.sales.marginCents >= 0 ? "text-success" : "text-danger"}>{formatPercent(d.sales.marginRate)} du CA</span>, extra: <Spark values={d.dashboard.cumulativeMargin.map((x) => x.value)} /> },
                { label: "Ventes", value: formatNumber(d.sales.orderCount), sub: <>Panier moyen {formatCents(d.sales.averageBasketCents)}</>, extra: <Spark values={d.series.map((s) => s.orderCount)} /> },
                { label: "Stock actif", value: formatNumber(d.stock.activeCount), sub: <>{formatNumber(d.stock.listedCount)} en vente · {formatCents(d.stock.stockValueCents, { compact: true })} investis</> },
                { label: "À traiter", value: formatNumber(d.counts.unreadMessages + d.counts.pendingOrders + d.counts.jobsAwaiting), sub: <>{d.counts.unreadMessages} message(s) · {d.counts.pendingOrders} commande(s) · {d.counts.jobsAwaiting} action(s)</> },
              ]}
            />

            {d.alerts.length > 0 ? (
              <section aria-label="Alertes" className="card divide-y divide-border">
                {(showAlerts ? sortAlerts(d.alerts) : sortAlerts(d.alerts).slice(0, 2)).map((a) => (
                  <div key={a.id} role={a.tone === "info" ? "status" : "alert"} className="flex items-start gap-3 px-4 py-3 md:px-5">
                    <span className="mt-0.5 shrink-0">{ALERT_ICON[a.tone]}</span>
                    <div className="min-w-0 flex-1 text-sm"><p className="font-medium text-text">{a.title}</p><p className="text-text-muted">{a.description}</p></div>
                    <Link to={a.to} className="inline-flex shrink-0 items-center gap-1 self-center rounded-md px-2 py-1 text-sm font-medium text-text-muted hover:bg-surface-muted hover:text-text">Voir<ArrowRight className="size-3.5" aria-hidden /></Link>
                  </div>
                ))}
                {d.alerts.length > 2 ? <button type="button" className="w-full px-4 py-2.5 text-left text-sm font-medium text-text-muted hover:text-text md:px-5" onClick={() => setShowAlerts(!showAlerts)}>{showAlerts ? "Masquer" : `Voir les ${d.alerts.length - 2} autre(s) alerte(s)`}</button> : null}
              </section>
            ) : null}

            {active.length === 0 ? (
              <EmptyState icon={<LayoutGrid />} title="Aucun graphique affiché" description="Ajoutez les graphiques qui vous parlent : ventes, bénéfice cumulé, objectif du mois, meilleurs jours…" action={<Button icon={<Plus />} onClick={() => setGallery(true)}>Ajouter des graphiques</Button>} />
            ) : (
              <div className="grid grid-flow-row-dense gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {active.map((w) => (
                  <section key={w.id} className={cn("card group/widget flex min-w-0 flex-col p-5 md:p-6", w.wide && "md:col-span-2")}>
                    <div className="mb-4 flex items-start gap-3">
                      <div className="min-w-0 flex-1"><h2 className="text-md font-semibold text-text">{w.title}</h2><p className="text-xs text-text-muted">{w.description}</p></div>
                      <button type="button" onClick={() => toggle(w.id)} className="rounded-md p-1 text-text-muted opacity-100 transition-opacity hover:bg-surface-muted hover:text-text focus-visible:opacity-100 md:opacity-0 md:group-hover/widget:opacity-100" aria-label={`Retirer « ${w.title} »`} title="Retirer"><X className="size-4" /></button>
                    </div>
                    <div className="min-w-0 flex-1">{w.render(d)}</div>
                  </section>
                ))}
                <button type="button" onClick={() => setGallery(true)} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-sm font-medium text-text-muted transition-colors hover:border-accent hover:text-accent">
                  <Plus className="size-5" aria-hidden />Ajouter un graphique
                  <span className="text-xs font-normal">{WIDGETS.length - active.length} disponible(s)</span>
                </button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card p-0">
                <div className="flex items-center justify-between px-4 pt-4"><h2 className="text-md font-semibold">Dernières conversations</h2><Link to="/app/messages" className="text-sm text-text-muted hover:text-text">Tout voir</Link></div>
                <div className="mt-2 divide-y divide-border">
                  {d.recentConversations.length === 0 ? <p className="p-4 text-sm text-text-muted">Aucune conversation ouverte.</p> : d.recentConversations.map((c) => (
                    <Link key={c.id} to={`/app/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm text-text">{c.lastMessagePreview || "(sans message)"}</span><span className="block text-xs text-text-muted">{c.lastMessageAt ? formatRelative(c.lastMessageAt) : ""}</span></span>
                      {c.unreadCount > 0 ? <span className="num min-w-5 rounded-full bg-accent-soft px-1.5 text-center text-xs font-semibold text-accent">{c.unreadCount}</span> : null}
                    </Link>
                  ))}
                </div>
              </section>
              <section className="card p-0">
                <div className="flex items-center justify-between px-4 pt-4"><h2 className="text-md font-semibold">Dernières commandes</h2><Link to="/app/orders" className="text-sm text-text-muted hover:text-text">Tout voir</Link></div>
                <div className="mt-2 divide-y divide-border">
                  {d.recentOrders.length === 0 ? <p className="p-4 text-sm text-text-muted">Aucune commande.</p> : d.recentOrders.map((o) => (
                    <Link key={o.id} to={`/app/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                      <span className="min-w-0 flex-1"><span className="block text-sm text-text">{formatRelative(o.createdAt)}</span><span className="mt-0.5 flex items-center gap-2"><OrderStatusBadge status={o.status} /></span></span>
                      <span className="num text-sm font-semibold">{formatCents(o.salePriceCents)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
            <p className="text-xs text-text-muted">Les commandes annulées ou remboursées n'entrent ni dans le CA ni dans la marge. « Ce mois-ci » va du 1er du mois à aujourd'hui et se compare à la même période du mois précédent.</p>
          </div>
        )}
      </QueryBoundary>

      <Dialog open={gallery} onClose={() => setGallery(false)} size="lg" title="Galerie de graphiques" description="Ajoutez ou retirez un graphique d'une simple touche. Votre sélection est mémorisée sur cet appareil." footer={<><Button variant="ghost" onClick={() => setWidgets(DEFAULT_WIDGETS)}>Rétablir par défaut</Button><Button onClick={() => setGallery(false)}>Terminé</Button></>}>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {WIDGETS.map((w) => {
            const on = widgets.includes(w.id);
            return (
              <li key={w.id}>
                <button type="button" onClick={() => toggle(w.id)} aria-pressed={on} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors", on ? "border-accent bg-accent-soft/50" : "border-border hover:bg-surface-muted")}>
                  <IconTile icon={w.icon} tone={on ? "accent" : "neutral"} size={34} />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text">{w.title}</span><span className="block text-xs text-text-muted">{w.description}</span></span>
                  <Tag accent={on}>{on ? "Affiché" : "Ajouter"}</Tag>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}

const ALERT_ICON: Record<OverviewData["alerts"][number]["tone"], ReactNode> = {
  danger: <XCircle className="size-4 text-danger" aria-hidden />,
  warning: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  info: <Info className="size-4 text-text-muted" aria-hidden />,
};

/** Raccourci vers un module : icône neutre (améthyste pour l'action principale), lien d'action en violet. */
function FeatureTile({ to, icon, title, text, cta, primary = false }: { to: string; icon: ReactNode; title: string; text: string; cta: string; primary?: boolean }) {
  return (
    <Link to={to} className="group flex min-w-0 flex-col gap-1 bg-surface p-4 transition-colors hover:bg-surface-muted/60 md:p-5">
      <span className={cn("mb-1.5 inline-flex [&>svg]:size-5", primary ? "text-accent" : "text-text-muted")} aria-hidden>{icon}</span>
      <span className="block text-sm font-semibold text-text md:text-base">{title}</span>
      <span className="line-clamp-2 block text-xs text-text-muted">{text}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-1.5 text-xs font-medium text-accent">{cta}<ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
    </Link>
  );
}

function Spark({ values }: { values: number[] }) {
  return values.some((v) => v !== 0) ? <Sparkline values={values} className="h-8 w-full" /> : null;
}
