import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  padding?: "none" | "sm" | "md";
}

export function Card({ selected, padding = "md", className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "card min-w-0",
        selected && "border-accent",
        padding === "md" && "p-4 md:p-5",
        padding === "sm" && "p-3 md:p-4",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-md font-semibold text-text">{title}</h2>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
