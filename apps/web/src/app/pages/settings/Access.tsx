import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Eye, Lock, Minus } from "lucide-react";
import { ROLES, ROLE_LABELS, type Role } from "@selio/contracts";
import { ACTIONS, ACTION_LABELS, PERMISSION_GROUPS, ROLES_BY_RANK, actionsUnlockedAt, baseRoleOf, can, canAssignRole, type Action } from "@selio/domain";
import { Alert, Avatar, Button, Card, ConfirmDialog, Field, Input, PageHeader, Select, Table, TableWrap, Tag, Td, Th, Tr, cn, formatDate } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { AdminTabs } from "../admin-tabs";

/** À qui s'adresse chaque rôle, en une phrase, et ce qu'il fait au quotidien. */
export const ROLE_GUIDE: Record<Role, { forWhom: string; summary: string }> = {
  owner: { forWhom: "Pour vous, titulaire du compte", summary: "Tout, y compris l'abonnement, l'achat réel et la suppression définitive." },
  admin: { forWhom: "Pour un associé ou un bras droit", summary: "Règle Selio pour l'équipe : réglages, membres, comptes connectés, automatisations, exports." },
  operator: { forWhom: "Pour quelqu'un qui publie, répond aux messages et expédie", summary: "Le travail du quotidien : articles, messages, commandes, IA, radar. Ne voit pas les finances et ne touche ni aux réglages ni aux membres." },
  photographer: { forWhom: "Pour la personne qui prend les photos", summary: "Ajoute des photos aux articles et lance le générateur d'annonces. Rien d'autre : ni messages, ni commandes, ni finances." },
  viewer: { forWhom: "Pour votre comptable ou un observateur", summary: "Consulte articles, ventes, analyses et finances, sans rien modifier ni envoyer." },
};

const label = (a: Action) => ACTION_LABELS[a] ?? a;
const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.actions));
const GROUPS = [...PERMISSION_GROUPS, ...(ACTIONS.some((a) => !grouped.has(a)) ? [{ title: "Autres actions", actions: ACTIONS.filter((a) => !grouped.has(a)) }] : [])];

