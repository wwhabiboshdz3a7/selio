import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AI_STATUS, AiRequest, AiStatus } from "@selio/contracts";
import { aiOutcome, can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, Field, Input, ProgressBar, Segmented, Select, StatusBadge, Table, TableWrap, Td, Th, Toggle, Tr, formatDateTime, formatNumber, formatTime, type StatusTone } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import type { AiHealthData } from "../../../lib/data/types";
import { Gauge, StackedBar } from "../../../components/charts";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

const TONE: Record<(typeof AI_STATUS)[number], StatusTone> = { unconfigured: "muted", healthy: "success", degraded: "warning", unavailable: "danger", circuit_open: "danger", mock: "accent" };
const LABEL: Record<(typeof AI_STATUS)[number], string> = { unconfigured: "Non configuré", healthy: "Opérationnel", degraded: "Dégradé", unavailable: "Indisponible", circuit_open: "En pause (disjoncteur)", mock: "Simulateur" };
const STATUS_TEXT: Record<(typeof AI_STATUS)[number], string> = {
  unconfigured: "Aucun modèle n'est branché sur ce serveur : les gabarits déterministes restent disponibles.",
  healthy: "Le modèle répond normalement. Chaque réponse est contrôlée avant de vous être proposée.",
  degraded: "Le modèle répond, mais lentement ou partiellement. Les réponses restent contrôlées.",
  unavailable: "Le modèle ne répond pas : les gabarits déterministes prennent le relais.",
  circuit_open: "Trop d'échecs d'affilée : l'IA est mise en pause un court instant pour ne pas vous faire attendre.",
  mock: "Simulateur de démonstration : les réponses sont produites sans modèle réel.",
};

/** Libellés français des usages ; un usage ajouté plus tard s'affiche comme « Autre requête ». */
const KIND_LABELS: Partial<Record<AiRequest["kind"], string>> = {
  reply_suggestion: "Réponse à un message",
  negotiation: "Négociation",
  listing_description: "Description d'annonce",
  listing_generation: "Génération d'annonce",
  summary: "Résumé",
  health: "Contrôle de santé",
  help_answer: "Question d'aide",
};
const kindLabel = (k: string) => KIND_LABELS[k as AiRequest["kind"]] ?? "Autre requête";

const OUTCOME: Record<ReturnType<typeof aiOutcome>, { label: string; tone: StatusTone }> = {
  succeeded: { label: "Réussie", tone: "success" },
  fallback: { label: "Repli (gabarit)", tone: "warning" },
  rejected: { label: "Rejetée", tone: "warning" },
  failed: { label: "Échec", tone: "danger" },
  in_flight: { label: "En cours", tone: "accent" },
  cancelled: { label: "Annulée", tone: "muted" },
};

const seconds = (ms: number) => `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: ms < 10_000 ? 1 : 0 })} s`;
const WINDOWS = [{ value: "7", label: "7 j" }, { value: "30", label: "30 j" }, { value: "90", label: "90 j" }];

