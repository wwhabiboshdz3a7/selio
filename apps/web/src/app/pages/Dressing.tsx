import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Check, ClipboardCopy, Eye, Heart, Images, Lightbulb, MessageCircle, Pencil, RefreshCcw, Search, Sparkles, Trophy } from "lucide-react";
import { REPUBLISH_VARIANT_NAMES, type ListingTip, type RepublishVariant } from "@selio/domain";
import { Alert, Button, Card, Dialog, EmptyState, FilterChip, Input, Money, PageHeader, Select, StatStrip, Tag, cn, formatCents, formatDate, formatNumber, formatPercent } from "@selio/ui";
import type { DressingListing, DressingQuery } from "../../lib/data/types";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { ScoreRing, StackedBar, scoreTextTone, scoreTone } from "../../components/charts";

const FILTERS: { value: NonNullable<DressingQuery["filter"]>; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "due", label: "À republier" },
  { value: "7", label: "En ligne 7 j +" },
  { value: "14", label: "14 j +" },
  { value: "30", label: "30 j +" },
  { value: "weak", label: "Note < 60" },
];

const IMPACT: Record<ListingTip["impact"], { label: string; cls: string }> = {
  high: { label: "Impact fort", cls: "bg-accent-soft text-accent" },
  medium: { label: "Impact moyen", cls: "bg-surface-muted text-text" },
  low: { label: "Bonus", cls: "bg-surface-muted text-text-muted" },
};

