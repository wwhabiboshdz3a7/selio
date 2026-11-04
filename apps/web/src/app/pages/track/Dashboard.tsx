import { Link } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Camera, Filter, Gauge, Plus } from "lucide-react";
import type { TrackFilter } from "@selio/contracts";
import { Card, EmptyState, PageHeader, Tag, buttonClass, formatCents, formatNumber, formatRelative } from "@selio/ui";
import { Sparkline } from "../../../components/charts";
import { useClient } from "../../../lib/data/provider";
import type { TrackTrendsView, TrackUsageView } from "../../../lib/data/types";
import { criteriaTags } from "../../../lib/track";
import { QueryBoundary } from "../../components/common";
import { Change, SourceState, TrackGate, TrackNotices, TrackQuotaStrip } from "./shared";

/**
 * Selio Track · tableau de bord : filtres suivis avec leur tendance sur 30 jours, quotas du mois et
 * source des données (simulateur, ou lecture en direct à valider juridiquement). Statistiques seulement.
 */
export default function TrackDashboard() {
  return <TrackGate>{(u) => <Dashboard usage={u} />}</TrackGate>;
}

function Dashboard({ usage }: { usage: TrackUsageView }) {
  const client = useClient();
  const filters = useQuery({ queryKey: ["track-filters"], queryFn: () => client.trackFilters() });
  const list = filters.data ?? [];
  const trends = useQueries({ queries: list.map((f) => ({ queryKey: ["track-trends", f.id, 30], queryFn: () => client.trackTrends(f.id, 30) })) });
  return (
    <>
      <PageHeader
        eyebrow="Selio Track"
        title="Tableau de bord"
        description="Les statistiques du marché Vinted sur vos filtres : prix médian, annonces actives, nouvelles et disparues. Aucune annonce n'est republiée."
        actions={<Link to="/track/filtres" className={buttonClass({ variant: "primary" })}><Plus aria-hidden />Suivre un filtre</Link>}
      />
      <div className="flex flex-col gap-6">
        <TrackNotices notices={usage.notices} />
        <TrackQuotaStrip usage={usage} />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card padding="none">
            <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-4 md:px-5">
              <div>
                <h2 className="text-md font-semibold">Filtres suivis</h2>
                <p className="text-sm text-text-muted">Tendance sur 30 jours · chaque filtre est lu toutes les 2 h, une seule fois pour tous les clients qui le suivent.</p>
              </div>
              <Link to="/track/filtres" className="text-sm font-medium text-accent hover:underline">Gérer les filtres</Link>
            </div>
            <QueryBoundary query={filters} empty={(d) => (d.length === 0 ? <EmptyState className="py-10" icon={<Filter />} title="Aucun filtre suivi" description="Suivez une recherche (marques, catégories, tailles, prix) : Track en tire le prix médian et le rythme des ventes." action={<Link to="/track/filtres" className={buttonClass({ variant: "secondary" })}>Suivre un filtre</Link>} /> : null)}>
              {(d) => (
                <ul className="mt-3 divide-y divide-border border-t border-border">
                  {d.map((f, i) => <FilterRow key={f.id} filter={f} trends={trends[i]?.data ?? null} loading={trends[i]?.isPending ?? false} />)}
                </ul>
              )}
            </QueryBoundary>
          </Card>
          <div className="flex flex-col gap-4">
            <SourceState usage={usage} />
            <Card>
              <h2 className="mb-3 text-md font-semibold">Raccourcis</h2>
              <div className="flex flex-col gap-2">
                <Link to="/track/niches" className={buttonClass({ variant: "secondary", fullWidth: true })}><Gauge aria-hidden />Scanner une niche</Link>
                <Link to="/track/photo" className={buttonClass({ variant: "secondary", fullWidth: true })}><Camera aria-hidden />Estimer à partir d'une photo</Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function FilterRow({ filter, trends, loading }: { filter: TrackFilter; trends: TrackTrendsView | null; loading: boolean }) {
  const last = trends?.points[trends.points.length - 1] ?? null;
  const prices = (trends?.points ?? []).map((p) => p.medianPriceCents).filter((v): v is number => v !== null);
  return (
    <li>
      <Link to={`/track/filtres/${filter.id}`} className="grid gap-3 px-4 py-3 hover:bg-surface-muted sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center md:px-5">
        <span className="min-w-0">
          <span className="block truncate font-medium text-text">{filter.name}{filter.enabled ? null : <span className="ml-2 text-xs font-normal text-text-muted">(en pause)</span>}</span>
          <span className="mt-1 flex flex-wrap gap-1">{criteriaTags(filter.criteria).slice(0, 5).map((t) => <Tag key={t}>{t}</Tag>)}</span>
          <span className="mt-1 block text-xs text-text-muted">{filter.lastReadAt ? `Lu ${formatRelative(filter.lastReadAt)}` : "Première lecture à venir"}</span>
        </span>
        <span className="flex items-center gap-3">
          {prices.length > 1 ? <Sparkline values={prices} className="h-8 w-28" /> : <span className="w-28 text-xs text-text-muted">{loading ? "…" : "Pas encore de tendance"}</span>}
        </span>
        <span className="num text-right text-sm">
          <span className="block font-semibold text-text">{last?.medianPriceCents != null ? formatCents(last.medianPriceCents) : "—"}</span>
          <span className="block text-xs text-text-muted"><Change value={trends?.medianPriceChange ?? null} /> · {formatNumber(last?.listedCount ?? 0)} en ligne</span>
          <span className="block text-xs text-text-muted">{formatNumber(trends?.goneTotal ?? 0)} disparues (estimation)</span>
        </span>
      </Link>
    </li>
  );
}
