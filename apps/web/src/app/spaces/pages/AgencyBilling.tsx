import { AGENCY_EXAMPLE_CLIENTS } from "@selio/demo-data";
import { Card, PageHeader, StatusBadge, Table, TableWrap, Td, Th, Tr, formatCents, formatPercent } from "@selio/ui";
import { ExampleTag, PreviewNotice } from "../components";

/** Montant qu'une agence facturerait à un client : forfait mensuel + commission sur le chiffre d'affaires du mois. */
function invoiceCents(c: (typeof AGENCY_EXAMPLE_CLIENTS)[number]): number {
  return c.monthlyFeeCents + Math.round(c.revenueCents * c.commissionRate);
}

const commission = (rate: number) => (rate > 0 ? formatPercent(rate) : "—");

export default function AgencyBilling() {
  const total = AGENCY_EXAMPLE_CLIENTS.reduce((s, c) => s + invoiceCents(c), 0);
  return (
    <>
      <PageHeader
        eyebrow="Selio Agence · Aperçu"
        title="Facturation des clients"
        description="Comment votre agence facturerait ses boutiques clientes : un forfait mensuel, plus une commission sur les ventes si vous le souhaitez. Rien n'est facturé ni encaissé."
      />
      <PreviewNotice space="agence">Tous les montants de cette page sont des exemples fictifs, calculés à partir des boutiques d'exemple. Aucun paiement n'est actif.</PreviewNotice>

      {/* Mobile : une carte par client. */}
      <ul className="flex flex-col gap-3 md:hidden" aria-label="Facturation des clients (exemples)">
        {AGENCY_EXAMPLE_CLIENTS.map((c) => (
          <li key={c.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text">{c.name}</p>
                <p className="mt-1"><ExampleTag /></p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-text-muted">À facturer</p>
                <p className="num text-md font-semibold text-text">{formatCents(invoiceCents(c))}</p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-x-3 border-t border-border pt-3">
              {([["Forfait", formatCents(c.monthlyFeeCents)], ["Commission", commission(c.commissionRate)], ["CA du mois", formatCents(c.revenueCents)]] as const).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[11px] text-text-muted">{label}</dt>
                  <dd className="num truncate text-sm font-medium text-text">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3"><StatusBadge tone="muted">Non facturé · aperçu</StatusBadge></p>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
          <span className="text-sm font-medium text-text">Total du mois (exemple)</span>
          <span className="num text-md font-semibold text-text">{formatCents(total)}</span>
        </li>
      </ul>

      <TableWrap className="hidden md:block">
        <Table className="min-w-[680px]">
          <thead>
            <tr>
              <Th>Client</Th>
              <Th numeric>Forfait mensuel</Th>
              <Th numeric>Commission</Th>
              <Th numeric>CA du mois</Th>
              <Th numeric>À facturer</Th>
              <Th>Statut</Th>
            </tr>
          </thead>
          <tbody>
            {AGENCY_EXAMPLE_CLIENTS.map((c) => (
              <Tr key={c.id}>
                <Td><span className="block font-medium text-text">{c.name}</span><span className="mt-0.5 block"><ExampleTag /></span></Td>
                <Td numeric>{formatCents(c.monthlyFeeCents)}</Td>
                <Td numeric>{commission(c.commissionRate)}</Td>
                <Td numeric>{formatCents(c.revenueCents)}</Td>
                <Td numeric className="font-medium">{formatCents(invoiceCents(c))}</Td>
                <Td><StatusBadge tone="muted">Non facturé · aperçu</StatusBadge></Td>
              </Tr>
            ))}
            <Tr>
              <Td className="font-medium">Total du mois (exemple)</Td>
              <Td /><Td /><Td />
              <Td numeric className="font-semibold">{formatCents(total)}</Td>
              <Td />
            </Tr>
          </tbody>
        </Table>
      </TableWrap>
      <p className="mt-2 text-xs text-text-muted">À facturer = forfait mensuel + commission × chiffre d'affaires du mois.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          { t: "Une facture par client", d: "Au nom et aux couleurs de votre agence, chaque début de mois." },
          { t: "Votre prestataire de paiement", d: "Encaissement par votre propre compte, en mode test d'abord. Selio ne prélève rien pour vous." },
          { t: "Le détail joint", d: "Ventes, marge et note du dressing du client, pour justifier la commission." },
        ].map((x) => (
          <Card key={x.t}>
            <p className="text-sm font-medium text-text">{x.t}</p>
            <p className="mt-1 text-sm text-text-muted">{x.d}</p>
            <p className="mt-3"><StatusBadge tone="neutral">En préparation</StatusBadge></p>
          </Card>
        ))}
      </div>
    </>
  );
}
