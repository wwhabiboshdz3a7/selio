import { useQuery } from "@tanstack/react-query";
import { LineChart } from "lucide-react";
import { ITEM_CATEGORY_LABELS } from "@selio/contracts";
import { Card, EmptyState, PageHeader, StatStrip, formatCents, formatDate, formatNumber, formatPercent } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { TrackGate, TrackNotices } from "./shared";

/**
 * Selio Track · flux des ventes (Agence) : ventes et disparitions récentes agrégées par marque et
 * catégorie. Aucun pseudo, aucune annonce : seulement des volumes et des prix médians.
 */
export default function TrackSales() {
  return <TrackGate agency={{ title: "Flux des ventes" }}>{() => <Sales />}</TrackGate>;
}

function Sales() {
  const client = useClient();
  const feed = useQuery({ queryKey: ["track-sales"], queryFn: () => client.trackSalesFeed() });
  return (
    <>
      <PageHeader eyebrow="Selio Track · Agence" title="Flux des ventes" description="Ce qui se vend, par marque et catégorie : volumes et prix médians, sans aucun vendeur ni annonce." />
      <QueryBoundary query={feed}>
        {(f) => {
          const sold = f.rows.reduce((n, r) => n + r.sold, 0);
          const estimated = sold ? f.rows.reduce((n, r) => n + r.sold * r.estimatedShare, 0) / sold : 0;
          return (
            <div className="flex flex-col gap-6">
              <TrackNotices notices={f.notices} />
              <StatStrip className="grid-cols-1 sm:grid-cols-3" items={[
                { label: `Ventes sur ${f.days} jours`, value: formatNumber(sold) },
                { label: "Niches (marque × catégorie)", value: formatNumber(f.rows.length) },
                { label: "Part estimée (disparitions)", value: formatPercent(estimated), sub: "Prix final estimé au dernier prix affiché" },
              ]} />
              {f.rows.length === 0 ? <EmptyState icon={<LineChart />} title="Aucune vente sur la période" description="Les ventes apparaissent au fil des lectures des filtres suivis." /> : (
                <Card padding="none">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead><tr className="border-b border-border text-left">{["Marque", "Catégorie", "Ventes", "Dont estimées", "Prix médian", "Dernière vente"].map((h, i) => <th key={h} className={`th-label px-4 py-2.5 first:pl-5 ${i >= 2 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
                      <tbody>
                        {f.rows.map((r) => (
                          <tr key={`${r.brand}|${r.category}`} className="border-b border-border last:border-0">
                            <td className="px-4 py-2.5 pl-5 font-medium text-text">{r.brand}</td>
                            <td className="px-4 py-2.5 text-text-muted">{ITEM_CATEGORY_LABELS[r.category]}</td>
                            <td className="num px-4 py-2.5 text-right font-semibold">{formatNumber(r.sold)}</td>
                            <td className="num px-4 py-2.5 text-right">{formatPercent(r.estimatedShare)}</td>
                            <td className="num px-4 py-2.5 text-right">{r.medianPriceCents !== null ? formatCents(r.medianPriceCents) : "—"}</td>
                            <td className="num px-4 py-2.5 text-right text-text-muted">{r.lastSoldAt ? formatDate(r.lastSoldAt) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
