import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Cloud, FlaskConical, Gauge, ShieldAlert } from "lucide-react";
import { PURCHASE_STATUS_LABELS, RADAR_BLOCKS_PER_1000_THRESHOLD, type PurchaseStatus, type RadarSearch } from "@selio/contracts";
import { Card, StatStrip, StatusBadge, Tag, cn, formatNumber, formatRelative, type StatusTone } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import type { RadarMetricsView } from "../../lib/data/types";
import { formatDuration, liveReadiness, type LiveReadiness } from "../../lib/radar";

/** Clés de cache de Radar (invalidées après chaque action). */
export const RADAR_KEYS = ["searches", "opportunities", "opportunity", "purchases", "nav-counts", "radar-metrics", "radar-auto"];

export function useAutoBuyStatus() {
  const client = useClient();
  return useQuery({ queryKey: ["radar-auto"], queryFn: () => client.autoBuyStatus() });
}

/**
 * Lecture en direct prête ou non, par recherche : compte Achat relié au Cloud (actif, session, accord).
 * Indication pour l'écran seulement : le serveur reste seul juge à chaque lecture.
 */
export function useLiveReadiness(): ((search: Pick<RadarSearch, "connectionId"> | null) => LiveReadiness) | null {
  const client = useClient();
  const session = useRequiredSession();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const cloudAccounts = useQuery({ queryKey: ["cloud-accounts"], queryFn: () => client.cloudAccounts() });
  const consent = useQuery({ queryKey: ["cloud-consent"], queryFn: () => client.cloudConsent() });
  if (!connections.data || cloudAccounts.isLoading || consent.isLoading) return null;
  return (search) => liveReadiness({ search, connections: connections.data, cloudAccounts: cloudAccounts.data ?? [], consent: consent.data ?? null, autoBuyConnectionId: session.org.settings.autoBuy.connectionId });
}

/** Source d'une recherche : simulateur ou lecture en direct depuis le compte Achat (Selio Cloud). */
export function SourceTag({ search }: { search: Pick<RadarSearch, "source"> }) {
  return search.source === "cloud"
    ? <Tag accent><Cloud className="mr-1 size-3" aria-hidden />En direct · Selio Cloud</Tag>
    : <Tag><FlaskConical className="mr-1 size-3" aria-hidden />Simulateur</Tag>;
}

/** Rythme de lecture affiché : intervalle effectif, facteur de ralentissement, dernier blocage. */
export function SearchRhythm({ search, className }: { search: RadarSearch; className?: string }) {
  const { mode } = useData();
  const interval = search.intervalSeconds;
  if (search.source !== "cloud") {
    // En démonstration, aucun serveur ne relit le simulateur : seulement « Analyser ».
    return <p className={cn("text-xs text-text-muted", className)}>Simulateur : aucune page Vinted lue, rien n'est mesuré{interval && mode !== "demo" ? ` · relu toutes les ${formatDuration(interval)} par le serveur` : ""}.</p>;
  }
  const factor = search.slowdownFactor ?? 1;
  return (
    <div className={cn("flex flex-col gap-0.5 text-xs text-text-muted", className)} data-testid={`rhythm-${search.id}`}>
      <span className="num inline-flex flex-wrap items-center gap-x-1.5">
        <Gauge className="size-3.5" aria-hidden />
        {interval ? <>Toutes les <span className="font-medium text-text">{formatDuration(interval)}</span></> : "Rythme calculé par le serveur"}
        {factor > 1 ? <span className="text-warning">· ralenti × {factor} après un blocage (toutes les recherches en direct)</span> : <span>· rythme normal (× 1)</span>}
      </span>
      {search.suspendedReason ? <span className="text-warning" role="note">{search.suspendedReason}</span> : null}
      <span className="num">
        {formatNumber(search.pagesRead ?? 0)} page(s) lue(s) · {search.lastBlockAt ? <>dernier blocage {formatRelative(search.lastBlockAt)}</> : "aucun blocage"}
      </span>
    </div>
  );
}

/** Ce qui manque pour lire en direct, avec le lien vers les comptes Cloud. */
export function LiveReadinessNote({ readiness, className }: { readiness: LiveReadiness | null; className?: string }) {
  if (!readiness) return null;
  if (readiness.ready) {
    return <p className={cn("flex items-center gap-1.5 text-xs text-text-muted", className)}><StatusBadge tone="success">Prête</StatusBadge>Compte Achat « {readiness.account?.label} » actif dans Selio Cloud.</p>;
  }
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-text-muted", className)} role="note">
      <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
      <span>{readiness.problem} <Link to="/cloud/comptes" className="font-medium text-accent underline-offset-2 hover:underline">Comptes Cloud</Link></span>
    </p>
  );
}

