import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Plus, RefreshCw } from "lucide-react";
import { JOB_STATUSES, JOB_STATUS_LABELS, RULE_KINDS, RULE_KIND_LABELS, type AutomationRule, type AutomationRuleCreate, type Job, type JobStatus, type RuleKind } from "@selio/contracts";
import { RULE_RUN_LOCATION } from "@selio/domain";
import { Alert, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, Field, Input, PageHeader, Pagination, Select, Table, TableEmpty, TableWrap, Tabs, Td, Th, Toggle, Tr, Tag, Textarea, formatDateTime, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { JobStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function Automations() {
  const client = useClient();
  const session = useRequiredSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "rules" | "jobs") ?? "rules";
  const state = useQuery({ queryKey: ["automation-state"], queryFn: () => client.getAutomationState() });
  const pause = useAppMutation((p: boolean) => client.setGlobalPause(p), { invalidate: ["automation-state", "overview", "rules"], success: (s) => (s.globalPaused ? "Arrêt global activé" : "Automatisations reprises") });
  const [confirmPause, setConfirmPause] = useState(false);
  const canWrite = session.role === "owner" || session.role === "admin";
  return (
    <>
      <PageHeader title="Automatisations" description="Règles explicites, horaires, limites et file de tâches visible. Les actions sensibles attendent votre validation par défaut." actions={state.data ? (state.data.globalPaused ? <Button variant="secondary" icon={<Play />} onClick={() => pause.mutate(false)} loading={pause.isPending} disabled={!canWrite}>Reprendre</Button> : <Button variant="danger" icon={<Pause />} onClick={() => setConfirmPause(true)} disabled={!canWrite}>Arrêt global</Button>) : null} />
      {state.data?.globalPaused ? <Alert tone="warning" title="Arrêt global actif" className="mb-4">Aucune règle ne s'exécute depuis le {state.data.pausedAt ? formatDateTime(state.data.pausedAt) : "—"}. Les tâches en attente restent visibles.</Alert> : null}
      <Alert tone="info" className="mb-4" title="Où s'exécutent les règles">Les actions qui lisent ou écrivent sur Vinted passent par l'extension et exigent un navigateur ouvert : elles ne sont jamais promises 24 h/24. Les calculs (décision de négociation, baisse de prix dans Selio) tournent sur le serveur.</Alert>
      <Tabs ariaLabel="Sections" value={tab} onChange={(t) => { const p = new URLSearchParams(params); p.set("tab", t); setParams(p, { replace: true }); }} items={[{ value: "rules", label: "Règles" }, { value: "jobs", label: "File et historique" }]} className="mb-4" />
      {tab === "rules" ? <Rules canWrite={canWrite} /> : <Jobs canWrite={session.role !== "viewer"} />}
      <ConfirmDialog open={confirmPause} onClose={() => setConfirmPause(false)} onConfirm={() => { pause.mutate(true); setConfirmPause(false); }} title="Activer l'arrêt global ?" description="Toutes les règles cessent de déclencher des actions jusqu'à la reprise. Les tâches en cours terminent proprement." confirmLabel="Arrêter" danger />
    </>
  );
}

function Rules({ canWrite }: { canWrite: boolean }) {
  const client = useClient();
  const q = useQuery({ queryKey: ["rules"], queryFn: () => client.listRules() });
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const [runResult, setRunResult] = useState<{ name: string; evaluated: number; created: number; skipped: { reason: string; count: number }[] } | null>(null);
  const [del, setDel] = useState<AutomationRule | null>(null);
  const toggle = useAppMutation(({ id, enabled }: { id: string; enabled: boolean }) => client.updateRule(id, { enabled }), { invalidate: ["rules", "overview"] });
  const run = useAppMutation((r: AutomationRule) => client.runRuleNow(r.id).then((res) => ({ ...res, name: r.name })), { invalidate: ["rules", "jobs", "overview", "nav-counts", "conversations", "conversation", "items"], onSuccess: (r) => setRunResult(r) });
  const remove = useAppMutation((id: string) => client.deleteRule(id), { invalidate: ["rules"], success: "Règle supprimée", onSuccess: () => setDel(null) });
  return (
    <>
      <div className="mb-3 flex justify-end">{canWrite ? <Button icon={<Plus />} onClick={() => setEditing("new")}>Nouvelle règle</Button> : null}</div>
      <QueryBoundary query={q} empty={(d) => d.length === 0 ? <EmptyState title="Aucune règle" description="Créez une règle pour automatiser une relance ou une baisse de prix." action={canWrite ? <Button icon={<Plus />} onClick={() => setEditing("new")}>Nouvelle règle</Button> : undefined} /> : null}>
        {(rules) => (
          <div className="grid gap-4 md:grid-cols-2">
            {rules.map((r) => {
              const loc = RULE_RUN_LOCATION[r.kind];
              return (
                <Card key={r.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-md font-semibold">{r.name}</h2>
                      <p className="text-xs text-text-muted">{RULE_KIND_LABELS[r.kind]}</p>
                    </div>
                    <Toggle label={<span className="sr-only">Activer {r.name}</span>} checked={r.enabled} onChange={(v) => toggle.mutate({ id: r.id, enabled: v })} disabled={!canWrite} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Tag>{loc.location === "browser" ? "Navigateur (extension)" : "Serveur"}</Tag>
                    <Tag>{r.requiresApproval ? "Validation requise" : "Auto"}</Tag>
                    <Tag>{r.schedule.days.length === 7 ? "Tous les jours" : r.schedule.days.map((d) => DAYS[d]).join(" ")} · {r.schedule.startHour}h–{r.schedule.endHour}h</Tag>
                    <Tag>{r.limits.maxPerDay}/jour · {r.limits.maxPerCustomerPerDay}/acheteur</Tag>
                  </div>
                  <p className="text-xs text-text-muted">{loc.explanation}</p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-muted">
                    <span>{r.lastRunAt ? `Dernière exécution ${formatRelative(r.lastRunAt)}` : "Jamais exécutée"}</span>
                    <span className="flex gap-1">
                      <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => run.mutate(r)} loading={run.isPending && run.variables?.id === r.id} disabled={!canWrite}>Exécuter maintenant</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} disabled={!canWrite}>Modifier</Button>
                      <Button size="sm" variant="danger" onClick={() => setDel(r)} disabled={!canWrite}>Supprimer</Button>
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </QueryBoundary>
      {editing ? <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <Dialog open={runResult !== null} onClose={() => setRunResult(null)} title="Résultat de l'exécution" size="sm" footer={<Button onClick={() => setRunResult(null)}>Fermer</Button>}>
        {runResult ? (
          <div className="text-sm">
            <p><span className="font-medium">{runResult.name}</span> : {runResult.evaluated} cible(s) évaluée(s), {runResult.created} tâche(s) créée(s).</p>
            {runResult.skipped.length ? <ul className="mt-2 list-disc pl-5 text-text-muted">{runResult.skipped.map((s) => <li key={s.reason}>{s.reason} : {s.count}</li>)}</ul> : null}
            <p className="mt-3 text-xs text-text-muted">Les tâches créées avec validation requise apparaissent dans « File et historique » avec le statut « À valider ».</p>
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} danger title={`Supprimer « ${del?.name} » ?`} description="Les tâches déjà exécutées restent dans l'historique." confirmLabel="Supprimer" />
    </>
  );
}

function RuleDialog({ rule, onClose }: { rule: AutomationRule | null; onClose: () => void }) {
  const client = useClient();
  const [form, setForm] = useState<AutomationRuleCreate>(rule ? { name: rule.name, kind: rule.kind, enabled: rule.enabled, requiresApproval: rule.requiresApproval, runsIn: rule.runsIn, schedule: rule.schedule, limits: rule.limits, config: rule.config } : { name: "", kind: "follow_up_no_reply", enabled: false, requiresApproval: true, runsIn: "browser", schedule: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 19, timezone: "Europe/Paris" }, limits: { maxPerDay: 20, maxPerCustomerPerDay: 1, minMinutesBetweenActions: 5 }, config: { template: "Bonjour {{prenom}}, l'article {{article}} est toujours disponible.", delayHours: 48, staleDays: 45, dropRate: 0.05 } });
  const save = useAppMutation(() => (rule ? client.updateRule(rule.id, form) : client.createRule(form)), { invalidate: ["rules"], success: rule ? "Règle enregistrée" : "Règle créée", onSuccess: onClose });
  const sched = form.schedule!;
  const days = sched.days ?? [];
  const limits = form.limits!;
  const cfg = form.config!;
  const kind = form.kind;
  const loc = RULE_RUN_LOCATION[kind];
  return (
    <Dialog open onClose={onClose} title={rule ? "Modifier la règle" : "Nouvelle règle"} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()}>{rule ? "Enregistrer" : "Créer"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" required className="sm:col-span-2">{(p) => <Input id={p.id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Type">{(p) => <Select id={p.id} value={kind} onChange={(e) => { const k = e.target.value as RuleKind; setForm({ ...form, kind: k, runsIn: RULE_RUN_LOCATION[k].location }); }}>{RULE_KINDS.map((k) => <option key={k} value={k}>{RULE_KIND_LABELS[k]}</option>)}</Select>}</Field>
        <div className="flex flex-col justify-end gap-2 text-xs text-text-muted"><Tag>{loc.location === "browser" ? "S'exécute dans le navigateur (extension)" : "S'exécute sur le serveur"}</Tag><span>{loc.explanation}</span></div>
        {kind === "reply_on_new_message" || kind === "follow_up_no_reply" || kind === "post_sale_message" ? <Field label="Gabarit du message" hint="Variables : {{prenom}}, {{article}}. Texte brut uniquement." className="sm:col-span-2">{(p) => <Textarea id={p.id} aria-describedby={p.describedBy} rows={3} value={cfg.template ?? ""} onChange={(e) => setForm({ ...form, config: { ...cfg, template: e.target.value } })} />}</Field> : null}
        {kind === "follow_up_no_reply" ? <Field label="Délai sans réponse (heures)">{(p) => <Input id={p.id} type="number" min={1} max={720} value={cfg.delayHours ?? 48} onChange={(e) => setForm({ ...form, config: { ...cfg, delayHours: Number(e.target.value) } })} />}</Field> : null}
        {kind === "price_drop_stale" || kind === "relist_stale" ? <Field label="Article dormant après (jours)">{(p) => <Input id={p.id} type="number" min={1} max={365} value={cfg.staleDays ?? 45} onChange={(e) => setForm({ ...form, config: { ...cfg, staleDays: Number(e.target.value) } })} />}</Field> : null}
        {kind === "price_drop_stale" ? <Field label="Baisse (%)" hint="Jamais sous le prix plancher.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} type="number" min={1} max={50} value={Math.round((cfg.dropRate ?? 0.05) * 100)} onChange={(e) => setForm({ ...form, config: { ...cfg, dropRate: Number(e.target.value) / 100 } })} />}</Field> : null}
        {kind === "auto_negotiate" ? <p className="text-sm text-text-muted sm:col-span-2">La décision (accepter, contre-proposer, refuser, escalader) suit les règles de marge de l'organisation (Paramètres › Organisation). L'IA ne fait que rédiger.</p> : null}
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">Jours actifs</legend>
          <div className="mt-2 flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} label={d} checked={days.includes(i)} onChange={(e) => setForm({ ...form, schedule: { ...sched, days: e.target.checked ? [...days, i] : days.filter((x) => x !== i) } })} />)}</div>
        </fieldset>
        <Field label="Heure de début">{(p) => <Input id={p.id} type="number" min={0} max={23} value={sched.startHour} onChange={(e) => setForm({ ...form, schedule: { ...sched, startHour: Number(e.target.value) } })} />}</Field>
        <Field label="Heure de fin">{(p) => <Input id={p.id} type="number" min={1} max={24} value={sched.endHour} onChange={(e) => setForm({ ...form, schedule: { ...sched, endHour: Number(e.target.value) } })} />}</Field>
        <Field label="Max par jour">{(p) => <Input id={p.id} type="number" min={0} max={1000} value={limits.maxPerDay} onChange={(e) => setForm({ ...form, limits: { ...limits, maxPerDay: Number(e.target.value) } })} />}</Field>
        <Field label="Max par acheteur et par jour">{(p) => <Input id={p.id} type="number" min={0} max={50} value={limits.maxPerCustomerPerDay} onChange={(e) => setForm({ ...form, limits: { ...limits, maxPerCustomerPerDay: Number(e.target.value) } })} />}</Field>
        <Field label="Délai minimal entre deux actions (min)">{(p) => <Input id={p.id} type="number" min={0} max={1440} value={limits.minMinutesBetweenActions} onChange={(e) => setForm({ ...form, limits: { ...limits, minMinutesBetweenActions: Number(e.target.value) } })} />}</Field>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Toggle label="Validation humaine avant exécution" description="Recommandé. Les tâches attendent votre accord dans la file." checked={form.requiresApproval ?? true} onChange={(v) => setForm({ ...form, requiresApproval: v })} />
          <Toggle label="Règle activée" checked={form.enabled ?? false} onChange={(v) => setForm({ ...form, enabled: v })} />
        </div>
      </div>
    </Dialog>
  );
}

function Jobs({ canWrite }: { canWrite: boolean }) {
  const client = useClient();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as JobStatus) || undefined;
  const page = Number(params.get("page") ?? 1);
  const q = useQuery({ queryKey: ["jobs", { status, page }], queryFn: () => client.listJobs({ status, page, pageSize: 25 }), refetchInterval: 15_000 });
  const inv = ["jobs", "overview", "nav-counts", "conversations", "conversation", "items"];
  const approve = useAppMutation((id: string) => client.approveJob(id), { invalidate: inv, success: (j) => (j.status === "succeeded" ? "Tâche exécutée" : j.status === "failed" ? "Tâche en échec" : "Tâche relancée") });
  const cancel = useAppMutation((id: string) => client.cancelJob(id), { invalidate: inv, success: "Tâche annulée" });
  const retry = useAppMutation((id: string) => client.retryJob(id), { invalidate: inv, success: (j) => (j.status === "succeeded" ? "Nouvelle tentative réussie" : "Nouvelle tentative en échec") });
  const [detail, setDetail] = useState<Job | null>(null);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== "page") p.delete("page"); setParams(p, { replace: true }); };
  return (
    <>
      <div className="mb-3 max-w-xs"><Select value={status ?? ""} onChange={(e) => set("status", e.target.value)} aria-label="Statut"><option value="">Tous les statuts</option>{JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}</Select></div>
      <QueryBoundary query={q} empty={(d) => d.total === 0 ? <EmptyState title="Aucune tâche" description="Les tâches apparaissent quand une règle s'exécute." /> : null}>
        {(d) => (
          <>
            <TableWrap>
              <Table dense>
                <thead><tr><Th>Tâche</Th><Th>Statut</Th><Th className="hide-mobile">Exécution</Th><Th numeric>Tentatives</Th><Th>Planifiée</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>
                  {d.items.length === 0 ? <TableEmpty colSpan={6}>Aucune tâche pour ce filtre.</TableEmpty> : d.items.map((j) => (
                    <Tr key={j.id} interactive tabIndex={0} onClick={() => setDetail(j)} onKeyDown={(e) => { if (e.key === "Enter") setDetail(j); }}>
                      <Td><span className="block font-medium">{String(j.payload.ruleName ?? j.kind)}</span><span className="block truncate text-xs text-text-muted">{j.kind} · {j.dedupeKey}</span></Td>
                      <Td><JobStatusBadge status={j.status} />{j.error ? <span className="mt-0.5 block max-w-[220px] truncate text-xs text-danger">{j.error}</span> : null}</Td>
                      <Td className="hide-mobile"><Tag>{j.runsIn === "browser" ? "Navigateur" : "Serveur"}</Tag></Td>
                      <Td numeric>{j.attempts}/{j.maxAttempts}</Td>
                      <Td className="text-text-muted">{formatDateTime(j.scheduledFor)}</Td>
                      <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {canWrite && j.status === "awaiting_approval" ? <span className="inline-flex gap-1"><Button size="sm" onClick={() => approve.mutate(j.id)} loading={approve.isPending && approve.variables === j.id}>Valider</Button><Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}>Refuser</Button></span> : null}
                        {canWrite && j.status === "failed" ? <Button size="sm" variant="secondary" onClick={() => retry.mutate(j.id)} loading={retry.isPending && retry.variables === j.id}>Réessayer</Button> : null}
                        {canWrite && j.status === "queued" ? <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}>Annuler</Button> : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination className="mt-3" page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} onPageChange={(p) => set("page", String(p))} />
          </>
        )}
      </QueryBoundary>
      <Dialog open={detail !== null} onClose={() => setDetail(null)} title="Détail de la tâche" size="md" footer={<Button onClick={() => setDetail(null)}>Fermer</Button>}>
        {detail ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><JobStatusBadge status={detail.status} /><Tag>{detail.kind}</Tag><Tag>{detail.runsIn === "browser" ? "Navigateur" : "Serveur"}</Tag></div>
            <p className="text-xs text-text-muted">Clé d'idempotence : <code className="font-mono">{detail.dedupeKey}</code></p>
            {detail.error ? <Alert tone="danger" title="Erreur">{detail.error}</Alert> : null}
            {typeof detail.payload.body === "string" ? <div><p className="text-xs font-medium text-text-muted">Message prévu</p><p className="mt-1 rounded-md bg-surface-muted p-3 whitespace-pre-line">{detail.payload.body}</p></div> : null}
            {Array.isArray(detail.payload.reasons) ? <div><p className="text-xs font-medium text-text-muted">Justification</p><ul className="mt-1 list-disc pl-5 text-text-muted">{(detail.payload.reasons as string[]).map((r, i) => <li key={i}>{r}</li>)}</ul></div> : null}
            {detail.result ? <div><p className="text-xs font-medium text-text-muted">Résultat</p><pre className="mt-1 overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs">{JSON.stringify(detail.result, null, 2)}</pre></div> : null}
            <p className="text-xs text-text-muted">Créée {formatDateTime(detail.createdAt)}{detail.finishedAt ? ` · terminée ${formatDateTime(detail.finishedAt)}` : ""}</p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
