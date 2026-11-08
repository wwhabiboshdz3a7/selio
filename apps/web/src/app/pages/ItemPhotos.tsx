import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, ImagePlus, Search, Sparkles, Trash2 } from "lucide-react";
import { ITEM_STATUS_LABELS, type Photo } from "@selio/contracts";
import { can, newId } from "@selio/domain";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, Tag, buttonClass, cn } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { ItemThumb, QueryBoundary } from "../components/common";
import { useAppMutation, useDebouncedValue } from "../components/hooks";

const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 1_500_000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Articles à photographier (vue du contributeur photos, et de toute l'équipe qui ajoute des photos) :
 * la liste des articles avec leur nombre de photos ; aucune donnée financière, aucune autre action.
 */
export default function ItemPhotos() {
  const client = useClient();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 300);
  const items = useQuery({ queryKey: ["items", "photos", q], queryFn: () => client.listItems({ q: q || undefined, pageSize: 100, sort: "updated_desc" }) });
  return (
    <>
      <PageHeader eyebrow="Photos" title="Articles à photographier" description="Ajoutez des photos à un article, puis lancez le générateur d'annonces. Les articles avec peu de photos sont en tête." actions={<Link to="/studio" className={buttonClass({ variant: "brand", className: "[&>svg]:text-gold-300" })}><Sparkles aria-hidden />Générer une annonce</Link>} />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input aria-label="Rechercher un article" placeholder="Rechercher un article" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <QueryBoundary query={items} empty={(p) => (p.items.length === 0 ? <EmptyState icon={<Camera />} title="Aucun article" description={q ? "Aucun article ne correspond à cette recherche." : "Les articles créés par l'équipe apparaîtront ici."} /> : null)}>
        {(page) => {
          const list = [...page.items].filter((it) => it.status !== "archived" && it.status !== "sold").sort((a, b) => a.photos.length - b.photos.length);
          return (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Articles à photographier">
              {list.map((it) => (
                <li key={it.id} className="min-w-0">
                  <Link to={`/app/items/${it.id}/photos`} className="card flex min-w-0 items-center gap-3 p-3 transition-colors hover:bg-surface-muted">
                    <ItemThumb photos={it.photos} title={it.title} size={56} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{it.title}</span>
                      <span className="block truncate text-xs text-text-muted">{[it.brand, it.size ? `taille ${it.size}` : null, ITEM_STATUS_LABELS[it.status]].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={cn("num shrink-0 text-xs font-medium", it.photos.length < 3 ? "text-warning" : "text-text-muted")}>{it.photos.length} / {MAX_PHOTOS} photos</span>
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryBoundary>
    </>
  );
}

/** Ajout de photos à un article : rien d'autre n'est modifiable ici (droit « items.photos.write »). */
export function ItemPhotosDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["item", id], queryFn: () => client.getItem(id), enabled: id !== "" });
  const [pending, setPending] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const allowed = can(session.role, "items.photos.write");
  const save = useAppMutation(() => client.addItemPhotos(id, pending), { invalidate: ["item", "items"], success: (it) => `Photos ajoutées : ${it.photos.length} au total`, onSuccess: () => setPending([]) });

  const add = (files: FileList | null, existing: number) => {
    if (!files) return;
    setError(null);
    const room = MAX_PHOTOS - existing - pending.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > list.length) setError(`${MAX_PHOTOS} photos au plus par article.`);
    for (const f of list) {
      if (!ALLOWED_TYPES.includes(f.type)) { setError(`Format refusé : ${f.name} (JPEG, PNG ou WebP uniquement).`); continue; }
      if (f.size > MAX_PHOTO_BYTES) { setError(`Fichier trop lourd : ${f.name} (1,5 Mo max).`); continue; }
      const reader = new FileReader();
      reader.onload = () => setPending((s) => [...s, { id: newId(), url: String(reader.result), alt: f.name, position: existing + s.length }]);
      reader.readAsDataURL(f);
    }
  };

  return (
    <>
      <Link to="/app/items/photos" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden />Articles à photographier</Link>
      <QueryBoundary query={q} skeleton="spinner">
        {(it) => {
          const total = it.photos.length + pending.length;
          return (
            <>
              <PageHeader eyebrow="Photos" title={it.title} description={<span className="flex flex-wrap items-center gap-2">{it.brand ? <Tag>{it.brand}</Tag> : null}{it.size ? <Tag>Taille {it.size}</Tag> : null}<span className="num text-text-muted">{total} / {MAX_PHOTOS} photos</span></span>} />
              <Card>
                <h2 className="text-md font-semibold">Photos de l'article</h2>
                <p className="mt-1 mb-4 text-sm text-text-muted">JPEG, PNG ou WebP, 1,5 Mo au plus. Face, dos, étiquette, défauts éventuels : à la lumière du jour, sur un fond uni.</p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6" aria-label="Photos">
                  {it.photos.map((ph) => (
                    <div key={ph.id} className="aspect-square overflow-hidden rounded-md bg-surface-muted"><img src={ph.url} alt={ph.alt || it.title} className="size-full object-cover" /></div>
                  ))}
                  {pending.map((ph, i) => (
                    <div key={ph.id} className="relative aspect-square overflow-hidden rounded-md bg-surface-muted ring-2 ring-accent">
                      <img src={ph.url} alt={ph.alt} className="size-full object-cover" />
                      <IconButton label={`Retirer la nouvelle photo ${i + 1}`} size="sm" variant="secondary" className="absolute top-1 right-1" onClick={() => setPending((s) => s.filter((x) => x.id !== ph.id))}><Trash2 /></IconButton>
                    </div>
                  ))}
                  {allowed && total < MAX_PHOTOS ? (
                    <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-xs text-text-muted hover:bg-surface-muted focus-within:ring-2 focus-within:ring-accent">
                      <ImagePlus className="size-5" aria-hidden />
                      Ajouter
                      <input type="file" accept={ALLOWED_TYPES.join(",")} multiple className="sr-only" aria-label="Ajouter des photos" onChange={(e) => { add(e.target.files, it.photos.length); e.target.value = ""; }} />
                    </label>
                  ) : null}
                </div>
                {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
                {!allowed ? <p className="mt-3 text-sm text-text-muted">Votre rôle ne permet pas d'ajouter des photos.</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!allowed || pending.length === 0}>Enregistrer {pending.length > 0 ? `${pending.length} photo${pending.length > 1 ? "s" : ""}` : "les photos"}</Button>
                  <Link to="/studio" className={buttonClass({ variant: "secondary" })}><Sparkles aria-hidden />Lancer le générateur</Link>
                </div>
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}
