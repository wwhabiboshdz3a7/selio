import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ROLES, ROLE_LABELS, type Role } from "@selio/contracts";
import { can } from "@selio/domain";
import { Avatar, Button, Card, ConfirmDialog, Field, Input, Select, Table, TableWrap, Td, Th, Tr, formatDate } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

export default function Members() {
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["members"], queryFn: () => client.listMembers() });
  const [form, setForm] = useState({ email: "", role: "operator" as Role });
  const [removing, setRemoving] = useState<string | null>(null);
  const invite = useAppMutation(() => client.inviteMember(form), { invalidate: ["members"], success: "Invitation enregistrée", onSuccess: () => setForm({ email: "", role: "operator" }) });
  const setRole = useAppMutation(({ id, role }: { id: string; role: Role }) => client.updateMemberRole(id, role), { invalidate: ["members"], success: "Rôle mis à jour" });
  const remove = useAppMutation((id: string) => client.removeMember(id), { invalidate: ["members"], success: "Membre retiré", onSuccess: () => setRemoving(null) });
  const manage = can(session.role, "members.manage");
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Rôles</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="font-medium">Propriétaire</dt><dd className="text-text-muted">Tout, y compris facturation, suppression et achat réel.</dd></div>
          <div><dt className="font-medium">Administrateur</dt><dd className="text-text-muted">Paramètres, membres, connexions, automatisations.</dd></div>
          <div><dt className="font-medium">Opérateur</dt><dd className="text-text-muted">Articles, messages, commandes, IA, radar.</dd></div>
          <div><dt className="font-medium">Lecture seule</dt><dd className="text-text-muted">Consultation uniquement.</dd></div>
        </dl>
      </Card>
      <QueryBoundary query={q}>
        {(members) => (
          <TableWrap>
            <Table>
              <thead><tr><Th>Membre</Th><Th>Rôle</Th><Th className="hide-mobile">Depuis</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <Tr key={m.id}>
                    <Td><span className="flex items-center gap-3"><Avatar name={m.user.displayName} /><span><span className="block font-medium">{m.user.displayName}{m.userId === session.user.id ? " (vous)" : ""}</span><span className="block text-xs text-text-muted">{m.user.email}</span></span></span></Td>
                    <Td>{manage && m.userId !== session.user.id ? <Select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })} aria-label={`Rôle de ${m.user.displayName}`} className="max-w-44">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select> : ROLE_LABELS[m.role]}</Td>
                    <Td className="hide-mobile text-text-muted">{formatDate(m.createdAt)}</Td>
                    <Td className="text-right">{manage && m.userId !== session.user.id ? <Button size="sm" variant="danger" onClick={() => setRemoving(m.id)}>Retirer</Button> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </QueryBoundary>
      {manage ? (
        <Card>
          <h2 className="text-md font-semibold">Inviter un membre</h2>
          <p className="mt-1 text-sm text-text-muted">En mode connecté, un email d'invitation sera envoyé quand le service d'email sera configuré ; en attendant, le compte est créé avec un mot de passe à définir par l'administrateur.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Email" className="flex-1">{(p) => <Input id={p.id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
            <Field label="Rôle">{(p) => <Select id={p.id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>}</Field>
            <Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!form.email}>Inviter</Button>
          </div>
        </Card>
      ) : null}
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)} loading={remove.isPending} danger title="Retirer ce membre ?" description="Il perdra immédiatement l'accès à l'organisation." confirmLabel="Retirer" />
    </div>
  );
}
