import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { Alert, Card, PageHeader, StatStrip, StatusBadge, Table, TableWrap, Td, Th, Tr, formatDateTime, formatNumber, formatRelative } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import type { HealthComponentStatus, HealthDetailsView, SupervisionCheckView, SupervisionTargetView } from "../../lib/data/types";
import { formatUptime } from "../../lib/supervision";
import { QueryBoundary } from "../components/common";
import { AdminTabs } from "./admin-tabs";

const COMPONENT_LABELS: Record<keyof HealthDetailsView["health"]["checks"], string> = { database: "Base de données", redis: "Redis", queue: "File de tâches" };

function ComponentBadge({ status }: { status: HealthComponentStatus }) {
  if (status === "ok") return <StatusBadge tone="success">Opérationnel</StatusBadge>;
  if (status === "inline") return <StatusBadge tone="muted">Sans Redis (exécution directe)</StatusBadge>;
  return <StatusBadge tone="danger">En panne</StatusBadge>;
}

function TargetBadge({ t }: { t: SupervisionTargetView }) {
  if (t.status === "up") return <StatusBadge tone="success">Répond</StatusBadge>;
  if (t.status === "down") return <StatusBadge tone="danger">En panne</StatusBadge>;
  return t.consecutiveFailures > 0 ? <StatusBadge tone="warning">{t.consecutiveFailures} échec(s)</StatusBadge> : <StatusBadge tone="muted">Pas encore vérifiée</StatusBadge>;
}

const EVENT_LABELS: Record<NonNullable<SupervisionCheckView["event"]>, string> = { alert: "Alerte envoyée", reminder: "Rappel envoyé", recovered: "Rétabli (notifié)" };
const UNDELIVERED_LABELS: Record<NonNullable<SupervisionCheckView["event"]>, string> = { alert: "Alerte NON délivrée", reminder: "Rappel NON délivré", recovered: "Rétabli (notification NON délivrée)" };

/** Libellé d'un événement : « envoyé » seulement si au moins un canal l'a réellement délivré. */
function eventLabel(c: SupervisionCheckView): string {
  if (!c.event) return "";
  if (c.delivered === 0) return UNDELIVERED_LABELS[c.event];
  return c.delivered ? `${EVENT_LABELS[c.event]} (${c.delivered} ${c.delivered > 1 ? "canaux" : "canal"})` : EVENT_LABELS[c.event];
}

/**
 * Opérateur › Administration › Supervision : santé de l'API (GET /api/health/details), état de chaque cible
 * contrôlée chaque minute par le worker (/api/health, /api/ai/health), alertes et dernières vérifications.
 * Les alertes partent sur le téléphone (Web Push) et par email après 3 échecs d'affilée, avec un rappel
 * toutes les 60 minutes et un message au rétablissement.
 */
