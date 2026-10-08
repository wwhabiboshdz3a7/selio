import { useQuery } from "@tanstack/react-query";
import { PLAN_LABELS, type Plan } from "@selio/contracts";
import { Alert, Card, KpiCard, PageHeader, Select, StatusBadge, Table, TableWrap, Td, Th, Tr, formatDate, formatDateTime, formatNumber } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import { QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Admin() {
  const client = useClient();
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => client.getAdminOverview(), refetchInterval: 30_000 });
  const audit = useQuery({ queryKey: ["admin-audit"], queryFn: () => client.adminListAudit(50) });
  const setPlan = useAppMutation(({ orgId, plan }: { orgId: string; plan: Plan }) => client.adminSetPlan(orgId, plan), { invalidate: ["admin-overview", "subscription", "usage"], success: "Plan mis à jour (action journalisée)" });
  return (
    <>
      <PageHeader title="Administration opérateur" description="Santé des services, files, connecteurs, consommation IA, plans et quotas. Aucun secret n'est affiché ici ; toutes les actions sont journalisées." />
      <QueryBoundary query={q}>
        {(d) => (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Requêtes IA · 24 h" value={formatNumber(d.ai.requests24h)} hint={`${d.ai.failures24h} échec(s) · ${formatNumber(d.ai.tokens24h)} jetons`} />
              <KpiCard label="Tâches en échec" value={formatNumber(d.queues.reduce((s, x) => s + x.failed, 0))} hint="Toutes files confondues" />
              <KpiCard label="Organisations" value={formatNumber(d.orgs.length)} />
              <KpiCard label="Services en défaut" value={formatNumber(d.services.filter((s) => !s.ok).length)} hint={`${d.services.length} surveillés`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-3 text-md font-semibold">Santé des services</h2>
                <ul className="divide-y divide-border">{d.services.map((s) => <li key={s.name} className="flex items-center justify-between gap-2 py-2 text-sm"><span><span className="block font-medium">{s.name}</span><span className="block text-xs text-text-muted">{s.message}</span></span><StatusBadge tone={s.ok ? "success" : s.status === "experimental" ? "warning" : "danger"}>{s.status}</StatusBadge></li>)}</ul>
              </Card>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Files de tâches</h2>
                <TableWrap className="rounded-md"><Table dense><thead><tr><Th>File</Th><Th numeric>Attente</Th><Th numeric>Actives</Th><Th numeric>Échecs</Th><Th numeric>Terminées</Th><Th>État</Th></tr></thead><tbody>{d.queues.map((qu) => <Tr key={qu.name}><Td className="font-mono text-xs">{qu.name}</Td><Td numeric>{qu.waiting}</Td><Td numeric>{qu.active}</Td><Td numeric>{qu.failed}</Td><Td numeric>{qu.completed}</Td><Td><StatusBadge tone={qu.paused ? "warning" : "success"}>{qu.paused ? "En pause" : "Active"}</StatusBadge></Td></Tr>)}</tbody></Table></TableWrap>
              </Card>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Connecteurs</h2>
                <ul className="divide-y divide-border">{d.connectors.map((c) => <li key={c.provider} className="flex items-center justify-between py-2 text-sm"><span className="font-medium">{c.provider}</span><span className="text-xs text-text-muted">{c.connections} connexion(s) · {Object.entries(c.byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}</span></li>)}</ul>
              </Card>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Assistant IA</h2>
                <p className="text-sm"><StatusBadge tone={d.ai.status.status === "healthy" ? "success" : d.ai.status.status === "mock" ? "accent" : "danger"}>{d.ai.status.status}</StatusBadge> <span className="text-text-muted">{d.ai.status.provider} · {d.ai.status.model}</span></p>
                <p className="mt-1 text-xs text-text-muted">File {d.ai.status.queue.pending} / {d.ai.status.queue.running} en cours · disjoncteur {d.ai.status.circuit.state}</p>
                <ul className="mt-3 divide-y divide-border text-sm">{d.ai.byOrg.map((o) => <li key={o.orgId} className="flex justify-between py-2"><span>{o.orgName}</span><span className="num text-text-muted">{o.requests} req. / 24 h</span></li>)}</ul>
              </Card>
            </div>
            <Card padding="none">
              <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Organisations et plans</h2>
              <TableWrap className="mt-3 rounded-none border-0 border-t"><Table dense><thead><tr><Th>Organisation</Th><Th>Plan</Th><Th numeric>Membres</Th><Th numeric>Articles</Th><Th className="hide-mobile">Créée</Th></tr></thead><tbody>{d.orgs.map((o) => <Tr key={o.id}><Td className="font-medium">{o.name}</Td><Td><Select value={o.plan} onChange={(e) => setPlan.mutate({ orgId: o.id, plan: e.target.value as Plan })} aria-label={`Plan de ${o.name}`} className="max-w-40">{d.plans.map((p) => <option key={p.plan} value={p.plan}>{PLAN_LABELS[p.plan]}</option>)}</Select></Td><Td numeric>{o.members}</Td><Td numeric>{o.items}</Td><Td className="hide-mobile text-text-muted">{formatDate(o.createdAt)}</Td></Tr>)}</tbody></Table></TableWrap>
            </Card>
            <Card padding="none">
              <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Quotas par plan</h2>
              <TableWrap className="mt-3 rounded-none border-0 border-t"><Table dense><thead><tr><Th>Plan</Th><Th numeric>Articles</Th><Th numeric>IA / mois</Th><Th numeric>Actions / jour</Th><Th numeric>Connexions</Th><Th numeric>Membres</Th><Th numeric>Organisations</Th></tr></thead><tbody>{d.plans.map((p) => <Tr key={p.plan}><Td className="font-medium">{PLAN_LABELS[p.plan]}</Td><Td numeric>{formatNumber(p.quotas.items)}</Td><Td numeric>{formatNumber(p.quotas.aiRequestsPerMonth)}</Td><Td numeric>{formatNumber(p.quotas.automationActionsPerDay)}</Td><Td numeric>{p.quotas.connections}</Td><Td numeric>{p.quotas.members}</Td><Td numeric>{p.orgCount}</Td></Tr>)}</tbody></Table></TableWrap>
            </Card>
            <Card>
              <h2 className="mb-3 text-md font-semibold">Dernières erreurs</h2>
              {d.errors.length === 0 ? <p className="text-sm text-text-muted">Aucune erreur récente.</p> : <ul className="divide-y divide-border text-sm">{d.errors.map((e, i) => <li key={i} className="py-2"><span className="block">{e.message}</span><span className="text-xs text-text-muted">{formatDateTime(e.at)} · {e.source}</span></li>)}</ul>}
            </Card>
            <Card padding="none">
              <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Journal des actions sensibles</h2>
              <QueryBoundary query={audit}>{(list) => <TableWrap className="mt-3 rounded-none border-0 border-t"><Table dense><thead><tr><Th>Date</Th><Th>Action</Th><Th className="hide-mobile">Cible</Th></tr></thead><tbody>{list.length === 0 ? <tr><td colSpan={3} className="h-16 text-center text-sm text-text-muted">Aucune entrée.</td></tr> : list.map((a) => <Tr key={a.id}><Td className="text-text-muted">{formatDateTime(a.createdAt)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="hide-mobile text-xs text-text-muted">{a.targetType ?? "—"}</Td></Tr>)}</tbody></Table></TableWrap>}</QueryBoundary>
            </Card>
            <Alert tone="info">Les secrets (clés de chiffrement, jetons, mots de passe) ne sont jamais consultables depuis cette page, ni depuis l'API.</Alert>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
