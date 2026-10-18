import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { InventoryItem } from "@selio/contracts";
import { EmptyState, ErrorState, FilterChip, PageHeader, SkeletonRows, StatStrip, Tag, buttonClass, formatCents, formatDate, formatNumber } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import { ScoreRing } from "../../../components/charts";
import { ItemStatusBadge, ItemThumb } from "../../components/common";
import { summarizeGenerated, useAllItems, useDressingScores } from "../studio-data";

type Filter = "all" | "online" | "sold" | "draft";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "online", label: "En ligne" },
  { value: "sold", label: "Vendues" },
  { value: "draft", label: "Brouillons" },
];

const DAY = 86_400_000;

function matches(item: InventoryItem, f: Filter): boolean {
  if (f === "online") return item.status === "listed" || item.status === "reserved";
  if (f === "sold") return item.status === "sold";
  if (f === "draft") return item.status === "in_stock";
  return true;
}

function soldIn(item: InventoryItem): number | null {
  if (!item.soldAt || !item.listedAt) return null;
  return Math.max(0, Math.round((new Date(item.soldAt).getTime() - new Date(item.listedAt).getTime()) / DAY));
}

export default function StudioGenerated() {
  const client = useClient();
  const items = useAllItems();
  const scores = useDressingScores();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const [filter, setFilter] = useState<Filter>("all");
  const summary = useMemo(() => (items.data ? summarizeGenerated(items.data.items, scores.data) : null), [items.data, scores.data]);
  const accountName = (id: string | null) => {
    const c = connections.data?.find((x) => x.id === id);
    if (!c) return null;
    return typeof c.config.displayHandle === "string" && c.config.displayHandle ? `@${c.config.displayHandle}` : c.label;
  };
  const counts: Record<Filter, number> = summary ? { all: summary.generated.length, online: summary.online, sold: summary.sold, draft: summary.drafts } : { all: 0, online: 0, sold: 0, draft: 0 };
  const list = summary ? summary.generated.filter((i) => matches(i, filter)) : [];

  return (
    <>
      <PageHeader
        eyebrow="Selio Studio"
        title="Annonces générées"
        description="Les annonces rédigées avec le générateur, de la plus récente à la plus ancienne. Celles qui sont en ligne portent leur note du dressing, calculée sur 100 à partir de leurs vues, favoris, contenu et prix."
        actions={<Link to="/studio" className={buttonClass({ variant: "brand" })}><Sparkles aria-hidden /> Créer une annonce</Link>}
      />

      {items.isError ? <ErrorState description={errorMessage(items.error)} onRetry={() => void items.refetch()} /> : !summary ? <SkeletonRows /> : summary.generated.length === 0 ? (
        <EmptyState title="Aucune annonce générée pour l'instant" description="Ajoutez les photos d'un article : l'IA rédige l'annonce, vous la relisez puis l'enregistrez. Elle apparaîtra ici avec sa note." action={<Link to="/studio" className={buttonClass({ variant: "brand" })}><Sparkles aria-hidden /> Créer une annonce</Link>} />
      ) : (
        <>
          <StatStrip
            className="mb-6 grid-cols-2 lg:grid-cols-4"
            items={[
              { label: "Annonces générées", value: formatNumber(summary.generated.length), sub: `${summary.drafts} brouillon(s)` },
              { label: "En ligne", value: formatNumber(summary.online) },
              { label: "Vendues", value: formatNumber(summary.sold) },
              { label: "Note moyenne en ligne", value: summary.averageScore !== null ? `${summary.averageScore}/100` : "—", sub: summary.othersAverageScore !== null ? `Autres annonces : ${summary.othersAverageScore}/100` : "Aucune autre annonce en ligne" },
            ]}
          />

          <div className="mb-4 flex flex-wrap gap-1" role="radiogroup" aria-label="Filtrer les annonces générées">
            {FILTERS.map((f) => (
              <FilterChip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)} count={counts[f.value]}>{f.label}</FilterChip>
            ))}
          </div>

          {list.length === 0 ? (
            <EmptyState title="Aucune annonce pour ce filtre" description="Changez de filtre pour retrouver vos autres annonces générées." />
          ) : (
            <ul className="card divide-y divide-border" aria-label="Annonces générées">
              {list.map((item) => {
                const perf = scores.data?.get(item.id);
                const days = soldIn(item);
                const account = accountName(item.connectionId);
                return (
                  <li key={item.id}>
                    <Link to={`/app/items/${item.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60 md:gap-4 md:px-5">
                      <ItemThumb photos={item.photos} title={item.title} size={52} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium text-text">{item.title}</p>
                        <p className="mt-0.5 truncate text-xs text-text-muted">
                          {[item.brand, item.size, item.listedPriceCents !== null ? formatCents(item.listedPriceCents) : null, account].filter(Boolean).join(" · ")}
                        </p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <ItemStatusBadge status={item.status} />
                          <Tag>{item.attributes.generatedBy === "fallback" ? "Gabarit de secours" : "Rédigée par l'IA"}</Tag>
                          <span className="text-xs text-text-muted">Créée le {formatDate(item.createdAt)}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                        {perf ? (
                          <>
                            <ScoreRing score={perf.score} size={44} stroke={4} scale="listing" label="Note du dressing" />
                            <span className="text-[11px] text-text-muted">{perf.band.label}</span>
                          </>
                        ) : item.status === "sold" ? (
                          <span className="text-sm text-text">{days !== null ? <>Vendue en <span className="num font-semibold">{days}</span> j</> : "Vendue"}</span>
                        ) : item.status === "in_stock" ? (
                          <span className="text-xs text-text-muted">Note à la<br />mise en ligne</span>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-xs text-text-muted">La note du dressing additionne visibilité (25), attractivité (25), qualité de l'annonce (30) et prix face aux ventes comparables (20). Les détails et les pistes d'amélioration sont dans le <Link to="/app/dressing" className="font-medium text-accent hover:underline">dressing intelligent</Link>.</p>
        </>
      )}
    </>
  );
}