export default function AdminSupervision() {
  const client = useClient();
  const q = useQuery({ queryKey: ["health-details"], queryFn: () => client.getHealthDetails(), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader eyebrow="Opérateur" title="Administration" description="Supervision de la plateforme : l'API et l'assistant IA sont vérifiés chaque minute ; une panne prévient l'équipe sur le téléphone. Aucun secret ni adresse interne n'est affiché." />
      <AdminTabs />
      <QueryBoundary query={q} skeleton="spinner">
        {(d) => <SupervisionContent d={d} />}
      </QueryBoundary>
    </>
  );
}

function SupervisionContent({ d }: { d: HealthDetailsView }) {
  const sup = d.supervision;
  // Alertes de la période gardée (7 jours), et non des seules dernières vérifications de chaque cible.
  const alerts = sup.alerts ?? sup.recent.filter((c) => c.event !== null);
  const undelivered = alerts.filter((a) => a.delivered === 0 && a.event !== "recovered");
  const down = sup.targets.filter((t) => t.status === "down");
  return (
    <div className="flex flex-col gap-6">
      {d.simulated ? <Alert tone="info" title="Démonstration">Exemple fixe : aucune vérification réelle, aucune alerte envoyée.</Alert> : null}
      {undelivered.length > 0 ? <Alert tone="danger" title="Alerte délivrée à personne">{undelivered.length} alerte(s) ou rappel(s) n'ont atteint aucun canal (email « noop » ou en échec, aucun appareil abonné). Configurez un service d'email ou les notifications Web Push.</Alert> : null}
      {down.length > 0 ? <Alert tone="danger" title={`${down.length} cible(s) en panne`}>{down.map((t) => `${t.name} depuis ${t.downSince ? formatRelative(t.downSince) : "peu"}`).join(" · ")}</Alert> : null}
      <StatStrip
        className="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "État de l'API", value: d.health.ok ? "Opérationnelle" : "En panne", sub: `Version ${d.health.version}` },
          { label: "En service depuis", value: formatUptime(d.health.uptimeSeconds), sub: `Vérifiée ${formatRelative(d.health.checkedAt)}` },
          { label: "Cibles supervisées", value: formatNumber(sup.targets.length), sub: `${sup.targets.filter((t) => t.status === "up").length} répondent` },
          { label: "Alertes (7 jours)", value: formatNumber(alerts.length), sub: `Après ${sup.failuresBeforeAlert} échecs · rappel ${sup.reminderMinutes} min` },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-md font-semibold">Composants de l'API</h2>
          <ul className="divide-y divide-border">
            {(Object.keys(COMPONENT_LABELS) as (keyof typeof COMPONENT_LABELS)[]).map((k) => (
              <li key={k} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span className="block font-medium">{COMPONENT_LABELS[k]}</span>{k !== "queue" && d.health.latencyMs[k] !== null ? <span className="num block text-xs text-text-muted">{d.health.latencyMs[k]} ms</span> : null}</span>
                <ComponentBadge status={d.health.checks[k]} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 text-md font-semibold">Cibles vérifiées chaque minute</h2>
          {sup.targets.length === 0 ? <p className="text-sm text-text-muted">Aucune vérification encore : le worker n'a pas tourné (tâche « supervision.tick »).</p> : (
            <ul className="divide-y divide-border">
              {sup.targets.map((t) => (
                <li key={t.name} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">{t.name}</span>
                    <span className="block truncate text-xs text-text-muted">{t.url}</span>
                    <span className="num block text-xs text-text-muted">{t.lastCheckedAt ? `Vérifiée ${formatRelative(t.lastCheckedAt)}` : "Jamais vérifiée"}{t.lastLatencyMs !== null ? ` · ${t.lastLatencyMs} ms` : ""}{t.lastError ? ` · ${t.lastError}` : ""}</span>
                    {t.lastAlertAt ? <span className="block text-xs text-text-muted">Dernière alerte {formatRelative(t.lastAlertAt)}</span> : null}
                  </span>
                  <TargetBadge t={t} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-md font-semibold"><BellRing className="size-4 text-text-muted" aria-hidden />Alertes</h2>
        {alerts.length === 0 ? <p className="text-sm text-text-muted">Aucune alerte sur la période gardée (7 jours).</p> : (
          <ul className="divide-y divide-border text-sm" aria-label="Alertes de supervision">
            {alerts.map((a, i) => (
              <li key={`${a.target}-${a.checkedAt}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{a.target}</span> — <span className={a.delivered === 0 ? "text-danger" : undefined}>{eventLabel(a)}</span></span>
                <span className="num text-xs text-text-muted">{formatDateTime(a.checkedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-text-muted">Les alertes partent sur le téléphone des opérateurs (OPERATOR_EMAILS, notifications Web Push) et par email quand un service d'email est configuré ; une alerte délivrée à personne est retentée chaque minute. Base de données injoignable : email seulement. Machine entière ou Redis en panne : seul un battement externe (SUPERVISION_HEARTBEAT_URL) peut prévenir.</p>
      </Card>
      {d.queues.length > 0 ? (
        <Card padding="none">
          <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Files de tâches</h2>
          <TableWrap className="mt-3 rounded-none border-0 border-t"><Table dense><thead><tr><Th>File</Th><Th numeric>Attente</Th><Th numeric>Actives</Th><Th numeric>Échecs</Th><Th>État</Th></tr></thead><tbody>{d.queues.map((qu) => <Tr key={qu.name}><Td className="font-medium">{qu.name}</Td><Td numeric>{qu.waiting}</Td><Td numeric>{qu.active}</Td><Td numeric className={qu.failed > 0 ? "text-danger" : undefined}>{qu.failed}</Td><Td>{qu.paused ? <StatusBadge tone="warning">En pause</StatusBadge> : <StatusBadge tone="success">Active</StatusBadge>}</Td></Tr>)}</tbody></Table></TableWrap>
        </Card>
      ) : null}
      <Card padding="none">
        <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Dernières vérifications</h2>
        <TableWrap className="mt-3 rounded-none border-0 border-t">
          <Table dense>
            <thead><tr><Th>Date</Th><Th>Cible</Th><Th>Résultat</Th><Th numeric className="hide-mobile">Durée</Th><Th className="hide-mobile">Détail</Th></tr></thead>
            <tbody>
              {sup.recent.length === 0 ? <tr><td colSpan={5} className="h-16 text-center text-sm text-text-muted">Aucune vérification enregistrée.</td></tr> : sup.recent.slice(0, 40).map((c, i) => (
                <Tr key={`${c.target}-${c.checkedAt}-${i}`}>
                  <Td className="num text-text-muted">{formatDateTime(c.checkedAt)}</Td>
                  <Td>{c.target}</Td>
                  <Td>{c.ok ? <StatusBadge tone="success">OK{c.statusCode ? ` · ${c.statusCode}` : ""}</StatusBadge> : <StatusBadge tone="danger">Échec{c.statusCode ? ` · ${c.statusCode}` : ""}</StatusBadge>}</Td>
                  <Td numeric className="hide-mobile">{c.latencyMs !== null ? `${c.latencyMs} ms` : "—"}</Td>
                  <Td className="hide-mobile text-text-muted">{c.event ? eventLabel(c) : c.error ?? ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
