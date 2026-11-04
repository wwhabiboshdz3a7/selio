import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, ImagePlus, Search, ShieldCheck, Upload, X } from "lucide-react";
import { ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, type TrackPhotoSearch } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, Field, IconButton, IconTile, Input, PageHeader, StatusBadge, cn, formatCents, formatDate } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import type { TrackUsageView } from "../../../lib/data/types";
import { errorMessage } from "../../../lib/errors";
import { PHOTO_MAX_SIDE, formatDelayDays, reducePhoto, type ReducedPhoto } from "../../../lib/track";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { PriceEstimateView } from "../../components/pricing";
import { UsageMeter } from "../../components/usage";
import { TRACK_KEYS, TrackGate } from "./shared";

const PHOTO_NOT_KEPT = "La photo n'est pas conservée : seules la description lue et l'estimation sont gardées dans votre historique.";

/**
 * Selio Track · recherche par photo : la photo est réduite dans le navigateur (1 200 px au plus), lue par le
 * modèle 1 (marque, catégorie, matière, couleur, état, sans prix), puis estimée : fourchette P25 / P50 / P75,
 * trois stratégies, délai et méthode. LA PHOTO N'EST PAS CONSERVÉE.
 */
export default function TrackPhoto() {
  return <TrackGate>{(u) => <PhotoSearch usage={u} />}</TrackGate>;
}

