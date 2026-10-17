import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Check, ClipboardCopy, ImagePlus, Info, Send, Sparkles, Star, Trash2, Upload, Wand2 } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, ITEM_CONDITIONS, ITEM_CONDITION_LABELS, type GeneratorPhoto, type InventoryItem, type ListingDraft, type MarketplaceConnection } from "@selio/contracts";
import { listingAccounts, newId, suggestFloorPrice } from "@selio/domain";
import { Alert, Button, Card, Field, IconButton, IconTile, Input, Money, PageHeader, Select, Tag, Textarea, cn, formatCents } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput } from "../components/common";
import { useAppMutation } from "../components/hooks";

const MAX_PHOTOS = 12;
const MAX_SIDE = 1100;

/** « @pseudo — nom interne », avec la mention simulation ou perso. */
function accountOptionLabel(c: MarketplaceConnection): string {
  const handle = typeof c.config.displayHandle === "string" && c.config.displayHandle ? `@${c.config.displayHandle}` : null;
  const name = handle && handle !== c.label ? `${handle} — ${c.label}` : c.label;
  return `${name}${c.provider === "demo" ? " (simulation)" : c.usage === "personal" ? " (perso)" : ""}`;
}

/** Compresse une photo dans le navigateur (JPEG, ~150–300 Ko) avant envoi. */
async function compress(file: File): Promise<GeneratorPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Image illisible : ${file.name}`));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Compression indisponible dans ce navigateur");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { id: newId(), url: canvas.toDataURL("image/jpeg", 0.8), alt: file.name.slice(0, 200) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface DraftForm {
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

function toForm(d: ListingDraft): DraftForm {
  return { title: d.title, description: d.description, brand: d.brand ?? "", size: d.size ?? "", category: d.category, condition: d.condition, colors: d.colors.join(", "), material: d.material ?? "", priceCents: d.suggestedPriceCents, hashtags: d.hashtags };
}

export default function Studio() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const [photos, setPhotos] = useState<GeneratorPhoto[]>([]);
  const [busyPhotos, setBusyPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [connectionId, setConnectionId] = useState<string>("");
  const [hints, setHints] = useState({ brand: "", size: "", notes: "", purchasePriceCents: null as number | null });
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [saved, setSaved] = useState<{ item: InventoryItem; published: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const canWrite = session.role !== "viewer";
  // Comptes Vente uniquement (Vinted d'abord), puis les comptes Perso, signalés ; jamais un compte Achat.
  const accounts = useMemo(() => listingAccounts(connections.data ?? []), [connections.data]);
  const account = accounts.find((c) => c.id === connectionId) ?? accounts[0] ?? null;

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    setPhotoError(null);
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, MAX_PHOTOS - photos.length);
    if (list.length === 0) { setPhotoError("Ajoutez des images (JPEG, PNG, WebP ou HEIC depuis un iPhone)."); return; }
    setBusyPhotos(true);
    try {
      const out: GeneratorPhoto[] = [];
      for (const f of list) {
        try { out.push(await compress(f)); } catch (e) { setPhotoError(e instanceof Error ? e.message : "Photo illisible"); }
      }
      setPhotos((p) => [...p, ...out].slice(0, MAX_PHOTOS));
    } finally {
      setBusyPhotos(false);
    }
  };

  const generate = useAppMutation(() => client.generateListing({ photos, connectionId: account?.id ?? null, hints: { brand: hints.brand || undefined, size: hints.size || undefined, notes: hints.notes || undefined, purchasePriceCents: hints.purchasePriceCents ?? undefined } }), {
    invalidate: ["ai-requests"],
    success: (d) => (d.source === "ai" ? "Annonce rédigée : relisez-la avant de publier" : "Gabarit de secours utilisé : complétez l'annonce"),
    onSuccess: (d) => { setDraft(d); setForm(toForm(d)); setSaved(null); },
  });

  const save = useAppMutation(async (publish: boolean) => {
    if (!form) throw new Error("Aucune annonce générée");
    const purchase = hints.purchasePriceCents ?? 0;
    const floor = form.priceCents ? Math.min(form.priceCents, suggestFloorPrice({ purchasePriceCents: purchase, purchaseFeesCents: 0 }, session.org.settings.margin)) : null;
    const item = await client.createItem({
      title: form.title.trim(),
      description: [form.description.trim(), form.hashtags.length ? form.hashtags.join(" ") : ""].filter(Boolean).join("\n\n"),
      brand: form.brand.trim() || null,
      size: form.size.trim() || null,
      category: form.category,
      condition: form.condition,
      photos: photos.map((p, position) => ({ id: p.id, url: p.url, alt: p.alt || form.title, position })),
      purchasePriceCents: purchase,
      purchaseFeesCents: 0,
      listedPriceCents: form.priceCents,
      floorPriceCents: publish ? floor : null,
      status: publish ? "listed" : "in_stock",
      connectionId: account?.id ?? null,
      tags: ["générateur"],
      attributes: { colors: form.colors.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 3), material: form.material.trim() || null, generatedBy: draft?.source ?? "manual" },
    });
    return { item, published: publish };
  }, { invalidate: ["items", "overview", "nav-counts", "dressing"], success: (r) => (r.published ? "Annonce mise en vente" : "Brouillon enregistré"), onSuccess: (r) => setSaved(r) });

  const reset = () => { setPhotos([]); setDraft(null); setForm(null); setSaved(null); setHints({ brand: "", size: "", notes: "", purchasePriceCents: null }); };
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); };
  const titleLen = form?.title.length ?? 0;

  return (
    <>
      <PageHeader
        title="Générateur d'annonces"
        description="Ajoutez seulement vos photos : l'IA reconnaît l'article et rédige l'annonce (titre, description, marque, taille, état, couleurs). Vous relisez, puis vous enregistrez en brouillon ou publiez directement sur le compte choisi."
        actions={draft ? <Button variant="secondary" icon={<ArrowLeft />} onClick={reset}>Nouvelle annonce</Button> : undefined}
      />

      {mode === "demo" ? (
        <Alert tone="info" className="mb-5" title="Démonstration : IA simulée">Le simulateur ne voit pas réellement vos photos : il s'appuie sur la marque, la taille, les notes et le nom des fichiers (ex. « ralph-lauren-pull-bleu-M.jpg »). Avec votre modèle IA branché (Ollama + modèle de vision), l'analyse des photos est réelle. Le prix conseillé vient toujours des ventes comparables, jamais de l'IA.</Alert>
      ) : null}

      <ol className="mb-8 grid gap-4 sm:grid-cols-3" aria-label="Étapes">
        {[
          { n: 1, t: "Ajoutez vos photos", d: "Face, dos, étiquette, défauts : 3 à 8 photos idéalement." },
          { n: 2, t: "L'IA rédige l'annonce", d: "Titre optimisé, description honnête, attributs Vinted." },
          { n: 3, t: "Brouillon ou publication", d: "Vous relisez et choisissez : brouillon ou mise en vente." },
        ].map((s) => {
          const done = (s.n === 1 && photos.length > 0) || (s.n === 2 && Boolean(draft)) || (s.n === 3 && Boolean(saved));
          return (
            <li key={s.n} className="flex items-start gap-3">
              <span className={cn("num inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-accent text-accent-on" : "bg-surface text-text-muted ring-1 ring-border")} aria-hidden>{done ? <Check className="size-3.5" /> : s.n}</span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", done ? "text-text" : "text-text")}>{s.t}{done ? <span className="sr-only"> (fait)</span> : null}</p>
                <p className="text-xs text-text-muted">{s.d}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-md font-semibold">Photos <span className="num text-sm font-normal text-text-muted">{photos.length}/{MAX_PHOTOS}</span></h2>
              {photos.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setPhotos([])}>Tout retirer</Button> : null}
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
              className={cn("rounded-xl border border-dashed p-4 transition-colors", dragOver ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-muted/40")}
            >
              {photos.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <IconTile icon={<ImagePlus />} tone="accent" size={48} />
                  <div>
                    <p className="text-base font-medium text-text">Glissez vos photos ici</p>
                    <p className="text-sm text-text-muted">ou choisissez-les depuis l'ordinateur ou le téléphone</p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button icon={<Upload />} onClick={() => fileRef.current?.click()} loading={busyPhotos}>Choisir des photos</Button>
                    <Button variant="secondary" icon={<Camera />} onClick={() => cameraRef.current?.click()} className="md:hidden">Prendre une photo</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p, i) => (
                    <figure key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface">
                      <img src={p.url} alt={p.alt || `Photo ${i + 1}`} className="size-full object-cover" />
                      {i === 0 ? <span className="absolute top-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">Couverture</span> : null}
                      <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                        {i > 0 ? <IconButton label="Mettre en couverture" size="sm" variant="secondary" onClick={() => setPhotos((ps) => [ps[i]!, ...ps.filter((_, j) => j !== i)])}><Star /></IconButton> : null}
                        <IconButton label={`Retirer la photo ${i + 1}`} size="sm" variant="secondary" onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}><Trash2 /></IconButton>
                      </div>
                    </figure>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <button type="button" onClick={() => fileRef.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-xs text-text-muted hover:bg-surface">
                      <ImagePlus className="size-5" aria-hidden /> Ajouter
                    </button>
                  ) : null}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} aria-label="Choisir des photos" />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} aria-label="Prendre une photo" />
            </div>
            {photoError ? <p role="alert" className="mt-2 text-xs text-danger">{photoError}</p> : <p className="mt-2 text-xs text-text-muted">Les photos sont compressées dans votre navigateur avant l'envoi. La première sert de couverture.</p>}
          </Card>

          <Card>
            <h2 className="mb-3 text-md font-semibold">Compte et indications</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Compte Vinted" className="sm:col-span-2" hint={!account ? <>Aucun compte Vente : <Link to="/app/accounts?categorie=vente" className="underline underline-offset-2">ajoutez-en un</Link>.</> : account.usage === "personal" ? "Compte perso : l'annonce y sera rattachée, mais aucune automatisation ne s'y appliquera." : account.provider === "vinted" ? "L'annonce sera rattachée à ce compte de vente." : "Simulateur : aucune publication réelle."}>
                {(p) => (
                  <Select id={p.id} aria-describedby={p.describedBy} value={account?.id ?? ""} onChange={(e) => setConnectionId(e.target.value)}>
                    {accounts.length === 0 ? <option value="">Aucun compte Vente connecté</option> : null}
                    {accounts.map((c) => <option key={c.id} value={c.id}>{accountOptionLabel(c)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Marque (facultatif)">{(p) => <Input id={p.id} value={hints.brand} onChange={(e) => setHints({ ...hints, brand: e.target.value })} placeholder="ex. Ralph Lauren" maxLength={80} />}</Field>
              <Field label="Taille (facultatif)">{(p) => <Input id={p.id} value={hints.size} onChange={(e) => setHints({ ...hints, size: e.target.value })} placeholder="ex. M, 42" maxLength={40} />}</Field>
              <Field label="Prix d'achat" hint="Pour calculer votre marge et le prix plancher.">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={hints.purchasePriceCents} onChange={(v) => setHints({ ...hints, purchasePriceCents: v })} />}</Field>
              <Field label="Notes pour l'IA" hint="Défaut, matière, mesures…">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={hints.notes} onChange={(e) => setHints({ ...hints, notes: e.target.value })} placeholder="ex. pull torsadé, porté 2 fois" maxLength={500} />}</Field>
            </div>
            <Button variant="brand" size="lg" fullWidth className="mt-4" icon={<Sparkles />} disabled={photos.length === 0 || !canWrite} loading={generate.isPending} onClick={() => generate.mutate(undefined)}>
              {draft ? "Régénérer l'annonce" : "Générer l'annonce"}
            </Button>
            {photos.length === 0 ? <p className="mt-2 text-center text-xs text-text-muted">Ajoutez au moins une photo pour lancer la génération.</p> : null}
          </Card>
        </div>

        <div>
          {saved ? (
            <Card className="flex flex-col items-center gap-4 py-10 text-center">
              <IconTile icon={<Check />} tone="accent" size={52} />
              <div>
                <h2 className="text-lg font-semibold">{saved.published ? "Annonce mise en vente" : "Brouillon enregistré"}</h2>
                <p className="mt-1 text-sm text-text-muted">{saved.published ? `« ${saved.item.title} » est en vente${account ? ` sur ${account.label}` : ""}${mode === "demo" ? " (simulation)" : ""}. Elle apparaît dans votre dressing intelligent.` : `« ${saved.item.title} » est enregistré en brouillon (statut « En stock »). Publiez-le quand vous voulez.`}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Link to={`/app/items/${saved.item.id}`}><Button variant="secondary">Voir l'article</Button></Link>
                {saved.published ? <Link to="/app/dressing"><Button variant="secondary">Ouvrir le dressing</Button></Link> : null}
                <Button icon={<Sparkles />} onClick={reset}>Générer une autre annonce</Button>
              </div>
            </Card>
          ) : !form || !draft ? (
            <Card className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center">
              <IconTile icon={<Wand2 />} size={48} />
              <h2 className="text-md font-semibold">Votre annonce apparaîtra ici</h2>
              <p className="max-w-md text-sm text-text-muted">Titre optimisé pour la recherche, description claire et honnête, attributs (marque, taille, état, couleurs), prix conseillé à partir des ventes comparables. Tout reste modifiable avant publication.</p>
              {generate.isPending ? <p className="text-sm font-medium text-accent">Analyse des photos en cours…</p> : null}
            </Card>
          ) : (
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
                    <Field label="Marque">{(p) => <Input id={p.id} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="À vérifier sur l'étiquette" />}</Field>
                    <Field label="Taille">{(p) => <Input id={p.id} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="À vérifier" />}</Field>
                    <Field label="Catégorie">{(p) => <Select id={p.id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as DraftForm["category"] })}>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</Select>}</Field>
                    <Field label="État">{(p) => <Select id={p.id} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as DraftForm["condition"] })}>{ITEM_CONDITIONS.map((c) => <option key={c} value={c}>{ITEM_CONDITION_LABELS[c]}</option>)}</Select>}</Field>
                    <Field label="Couleurs">{(p) => <Input id={p.id} value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} placeholder="ex. Bleu marine" />}</Field>
                    <Field label="Matière">{(p) => <Input id={p.id} value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="ex. Coton" />}</Field>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {photos[0] ? <img src={photos[0].url} alt="Couverture" className="aspect-square w-full rounded-lg object-cover" /> : null}
                  <div className="rounded-lg bg-surface-muted p-3">
                    <Field label="Prix de vente">{(p) => <MoneyInput id={p.id} value={form.priceCents} onChange={(v) => setForm({ ...form, priceCents: v })} />}</Field>
                    <p className="mt-2 text-xs text-text-muted">Conseillé : <button type="button" className="font-semibold text-text underline underline-offset-2" onClick={() => setForm({ ...form, priceCents: draft.suggestedPriceCents })}><Money cents={draft.suggestedPriceCents} /></button></p>
                    <div className="mt-2 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--violet-200), var(--accent-vivid), var(--violet-200))" }} aria-hidden />
                    <p className="num mt-1 flex justify-between text-[11px] text-text-muted"><span>{formatCents(draft.priceLowCents)}</span><span>{formatCents(draft.priceHighCents)}</span></p>
                    <p className="mt-1 text-[11px] text-text-muted">{draft.priceMethod} · {draft.comparableCount} vente(s) comparable(s)</p>
                    {hints.purchasePriceCents && form.priceCents ? <p className="num mt-2 text-sm">Marge : <span className={form.priceCents - hints.purchasePriceCents >= 0 ? "font-semibold text-success" : "font-semibold text-danger"}>{formatCents(form.priceCents - hints.purchasePriceCents)}</span></p> : null}
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-text-muted"><Info className="size-3.5" aria-hidden />{account ? `Compte : ${account.label}` : "Aucun compte sélectionné"}{account?.provider === "vinted" && mode === "connected" ? " · publication via l'extension Selio" : ""}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false} disabled={!canWrite || form.title.trim().length < 3}>Enregistrer en brouillon</Button>
                  <Button variant="accent" icon={<Send />} onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true} disabled={!canWrite || form.title.trim().length < 3 || !form.priceCents}>Publier directement</Button>
                </div>
              </div>
            </Card>
          )}
          {saved ? null : <p className="mt-3 text-xs text-text-muted">Rien n'est publié sans votre clic. <button type="button" className="underline underline-offset-2" onClick={() => navigate("/app/settings/ai")}>Réglages de l'IA</button></p>}
        </div>
      </div>
    </>
  );
}
