import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "../lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

const icons: Record<AlertTone, ReactNode> = {
  info: <Info className="size-4 text-text-muted" aria-hidden />,
  success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  warning: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  danger: <XCircle className="size-4 text-danger" aria-hidden />,
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("card flex items-start gap-3 p-3 md:p-4", tone === "danger" && "border-danger", className)}
    >
      <span className="mt-0.5 shrink-0">{icons[tone]}</span>
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-medium text-text">{title}</p> : null}
        {children ? <div className={cn("text-text-muted", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Bandeau pleine largeur (ex. « Démonstration — données fictives »). */
export function Banner({ children, tone = "accent", className }: { children: ReactNode; tone?: "accent" | "neutral" | "danger"; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-8 items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "neutral" && "bg-surface-muted text-text-muted",
        tone === "danger" && "bg-surface-muted text-danger",
        className,
      )}
    >
      {children}
    </div>
  );
}
