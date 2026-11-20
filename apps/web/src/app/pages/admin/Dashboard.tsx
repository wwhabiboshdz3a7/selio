import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ORG_QUALIFICATIONS, ORG_QUALIFICATION_LABELS, PAID_PLANS, PLANS, PLAN_LABELS } from "@selio/contracts";
import { Card, CountUp, KpiCard, PageHeader, StatusBadge, formatCents, formatDateTime, formatNumber } from "@selio/ui";
import { useClient, useData } from "../../../lib/data/provider";
import { QUALIFICATION_TONES } from "../../../lib/admin";
import { QueryBoundary } from "../../components/common";
import { isServerOutdated } from "../../../lib/admin";
import { ServerOutdatedState } from "./AdminLayout";

/**
 * Selio Admin › Tableau de bord : la croissance en chiffres réels de la base (comptes inscrits, essais, payants,
 * accès offerts, qualifications, inscriptions sur 7 et 30 jours, parrainages) et le revenu mensuel estimé à partir
 * des abonnements payés par carte et du prix de leur plan. Rien n'est inventé : un compteur vide affiche 0.
 */
export default function AdminDashboard() {
  const client = useClient();
  const { mode } = useData();
  const q = useQuery({ queryKey: ["admin-growth"], queryFn: () => client.getAdminGrowth(), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader eyebrow="Selio Admin" title="Tableau de bord" description="La croissance de Selio en chiffres réels : comptes, essais, abonnements payants, accès offerts et inscriptions. Le revenu mensuel est estimé à partir des abonnements payés par carte et du prix de leur plan." />
      {mode === "demo" ? <p className="mb-4 text-xs text-text-muted">Démonstration : en plus du compte de la démo, les comptes marqués « exemple » sont fictifs.</p> : null}
      {q.isError && isServerOutdated(q.error) ? <ServerOutdatedState /> : <QueryBoundary query={q}>
        {(g) => (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
              <KpiCard label="Comptes inscrits" value={<CountUp value={g.accounts.total} format={formatNumber} />} hint={`${formatNumber(g.signups.last7Days)} sur 7 jours · ${formatNumber(g.signups.last30Days)} sur 30 jours`} />
              <KpiCard label="En essai" value={<CountUp value={g.accounts.trialing} format={formatNumber} />} hint="Essai de 14 jours en cours" />
              <KpiCard label="Payants" value={<CountUp value={g.accounts.paying} format={formatNumber} />} hint={PAID_PLANS.map((p) => `${PLAN_LABELS[p]} ${g.payingByPlan[p]}`).join(" · ")} />
              <KpiCard label="Revenu mensuel estimé" value={<CountUp value={g.mrrCents} format={(v) => formatCents(v)} />} hint="TTC, annuel ramené au mois" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
              <KpiCard label="Accès offerts" value={formatNumber(g.accounts.granted)} hint="Plan payant sans débit (équipe, partenaires…)" />
              <KpiCard label="Accès de base" value={formatNumber(g.accounts.free)} hint="Essai terminé ou abonnement fini" />
              <KpiCard label="Comptes bloqués" value={formatNumber(g.accounts.blocked)} />
              <KpiCard label="Parrainages" value={formatNumber(g.referrals.pending + g.referrals.qualified + g.referrals.credited)} hint={`${g.referrals.pending} en attente · ${g.referrals.qualified} qualifiés · ${g.referrals.credited} crédités · ${g.referrals.refused} refusés`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-3 text-md font-semibold">Par qualification</h2>
                <ul className="divide-y divide-border" aria-label="Comptes par qualification">
                  {ORG_QUALIFICATIONS.map((qual) => (
                    <li key={qual} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link to={`/admin/comptes?qualification=${qual}`} className="tap-target hover:underline"><StatusBadge tone={QUALIFICATION_TONES[qual]}>{ORG_QUALIFICATION_LABELS[qual]}</StatusBadge></Link>
                      <span className="num font-medium">{formatNumber(g.byQualification[qual])}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Par plan</h2>
                <ul className="divide-y divide-border" aria-label="Comptes par plan">
                  {PLANS.map((p) => (
                    <li key={p} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link to={`/admin/comptes?plan=${p}`} className="tap-target hover:underline">{PLAN_LABELS[p]}</Link>
                      <span className="num font-medium">{formatNumber(g.byPlan[p])}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-text-muted">Un essai compte dans le plan de l'essai (Pro) ; un accès offert dans le plan offert.</p>
              </Card>
            </div>
            <p className="text-xs text-text-muted">Mis à jour le {formatDateTime(g.generatedAt)}.</p>
          </div>
        )}
      </QueryBoundary>}
    </>
  );
}
