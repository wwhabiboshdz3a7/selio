import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "accent" | "ink" | "muted";

const dotClass: Record<StatusTone, string> = {
  neutral: "bg-gray-400",
  muted: "bg-gray-300",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent-vivid",
  ink: "bg-text",
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  dot?: boolean;
}

/** Badge de statut : fond muted, texte 12 px 500, pastille 6 px colorée. */
export function StatusBadge({ tone = "neutral", dot = true, className, children, ...rest }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm bg-surface-muted px-2 text-xs font-medium whitespace-nowrap text-text",
        className,
      )}
      {...rest}
    >
      {dot ? <span className={cn("size-1.5 shrink-0 rounded-full", dotClass[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Badge discret (« V2 », « Démo », compteur). */
export function Tag({ className, accent, ...rest }: HTMLAttributes<HTMLSpanElement> & { accent?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] leading-none font-medium",
        accent ? "bg-accent-soft text-accent" : "bg-surface-muted text-text-muted",
        className,
      )}
      {...rest}
    />
  );
}
