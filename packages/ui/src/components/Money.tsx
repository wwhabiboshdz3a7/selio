import { cn } from "../lib/cn";
import { formatCents } from "../lib/format";

/** Montant formaté fr-FR, chiffres tabulaires, coloré selon le signe si demandé. */
export function Money({ cents, signed, className, compact }: { cents: number; signed?: boolean; className?: string; compact?: boolean }) {
  const tone = signed ? (cents > 0 ? "text-success" : cents < 0 ? "text-danger" : "text-text-muted") : undefined;
  const text = formatCents(cents, { compact });
  return (
    <span className={cn("num", tone, signed && cents !== 0 && "font-medium", className)}>
      {signed && cents > 0 ? `+${text}` : text}
    </span>
  );
}
