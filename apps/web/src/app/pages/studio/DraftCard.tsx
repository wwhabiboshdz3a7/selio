import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Info, Send } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, ITEM_CONDITIONS, ITEM_CONDITION_LABELS, LABEL_FIELD_LABELS, MEASUREMENT_LABELS, type InventoryItem, type ListingDraft, type MarketplaceConnection } from "@selio/contracts";
import { Alert, Button, Card, Field, IconButton, Input, Money, Select, Tag, Textarea, cn, formatCents } from "@selio/ui";
import type { StudioDraft } from "../../../lib/data/types";
import { useClient } from "../../../lib/data/provider";
import { hasPrice } from "../../../lib/track";
import { LABEL_FIELD_ORDER } from "../../../lib/studio/flow";
import { MoneyInput } from "../../components/common";
import { PriceEstimateView } from "../../components/pricing";
import { ProvenanceBadge } from "./shared";

export interface DraftForm {
  title: string;
  description: string;
  brand: string;
  size: string;
  category: InventoryItem["category"];
  condition: InventoryItem["condition"];
  colors: string;
  material: string;
  priceCents: number | null;
  hashtags: string[];
}

export function toForm(d: ListingDraft): DraftForm {
  return { title: d.title, description: d.description, brand: d.brand ?? "", size: d.size ?? "", category: d.category, condition: d.condition, colors: d.colors.join(", "), material: d.material ?? "", priceCents: d.suggestedPriceCents, hashtags: d.hashtags };
}

/** D'où viennent la marque, la taille, la matière et les mesures de l'annonce (préparation validée). */
export function ProvenanceSummary({ draft, className }: { draft: StudioDraft; className?: string }) {
  if (!draft.fields) return null;
  const fields = draft.fields;
  const measures = (draft.measurements ?? []).filter((m) => m.valueCm !== null);
  return (
    <section aria-label="Provenance des champs" className={cn("rounded-lg border border-border p-3", className)}>
      <h3 className="text-sm font-semibold">Provenance</h3>
      <dl className="mt-2 grid gap-2 text-sm">
        {LABEL_FIELD_ORDER.map((k) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-text-muted">{LABEL_FIELD_LABELS[k]}</dt>
            <dd className="flex min-w-0 flex-wrap items-center justify-end gap-2"><span className="truncate text-text">{fields[k].value ?? "—"}</span><ProvenanceBadge source={fields[k].source} confidence={fields[k].confidence} /></dd>
          </div>
        ))}
        {measures.map((m) => (
          <div key={m.name} className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-text-muted">{MEASUREMENT_LABELS[m.name]}</dt>
            <dd className="flex flex-wrap items-center justify-end gap-2"><span className="num text-text">{String(m.valueCm).replace(".", ",")} cm</span><ProvenanceBadge source={m.source} confidence={m.confidence} /></dd>
          </div>
        ))}
      </dl>
      {measures.length === 0 ? <p className="mt-2 text-xs text-text-muted">Aucune mesure connue : l'annonce n'en cite aucune.</p> : null}
    </section>
  );
}

