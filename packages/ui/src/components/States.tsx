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
    <div className={cn("card flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
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
    <div role="alert" className={cn("card flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
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

export function LoadingState({ label = "Chargement…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-center gap-2 py-12 text-sm text-text-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("card divide-y divide-border", className)} aria-busy>
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