export default function Ai() {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const [windowDays, setWindowDays] = useState("30");
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => client.getAiStatus(), refetchInterval: 30_000 });
  const health = useQuery({ queryKey: ["ai-health", windowDays], queryFn: () => client.getAiHealth(Number(windowDays)), refetchInterval: 60_000 });
  const requests = useQuery({ queryKey: ["ai-requests"], queryFn: () => client.listAiRequests() });
  const [ai, setAi] = useState(session.org.settings.ai);
  const save = useAppMutation(() => client.updateOrg({ settings: { ai } }), { invalidate: ["session", "ai-health"], success: "Paramètres IA enregistrés" });
  const editable = can(session.role, "ai.configure");
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={status} skeleton="spinner">
        {(s) => (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-md font-semibold">État de l'assistant</h2>
                <StatusBadge tone={TONE[s.status]}>{LABEL[s.status]}</StatusBadge>
              </div>
              <Segmented ariaLabel="Période" size="sm" value={windowDays} onChange={setWindowDays} items={WINDOWS} />
            </div>
            <p className="mt-1 text-sm text-text-muted">{STATUS_TEXT[s.status]}</p>
            <QueryBoundary query={health} skeleton="spinner">
              {(h) => <HealthPanel h={h} s={s} />}
            </QueryBoundary>
            {mode === "demo" ? <Alert tone="info" className="mt-4">Démonstration : l'assistant est un simulateur déterministe. Ces pourcentages sont calculés sur les requêtes simulées de la démo, pas sur un vrai modèle.</Alert> : null}
            {s.status === "unavailable" || s.status === "circuit_open" ? <Alert tone="warning" className="mt-4" title="Repli actif">Les automatisations utilisent des gabarits déterministes tant que l'IA est indisponible. Aucune réponse simulée n'est présentée comme venant du modèle.</Alert> : null}
          </Card>
        )}
      </QueryBoundary>

      <Card>
        <h2 className="text-md font-semibold">Règles de l'assistant</h2>
        <div className="mt-4 flex max-w-xl flex-col gap-4">
          <Toggle label="Assistant activé" description="Désactivé : aucune suggestion, les gabarits restent disponibles." checked={ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} disabled={!editable} />
          <Toggle label="Validation humaine avant envoi" description="Les brouillons IA ne partent jamais seuls." checked={ai.requireApproval} onChange={(v) => setAi({ ...ai, requireApproval: v })} disabled={!editable} />
          <Field label="Ton">{(p) => <Select id={p.id} value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value as typeof ai.tone })} disabled={!editable}><option value="friendly">Chaleureux et concis</option><option value="neutral">Neutre et professionnel</option><option value="concise">Très court</option></Select>}</Field>
          <Field label="Signature" hint="Ajoutée en fin de message.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={ai.signature} onChange={(e) => setAi({ ...ai, signature: e.target.value })} maxLength={120} disabled={!editable} />}</Field>
          <Field label="Quota mensuel de requêtes" hint={health.data ? `Votre plan en permet ${formatNumber(health.data.quota.planLimit)} par mois ; 0 = la limite du plan.` : "Borné par votre plan ; 0 = la limite du plan."}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} type="number" min={0} max={100000} value={ai.monthlyRequestQuota} onChange={(e) => setAi({ ...ai, monthlyRequestQuota: Number(e.target.value) })} disabled={!editable} />}</Field>
          {editable ? <div><Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Enregistrer</Button></div> : null}
        </div>
      </Card>

      <Card padding="none">
        <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Historique</h2>
        <p className="px-4 text-sm text-text-muted md:px-5">Les 30 dernières requêtes faites à l'assistant.</p>
        <QueryBoundary query={requests}>
          {(list) => (
            <TableWrap className="mt-3 rounded-none border-0 border-t">
              <Table dense className="max-md:min-w-0">
                <thead><tr><Th className="hide-mobile">Date</Th><Th>Usage</Th><Th>Statut</Th><Th numeric>Durée</Th></tr></thead>
                <tbody>{list.length === 0 ? <tr><td colSpan={4} className="h-16 text-center text-sm text-text-muted">Aucune requête pour l'instant.</td></tr> : [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map((r) => {
                  const o = OUTCOME[aiOutcome(r)];
                  return (
                    <Tr key={r.id}>
                      <Td className="hide-mobile text-text-muted">{formatDateTime(r.createdAt)}</Td>
                      <Td><span className="block">{kindLabel(r.kind)}</span><span className="block text-xs text-text-muted md:hidden">{formatDateTime(r.createdAt)}</span></Td>
                      <Td><StatusBadge tone={o.tone} title={r.rejectionReason ?? r.error ?? undefined}>{o.label}</StatusBadge></Td>
                      <Td numeric>{r.latencyMs > 0 ? seconds(r.latencyMs) : "—"}</Td>
                    </Tr>
                  );
                })}</tbody>
              </Table>
            </TableWrap>
          )}
        </QueryBoundary>
      </Card>

      <TechnicalDetails status={status.data} health={health.data} />
    </div>
  );
}

