import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Crown, Heart, Info, Radar, Target, TrendingUp, Users } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS } from "@selio/contracts";
import type { NicheInsight, SellerInsight } from "@selio/domain";
import { Alert, Avatar, Button, Card, Dialog, EmptyState, IconTile, PageHeader, Segmented, Select, Tag, cn, formatCents, formatNumber, formatPercent } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import { QueryBoundary } from "../components/common";
import { ColumnChart, DonutChart, HorizontalBars } from "../../components/charts";

const WINDOWS = [{ value: "7", label: "7 jours" }, { value: "30", label: "30 jours" }, { value: "90", label: "90 jours" }] as const;
const COMPETITION: Record<NicheInsight["competition"], string> = { faible: "bg-tone-emerald-soft text-tone-emerald", moyenne: "bg-tone-amber-soft text-tone-amber", forte: "bg-tone-rose-soft text-tone-rose" };

function Growth({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-text-muted">—</span>;
  const up = value >= 0;
  const pct = Math.min(999, Math.abs(Math.round(value * 100)));
  return <span className={cn("num inline-flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap", up ? "text-success" : "text-danger")}>{up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}{up ? "+" : "−"}{pct} %</span>;
}

function Meter({ value, tone = "var(--tone-indigo)" }: { value: number; tone?: string }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: tone }} /></div>;
}

