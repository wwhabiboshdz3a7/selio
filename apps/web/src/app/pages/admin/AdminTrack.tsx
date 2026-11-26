import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, ShieldCheck } from "lucide-react";
import { PLAN_LABELS, isPlan, type TrackAdminRead, type TrackAdminStatus } from "@selio/contracts";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, StatStrip, StatusBadge, Table, TableWrap, Td, Th, Tr, cn, formatDateTime, formatNumber, formatRelative } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

/** Libellés des résultats d'une lecture (journal de 7 jours). */
const OUTCOME_LABELS: Record<string, string> = {
  ok: "Lue",
  captcha: "CAPTCHA (arrêt)",
  blocked: "Blocage (arrêt)",
  rate_limited: "Trop de requêtes (arrêt)",
  page_changed: "Page non reconnue",
  timeout: "Délai dépassé",
  error: "Erreur",
};
const PROBLEM = new Set(["captcha", "blocked", "rate_limited"]);

function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone = outcome === "ok" ? "success" : PROBLEM.has(outcome) ? "danger" : "warning";
  return <StatusBadge tone={tone}>{OUTCOME_LABELS[outcome] ?? outcome}</StatusBadge>;
}

const ratioText = (c: { used: number; quota: number }) => `${formatNumber(c.used)} / ${c.quota > 0 ? formatNumber(c.quota) : "—"}`;
const near = (c: { used: number; quota: number }) => c.quota > 0 && c.used / c.quota >= 0.8;

/**
 * Opérateur › Administration › Track : source active et interrupteur (TRACK_LIVE_ENABLED), état du lecteur
 * (pauses, ralentissement, dernières lectures, blocages récents), usage de Track par client face aux quotas,
 * et la pause manuelle (rôle « tech ») que le worker relit à chaque lecture, sans redémarrage.
 * Aucune donnée de personne : ni critère ni nom de filtre, empreintes abrégées seulement.
 */