function rateTone(rate: number | null, goodAbove: number, badBelow: number): string {
  if (rate === null) return "var(--accent-vivid)";
  return rate >= goodAbove ? "var(--accent-vivid)" : rate >= badBelow ? "var(--warning)" : "var(--danger)";
}

function HealthPanel({ h, s }: { h: AiHealthData; s: AiStatus }) {
  const quotaRate = h.quota.limit > 0 ? h.quota.used / h.quota.limit : 0;
  const refusals = h.fallbackRate;
  const queueLoad = s.queue.concurrency > 0 ? s.queue.running / s.queue.concurrency : 0;
  const latencyRate = h.avgLatencyMs !== null ? h.avgLatencyMs / h.limits.timeoutMs : 0;
  const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)} %`);
  const circuit = s.circuit.state === "closed"
    ? { title: "Fermé", text: "Les requêtes passent normalement." }
    : s.circuit.state === "open"
      ? { title: "Ouvert", text: `Après ${h.limits.circuitFailures} échecs d'affilée${s.circuit.openedAt ? ` (à ${formatTime(s.circuit.openedAt)})` : ""}, l'IA est en pause ${seconds(h.limits.circuitCooldownMs)} ; les gabarits prennent le relais.` }
      : { title: "En test", text: "Une requête d'essai vérifie que le modèle répond de nouveau." };
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-x-2 gap-y-5 lg:grid-cols-4">
        <Gauge size={150} label="Disponibilité" value={h.availabilityRate ?? 0} max={1} valueLabel={pct(h.availabilityRate)} tone={rateTone(h.availabilityRate, 0.8, 0.5)} sublabel={h.finished ? `${h.succeeded} réussie${h.succeeded > 1 ? "s" : ""} sur ${h.finished}` : "Aucune requête terminée"} />
        <Gauge size={150} label="Quota du mois" value={h.quota.used} max={h.quota.limit} tone={quotaRate >= 1 ? "var(--danger)" : quotaRate >= 0.8 ? "var(--warning)" : "var(--accent-vivid)"} sublabel={`${formatNumber(h.quota.used)} sur ${formatNumber(h.quota.limit)} requêtes`} />
        <Gauge size={150} label="Brouillons validés" value={h.validatedRate ?? 0} max={1} valueLabel={pct(h.validatedRate)} tone={rateTone(h.validatedRate, 0.8, 0.5)} sublabel={h.produced ? `${h.validated} sur ${h.produced} passés par les contrôles` : "Aucune sortie produite"} />
        <Gauge size={150} label="Refus et replis" value={refusals ?? 0} max={1} valueLabel={pct(refusals)} tone={refusals !== null && refusals > 0.2 ? "var(--warning)" : "var(--tone-slate)"} sublabel={`${h.rejected} rejetée${h.rejected > 1 ? "s" : ""} · ${h.fallbacks} repli${h.fallbacks > 1 ? "s" : ""}`} />
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Meter title="File d'attente" value={pct(queueLoad)} detail={`${s.queue.running} en cours sur ${s.queue.concurrency} possibles · ${s.queue.pending} en attente (max ${h.limits.maxPending})`}>
          <ProgressBar value={s.queue.running} max={Math.max(1, s.queue.concurrency)} label="Charge de la file" />
        </Meter>
        <Meter title="Latence moyenne" value={h.avgLatencyMs !== null ? seconds(h.avgLatencyMs) : "—"} detail={`Délai maximal ${seconds(h.limits.timeoutMs)}${h.p95LatencyMs !== null ? ` · 95 % sous ${seconds(h.p95LatencyMs)}` : ""}${h.timeouts ? ` · ${h.timeouts} délai${h.timeouts > 1 ? "s" : ""} dépassé${h.timeouts > 1 ? "s" : ""}` : ""}`}>
          <ProgressBar value={Math.round(latencyRate * 1000)} max={1000} label="Latence moyenne par rapport au délai maximal" />
        </Meter>
        <Meter title="Disjoncteur" value={circuit.title} detail={`${circuit.text}${s.circuit.failures ? ` ${s.circuit.failures} échec${s.circuit.failures > 1 ? "s" : ""} récent${s.circuit.failures > 1 ? "s" : ""}.` : ""}`} />
      </div>
      {h.byKind.length ? (
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium text-text">Requêtes par usage <span className="font-normal text-text-muted">· {h.windowDays} derniers jours</span></p>
          <StackedBar rows={h.byKind.map((k) => ({ label: kindLabel(k.kind), value: k.total }))} />
        </div>
      ) : null}
    </>
  );
}

function Meter({ title, value, detail, children }: { title: string; value: string; detail: string; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-text-muted">{title}</p>
      <p className="num mt-0.5 text-lg font-semibold text-text">{value}</p>
      {children ? <div className="mt-2">{children}</div> : null}
      <p className="num mt-1.5 text-xs text-text-muted">{detail}</p>
    </div>
  );
}

/** Détails techniques, repliés : fournisseur, modèle, limites de la passerelle, branchement d'un modèle. */
function TechnicalDetails({ status, health }: { status?: AiStatus; health?: AiHealthData }) {
  return (
    <details className="card group p-4 md:p-5">
      <summary className="cursor-pointer text-md font-semibold text-text">Détails techniques</summary>
      {status ? <DescriptionList className="mt-4" columns={2} items={[
        { label: "Fournisseur", value: status.provider },
        { label: "Modèle", value: status.model },
        { label: "Latence du dernier contrôle", value: status.latencyMs === null ? "—" : `${status.latencyMs} ms`, numeric: true },
        { label: "Dernière vérification", value: formatDateTime(status.checkedAt) },
        ...(health ? [
          { label: "Requêtes simultanées", value: String(health.limits.concurrency), numeric: true },
          { label: "File d'attente maximale", value: String(health.limits.maxPending), numeric: true },
          { label: "Délai maximal par requête", value: seconds(health.limits.timeoutMs), numeric: true },
          { label: "Seuil du disjoncteur", value: `${health.limits.circuitFailures} échecs, pause ${seconds(health.limits.circuitCooldownMs)}` },
        ] : []),
      ]} /> : null}
      <h3 className="mt-5 text-base font-semibold">Générateur d'annonces : brancher votre modèle</h3>
      <p className="mt-1 text-sm text-text-muted">Le générateur envoie les photos au serveur Selio, qui les transmet à votre modèle IA. Pour qu'il « voie » vraiment les photos, il faut un modèle multimodal (vision) en plus du modèle de texte.</p>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-muted">
        <li>Sur le serveur IA : <code className="rounded bg-surface-muted px-1 text-text">ollama pull qwen2.5:7b-instruct</code> (texte) et <code className="rounded bg-surface-muted px-1 text-text">ollama pull qwen2.5vl:7b</code> (vision).</li>
        <li>Côté API et worker : <code className="rounded bg-surface-muted px-1 text-text">AI_PROVIDER=ollama</code>, <code className="rounded bg-surface-muted px-1 text-text">OLLAMA_BASE_URL</code>, <code className="rounded bg-surface-muted px-1 text-text">OLLAMA_MODEL</code>, <code className="rounded bg-surface-muted px-1 text-text">OLLAMA_VISION_MODEL</code>.</li>
        <li>Vérifier : <code className="rounded bg-surface-muted px-1 text-text">pnpm ai:diagnose</code> puis ce statut doit passer à « Opérationnel ».</li>
      </ol>
      <p className="mt-3 text-xs text-text-muted">Sans modèle de vision, le générateur fonctionne quand même à partir des indications (marque, taille, notes) et le signale. Le prix conseillé n'est jamais fixé par l'IA : il vient des ventes comparables.</p>
    </details>
  );
}
