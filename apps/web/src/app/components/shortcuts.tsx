import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, Boxes, CircleUser, ClipboardList, GripVertical, History, Layers, ListChecks, MessageSquare, Package, Plus, Radar, RotateCcw, Shirt, ShoppingCart, Sparkles, TrendingUp, Upload, Users, X } from "lucide-react";
import { DEFAULT_SHORTCUTS, MAX_SHORTCUTS, SHORTCUT_IDS, type ShortcutId } from "@selio/contracts";
import { can, type Action } from "@selio/domain";
import { Button, Dialog, IconButton, cn } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { useAppMutation } from "./hooks";

/**
 * Raccourcis personnalisés de Selio Manager : les pages et actions que l'utilisateur garde sous la main, dans
 * la vue d'ensemble et dans le dock mobile. Rangés côté serveur par utilisateur (/api/auth/preferences) : les
 * mêmes sur téléphone et ordinateur. Chaque raccourci n'apparaît que si le rôle y a droit.
 */
export interface ShortcutDef {
  id: ShortcutId;
  /** Libellé complet (vue d'ensemble, éditeur). */
  label: string;
  /** Libellé court (dock mobile). */
  short: string;
  description: string;
  to: string;
  icon: ReactNode;
  action: Action;
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDef> = {
  items: { id: "items", label: "Articles et stock", short: "Articles", description: "Tout le stock, filtres et actions groupées", to: "/app/items", icon: <Boxes />, action: "items.read" },
  new_item: { id: "new_item", label: "Nouvel article", short: "Nouveau", description: "Ajouter un article au stock", to: "/app/items/new", icon: <Plus />, action: "items.write" },
  import_items: { id: "import_items", label: "Importer des articles", short: "Importer", description: "Fichier CSV ou tableur", to: "/app/items/import", icon: <Upload />, action: "items.write" },
  studio: { id: "studio", label: "Générer une annonce", short: "Studio", description: "Vos photos → annonce rédigée par Studio", to: "/studio", icon: <Sparkles />, action: "studio.generate" },
  messages: { id: "messages", label: "Messages", short: "Messages", description: "Répondre aux acheteurs", to: "/app/messages", icon: <MessageSquare />, action: "conversations.read" },
  orders_to_ship: { id: "orders_to_ship", label: "Commandes à expédier", short: "À expédier", description: "Commandes payées, bordereau à imprimer", to: "/app/orders?status=paid", icon: <Package />, action: "orders.read" },
  radar: { id: "radar", label: "Bonnes affaires", short: "Affaires", description: "Radar : chaque affaire notée sur 100", to: "/app/radar", icon: <Radar />, action: "radar.read" },
  track: { id: "track", label: "Selio Track", short: "Track", description: "Niches, tendances et prix du marché", to: "/track", icon: <TrendingUp />, action: "radar.read" },
  dressing: { id: "dressing", label: "Dressing intelligent", short: "Dressing", description: "Notes et annonces à republier", to: "/app/dressing", icon: <Shirt />, action: "items.read" },
  purchase: { id: "purchase", label: "Achats à valider", short: "À valider", description: "Achat assisté : vous validez chaque achat", to: "/app/purchase", icon: <ShoppingCart />, action: "radar.read" },
  customers: { id: "customers", label: "Clients", short: "Clients", description: "Acheteurs, historique et notes", to: "/app/customers", icon: <Users />, action: "customers.read" },
  analytics: { id: "analytics", label: "Analyses", short: "Analyses", description: "Ventes, marges et tendances", to: "/app/analytics", icon: <ClipboardList />, action: "analytics.read" },
  automations: { id: "automations", label: "Journal des tâches", short: "Tâches", description: "Actions automatiques à valider", to: "/app/automations", icon: <ListChecks />, action: "automations.read" },
  journal: { id: "journal", label: "Journal d'activité", short: "Journal", description: "Ce que Selio et l'équipe ont fait", to: "/app/journal", icon: <History />, action: "org.read" },
  bundles: { id: "bundles", label: "Lots intelligents", short: "Lots", description: "Propositions de lots à envoyer", to: "/app/items/lots", icon: <Layers />, action: "items.read" },
  accounts: { id: "accounts", label: "Comptes Vinted", short: "Comptes", description: "Comptes vente, achat et perso", to: "/app/accounts", icon: <CircleUser />, action: "connections.read" },
};

const PREFERENCES_KEY = ["preferences"] as const;

/** Raccourcis enregistrés (null : par défaut), raccourcis effectifs pour le rôle, enregistrement. */
export function useShortcuts() {
  const client = useClient();
  const session = useRequiredSession();
  const prefs = useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => client.getPreferences(), staleTime: 60_000 });
  const saved = prefs.data?.shortcuts ?? null;
  const allowed = useMemo(() => SHORTCUT_IDS.filter((id) => can(session.role, SHORTCUTS[id].action)), [session.role]);
  const ids = useMemo(() => (saved ?? DEFAULT_SHORTCUTS).filter((id) => allowed.includes(id)), [saved, allowed]);
  const save = useAppMutation((shortcuts: ShortcutId[] | null) => client.updatePreferences({ shortcuts }), { invalidate: [...PREFERENCES_KEY], success: (p) => (p.shortcuts === null ? "Raccourcis par défaut rétablis" : "Raccourcis enregistrés") });
  return { ids, saved, allowed, isDefault: saved === null, loading: prefs.isPending, save };
}