export function AdminTrack() {
  const client = useClient();
  const q = useQuery({ queryKey: ["admin-track"], queryFn: () => client.adminTrack(), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader eyebrow="Opérateur" title="Selio Track" description="Source des lectures, état du lecteur, usage par client et pause de Track. La lecture réelle des pages publiques s'ouvre par l'interrupteur TRACK_LIVE_ENABLED, progressivement : en pause d'abord, puis par paliers de pages par minute." />
      <QueryBoundary query={q} skeleton="spinner">{(d) => <Content d={d} />}</QueryBoundary>
    </>
  );
}

export default AdminTrack;

function pauseText(d: TrackAdminStatus): { tone: "success" | "warning" | "danger"; label: string; sub: string } {
  if (d.manualPause.paused) return { tone: "warning", label: "Pause manuelle", sub: d.manualPause.since ? `Depuis ${formatRelative(d.manualPause.since)}` : "En cours" };
  if (d.machinePausedUntil) return { tone: "danger", label: "Coupe-circuit", sub: `Machine arrêtée jusqu'à ${formatDateTime(d.machinePausedUntil)}` };
  if (d.signalPause.active && d.signalPause.until) return { tone: "danger", label: "Pause après un signal", sub: `Jusqu'à ${formatDateTime(d.signalPause.until)} (${OUTCOME_LABELS[d.signalPause.reason ?? ""] ?? d.signalPause.reason ?? "signal"})` };
  return { tone: "success", label: "Aucune", sub: "Le worker lit les empreintes dues" };
}

function Content({ d }: { d: TrackAdminStatus }) {
  const pause = pauseText(d);
  return (
    <div className="flex flex-col gap-6">
      <StatStrip
        className="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Source", value: d.source === "cloud" ? "En direct" : "Simulateur", sub: d.sourceLabel },
          { label: "Interrupteur", value: d.liveEnabled ? "Ouvert" : "Fermé", sub: "TRACK_LIVE_ENABLED (API)" },
          { label: "Pause", value: <span className="inline-flex items-center gap-2"><StatusBadge tone={pause.tone}>{pause.label}</StatusBadge></span>, sub: pause.sub },
          { label: "Ralentissement", value: `×${d.slowdown.factor}`, sub: d.slowdown.lastBlockAt ? `Dernier blocage ${formatRelative(d.slowdown.lastBlockAt)}` : "Aucun blocage enregistré" },
        ]}
      />
      <Alert tone={d.liveEnabled ? "warning" : "info"}>
        <ul className="flex flex-col gap-1">{d.notices.map((n) => <li key={n}>{n}</li>)}</ul>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        <PauseControl d={d} />
        <Card>
          <h2 className="mb-3 text-md font-semibold">Lecteur</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">Empreintes suivies</dt><dd className="num text-right">{formatNumber(d.fingerprints.followed)}</dd>
            <dt className="text-text-muted">Dues maintenant</dt><dd className="num text-right">{formatNumber(d.fingerprints.due)}</dd>
            <dt className="text-text-muted">Ralenties (page illisible)</dt><dd className="num text-right">{formatNumber(d.fingerprints.slowed)}</dd>
            <dt className="text-text-muted">Lectures sur 24 h</dt><dd className="num text-right">{formatNumber(d.last24h.reads)}</dd>
            <dt className="text-text-muted">dont anomalies</dt><dd className={cn("num text-right", d.last24h.anomalies > 0 && "text-warning")}>{formatNumber(d.last24h.anomalies)}</dd>
            <dt className="text-text-muted">dont blocages</dt><dd className={cn("num text-right", d.last24h.blocked > 0 && "text-danger")}>{formatNumber(d.last24h.blocked)}</dd>
            <dt className="text-text-muted">Blocages pour 1 000 pages</dt><dd className="num text-right">{d.slowdown.blocksPer1000 === null ? "—" : d.slowdown.blocksPer1000.toLocaleString("fr-FR")}</dd>
            <dt className="text-text-muted">Fenêtre glissante (direct)</dt><dd className="num text-right">{formatNumber(d.slowdown.windowBlocks)} / {formatNumber(d.slowdown.windowReads)}</dd>
          </dl>
          <p className="mt-3 text-xs text-text-muted">Au premier signal de Vinted, Track se met seul en pause 60 min, le ralentissement double et rien n'est retenté ; un blocage ou un « trop de requêtes » arrête aussi la machine (coupe-circuit).</p>
        </Card>
      </div>
      <ReadsCard title="Erreurs et blocages récents" reads={d.recentProblems} empty="Aucune anomalie ni aucun blocage sur 7 jours." />
      <ReadsCard title="Dernières lectures" reads={d.recentReads} empty={d.manualPause.paused ? "Track est en pause : aucune lecture." : "Aucune lecture sur 7 jours."} />
      <UsageCard d={d} />
    </div>
  );
}

function PauseControl({ d }: { d: TrackAdminStatus }) {
  const client = useClient();
  const [reason, setReason] = useState("");
  const pause = useAppMutation((r: string) => client.adminPauseTrack({ reason: r }), { invalidate: ["admin-track"], success: "Track est en pause : le worker ne lit plus aucune empreinte", onSuccess: () => setReason("") });
  const resume = useAppMutation(() => client.adminResumeTrack(), { invalidate: ["admin-track"], success: "Track reprend au prochain passage du worker" });
  const paused = d.manualPause.paused;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Pause manuelle</h2>
        <StatusBadge tone={paused ? "warning" : "success"}>{paused ? "Track en pause" : "Track actif"}</StatusBadge>
      </div>
      {paused ? (
        <p className="text-sm text-text">{d.manualPause.reason ? <>Raison : {d.manualPause.reason}</> : "Pause sans raison indiquée."}{d.manualPause.since ? <span className="block text-xs text-text-muted">Depuis le {formatDateTime(d.manualPause.since)}</span> : null}</p>
      ) : (
        <p className="text-sm text-text-muted">Arrête toutes les lectures de Track (simulateur compris) au prochain passage du worker, sans redémarrage. Une pause après un signal de Vinted reste en place jusqu'à son terme.</p>
      )}
      {!d.canControl ? (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />Mettre Track en pause ou le reprendre est réservé au rôle d'opérateur « tech ».</p>
      ) : paused ? (
        <Button className="mt-4" icon={<Play />} onClick={() => resume.mutate(undefined)} loading={resume.isPending}>Reprendre</Button>
      ) : (
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) pause.mutate(reason.trim()); }}>
          <Field label="Raison (journal d'audit)" className="min-w-0 flex-1">{(p) => <Input id={p.id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="ex. vérification après une alerte" />}</Field>
          <Button type="submit" variant="secondary" icon={<Pause />} disabled={reason.trim().length < 3} loading={pause.isPending}>Mettre Track en pause</Button>
        </form>
      )}
    </Card>
  );
}

