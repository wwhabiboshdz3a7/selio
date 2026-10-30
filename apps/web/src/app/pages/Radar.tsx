import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Radar as RadarIcon, RefreshCw, Zap } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, RADAR_MAX_PRIORITY_SEARCHES, RADAR_READ_INTERVAL_SECONDS, type ItemCategory, type MarketplaceConnection, type Opportunity, type RadarSearch, type RadarSearchCreate, type RadarSourceKind } from "@selio/contracts";
import { REVIEW_THRESHOLD, can, isActiveAccount } from "@selio/domain";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Money, PageHeader, Segmented, Select, Tag, Toggle, cn, formatPercent, formatRelative, useToast } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import type { AutoBuyStatus, RadarRunResult } from "../../lib/data/types";
import { canAddPriority, formatDuration, priorityCount, type LiveReadiness } from "../../lib/radar";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { OpportunityCard, SCORE_CRITERIA, ScoreLegend } from "../components/deals";
import { LiveReadinessNote, RADAR_KEYS, RadarMetricsPanel, SearchRhythm, SourceTag, useAutoBuyStatus, useLiveReadiness } from "../components/radar";

type StatusFilter = "good" | "new" | "watching" | "dismissed" | "purchased" | "all";

/** Message d'une analyse : affaires trouvées, ou lecture reportée avec son explication. */
function runMessage(r: RadarRunResult): string {
  const found = `${r.found} nouvelle(s) affaire(s) notée(s)`;
  const auto = r.autoBought ? ` · ${r.autoBought} achetée(s) automatiquement (simulé)` : "";
  return r.source === "cloud" && r.simulated ? `${found} · lecture en direct simulée${auto}` : `${found}${auto}`;
}

