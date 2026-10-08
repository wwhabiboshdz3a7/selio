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
