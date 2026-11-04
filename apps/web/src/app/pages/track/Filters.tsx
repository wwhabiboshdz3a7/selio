import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Filter, Pencil, Plus, Trash2 } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, ITEM_CONDITIONS, ITEM_CONDITION_LABELS, TRACK_READ_INTERVAL_HOURS, type ItemCategory, type TrackFilter, type TrackFilterCreate } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, PageHeader, StatusBadge, Tag, Toggle, formatCents, formatDateTime, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { TrackUsageView } from "../../../lib/data/types";
import { errorMessage } from "../../../lib/errors";
import { criteriaTags } from "../../../lib/track";
import { MoneyInput, QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { UsageMeter } from "../../components/usage";
import { TRACK_KEYS, TrackGate, quotaText } from "./shared";

/**
 * Selio Track · filtres suivis : création, modification, pause et retrait, dans la limite de l'offre
 * (5 en Pro, 25 en Agence). Chaque filtre est lu toutes les 2 h ; un filtre identique suivi par d'autres
 * clients est lu une seule fois (empreinte normalisée des critères) et ses statistiques sont partagées.
 */
export default function TrackFilters() {
  return <TrackGate>{(u) => <Filters usage={u} />}</TrackGate>;
}

function Filters({ usage }: { usage: TrackUsageView }) {
  const client = useClient();
  const session = useRequiredSession();
  const [params] = useSearchParams();
  const canWrite = can(session.role, "radar.write");
  const filters = useQuery({ queryKey: ["track-filters"], queryFn: () => client.trackFilters() });
  // Pré-remplissage depuis un scan de niche (« Suivre cette niche »).
  const prefillCategory = params.get("category");
  const prefill = prefillCategory && prefillCategory in ITEM_CATEGORY_LABELS ? { brand: params.get("brand") ?? "", category: prefillCategory as ItemCategory } : null;
  const [editing, setEditing] = useState<TrackFilter | "new" | null>(prefill && canWrite ? "new" : null);
  const [removing, setRemoving] = useState<TrackFilter | null>(null);
  const full = usage.filters.used >= usage.filters.quota;
  const toggle = useAppMutation((f: TrackFilter) => client.updateTrackFilter(f.id, { enabled: !f.enabled }), { invalidate: TRACK_KEYS, success: (f) => (f.enabled ? "Filtre repris" : "Filtre en pause") });
  const remove = useAppMutation((f: TrackFilter) => client.deleteTrackFilter(f.id), { invalidate: TRACK_KEYS, success: "Filtre retiré", onSuccess: () => setRemoving(null) });
  return (
    <>
      <PageHeader
        eyebrow="Selio Track"
        title="Filtres suivis"
        description={`Chaque filtre est lu toutes les ${TRACK_READ_INTERVAL_HOURS} h, partagé entre clients : un filtre identique n'est lu qu'une fois pour tous.`}
        actions={canWrite ? <Button icon={<Plus />} onClick={() => setEditing("new")} disabled={full}>Nouveau filtre</Button> : undefined}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <UsageMeter label="Filtres suivis" counter={usage.filters} hint={full ? "Retirez un filtre pour en suivre un autre." : "Limite de votre offre (pas un compteur mensuel)."} />
          {full ? <p className="mt-3 text-sm text-text-muted">Quota atteint ({quotaText(usage.filters)}). {usage.plan === "pro" ? <>L'offre Agence en suit 25. <Link to="/app/settings/billing" className="font-medium text-accent hover:underline">Voir les offres</Link></> : null}</p> : null}
        </Card>
        <QueryBoundary query={filters} empty={(d) => (d.length === 0 ? <EmptyState icon={<Filter />} title="Aucun filtre suivi" description="Un filtre suit une recherche Vinted (marques, catégories, tailles, états, prix maximal) : Track en tire des statistiques, jamais des annonces." action={canWrite ? <Button icon={<Plus />} onClick={() => setEditing("new")}>Nouveau filtre</Button> : undefined} /> : null)}>
          {(list) => (
            <Card padding="none">
              <ul className="divide-y divide-border">
                {list.map((f) => (
                  <li key={f.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center md:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/track/filtres/${f.id}`} className="font-medium text-text hover:text-accent">{f.name}</Link>
                        <StatusBadge tone={f.enabled ? "success" : "muted"}>{f.enabled ? "Suivi" : "En pause"}</StatusBadge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">{criteriaTags(f.criteria).map((t) => <Tag key={t}>{t}</Tag>)}<Tag>Prix max {formatCents(f.criteria.maxPriceCents)}</Tag></div>
                      <p className="mt-1 text-xs text-text-muted">
                        {f.lastReadAt ? <>Dernière lecture {formatRelative(f.lastReadAt)}</> : "Première lecture au prochain passage"}
                        {f.nextReadAt && f.enabled ? <> · prochaine vers {formatDateTime(f.nextReadAt)}</> : null}
                      </p>
                    </div>
                    {canWrite ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => toggle.mutate(f)} loading={toggle.isPending && toggle.variables?.id === f.id}>{f.enabled ? "Mettre en pause" : "Reprendre"}</Button>
                        <IconButton label={`Modifier ${f.name}`} variant="ghost" onClick={() => setEditing(f)}><Pencil /></IconButton>
                        <IconButton label={`Retirer ${f.name}`} variant="ghost" onClick={() => setRemoving(f)}><Trash2 /></IconButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </QueryBoundary>
        <p className="text-xs text-text-muted">Une annonce disparue entre deux lectures est comptée « vendue ou retirée » : c'est une estimation. Aucune annonce, aucune photo et aucun pseudo n'est conservé.</p>
      </div>
      {editing ? <FilterDialog filter={editing === "new" ? null : editing} prefill={editing === "new" ? prefill : null} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)} loading={remove.isPending} danger title="Retirer ce filtre ?" description="Vous ne suivrez plus ses statistiques ; les lectures partagées continuent pour les autres clients qui le suivent." confirmLabel="Retirer" />
    </>
  );
}

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function FilterDialog({ filter, prefill, onClose }: { filter: TrackFilter | null; prefill: { brand: string; category: ItemCategory } | null; onClose: () => void }) {
  const client = useClient();
  const c = filter?.criteria;
  const [name, setName] = useState(filter?.name ?? (prefill ? [prefill.brand, ITEM_CATEGORY_LABELS[prefill.category]].filter(Boolean).join(" · ") : ""));
  const [brands, setBrands] = useState(c?.brands.join(", ") ?? prefill?.brand ?? "");
  const [keywords, setKeywords] = useState(c?.keywords.join(", ") ?? "");
  const [sizes, setSizes] = useState(c?.sizes.join(", ") ?? "");
  const [categories, setCategories] = useState<ItemCategory[]>(c?.categories ?? (prefill ? [prefill.category] : []));
  const [conditions, setConditions] = useState(c?.conditions ?? []);
  const [maxPrice, setMaxPrice] = useState<number | null>(c?.maxPriceCents ?? 5000);
  const [enabled, setEnabled] = useState(filter?.enabled ?? true);
  const payload = (): TrackFilterCreate => ({ name: name.trim(), enabled, criteria: { brands: split(brands), keywords: split(keywords), sizes: split(sizes), categories, conditions, maxPriceCents: maxPrice ?? 0 } });
  const save = useAppMutation(() => (filter ? client.updateTrackFilter(filter.id, payload()) : client.createTrackFilter(payload())), { invalidate: TRACK_KEYS, success: filter ? "Filtre enregistré" : "Filtre suivi : première lecture au prochain passage", onSuccess: onClose });
  const tags = criteriaTags({ brands: split(brands), keywords: split(keywords), sizes: split(sizes), categories, conditions });
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={filter ? "Modifier le filtre" : "Nouveau filtre suivi"}
      description="Mêmes critères qu'une recherche Vinted. Deux filtres qui ne diffèrent que par la casse ou l'ordre sont le même filtre."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!name.trim()}>{filter ? "Enregistrer" : "Suivre ce filtre"}</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" required className="sm:col-span-2">{(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="ex. Levi's 501 homme" />}</Field>
        <Field label="Marques" hint="Séparées par des virgules.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={brands} onChange={(e) => setBrands(e.target.value)} />}</Field>
        <Field label="Mots-clés">{(p) => <Input id={p.id} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ex. 501" />}</Field>
        <Field label="Tailles">{(p) => <Input id={p.id} value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="ex. M, 40" />}</Field>
        <Field label="Prix maximal">{(p) => <MoneyInput id={p.id} value={maxPrice} onChange={setMaxPrice} allowEmpty={false} />}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-text">Catégories</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ITEM_CATEGORIES.map((cat) => <Checkbox key={cat} label={ITEM_CATEGORY_LABELS[cat]} checked={categories.includes(cat)} onChange={(e) => setCategories(e.target.checked ? [...categories, cat] : categories.filter((x) => x !== cat))} />)}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-text">États</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ITEM_CONDITIONS.map((cond) => <Checkbox key={cond} label={ITEM_CONDITION_LABELS[cond]} checked={conditions.includes(cond)} onChange={(e) => setConditions(e.target.checked ? [...conditions, cond] : conditions.filter((x) => x !== cond))} />)}
          </div>
        </fieldset>
        <div className="sm:col-span-2"><Toggle label="Filtre suivi" description={enabled ? `Lu toutes les ${TRACK_READ_INTERVAL_HOURS} h.` : "En pause : plus aucune statistique nouvelle."} checked={enabled} onChange={setEnabled} /></div>
        {tags.length ? <p className="text-xs text-text-muted sm:col-span-2">Résumé : {tags.join(" · ")} · prix max {formatCents(maxPrice ?? 0)}</p> : null}
        {save.isError ? <Alert tone="danger" className="sm:col-span-2" title={(save.error as { status?: number }).status === 402 ? "Limite de votre offre" : "Filtre non enregistré"}>{errorMessage(save.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}
