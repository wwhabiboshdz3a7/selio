import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export function EmptyState({
  title,
  description,
  action,
  className,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("card animate-fade flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 text-text-subtle [&>svg]:size-6" aria-hidden>{icon}</div> : null}
      <h3 className="text-md font-semibold text-text">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Une erreur est survenue",
  description,
  onRetry,
  retryLabel = "Réessayer",
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("card animate-fade flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <AlertTriangle className="mb-3 size-6 text-danger" aria-hidden />
      <h3 className="text-md font-semibold text-text">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-text-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Chargement. Par défaut, un squelette de contenu (blocs gris au reflet lent) : la place est déjà prise,
 * rien ne saute quand les données arrivent ; le libellé reste lu par les lecteurs d'écran.
 * `variant="spinner"` : indicateur compact avec le libellé visible (ouverture de session, plein écran).
 * `variant="cards"` : grille de cartes (tableaux de bord) ; `variant="list"` : lignes (listes, tableaux).
 */
export function LoadingState({ label = "Chargement…", className, variant = "page" }: { label?: string; className?: string; variant?: "page" | "list" | "cards" | "spinner" }) {
  if (variant === "spinner") {
    return (
      <div role="status" aria-live="polite" className={cn("flex items-center justify-center gap-2 py-12 text-sm text-text-muted", className)}>
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" aria-busy className={cn("animate-fade flex flex-col gap-4", className)} style={{ animationDelay: "120ms" }}>
      <span className="sr-only">{label}</span>
      {variant === "list" ? <SkeletonRows rows={4} /> : variant === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card flex flex-col gap-3 p-4 md:p-5"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-20" /><Skeleton className="h-3 w-32" /></div>)}
        </div>
      ) : (
        <div className="card flex flex-col gap-3 p-4 md:p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-2 h-24 w-full" />
        </div>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Chargement…" className={cn("card animate-fade divide-y divide-border", className)} aria-busy style={{ animationDelay: "120ms" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
