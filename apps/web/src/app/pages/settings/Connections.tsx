import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { CAPABILITY_LABELS, type ExtensionToken, type MarketplaceConnection, type Provider } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Select, StatusBadge, Table, TableWrap, Td, Th, Tr, Tag, formatDateTime, formatRelative, useToast } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { ConnectorStatusBadge, QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

export default function Connections() {
  const client = useClient();
  const session = useRequiredSession();
  const { toast } = useToast();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const descriptors = useQuery({ queryKey: ["connectors"], queryFn: () => client.describeConnectors() });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => client.listExtensionTokens() });
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<Provider>("vinted");
  const [label, setLabel] = useState("");
  const [handle, setHandle] = useState("");
  const [testResult, setTestResult] = useState<{ id: string; message: string; ok: boolean; simulated: boolean } | null>(null);
  const [removing, setRemoving] = useState<MarketplaceConnection | null>(null);
  const [tokenLabel, setTokenLabel] = useState("");
  const [issued, setIssued] = useState<{ token: ExtensionToken; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ExtensionToken | null>(null);
  const inv = ["connections", "overview"];
  const create = useAppMutation(() => client.createConnection({ provider, label: label || (provider === "vinted" ? "Vinted" : "Simulateur"), config: provider === "vinted" ? { displayHandle: handle } : {} }), { invalidate: inv, success: "Connexion créée", onSuccess: () => { setAdding(false); setLabel(""); setHandle(""); } });
  const test = useAppMutation((id: string) => client.testConnection(id), { invalidate: inv, onSuccess: (r, id) => setTestResult({ id, message: r.message, ok: r.ok, simulated: r.simulated }) });
  const sync = useAppMutation((id: string) => client.syncConnection(id), { invalidate: [...inv, "conversations", "nav-counts"], success: (r) => `${r.conversations} conversation(s) synchronisée(s)${r.simulated ? " (simulation)" : ""}` });
  const disconnect = useAppMutation((id: string) => client.disconnectConnection(id), { invalidate: inv, success: "Connexion révoquée" });
  const remove = useAppMutation((id: string) => client.deleteConnection(id), { invalidate: inv, success: "Connexion supprimée", onSuccess: () => setRemoving(null) });
  const createToken = useAppMutation(() => client.createExtensionToken({ label: tokenLabel || "Extension" }), { invalidate: ["tokens"], onSuccess: (r) => { setIssued(r); setTokenLabel(""); } });
  const revoke = useAppMutation((id: string) => client.revokeExtensionToken(id), { invalidate: ["tokens"], success: "Jeton révoqué", onSuccess: () => setRevoking(null) });
  const manage = can(session.role, "connections.manage");
  const canTokens = can(session.role, "tokens.manage");
  const desc = descriptors.data?.find((d) => d.provider === provider);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info" title="Aucun faux OAuth">Vinted n'expose pas d'API publique pour les vendeurs. La connexion Vinted passe par l'extension dans votre navigateur et reste expérimentale tant qu'elle n'a pas été validée en réel. Aucun mot de passe n'est demandé.</Alert>
      <div className="flex items-center justify-between"><h2 className="text-md font-semibold">Connexions</h2>{manage ? <Button icon={<Plus />} onClick={() => setAdding(true)}>Ajouter</Button> : null}</div>
      <QueryBoundary query={connections} empty={(d) => d.length === 0 ? <EmptyState title="Aucune connexion" description="Ajoutez le simulateur de démonstration ou une connexion Vinted via l'extension." /> : null}>
        {(list) => (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((c) => (
              <Card key={c.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="truncate text-md font-semibold">{c.label}</h3><p className="text-xs text-text-muted">{c.provider} · transport : {c.transport === "extension" ? "extension navigateur" : c.transport === "simulator" ? "simulateur" : "serveur"}</p></div>
                  <ConnectorStatusBadge status={c.status} />
                </div>
                <ul className="flex flex-col gap-1 text-xs">
                  {c.capabilities.map((cap) => <li key={cap.capability} className="flex items-center justify-between gap-2"><span>{CAPABILITY_LABELS[cap.capability]}</span><StatusBadge tone={cap.state === "available" ? "success" : cap.state === "experimental" ? "warning" : "muted"}>{cap.state === "available" ? "Disponible" : cap.state === "experimental" ? "Expérimental" : "Indisponible"}</StatusBadge></li>)}
                </ul>
                <p className="text-xs text-text-muted">Dernière synchronisation : {c.lastSyncAt ? formatRelative(c.lastSyncAt) : "jamais"} · dernier test : {c.lastTestAt ? formatRelative(c.lastTestAt) : "jamais"}</p>
                {c.lastError ? <p className="text-xs text-danger">{c.lastError}</p> : null}
                {testResult?.id === c.id ? <Alert tone={testResult.ok ? "success" : "warning"}>{testResult.message}{testResult.simulated ? " (simulation)" : ""}</Alert> : null}
                {manage ? (
                  <div className="mt-auto flex flex-wrap gap-1 border-t border-border pt-3">
                    <Button size="sm" variant="secondary" onClick={() => test.mutate(c.id)} loading={test.isPending && test.variables === c.id}>Tester</Button>
                    <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => sync.mutate(c.id)} loading={sync.isPending && sync.variables === c.id} disabled={c.status !== "connected" && c.status !== "degraded"}>Synchroniser</Button>
                    {c.status !== "disconnected" ? <Button size="sm" variant="ghost" icon={<Unplug />} onClick={() => disconnect.mutate(c.id)}>Révoquer</Button> : null}
                    <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => setRemoving(c)}>Supprimer</Button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>

      <div className="mt-4 flex items-center justify-between"><h2 className="text-md font-semibold">Jetons d'extension</h2></div>
      <Card>
        <p className="text-sm text-text-muted">Un jeton associe l'extension à votre compte avec des droits limités (capture d'articles, lecture des règles, brouillons). Il expire après 90 jours, se révoque ici et se renouvelle en créant un nouveau jeton. Le secret n'est affiché qu'une fois.</p>
        {canTokens ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Nom du jeton" className="flex-1">{(p) => <Input id={p.id} value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} placeholder="Ex. Chrome — PC bureau" />}</Field>
            <Button icon={<KeyRound />} onClick={() => createToken.mutate()} loading={createToken.isPending}>Créer un jeton</Button>
          </div>
        ) : null}
        <QueryBoundary query={tokens}>
          {(list) => list.length === 0 ? <p className="mt-3 text-sm text-text-muted">Aucun jeton.</p> : (
            <TableWrap className="mt-3">
              <Table dense>
                <thead><tr><Th>Nom</Th><Th>Préfixe</Th><Th>Statut</Th><Th className="hide-mobile">Dernier usage</Th><Th className="hide-mobile">Expire</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>{list.map((t) => <Tr key={t.id}><Td className="font-medium">{t.label}</Td><Td className="font-mono text-xs">{t.prefix}…</Td><Td>{t.revokedAt ? <StatusBadge tone="muted">Révoqué</StatusBadge> : new Date(t.expiresAt) < new Date() ? <StatusBadge tone="danger">Expiré</StatusBadge> : <StatusBadge tone="success">Actif</StatusBadge>}</Td><Td className="hide-mobile text-text-muted">{t.lastUsedAt ? formatRelative(t.lastUsedAt) : "jamais"}</Td><Td className="hide-mobile text-text-muted">{formatDateTime(t.expiresAt)}</Td><Td className="text-right">{canTokens && !t.revokedAt ? <Button size="sm" variant="danger" onClick={() => setRevoking(t)}>Révoquer</Button> : null}</Td></Tr>)}</tbody>
              </Table>
            </TableWrap>
          )}
        </QueryBoundary>
      </Card>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Ajouter une connexion" size="md" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Annuler</Button><Button onClick={() => create.mutate()} loading={create.isPending}>Créer</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Service">{(p) => <Select id={p.id} value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>{(descriptors.data ?? []).map((d) => <option key={d.provider} value={d.provider}>{d.label}</option>)}</Select>}</Field>
          {desc ? <p className="text-sm text-text-muted">{desc.description}</p> : null}
          {desc?.experimental ? <Alert tone="warning" title="Expérimental, non vérifié en réel">{desc.verificationNotes.join(" ")}</Alert> : null}
          <Field label="Libellé">{(p) => <Input id={p.id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={desc?.label} />}</Field>
          {desc?.configFields.map((f) => <Field key={f.key} label={f.label} hint={f.help}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={handle} onChange={(e) => setHandle(e.target.value)} />}</Field>)}
          {desc ? <ul className="text-xs text-text-muted">{desc.capabilities.map((c) => <li key={c.capability}>{CAPABILITY_LABELS[c.capability]} : {c.state === "available" ? "disponible" : c.state === "experimental" ? "expérimental" : "indisponible"}{c.note ? ` — ${c.note}` : ""}</li>)}</ul> : null}
        </div>
      </Dialog>
      <Dialog open={issued !== null} onClose={() => setIssued(null)} title="Jeton créé" description="Copiez ce secret maintenant : il ne sera plus affiché." size="sm" footer={<Button onClick={() => setIssued(null)}>J'ai copié le jeton</Button>}>
        {issued ? (
          <div className="flex flex-col gap-2">
            <code className="block rounded-md bg-surface-muted p-3 font-mono text-xs break-all select-all">{issued.secret}</code>
            <Button variant="secondary" size="sm" icon={<Copy />} onClick={() => { void navigator.clipboard?.writeText(issued.secret); toast({ tone: "success", title: "Jeton copié" }); }}>Copier</Button>
            <p className="text-xs text-text-muted">Collez-le dans la page Options de l'extension Selio. Portées : {issued.token.scopes.join(", ")}.</p>
            <Tag>Expire le {formatDateTime(issued.token.expiresAt)}</Tag>
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} loading={remove.isPending} danger title={`Supprimer « ${removing?.label} » ?`} description="Les articles et conversations liés restent, sans connexion associée. Les secrets éventuels sont détruits." confirmLabel="Supprimer" />
      <ConfirmDialog open={revoking !== null} onClose={() => setRevoking(null)} onConfirm={() => revoking && revoke.mutate(revoking.id)} loading={revoke.isPending} danger title={`Révoquer « ${revoking?.label} » ?`} description="L'extension associée perdra immédiatement l'accès. Créez un nouveau jeton pour la réassocier." confirmLabel="Révoquer" />
    </div>
  );
}
