import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Field, Input, Table, TableWrap, Td, Th, Tr, formatDateTime } from "@selio/ui";
import { useClient, useData } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

export default function Security() {
  const client = useClient();
  const { mode } = useData();
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => client.listAuditLogs(50) });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const change = useAppMutation(() => client.changePassword({ current: pw.current, next: pw.next }), { success: mode === "demo" ? "Changement simulé (démonstration)" : "Mot de passe modifié", onSuccess: () => setPw({ current: "", next: "", confirm: "" }) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 10) return setErr("Dix caractères minimum.");
    if (pw.next !== pw.confirm) return setErr("La confirmation ne correspond pas.");
    setErr(null);
    change.mutate();
  };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Mot de passe</h2>
        <form onSubmit={submit} className="mt-3 flex max-w-sm flex-col gap-3" noValidate>
          <Field label="Mot de passe actuel">{(p) => <Input id={p.id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
          <Field label="Nouveau mot de passe" hint="Dix caractères minimum.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
          <Field label="Confirmation" error={err}>{(p) => <Input id={p.id} invalid={p.invalid} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
          <div><Button type="submit" loading={change.isPending}>Modifier</Button></div>
        </form>
      </Card>
      <Card>
        <h2 className="text-md font-semibold">Principes appliqués</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-text-muted">
          <li>Session par cookie HttpOnly, SameSite strict, expiration glissante ; mots de passe hachés (scrypt).</li>
          <li>Isolation par organisation vérifiée côté serveur et par politiques de sécurité par ligne en base.</li>
          <li>Secrets de connexion chiffrés avec une clé hors base ; jamais dans le navigateur, les journaux ou Git.</li>
          <li>Limitation de débit sur l'authentification et les endpoints sensibles ; validation stricte des entrées.</li>
          <li>Messages acheteurs traités comme données non fiables (nettoyage, détection d'injection, échappement).</li>
        </ul>
        <Alert tone="info" className="mt-3">L'authentification à deux facteurs n'est pas encore disponible.</Alert>
      </Card>
      <Card padding="none">
        <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Journal d'audit</h2>
        <QueryBoundary query={audit}>
          {(list) => (
            <TableWrap className="mt-3 rounded-none border-0 border-t">
              <Table dense>
                <thead><tr><Th>Date</Th><Th>Action</Th><Th className="hide-mobile">Cible</Th><Th className="hide-mobile">Détails</Th></tr></thead>
                <tbody>{list.length === 0 ? <tr><td colSpan={4} className="h-16 text-center text-sm text-text-muted">Aucune entrée.</td></tr> : list.map((a) => <Tr key={a.id}><Td className="text-text-muted">{formatDateTime(a.createdAt)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="hide-mobile text-xs text-text-muted">{a.targetType ? `${a.targetType} ${a.targetId?.slice(0, 8) ?? ""}` : "—"}</Td><Td className="hide-mobile max-w-xs truncate text-xs text-text-muted">{JSON.stringify(a.meta)}</Td></Tr>)}</tbody>
              </Table>
            </TableWrap>
          )}
        </QueryBoundary>
      </Card>
    </div>
  );
}
