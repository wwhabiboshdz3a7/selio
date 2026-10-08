import { useQuery } from "@tanstack/react-query";
import { PLAN_LABELS } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, ProgressBar, StatusBadge, Tag, formatCents, formatDate, formatNumber } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { PLAN_CARDS } from "@selio/demo-data";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

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
        {(s) => (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-md font-semibold">Abonnement</h2>
              <span className="flex gap-2"><Tag accent>{PLAN_LABELS[s.plan]}</Tag>{s.testMode ? <Tag>Mode test</Tag> : null}<StatusBadge tone={s.status === "active" ? "success" : s.status === "trialing" ? "accent" : s.status === "past_due" ? "danger" : "muted"}>{s.status}</StatusBadge></span>
            </div>
            <DescriptionList className="mt-4" columns={2} items={[{ label: "Fournisseur de paiement", value: s.provider === "none" ? "Aucun (pas de paiement réel)" : s.provider }, { label: "Fin de période", value: s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—" }]} />
            <Alert tone="info" className="mt-4">Aucun abonnement réel n'est créé sans configuration et validation de Stripe. Les webhooks sont vérifiés et idempotents ; le mode test reste actif jusqu'à activation volontaire.</Alert>
          </Card>
        )}
      </QueryBoundary>
      <QueryBoundary query={usage} skeleton="spinner">
        {(u) => (
          <Card>
            <h2 className="text-md font-semibold">Consommation du mois</h2>
            <p className="text-xs text-text-muted">Depuis le {formatDate(u.period.from)}.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Gauge label="Suggestions IA" value={u.aiRequests} max={u.quotas.aiRequestsPerMonth} />
              <Gauge label="Articles actifs" value={u.itemsCount} max={u.quotas.items} />
              <Gauge label="Connexions" value={u.connectionsCount} max={u.quotas.connections} />
              <Gauge label="Utilisateurs" value={u.membersCount} max={u.quotas.members} />
            </div>
            <DescriptionList className="mt-4" columns={2} items={[{ label: "Actions automatiques (mois)", value: formatNumber(u.automationActions), numeric: true }, { label: "Limite journalière d'actions", value: formatNumber(u.quotas.automationActionsPerDay), numeric: true }, { label: "Synchronisations", value: formatNumber(u.connectorSyncs), numeric: true }, { label: "Exports CSV", value: formatNumber(u.exports), numeric: true }, { label: "Captures extension", value: formatNumber(u.extensionCaptures), numeric: true }]} />
          </Card>
        )}
      </QueryBoundary>
      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_CARDS.map((p) => (
          <Card key={p.plan} className={sub.data?.plan === p.plan ? "border-accent" : undefined}>
            <h3 className="text-md font-semibold">{p.name}</h3>
            <p className="num mt-1 text-lg font-semibold">{p.indicativeMonthlyCents === null ? "À définir" : p.indicativeMonthlyCents === 0 ? "0 €" : formatCents(p.indicativeMonthlyCents, { compact: true })}<span className="text-xs font-normal text-text-muted"> / mois, indicatif</span></p>
            <ul className="mt-2 text-xs text-text-muted">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            {manage && p.plan !== "free" && sub.data?.plan !== p.plan ? <Button className="mt-3" size="sm" variant="secondary" onClick={() => checkout.mutate(p.plan as "starter" | "pro")} loading={checkout.isPending && checkout.variables === p.plan}>Choisir (test)</Button> : null}
            {sub.data?.plan === p.plan ? <p className="mt-3 text-xs text-accent">Plan actuel</p> : null}
          </Card>
        ))}
      </div>
      {checkout.data ? <Alert tone={checkout.data.simulated ? "warning" : "info"}>{checkout.data.message}</Alert> : null}
    </div>
  );
}

function Gauge({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm"><span>{label}</span><span className="num text-text-muted">{formatNumber(value)} / {formatNumber(max)}</span></div>
      <ProgressBar className="mt-1.5" value={value} max={max} label={label} />
    </div>
  );
}
