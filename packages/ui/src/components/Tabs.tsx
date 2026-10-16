import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** Onglets horizontaux (liste de pages) — barre d'accent 2 px sous l'onglet actif. */
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
            {typeof it.count === "number" ? <span className={cn("num text-xs", active ? "text-accent" : "text-text-muted")}>{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Contrôle segmenté compact (filtres rapides, périodes) : sélection en améthyste. */
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
              active ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Puce de filtre (listes d'articles, dressing) : sans bordure au repos,
 * sélection en améthyste douce. `role` = « tab » (aria-selected) ou « radio » (aria-checked).
 */
export function FilterChip({
  active,
  count,
  icon,
  children,
  onClick,
  role = "radio",
  className,
}: {
  active: boolean;
  count?: number | null;
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  role?: "radio" | "tab";
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? active : undefined}
      aria-selected={role === "tab" ? active : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-3.5",
        active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text",
        className,
      )}
    >
      {icon ? <span className="inline-flex" aria-hidden>{icon}</span> : null}
      {children}
      {typeof count === "number" ? <span className={cn("num text-xs font-normal", active ? "text-accent" : "text-text-muted")}>{count}</span> : null}
    </button>
  );
}
