import { useState, type DragEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import { PHOTO_ROLES, PHOTO_ROLE_LABELS, type PhotoRole } from "@selio/contracts";
import { Alert, Button, Card, Select, cn } from "@selio/ui";
import { assignmentChanged, groupsFrom, nextGroup, type SortAssignment, type UiPrep } from "../../../lib/studio/flow";

export interface SortPhoto {
  id: string;
  url: string;
  alt: string;
}

const DRAG_TYPE = "application/x-selio-photo";

/**
 * Tri des photos : le modèle a rangé chaque photo dans un article avec un rôle (face, dos, étiquette, mètre
 * ruban…). Le vendeur corrige en glissant une photo vers un autre article, ou au clavier et au doigt avec les
 * listes « Article » et « Rôle ». Une correction est relue par le serveur, article par article.
 */
export function SortStep({ prep, photos, assignment, onChange, onContinue, onReread, busy, canWrite }: {
  prep: UiPrep;
  photos: SortPhoto[];
  assignment: SortAssignment;
  onChange: (a: SortAssignment) => void;
  onContinue: () => void;
  onReread: () => void;
  busy: boolean;
  canWrite: boolean;
}) {
  const [dragOver, setDragOver] = useState<number | "new" | null>(null);
  const order = photos.map((p) => p.id);
  const groups = groupsFrom(assignment, order);
  const changed = assignmentChanged(prep, assignment);
  const byId = new Map(photos.map((p) => [p.id, p]));
  const roleOf = (id: string) => prep.articles.flatMap((a) => (a.roles[id] ? [a.roles[id]!] : []))[0];

  const move = (id: string, group: number) => onChange({ ...assignment, [id]: { ...assignment[id]!, group } });
  const setRole = (id: string, role: PhotoRole) => onChange({ ...assignment, [id]: { ...assignment[id]!, role } });
  // Les numéros affichés suivent l'ordre des articles (1, 2…) ; on garde les numéros internes du tri.
  const internalGroups = [...new Set(order.map((id) => assignment[id]?.group).filter((g): g is number => g !== undefined))];
  const drop = (target: number | "new") => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain");
    if (!id || !assignment[id]) return;
    move(id, target === "new" ? nextGroup(assignment) : target);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Tri des photos</h2>
        <p className="mt-1 text-sm text-text-muted">
          {photos.length} photo{photos.length > 1 ? "s" : ""} rangée{photos.length > 1 ? "s" : ""} en {groups.length} article{groups.length > 1 ? "s" : ""}. Vérifiez : glissez une photo vers un autre article, ou changez son article et son rôle avec les listes. L'étiquette et le mètre ruban servent aux étapes suivantes.
        </p>
        {prep.warnings.length > 0 ? <Alert tone="warning" className="mt-3">{prep.warnings.join(" ")}</Alert> : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {internalGroups.map((g, gi) => {
          const ids = order.filter((id) => assignment[id]?.group === g);
          return (
            <section
              key={g}
              aria-label={`Article ${gi + 1}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(g); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={drop(g)}
              className={cn("card p-4", dragOver === g && "border-accent bg-accent-soft")}
            >
              <h3 className="mb-3 text-sm font-semibold">Article {gi + 1} <span className="num font-normal text-text-muted">· {ids.length} photo{ids.length > 1 ? "s" : ""}</span></h3>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ids.map((id) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  const a = assignment[id]!;
                  const read = roleOf(id);
                  return (
                    <li
                      key={id}
                      draggable={canWrite}
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; }}
                      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface p-1.5"
                    >
                      <div className="relative aspect-square overflow-hidden rounded-md bg-surface-muted">
                        <img src={p.url} alt={p.alt || "Photo"} className="size-full object-cover" />
                        {canWrite ? <GripVertical className="absolute top-1 right-1 size-4 rounded-sm bg-surface/80 text-text-muted" aria-hidden /> : null}
                      </div>
                      <label className="sr-only" htmlFor={`role-${id}`}>Rôle de {p.alt || "la photo"}</label>
                      <Select id={`role-${id}`} value={a.role} disabled={!canWrite} onChange={(e) => setRole(id, e.target.value as PhotoRole)}>
                        {PHOTO_ROLES.map((r) => <option key={r} value={r}>{PHOTO_ROLE_LABELS[r]}</option>)}
                      </Select>
                      <label className="sr-only" htmlFor={`group-${id}`}>Article de {p.alt || "la photo"}</label>
                      <Select id={`group-${id}`} value={String(a.group)} disabled={!canWrite} onChange={(e) => move(id, e.target.value === "new" ? nextGroup(assignment) : Number(e.target.value))}>
                        {internalGroups.map((og, oi) => <option key={og} value={og}>Article {oi + 1}</option>)}
                        <option value="new">Nouvel article</option>
                      </Select>
                      <p className="num text-[11px] text-text-muted">{read === undefined ? "Rôle choisi par vous" : read.source === "seller" ? "Rôle indiqué par vous" : `Tri du modèle · sûr à ${Math.round(read.confidence * 100)} %`}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {canWrite ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver("new"); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={drop("new")}
            className={cn("flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong p-4 text-sm text-text-muted", dragOver === "new" && "border-accent bg-accent-soft text-accent")}
          >
            <Plus className="size-4" aria-hidden />Glissez une photo ici pour créer un nouvel article
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {changed ? <p className="text-xs text-text-muted sm:mr-auto">Tri modifié : l'étiquette et les mesures seront relues article par article.</p> : null}
        {changed ? (
          <Button variant="brand" onClick={onReread} loading={busy} disabled={!canWrite}>Relire avec ce tri</Button>
        ) : (
          <Button onClick={onContinue} disabled={busy}>Continuer vers l'étiquette</Button>
        )}
      </div>
    </div>
  );
}