export default function Access() {
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["members"], queryFn: () => client.listMembers() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => client.getUsage() });
  const [form, setForm] = useState({ email: "", role: "operator" as Role });
  const [removing, setRemoving] = useState<string | null>(null);
  const invite = useAppMutation(() => client.inviteMember(form), { invalidate: ["members", "usage"], success: "Invitation enregistrée", onSuccess: () => setForm({ email: "", role: "operator" }) });
  const setRole = useAppMutation(({ id, role }: { id: string; role: Role }) => client.updateMemberRole(id, role), { invalidate: ["members"], success: "Rôle mis à jour" });
  const remove = useAppMutation((id: string) => client.removeMember(id), { invalidate: ["members", "usage"], success: "Membre retiré", onSuccess: () => setRemoving(null) });
  const manage = can(session.role, "members.manage");
  const isOwner = session.role === "owner";
  // Même règle que le serveur : le titulaire attribue tous les rôles, un administrateur tous sauf titulaire.
  const assignable = ROLES.filter((r) => canAssignRole(session.role, r));
  // Le titulaire ne s'attribue jamais par invitation (on invite, puis on change le rôle).
  const invitable = ROLES.filter((r) => r !== "owner" && canAssignRole(session.role, r));
  // Même page dans Paramètres et dans Opérateur › Administration (en-tête et onglets propres à l'administration).
  const inAdmin = useLocation().pathname.startsWith("/admin");

  return (
    <div className="flex flex-col gap-4">
      {inAdmin ? <div><PageHeader eyebrow="Opérateur" title="Administration" description="Les comptes et accès de l'équipe : qui est membre, avec quel rôle, et ce que chaque rôle permet. Les mêmes réglages restent dans Paramètres › Comptes et accès." /><AdminTabs /></div> : null}
      <Card>
        <h2 className="text-md font-semibold">Qui accède à Selio</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Chaque personne a son propre identifiant et un rôle dans l'organisation. Le rôle décide de ce qu'elle peut voir et faire ; ses actions sont tracées dans le <Link to="/app/settings/security" className="font-medium text-accent hover:underline">journal d'audit</Link>. Ces accès concernent l'application : vos comptes Vinted se gèrent dans <Link to="/app/accounts" className="font-medium text-accent hover:underline">Comptes Vinted</Link>.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {ROLES_BY_RANK.map((r) => {
            const unlocked = actionsUnlockedAt(r);
            // Rôle de base : celui dont toutes les actions sont comprises (aucun pour les rôles « latéraux »).
            const below = baseRoleOf(r);
            const total = ACTIONS.filter((a) => can(r, a)).length;
            const mine = r === session.role;
            return (
              <li key={r} className={cn("rounded-lg border p-3", mine ? "border-accent/50 bg-accent-soft/40" : "border-border")}>
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">{ROLE_LABELS[r]}{mine ? <Tag accent>Votre rôle</Tag> : null}<span className="num ml-auto text-xs font-normal text-text-muted">{total} / {ACTIONS.length} actions</span></p>
                <p className="mt-0.5 text-sm font-medium text-accent">{ROLE_GUIDE[r].forWhom}</p>
                <p className="mt-1 text-sm text-text-muted">{ROLE_GUIDE[r].summary}</p>
                <p className="mt-2 text-xs text-text-muted"><span className="font-medium text-text">{below ? `Tout ce que fait « ${ROLE_LABELS[below]} », et :` : "Peut :"}</span> {unlocked.map((a) => { const l = label(a); return l.charAt(0).toLowerCase() + l.slice(1); }).join(" ; ")}.</p>
                {!can(r, "finances.read") ? <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted"><Lock className="size-3 shrink-0" aria-hidden />Ne voit pas les finances.</p> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card data-testid="finance-roles">
        <h2 className="flex items-center gap-2 text-md font-semibold"><Lock className="size-4 text-text-muted" aria-hidden />L'exécuteur ne voit pas les finances</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">L'exécuteur publie les annonces, répond aux acheteurs et expédie les commandes, mais ne voit ni le chiffre d'affaires, ni les marges, ni les prix d'achat, ni l'abonnement et les factures : ces montants sont masqués dans l'application et retirés des réponses du serveur. Les prix affichés sur Vinted (prix de vente, prix affiché) restent visibles, car il en a besoin pour répondre. Le contributeur photos ne les voit pas non plus. Votre comptable, en lecture seule, voit les finances sans rien pouvoir modifier.</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {ROLES_BY_RANK.map((r) => <li key={r} className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-text-muted"><span className="font-medium text-text">{ROLE_LABELS[r]}</span>{can(r, "finances.read") ? "voit les finances" : "finances masquées"}</li>)}
        </ul>
      </Card>

      <PermissionMatrix current={session.role} />

      <RolePreviewCard />

      <Card padding="none">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 md:px-5">
          <h2 className="text-md font-semibold">Membres</h2>
          {usage.data ? <span className="num text-xs text-text-muted">{usage.data.membersCount} sur {usage.data.quotas.members} avec votre plan</span> : null}
        </div>
        <QueryBoundary query={q}>
          {(members) => (
            <TableWrap className="relative mt-3 rounded-none border-0 border-t">
              <Table>
                <thead><tr><Th>Membre</Th><Th>Rôle</Th><Th className="hide-mobile">Depuis</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody>
                  {members.map((m) => {
                    const self = m.userId === session.user.id;
                    const editableRow = manage && !self && (m.role !== "owner" || isOwner);
                    return (
                      <Tr key={m.id}>
                        <Td><span className="flex items-center gap-3"><Avatar name={m.user.displayName} /><span className="min-w-0"><span className="block truncate font-medium">{m.user.displayName}{self ? " (vous)" : ""}</span><span className="block truncate text-xs text-text-muted">{m.user.email}</span></span></span></Td>
                        <Td>{editableRow ? <Select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })} aria-label={`Rôle de ${m.user.displayName}`} className="max-w-44">{assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select> : ROLE_LABELS[m.role]}</Td>
                        <Td className="hide-mobile text-text-muted">{formatDate(m.createdAt)}</Td>
                        <Td className="text-right">{editableRow ? <Button size="sm" variant="danger" onClick={() => setRemoving(m.id)}>Retirer</Button> : null}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </QueryBoundary>
      </Card>

      {manage ? (
        <Card>
          <h2 className="text-md font-semibold">Inviter un membre</h2>
          <p className="mt-1 text-sm text-text-muted">En mode connecté, un email d'invitation sera envoyé quand le service d'email sera configuré ; en attendant, le compte est créé avec un mot de passe à définir par l'administrateur.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Email" className="flex-1">{(p) => <Input id={p.id} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
            <Field label="Rôle">{(p) => <Select id={p.id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{invitable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>}</Field>
            <Button onClick={() => invite.mutate(undefined)} loading={invite.isPending} disabled={!form.email}>Inviter</Button>
          </div>
          <p className="mt-2 text-sm text-text-muted"><span className="font-medium text-text">{ROLE_LABELS[form.role]} :</span> {ROLE_GUIDE[form.role].summary}</p>
        </Card>
      ) : <Alert tone="info">Seuls le titulaire et les administrateurs peuvent inviter, retirer ou changer le rôle d'un membre.</Alert>}

      <Card>
        <h2 className="text-md font-semibold">Règles de sécurité</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted">
          <li>Le rôle titulaire ne s'attribue pas par invitation : invitez la personne, puis nommez-la titulaire.</li>
          <li>Seul un titulaire peut nommer, changer ou retirer un titulaire.</li>
          <li>Les rôles s'appliquent dans l'application et sur le serveur : un rôle sans un droit ne peut pas faire l'action, même par l'API.</li>
          <li>Personne ne peut retirer son propre accès ni abaisser son propre rôle.</li>
          <li>Un membre retiré perd l'accès immédiatement : ses sessions ouvertes sont fermées.</li>
        </ul>
      </Card>

      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)} loading={remove.isPending} danger title="Retirer ce membre ?" description="Il perdra immédiatement l'accès à l'organisation." confirmLabel="Retirer" />
    </div>
  );
}

/**
 * Démonstration seulement : voir l'application avec un autre rôle (menus, montants masqués, vue réduite du
 * contributeur photos). Les règles de ce rôle s'appliquent aussi aux actions de la démo.
 */
function RolePreviewCard() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const [role, setRole] = useState<Role>("operator");
  const preview = useAppMutation((r: Role | null) => client.previewRole!(r), { invalidate: ["session"], success: (s) => `Vous voyez Selio comme « ${ROLE_LABELS[s.role]} »` });
  if (mode !== "demo" || !client.previewRole) return null;
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-md font-semibold"><Eye className="size-4 text-text-muted" aria-hidden />Essayer un rôle (démonstration)</h2>
      <p className="mt-1 max-w-2xl text-sm text-text-muted">Voyez l'application comme un membre de l'équipe : menu, montants masqués, vue réduite du contributeur photos. Un bandeau permet de revenir à votre rôle à tout moment.</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Voir comme">{(p) => <Select id={p.id} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES_BY_RANK.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>}</Field>
        <Button variant="secondary" onClick={() => preview.mutate(role)} loading={preview.isPending} disabled={role === session.role}>Voir comme ce rôle</Button>
      </div>
    </Card>
  );
}

/** Matrice « qui peut faire quoi », générée depuis la table des permissions du domaine (can()). */
function PermissionMatrix({ current }: { current: Role }) {
  const [focus, setFocus] = useState<Role>(current);
  return (
    <Card padding="none">
      <div className="px-4 pt-4 md:px-5">
        <h2 className="text-md font-semibold">Qui peut faire quoi</h2>
        <p className="mt-1 text-sm text-text-muted">Ce tableau est produit à partir des permissions que le serveur applique à chaque action : il ne peut pas les contredire.</p>
        <Field label="Rôle affiché" className="mt-3 sm:hidden">{(p) => <Select id={p.id} value={focus} onChange={(e) => setFocus(e.target.value as Role)}>{ROLES_BY_RANK.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}{r === current ? " (votre rôle)" : ""}</option>)}</Select>}</Field>
      </div>
      <TableWrap className="relative mt-3 rounded-none border-0 border-t">
        <Table dense className="max-sm:min-w-0">
          <thead>
            <tr>
              <Th>Action</Th>
              {ROLES_BY_RANK.map((r) => <Th key={r} className={cn("w-24 text-center", r !== focus && "max-sm:hidden", r === current && "text-accent")}>{ROLE_LABELS[r]}</Th>)}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <MatrixGroup key={g.title} title={g.title} actions={g.actions} focus={focus} current={current} />
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function MatrixGroup({ title, actions, focus, current }: { title: string; actions: Action[]; focus: Role; current: Role }) {
  return (
    <>
      <tr><th scope="rowgroup" colSpan={ROLES_BY_RANK.length + 1} className="bg-surface-muted/60 px-3 py-1.5 text-left text-xs font-medium tracking-wide text-text-muted uppercase md:px-4">{title}</th></tr>
      {actions.map((a) => (
        <Tr key={a}>
          <Td className="text-sm">{label(a)}</Td>
          {ROLES_BY_RANK.map((r) => {
            const ok = can(r, a);
            return (
              <Td key={r} className={cn("text-center", r !== focus && "max-sm:hidden", r === current && "bg-accent-soft/30")}>
                {ok ? <Check className="mx-auto size-4 text-success" aria-label="Autorisé" /> : <Minus className="mx-auto size-4 text-text-subtle" aria-label="Non autorisé" />}
              </Td>
            );
          })}
        </Tr>
      ))}
    </>
  );
}
