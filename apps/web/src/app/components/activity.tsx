import type { ReactNode } from "react";
import { Link } from "react-router";
import { Bot, Boxes, Camera, ChevronRight, HandCoins, MessageSquare, Package, ShoppingCart, Sparkles, Tags, Workflow } from "lucide-react";
import { ACTIVITY_CATEGORY_LABELS, type ActivityCategory, type ActivityEntry } from "@selio/contracts";
import { Tag, cn, formatDate, formatTime } from "@selio/ui";

/** Lignes du journal d'activité de Selio Manager (page Journal et aperçu « Dernières actions »). */

export const CATEGORY_ICONS: Record<ActivityCategory, ReactNode> = {
  stock: <Boxes />,
  studio: <Sparkles />,
  photos: <Camera />,
  pricing: <Tags />,
  messages: <MessageSquare />,
  negotiation: <HandCoins />,
  orders: <Package />,
  purchases: <ShoppingCart />,
  automation: <Workflow />,
  bot: <Bot />,
};

/** Libellé du jour d'un groupe : « Aujourd'hui », « Hier », sinon la date. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return formatDate(iso, "long");
}

/** Une ligne du journal : icône de la famille, « Acteur phrase », état, heure, lien vers l'objet. */
export function ActivityLine({ entry, showDate = false }: { entry: ActivityEntry; showDate?: boolean }) {
  const content = (
    <>
      <span className={cn("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4", entry.automatic ? "bg-accent-soft text-accent" : "bg-surface-muted text-text-muted")} aria-hidden>{CATEGORY_ICONS[entry.category]}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug text-text"><strong className="font-semibold">{entry.actor.name}</strong> {entry.summary}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <time dateTime={entry.at}>{showDate ? `${dayLabel(entry.at)} · ` : ""}{formatTime(entry.at)}</time>
          <span aria-hidden>·</span>
          <span>{ACTIVITY_CATEGORY_LABELS[entry.category]}</span>
          {entry.automatic ? <Tag className="px-1.5 py-0 text-[11px]">Automatique</Tag> : null}
          {entry.status === "pending" ? <Tag accent className="px-1.5 py-0 text-[11px]">À valider</Tag> : null}
          {entry.status === "failed" ? <span className="font-medium text-danger">Échec</span> : null}
        </span>
      </span>
      {entry.link ? <ChevronRight className="mt-2 size-4 shrink-0 text-text-subtle" aria-hidden /> : null}
    </>
  );
  return entry.link ? (
    <Link to={entry.link} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60 md:px-5">{content}</Link>
  ) : (
    <div className="flex items-start gap-3 px-4 py-3 md:px-5">{content}</div>
  );
}