function PhotoSearch({ usage }: { usage: TrackUsageView }) {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const canUse = can(session.role, "ai.use");
  const history = useQuery({ queryKey: ["track-photo-searches"], queryFn: () => client.trackPhotoSearches() });
  const model = useQuery({ queryKey: ["pricing-model"], queryFn: () => client.pricingModelStatus(), staleTime: 60_000 });
  const [photo, setPhoto] = useState<ReducedPhoto | null>(null);
  const [reducing, setReducing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [brand, setBrand] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<TrackPhotoSearch | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | File[] | null) => {
    const file = files ? Array.from(files).find((f) => f.type.startsWith("image/")) : undefined;
    setPhotoError(null);
    if (!file) { setPhotoError("Choisissez une image (JPEG, PNG ou WebP)."); return; }
    setReducing(true);
    try {
      setPhoto(await reducePhoto(file, PHOTO_MAX_SIDE));
      setResult(null);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photo illisible.");
    } finally {
      setReducing(false);
    }
  };

  const search = useAppMutation(() => {
    if (!photo) throw new Error("Ajoutez une photo.");
    return client.trackPhotoSearch({ photo: photo.dataUrl, hints: { brand: brand.trim() || undefined, notes: notes.trim() || undefined } });
  }, {
    invalidate: TRACK_KEYS,
    success: "Photo lue et estimée",
    // La photo réduite est oubliée dès la réponse : elle n'est gardée ni ici ni sur le serveur.
    onSuccess: (r) => { setResult(r); setPhoto(null); },
  });
  const exhausted = usage.photoSearches.exceeded;

  return (
    <>
      <PageHeader eyebrow="Selio Track" title="Recherche par photo" description="Une photo de l'article : Selio lit ce qu'il voit (marque, catégorie, matière, couleur, état), puis estime le prix de revente avec trois stratégies." />
      <Alert tone="info" className="mb-5" title="La photo n'est pas conservée">{PHOTO_NOT_KEPT} Elle est réduite à {PHOTO_MAX_SIDE} px dans votre navigateur avant l'envoi.</Alert>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-md font-semibold">Photo de l'article</h2>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void pick(e.dataTransfer.files); }}
              className={cn("rounded-xl border border-dashed p-4 transition-colors", dragOver ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-muted/40")}
              data-testid="zone-photo"
            >
              {photo ? (
                <figure className="relative mx-auto max-w-xs">
                  <img src={photo.dataUrl} alt="Photo réduite à envoyer" className="aspect-square w-full rounded-lg bg-surface object-contain" />
                  <IconButton label="Retirer la photo" size="sm" variant="secondary" className="absolute top-2 right-2" onClick={() => setPhoto(null)}><X /></IconButton>
                  <figcaption className="num mt-2 text-center text-xs text-text-muted">Réduite à {photo.width} × {photo.height} px (d'origine {photo.originalWidth} × {photo.originalHeight})</figcaption>
                </figure>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <IconTile icon={<ImagePlus />} tone="accent" size={48} />
                  <div>
                    <p className="text-base font-medium text-text">Glissez une photo ici</p>
                    <p className="text-sm text-text-muted">face de l'article, étiquette visible si possible</p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button icon={<Upload />} onClick={() => fileRef.current?.click()} loading={reducing}>Choisir une photo</Button>
                    <Button variant="secondary" icon={<Camera />} onClick={() => cameraRef.current?.click()} className="md:hidden">Prendre une photo</Button>
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} aria-label="Choisir une photo" />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} aria-label="Prendre une photo" />
            </div>
            {photoError ? <p role="alert" className="mt-2 text-xs text-danger">{photoError}</p> : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Marque (facultatif)">{(p) => <Input id={p.id} value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} placeholder="ex. Levi's" />}</Field>
              <Field label="Notes (facultatif)">{(p) => <Input id={p.id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="ex. jean 501, W32" />}</Field>
            </div>
            <Button variant="brand" size="lg" fullWidth className="mt-4" icon={<Search />} disabled={!photo || !canUse || exhausted || reducing} loading={search.isPending} onClick={() => search.mutate(undefined)}>Estimer le prix</Button>
            {search.isError ? <Alert tone="danger" className="mt-3" title={(search.error as { status?: number }).status === 402 ? "Limite atteinte" : "Recherche impossible"}>{errorMessage(search.error)}</Alert> : null}
            {exhausted ? <p className="mt-2 text-xs text-text-muted">Quota du mois atteint : il repart à zéro le 1er du mois.</p> : null}
            {mode === "demo" ? <p className="mt-2 text-xs text-text-muted">Démonstration : le simulateur ne voit pas réellement la photo, il s'appuie sur la marque et les notes.</p> : null}
          </Card>
          <Card><UsageMeter label="Recherches par photo du mois" counter={usage.photoSearches} hint="Chaque recherche compte aussi une requête IA." /></Card>
        </div>
        <div className="flex flex-col gap-4">
          {result ? <PhotoResult result={result} modelStatus={model.data} /> : (
            <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
              <IconTile icon={<Camera />} size={48} />
              <h2 className="text-md font-semibold">L'estimation apparaîtra ici</h2>
              <p className="max-w-md text-sm text-text-muted">Description lue sur la photo, fourchette P25 / P50 / P75, trois stratégies (vente rapide, standard, marge maximale), délai estimé et méthode.</p>
              {search.isPending ? <p className="text-sm font-medium text-accent">Lecture de la photo en cours…</p> : null}
            </Card>
          )}
          <Card padding="none">
            <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Recherches récentes</h2>
            <p className="px-4 text-xs text-text-muted md:px-5">Description et estimation seulement : aucune photo n'est gardée.</p>
            <QueryBoundary query={history} empty={(d) => (d.length === 0 ? <p className="px-4 py-4 text-sm text-text-muted md:px-5">Aucune recherche pour l'instant.</p> : null)}>
              {(list) => (
                <ul className="mt-3 divide-y divide-border border-t border-border">
                  {list.slice(0, 10).map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => setResult(h)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted md:px-5">
                        <span className="min-w-0"><span className="block truncate font-medium text-text">{h.description.title}</span><span className="block text-xs text-text-muted">{formatDate(h.createdAt)} · {ITEM_CATEGORY_LABELS[h.description.category]}</span></span>
                        <span className="num shrink-0 font-semibold">{h.estimate.p50 !== null ? formatCents(h.estimate.p50) : "—"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </Card>
        </div>
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-xs text-text-muted"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />Mon IA perso décrit l'article et explique le prix ; elle ne le choisit jamais. Le prix vient des ventes comparables et du modèle de prix.</p>
    </>
  );
}

function PhotoResult({ result, modelStatus }: { result: TrackPhotoSearch; modelStatus: Parameters<typeof PriceEstimateView>[0]["modelStatus"] }) {
  const d = result.description;
  return (
    <Card aria-label="Résultat de la recherche par photo">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">{d.title}</h2>
        {result.simulated ? <StatusBadge tone="muted">Lecture simulée</StatusBadge> : <StatusBadge tone="accent">Lu par le modèle 1</StatusBadge>}
      </div>
      <h3 className="mb-2 text-sm font-medium text-text-muted">Description lue</h3>
      <DescriptionList columns={2} items={[
        { label: "Marque", value: d.brand ?? "Non lisible" },
        { label: "Catégorie", value: ITEM_CATEGORY_LABELS[d.category] },
        { label: "Type de pièce", value: d.subcategory ?? "—" },
        { label: "Matière", value: d.material ?? "—" },
        { label: "Couleur", value: d.color ?? "—" },
        { label: "État visible", value: d.condition ? ITEM_CONDITION_LABELS[d.condition] : "—" },
        { label: "Confiance de lecture", value: `${Math.round(d.confidence * 100)} %`, numeric: true },
        { label: "Délai de vente estimé", value: formatDelayDays(result.estimate.delayDays), numeric: true },
      ]} />
      <h3 className="mt-5 mb-2 text-sm font-medium text-text-muted">Prix de revente estimé</h3>
      <PriceEstimateView estimate={result.estimate} modelStatus={modelStatus} simulated={result.simulated} />
    </Card>
  );
}
