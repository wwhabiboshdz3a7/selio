import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Receipt } from "lucide-react";
import { PLAN_LABELS, type Invoice } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Card, EmptyState, Table, TableWrap, Td, Th, Tr, formatCents, formatDate } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { CYCLE_LABELS } from "../../../lib/billing";
import { QueryBoundary } from "../../components/common";

/**
 * Paramètres › Factures : une ligne par facture (numéro SEL-AAAA-000001, date, période, montant TTC) ;
 * la vue imprimable est sur /app/settings/invoices/:id. Les factures sont émises par le serveur à
 * chaque paiement confirmé (webhook) : rien n'est produit ici.
 */
export default function Invoices() {
  const client = useClient();
  const session = useRequiredSession();
  const manage = can(session.role, "billing.manage");
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => client.listInvoices(), enabled: manage });
  if (!manage) return <Alert tone="info" title="Factures">Seul le propriétaire de l'organisation peut consulter les factures.</Alert>;
  return (
    <Card padding="none">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 md:px-5">
        <h2 className="text-md font-semibold">Factures</h2>
        <Link to="/app/settings/billing" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Mon abonnement <ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      <p className="px-4 pb-3 text-sm text-text-muted md:px-5">Une facture par paiement confirmé, numérotée dans l'ordre. Ouvrez-en une pour l'imprimer ou l'enregistrer en PDF.</p>
      <QueryBoundary
        query={invoices}
        empty={(rows) => (rows.length === 0 ? <div className="border-t border-border p-4"><EmptyState icon={<Receipt />} title="Aucune facture pour l'instant" description="La première facture est émise au premier paiement : à la fin de l'essai avec la carte enregistrée, ou dès un paiement hors essai." /></div> : null)}
      >
        {(rows: Invoice[]) => (
          <TableWrap className="border-t border-border">
            <Table>
              <thead>
                <tr>
                  <Th>Numéro</Th>
                  <Th>Date</Th>
                  <Th>Offre</Th>
                  <Th>Période</Th>
                  <Th numeric>Montant TTC</Th>
                  <Th><span className="sr-only">Ouvrir</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <Tr key={inv.id}>
                    <Td className="font-medium text-text"><Link to={`/app/settings/invoices/${inv.id}`} className="hover:underline">{inv.number}</Link></Td>
                    <Td>{formatDate(inv.issuedAt)}</Td>
                    <Td>{PLAN_LABELS[inv.plan]} · {CYCLE_LABELS[inv.cycle]}</Td>
                    <Td className="text-text-muted">{formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}</Td>
                    <Td numeric className="num font-medium text-text">{formatCents(inv.amountCents)}</Td>
                    <Td className="text-right"><Link to={`/app/settings/invoices/${inv.id}`} className="text-sm font-medium text-accent hover:underline">Voir</Link></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </QueryBoundary>
    </Card>
  );
}
