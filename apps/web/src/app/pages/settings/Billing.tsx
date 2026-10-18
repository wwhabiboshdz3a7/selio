import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, type Subscription } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, StatusBadge, Tag, cn, formatCents, formatDate, formatNumber } from "@selio/ui";
import { PLAN_OFFERS, TRIAL_OFFER } from "@selio/demo-data";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { UsageSummary } from "../../../lib/data/types";
import { showIndicativePricing } from "../../../lib/env";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

const STATUS_TONE: Record<Subscription["status"], "success" | "accent" | "danger" | "muted"> = { none: "muted", trialing: "accent", active: "success", past_due: "danger", canceled: "muted", incomplete: "danger" };

/** Jours restants (arrondis au jour supérieur ; 0 = terminé). */
function daysLeft(iso: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

export default function Billing() {
  const client = useClient();
  const session = useRequiredSession();
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => client.getUsage() });
  const checkout = useAppMutation((plan: "starter" | "pro") => client.startCheckout(plan), { invalidate: ["subscription"], onSuccess: (r) => { if (r.url) window.location.assign(r.url); } });
  const manage = can(session.role, "billing.manage");
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={sub} skeleton="spinner">
        {(s) => <OfferCard s={s} />}
      </QueryBoundary>

      <QueryBoundary query={usage} skeleton="spinner">
        {(u) => <UsageCard u={u} />}
      </QueryBoundary>

      <Card padding="none">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 md:px-5">
          <h2 className="text-md font-semibold">Choisir une offre</h2>
          <Link to="/tarifs" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Comparer les offres <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        <p className="px-4 text-sm text-text-muted md:px-5">Tous les modules sont inclus dans les deux plans. Montants indicatifs : aucun paiement n'est encaissé à ce stade.</p>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {PLAN_OFFERS.map((p) => {
            const current = sub.data?.plan === p.key && sub.data.status !== "trialing";
            return (
              <li key={p.key} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-text">{p.name}<span className="text-sm font-normal text-accent">{p.profile}</span></p>
                  <p className="mt-0.5 text-sm text-text-muted">{p.highlights.join(" · ")}</p>
                </div>
                <p className="num shrink-0 text-sm text-text">{showIndicativePricing ? <>{formatCents(p.indicativeMonthlyCents, { compact: true })}<span className="text-text-muted"> / mois, indicatif</span></> : "À définir"}</p>
                <div className="shrink-0 sm:w-32 sm:text-right">
                  {current ? <Tag accent>Offre actuelle</Tag> : manage ? <Button size="sm" variant="secondary" onClick={() => checkout.mutate(p.key)} loading={checkout.isPending && checkout.variables === p.key}>Choisir (test)</Button> : null}
                </div>
              </li>
            );
          })}
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
          <Tag accent>{trial ? `Essai ${TRIAL_OFFER.name}` : PLAN_LABELS[s.plan]}</Tag>
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
          <p className="mt-1 text-sm text-text-muted">Toutes les fonctions et les limites du plan {PLAN_LABELS[s.plan]}, sans carte bancaire. Les abonnements payants ne sont pas encore ouverts : l'essai n'est pas interrompu à son terme.</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-muted">{s.plan === "free" ? "Aucun abonnement actif : une personne et un compte Vinted." : PLAN_OFFERS.find((p) => p.key === s.plan)?.forWhom}</p>
      )}
      <DescriptionList className="mt-4" columns={2} items={[
        { label: "Paiement", value: s.provider === "none" ? "Aucun paiement réel" : "Stripe (mode test)" },
        { label: trial ? "Fin de l'essai" : "Fin de période", value: s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—" },
      ]} />
      <Alert tone="info" className="mt-4">Aucun abonnement réel n'est créé sans configuration et validation de Stripe. Les webhooks sont vérifiés et idempotents ; le mode test reste actif jusqu'à activation volontaire.</Alert>
    </Card>
  );
}

/**
 * Une jauge de consommation. `showCount` : le nombre exact n'est affiché que lorsqu'il parle de
 * lui-même (comptes Vinted, personnes) ; pour la capacité (stock, IA), le pourcentage suffit.
 */
interface UsageRow { key: string; label: string; used: number; max: number; hint: string; showCount: boolean }

function UsageCard({ u }: { u: UsageSummary }) {
  const rows: UsageRow[] = [
    { key: "connections", label: "Comptes Vinted", used: u.connectionsCount, max: u.quotas.connections, hint: "Le simulateur de démonstration n'est pas compté.", showCount: true },
    { key: "members", label: "Équipe", used: u.membersCount, max: u.quotas.members, hint: "Personnes ayant accès à l'organisation.", showCount: true },
    { key: "items", label: "Stock actif", used: u.itemsCount, max: u.quotas.items, hint: "Les articles archivés ne comptent pas.", showCount: false },
    { key: "ai", label: "Assistant IA ce mois-ci", used: u.aiRequests, max: u.quotas.aiRequestsPerMonth, hint: `Depuis le ${formatDate(u.period.from)} · les questions d'aide ne comptent pas.`, showCount: false },
  ];
  return (
    <Card>
      <h2 className="text-md font-semibold">Consommation</h2>
      <p className="text-sm text-text-muted">La part de votre offre déjà utilisée. À 100 %, l'action concernée est refusée proprement, sans facturation.</p>
      <ul className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {rows.map((r) => <UsageMeter key={r.key} row={r} />)}
      </ul>
      <details className="group mt-5 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm text-text-muted hover:text-text">Activité du mois</summary>
        <DescriptionList className="mt-3" columns={2} items={[
          { label: "Actions automatiques", value: formatNumber(u.automationActions), numeric: true },
          { label: "Synchronisations", value: formatNumber(u.connectorSyncs), numeric: true },
          { label: "Exports CSV", value: formatNumber(u.exports), numeric: true },
          { label: "Captures de l'extension", value: formatNumber(u.extensionCaptures), numeric: true },
        ]} />
      </details>
    </Card>
  );
}

function UsageMeter({ row }: { row: UsageRow }) {
  const ratio = row.max > 0 ? row.used / row.max : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const tone = ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warning" : "bg-accent-vivid";
  return (
    <li className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text">{row.label}</span>
        <span className="num text-lg font-semibold text-text">{pct} %</span>
      </div>
      <div role="progressbar" aria-label={row.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} % (${formatNumber(row.used)} sur ${formatNumber(row.max)})`} className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-text-muted">{row.showCount ? <span className="num">{formatNumber(row.used)} sur {formatNumber(row.max)} · </span> : null}{row.hint}</p>
    </li>
  );
}
