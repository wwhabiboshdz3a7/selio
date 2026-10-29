import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, TRIAL_DAYS, type PaidPlan, type Subscription } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, StatusBadge, Tag, buttonClass, formatCents, formatDate } from "@selio/ui";
import { PLAN_OFFERS, PRICING, TRIAL_OFFER, planOffer } from "@selio/demo-data";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { UsageSummary } from "../../../lib/data/types";
import { showIndicativePricing } from "../../../lib/env";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { UsageMeter } from "../../components/usage";

const STATUS_TONE: Record<Subscription["status"], "success" | "accent" | "danger" | "muted"> = { none: "muted", trialing: "accent", active: "success", past_due: "danger", canceled: "muted", incomplete: "danger" };
const PROVIDER_LABELS: Record<Subscription["provider"], string> = { none: "Aucun paiement réel", stripe: "Stripe (mode test)", revolut: "Revolut" };
const FREE_MONTHS = 12 - PRICING.annualMonthsCharged;

/** Jours restants (arrondis au jour supérieur ; 0 = terminé). */
function daysLeft(iso: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

export default function Billing() {
  const client = useClient();
  const session = useRequiredSession();
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => client.getUsage() });
  const checkout = useAppMutation((plan: PaidPlan) => client.startCheckout(plan), { invalidate: ["subscription"], onSuccess: (r) => { if (r.url) window.location.assign(r.url); } });
  const manage = can(session.role, "billing.manage");
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={sub} skeleton="spinner">
        {(s) => <OfferCard s={s} />}
      </QueryBoundary>

      <QueryBoundary query={usage} skeleton="spinner">
        {(u) => <CapacityCard u={u} />}
      </QueryBoundary>

      <Card padding="none">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 md:px-5">
          <h2 className="text-md font-semibold">Changer d'offre</h2>
          <Link to="/tarifs" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Comparer les offres <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        <p className="px-4 text-sm text-text-muted md:px-5">Starter, Pro ou Agence, au mois sans engagement ou à l'année avec {FREE_MONTHS} mois offerts. Montants indicatifs : aucun paiement n'est encaissé à ce stade.</p>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {PLAN_OFFERS.map((p) => {
            const current = sub.data?.plan === p.key && sub.data.status !== "trialing";
            return (
              <li key={p.key} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-text">{p.name}<span className="text-sm font-normal text-accent">{p.profile}</span></p>
                  <p className="mt-0.5 text-sm text-text-muted">{p.highlights.join(" · ")}</p>
                </div>
                <p className="num shrink-0 text-sm text-text">{showIndicativePricing ? <>{formatCents(p.indicativeMonthlyCents)}<span className="text-text-muted"> / mois, indicatif</span></> : "À définir"}</p>
                <div className="shrink-0 sm:w-32 sm:text-right">
                  {current ? <Tag accent>Offre actuelle</Tag> : manage ? <Button size="sm" variant="secondary" onClick={() => checkout.mutate(p.key)} loading={checkout.isPending && checkout.variables === p.key}>Choisir (test)</Button> : null}
                </div>
              </li>
            );
          })}
          <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-text">Plus de 10 comptes Vinted</p>
              <p className="mt-0.5 text-sm text-text-muted">Sur devis : aucun compte supplémentaire à la carte, au-delà de l'offre Agence nous construisons l'offre avec vous.</p>
            </div>
            <p className="num shrink-0 text-sm text-text-muted">Sur devis</p>
            <div className="shrink-0 sm:w-32 sm:text-right"><Link to="/contact" className={buttonClass({ variant: "secondary", size: "sm" })}>Nous écrire</Link></div>
          </li>
        </ul>
        {!manage ? <p className="border-t border-border px-4 py-3 text-xs text-text-muted md:px-5">Seul le propriétaire peut changer d'offre.</p> : null}
      </Card>
      {checkout.data ? <Alert tone={checkout.data.simulated ? "warning" : "info"}>{checkout.data.message}</Alert> : null}
    </div>
  );
}

function OfferCard({ s }: { s: Subscription }) {
  const trial = s.status === "trialing";
  const left = trial && s.currentPeriodEnd ? daysLeft(s.currentPeriodEnd) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Votre offre</h2>
        <span className="flex flex-wrap gap-2">
          <Tag accent>{trial ? TRIAL_OFFER.name : PLAN_LABELS[s.plan]}</Tag>
          {s.testMode ? <Tag>Mode test</Tag> : null}
          <StatusBadge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABELS[s.status]}</StatusBadge>
        </span>
      </div>
      {trial ? (
        <div className="mt-4">
          <p className="text-base text-text">
            {left === null ? "Essai en cours" : left > 0 ? <><span className="num font-semibold">{left} jour{left > 1 ? "s" : ""}</span> d'essai restant{left > 1 ? "s" : ""}</> : "Période d'essai terminée"}
            {s.currentPeriodEnd ? <span className="text-text-muted"> · {left && left > 0 ? "jusqu'au" : "le"} {formatDate(s.currentPeriodEnd)}</span> : null}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Toutes les fonctions et les limites du plan {PLAN_LABELS[s.plan]} pendant {TRIAL_DAYS} jours.{" "}
            {s.cardOnFile
              ? "Votre carte est enregistrée : rien n'est débité avant la fin de l'essai, et vous choisissez ensuite Starter, Pro ou Agence."
              : "La carte sera enregistrée à l'inscription quand le paiement sera branché (en préparation) : rien n'est débité avant la fin de l'essai, et l'essai n'est pas interrompu à son terme pour l'instant."}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-muted">{s.plan === "free" ? "Aucun abonnement actif : une personne et un compte Vinted." : planOffer(s.plan)?.forWhom}</p>
      )}
      <DescriptionList className="mt-4" columns={2} items={[
        { label: "Paiement", value: PROVIDER_LABELS[s.provider] },
        { label: "Carte bancaire", value: s.cardOnFile ? "Enregistrée" : "Pas encore demandée" },
        { label: trial ? "Fin de l'essai" : "Fin de période", value: s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—" },
        { label: "Renouvellement", value: s.cancelAtPeriodEnd ? "Résiliation à la fin de la période" : trial ? "Choix de l'offre à la fin de l'essai" : "Automatique" },
      ]} />
      <Alert tone="info" className="mt-4">Aucun abonnement réel n'est créé sans configuration et validation du paiement. Les webhooks sont vérifiés et idempotents ; le mode test reste actif jusqu'à activation volontaire.</Alert>
    </Card>
  );
}

/** Ce que l'offre donne (comptes, équipe, stock) ; les compteurs du mois ont leur page « Utilisation ». */
function CapacityCard({ u }: { u: UsageSummary }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-md font-semibold">Votre offre en chiffres</h2>
        <Link to="/app/settings/usage" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Mon utilisation du mois <ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      <p className="text-sm text-text-muted">La part de votre offre déjà prise. À 100 %, l'action concernée est refusée proprement, sans facturation.</p>
      <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <UsageMeter label="Comptes Vinted" counter={u.counters.connections} hint="Le simulateur de démonstration n'est pas compté." />
        <UsageMeter label="Équipe" counter={u.counters.members} hint="Personnes ayant accès à l'organisation." />
        <UsageMeter label="Stock actif" counter={u.counters.items} hint="Les articles archivés ne comptent pas." />
      </div>
      {u.warning ? <Alert tone="warning" className="mt-5" title="Un compteur a atteint 80 % de votre offre">Le détail par filiale (IA, Studio, Track, Cloud) est dans <Link to="/app/settings/usage" className="font-medium text-accent hover:underline">Mon utilisation</Link>.</Alert> : null}
    </Card>
  );
}
