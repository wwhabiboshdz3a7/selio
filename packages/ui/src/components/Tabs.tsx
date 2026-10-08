import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Onglets horizontaux (liste de pages) — barre orange 2 px sous l'onglet actif. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex gap-1 overflow-x-auto border-b border-border scrollbar-thin", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-base font-medium whitespace-nowrap transition-colors",
              active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {it.label}
            {typeof it.count === "number" ? <span className="num rounded-sm bg-surface-muted px-1.5 text-xs text-text-muted">{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Contrôle segmenté compact (filtres rapides, périodes). */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  className,
  ariaLabel,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
  className?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface p-0.5 scrollbar-thin", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "shrink-0 rounded-sm px-2.5 font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-7 text-xs" : "h-8 text-sm",
              active ? "bg-surface-muted text-text" : "text-text-muted hover:text-text",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