export default function Dressing() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const [params, setParams] = useSearchParams();
  const query: DressingQuery = { filter: (params.get("filter") as DressingQuery["filter"]) || "all", sort: (params.get("sort") as DressingQuery["sort"]) || "online_desc", q: params.get("q") || undefined };
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const q = useQuery({ queryKey: ["dressing", query], queryFn: () => client.getDressing(query) });
  const all = useQuery({ queryKey: ["dressing", "counts"], queryFn: async () => {
    const d = await client.getDressing({});
    const c = (f: (l: DressingListing) => boolean) => d.listings.filter(f).length;
    return { all: d.listings.length, due: c((l) => l.performance.republishDue), "7": c((l) => l.performance.daysOnline >= 7), "14": c((l) => l.performance.daysOnline >= 14), "30": c((l) => l.performance.daysOnline >= 30), weak: c((l) => l.performance.score < 60) } as Record<string, number>;
  } });
  const [republish, setRepublish] = useState<DressingListing | null>(null);
  const [insight, setInsight] = useState<DressingListing | null>(null);
  const canWrite = session.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Dressing intelligent"
        description="Chaque annonce en ligne reçoit une note sur 100 : visibilité (vues par jour), attractivité (favoris, offres), qualité (photos, titre, description) et prix face au marché. Dès 7 jours en ligne, republiez avec l'une des 10 variantes déjà prêtes."
        actions={<Link to="/app/studio"><Button variant="brand" icon={<Sparkles />}>Générer une annonce</Button></Link>}
      />
      <QueryBoundary query={q}>
        {(d) => (
          <div className="flex flex-col gap-6">
            <StatStrip
              className="grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr_1fr_1.5fr]"
              items={[
                { label: "Note moyenne", value: <span className="flex items-center gap-3"><ScoreRing score={d.summary.averageScore} size={44} stroke={4} label="Note moyenne" scale="listing" /><span className="text-md font-semibold" style={{ color: scoreTextTone(d.summary.averageScore, "listing") }}>{d.summary.averageScore >= 80 ? "Excellente" : d.summary.averageScore >= 60 ? "Bonne" : d.summary.averageScore >= 40 ? "À améliorer" : "Faible"}</span></span>, sub: <>{d.summary.listed} annonce(s) en ligne</> },
                { label: "À republier", value: <span className="text-accent">{d.summary.toRepublish}</span>, sub: <>En ligne depuis {d.republishAfterDays} jours ou plus · <button type="button" onClick={() => set("filter", "due")} className="font-medium text-accent hover:underline">Afficher</button></> },
                { label: "Vues par jour", value: d.summary.viewsPerDay.toFixed(1).replace(".", ","), sub: <>{formatNumber(d.summary.totalViews)} vues au total</> },
                { label: "Taux de favoris", value: formatPercent(d.summary.favoriteRate), sub: <>{formatNumber(d.summary.totalFavorites)} favoris</> },
                { label: "Répartition des notes", value: null, className: "col-span-2 lg:col-span-1", extra: <StackedBar rows={[
                  { label: "Excellentes", value: d.summary.byBand.excellent, tone: scoreTone(80, "listing") },
                  { label: "Bonnes", value: d.summary.byBand.good, tone: scoreTone(60, "listing") },
                  { label: "À améliorer", value: d.summary.byBand.improve, tone: scoreTone(40, "listing") },
                  { label: "Faibles", value: d.summary.byBand.weak, tone: scoreTone(0, "listing") },
                ]} /> },
              ]}
            />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filtrer les annonces">
                    {FILTERS.map((f) => (
                      <FilterChip key={f.value} active={(query.filter ?? "all") === f.value} onClick={() => set("filter", f.value === "all" ? "" : f.value)} icon={f.value === "due" ? <CalendarClock /> : undefined} count={all.data ? all.data[f.value] ?? 0 : null}>
                        {f.label}
                      </FilterChip>
                    ))}
                  </div>
                  <div className="ml-auto flex w-full gap-2 sm:w-auto">
                    <Input className="min-w-0 flex-1 sm:w-56" placeholder="Rechercher…" prefix={<Search />} value={query.q ?? ""} onChange={(e) => set("q", e.target.value)} aria-label="Rechercher dans le dressing" />
                    <Select value={query.sort} onChange={(e) => set("sort", e.target.value)} aria-label="Trier" className="w-auto">
                      <option value="online_desc">En ligne depuis le plus longtemps</option>
                      <option value="score_asc">Note : les plus faibles</option>
                      <option value="score_desc">Note : les meilleures</option>
                      <option value="views_desc">Les plus vues</option>
                      <option value="favorites_desc">Le plus de favoris</option>
                    </Select>
                  </div>
                </div>
                {d.listings.length === 0 ? (
                  <EmptyState title="Aucune annonce pour ce filtre" description="Changez de filtre, ou mettez des articles en vente depuis le générateur." action={<Link to="/app/studio"><Button icon={<Sparkles />}>Générer une annonce</Button></Link>} />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {d.listings.map((l) => <ListingCard key={l.item.id} listing={l} canWrite={canWrite} onRepublish={() => setRepublish(l)} onInsight={() => setInsight(l)} />)}
                  </div>
                )}
              </div>
              <aside className="flex flex-col gap-4">
                <Card>
                  <div className="mb-3 flex items-center gap-2"><Trophy className="size-4 text-gold" aria-hidden /><h2 className="text-md font-semibold">Variantes les plus efficaces</h2></div>
                  {d.leaderboard.filter((r) => r.measured > 0).length === 0 ? <p className="text-sm text-text-muted">Les résultats apparaissent 48 h après les premières republications.</p> : (
                    <ol className="flex flex-col gap-2.5">
                      {[...d.leaderboard].filter((r) => r.measured > 0).sort((a, b) => b.avgViews - a.avgViews).slice(0, 5).map((r, i) => (
                        <li key={r.variantId} className="flex items-center gap-3 text-sm">
                          <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">{i + 1}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-text">{r.name}</span><span className="num block text-xs text-text-muted">{r.uses} utilisation(s)</span></span>
                          <span className="num text-right text-xs"><span className="block font-semibold text-text">{r.avgViews} vues</span><span className="text-text-muted">{String(r.avgFavorites).replace(".", ",")} fav. / 48 h</span></span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
                <Card>
                  <h2 className="mb-2 text-md font-semibold">Comment republier ?</h2>
                  <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-muted">
                    <li>Filtrez « À republier » (en ligne depuis {d.republishAfterDays} j ou plus).</li>
                    <li>Ouvrez « Republier » : 10 variantes prêtes (titre, description, prix, couverture, créneau).</li>
                    <li>Copiez la variante conseillée et remettez l'annonce en ligne.</li>
                    <li>Cliquez « J'ai republié » : la variante est marquée utilisée, son rendement est suivi.</li>
                  </ol>
                  <RepublishDelay current={d.republishAfterDays} />
                  {mode === "demo" ? <p className="mt-3 text-xs text-text-muted">Démonstration : les statistiques des annonces sont simulées. En mode connecté, l'extension Selio relève vues et favoris sur Vinted.</p> : null}
                </Card>
              </aside>
            </div>
          </div>
        )}
      </QueryBoundary>
      {republish ? <RepublishDialog listing={republish} canWrite={canWrite} onClose={() => setRepublish(null)} /> : null}
      {insight ? <InsightDialog listing={insight} onClose={() => setInsight(null)} onRepublish={() => { setRepublish(insight); setInsight(null); }} /> : null}
    </>
  );
}

function ListingCard({ listing, canWrite, onRepublish, onInsight }: { listing: DressingListing; canWrite: boolean; onRepublish: () => void; onInsight: () => void }) {
  const { item, performance: p, plan } = listing;
  const cover = item.photos[0];
  const tip = p.tips[0];
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative aspect-[4/5] bg-surface-muted">
        {cover ? <img src={cover.url} alt={cover.alt || item.title} loading="lazy" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-text-subtle"><Images className="size-8" aria-hidden /></div>}
        <button type="button" onClick={onInsight} className="absolute top-2.5 left-2.5 rounded-full bg-surface p-0.5 shadow-sm" aria-label={`Note ${p.score} sur 100 : voir le détail`}>
          <ScoreRing score={p.score} size={44} stroke={4} scale="listing" />
        </button>
        <span className={cn("absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-1 text-[11px] font-medium shadow-sm", p.republishDue ? "text-accent" : "text-text-muted")}>
          <CalendarClock className="size-3" aria-hidden /> {p.daysOnline} j en ligne
        </span>
        <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white"><Images className="size-3" aria-hidden />{item.photos.length}</span>
        {plan.totalRepublications > 0 ? <span className="absolute right-2.5 bottom-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">{plan.usedCount}/{plan.variants.length} variantes utilisées</span> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/app/items/${item.id}`} className="line-clamp-2 min-w-0 text-sm leading-snug font-medium text-text hover:text-accent">{item.title}</Link>
          <span className="num shrink-0 text-sm font-semibold">{item.listedPriceCents !== null ? formatCents(item.listedPriceCents) : "—"}</span>
        </div>
        <p className="truncate text-xs text-text-muted">{[item.brand, item.size].filter(Boolean).join(" · ") || "—"}</p>
        <div className="num flex items-center gap-3 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1" title="Vues"><Eye className="size-3.5" aria-hidden />{p.views}</span>
          <span className="inline-flex items-center gap-1" title="Favoris"><Heart className="size-3.5" aria-hidden />{p.favorites}</span>
          <span className="inline-flex items-center gap-1" title="Offres"><MessageCircle className="size-3.5" aria-hidden />{p.offers}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
            {p.parts.map((part) => <div key={part.key} className="h-1 overflow-hidden rounded-full bg-surface-muted" title={`${part.label} ${part.points}/${part.max}`}><div className="h-full rounded-full bg-accent-vivid" style={{ width: `${(part.points / part.max) * 100}%` }} /></div>)}
          </div>
          <span className="shrink-0 text-xs font-medium whitespace-nowrap" style={{ color: scoreTextTone(p.score, "listing") }}>{p.band.label}</span>
        </div>
        {tip ? <p className="flex items-start gap-1.5 text-xs text-text-muted"><Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="line-clamp-2">{tip.label}</span></p> : <p className="flex items-center gap-1.5 text-xs text-success"><Check className="size-3.5" aria-hidden />Rien à améliorer</p>}
        <div className="mt-auto flex gap-2 pt-1">
          <Button size="sm" variant="secondary" icon={<RefreshCcw />} className="flex-1" onClick={onRepublish} disabled={!canWrite}>Republier</Button>
          <Button size="sm" variant="ghost" onClick={onInsight}>Détails</Button>
        </div>
      </div>
    </article>
  );
}

function RepublishDialog({ listing, canWrite, onClose }: { listing: DressingListing; canWrite: boolean; onClose: () => void }) {
  const client = useClient();
  const { item, plan, performance } = listing;
  const [copied, setCopied] = useState<string | null>(null);
  const done = useAppMutation((v: RepublishVariant) => client.republishItem(item.id, v.id), { invalidate: ["dressing", "items", "item", "overview", "nav-counts"], success: (it) => `Republication enregistrée : « ${it.title} »`, onSuccess: onClose });
  const copy = (key: string, text: string) => { void navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); };
  const current = item.listedPriceCents ?? 0;
  return (
    <Dialog open onClose={onClose} size="lg" title={`Republier « ${item.title} »`} description={`En ligne depuis ${performance.daysOnline} jours · ${plan.usedCount} variante(s) déjà utilisée(s) sur ${plan.variants.length}. Republier remet l'annonce en tête des nouveautés : alternez les variantes pour ne jamais publier deux fois la même.`}>
      {plan.next ? <Alert tone="info" className="mb-3" title={`Conseillée : variante ${plan.next.index} « ${plan.next.name} »`}>{plan.next.uses === 0 ? "Jamais utilisée sur cette annonce." : "Toutes les variantes ont servi : on reprend la plus performante."} Créneau conseillé : {plan.next.slot}.</Alert> : null}
      <ul className="flex flex-col gap-2.5">
        {plan.variants.map((v) => {
          const isNext = plan.next?.id === v.id;
          const cover = item.photos[v.photoOrder[0] ?? 0];
          const diff = (v.priceCents ?? current) - current;
          return (
            <li key={v.id} className={cn("rounded-lg border p-3", isNext ? "border-accent bg-accent-soft/40" : "border-border")}>
              <div className="flex gap-3">
                {cover ? <img src={cover.url} alt="" className="size-16 shrink-0 rounded-md object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("num inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold", v.uses > 0 ? "bg-accent-soft text-accent" : "bg-surface-muted text-text")}>{v.uses > 0 ? <Check className="size-3.5" aria-hidden /> : v.index}</span>
                    <span className="text-sm font-semibold text-text">{v.name}</span>
                    {isNext ? <Tag accent>Conseillée</Tag> : null}
                    {v.uses > 0 ? <Tag>Utilisée {v.uses}×</Tag> : <Tag>Prête</Tag>}
                    <span className="num ml-auto text-sm font-semibold">{v.priceCents !== null ? formatCents(v.priceCents) : "—"}{diff < 0 ? <span className="ml-1 text-xs font-normal text-success">({formatCents(diff)})</span> : null}</span>
                  </div>
                  <p className="mt-1 text-sm text-text">« {v.title} »</p>
                  <p className="text-xs text-text-muted">{v.strategy} · {v.slot}</p>
                  {v.lastUsed ? <p className="mt-1 text-xs text-text-muted">Utilisée le {formatDate(v.lastUsed.at)} ({v.lastUsed.mode === "auto" ? "automatique" : "manuelle"}){v.result ? <> · <span className="font-medium text-text">48 h : {v.result.views} vues, {v.result.favorites} favoris</span></> : " · mesure en cours"}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" icon={copied === v.id + "t" ? <Check /> : <ClipboardCopy />} onClick={() => copy(v.id + "t", v.title)}>Titre</Button>
                    <Button size="sm" variant="secondary" icon={copied === v.id + "d" ? <Check /> : <ClipboardCopy />} onClick={() => copy(v.id + "d", v.description)}>Description</Button>
                    <Button size="sm" variant={isNext ? "accent" : "ghost"} icon={<RefreshCcw />} onClick={() => done.mutate(v)} loading={done.isPending && done.variables?.id === v.id} disabled={!canWrite}>J'ai republié avec cette variante</Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {item.republications.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Historique des republications</h3>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {[...item.republications].reverse().map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="num text-text-muted">{formatDate(r.at)}</span>
                <span className="font-medium text-text">{REPUBLISH_VARIANT_NAMES[r.variantId] ?? r.variantId}</span>
                <Tag>{r.mode === "auto" ? "Automatique" : "Manuelle"}</Tag>
                <span className="num ml-auto text-xs text-text-muted">avant : {r.before.views} vues · {r.after ? `après 48 h : ${r.after.views} vues, ${r.after.favorites} favoris` : "mesure en cours"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

function InsightDialog({ listing, onClose, onRepublish }: { listing: DressingListing; onClose: () => void; onRepublish: () => void }) {
  const { item, performance: p } = listing;
  return (
    <Dialog open onClose={onClose} size="lg" title={item.title} description={`${p.band.label} · ${p.daysOnline} jours en ligne · ${p.views} vues · ${p.favorites} favoris · ${p.offers} offre(s)`} footer={<><Link to={`/app/items/${item.id}/edit`}><Button variant="secondary" icon={<Pencil />}>Modifier l'annonce</Button></Link><Button variant="accent" icon={<RefreshCcw />} onClick={onRepublish}>Republier</Button></>}>
      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={p.score} size={120} stroke={9} scale="listing" />
          <p className="text-sm font-semibold" style={{ color: scoreTextTone(p.score, "listing") }}>{p.band.label}</p>
          {p.marketPriceCents ? <p className="text-center text-xs text-text-muted">Prix de marché : <Money cents={p.marketPriceCents} /></p> : null}
        </div>
        <div className="flex flex-col gap-3">
          {p.parts.map((part) => (
            <div key={part.key}>
              <div className="flex items-baseline justify-between text-sm"><span className="font-medium text-text">{part.label}</span><span className="num text-xs text-text-muted">{part.points} / {part.max}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-accent-vivid" style={{ width: `${(part.points / part.max) * 100}%` }} /></div>
              <p className="mt-0.5 text-xs text-text-muted">{part.hint}</p>
            </div>
          ))}
        </div>
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Ce qui peut être amélioré</h3>
      {p.tips.length === 0 ? <p className="text-sm text-success">Annonce optimale : rien à signaler.</p> : (
        <ul className="flex flex-col gap-2">
          {p.tips.map((t) => (
            <li key={t.key} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{t.label}</p>
                <p className="text-xs text-text-muted">{t.detail}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", IMPACT[t.impact].cls)}>{IMPACT[t.impact].label}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function RepublishDelay({ current }: { current: number }) {
  const client = useClient();
  const session = useRequiredSession();
  const save = useAppMutation((days: number) => client.updateOrg({ settings: { dressing: { republishAfterDays: days } } }), { invalidate: ["session", "dressing", "nav-counts", "overview"], success: (o) => `Republication conseillée après ${o.settings.dressing.republishAfterDays} jours` });
  const canEdit = session.role === "owner" || session.role === "admin";
  return (
    <label className="mt-3 flex items-center justify-between gap-2 text-sm">
      <span className="text-text-muted">Republier après</span>
      <Select value={String(current)} onChange={(e) => save.mutate(Number(e.target.value))} disabled={!canEdit || save.isPending} className="w-auto" aria-label="Republier après">
        {[5, 7, 10, 14, 21, 30].map((n) => <option key={n} value={n}>{n} jours</option>)}
      </Select>
    </label>
  );
}
