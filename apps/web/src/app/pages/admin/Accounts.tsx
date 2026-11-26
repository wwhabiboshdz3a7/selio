import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ORG_QUALIFICATIONS, ORG_QUALIFICATION_LABELS, PLANS, PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, type AdminAccountRow, type AdminAccountsQuery, type OrgQualification, type Plan } from "@selio/contracts";
import { Card, Field, Input, PageHeader, Select, StatusBadge, Table, TableWrap, Td, Th, Tr, formatDate } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { QUALIFICATION_TONES, grantEndLabel } from "../../../lib/admin";
import { QueryBoundary } from "../../components/common";
import { isServerOutdated } from "../../../lib/admin";
import { ServerOutdatedState } from "./AdminLayout";
import { useDebouncedValue } from "../../components/hooks";

const STATUS_FILTERS: { value: NonNullable<AdminAccountsQuery["status"]>; label: string }[] = [
  { value: "trialing", label: "Essai en cours" },
  { value: "active", label: "Actif (payant)" },
  { value: "past_due", label: "Paiement en retard" },
  { value: "granted", label: "Accès offert" },
  { value: "canceled", label: "Résilié / accès de base" },
  { value: "beta", label: "Bêta en cours" },
  { value: "beta_blocked", label: "Bêta terminée (bloqué)" },
];

/** Statut lisible d'un compte : accès offert, essai (avec sa fin), ou l'état de l'abonnement. */
export function AccountStatus({ a }: { a: Pick<AdminAccountRow, "status" | "grantedUntil" | "currentPeriodEnd" | "awaitingPaymentSince" | "betaEndsAt" | "betaBlocked"> }) {
  // Bêta (code BETA2026SELIO) : fin du mois, ou blocage faute de moyen de paiement (prolonger débloque).
  if (a.betaBlocked) return <StatusBadge tone="danger">Bêta terminée · bloqué</StatusBadge>;
  if (a.betaEndsAt && !a.grantedUntil) return <StatusBadge tone="accent">Bêta · fin {formatDate(a.betaEndsAt)}</StatusBadge>;
  // Essai terminé pendant que le paiement n'était pas activé : à relancer (prolonger l'essai ou offrir l'accès).
  if (a.status === "canceled" && a.awaitingPaymentSince && !a.grantedUntil) return <StatusBadge tone="warning">En attente du paiement</StatusBadge>;
  if (a.grantedUntil) return <StatusBadge tone="success">Offert · {grantEndLabel(a.grantedUntil, (d) => `jusqu'au ${formatDate(d)}`)}</StatusBadge>;
  if (a.status === "trialing") return <StatusBadge tone="accent">Essai{a.currentPeriodEnd ? ` · fin ${formatDate(a.currentPeriodEnd)}` : ""}</StatusBadge>;
  const tone = a.status === "active" ? "success" : a.status === "past_due" ? "warning" : "muted";
  return <StatusBadge tone={tone}>{SUBSCRIPTION_STATUS_LABELS[a.status] ?? a.status}</StatusBadge>;
}

/**
 * Selio Admin › Comptes : tous les comptes (organisations) inscrits, cherchables par nom ou email du titulaire,
 * filtrables par qualification, plan et statut. Chaque ligne ouvre la fiche du compte.
 */
export default function AdminAccounts() {
  const client = useClient();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const debounced = useDebouncedValue(search, 250);
  const qualification = (params.get("qualification") ?? "") as OrgQualification | "";
  const plan = (params.get("plan") ?? "") as Plan | "";
  const status = (params.get("status") ?? "") as AdminAccountsQuery["status"] | "";
  const query: AdminAccountsQuery = { ...(debounced ? { q: debounced } : {}), ...(qualification ? { qualification } : {}), ...(plan ? { plan } : {}), ...(status ? { status } : {}) };
  const q = useQuery({ queryKey: ["admin-accounts", query], queryFn: () => client.adminListAccounts(query) });
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader eyebrow="Selio Admin" title="Comptes" description="Les comptes inscrits sur Selio : qualification, plan, essai ou accès offert. Ouvrez une fiche pour qualifier un compte, offrir un accès, prolonger un essai ou lire son historique." />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Rechercher">{(p) => <Input id={p.id} type="search" value={search} onChange={(e) => setParam("q", e.target.value)} placeholder="Nom, email du titulaire…" />}</Field>
          <Field label="Qualification">{(p) => (
            <Select id={p.id} value={qualification} onChange={(e) => setParam("qualification", e.target.value)}>
              <option value="">Toutes</option>
              {ORG_QUALIFICATIONS.map((x) => <option key={x} value={x}>{ORG_QUALIFICATION_LABELS[x]}</option>)}
            </Select>
          )}</Field>
          <Field label="Plan">{(p) => (
            <Select id={p.id} value={plan} onChange={(e) => setParam("plan", e.target.value)}>
              <option value="">Tous</option>
              {PLANS.map((x) => <option key={x} value={x}>{PLAN_LABELS[x]}</option>)}
            </Select>
          )}</Field>
          <Field label="Statut">{(p) => (
            <Select id={p.id} value={status} onChange={(e) => setParam("status", e.target.value)}>
              <option value="">Tous</option>
              {STATUS_FILTERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
          )}</Field>
        </div>
      </Card>
      {q.isError && isServerOutdated(q.error) ? <ServerOutdatedState /> : <QueryBoundary query={q}>
        {(rows) => (
          <Card padding="none">
            <p className="px-4 pt-4 text-sm text-text-muted md:px-5" aria-live="polite">{rows.length} compte{rows.length > 1 ? "s" : ""}</p>
            <TableWrap className="mt-3 rounded-none border-0 border-t">
              <Table stack dense>
                <thead><tr><Th>Compte</Th><Th>Qualification</Th><Th>Plan</Th><Th>Statut</Th><Th numeric className="hide-mobile">Membres</Th><Th className="hide-mobile">Inscrit</Th></tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={6} className="h-16 text-center text-sm text-text-muted">Aucun compte ne correspond à ces filtres.</td></tr> : rows.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Link to={`/admin/comptes/${encodeURIComponent(a.id)}`} className="font-medium text-text hover:text-accent hover:underline">{a.name}</Link>
                        <span className="block truncate text-xs text-text-muted">{a.ownerEmail ?? "—"}</span>
                      </Td>
                      <Td><StatusBadge tone={QUALIFICATION_TONES[a.qualification]}>{ORG_QUALIFICATION_LABELS[a.qualification]}</StatusBadge></Td>
                      <Td>{PLAN_LABELS[a.plan]}</Td>
                      <Td><AccountStatus a={a} /></Td>
                      <Td numeric className="hide-mobile">{a.members}</Td>
                      <Td className="hide-mobile text-text-muted">{formatDate(a.createdAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        )}
      </QueryBoundary>}
    </>
  );
}
