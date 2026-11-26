import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { CreditCard, Download, LogOut, Receipt, Sparkles } from "lucide-react";
import { BETA_ENDED_TITLE, betaDateLabel, type BetaStatus } from "@selio/contracts";
import { can } from "@selio/domain";
import { Banner, buttonClass, cn } from "@selio/ui";
import { useClient, useRequiredSession } from "../lib/data/provider";
import { BETA_WELCOME_PATH, PAYMENT_PATH, betaGateFor, daysLabel } from "../lib/beta";
import { unsubscribeOnLogout } from "../lib/push";
import { announceSession } from "../lib/session-sync";

/**
 * Bêta dans l'espace client (code BETA2026SELIO) :
 * - `BetaGate` : écran de bienvenue tant qu'il n'a pas été vu ; après la fin du mois sans moyen de paiement,
 *   écran de blocage sur toutes les pages sauf Abonnement, Factures, Export de données et la page de paiement ;
 * - `BetaReminderBanner` : bandeau J-7 puis J-1 (sans moyen de paiement) ;
 * - `BetaBadge` : badge discret « Bêta » avec la date de fin.
 */

export function BetaGate({ children }: { children: ReactNode }) {
  const s = useRequiredSession();
  const { pathname, search } = useLocation();
  const gate = betaGateFor(s.beta, pathname);
  if (gate === "welcome") return <Navigate to={BETA_WELCOME_PATH} replace state={{ from: `${pathname}${search}` }} />;
  if (gate === "blocked") return <BetaBlockedScreen beta={s.beta!} />;
  return <>{children}</>;
}

/** Écran de blocage : clair, sans culpabiliser, avec le bouton vers le paiement et ce qui reste ouvert. */
export function BetaBlockedScreen({ beta }: { beta: BetaStatus }) {
  const s = useRequiredSession();
  const client = useClient();
  const navigate = useNavigate();
  const manage = can(s.role, "billing.manage");
  const logout = async () => {
    await unsubscribeOnLogout(client);
    await client.logout();
    announceSession("logout");
    navigate("/connexion");
  };
  return (
    <section data-testid="beta-blocked" aria-labelledby="beta-blocked-title" className="mx-auto flex max-w-xl flex-col items-center py-10 text-center md:py-16">
      <span className="bg-brand relative inline-flex size-14 items-center justify-center rounded-2xl text-white shadow-md ring-1 ring-white/10 ring-inset">
        <Sparkles className="size-6 text-gold-300" aria-hidden />
      </span>
      <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-accent uppercase">Bêta Selio</p>
      <h1 id="beta-blocked-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-text md:text-3xl">{BETA_ENDED_TITLE}</h1>
      <p className="mt-3 text-base text-text-muted">
        Ajoutez un moyen de paiement pour continuer.{beta.blockedSince ? <> Votre accès est suspendu depuis le <span className="num">{betaDateLabel(beta.blockedSince)}</span>.</> : null}
      </p>
      <p className="mt-2 text-sm text-text-muted">Vos données sont conservées : articles, messages, commandes et réglages vous attendent. Merci d'avoir testé Selio pendant la bêta.</p>
      {manage ? (
        <Link to={PAYMENT_PATH} className={cn(buttonClass({ variant: "accent" }), "mt-6")} data-testid="beta-blocked-pay"><CreditCard aria-hidden />Ajouter un moyen de paiement</Link>
      ) : (
        <p className="mt-6 rounded-md bg-surface-muted px-4 py-3 text-sm text-text">Demandez au titulaire du compte d'ajouter un moyen de paiement : l'accès de toute l'équipe reprendra aussitôt.</p>
      )}
      <nav aria-label="Pages encore ouvertes" className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
        {manage ? <Link to="/app/settings/billing" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"><CreditCard className="size-4" aria-hidden />Mon abonnement</Link> : null}
        {manage ? <Link to="/app/settings/invoices" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"><Receipt className="size-4" aria-hidden />Factures</Link> : null}
        <Link to="/app/settings/data" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"><Download className="size-4" aria-hidden />Exporter mes données</Link>
        <button type="button" onClick={() => void logout()} className="inline-flex items-center gap-1.5 font-medium text-text-muted hover:text-text hover:underline"><LogOut className="size-4" aria-hidden />Se déconnecter</button>
      </nav>
    </section>
  );
}

/** Bandeau de rappel J-7 puis J-1, tant qu'aucun moyen de paiement n'est enregistré. */
export function BetaReminderBanner({ beta, pathname }: { beta: BetaStatus | null | undefined; pathname: string }) {
  if (!beta || beta.reminder === null || !beta.endsAt) return null;
  const tomorrow = beta.reminder === 1;
  const onPayment = pathname.startsWith(PAYMENT_PATH);
  return (
    <Banner tone={tomorrow ? "danger" : "neutral"}>
      <span data-testid={`beta-reminder-${beta.reminder}`} className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Sparkles className={cn("size-3.5 shrink-0", tomorrow ? "text-danger" : "text-gold")} aria-hidden />
        <span>
          <span className="font-medium text-text">{tomorrow ? "Votre mois de bêta se termine demain" : `Votre mois de bêta se termine dans ${daysLabel(beta.daysLeft ?? 0)}`}</span>
          {" "}(le <span className="num">{betaDateLabel(beta.endsAt)}</span>) — ajoutez un moyen de paiement pour continuer.
        </span>
        {onPayment ? null : <Link to={PAYMENT_PATH} className="font-medium text-accent underline-offset-2 hover:underline">Ajouter un moyen de paiement</Link>}
      </span>
    </Banner>
  );
}

/** Badge discret « Bêta » avec la date de fin (en-tête de l'application). */
export function BetaBadge({ beta, className }: { beta: BetaStatus | null | undefined; className?: string }) {
  if (!beta || beta.state !== "running") return null;
  const end = beta.endsAt ? betaDateLabel(beta.endsAt) : null;
  return (
    <span
      data-testid="beta-badge"
      title={end ? `Accès bêta jusqu'au ${end}` : "Accès bêta"}
      className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-gold-300/60 bg-gold-soft px-2 text-[11px] leading-none font-semibold text-gold-text", className)}
    >
      <Sparkles className="size-3" aria-hidden />
      Bêta
      {end ? <span className="num font-medium opacity-80">· jusqu'au {end}</span> : null}
    </span>
  );
}

/** Bouton « Ajouter un moyen de paiement » réutilisable (abonnement, écran de blocage). */
export function AddPaymentMethodButton({ className, children = "Ajouter un moyen de paiement" }: { className?: string; children?: ReactNode }) {
  return <Link to={PAYMENT_PATH} className={cn(buttonClass({ variant: "accent", size: "sm" }), className)}><CreditCard aria-hidden />{children}</Link>;
}

