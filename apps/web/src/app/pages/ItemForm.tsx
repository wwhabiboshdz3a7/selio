import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, ITEM_CONDITIONS, ITEM_CONDITION_LABELS, ITEM_STATUSES, ITEM_STATUS_LABELS, inventoryItemCreate, type InventoryItemCreate, type Photo } from "@selio/contracts";
import { PRICE_CHECK_LABELS, checkPrice, newId, projectedMargin, suggestFloorPrice } from "@selio/domain";
import { Button, Card, Field, IconButton, Input, Money, PageHeader, Select, Textarea, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

const MAX_PHOTO_BYTES = 1_500_000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type FormState = Omit<InventoryItemCreate, "photos"> & { photos: Photo[]; tagsText: string };

function emptyForm(): FormState {
  return { title: "", description: "", brand: "", size: "", category: "other", condition: "good", purchasePriceCents: 0, purchaseFeesCents: 0, listedPriceCents: null, floorPriceCents: null, status: "in_stock", sku: "", tags: [], tagsText: "", photos: [], purchasedAt: null, externalUrl: null };
}

export default function ItemForm() {
  const { id } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const existing = useQuery({ queryKey: ["item", id], queryFn: () => client.getItem(id!), enabled: editing });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => {
    if (existing.data) {
      const it = existing.data;
      setForm({ title: it.title, description: it.description, brand: it.brand ?? "", size: it.size ?? "", category: it.category, condition: it.condition, purchasePriceCents: it.purchasePriceCents, purchaseFeesCents: it.purchaseFeesCents, listedPriceCents: it.listedPriceCents, floorPriceCents: it.floorPriceCents, status: it.status, sku: it.sku ?? "", tags: it.tags, tagsText: it.tags.join(", "), photos: it.photos, purchasedAt: it.purchasedAt, externalUrl: it.externalUrl });
    }
  }, [existing.data]);
  const rules = session.org.settings.margin;
  const suggestedFloor = useMemo(() => suggestFloorPrice({ purchasePriceCents: form.purchasePriceCents ?? 0, purchaseFeesCents: form.purchaseFeesCents ?? 0 }, rules), [form.purchasePriceCents, form.purchaseFeesCents, rules]);
  const pricing = { purchasePriceCents: form.purchasePriceCents ?? 0, purchaseFeesCents: form.purchaseFeesCents ?? 0, listedPriceCents: form.listedPriceCents ?? null, floorPriceCents: form.floorPriceCents ?? null };
  const margin = projectedMargin(pricing, rules);
  const check = form.listedPriceCents != null ? checkPrice(pricing, form.listedPriceCents, rules) : null;

  const save = useAppMutation(
    async (payload: InventoryItemCreate) => (editing ? client.updateItem(id!, payload) : client.createItem(payload)),
    { invalidate: ["items", "item", "overview"], success: editing ? "Article enregistré" : "Article créé", onSuccess: (it) => navigate(`/app/items/${it.id}`) },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: InventoryItemCreate = {
      title: form.title, description: form.description, brand: form.brand || null, size: form.size || null, category: form.category, condition: form.condition,
      purchasePriceCents: form.purchasePriceCents ?? 0, purchaseFeesCents: form.purchaseFeesCents ?? 0, listedPriceCents: form.listedPriceCents ?? null, floorPriceCents: form.floorPriceCents ?? null,
      status: form.status, sku: form.sku || null, tags: form.tagsText.split(",").map((t) => t.trim()).filter(Boolean), photos: form.photos, purchasedAt: form.purchasedAt || null, externalUrl: form.externalUrl || null,
    };
    const parsed = inventoryItemCreate.safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] = i.message;
      setErrors(errs);
      return;
    }
    const errs: Record<string, string> = {};
    if (payload.status !== "in_stock" && payload.listedPriceCents === null) errs.listedPriceCents = "Un prix affiché est requis pour mettre en vente.";
    if (payload.floorPriceCents != null && payload.listedPriceCents != null && payload.floorPriceCents > payload.listedPriceCents) errs.floorPriceCents = "Le plancher ne peut pas dépasser le prix affiché.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    save.mutate(payload);
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotoError(null);
    const list = Array.from(files).slice(0, 12 - form.photos.length);
    for (const f of list) {
      if (!ALLOWED_TYPES.includes(f.type)) { setPhotoError(`Format refusé : ${f.name} (JPEG, PNG ou WebP uniquement).`); continue; }
      if (f.size > MAX_PHOTO_BYTES) { setPhotoError(`Fichier trop lourd : ${f.name} (1,5 Mo max).`); continue; }
      const reader = new FileReader();
      reader.onload = () => setForm((s) => ({ ...s, photos: [...s.photos, { id: newId(), url: String(reader.result), alt: f.name, position: s.photos.length }] }));
      reader.readAsDataURL(f);
    }
  };

  const body = (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-4 text-md font-semibold">Description</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Titre" required error={errors.title} className="sm:col-span-2">{(p) => <Input id={p.id} invalid={p.invalid} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />}</Field>
            <Field label="Marque">{(p) => <Input id={p.id} value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} maxLength={80} />}</Field>
            <Field label="Taille">{(p) => <Input id={p.id} value={form.size ?? ""} onChange={(e) => setForm({ ...form, size: e.target.value })} maxLength={40} />}</Field>
            <Field label="Catégorie">{(p) => <Select id={p.id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as FormState["category"] })}>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</Select>}</Field>
            <Field label="État">{(p) => <Select id={p.id} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as FormState["condition"] })}>{ITEM_CONDITIONS.map((c) => <option key={c} value={c}>{ITEM_CONDITION_LABELS[c]}</option>)}</Select>}</Field>
            <Field label="Description" className="sm:col-span-2">{(p) => <Textarea id={p.id} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} maxLength={8000} />}</Field>
            <Field label="SKU" hint="Laissez vide pour une génération automatique.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} maxLength={40} />}</Field>
            <Field label="Tags" hint="Séparés par des virgules.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.tagsText} onChange={(e) => setForm({ ...form, tagsText: e.target.value })} />}</Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-1 text-md font-semibold">Photos</h2>
          <p className="mb-4 text-sm text-text-muted">JPEG, PNG ou WebP, 1,5 Mo maximum, 12 photos au plus. En démonstration, les photos restent dans votre navigateur.</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {form.photos.map((ph, i) => (
              <div key={ph.id} className="group relative aspect-square overflow-hidden rounded-md bg-surface-muted">
                <img src={ph.url} alt={ph.alt} className="size-full object-cover" />
                <IconButton label={`Retirer la photo ${i + 1}`} size="sm" variant="secondary" className="absolute top-1 right-1" onClick={() => setForm({ ...form, photos: form.photos.filter((x) => x.id !== ph.id) })}><Trash2 /></IconButton>
              </div>
            ))}
            {form.photos.length < 12 ? (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-xs text-text-muted hover:bg-surface-muted">
                <ImagePlus className="size-5" aria-hidden />
                Ajouter
                <input type="file" accept={ALLOWED_TYPES.join(",")} multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
              </label>
            ) : null}
          </div>
          {photoError ? <p role="alert" className="mt-2 text-xs text-danger">{photoError}</p> : null}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-4 text-md font-semibold">Prix et marge</h2>
          <div className="flex flex-col gap-4">
            <Field label="Prix d'achat" required>{(p) => <MoneyInput id={p.id} value={form.purchasePriceCents ?? 0} onChange={(v) => setForm({ ...form, purchasePriceCents: v ?? 0 })} allowEmpty={false} />}</Field>
            <Field label="Frais d'acquisition" hint="Port entrant, nettoyage, retouche…">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={form.purchaseFeesCents ?? 0} onChange={(v) => setForm({ ...form, purchaseFeesCents: v ?? 0 })} allowEmpty={false} />}</Field>
            <Field label="Prix affiché" error={errors.listedPriceCents}>{(p) => <MoneyInput id={p.id} invalid={p.invalid} value={form.listedPriceCents ?? null} onChange={(v) => setForm({ ...form, listedPriceCents: v })} />}</Field>
            <Field label="Prix plancher" error={errors.floorPriceCents} hint={<>Suggéré par vos règles : <button type="button" className="font-medium text-text underline underline-offset-2" onClick={() => setForm({ ...form, floorPriceCents: suggestedFloor })}><Money cents={suggestedFloor} /></button> (marge min. {formatPercent(rules.minMarginRate)} et <Money cents={rules.minMarginCents} />).</>}>{(p) => <MoneyInput id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={form.floorPriceCents ?? null} onChange={(v) => setForm({ ...form, floorPriceCents: v })} />}</Field>
            <Field label="Statut">{(p) => <Select id={p.id} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}>{ITEM_STATUSES.map((s) => <option key={s} value={s}>{ITEM_STATUS_LABELS[s]}</option>)}</Select>}</Field>
            <Field label="Date d'achat">{(p) => <Input id={p.id} type="date" value={form.purchasedAt ? form.purchasedAt.slice(0, 10) : ""} onChange={(e) => setForm({ ...form, purchasedAt: e.target.value ? new Date(e.target.value + "T12:00:00Z").toISOString() : null })} />}</Field>
          </div>
          <div className="mt-4 rounded-md bg-surface-muted p-3 text-sm">
            <p className="flex justify-between"><span className="text-text-muted">Coût d'acquisition</span><Money cents={(form.purchasePriceCents ?? 0) + (form.purchaseFeesCents ?? 0)} /></p>
            <p className="mt-1 flex justify-between"><span className="text-text-muted">Marge projetée au prix affiché</span>{margin ? <span><Money cents={margin.marginCents} signed /> <span className="text-text-muted">({formatPercent(margin.marginRate)})</span></span> : <span className="text-text-muted">—</span>}</p>
            {check && !check.ok ? <p className="mt-2 text-xs text-danger">{PRICE_CHECK_LABELS[check.reason]} : ce prix ne respecte pas vos règles de marge.</p> : null}
          </div>
        </Card>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to={editing ? `/app/items/${id}` : "/app/items"}><Button variant="ghost" type="button">Annuler</Button></Link>
          <Button type="submit" loading={save.isPending}>{editing ? "Enregistrer" : "Créer l'article"}</Button>
        </div>
      </div>
    </form>
  );

  return (
    <>
      <PageHeader title={editing ? "Modifier l'article" : "Nouvel article"} eyebrow={<Link to="/app/items" className="hover:text-text">Articles et stock</Link>} />
      {editing ? <QueryBoundary query={existing} skeleton="spinner">{() => body}</QueryBoundary> : body}
    </>
  );
}
