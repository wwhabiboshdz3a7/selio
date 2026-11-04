import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Gauge, LineChart, ShieldCheck, TrendingUp } from "lucide-react";
import { PLAN_LABELS, TRACK_LEGAL_NOTICE, TRACK_SOURCE_LABELS, TRACK_UNAVAILABLE_MESSAGE, quotasForPlan } from "@selio/contracts";
import { Alert, Card, PageHeader, StatStrip, StatusBadge, buttonClass, formatNumber } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import type { TrackUsageView } from "../../../lib/data/types";
import { QueryBoundary } from "../../components/common";

/** Clés de requête de Track (invalidées après chaque action). */
export const TRACK_KEYS = ["track-usage", "track-filters", "track-trends", "track-scans", "track-photo-searches", "track-sales", "usage"];

export function useTrackUsage() {
  const client = useClient();
  return useQuery({ queryKey: ["track-usage"], queryFn: () => client.trackUsage(), staleTime: 15_000 });
}

/** « 3 / 5 » ; quota nul : « — ». */
export function quotaText(c: { used: number; quota: number }): string {
  return `${formatNumber(c.used)} / ${c.quota > 0 ? formatNumber(c.quota) : "—"}`;
}

/** Ce que Track fait, par offre (quotas lus dans la configuration des plans, jamais en dur). */
function PlanTable() {
  const pro = quotasForPlan("pro");
  const agence = quotasForPlan("agence");
  const rows: [string, ReactNode, ReactNode][] = [
    ["Filtres suivis, relus toutes les 2 h", formatNumber(pro.trackFiltersFollowed), formatNumber(agence.trackFiltersFollowed)],
    ["Scans de niche par mois (note sur 100)", formatNumber(pro.trackScansPerMonth), formatNumber(agence.trackScansPerMonth)],
    ["Recherches par photo par mois", formatNumber(pro.trackPhotoSearchesPerMonth), formatNumber(agence.trackPhotoSearchesPerMonth)],
    ["Historique", `${pro.trackHistoryMonths} mois`, `${agence.trackHistoryMonths} mois`],
    ["Flux des ventes", "—", "Compris"],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead><tr className="border-b border-border text-left"><th className="th-label py-2 pr-4">Track</th><th className="th-label py-2 pr-4 text-right">{PLAN_LABELS.pro}</th><th className="th-label py-2 text-right">{PLAN_LABELS.agence}</th></tr></thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-b border-border last:border-0"><td className="py-2.5 pr-4 text-text">{label}</td><td className="num py-2.5 pr-4 text-right">{a}</td><td className="num py-2.5 text-right">{b}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Page d'explication pour les offres sans Track (gratuit, Starter). */
export function TrackUpsell({ plan }: { plan: TrackUsageView["plan"] }) {
  return (
    <>
      <PageHeader eyebrow="Selio Track" title={TRACK_UNAVAILABLE_MESSAGE} description={`Votre offre actuelle (${PLAN_LABELS[plan]}) ne comprend pas Track. Passez à Pro ou Agence pour suivre le marché Vinted et estimer vos prix.`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <h2 className="mb-3 text-md font-semibold">Ce que Track vous apporte</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              { icon: <TrendingUp />, t: "Filtres suivis", d: "Prix médian, annonces actives, nouvelles et disparues, sur 30 jours." },
              { icon: <Gauge />, t: "Scans de niche", d: "Une marque et une catégorie notées sur 100 : demande, vitesse, concurrence, marge." },
              { icon: <Camera />, t: "Recherche par photo", d: "Une photo, et la fourchette de prix avec trois stratégies et le délai estimé." },
              { icon: <LineChart />, t: "Flux des ventes (Agence)", d: "Ce qui se vend, par marque et catégorie." },
            ].map((x) => (
              <li key={x.t} className="flex items-start gap-3"><span className="mt-0.5 text-text-muted [&>svg]:size-4" aria-hidden>{x.icon}</span><span><span className="font-medium text-text">{x.t}</span><span className="block text-text-muted">{x.d}</span></span></li>
            ))}
          </ul>
          <Link to="/app/settings/billing" className={buttonClass({ variant: "accent", className: "mt-5" })}>Voir les offres</Link>
        </Card>
        <Card><PlanTable /></Card>
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-xs text-text-muted"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{TRACK_LEGAL_NOTICE}</p>
    </>
  );
}

/** Réservé à Agence (flux des ventes, analyse d'un vendeur). */
export function AgencyOnly({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Selio Track · Agence" title={title} description="Compris dans l'offre Agence." />
      <Card>
        {children}
        <p className="text-sm text-text-muted">Passez à Agence pour y accéder : 25 filtres suivis, 50 scans et 150 recherches par photo par mois, 12 mois d'historique.</p>
        <Link to="/app/settings/billing" className={buttonClass({ variant: "secondary", className: "mt-4" })}>Voir les offres</Link>
      </Card>
    </>
  );
}

/**
 * Garde des pages Track : Pro et Agence seulement (sinon la page d'explication « compris à partir de
 * Pro ») ; `agency` : Agence seulement.
 */
export function TrackGate({ children, agency }: { children: (u: TrackUsageView) => ReactNode; agency?: { title: string } }) {
  const usage = useTrackUsage();
  return (
    <QueryBoundary query={usage} skeleton="spinner">
      {(u) => (!u.available ? <TrackUpsell plan={u.plan} /> : agency && !u.salesFeed ? <AgencyOnly title={agency.title} /> : <>{children(u)}</>)}
    </QueryBoundary>
  );
}

/** Quotas du mois en un seul bandeau d'indicateurs. */
export function TrackQuotaStrip({ usage, className }: { usage: TrackUsageView; className?: string }) {
  return (
    <StatStrip
      className={className ?? "grid-cols-2 lg:grid-cols-4"}
      items={[
        { label: "Filtres suivis", value: quotaText(usage.filters), sub: usage.filters.exceeded ? "Limite atteinte" : "Lus toutes les 2 h" },
        { label: "Scans de niche du mois", value: quotaText(usage.scans), sub: usage.scans.warning ? `${usage.scans.percent} % utilisés` : "Remis à zéro le 1er du mois" },
        { label: "Recherches par photo du mois", value: quotaText(usage.photoSearches), sub: usage.photoSearches.warning ? `${usage.photoSearches.percent} % utilisées` : "La photo n'est pas conservée" },
        { label: "Historique", value: `${usage.historyMonths} mois`, sub: `Offre ${PLAN_LABELS[usage.plan]}` },
      ]}
    />
  );
}

/** Source des lectures : simulateur par défaut ; lecture en direct des pages publiques à valider juridiquement. */
export function SourceState({ usage, className }: { usage: TrackUsageView; className?: string }) {
  const live = usage.source === "cloud";
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Source des données</h2>
        <StatusBadge tone={live ? "warning" : "accent"}>{live ? "En direct (à valider juridiquement)" : "Simulateur"}</StatusBadge>
      </div>
      <p className="mt-2 text-sm text-text">{usage.sourceLabel ?? TRACK_SOURCE_LABELS[usage.source ?? "demo"]}</p>
      <p className="mt-1 text-xs text-text-muted">
        {live
          ? "Pages publiques du catalogue lues par Selio Cloud, sans compte, avec les mêmes garde-fous que Radar : arrêt au premier signal de Vinted, ralentissement automatique, aucun contournement. L'usage des données issues de Vinted est à valider juridiquement."
          : "La lecture en direct des pages publiques du catalogue est désactivée par défaut : elle attend l'avis de l'avocat. En attendant, le simulateur produit des données de démonstration, signalées comme telles."}
      </p>
    </Card>
  );
}

/** Mentions d'une réponse Track (légale, disparitions estimées, démonstration). */
export function TrackNotices({ notices, className }: { notices: string[] | undefined; className?: string }) {
  const list = [...new Set(notices ?? [TRACK_LEGAL_NOTICE])];
  return (
    <Alert tone="info" className={className}>
      <ul className="flex flex-col gap-1">{list.map((n) => <li key={n}>{n}</li>)}</ul>
    </Alert>
  );
}

/** Variation en pourcentage (avec son signe : la couleur n'est jamais le seul signal). */
export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-muted">—</span>;
  const pct = Math.round(value * 1000) / 10;
  return <span className={pct > 0 ? "text-success" : pct < 0 ? "text-danger" : "text-text-muted"}>{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct).toLocaleString("fr-FR")} %</span>;
}
