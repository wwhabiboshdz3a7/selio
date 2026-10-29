import type { ReactNode } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import type { UsageCounter } from "@selio/contracts";
import { cn, formatNumber } from "@selio/ui";

export type MeterState = "none" | "ok" | "warning" | "exceeded";

/**
 * État d'une jauge : un quota nul (fonction non incluse dans l'offre) n'est pas une limite atteinte
 * tant que rien n'est utilisé ; dès la première unité, c'est un dépassement.
 */
export function meterState(c: UsageCounter): MeterState {
  if (c.quota <= 0) return c.used > 0 ? "exceeded" : "none";
  if (c.exceeded) return "exceeded";
  if (c.warning) return "warning";
  return "ok";
}

/**
 * Une jauge de consommation (page « Mon utilisation », Abonnement) : libellé, pourcentage,
 * barre, « utilisé / quota ». La barre reste améthyste ; l'alerte à 80 % et la limite atteinte
 * se lisent sur le chiffre (ambre, rouge) et en toutes lettres, jamais par la couleur seule.
 */
export function UsageMeter({ label, counter, hint, planned = false, excludedHint, className }: { label: string; counter: UsageCounter; hint?: ReactNode; /** Fonction en préparation : le compteur existe, rien ne le remplit encore. */ planned?: boolean; /** Texte quand la fonction n'est pas incluse dans l'offre (quota nul). */ excludedHint?: ReactNode; className?: string }) {
  const state = meterState(counter);
  const quotaText = counter.quota > 0 ? formatNumber(counter.quota) : "—";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text">{label}</span>
        <span className={cn("num text-lg font-semibold", state === "exceeded" ? "text-danger" : state === "warning" ? "text-warning" : "text-text")}>{counter.percent} %</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={counter.percent} aria-valuetext={`${counter.percent} % (${formatNumber(counter.used)} sur ${quotaText})`} className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-accent-vivid transition-[width]" style={{ width: `${counter.percent}%` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
        <span className="num text-text">{formatNumber(counter.used)} / {quotaText}</span>
        {state === "exceeded" ? <span className="inline-flex items-center gap-1 font-medium text-danger"><XCircle className="size-3.5" aria-hidden />Limite atteinte</span> : null}
        {state === "warning" ? <span className="inline-flex items-center gap-1 font-medium text-warning"><AlertTriangle className="size-3.5" aria-hidden />80 % atteints</span> : null}
        {counter.quota <= 0 ? <span>{excludedHint ?? "Non inclus dans votre offre"}</span> : null}
        {planned ? <span>En préparation</span> : null}
        {hint ? <span>{hint}</span> : null}
      </p>
    </div>
  );
}
