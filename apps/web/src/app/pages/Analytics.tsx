import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS } from "@selio/contracts";
import type { PeriodPreset } from "@selio/domain";
import { Button, Card, KpiCard, Money, PageHeader, Select, Table, TableWrap, Td, Th, Tr, formatCents, formatNumber, formatPercent } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import { downloadFile } from "../../lib/download";
import { BarChart, HorizontalBars } from "../../components/charts";
import { Delta, PeriodPicker, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Analytics() {
  const client = useClient();
  const [period, setPeriod] = useState<PeriodPreset>("90d");
  const [category, setCategory] = useState("");
  const [channel, setChannel] = useState("");
  const filters = { period, category: category || undefined, channel: channel || undefined };
  const q = useQuery({ queryKey: ["analytics", filters], queryFn: () => client.getAnalytics(filters) });
  const exportCsv = useAppMutation(() => client.exportAnalyticsCsv(filters), { success: "Export généré", onSuccess: (csv) => downloadFile(`selio-analyses-${period}.csv`, csv) });
  return (
    <>
      <PageHeader title="Analyses" description="Chaque indicateur est calculé depuis vos commandes et votre stock. Les conventions sont affichées en bas de page." actions={<><PeriodPicker value={period} onChange={setPeriod} /><Button variant="secondary" icon={<Download />} onClick={() => exportCsv.mutate()} loading={exportCsv.isPending}>Exporter CSV</Button></>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 md:max-w-lg">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie"><option value="">Toutes catégories</option>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</Select>
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal"><option value="">Tous canaux</option><option value="demo">Simulateur</option><option value="vinted">Vinted</option></Select>
      </div>
      <QueryBoundary query={q}>
        {(d) => (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Chiffre d'affaires" value={formatCents(d.sales.revenueCents)} delta={{ value: <Delta current={d.sales.revenueCents} previous={d.previousSales.revenueCents} format={formatCents} />, tone: "neutral" }} />
              <KpiCard label="Marge brute" value={formatCents(d.sales.marginCents)} delta={{ value: <Delta current={d.sales.marginCents} previous={d.previousSales.marginCents} format={formatCents} />, tone: "neutral" }} hint={`${formatPercent(d.sales.marginRate)} du CA`} />
              <KpiCard label="Panier moyen" value={formatCents(d.sales.averageBasketCents)} hint={`${formatNumber(d.sales.orderCount)} vente(s)`} />
              <KpiCard label="Rotation du stock" value={d.stock.averageDaysToSell === null ? "—" : `${d.stock.averageDaysToSell} j`} hint={`Taux d'écoulement ${formatPercent(d.stock.sellThroughRate)}`} />
            </div>
            <Card>
              <h2 className="text-md font-semibold">CA et marge brute</h2>
              <BarChart className="mt-4" data={d.series.map((s) => ({ label: s.label, primary: s.revenueCents, secondary: s.marginCents }))} primaryLabel="CA" secondaryLabel="Marge brute" />
            </Card>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card><h2 className="mb-3 text-md font-semibold">Par catégorie</h2>{d.byCategory.length ? <HorizontalBars rows={d.byCategory.map((r) => ({ label: ITEM_CATEGORY_LABELS[r.key as keyof typeof ITEM_CATEGORY_LABELS] ?? r.key, value: r.revenueCents, hint: `${r.orderCount} · marge ${formatPercent(r.marginRate)}` }))} /> : <p className="text-sm text-text-muted">Aucune vente.</p>}</Card>
              <Card><h2 className="mb-3 text-md font-semibold">Par canal</h2>{d.byChannel.length ? <HorizontalBars rows={d.byChannel.map((r) => ({ label: r.key === "demo" ? "Simulateur" : r.key, value: r.revenueCents, hint: `${r.orderCount} · marge ${formatPercent(r.marginRate)}` }))} /> : <p className="text-sm text-text-muted">Aucune vente.</p>}</Card>
              <Card><h2 className="mb-3 text-md font-semibold">Par marque</h2>{d.byBrand.length ? <HorizontalBars rows={d.byBrand.map((r) => ({ label: r.key, value: r.marginCents, hint: `${r.orderCount} vente(s)` }))} /> : <p className="text-sm text-text-muted">Aucune vente.</p>}<p className="mt-2 text-xs text-text-muted">Classé par marge brute.</p></Card>
            </div>
            <Card padding="none">
              <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Meilleures marges de la période</h2>
              <TableWrap className="mt-3 rounded-none border-0 border-t">
                <Table dense>
                  <thead><tr><Th>Article</Th><Th>Marque</Th><Th numeric>Vente</Th><Th numeric>Marge brute</Th></tr></thead>
                  <tbody>{d.topItems.length === 0 ? <tr><td colSpan={4} className="h-16 px-4 text-center text-sm text-text-muted">Aucune vente sur la période.</td></tr> : d.topItems.map((t) => <Tr key={t.order.id}><Td><Link to={`/app/orders/${t.order.id}`} className="hover:text-accent">{t.item.title}</Link></Td><Td className="text-text-muted">{t.item.brand ?? "—"}</Td><Td numeric><Money cents={t.order.salePriceCents} /></Td><Td numeric><Money cents={t.marginCents} signed /></Td></Tr>)}</tbody>
                </Table>
              </TableWrap>
            </Card>
            <Card>
              <h2 className="text-md font-semibold">Conventions de calcul</h2>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted">
                <li>Chiffre d'affaires = somme des prix de vente des commandes payées, expédiées, livrées ou terminées (date de création de la commande).</li>
                <li>Marge brute = prix de vente − frais plateforme vendeur − port à charge vendeur − autres coûts − (prix d'achat + frais d'acquisition figés à la vente).</li>
                <li>Taux de marge = marge brute / chiffre d'affaires. Panier moyen = CA / nombre de ventes.</li>
                <li>Rotation = jours moyens entre la date d'achat (ou de création) et la vente. Taux d'écoulement = vendus / (vendus + actifs).</li>
                <li>Montants en centimes entiers. La marge brute n'inclut ni impôts, ni cotisations, ni frais fixes : ce n'est pas un bénéfice net.</li>
              </ul>
            </Card>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