export default function Radar() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const searches = useQuery({ queryKey: ["searches"], queryFn: () => client.listSearches() });
  const metrics = useQuery({ queryKey: ["radar-metrics"], queryFn: () => client.radarMetrics(30) });
  const auto = useAutoBuyStatus();
  const readiness = useLiveReadiness();
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("good");
  const opps = useQuery({ queryKey: ["opportunities", selected, status], queryFn: async () => {
    const list = await client.listOpportunities({ searchId: selected ?? undefined, status: status === "all" || status === "good" ? undefined : status });
    return status === "good" ? list.filter((o) => o.score >= REVIEW_THRESHOLD && o.status !== "dismissed") : list;
  } });
  const [editing, setEditing] = useState<RadarSearch | "new" | null>(null);
  const [prefill, setPrefill] = useState<{ brand: string; category: ItemCategory } | null>(null);
  const [del, setDel] = useState<RadarSearch | null>(null);
  const run = useAppMutation((id: string) => client.runSearch(id), {
    invalidate: RADAR_KEYS,
    success: (r) => (r.skipped ? null : runMessage(r)),
    onSuccess: (r) => { if (r.skipped) toast({ tone: "info", title: "Lecture reportée", description: r.message ?? undefined }); },
  });
  const remove = useAppMutation((id: string) => client.deleteSearch(id), { invalidate: ["searches", "opportunities", "radar-metrics"], success: "Recherche supprimée", onSuccess: () => setDel(null) });
  const setOpp = useAppMutation(({ id, s }: { id: string; s: Opportunity["status"] }) => client.setOpportunityStatus(id, s), { invalidate: ["opportunities", "nav-counts"] });
  const buy = useAppMutation((o: Opportunity) => client.quickBuy(o.id), { invalidate: [...RADAR_KEYS, "items"], success: (p) => (p.status === "blocked" ? "Achat bloqué par les contrôles (voir « À valider »)" : "Achat enregistré : prix d'achat reporté dans Manager") });
  const canWrite = can(session.role, "radar.write");
  // Priorité (30 s) : visible seulement si Radar Auto est activable (verrou serveur ouvert).
  const priorityVisible = auto.data?.serverEnabled === true;

  // Arrivée depuis l'analyse des revendeurs : « Chercher des affaires sur cette niche ».
  useEffect(() => {
    const brand = params.get("brand");
    const category = params.get("category") as ItemCategory | null;
    if (brand && category && ITEM_CATEGORIES.includes(category)) {
      setPrefill({ brand, category });
      setEditing("new");
      const p = new URLSearchParams(params);
      p.delete("brand");
      p.delete("category");
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  return (
    <>
      <PageHeader
        eyebrow="Radar"
        title="Bonnes affaires"
        description="Le radar relit vos recherches, note chaque annonce sur 100 et vous alerte sur le téléphone. En direct, il lit les pages de recherche Vinted depuis votre compte Achat, avec Selio Cloud, toutes les 60 s au plus. Vous achetez vous-même en un clic."
        actions={canWrite ? <Button icon={<Plus />} onClick={() => { setPrefill(null); setEditing("new"); }}>Nouvelle recherche</Button> : undefined}
      />

      {mode === "demo" ? <p className="mb-4 text-xs text-text-muted">Démonstration : les annonces proviennent d'un simulateur (aucune page Vinted lue). La recherche « en direct » est simulée et ses mesures sont fictives.</p> : null}

      <QueryBoundary query={metrics} skeleton="spinner">{(m) => <RadarMetricsPanel metrics={m} className="mb-6" />}</QueryBoundary>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-2">
          <p className="px-1 text-xs font-medium tracking-wide text-text-muted uppercase">Vos recherches</p>
          <QueryBoundary query={searches} empty={(d) => d.length === 0 ? <EmptyState title="Aucune recherche" description="Créez une recherche avec marques, tailles, prix maximal et marge cible." /> : null}>
            {(list) => (
              <>
                <button type="button" onClick={() => setSelected(null)} aria-pressed={selected === null} className={cn("rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors", selected === null ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text")}>Toutes les recherches</button>
                {list.map((s) => (
                  <div key={s.id} className={cn("card p-3 text-sm transition-colors", selected === s.id && "border-accent ring-1 ring-accent")} aria-label={`Recherche ${s.name}`} role="group">
                    <button type="button" className="w-full text-left" onClick={() => setSelected(s.id)}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{s.name}</span>
                        {!s.enabled ? <Tag>En pause</Tag> : null}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        <SourceTag search={s} />
                        {s.priority && priorityVisible ? <Tag accent><Zap className="mr-1 size-3" aria-hidden />Prioritaire</Tag> : null}
                        {[...s.criteria.brands, ...s.criteria.sizes.map((x) => `T. ${x}`)].slice(0, 5).map((t) => <Tag key={t}>{t}</Tag>)}
                      </span>
                      <span className="mt-1.5 block text-xs text-text-muted">Prix max <Money cents={s.criteria.maxPriceCents} /> · marge cible <Money cents={s.targetMarginCents} /> ou {formatPercent(s.targetMarginRate)}</span>
                    </button>
                    <SearchRhythm search={s} className="mt-1.5" />
                    <span className="mt-0.5 block text-xs text-text-muted">{s.lastReadAt ?? s.lastRunAt ? `Lue ${formatRelative((s.lastReadAt ?? s.lastRunAt)!)}` : "Jamais lue"}</span>
                    {s.source === "cloud" ? <LiveReadinessNote readiness={readiness ? readiness(s) : null} className="mt-1.5" /> : null}
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.source !== "cloud" || mode === "demo"
                          ? <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => run.mutate(s.id)} loading={run.isPending && run.variables === s.id}>{s.source === "cloud" ? "Simuler une lecture" : "Analyser"}</Button>
                          : null}
                        <Button size="sm" variant="ghost" onClick={() => { setPrefill(null); setEditing(s); }}>Modifier</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDel(s)}>Supprimer</Button>
                      </div>
                    ) : null}
                    {s.source === "cloud" && mode !== "demo" ? <p className="mt-1.5 text-xs text-text-muted">Lue automatiquement par Selio Cloud (worker), jamais depuis votre navigateur.</p> : null}
                  </div>
                ))}
              </>
            )}
          </QueryBoundary>
        </aside>
        <section className="min-w-0" aria-label="Affaires repérées">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented ariaLabel="Affaires" size="sm" value={status} onChange={setStatus} items={[{ value: "good", label: `Notées ${REVIEW_THRESHOLD} et +` }, { value: "new", label: "Nouvelles" }, { value: "watching", label: "Suivies" }, { value: "purchased", label: "Achetées" }, { value: "dismissed", label: "Écartées" }, { value: "all", label: "Toutes" }]} />
            <Link to="/app/purchase" className="text-sm font-medium text-text-muted hover:text-text">À valider et historique →</Link>
          </div>
          <p className="mb-3 text-xs text-text-muted">Triées par note, de la meilleure à la moins bonne. Ouvrez une affaire pour l'acheter vous-même sur Vinted en un clic.</p>
          <QueryBoundary query={opps} empty={(d) => d.length === 0 ? <EmptyState icon={<RadarIcon />} title="Aucune affaire ici" description="Lancez « Analyser » sur une recherche, ou changez de filtre." /> : null}>
            {(list) => (
              <div className="flex flex-col gap-3">
                {list.map((o) => <OpportunityCard key={o.id} o={o} to={`/app/radar/affaires/${o.id}`} canWrite={canWrite} onBuy={() => buy.mutate(o)} buying={buy.isPending && buy.variables?.id === o.id} onStatus={(s) => setOpp.mutate({ id: o.id, s })} />)}
              </div>
            )}
          </QueryBoundary>
        </section>
      </div>

      <Card className="mt-8">
        <h2 className="mb-1 text-md font-semibold">Comment lire la note</h2>
        <p className="mb-4 text-sm text-text-muted">À partir de 75, l'affaire est à valider ; à partir du seuil de Radar Auto ({session.org.settings.autoBuy.threshold}), l'application pourrait acheter seule{auto.data?.active ? "" : " (Radar Auto verrouillé)"}.</p>
        <ScoreLegend threshold={auto.data?.active ? session.org.settings.autoBuy.threshold : undefined} />
        <h2 className="mt-6 mb-3 border-t border-border pt-5 text-md font-semibold">Les critères de la note</h2>
        <ul className="grid gap-x-8 gap-y-2.5 md:grid-cols-2 2xl:grid-cols-3">
          {SCORE_CRITERIA.map((c) => (
            <li key={c.label} className="flex items-start gap-3 text-sm">
              <span className="num w-12 shrink-0 rounded-md bg-surface-muted py-0.5 text-center text-xs font-medium text-text">{c.max} pts</span>
              <span><span className="font-medium text-text">{c.label}</span> <span className="text-text-muted">— {c.detail}</span></span>
            </li>
          ))}
        </ul>
      </Card>

      {editing ? <SearchDialog search={editing === "new" ? null : editing} all={searches.data ?? []} prefill={prefill} auto={auto.data ?? null} readiness={readiness} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} danger title={`Supprimer « ${del?.name} » ?`} description="Les affaires associées seront supprimées." confirmLabel="Supprimer" />
    </>
  );
}

