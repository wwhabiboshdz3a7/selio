import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { Lock } from "lucide-react";
import { ROLE_LABELS } from "@selio/contracts";
import { cn } from "@selio/ui";
import { useRequiredSession } from "../../lib/data/provider";
import { seesFinances } from "../../lib/roles";

/**
 * Masquage des finances dans l'interface (§5.15 : l'exécuteur publie et répond, sans voir les finances).
 * Le serveur masque aussi ces montants (`redactForRole`) ; l'interface ne les affiche pas du tout pour un
 * rôle sans « finances.read », plutôt que d'afficher un montant vide ou nul.
 */

/** Vrai si le rôle courant voit chiffre d'affaires, marges, prix d'achat et facturation. */
export function useSeesFinances(): boolean {
  return seesFinances(useRequiredSession().role);
}

/** Montant masqué : « Masqué », lisible par un lecteur d'écran. */
export function MaskedAmount({ className }: { className?: string }) {
  return (
    <span data-finance-masked="" className={cn("inline-flex items-center gap-1 text-text-muted", className)} title="Réservé aux rôles qui voient les finances">
      <Lock className="size-3 shrink-0" aria-hidden />
      <span>Masqué</span>
      <span className="sr-only"> : montant réservé aux rôles qui voient les finances</span>
    </span>
  );
}

/** Affiche un montant financier, ou « Masqué » pour un rôle qui ne voit pas les finances. */
export function Finance({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return useSeesFinances() ? <>{children}</> : <>{fallback ?? <MaskedAmount />}</>;
}

/** Bandeau discret en tête d'une page dont les montants sont masqués pour ce rôle. */
export function FinanceMaskedNote({ className }: { className?: string }) {
  const session = useRequiredSession();
  if (seesFinances(session.role)) return null;
  return (
    <p data-testid="finance-masked-note" className={cn("mb-4 flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-text-muted", className)}>
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span><span className="font-medium text-text">Finances masquées</span> — votre rôle ({ROLE_LABELS[session.role].toLowerCase()}) ne voit ni chiffre d'affaires, ni marges, ni prix d'achat. Les prix affichés sur Vinted restent visibles.</span>
    </p>
  );
}

/**
 * Routes des finances (abonnement, factures) : ouvertes aux seuls rôles qui voient les finances ; les
 * autres voient une explication plutôt qu'une page d'erreur du serveur.
 */
export function RequireFinances() {
  const session = useRequiredSession();
  if (seesFinances(session.role)) return <Outlet />;
  return (
    <div data-testid="finance-route-blocked" className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-5">
      <p className="flex items-center gap-2 text-md font-semibold text-text"><Lock className="size-4 text-text-muted" aria-hidden />Réservé aux rôles qui voient les finances</p>
      <p className="text-sm text-text-muted">Votre rôle ({ROLE_LABELS[session.role].toLowerCase()}) ne voit ni l'abonnement, ni les factures, ni les montants financiers. Le titulaire, les administrateurs et la lecture seule (comptable) y ont accès.</p>
    </div>
  );
}