export default function Market() {
  const client = useClient();
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState<"7" | "30" | "90">("30");
  const [category, setCategory] = useState("");
  const [seller, setSeller] = useState<SellerInsight | null>(null);
  const q = useQuery({ queryKey: ["market", windowDays, category], queryFn: () => client.getMarketInsights({ windowDays: Number(windowDays), category: category || undefined }) });
  return (
    <>
      <PageHeader
        icon={<TrendingUp />}
        tone="rose"
        title="Analyse des revendeurs"
        description="Qui vend le plus, dans quelles niches, à quel prix et à quel rythme. Repérez les niches à forte demande et peu concurrencées, puis lancez une recherche « Bonnes affaires » dessus."
        actions={<>
          <Segmented ariaLabel="Période" size="sm" value={windowDays} onChange={setWindowDays} items={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie" className="w-auto"><option value="">Toutes catégories</option>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</Select>
        </>}
      />
      <QueryBoundary query={q}>
        {(d) => (
          <div className="flex flex-col gap-6">
            <Alert tone="info">
              {d.source === "demo_simulator"
                ? <>Démonstration : marché fictif de {d.totals.sellers} revendeurs ({formatNumber(d.observedCount)} annonces observées). En mode connecté, l'analyse se calcule sur les annonces réellement repérées par le radar et l'extension Selio — aucune donnée n'est inventée.</>
                : <>Calculé à partir de {formatNumber(d.observedCount)} annonce(s) observée(s) par le radar et l'extension. Les ventes ne sont comptées que lorsqu'elles ont été constatées.</>}
            </Alert>
            {d.totals.sellers === 0 ? (
              <EmptyState icon={<Users />} title="Aucune observation pour l'instant" description="Installez l'extension Selio et lancez des recherches « Bonnes affaires » : chaque annonce vue alimente l'analyse des vendeurs et des niches." />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: "Revendeurs suivis", value: formatNumber(d.totals.sellers), icon: <Users />, tone: "rose" as const },
                    { label: "Ventes observées", value: formatNumber(d.totals.sold), icon: <TrendingUp />, tone: "indigo" as const },
                    { label: "Chiffre d'affaires estimé", value: formatCents(d.totals.revenueCents, { compact: true }), icon: <Crown />, tone: "amber" as const },
                    { label: "Prix moyen de vente", value: formatCents(d.totals.averagePriceCents), icon: <Target />, tone: "teal" as const },
                    { label: "Taux d'écoulement", value: formatPercent(d.totals.sellThrough), icon: <Heart />, tone: "emerald" as const },
                  ].map((k) => (
                    <Card key={k.label} className="flex items-center gap-3">
                      <IconTile icon={k.icon} tone={k.tone} size={40} />
                      <div className="min-w-0"><p className="truncate text-sm text-text-muted">{k.label}</p><p className="num text-lg font-semibold text-text">{k.value}</p></div>
                    </Card>
                  ))}
                </div>

                <Card padding="none">
                  <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-4 md:px-5">
                    <div><h2 className="text-md font-semibold">Top revendeurs</h2><p className="text-sm text-text-muted">Classés par chiffre d'affaires estimé sur {d.windowDays} jours · cliquez pour le détail</p></div>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead><tr className="border-y border-border text-left">
                        {["#", "Revendeur", "Niche principale", "Ventes", "CA estimé", "Prix moyen", "Rotation", "Tendance", "Top marques"].map((h) => <th key={h} className="th-label px-4 py-2.5 first:pl-5">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {d.sellers.slice(0, 12).map((s, i) => (
                          <tr key={s.handle} tabIndex={0} onClick={() => setSeller(s)} onKeyDown={(e) => { if (e.key === "Enter") setSeller(s); }} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted">
                            <td className="num px-4 py-3 pl-5 font-semibold text-text-muted">{i < 3 ? <Crown className={cn("size-4", i === 0 ? "text-tone-amber" : "text-text-subtle")} aria-label={`${i + 1}e`} /> : i + 1}</td>
                            <td className="px-4 py-3"><span className="flex items-center gap-2.5"><Avatar name={s.handle.replace(/[._]/g, " ")} size={30} colored /><span className="font-medium text-text">@{s.handle}</span></span></td>
                            <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text">{s.niche}<span className="num text-text-muted">{Math.round(s.nicheShare * 100)} %</span></span></td>
                            <td className="num px-4 py-3 font-medium">{s.sold}</td>
                            <td className="num px-4 py-3 font-semibold">{formatCents(s.revenueCents, { compact: true })}</td>
                            <td className="num px-4 py-3">{formatCents(s.averagePriceCents, { compact: true })}</td>
                            <td className="px-4 py-3"><div className="flex w-32 items-center gap-2"><Meter value={s.sellThrough} tone="var(--tone-teal)" /><span className="num text-xs whitespace-nowrap text-text-muted">{Math.round(s.sellThrough * 100)} %</span></div></td>
                            <td className="px-4 py-3"><Growth value={s.growth} /></td>
                            <td className="px-4 py-3 text-xs text-text-muted">{s.topBrands.map((b) => b.label).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <Card padding="none">
                    <div className="px-4 pt-4 md:px-5"><h2 className="text-md font-semibold">Niches les plus demandées</h2><p className="text-sm text-text-muted">Demande = rotation (vendus / mis en vente) et volume de ventes · concurrence = nombre de revendeurs actifs</p></div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead><tr className="border-y border-border text-left">{["Niche", "Demande", "Ventes", "Prix médian", "Concurrence", "Tendance"].map((h) => <th key={h} className="th-label px-4 py-2.5 first:pl-5">{h}</th>)}</tr></thead>
                        <tbody>
                          {d.niches.slice(0, 10).map((n) => (
                            <tr key={n.key} className="border-b border-border last:border-0">
                              <td className="px-4 py-2.5 pl-5 font-medium whitespace-nowrap text-text">{n.label}</td>
                              <td className="px-4 py-2.5"><div className="flex w-32 items-center gap-2"><Meter value={n.demand / 100} tone="var(--tone-rose)" /><span className="num text-xs font-semibold">{n.demand}</span></div></td>
                              <td className="num px-4 py-2.5">{n.sold}<span className="text-xs text-text-muted"> / {n.sold + n.listings}</span></td>
                              <td className="num px-4 py-2.5">{formatCents(n.medianPriceCents, { compact: true })}</td>
                              <td className="px-4 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", COMPETITION[n.competition])}>{n.competition} · {n.sellers} vendeur{n.sellers > 1 ? "s" : ""}</span></td>
                              <td className="px-4 py-2.5"><Growth value={n.growth} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                  <Card>
                    <div className="mb-3 flex items-center gap-2"><IconTile icon={<Target />} tone="emerald" size={30} /><h2 className="text-md font-semibold">Opportunités de niche</h2></div>
                    <p className="mb-3 text-sm text-text-muted">Forte demande, concurrence faible ou moyenne : là où un nouveau revendeur peut se faire une place.</p>
                    {d.opportunities.length === 0 ? <p className="text-sm text-text-muted">Aucune niche ne se détache sur cette période.</p> : (
                      <ul className="flex flex-col gap-2.5">
                        {d.opportunities.map((n) => (
                          <li key={n.key} className="rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between gap-2"><span className="font-medium text-text">{n.label}</span><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", COMPETITION[n.competition])}>concurrence {n.competition}</span></div>
                            <p className="num mt-1 text-xs text-text-muted">Demande {n.demand}/100 · {n.sold} ventes · rotation {Math.round(n.sellThrough * 100)} % · prix médian {formatCents(n.medianPriceCents, { compact: true })}</p>
                            <Button size="sm" variant="secondary" className="mt-2" icon={<Radar />} onClick={() => navigate(`/app/radar?brand=${encodeURIComponent(n.brand)}&category=${n.category}`)}>Chercher des affaires sur cette niche</Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card><h2 className="mb-3 text-md font-semibold">Marques les plus vendues</h2><HorizontalBars rows={d.brands.slice(0, 8).map((b) => ({ label: b.brand, value: b.sold, hint: `${formatCents(b.averagePriceCents, { compact: true })} · ${b.sellers} vendeur(s)` }))} formatValue={(v) => `${v} ventes`} tone="var(--tone-rose)" /></Card>
                  <Card><h2 className="mb-3 text-md font-semibold">Ventes par tranche de prix</h2><ColumnChart rows={d.priceBands.map((b) => ({ label: b.label, value: b.sold }))} tone="var(--tone-indigo)" /><p className="mt-2 text-xs text-text-muted">La tranche la plus vendue est mise en avant.</p></Card>
                  <Card><h2 className="mb-3 text-md font-semibold">Catégories</h2><DonutChart rows={d.categories.map((c) => ({ label: c.label, value: c.sold }))} formatValue={(v) => `${v}`} centerLabel="ventes" /></Card>
                </div>
                <p className="flex items-start gap-1.5 text-xs text-text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Les chiffres d'affaires sont des estimations : somme des prix affichés des articles constatés vendus. Selio n'accède à aucune donnée privée des vendeurs.</p>
              </>
            )}
          </div>
        )}
      </QueryBoundary>
      {seller ? (
        <Dialog open onClose={() => setSeller(null)} size="lg" title={`@${seller.handle}`} description={`Niche principale : ${seller.niche} (${Math.round(seller.nicheShare * 100)} % de ses ventes)`}>
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              { l: "Ventes", v: String(seller.sold) },
              { l: "CA estimé", v: formatCents(seller.revenueCents, { compact: true }) },
              { l: "Prix moyen", v: formatCents(seller.averagePriceCents, { compact: true }) },
              { l: "Annonces actives", v: String(seller.listings) },
            ].map((k) => <div key={k.l} className="rounded-lg bg-surface-muted p-3"><p className="text-xs text-text-muted">{k.l}</p><p className="num text-md font-semibold">{k.v}</p></div>)}
          </div>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-semibold">Ventes par jour de la semaine</h3><ColumnChart rows={["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((label, i) => ({ label, value: seller.weekdaySales[i] ?? 0 }))} tone="var(--tone-teal)" height={150} /></div>
            <div className="flex flex-col gap-4">
              <div><h3 className="mb-2 text-sm font-semibold">Marques</h3><HorizontalBars rows={seller.topBrands.map((b) => ({ label: b.label, value: b.share }))} formatValue={(v) => formatPercent(v)} tone="var(--tone-rose)" /></div>
              <div><h3 className="mb-2 text-sm font-semibold">Catégories</h3><HorizontalBars rows={seller.topCategories.map((b) => ({ label: b.label, value: b.share }))} formatValue={(v) => formatPercent(v)} tone="var(--tone-indigo)" /></div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-text-muted"><Tag>Rotation {Math.round(seller.sellThrough * 100)} %</Tag><Tag>{String(seller.favoritesPerListing).replace(".", ",")} favoris / annonce</Tag><span className="ml-auto">Tendance <Growth value={seller.growth} /></span></div>
        </Dialog>
      ) : null}
    </>
  );
}
