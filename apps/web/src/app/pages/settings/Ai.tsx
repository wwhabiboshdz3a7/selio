import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AI_STATUS } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, Field, Input, Select, StatusBadge, Table, TableWrap, Td, Th, Toggle, Tr, formatDateTime, formatNumber, type StatusTone } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

const TONE: Record<(typeof AI_STATUS)[number], StatusTone> = { unconfigured: "muted", healthy: "success", degraded: "warning", unavailable: "danger", circuit_open: "danger", mock: "accent" };
const LABEL: Record<(typeof AI_STATUS)[number], string> = { unconfigured: "Non configuré", healthy: "Opérationnel", degraded: "Dégradé", unavailable: "Indisponible", circuit_open: "Disjoncteur ouvert", mock: "Simulateur" };

export default function Ai() {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => client.getAiStatus(), refetchInterval: 30_000 });
  const requests = useQuery({ queryKey: ["ai-requests"], queryFn: () => client.listAiRequests() });
  const [ai, setAi] = useState(session.org.settings.ai);
  const save = useAppMutation(() => client.updateOrg({ settings: { ai } }), { invalidate: ["session"], success: "Paramètres IA enregistrés" });
  const editable = can(session.role, "ai.configure");
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={status} skeleton="spinner">
        {(s) => (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-md font-semibold">Statut de l'assistant</h2>
              <StatusBadge tone={TONE[s.status]}>{LABEL[s.status]}</StatusBadge>
            </div>
            <p className="mt-1 text-sm text-text-muted">{s.message}</p>
            <DescriptionList className="mt-4" columns={2} items={[{ label: "Fournisseur", value: s.provider }, { label: "Modèle", value: s.model }, { label: "Latence du dernier contrôle", value: s.latencyMs === null ? "—" : `${s.latencyMs} ms`, numeric: true }, { label: "File", value: `${s.queue.pending} en attente · ${s.queue.running}/${s.queue.concurrency} en cours`, numeric: true }, { label: "Disjoncteur", value: `${s.circuit.state} (${s.circuit.failures} échec(s))` }, { label: "Vérifié", value: formatDateTime(s.checkedAt) }]} />
            {mode === "demo" ? <Alert tone="info" className="mt-4">En démonstration, l'assistant est un simulateur déterministe : il n'y a pas de modèle réel. En mode connecté, le serveur appelle un Ollama privé ; le navigateur n'y accède jamais directement.</Alert> : null}
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
          <Field label="Quota mensuel de requêtes" hint="Borné par votre plan.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} type="number" min={0} max={100000} value={ai.monthlyRequestQuota} onChange={(e) => setAi({ ...ai, monthlyRequestQuota: Number(e.target.value) })} disabled={!editable} />}</Field>
          {editable ? <div><Button onClick={() => save.mutate()} loading={save.isPending}>Enregistrer</Button></div> : null}
        </div>
      </Card>
      <Card padding="none">
        <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Dernières requêtes</h2>
        <QueryBoundary query={requests}>
          {(list) => (
            <TableWrap className="mt-3 rounded-none border-0 border-t">
              <Table dense>
                <thead><tr><Th>Date</Th><Th>Type</Th><Th>Statut</Th><Th numeric>Jetons</Th><Th numeric>Latence</Th><Th>Validation</Th></tr></thead>
                <tbody>{list.length === 0 ? <tr><td colSpan={6} className="h-16 text-center text-sm text-text-muted">Aucune requête.</td></tr> : list.slice(0, 30).map((r) => <Tr key={r.id}><Td className="text-text-muted">{formatDateTime(r.createdAt)}</Td><Td>{r.kind}</Td><Td><StatusBadge tone={r.status === "succeeded" ? "success" : r.status === "rejected" ? "warning" : r.status === "failed" || r.status === "timeout" ? "danger" : "neutral"}>{r.status}</StatusBadge></Td><Td numeric>{formatNumber(r.promptTokens + r.outputTokens)}</Td><Td numeric>{r.latencyMs} ms</Td><Td className="text-xs text-text-muted">{r.validated ? "Validée" : r.rejectionReason ?? "—"}</Td></Tr>)}</tbody>
              </Table>
            </TableWrap>
          )}
        </QueryBoundary>
      </Card>
    </div>
  );
}
