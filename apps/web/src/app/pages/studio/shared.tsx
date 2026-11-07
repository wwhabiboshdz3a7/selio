import type { ReactNode } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { STUDIO_ACCURACY_TO_MEASURE_LABEL } from "@selio/contracts";
import { StatusBadge, cn, type StatusTone } from "@selio/ui";
import { needsConfirmation, provenanceText, type FieldSource } from "../../../lib/studio/prep";

/**
 * Provenance d'une valeur : d'où elle vient (étiquette, mètre ruban, base des références, vous) et la
 * confiance de la lecture, ou « À renseigner ». Le libellé porte toujours le sens (jamais la couleur seule).
 */
export function ProvenanceBadge({ source, confidence, pending, confirmed, className }: { source: FieldSource | null; confidence?: number; /** Valeur saisie à l'écran, pas encore validée. */ pending?: boolean; /** Lecture peu sûre ou en désaccord confirmée telle quelle à l'écran (elle deviendra « vous »). */ confirmed?: boolean; className?: string }) {
  if (pending) return <StatusBadge tone="ink" className={className}>Indiquée par vous</StatusBadge>;
  if (confirmed) return <StatusBadge tone="ink" className={className}>Confirmée par vous</StatusBadge>;
  const toConfirm = needsConfirmation(source, confidence);
  const tone: StatusTone = source === null ? "warning" : toConfirm ? "warning" : source === "seller" ? "ink" : source === "reference_db" ? "neutral" : "success";
  const label = provenanceText(source, confidence) + (toConfirm ? " · à confirmer" : "");
  return <StatusBadge tone={tone} className={cn("max-w-full", className)} title={label}><span className="truncate">{label}</span></StatusBadge>;
}

/** Question posée au vendeur pour un champ vide, peu sûr ou en conflit. */
export function QuestionNote({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} className={cn("flex items-start gap-1.5 text-xs text-text-muted", className)}>
      <MessageCircleQuestion className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
      <span><span className="sr-only">Question : </span>{children}</span>
    </p>
  );
}

/** Rappel « précision à mesurer » : aucune précision n'est promise tant qu'aucun rapport n'existe. */
export function AccuracyNote({ className }: { className?: string }) {
  return <p className={cn("text-xs text-text-muted", className)}>{STUDIO_ACCURACY_TO_MEASURE_LABEL} Relisez chaque champ.</p>;
}

export type StudioStep = "photos" | "sort" | "label" | "measures" | "listing";
export const STUDIO_STEPS: { id: StudioStep; title: string; detail: string }[] = [
  { id: "photos", title: "Photos", detail: "Face, dos, étiquette, mètre ruban" },
  { id: "sort", title: "Tri", detail: "Photos par article et par rôle" },
  { id: "label", title: "Étiquette", detail: "Marque, taille, matière, référence" },
  { id: "measures", title: "Mesures", detail: "Mètre ruban, base ou vous" },
  { id: "listing", title: "Annonce", detail: "Relue, puis brouillon ou vente" },
];

/** Étapes du parcours : faites, en cours, à venir (texte et pastille, pas seulement la couleur). */
export function StudioStepper({ current, reachable, onGo }: { current: StudioStep; reachable: (s: StudioStep) => boolean; onGo: (s: StudioStep) => void }) {
  const at = STUDIO_STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="mb-6 grid grid-cols-5 gap-2 sm:gap-4" aria-label="Étapes">
      {STUDIO_STEPS.map((s, i) => {
        const done = i < at;
        const active = i === at;
        const canGo = !active && reachable(s.id);
        const inner = (
          <>
            <span className={cn("num inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-accent text-accent-on" : active ? "bg-accent-soft text-accent ring-1 ring-accent" : "bg-surface text-text-muted ring-1 ring-border")} aria-hidden>{done ? <Check className="size-3.5" /> : i + 1}</span>
            <span className="min-w-0">
              <span className={cn("block truncate text-xs font-medium sm:text-sm", active ? "text-text" : "text-text-muted")}>{s.title}<span className="sr-only">{done ? " (fait)" : active ? " (en cours)" : ""}</span></span>
              <span className="hidden text-xs text-text-muted lg:block">{s.detail}</span>
            </span>
          </>
        );
        return (
          <li key={s.id} aria-current={active ? "step" : undefined} className="min-w-0">
            {canGo ? (
              <button type="button" onClick={() => onGo(s.id)} className="flex w-full min-w-0 flex-col items-start gap-1.5 rounded-md text-left sm:flex-row sm:items-start sm:gap-3">{inner}</button>
            ) : (
              <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-start sm:gap-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
