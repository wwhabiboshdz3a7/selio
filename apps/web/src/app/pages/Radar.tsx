import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Plus, RefreshCw, ShoppingCart } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, type Opportunity, type RadarSearch, type RadarSearchCreate } from "@selio/contracts";
import { Alert, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Money, PageHeader, Segmented, Tag, cn, formatPercent, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Radar() {
  const client = useClient();
  const session = useRequiredSession();
  const searches = useQuery({ queryKey: ["searches"], queryFn: () => client.listSearches() });
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<"new" | "watching" | "dismissed" | "all">("new");
  const opps = useQuery({ queryKey: ["opportunities", selected, status], queryFn: () => client.listOpportunities({ searchId: selected ?? undefined, status: status === "all" ? undefined : status }) });
  const [editing, setEditing] = useState<RadarSearch | "new" | null>(null);
  const [del, setDel] = useState<RadarSearch | null>(null);
  const run = useAppMutation((id: string) => client.runSearch(id), { invalidate: ["searches", "opportunities"], success: (r) => `${r.found} nouvelle(s) opportunité(s) (simulation déterministe)` });
  const remove = useAppMutation((id: string) => client.deleteSearch(id), { invalidate: ["searches", "opportunities"], success: "Recherche supprimée", onSuccess: () => setDel(null) });
  const setOpp = useAppMutation(({ id, s }: { id: string; s: Opportunity["status"] }) => client.setOpportunityStatus(id, s), { invalidate: ["opportunities"] });
  const purchase = useAppMutation((o: Opportunity) => client.createPurchaseRequest({ opportunityId: o.id, maxPriceCents: o.observed.priceCents + o.observed.shippingCents, budgetCents: searches.data?.find((s) => s.id === o.searchId)?.budgetCents ?? 0 }), { invalidate: ["purchases"], success: "Demande d'achat créée : à confirmer dans Achat assisté" });
  const canWrite = session.role !== "viewer";
  return (
    <>
      <PageHeader title="Radar et opportunités" description="Recherches enregistrées, opportunités classées avec justification. Ce qui est observé est séparé de ce qui est estimé." actions={canWrite ? <Button icon={<Plus />} onClick={() => setEditing("new")}>Nouvelle recherche</Button> : undefined} />
      <Alert tone="info" className="mb-4">En démonstration, les opportunités proviennent d'un simulateur déterministe. Aucune source réelle n'est consultée : un connecteur réel n'existera que s'il est techniquement et contractuellement possible.</Alert>
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2">
          <QueryBoundary query={searches} empty={(d) => d.length === 0 ? <EmptyState title="Aucune recherche" description="Créez une recherche avec critères, budget et marge cible." /> : null}>
            {(list) => (
              <>
                <button type="button" onClick={() => setSelected(null)} className={cn("card p-3 text-left text-sm hover:bg-surface-muted", selected === null && "border-accent")}>Toutes les recherches</button>
                {list.map((s) => (
                  <div key={s.id} className={cn("card p-3 text-sm", selected === s.id && "border-accent")}>
                    <button type="button" className="w-full text-left" onClick={() => setSelected(s.id)}>
                      <span className="block font-medium">{s.name}</span>
                      <span className="block text-xs text-text-muted">Budget <Money cents={s.budgetCents} /> · marge cible {formatPercent(s.targetMarginRate)} ou <Money cents={s.targetMarginCents} /></span>
                      <span className="block text-xs text-text-muted">{s.lastRunAt ? `Analysée ${formatRelative(s.lastRunAt)}` : "Jamais exécutée"}</span>
                    </button>
                    {canWrite ? <div className="mt-2 flex gap-1"><Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => run.mutate(s.id)} loading={run.isPending && run.variables === s.id}>Analyser</Button><Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Modifier</Button><Button size="sm" variant="danger" onClick={() => setDel(s)}>Supprimer</Button></div> : null}
                  </div>
                ))}
              </>
            )}
          </QueryBoundary>
        </aside>
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented ariaLabel="Statut" size="sm" value={status} onChange={setStatus} items={[{ value: "new", label: "Nouvelles" }, { value: "watching", label: "Suivies" }, { value: "dismissed", label: "Écartées" }, { value: "all", label: "Toutes" }]} />
            <Link to="/app/purchase" className="text-sm text-text-muted hover:text-text">Demandes d'achat</Link>
          </div>
          <QueryBoundary query={opps} empty={(d) => d.length === 0 ? <EmptyState title="Aucune opportunité" description="Lancez une analyse depuis une recherche." /> : null}>
            {(list) => (
              <div className="flex flex-col gap-3">
                {list.map((o) => (
                  <Card key={o.id} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-md font-semibold">{o.title}</h2>
                        <Tag accent>Score {o.score}/100</Tag>
                        <Tag>{o.status === "new" ? "Nouvelle" : o.status === "watching" ? "Suivie" : o.status === "purchased" ? "Achat demandé" : "Écartée"}</Tag>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border border-border p-3 text-sm">
                          <p className="text-xs font-medium text-text-muted">Observé</p>
                          <p className="mt-1">Prix <Money cents={o.observed.priceCents} className="font-medium" /> + port <Money cents={o.observed.shippingCents} /></p>
                          <p className="text-text-muted">{[o.observed.brand, o.observed.size, o.observed.condition ? ITEM_CONDITION_LABELS[o.observed.condition] : null].filter(Boolean).join(" · ")}</p>
                          <p className="text-xs text-text-muted">Vu {formatRelative(o.observed.seenAt)} · source : {o.observed.source === "demo_simulator" ? "simulateur" : o.observed.source}</p>
                        </div>
                        <div className="rounded-md border border-dashed border-border-strong p-3 text-sm">
                          <p className="text-xs font-medium text-text-muted">Estimé</p>
                          <p className="mt-1">Revente <Money cents={o.estimate.resalePriceCents} className="font-medium" /> → marge <Money cents={o.estimate.marginCents} signed /> ({formatPercent(o.estimate.marginRate)})</p>
                          <p className="text-xs text-text-muted">Confiance {o.estimate.confidence} · {o.estimate.comparableCount} comparable(s)</p>
                          <p className="text-xs text-text-muted">{o.estimate.method}</p>
                        </div>
                      </div>
                      <details className="mt-2 text-xs text-text-muted"><summary className="cursor-pointer">Pourquoi ce score</summary><ul className="mt-1 list-disc pl-5">{o.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
                    </div>
                    {canWrite ? (
                      <div className="flex flex-row flex-wrap gap-2 md:flex-col">
                        <Button size="sm" variant="secondary" icon={<ShoppingCart />} onClick={() => purchase.mutate(o)} disabled={o.status === "purchased"} loading={purchase.isPending && purchase.variables?.id === o.id}>Préparer l'achat</Button>
                        {o.status !== "watching" ? <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => setOpp.mutate({ id: o.id, s: "watching" })}>Suivre</Button> : null}
                        {o.status !== "dismissed" ? <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={() => setOpp.mutate({ id: o.id, s: "dismissed" })}>Écarter</Button> : <Button size="sm" variant="ghost" onClick={() => setOpp.mutate({ id: o.id, s: "new" })}>Restaurer</Button>}
                      </div>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </QueryBoundary>
        </section>
      </div>
      {editing ? <SearchDialog search={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} danger title={`Supprimer « ${del?.name} » ?`} description="Les opportunités associées seront supprimées." confirmLabel="Supprimer" />
    </>
  );
}

function SearchDialog({ search, onClose }: { search: RadarSearch | null; onClose: () => void }) {
  const client = useClient();
  const [form, setForm] = useState<RadarSearchCreate & { brandsText: string; sizesText: string; keywordsText: string }>({
    name: search?.name ?? "", criteria: search?.criteria ?? { brands: [], categories: [], sizes: [], conditions: [], maxPriceCents: 3500, keywords: [] }, budgetCents: search?.budgetCents ?? 15000, targetMarginRate: search?.targetMarginRate ?? 0.4, targetMarginCents: search?.targetMarginCents ?? 2000, enabled: search?.enabled ?? true, provider: "demo",
    brandsText: search?.criteria.brands.join(", ") ?? "", sizesText: search?.criteria.sizes.join(", ") ?? "", keywordsText: search?.criteria.keywords.join(", ") ?? "",
  });
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const payload = (): RadarSearchCreate => ({ name: form.name, criteria: { ...form.criteria!, brands: split(form.brandsText), sizes: split(form.sizesText), keywords: split(form.keywordsText) }, budgetCents: form.budgetCents, targetMarginRate: form.targetMarginRate, targetMarginCents: form.targetMarginCents, enabled: form.enabled, provider: "demo" });
  const save = useAppMutation(() => (search ? client.updateSearch(search.id, payload()) : client.createSearch(payload())), { invalidate: ["searches"], success: search ? "Recherche enregistrée" : "Recherche créée", onSuccess: onClose });
  const crit = form.criteria!;
  return (
    <Dialog open onClose={onClose} title={search ? "Modifier la recherche" : "Nouvelle recherche"} size="md" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()}>{search ? "Enregistrer" : "Créer"}</Button></>}>
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
