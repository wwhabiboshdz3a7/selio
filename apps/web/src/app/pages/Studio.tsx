import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Check, ImagePlus, ScanSearch, Shirt, Sparkles, Star, Trash2, Upload, Wand2 } from "lucide-react";
import { GARMENT_KINDS, GARMENT_KIND_LABELS, STUDIO_MAX_PHOTOS, STUDIO_MODEL_MAX_PHOTOS, STUDIO_MODEL_MAX_SIDE_PX, type GarmentKind, type InventoryItem, type MarketplaceConnection, type MeasurementName, type PhotoRole } from "@selio/contracts";
import { listingAccounts, suggestFloorPrice } from "@selio/domain";
import { Alert, Button, Card, Field, IconButton, IconTile, Input, PageHeader, Select, cn } from "@selio/ui";
import { DataError, type DemoPhotoContent, type StudioDraft, type StudioPrepareRequest } from "../../lib/data/types";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { reducePhoto, toGeneratorPhoto, type ReducedPhoto } from "../../lib/studio/reduce";
import { renderSamplePhotos } from "../../lib/studio/samples";
import { assignmentFrom, coverFirst, groupsFrom, mergeUiPreps, toUiPrep, type SortAssignment, type UiPrep } from "../../lib/studio/flow";
import { buildPrepAnswers, emptyEdits, type PrepEdits } from "../../lib/studio/prep";
import { MoneyInput } from "../components/common";
import { useAppMutation } from "../components/hooks";
import { StudioStepper, type StudioStep } from "./studio/shared";
import { SortStep } from "./studio/SortStep";
import { LabelStep } from "./studio/LabelStep";
import { MeasuresStep } from "./studio/MeasuresStep";
import { DraftCard, toForm, type DraftForm } from "./studio/DraftCard";

const MAX_PHOTOS = STUDIO_MAX_PHOTOS;

type StudioPhoto = ReducedPhoto & { content?: DemoPhotoContent };

/** « @pseudo — nom interne », avec la mention simulation ou perso. */
function accountOptionLabel(c: MarketplaceConnection): string {
  const handle = typeof c.config.displayHandle === "string" && c.config.displayHandle ? `@${c.config.displayHandle}` : null;
  const name = handle && handle !== c.label ? `${handle} — ${c.label}` : c.label;
  return `${name}${c.provider === "demo" ? " (simulation)" : c.usage === "personal" ? " (perso)" : ""}`;
}

/**
 * Selio Studio façon Kavis (§5.11) : Photos → Tri → Étiquette → Mesures → Annonce. Les photos sont réduites
 * dans le navigateur (1 024 px, JPEG 0,8) avant tout envoi ; chaque valeur lue porte sa provenance ou reste
 * vide avec la question au vendeur ; la génération repart de la préparation validée.
 */