type SearchForm = RadarSearchCreate & { brandsText: string; sizesText: string; keywordsText: string };

function SearchDialog({ search, all, prefill, auto, readiness, onClose }: {
  search: RadarSearch | null;
  all: RadarSearch[];
  prefill: { brand: string; category: ItemCategory } | null;
  auto: AutoBuyStatus | null;
  readiness: ((s: Pick<RadarSearch, "connectionId"> | null) => LiveReadiness) | null;
  onClose: () => void;
}) {
  const client = useClient();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  // Comptes « Achat » actifs seulement : jamais un compte Perso ni un compte de vente.
  const purchaseAccounts = (connections.data ?? []).filter((c) => c.usage === "purchase" && isActiveAccount(c));
  const [form, setForm] = useState<SearchForm>({
    name: search?.name ?? (prefill ? `${prefill.brand} · ${ITEM_CATEGORY_LABELS[prefill.category]}` : ""), criteria: search?.criteria ?? { brands: [], categories: prefill ? [prefill.category] : [], sizes: [], conditions: [], maxPriceCents: 3500, keywords: [] }, budgetCents: search?.budgetCents ?? 15000, targetMarginRate: search?.targetMarginRate ?? 0.4, targetMarginCents: search?.targetMarginCents ?? 2000, enabled: search?.enabled ?? true,
    source: search?.source ?? "demo", priority: search?.priority ?? false, connectionId: search?.connectionId ?? null,
    brandsText: search?.criteria.brands.join(", ") ?? prefill?.brand ?? "", sizesText: search?.criteria.sizes.join(", ") ?? "", keywordsText: search?.criteria.keywords.join(", ") ?? "",
  });
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const source: RadarSourceKind = form.source ?? "demo";
  const priorityVisible = auto?.serverEnabled === true;
  const priorityFree = canAddPriority(all, search?.id ?? null);
  const payload = (): RadarSearchCreate => ({
    name: form.name, criteria: { ...form.criteria!, brands: split(form.brandsText), sizes: split(form.sizesText), keywords: split(form.keywordsText) }, budgetCents: form.budgetCents, targetMarginRate: form.targetMarginRate, targetMarginCents: form.targetMarginCents, enabled: form.enabled,
    source, provider: source === "cloud" ? "vinted" : "demo", connectionId: source === "cloud" ? form.connectionId ?? null : null,
    // La priorité (30 s) n'a de sens qu'en direct ; le serveur refuse une 4e recherche prioritaire.
    priority: source === "cloud" && priorityVisible ? form.priority === true : false,
  });
  const save = useAppMutation(() => (search ? client.updateSearch(search.id, payload()) : client.createSearch(payload())), { invalidate: ["searches", "radar-metrics"], success: search ? "Recherche enregistrée" : "Recherche créée", onSuccess: onClose });
  const crit = form.criteria!;
  const ready = readiness ? readiness({ connectionId: form.connectionId ?? null }) : null;
  const accountName = (c: MarketplaceConnection) => (typeof c.config.displayHandle === "string" && c.config.displayHandle ? `@${c.config.displayHandle} — ${c.label}` : c.label);
  return (
    <Dialog open onClose={onClose} title={search ? "Modifier la recherche" : "Nouvelle recherche"} description="Le radar ne retient que les annonces qui correspondent à ces filtres, puis les note sur 100." size="md" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!form.name.trim()}>{search ? "Enregistrer" : "Créer"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" required className="sm:col-span-2">{(p) => <Input id={p.id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-text">Source des annonces</p>
          <Segmented ariaLabel="Source des annonces" size="sm" value={source} onChange={(v) => setForm({ ...form, source: v, priority: v === "cloud" ? form.priority : false })} items={[{ value: "demo", label: "Simulateur" }, { value: "cloud", label: "En direct (Selio Cloud)" }]} />
          {source === "cloud" ? (
            <div className="mt-2 rounded-md bg-surface-muted px-3 py-2.5 text-xs text-text-muted">
              <p>Lecture des pages de recherche Vinted toutes les {formatDuration(RADAR_READ_INTERVAL_SECONDS)}, depuis votre compte <span className="font-medium text-text">Achat</span> relié à Selio Cloud (jamais un compte Perso ni de vente). Au premier CAPTCHA ou « trop de requêtes », la lecture s'arrête, le compte passe en pause et vous êtes prévenu ; au-delà de 1 blocage pour 1 000 pages, le rythme ralentit tout seul.</p>
              <LiveReadinessNote readiness={ready} className="mt-2" />
            </div>
          ) : <p className="mt-2 text-xs text-text-muted">Annonces fictives du simulateur : rien n'est lu sur Vinted, rien n'est mesuré.</p>}
        </div>
        {source === "cloud" ? (
          <Field label="Compte Achat lu" className="sm:col-span-2" hint={<>Les comptes Vente et Perso ne sont jamais lus. <Link to="/cloud/comptes" className="underline underline-offset-2">Comptes Cloud</Link></>}>
            {(p) => (
              <Select id={p.id} aria-describedby={p.describedBy} value={form.connectionId ?? ""} onChange={(e) => setForm({ ...form, connectionId: e.target.value || null })}>
                <option value="">{purchaseAccounts[0] ? `Automatique : ${accountName(purchaseAccounts[0])}` : "Aucun compte Achat actif"}</option>
                {purchaseAccounts.map((c) => <option key={c.id} value={c.id}>{accountName(c)}</option>)}
              </Select>
            )}
          </Field>
        ) : null}
        {source === "cloud" && priorityVisible ? (
          <div className="sm:col-span-2">
            <Toggle
              label="Recherche prioritaire (Radar Auto)"
              description={!form.priority && !priorityFree
                ? `${RADAR_MAX_PRIORITY_SEARCHES} recherches prioritaires au plus : retirez la priorité d'une autre recherche d'abord.`
                : `Relue toutes les 30 s quand Radar Auto est actif. ${priorityCount(all, search?.id ?? null)} / ${RADAR_MAX_PRIORITY_SEARCHES} déjà prioritaire(s).`}
              checked={form.priority === true}
              onChange={(v) => setForm({ ...form, priority: v })}
              disabled={!form.priority && !priorityFree}
            />
          </div>
        ) : null}
        <Field label="Marques" hint="Séparées par des virgules.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.brandsText} onChange={(e) => setForm({ ...form, brandsText: e.target.value })} />}</Field>
        <Field label="Tailles">{(p) => <Input id={p.id} value={form.sizesText} onChange={(e) => setForm({ ...form, sizesText: e.target.value })} />}</Field>
        <Field label="Mots-clés">{(p) => <Input id={p.id} value={form.keywordsText} onChange={(e) => setForm({ ...form, keywordsText: e.target.value })} />}</Field>
        <Field label="Catégories">{(p) => <select id={p.id} multiple className="min-h-24 w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm" value={crit.categories} onChange={(e) => setForm({ ...form, criteria: { ...crit, categories: Array.from(e.target.selectedOptions).map((o) => o.value as (typeof ITEM_CATEGORIES)[number]) } })}>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</select>}</Field>
        <Field label="Prix d'achat maximal">{(p) => <MoneyInput id={p.id} value={crit.maxPriceCents ?? 0} onChange={(v) => setForm({ ...form, criteria: { ...crit, maxPriceCents: v ?? 0 } })} allowEmpty={false} />}</Field>
        <Field label="Budget de la recherche">{(p) => <MoneyInput id={p.id} value={form.budgetCents ?? 0} onChange={(v) => setForm({ ...form, budgetCents: v ?? 0 })} allowEmpty={false} />}</Field>
        <Field label="Marge cible (%)">{(p) => <Input id={p.id} type="number" min={0} max={100} value={Math.round((form.targetMarginRate ?? 0) * 100)} onChange={(e) => setForm({ ...form, targetMarginRate: Number(e.target.value) / 100 })} />}</Field>
        <Field label="Marge cible (€)">{(p) => <MoneyInput id={p.id} value={form.targetMarginCents ?? 0} onChange={(v) => setForm({ ...form, targetMarginCents: v ?? 0 })} allowEmpty={false} />}</Field>
        <div className="sm:col-span-2"><Toggle label="Recherche active" description={form.enabled ? "Relue au rythme indiqué." : "En pause : plus aucune lecture."} checked={form.enabled !== false} onChange={(v) => setForm({ ...form, enabled: v })} /></div>
      </div>
    </Dialog>
  );
}