/** Annonce proposée : titre, description, attributs, prix conseillé ; brouillon ou mise en vente. */
export function DraftCard({ draft, form, onForm, cover, purchasePriceCents, account, mode, canWrite, onSave, saving }: {
  draft: StudioDraft;
  form: DraftForm;
  onForm: (f: DraftForm) => void;
  cover: string | null;
  purchasePriceCents: number | null;
  account: MarketplaceConnection | null;
  mode: "demo" | "connected";
  canWrite: boolean;
  onSave: (publish: boolean) => void;
  saving: boolean | null;
}) {
  const client = useClient();
  // État du modèle de prix (« modèle non entraîné », « données de démonstration ») affiché avec l'estimation.
  const priceModel = useQuery({ queryKey: ["pricing-model"], queryFn: () => client.pricingModelStatus(), staleTime: 60_000 });
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); };
  const titleLen = form.title.length;
  const setForm = onForm;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Annonce proposée</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Tag accent>{draft.source === "ai" ? (draft.simulated ? "IA simulée" : `IA · ${draft.model}`) : "Gabarit de secours"}</Tag>
          <Tag>Confiance {Math.round(draft.confidence * 100)} %</Tag>
        </div>
      </div>
      {draft.warnings.length > 0 ? <Alert tone="warning" className="mb-4">{draft.warnings.join(" ")}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex flex-col gap-3">
          <Field label={<span className="flex items-center justify-between gap-2">Titre <span className={cn("num text-xs font-normal", titleLen > 70 ? "text-warning" : "text-text-muted")}>{titleLen}/100</span></span>}>
            {(p) => <div className="flex gap-2"><Input id={p.id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={100} /><IconButton label="Copier le titre" variant="secondary" onClick={() => copy(form.title)}><ClipboardCopy /></IconButton></div>}
          </Field>
          <Field label="Description">
            {(p) => <div className="relative"><Textarea id={p.id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={7} maxLength={2000} /><IconButton label="Copier la description" size="sm" variant="secondary" className="absolute top-2 right-2" onClick={() => copy(form.description)}><ClipboardCopy /></IconButton></div>}
          </Field>
          {form.hashtags.length ? <p className="text-xs text-text-muted">Mots-clés : {form.hashtags.join(" ")}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Marque" hint={draft.fields ? "Reprise de la préparation validée." : undefined}>{(p) => <Input id={p.id} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="À vérifier sur l'étiquette" />}</Field>
            <Field label="Taille">{(p) => <Input id={p.id} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="À vérifier" />}</Field>
            <Field label="Catégorie">{(p) => <Select id={p.id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as DraftForm["category"] })}>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</Select>}</Field>
            <Field label="État">{(p) => <Select id={p.id} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as DraftForm["condition"] })}>{ITEM_CONDITIONS.map((c) => <option key={c} value={c}>{ITEM_CONDITION_LABELS[c]}</option>)}</Select>}</Field>
            <Field label="Couleurs">{(p) => <Input id={p.id} value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} placeholder="ex. Bleu marine" />}</Field>
            <Field label="Matière">{(p) => <Input id={p.id} value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="ex. Coton" />}</Field>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {cover ? <img src={cover} alt="Couverture" className="aspect-square w-full rounded-lg object-cover" /> : null}
          <div className="rounded-lg bg-surface-muted p-3">
            <Field label="Prix de vente">{(p) => <MoneyInput id={p.id} value={form.priceCents} onChange={(v) => setForm({ ...form, priceCents: v })} />}</Field>
            <p className="mt-2 text-xs text-text-muted">Conseillé (standard) : <button type="button" className="font-semibold text-text underline underline-offset-2" onClick={() => setForm({ ...form, priceCents: draft.suggestedPriceCents })}><Money cents={draft.suggestedPriceCents} /></button></p>
            {hasPrice(draft.pricing) ? <p className="mt-1 text-[11px] text-text-muted">Trois stratégies et leur explication sous l'annonce.</p> : (
              <>
                <div className="mt-2 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--violet-200), var(--accent-vivid), var(--violet-200))" }} aria-hidden />
                <p className="num mt-1 flex justify-between text-[11px] text-text-muted"><span>{formatCents(draft.priceLowCents)}</span><span>{formatCents(draft.priceHighCents)}</span></p>
                <p className="mt-1 text-[11px] text-text-muted">{draft.priceMethod} · {draft.comparableCount} vente(s) comparable(s)</p>
              </>
            )}
            {purchasePriceCents && form.priceCents ? <p className="num mt-2 text-sm">Marge : <span className={form.priceCents - purchasePriceCents >= 0 ? "font-semibold text-success" : "font-semibold text-danger"}>{formatCents(form.priceCents - purchasePriceCents)}</span></p> : null}
          </div>
          <ProvenanceSummary draft={draft} />
        </div>
      </div>
      {draft.pricing ? (
        <section aria-label="Prix conseillé" className="mt-5 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold">Prix conseillé : trois stratégies</h3>
          <PriceEstimateView
            estimate={draft.pricing}
            // Absent tant qu'il n'est pas lu : jamais « non entraîné » par défaut.
            modelStatus={priceModel.data}
            // Valeurs relevées au plancher (prix d'achat et marge minimale) par le serveur.
            strategies={{ fast: draft.priceLowCents, standard: draft.suggestedPriceCents, max: draft.priceHighCents }}
            current={form.priceCents}
            onApply={(cents) => setForm({ ...form, priceCents: cents })}
            disabled={!canWrite}
            simulated={draft.simulated}
          />
        </section>
      ) : null}
      <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-text-muted"><Info className="size-3.5" aria-hidden />{account ? `Compte : ${account.label}` : "Aucun compte sélectionné"}{account?.provider === "vinted" && mode === "connected" ? " · publication via l'extension Selio" : ""}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onSave(false)} loading={saving === false} disabled={!canWrite || form.title.trim().length < 3}>Enregistrer en brouillon</Button>
          <Button variant="accent" icon={<Send />} onClick={() => onSave(true)} loading={saving === true} disabled={!canWrite || form.title.trim().length < 3 || !form.priceCents}>Publier directement</Button>
        </div>
      </div>
    </Card>
  );
}