export default function Studio() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const [step, setStep] = useState<StudioStep>("photos");
  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [busyPhotos, setBusyPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [connectionId, setConnectionId] = useState<string>("");
  const [hints, setHints] = useState({ brand: "", size: "", notes: "", purchasePriceCents: null as number | null });
  const [kindHint, setKindHint] = useState<GarmentKind | "">("");
  const [prep, setPrep] = useState<UiPrep | null>(null);
  const [assignment, setAssignment] = useState<SortAssignment>({});
  const [current, setCurrent] = useState(0);
  const [edits, setEdits] = useState<Record<string, PrepEdits>>({});
  const [measureErrors, setMeasureErrors] = useState<Partial<Record<MeasurementName, string>>>({});
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [saved, setSaved] = useState<{ item: InventoryItem; published: boolean } | null>(null);
  // Selio Studio : les annonces créées à la suite pendant cette visite (la plus récente en tête).
  const [series, setSeries] = useState<{ item: InventoryItem; published: boolean }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const canWrite = session.role !== "viewer";
  // Comptes Vente uniquement (Vinted d'abord), puis les comptes Perso, signalés ; jamais un compte Achat.
  const accounts = useMemo(() => listingAccounts(connections.data ?? []), [connections.data]);
  const account = accounts.find((c) => c.id === connectionId) ?? accounts[0] ?? null;
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const ui = prep?.articles[current] ?? null;
  const articleEdits = ui ? edits[ui.prepId] ?? emptyEdits() : emptyEdits();

  const resetDraft = () => { setDraft(null); setForm(null); setSaved(null); setShareNote(null); setMeasureErrors({}); };
  /** Les photos changent : la préparation ne correspond plus, elle est oubliée. */
  const changePhotos = (next: (p: StudioPhoto[]) => StudioPhoto[]) => {
    setPhotos((p) => next(p).slice(0, MAX_PHOTOS));
    setPrep(null);
    setAssignment({});
    setEdits({});
    setCurrent(0);
    resetDraft();
    setStep("photos");
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    setPhotoError(null);
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, MAX_PHOTOS - photos.length);
    if (list.length === 0) { setPhotoError("Ajoutez des images (JPEG, PNG, WebP ou HEIC depuis un iPhone)."); return; }
    setBusyPhotos(true);
    try {
      const out: StudioPhoto[] = [];
      for (const f of list) {
        // Réduction AVANT l'envoi : côté long ≤ 1 024 px, JPEG qualité 0,8, ≤ 1 Mo (jamais la photo en pleine taille).
        try { out.push(await reducePhoto(f)); } catch (e) { setPhotoError(e instanceof Error ? e.message : "Photo illisible"); }
      }
      if (out.length) changePhotos((p) => [...p, ...out]);
    } finally {
      setBusyPhotos(false);
    }
  };

  const loadSamples = async () => {
    setPhotoError(null);
    setBusyPhotos(true);
    try {
      const samples = await renderSamplePhotos();
      changePhotos(() => samples);
      setHints({ brand: "", size: "", notes: "", purchasePriceCents: null });
      setKindHint("");
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photos d'exemple indisponibles");
    } finally {
      setBusyPhotos(false);
    }
  };

  const prepareInput = (list: StudioPhoto[], roles?: Record<string, PhotoRole>): StudioPrepareRequest => ({
    photos: list.map((p) => ({ id: p.id, url: p.url, ...(roles?.[p.id] ? { role: roles[p.id] } : {}) })),
    ...(kindHint ? { garmentKind: kindHint } : {}),
    ...(hints.notes.trim() ? { notes: hints.notes.trim() } : {}),
    hints: { ...(hints.brand.trim() ? { brand: hints.brand.trim() } : {}), ...(hints.size.trim() ? { size: hints.size.trim() } : {}) },
  });
  /** Démonstration : ce que montrent les photos d'exemple (ignoré par le serveur). `regroup` : le vendeur a fixé l'article. */
  const simulatorFor = (list: StudioPhoto[], regroup = false) => ({
    simulator: { photos: Object.fromEntries(list.map((p) => [p.id, { name: p.alt, ...(p.content ?? {}), ...(regroup ? { group: 1 } : {}) }])) },
  });

  const prepare = useAppMutation(async () => {
    const r = await client.prepareStudio(prepareInput(photos), simulatorFor(photos));
    return toUiPrep(r, photos.map((p) => p.id));
  }, {
    invalidate: ["ai-requests"],
    success: (u) => `${u.articles.length > 1 ? `${u.articles.length} articles retrouvés` : "Photos triées"} : vérifiez le tri`,
    onSuccess: (u) => { setPrep(u); setAssignment(assignmentFrom(u)); setCurrent(0); setEdits({}); resetDraft(); setStep("sort"); },
  });

  // Tri corrigé par le vendeur : relu article par article (rôles indiqués par lui, prioritaires).
  const reread = useAppMutation(async () => {
    const out: UiPrep[] = [];
    for (const g of groupsFrom(assignment, photos.map((p) => p.id))) {
      const list = g.photoIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
      const roles = Object.fromEntries(g.photoIds.map((id) => [id, assignment[id]!.role]));
      const r = await client.prepareStudio(prepareInput(list, roles), simulatorFor(list, true));
      out.push(toUiPrep(r, list.map((p) => p.id)));
    }
    return mergeUiPreps(out);
  }, {
    invalidate: ["ai-requests"],
    success: "Étiquette et mesures relues avec votre tri",
    onSuccess: (u) => { setPrep(u); setAssignment(assignmentFrom(u)); setCurrent(0); setEdits({}); resetDraft(); setStep("label"); },
  });

  // Validation (réponses du vendeur → provenance « vous ») puis rédaction à partir de la préparation validée.
  const generate = useAppMutation(async () => {
    if (!prep || !ui) throw new DataError("validation", "Préparez d'abord les photos.", 400);
    const built = buildPrepAnswers(ui.article, articleEdits);
    if (!built.ok) {
      setMeasureErrors(built.errors);
      throw new DataError("validation", "Une mesure n'est pas lisible : indiquez-la en cm (par exemple 52 ou 41,5).", 400);
    }
    setMeasureErrors({});
    const v = await client.validateStudioPrep(ui.prepId, built.answers);
    // La préparation est validée même si la rédaction échoue ensuite (quota…) : l'écran suit le serveur.
    const validated = { ...ui.article, status: v.prep.status, fields: v.prep.fields, measurements: v.prep.measurements, questions: v.prep.questions, garmentKind: v.prep.garmentKind };
    setPrep((p) => (p ? { ...p, articles: p.articles.map((a, i) => (i === current ? { ...a, article: validated } : a)) } : p));
    setEdits((e) => ({ ...e, [ui.prepId]: emptyEdits() }));
    setShareNote(built.answers.shareMeasurements ? (v.shared.done ? "Mesures partagées anonymement avec la base des références. Merci !" : `Mesures non partagées : ${v.shared.reason ?? "conditions non réunies"}`) : null);
    const descriptionIds = ui.photoIds.filter((id) => ui.roles[id]?.role !== "label" && ui.roles[id]?.role !== "tape");
    return client.generateListing({
      prepId: ui.prepId,
      photos: descriptionIds.flatMap((id) => (byId.get(id) ? [toGeneratorPhoto(byId.get(id)!)] : [])),
      connectionId: account?.id ?? null,
      hints: { ...(hints.notes.trim() ? { notes: hints.notes.trim() } : {}), ...(hints.purchasePriceCents ? { purchasePriceCents: hints.purchasePriceCents } : {}) },
    });
  }, {
    invalidate: ["ai-requests", "usage"],
    success: (d) => (d.source === "ai" ? "Annonce rédigée : relisez-la avant de publier" : "Gabarit de secours utilisé : complétez l'annonce"),
    onSuccess: (d) => { setDraft(d); setForm(toForm(d)); setSaved(null); setStep("listing"); },
  });

  const articlePhotoIds = ui ? coverFirst(ui.photoIds, ui.roles) : photos.map((p) => p.id);
  const save = useAppMutation(async (publish: boolean) => {
    if (!form) throw new Error("Aucune annonce générée");
    const purchase = hints.purchasePriceCents ?? 0;
    const floor = form.priceCents ? Math.min(form.priceCents, suggestFloorPrice({ purchasePriceCents: purchase, purchaseFeesCents: 0 }, session.org.settings.margin)) : null;
    const itemPhotos = articlePhotoIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
    const item = await client.createItem({
      title: form.title.trim(),
      description: [form.description.trim(), form.hashtags.length ? form.hashtags.join(" ") : ""].filter(Boolean).join("\n\n"),
      brand: form.brand.trim() || null,
      size: form.size.trim() || null,
      category: form.category,
      condition: form.condition,
      photos: itemPhotos.map((p, position) => ({ id: p.id, url: p.url, alt: p.alt || form.title, position })),
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
  }, { invalidate: ["items", "overview", "nav-counts", "dressing"], success: (r) => (r.published ? "Annonce mise en vente" : "Brouillon enregistré"), onSuccess: (r) => { setSaved(r); setSeries((s) => [r, ...s]); } });

  const reset = () => { changePhotos(() => []); setHints({ brand: "", size: "", notes: "", purchasePriceCents: null }); setKindHint(""); };
  const remaining = prep ? prep.articles.length - current - 1 : 0;
  const next = () => {
    if (prep && remaining > 0) { setCurrent(current + 1); resetDraft(); setStep("label"); return; }
    reset();
  };
  const reachable = (s: StudioStep) => s === "photos" || (s === "sort" && Boolean(prep)) || ((s === "label" || s === "measures") && Boolean(ui)) || (s === "listing" && Boolean(draft));

  const articleNav = prep && prep.articles.length > 1 ? (
    <nav aria-label="Articles" className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
      {prep.articles.map((a, i) => (
        <button key={a.prepId} type="button" aria-current={i === current ? "true" : undefined} onClick={() => { setCurrent(i); resetDraft(); if (step === "listing") setStep("label"); }} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm", i === current ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-muted")}>
          Article {i + 1}{a.article.status === "validated" ? <Check className="size-3.5" aria-label="validé" /> : null}
        </button>
      ))}
    </nav>
  ) : null;

  return (
    <>
      <PageHeader
        title="Générateur d'annonces"
        eyebrow="Selio Studio · Créer"
        description="Ajoutez vos photos : Studio les trie par article, lit l'étiquette et les mesures sur un mètre ruban photographié, puis rédige l'annonce. Chaque valeur dit d'où elle vient ; rien n'est inventé. Vous relisez, puis brouillon ou mise en vente."
        actions={step !== "photos" ? <Button variant="secondary" icon={<ArrowLeft />} onClick={reset}>Nouvelle annonce</Button> : undefined}
      />

      {mode === "demo" ? (
        <Alert tone="info" className="mb-5" title="Démonstration : IA simulée">
          Le simulateur ne voit pas vos photos : avec elles, l'étiquette reste illisible et aucun mètre ruban n'est vu, donc les champs restent vides avec leur question (jamais une valeur devinée). Les photos d'exemple décrivent leur étiquette et leur mètre ruban au simulateur pour montrer des lectures. Le prix conseillé vient des ventes comparables et du modèle de prix (ici de démonstration) ; mon IA perso l'explique, elle ne le choisit jamais.
        </Alert>
      ) : null}

      <StudioStepper current={step} reachable={reachable} onGo={(s) => { if (s !== "listing") setSaved(null); setStep(s); }} />

      {series.length > 0 ? (
        <section aria-label="Série en cours" className="card mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <p className="text-sm font-medium text-text">Série en cours <span className="num font-normal text-text-muted">· {series.length} annonce{series.length > 1 ? "s" : ""} ({series.filter((s) => s.published).length} en vente)</span></p>
          <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
            {series.slice(0, 8).map(({ item, published }) => (
              <li key={item.id} className="min-w-0">
                <Link to={`/app/items/${item.id}`} className="flex max-w-56 items-center gap-2 rounded-md border border-border py-1 pr-2.5 pl-1 text-xs text-text hover:bg-surface-muted" title={item.title}>
                  {item.photos[0] ? <img src={item.photos[0].url} alt="" className="size-7 rounded-sm object-cover" /> : <span className="size-7 rounded-sm bg-surface-muted" aria-hidden />}
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className={cn("size-1.5 shrink-0 rounded-full", published ? "bg-success" : "bg-border-strong")} aria-label={published ? "en vente" : "brouillon"} />
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/studio/annonces" className="text-sm font-medium text-accent hover:underline">Annonces générées</Link>
        </section>
      ) : null}

      {step === "photos" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-4">
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-md font-semibold">Photos <span className="num text-sm font-normal text-text-muted">{photos.length}/{MAX_PHOTOS}</span></h2>
                {photos.length > 0 ? <Button size="sm" variant="ghost" onClick={() => changePhotos(() => [])}>Tout retirer</Button> : null}
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
                      <p className="text-sm text-text-muted">Face, dos, étiquette, et le mètre ruban posé à plat sur l'article</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button icon={<Upload />} onClick={() => fileRef.current?.click()} loading={busyPhotos}>Choisir des photos</Button>
                      <Button variant="secondary" icon={<Camera />} onClick={() => cameraRef.current?.click()} className="md:hidden">Prendre une photo</Button>
                    </div>
                    {mode === "demo" ? <Button variant="ghost" size="sm" icon={<Shirt />} onClick={() => void loadSamples()} disabled={busyPhotos}>Essayer avec des photos d'exemple</Button> : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {photos.map((p, i) => (
                      <figure key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface">
                        <img src={p.url} alt={p.alt || `Photo ${i + 1}`} className="size-full object-cover" />
                        {i === 0 ? <span className="absolute top-1.5 left-1.5 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-text shadow-sm">Couverture</span> : null}
                        <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                          {i > 0 ? <IconButton label="Mettre en couverture" size="sm" variant="secondary" onClick={() => changePhotos((ps) => [ps[i]!, ...ps.filter((_, j) => j !== i)])}><Star /></IconButton> : null}
                          <IconButton label={`Retirer la photo ${i + 1}`} size="sm" variant="secondary" onClick={() => changePhotos((ps) => ps.filter((x) => x.id !== p.id))}><Trash2 /></IconButton>
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
              {photoError ? <p role="alert" className="mt-2 text-xs text-danger">{photoError}</p> : <p className="mt-2 text-xs text-text-muted">Réduites dans votre navigateur avant l'envoi ({STUDIO_MODEL_MAX_SIDE_PX.toLocaleString("fr-FR")} px de côté long, JPEG qualité 80) ; le modèle en reçoit {STUDIO_MODEL_MAX_PHOTOS} au plus à la fois. La première sert de couverture.</p>}
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
                <Field label="Type de pièce (facultatif)" hint="Seulement pour savoir quelles mesures demander.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={hints.notes} onChange={(e) => setHints({ ...hints, notes: e.target.value })} placeholder="ex. jean slim, pull torsadé" maxLength={200} />}</Field>
                <Field label="Famille">
                  {(p) => (
                    <Select id={p.id} value={kindHint} onChange={(e) => setKindHint(e.target.value as GarmentKind | "")}>
                      <option value="">D'après le type de pièce</option>
                      {GARMENT_KINDS.map((k) => <option key={k} value={k}>{GARMENT_KIND_LABELS[k]}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Marque (facultatif)" hint="Si vous la connaissez : comparée à l'étiquette.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={hints.brand} onChange={(e) => setHints({ ...hints, brand: e.target.value })} placeholder="ex. Ralph Lauren" maxLength={80} />}</Field>
                <Field label="Taille (facultatif)">{(p) => <Input id={p.id} value={hints.size} onChange={(e) => setHints({ ...hints, size: e.target.value })} placeholder="ex. M, 42" maxLength={40} />}</Field>
                <Field label="Prix d'achat" hint="Pour calculer votre marge et le prix plancher.">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={hints.purchasePriceCents} onChange={(v) => setHints({ ...hints, purchasePriceCents: v })} />}</Field>
              </div>
              <Button variant="brand" size="lg" fullWidth className="mt-4" icon={<ScanSearch />} disabled={photos.length === 0 || !canWrite || busyPhotos} loading={prepare.isPending} onClick={() => prepare.mutate(undefined)}>
                Préparer l'annonce
              </Button>
              {photos.length === 0 ? <p className="mt-2 text-center text-xs text-text-muted">Ajoutez au moins une photo pour lancer la préparation.</p> : null}
              {prepare.error instanceof DataError && prepare.error.code === "ai_unavailable" ? <p className="mt-2 text-center text-xs text-text-muted">Lecture des photos indisponible : <Link to="/app/items/new" className="font-medium text-accent hover:underline">créer l'article à la main</Link>.</p> : null}
            </Card>
          </div>

          <Card className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center">
            <IconTile icon={<Wand2 />} size={48} />
            <h2 className="text-md font-semibold">Préparer, puis générer</h2>
            <ul className="max-w-md space-y-1.5 text-left text-sm text-text-muted">
              <li>1. <span className="text-text">Tri</span> : face, dos, étiquette, mètre ruban, défauts ; photos regroupées par article.</li>
              <li>2. <span className="text-text">Étiquette</span> : marque, taille, matière et référence lues avec leur confiance, sinon une question.</li>
              <li>3. <span className="text-text">Mesures</span> : lues sur le mètre ruban, retrouvées par la référence, ou indiquées par vous. Jamais estimées à l'œil.</li>
              <li>4. <span className="text-text">Annonce</span> : rédigée à partir de ce que vous avez validé, prix conseillé en trois stratégies.</li>
            </ul>
            {prepare.isPending ? <p className="text-sm font-medium text-accent">Tri et lecture des photos en cours…</p> : null}
          </Card>
        </div>
      ) : null}

      {step === "sort" && prep ? (
        <SortStep prep={prep} photos={photos} assignment={assignment} onChange={setAssignment} onContinue={() => setStep("label")} onReread={() => reread.mutate(undefined)} busy={reread.isPending} canWrite={canWrite} />
      ) : null}

      {step === "label" && prep && ui ? (
        <LabelStep ui={ui} prep={prep} photos={byId} edits={articleEdits} onEdits={(e) => setEdits({ ...edits, [ui.prepId]: e })} onBack={() => setStep("sort")} onNext={() => setStep("measures")} nav={articleNav} canWrite={canWrite} />
      ) : null}

      {step === "measures" && prep && ui ? (
        <MeasuresStep ui={ui} edits={articleEdits} onEdits={(e) => setEdits({ ...edits, [ui.prepId]: e })} onBack={() => setStep("label")} onGenerate={() => generate.mutate(undefined)} generating={generate.isPending} nav={articleNav} canWrite={canWrite} errors={measureErrors} demo={mode === "demo"} />
      ) : null}

      {step === "listing" && draft && form ? (
        saved ? (
          <Card className="flex flex-col items-center gap-4 py-10 text-center">
            <IconTile icon={<Check />} tone="accent" size={52} />
            <div>
              <h2 className="text-lg font-semibold">{saved.published ? "Annonce mise en vente" : "Brouillon enregistré"}</h2>
              <p className="mt-1 text-sm text-text-muted">{saved.published ? `« ${saved.item.title} » est en vente${account ? ` sur ${account.label}` : ""}${mode === "demo" ? " (simulation)" : ""}. Elle apparaît dans votre dressing intelligent.` : `« ${saved.item.title} » est enregistré en brouillon (statut « En stock »). Publiez-le quand vous voulez.`}</p>
              {remaining > 0 ? <p className="mt-1 text-sm text-text-muted">Encore {remaining} article{remaining > 1 ? "s" : ""} dans cet envoi.</p> : null}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Link to={`/app/items/${saved.item.id}`}><Button variant="secondary">Voir l'article</Button></Link>
              {saved.published ? <Link to="/app/dressing"><Button variant="secondary">Ouvrir le dressing</Button></Link> : null}
              <Link to="/studio/photos-portees"><Button variant="secondary">Photos portées</Button></Link>
              <Button icon={<Sparkles />} onClick={next}>Article suivant</Button>
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {articleNav}
            {shareNote ? <Alert tone="info">{shareNote}</Alert> : null}
            <DraftCard draft={draft} form={form} onForm={setForm} cover={byId.get(articlePhotoIds[0] ?? "")?.url ?? null} purchasePriceCents={hints.purchasePriceCents} account={account} mode={mode} canWrite={canWrite} onSave={(publish) => save.mutate(publish)} saving={save.isPending ? save.variables ?? null : null} />
            <div className="flex justify-start"><Button variant="ghost" icon={<ArrowLeft />} onClick={() => setStep("measures")}>Revenir aux mesures</Button></div>
          </div>
        )
      ) : null}

      {saved ? null : <p className="mt-3 text-xs text-text-muted">Rien n'est publié sans votre clic. <button type="button" className="underline underline-offset-2" onClick={() => navigate("/app/settings/ai")}>Réglages de l'IA</button></p>}
    </>
  );
}
