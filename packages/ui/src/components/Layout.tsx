import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** En-tête de page : un seul titre 24 px par écran, description, actions à droite. */
export function PageHeader({ title, description, actions, eyebrow, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium text-text-muted">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-md font-semibold text-text">{title}</h2>
            {description ? <p className="text-sm text-text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Liste définition clé → valeur (fiches, panneaux latéraux). */
export function DescriptionList({ items, className, columns = 1 }: { items: { label: ReactNode; value: ReactNode; numeric?: boolean }[]; className?: string; columns?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm", columns === 2 && "sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-0">
          <dt className="shrink-0 text-text-muted">{it.label}</dt>
          <dd className={cn("min-w-0 text-right font-medium text-text", it.numeric && "num")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-medium text-text-muted", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials || "?"}
    </span>
  );
}

export function ProgressBar({ value, max = 100, label, className }: { value: number; max?: number; label?: string; className?: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <div className="h-full rounded-full bg-text transition-[width]" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-border bg-surface-muted px-1 font-mono text-[11px] text-text-muted">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-border", className)} />;
}
