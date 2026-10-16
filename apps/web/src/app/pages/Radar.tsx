import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Radar as RadarIcon, RefreshCw } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, type ItemCategory, type Opportunity, type RadarSearch, type RadarSearchCreate } from "@selio/contracts";
import { REVIEW_THRESHOLD } from "@selio/domain";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Money, PageHeader, Segmented, Tag, cn, formatPercent, formatRelative } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { OpportunityCard, SCORE_CRITERIA, ScoreLegend } from "../components/deals";

type StatusFilter = "good" | "new" | "watching" | "dismissed" | "purchased" | "all";

export default function Radar() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const [params, setParams] = useSearchParams();
  const searches = useQuery({ queryKey: ["searches"], queryFn: () => client.listSearches() });
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("good");
  const opps = useQuery({ queryKey: ["opportunities", selected, status], queryFn: async () => {
    const list = await client.listOpportunities({ searchId: selected ?? undefined, status: status === "all" || status === "good" ? undefined : status });
    return status === "good" ? list.filter((o) => o.score >= REVIEW_THRESHOLD && o.status !== "dismissed") : list;
  } });
  const [editing, setEditing] = useState<RadarSearch | "new" | null>(null);
  const [prefill, setPrefill] = useState<{ brand: string; category: ItemCategory } | null>(null);
  const [del, setDel] = useState<RadarSearch | null>(null);
  const run = useAppMutation((id: string) => client.runSearch(id), { invalidate: ["searches", "opportunities", "purchases", "nav-counts"], success: (r) => `${r.found} nouvelle(s) affaire(s) notée(s)${r.autoBought ? ` · ${r.autoBought} achetée(s) automatiquement (simulé)` : ""}` });
  const remove = useAppMutation((id: string) => client.deleteSearch(id), { invalidate: ["searches", "opportunities"], success: "Recherche supprimée", onSuccess: () => setDel(null) });
  const setOpp = useAppMutation(({ id, s }: { id: string; s: Opportunity["status"] }) => client.setOpportunityStatus(id, s), { invalidate: ["opportunities", "nav-counts"] });
  const buy = useAppMutation((o: Opportunity) => client.quickBuy(o.id), { invalidate: ["purchases", "opportunities", "nav-counts"], success: (p) => (p.status === "blocked" ? "Achat bloqué par les contrôles (voir « À valider »)" : "Achat validé (simulé) : retrouvez-le dans l'historique") });
  const canWrite = session.role !== "viewer";

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
        icon={<RadarIcon />}
        tone="indigo"
        eyebrow="Radar"
        title="Bonnes affaires"
        description="Grâce à vos filtres, le radar repère les articles sur Vinted et note chacun sur 100 : bonne ou mauvaise affaire. Exemple : un pull torsadé Ralph Lauren à 20 €, très bon état, reçoit 80/100 et apparaît dans « À valider »."
        actions={canWrite ? <Button icon={<Plus />} onClick={() => { setPrefill(null); setEditing("new"); }}>Nouvelle recherche</Button> : undefined}
      />

      <Card className="mb-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <h2 className="mb-1 text-md font-semibold">Comment lire la note</h2>
            <p className="mb-3 text-sm text-text-muted">À partir de 75, l'affaire est à valider ; à partir du seuil de l'achat auto ({session.org.settings.autoBuy.threshold}), l'application peut acheter seule{session.org.settings.autoBuy.enabled ? "" : " (achat auto désactivé)"}.</p>
            <ScoreLegend threshold={session.org.settings.autoBuy.enabled ? session.org.settings.autoBuy.threshold : undefined} />
          </div>
          <div>
            <h2 className="mb-2 text-md font-semibold">Les critères de la note</h2>
            <ul className="flex flex-col gap-1.5">
              {SCORE_CRITERIA.map((c) => (
                <li key={c.label} className="flex items-start gap-3 text-sm">
                  <span className="num w-12 shrink-0 rounded-md bg-tone-indigo-soft py-0.5 text-center text-xs font-semibold text-tone-indigo">{c.max} pts</span>
                  <span><span className="font-medium text-text">{c.label}</span> <span className="text-text-muted">— {c.detail}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {mode === "demo" ? <p className="mb-4 text-xs text-text-muted">Démonstration : les annonces proviennent d'un simulateur déterministe (aucune source réelle). En mode connecté, l'extension Selio capte les annonces vues sur Vinted.</p> : null}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-text-subtle uppercase">Vos filtres</p>
          <QueryBoundary query={searches} empty={(d) => d.length === 0 ? <EmptyState title="Aucune recherche" description="Créez une recherche avec marques, tailles, prix maximal et marge cible." /> : null}>
            {(list) => (
              <>
                <button type="button" onClick={() => setSelected(null)} className={cn("card p-3 text-left text-sm font-medium hover:bg-surface-muted", selected === null && "border-accent")}>Toutes les recherches</button>
                {list.map((s) => (
                  <div key={s.id} className={cn("card p-3 text-sm", selected === s.id && "border-accent")}>
                    <button type="button" className="w-full text-left" onClick={() => setSelected(s.id)}>
                      <span className="block font-medium">{s.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">{[...s.criteria.brands, ...s.criteria.sizes.map((x) => `T. ${x}`)].slice(0, 6).map((t) => <Tag key={t}>{t}</Tag>)}</span>
                      <span className="mt-1 block text-xs text-text-muted">Prix max <Money cents={s.criteria.maxPriceCents} /> · marge cible <Money cents={s.targetMarginCents} /> ou {formatPercent(s.targetMarginRate)}</span>
                      <span className="block text-xs text-text-muted">{s.lastRunAt ? `Analysée ${formatRelative(s.lastRunAt)}` : "Jamais exécutée"}</span>
                    </button>
                    {canWrite ? <div className="mt-2 flex gap-1"><Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => run.mutate(s.id)} loading={run.isPending && run.variables === s.id}>Analyser</Button><Button size="sm" variant="ghost" onClick={() => { setPrefill(null); setEditing(s); }}>Modifier</Button><Button size="sm" variant="danger" onClick={() => setDel(s)}>Supprimer</Button></div> : null}
                  </div>
                ))}
              </>
            )}
          </QueryBoundary>
        </aside>
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented ariaLabel="Affaires" size="sm" value={status} onChange={setStatus} items={[{ value: "good", label: `Notées ${REVIEW_THRESHOLD} et +` }, { value: "new", label: "Nouvelles" }, { value: "watching", label: "Suivies" }, { value: "purchased", label: "Achetées" }, { value: "dismissed", label: "Écartées" }, { value: "all", label: "Toutes" }]} />
            <Link to="/app/purchase" className="text-sm font-medium text-text-muted hover:text-text">À valider et historique →</Link>
          </div>
          <QueryBoundary query={opps} empty={(d) => d.length === 0 ? <EmptyState icon={<RadarIcon />} title="Aucune affaire ici" description="Lancez « Analyser » sur une recherche, ou changez de filtre." /> : null}>
            {(list) => (
              <div className="flex flex-col gap-3">
                {list.map((o) => <OpportunityCard key={o.id} o={o} canWrite={canWrite} onBuy={() => buy.mutate(o)} buying={buy.isPending && buy.variables?.id === o.id} onStatus={(s) => setOpp.mutate({ id: o.id, s })} />)}
              </div>
            )}
          </QueryBoundary>
        </section>
      </div>
      {editing ? <SearchDialog search={editing === "new" ? null : editing} prefill={prefill} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} danger title={`Supprimer « ${del?.name} » ?`} description="Les affaires associées seront supprimées." confirmLabel="Supprimer" />
    </>
  );
}

function SearchDialog({ search, prefill, onClose }: { search: RadarSearch | null; prefill: { brand: string; category: ItemCategory } | null; onClose: () => void }) {
  const client = useClient();
  const [form, setForm] = useState<RadarSearchCreate & { brandsText: string; sizesText: string; keywordsText: string }>({
    name: search?.name ?? (prefill ? `${prefill.brand} · ${ITEM_CATEGORY_LABELS[prefill.category]}` : ""), criteria: search?.criteria ?? { brands: [], categories: prefill ? [prefill.category] : [], sizes: [], conditions: [], maxPriceCents: 3500, keywords: [] }, budgetCents: search?.budgetCents ?? 15000, targetMarginRate: search?.targetMarginRate ?? 0.4, targetMarginCents: search?.targetMarginCents ?? 2000, enabled: search?.enabled ?? true, provider: "demo",
    brandsText: search?.criteria.brands.join(", ") ?? prefill?.brand ?? "", sizesText: search?.criteria.sizes.join(", ") ?? "", keywordsText: search?.criteria.keywords.join(", ") ?? "",
  });
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const payload = (): RadarSearchCreate => ({ name: form.name, criteria: { ...form.criteria!, brands: split(form.brandsText), sizes: split(form.sizesText), keywords: split(form.keywordsText) }, budgetCents: form.budgetCents, targetMarginRate: form.targetMarginRate, targetMarginCents: form.targetMarginCents, enabled: form.enabled, provider: "demo" });
  const save = useAppMutation(() => (search ? client.updateSearch(search.id, payload()) : client.createSearch(payload())), { invalidate: ["searches"], success: search ? "Recherche enregistrée" : "Recherche créée", onSuccess: onClose });
  const crit = form.criteria!;
  return (
    <Dialog open onClose={onClose} title={search ? "Modifier la recherche" : "Nouvelle recherche"} description="Le radar ne retient que les annonces qui correspondent à ces filtres, puis les note sur 100." size="md" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!form.name.trim()}>{search ? "Enregistrer" : "Créer"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" required className="sm:col-span-2">{(p) => <Input id={p.id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Marques" hint="Séparées par des virgules.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.brandsText} onChange={(e) => setForm({ ...form, brandsText: e.target.value })} />}</Field>
        <Field label="Tailles">{(p) => <Input id={p.id} value={form.sizesText} onChange={(e) => setForm({ ...form, sizesText: e.target.value })} />}</Field>
        <Field label="Mots-clés">{(p) => <Input id={p.id} value={form.keywordsText} onChange={(e) => setForm({ ...form, keywordsText: e.target.value })} />}</Field>
        <Field label="Catégories">{(p) => <select id={p.id} multiple className="min-h-24 w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm" value={crit.categories} onChange={(e) => setForm({ ...form, criteria: { ...crit, categories: Array.from(e.target.selectedOptions).map((o) => o.value as (typeof ITEM_CATEGORIES)[number]) } })}>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</select>}</Field>
        <Field label="Prix d'achat maximal">{(p) => <MoneyInput id={p.id} value={crit.maxPriceCents ?? 0} onChange={(v) => setForm({ ...form, criteria: { ...crit, maxPriceCents: v ?? 0 } })} allowEmpty={false} />}</Field>
        <Field label="Budget de la recherche">{(p) => <MoneyInput id={p.id} value={form.budgetCents ?? 0} onChange={(v) => setForm({ ...form, budgetCents: v ?? 0 })} allowEmpty={false} />}</Field>
        <Field label="Marge cible (%)">{(p) => <Input id={p.id} type="number" min={0} max={100} value={Math.round((form.targetMarginRate ?? 0) * 100)} onChange={(e) => setForm({ ...form, targetMarginRate: Number(e.target.value) / 100 })} />}</Field>
        <Field label="Marge cible (€)">{(p) => <MoneyInput id={p.id} value={form.targetMarginCents ?? 0} onChange={(v) => setForm({ ...form, targetMarginCents: v ?? 0 })} allowEmpty={false} />}</Field>
      </div>
    </Dialog>
  );
}
