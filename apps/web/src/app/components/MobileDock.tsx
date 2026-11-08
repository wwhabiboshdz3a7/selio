import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { Boxes, Camera, FileStack, Gauge, MessageSquare, Radar, Sparkles } from "lucide-react";
import { GlassSurface, cn } from "@selio/ui";
import { PHOTOS_HOME } from "../../lib/roles";

/**
 * Dock flottant de l'essai « verre liquide » (§6), sur mobile seulement (< md) : la navigation principale
 * (4 entrées) et le bouton « Générer », sur une surface GlassSurface (flou, liseré, reflet ; surface opaque
 * en repli). Fixé en bas, au-dessus de la zone de sécurité (env(safe-area-inset-bottom)), 60 px de haut ;
 * le contenu garde un espace équivalent en bas (DOCK_CONTENT_PADDING). Rendu seulement quand l'essai est
 * actif : sinon l'application est inchangée.
 */

export interface DockEntry {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/** Navigation principale : 4 entrées, « Générer » au centre. */
export const DOCK_ENTRIES: readonly DockEntry[] = [
  { to: "/app", label: "Accueil", icon: <Gauge />, end: true },
  { to: "/app/items", label: "Articles", icon: <Boxes /> },
  { to: "/app/messages", label: "Messages", icon: <MessageSquare /> },
  { to: "/app/radar", label: "Affaires", icon: <Radar /> },
];

/** Vue réduite du contributeur photos : ses deux seules destinations, autour de « Générer ». */
export const DOCK_ENTRIES_PHOTOS: readonly DockEntry[] = [
  { to: PHOTOS_HOME, label: "Photos", icon: <Camera /> },
  { to: "/studio/annonces", label: "Annonces", icon: <FileStack /> },
];

/** Hauteur du dock (≤ 64 px, classe h-[60px]) et espace réservé sous le contenu (dock + marge + zone de sécurité). */
export const DOCK_HEIGHT_PX = 60;
export const DOCK_CONTENT_PADDING = "max-md:pb-[calc(88px+env(safe-area-inset-bottom))]";

/**
 * Onglet actif : couleur d'accent ET pastille au-dessus de l'icône (repère non textuel : l'état ne repose pas
 * sur la seule couleur). Dans le verre, --accent est remplacé par sa variante « verre » (glass.css), qui tient
 * 4,5:1 sur la sous-couche même quand une photo sombre passe sous le dock.
 */
const itemClass = ({ isActive }: { isActive: boolean }) => cn(
  "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] leading-tight font-medium transition-colors [&>svg]:size-5 [&>svg]:shrink-0",
  isActive ? "text-accent font-semibold after:absolute after:top-0.5 after:left-1/2 after:h-[3px] after:w-5 after:-translate-x-1/2 after:rounded-full after:bg-accent" : "text-text hover:text-accent",
);

export function MobileDock({ reduced = false }: { reduced?: boolean }) {
  const entries = reduced ? DOCK_ENTRIES_PHOTOS : DOCK_ENTRIES;
  const half = Math.ceil(entries.length / 2);
  const left = entries.slice(0, half);
  const right = entries.slice(half);
  return (
    <GlassSurface
      as="nav"
      aria-label="Navigation principale"
      data-testid="mobile-dock"
      intensity="regular"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30 h-[60px] rounded-[22px] md:hidden"
      contentClassName="flex h-full items-stretch gap-1 px-2 py-1.5"
    >
      {left.map((e) => <NavLink key={e.to} to={e.to} end={e.end} className={itemClass}>{e.icon}<span className="truncate">{e.label}</span></NavLink>)}
      <NavLink to="/studio" end aria-label="Générer" title="Générer une annonce" className="flex shrink-0 flex-col items-center justify-center px-1">
        <span className="bg-brand inline-flex size-11 items-center justify-center rounded-full text-white shadow-sm ring-1 ring-white/15 ring-inset"><Sparkles className="size-5 text-gold-300" aria-hidden /></span>
      </NavLink>
      {right.map((e) => <NavLink key={e.to} to={e.to} end={e.end} className={itemClass}>{e.icon}<span className="truncate">{e.label}</span></NavLink>)}
    </GlassSurface>
  );
}
