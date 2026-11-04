import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LineChart } from "lucide-react";
import { TRACK_SOURCE_LABELS, TRACK_TRENDS_DEFAULT_DAYS, type TrackFilter } from "@selio/contracts";
import { Card, EmptyState, ErrorState, PageHeader, Segmented, StatStrip, Tag, formatCents, formatDateTime, formatNumber, formatPercent } from "@selio/ui";
import { AreaChart, ColumnChart, HorizontalBars } from "../../../components/charts";
import { useClient } from "../../../lib/data/provider";
import type { TrackTrendsView, TrackUsageView } from "../../../lib/data/types";
import { criteriaTags, trendWindows } from "../../../lib/track";
import { QueryBoundary } from "../../components/common";
import { Change, TrackGate, TrackNotices } from "./shared";

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/**
 * Selio Track · tendances d'un filtre : prix médian, annonces actives, nouvelles et disparues (« vendues ou
 * retirées », une estimation), parts de marques. Sur 7, 30 ou 90 jours, dans la limite de l'historique.
 */
export default function TrackFilterDetail() {
  return <TrackGate>{(u) => <Detail usage={u} />}</TrackGate>;
}

function Detail({ usage }: { usage: TrackUsageView }) {
  const { id = "" } = useParams();
  const client = useClient();
  const windows = trendWindows(usage.historyMonths);
  const [days, setDays] = useState(String(windows.includes(TRACK_TRENDS_DEFAULT_DAYS) ? TRACK_TRENDS_DEFAULT_DAYS : windows[windows.length - 1] ?? TRACK_TRENDS_DEFAULT_DAYS));
  const filters = useQuery({ queryKey: ["track-filters"], queryFn: () => client.trackFilters() });
  const trends = useQuery({ queryKey: ["track-trends", id, Number(days)], queryFn: () => client.trackTrends(id, Number(days)), enabled: id !== "" });
  const filter = filters.data?.find((f) => f.id === id) ?? null;
  return (
    <>
      <Link to="/track/filtres" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden />Filtres suivis</Link>
      <QueryBoundary query={filters} skeleton="spinner">
        {() => (!filter ? <ErrorState title="Filtre introuvable" description="Ce filtre a été retiré ou n'existe pas." /> : (
          <>
            <PageHeader
              eyebrow="Selio Track · tendances"
              title={filter.name}
              description={<FilterSummary filter={filter} />}
              actions={windows.length > 1 ? <Segmented ariaLabel="Période" size="sm" value={days} onChange={setDays} items={windows.map((d) => ({ value: String(d), label: `${d} jours` }))} /> : undefined}
            />
            <QueryBoundary query={trends}>{(t) => <Trends trends={t} filter={filter} />}</QueryBoundary>
          </>
        ))}
      </QueryBoundary>
    </>
  );
}

function FilterSummary({ filter }: { filter: TrackFilter }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {criteriaTags(filter.criteria).map((t) => <Tag key={t}>{t}</Tag>)}
      <Tag>Prix max {formatCents(filter.criteria.maxPriceCents)}</Tag>
    </span>
  );
}

function Trends({ trends: t, filter }: { trends: TrackTrendsView; filter: TrackFilter }) {
  if (t.points.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState icon={<LineChart />} title="Pas encore de lecture" description={`Ce filtre est lu toutes les 2 h : les premières statistiques arrivent après la prochaine lecture${filter.nextReadAt ? ` (vers ${formatDateTime(filter.nextReadAt)})` : ""}.`} />
        <TrackNotices notices={t.notices} />
      </div>
    );
  }
  const last = t.points[t.points.length - 1]!;
  const priced = t.points.filter((p) => p.medianPriceCents !== null);
  const newTotal = t.points.reduce((n, p) => n + p.newCount, 0);
  return (
    <div className="flex flex-col gap-6">
      <TrackNotices notices={t.notices} />
      <StatStrip
        className="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Prix médian", value: last.medianPriceCents !== null ? formatCents(last.medianPriceCents) : "—", sub: <>Sur {t.days} jours : <Change value={t.medianPriceChange} /></> },
          { label: "Annonces actives", value: formatNumber(last.listedCount), sub: "À la dernière lecture du jour" },
          { label: "Nouvelles annonces", value: formatNumber(newTotal), sub: `Sur ${t.days} jours` },
          { label: "Disparues (estimation)", value: formatNumber(t.goneTotal), sub: "Vendues ou retirées" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-md font-semibold">Prix médian par jour</h2>
          <p className="mb-3 text-sm text-text-muted">Médiane des prix affichés des annonces en ligne.</p>
          {priced.length ? <AreaChart data={priced.map((p) => ({ label: dayLabel(p.day), value: p.medianPriceCents! }))} label="Prix médian" /> : <p className="text-sm text-text-muted">Aucun prix lu sur la période.</p>}
        </Card>
        <Card>
          <h2 className="text-md font-semibold">Annonces actives</h2>
          <p className="mb-3 text-sm text-text-muted">Une page de résultats au plus par lecture.</p>
          <AreaChart data={t.points.map((p) => ({ label: dayLabel(p.day), value: p.listedCount }))} formatValue={(v) => formatNumber(Math.round(v))} label="Annonces actives" />
        </Card>
        <Card>
          <h2 className="text-md font-semibold">Nouvelles et disparues, sur les 14 derniers jours</h2>
          <p className="mb-3 text-sm text-text-muted">Disparue = plus en ligne à la lecture suivante : vendue OU retirée (estimation).</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-medium">Nouvelles</h3><ColumnChart rows={t.points.slice(-14).map((p) => ({ label: dayLabel(p.day).slice(0, 2), value: p.newCount }))} height={150} /></div>
            <div><h3 className="mb-2 text-sm font-medium">Disparues (estimation)</h3><ColumnChart rows={t.points.slice(-14).map((p) => ({ label: dayLabel(p.day).slice(0, 2), value: p.goneCount }))} height={150} /></div>
          </div>
        </Card>
        <Card>
          <h2 className="text-md font-semibold">Parts de marques</h2>
          <p className="mb-3 text-sm text-text-muted">Annonces en ligne à la dernière lecture, par marque.</p>
          {t.brandShares?.length ? <HorizontalBars rows={t.brandShares.map((b) => ({ label: b.brand, value: b.share, hint: `${b.count} annonce(s)` }))} formatValue={(v) => formatPercent(v)} /> : <p className="text-sm text-text-muted">Parts de marques indisponibles pour cette lecture.</p>}
        </Card>
      </div>
      <p className="text-xs text-text-muted">
        {t.snapshots} lecture(s) sur la période · source : {t.source ? TRACK_SOURCE_LABELS[t.source] : "aucune lecture"}{filter.nextReadAt ? ` · prochaine lecture vers ${formatDateTime(filter.nextReadAt)}` : ""} · empreinte partagée {filter.fingerprint.slice(0, 10)}…
      </p>
    </div>
  );
}