function ReadsCard({ title, reads, empty }: { title: string; reads: TrackAdminRead[]; empty: string }) {
  return (
    <Card padding="none">
      <h2 className="px-4 pt-4 text-md font-semibold md:px-5">{title}</h2>
      {reads.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-sm text-text-muted md:px-5">{empty}</p>
      ) : (
        <TableWrap className="mt-3 rounded-none border-0 border-t">
          <Table stack dense>
            <thead><tr><Th>Lecture</Th><Th>Résultat</Th><Th className="hide-mobile">Empreinte</Th><Th numeric className="hide-mobile">Annonces</Th><Th numeric className="hide-mobile">Nouvelles</Th><Th numeric className="hide-mobile">Disparues</Th><Th numeric>Facteur</Th></tr></thead>
            <tbody>
              {reads.map((r, i) => (
                <Tr key={`${r.fingerprint}-${r.readAt}-${i}`}>
                  <Td><span className="block whitespace-nowrap">{formatDateTime(r.readAt)}</span><span className="block text-xs text-text-muted">{r.source === "demo" ? "Simulateur" : "En direct"}</span></Td>
                  <Td><OutcomeBadge outcome={r.outcome} />{r.message ? <span className="mt-1 block max-w-64 text-xs text-text-muted">{r.message}</span> : null}</Td>
                  <Td className="hide-mobile font-mono text-xs text-text-muted">{r.fingerprint}…</Td>
                  <Td numeric className="hide-mobile">{formatNumber(r.listed)}</Td>
                  <Td numeric className="hide-mobile">{formatNumber(r.newCount)}</Td>
                  <Td numeric className="hide-mobile">{formatNumber(r.goneCount)}</Td>
                  <Td numeric>×{r.factor}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

function UsageCard({ d }: { d: TrackAdminStatus }) {
  return (
    <Card padding="none">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 md:px-5">
        <h2 className="text-md font-semibold">Usage de Track par client</h2>
        <p className="text-xs text-text-muted">Filtres suivis face au quota du plan · scans et recherches par photo du mois</p>
      </div>
      {d.usage.length === 0 ? (
        <EmptyState className="py-8" title="Aucun client avec Track" description="Track est compris à partir de Pro." />
      ) : (
        <TableWrap className="mt-3 rounded-none border-0 border-t">
          <Table stack dense>
            <thead><tr><Th>Organisation</Th><Th className="hide-mobile">Plan</Th><Th numeric>Filtres suivis</Th><Th numeric>Scans</Th><Th numeric>Photos</Th><Th numeric className="hide-mobile">Alertes</Th></tr></thead>
            <tbody>
              {d.usage.map((u) => (
                <Tr key={u.orgId}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="hide-mobile">{isPlan(u.plan) ? PLAN_LABELS[u.plan] : u.plan}</Td>
                  <Td numeric className={cn(near(u.filters) && "text-warning")}>{ratioText(u.filters)}{u.filters.enabled < u.filters.used ? <span className="block text-xs text-text-muted">{u.filters.enabled} actif(s)</span> : null}</Td>
                  <Td numeric className={cn(near(u.scans) && "text-warning")}>{ratioText(u.scans)}</Td>
                  <Td numeric className={cn(near(u.photoSearches) && "text-warning")}>{ratioText(u.photoSearches)}</Td>
                  <Td numeric className="hide-mobile">{formatNumber(u.alertFilters)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