/** Entrées du dock mobile : les trois premiers raccourcis (hors Studio, déjà au centre du dock). */
export function dockShortcuts(ids: readonly ShortcutId[]): ShortcutDef[] {
  return ids.filter((id) => id !== "studio").slice(0, 3).map((id) => SHORTCUTS[id]);
}

/** Déplace l'élément d'index `from` à l'index `to` (copie). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Tuiles de la vue d'ensemble. */
export function ShortcutTiles({ ids, hints = {}, onEdit }: { ids: readonly ShortcutId[]; hints?: Partial<Record<ShortcutId, string>>; onEdit: () => void }) {
  return (
    <nav aria-label="Raccourcis" className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-muted">Vos raccourcis</h2>
        <button type="button" onClick={onEdit} className="rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-surface-muted">Personnaliser les raccourcis</button>
      </div>
      {ids.length === 0 ? (
        <button type="button" onClick={onEdit} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong p-6 text-sm font-medium text-text-muted hover:border-accent hover:text-accent"><Plus className="size-4" aria-hidden />Ajouter des raccourcis</button>
      ) : (
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ids.map((id, i) => {
            const s = SHORTCUTS[id];
            return (
              <li key={id} className="flex min-w-0">
                <Link to={s.to} className="group flex min-w-0 flex-1 items-start gap-3 bg-surface p-3.5 transition-colors hover:bg-surface-muted/60 md:p-4">
                  <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[18px]", i === 0 || id === "studio" ? "bg-accent-soft text-accent" : "bg-surface-muted text-text-muted group-hover:text-accent")} aria-hidden>{s.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-semibold text-text"><span className="truncate">{s.label}</span><ArrowRight className="size-3 shrink-0 text-accent opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></span>
                    <span className="line-clamp-2 block text-xs text-text-muted">{hints[id] ?? s.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

/**
 * Éditeur des raccourcis : ajouter, retirer, réordonner (glisser-déposer, ou flèches au clavier), revenir aux
 * raccourcis par défaut. Rien n'est enregistré avant « Enregistrer ».
 */
export function ShortcutsEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ids, allowed, isDefault, save } = useShortcuts();
  const [draft, setDraft] = useState<ShortcutId[]>(ids);
  const [announce, setAnnounce] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { if (open) setDraft(ids); }, [open, ids]);

  const move = (from: number, to: number, focus = true) => {
    if (to < 0 || to >= draft.length) return;
    setDraft((d) => moveItem(d, from, to));
    setAnnounce(`${SHORTCUTS[draft[from]!].label} : position ${to + 1} sur ${draft.length}`);
    if (focus) requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>(`[data-move="${to < from ? "up" : "down"}"]`)[to]?.focus());
  };
  const remove = (id: ShortcutId) => { setDraft((d) => d.filter((x) => x !== id)); setAnnounce(`${SHORTCUTS[id].label} retiré`); };
  const add = (id: ShortcutId) => { setDraft((d) => (d.length >= MAX_SHORTCUTS ? d : [...d, id])); setAnnounce(`${SHORTCUTS[id].label} ajouté`); };
  const available = allowed.filter((id) => !draft.includes(id));
  const onDrop = (e: DragEvent, to: number) => { e.preventDefault(); if (dragging !== null) move(dragging, to, false); setDragging(null); };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Personnaliser les raccourcis"
      description="Choisissez les pages et actions que vous utilisez le plus. Les trois premiers (hors Studio) forment le dock sur téléphone. Enregistrés sur votre compte : les mêmes sur tous vos appareils."
      footer={
        <>
          <Button variant="ghost" icon={<RotateCcw />} disabled={isDefault && draft.join() === ids.join()} onClick={() => save.mutate(null, { onSuccess: onClose })}>Raccourcis par défaut</Button>
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate(draft, { onSuccess: onClose })} loading={save.isPending}>Enregistrer</Button>
        </>
      }
    >
      <p className="sr-only" aria-live="polite">{announce}</p>
      <h3 className="mb-2 text-sm font-semibold text-text">Affichés ({draft.length}/{MAX_SHORTCUTS})</h3>
      {draft.length === 0 ? <p className="mb-4 rounded-md border border-dashed border-border p-3 text-sm text-text-muted">Aucun raccourci : ajoutez-en ci-dessous.</p> : (
        <ol ref={listRef} aria-label="Raccourcis affichés" className="mb-5 divide-y divide-border rounded-lg border border-border">
          {draft.map((id, i) => {
            const s = SHORTCUTS[id];
            return (
              <li
                key={id}
                draggable
                onDragStart={() => setDragging(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, i)}
                onDragEnd={() => setDragging(null)}
                className={cn("flex items-center gap-2 bg-surface px-2 py-1.5 first:rounded-t-lg last:rounded-b-lg", dragging === i && "opacity-50")}
              >
                <GripVertical className="size-4 shrink-0 cursor-grab text-text-subtle max-sm:hidden" aria-hidden />
                <span className="num w-5 shrink-0 text-center text-xs text-text-muted">{i + 1}</span>
                <span className="inline-flex shrink-0 text-text-muted [&>svg]:size-4" aria-hidden>{s.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{s.label}{i < 4 && dockShortcuts(draft).some((d) => d.id === id) ? <span className="ml-2 text-xs font-normal text-text-muted">dock</span> : null}</span>
                <IconButton size="sm" label={`Monter ${s.label}`} data-move="up" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp /></IconButton>
                <IconButton size="sm" label={`Descendre ${s.label}`} data-move="down" disabled={i === draft.length - 1} onClick={() => move(i, i + 1)}><ArrowDown /></IconButton>
                <IconButton size="sm" label={`Retirer ${s.label}`} onClick={() => remove(id)}><X /></IconButton>
              </li>
            );
          })}
        </ol>
      )}
      <h3 className="mb-2 text-sm font-semibold text-text">Ajouter</h3>
      {available.length === 0 ? <p className="text-sm text-text-muted">Tous les raccourcis sont affichés.</p> : (
        <ul aria-label="Raccourcis disponibles" className="grid gap-2 sm:grid-cols-2">
          {available.map((id) => {
            const s = SHORTCUTS[id];
            return (
              <li key={id}>
                <button type="button" disabled={draft.length >= MAX_SHORTCUTS} onClick={() => add(id)} aria-label={`Ajouter ${s.label}`} className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-surface-muted disabled:opacity-50">
                  <span className="inline-flex shrink-0 text-text-muted [&>svg]:size-4" aria-hidden>{s.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text">{s.label}</span><span className="block truncate text-xs text-text-muted">{s.description}</span></span>
                  <Plus className="size-4 shrink-0 text-accent" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
