import { BETA_ENDED_ERROR, type BetaStatus } from "@selio/contracts";

/**
 * Bêta côté navigateur (code BETA2026SELIO) : adresses de l'écran de bienvenue et de la page de paiement, pages
 * encore ouvertes quand le mois de bêta est terminé, et règles d'affichage (fonctions pures, testées).
 */

export const BETA_WELCOME_PATH = "/app/bienvenue";
export const PAYMENT_PATH = "/app/paiement";

/**
 * Pages ouvertes à un compte dont le mois de bêta est terminé : Paramètres › Abonnement, Factures (et une facture),
 * Export de données, et la page de paiement. La déconnexion reste dans le menu et sur l'écran de blocage.
 */
const ALLOWED_WHEN_BLOCKED = ["/app/settings/billing", "/app/settings/invoices", "/app/settings/data", PAYMENT_PATH];

export function pathAllowedWhenBetaEnded(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return ALLOWED_WHEN_BLOCKED.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Ce que l'espace client doit montrer pour cette adresse : la page, l'écran de bienvenue ou l'écran de blocage. */
export function betaGateFor(beta: BetaStatus | null | undefined, pathname: string): "page" | "welcome" | "blocked" {
  if (!beta) return "page";
  if (beta.blocked) return pathAllowedWhenBetaEnded(pathname) ? "page" : "blocked";
  if (beta.state === "running" && !beta.welcomeSeen) return "welcome";
  return "page";
}

/** Erreur de l'API après la fin du mois de bêta (402 `beta_ended`). */
export function isBetaEndedError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === BETA_ENDED_ERROR;
}

/** « 7 jours », « 1 jour », « aujourd'hui ». */
export function daysLabel(days: number): string {
  if (days <= 0) return "aujourd'hui";
  return `${days} jour${days > 1 ? "s" : ""}`;
}