const TO_MEASURE = <span className="text-base font-medium text-text-muted">à mesurer</span>;

/**
 * Panneau « Mesures » : délais médians publication → détection et détection → achat, blocages pour
 * 1 000 pages, lectures par jour. Rien n'est présenté comme mesuré sans lecture en direct (« à mesurer ») ;
 * les chiffres de la démonstration sont marqués « Démo ».
 */
export function RadarMetricsPanel({ metrics, className }: { metrics: RadarMetricsView; className?: string }) {
  const measured = metrics.status === "measured";
  const perDay = metrics.readsPerDay;
  const avgPerDay = perDay.length ? Math.round(perDay.reduce((s, d) => s + d.reads, 0) / perDay.length) : null;
  const maxReads = Math.max(1, ...perDay.map((d) => d.reads));
  const rate = metrics.blockRatePer1000;
  return (
    <Card padding="none" role="region" className={cn("overflow-hidden", className)} aria-labelledby="radar-metrics-title">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 id="radar-metrics-title" className="text-md font-semibold">Mesures</h2>
          <p className="text-xs text-text-muted">{measured ? metrics.label : "Rien n'est mesuré tant qu'aucune page n'a été lue en direct : le simulateur ne compte jamais."} · {metrics.days} derniers jours</p>
        </div>
        {metrics.demo ? <Tag>Démo</Tag> : measured ? <StatusBadge tone="success">Mesuré</StatusBadge> : <StatusBadge tone="muted">À mesurer</StatusBadge>}
      </div>
      <StatStrip
        className="rounded-none border-x-0 border-b-0 grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Publication → détection", value: metrics.medianPublishToDetectSeconds !== null ? formatDuration(metrics.medianPublishToDetectSeconds) : TO_MEASURE, sub: "médiane, annonces lues en direct" },
          { label: "Détection → achat", value: metrics.medianDetectToPurchaseSeconds !== null ? formatDuration(metrics.medianDetectToPurchaseSeconds) : TO_MEASURE, sub: "médiane, achats réels seulement" },
          {
            label: "Blocages pour 1 000 pages",
            value: rate !== null ? <span className={rate > RADAR_BLOCKS_PER_1000_THRESHOLD ? "text-warning" : undefined}>{rate.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</span> : TO_MEASURE,
            sub: rate !== null ? `${formatNumber(metrics.blocks)} sur ${formatNumber(metrics.liveReads)} pages · au-delà de ${RADAR_BLOCKS_PER_1000_THRESHOLD}, le rythme ralentit` : `au-delà de ${RADAR_BLOCKS_PER_1000_THRESHOLD} pour 1 000, le rythme ralentit`,
          },
          {
            label: "Lectures par jour",
            value: avgPerDay !== null ? formatNumber(avgPerDay) : TO_MEASURE,
            sub: avgPerDay !== null ? `moyenne sur ${perDay.length} jour(s)` : "pages lues en direct",
            extra: perDay.length > 1 ? (
              <div className="flex h-8 items-end gap-1" aria-hidden>
                {perDay.slice(-14).map((d) => <span key={d.day} className={cn("w-full rounded-[2px] bg-accent-vivid", d.reads === maxReads ? "" : "opacity-35")} style={{ height: `${Math.max(8, (d.reads / maxReads) * 100)}%` }} title={`${d.day} : ${d.reads} lecture(s), ${d.blocks} blocage(s)`} />)}
              </div>
            ) : undefined,
          },
        ]}
      />
    </Card>
  );
}

/** Statut d'une demande d'achat, en clair (le 3-D Secure dit ce que le client doit faire). */
export const PURCHASE_STATUS_VIEW: Record<PurchaseStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "En cours", tone: "muted" },
  awaiting_confirmation: { label: PURCHASE_STATUS_LABELS.awaiting_confirmation, tone: "warning" },
  awaiting_3ds: { label: "En attente de validation bancaire (3-D Secure)", tone: "warning" },
  simulated: { label: PURCHASE_STATUS_LABELS.simulated, tone: "success" },
  blocked: { label: PURCHASE_STATUS_LABELS.blocked, tone: "danger" },
  executed: { label: PURCHASE_STATUS_LABELS.executed, tone: "success" },
  cancelled: { label: PURCHASE_STATUS_LABELS.cancelled, tone: "muted" },
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  const v = PURCHASE_STATUS_VIEW[status];
  return <StatusBadge tone={v.tone}>{v.label}</StatusBadge>;
}
