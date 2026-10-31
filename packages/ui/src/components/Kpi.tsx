import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  delta?: { value: ReactNode; tone: "success" | "danger" | "neutral" } | null;
  hint?: ReactNode;
  className?: string;
  to?: ReactNode;
}

/** Carte KPI : libellé 13 px muted → chiffre 32 px 600 → variation 12 px. Pas d'icône décorative. */
export function KpiCard({ label, value, delta, hint, className, to }: KpiCardProps) {
  return (
    <div className={cn("card p-4 md:p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-text-muted">{label}</p>
        {to}
      </div>
      <p className="num mt-2 text-2xl font-semibold text-text">{value}</p>
      {delta ? (
        <p
          className={cn(
            "num mt-1 text-xs font-medium",
            delta.tone === "success" && "text-success",
            delta.tone === "danger" && "text-danger",
            delta.tone === "neutral" && "text-text-muted",
          )}
        >
          {delta.value}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-xs text-text-muted">{label}</span>
      <span className="num text-base font-medium text-text">{value}</span>
    </div>
  );
}

export interface StatItem {
  label: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  /** Contenu poussé en bas de la cellule (sparkline, lien). */
  extra?: ReactNode;
  className?: string;
}

/**
 * Bandeau d'indicateurs : une seule carte, cellules séparées par un filet.
 * Remplace les rangées de cartes KPI juxtaposées (moins de cadres, plus d'air).
 * `className` porte la grille (ex. « grid-cols-2 lg:grid-cols-5 ») ; sur mobile,
 * une dernière cellule orpheline occupe toute la ligne.
 */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border border-border bg-border max-lg:[&>*:last-child:nth-child(odd)]:col-span-2", className)}>
      {items.map((it, i) => (
        <div key={i} className={cn("flex min-w-0 flex-col bg-surface p-4 md:p-5", it.className)}>
          <p className="truncate text-sm text-text-muted">{it.label}</p>
          {it.value !== null && it.value !== undefined ? <div className="num mt-1.5 text-2xl font-semibold tracking-tight text-text">{it.value}</div> : null}
          {it.sub ? <div className="num mt-1 text-xs text-text-muted">{it.sub}</div> : null}
          {it.extra ? <div className="mt-auto pt-3">{it.extra}</div> : null}
        </div>
      ))}
    </div>
  );
}
