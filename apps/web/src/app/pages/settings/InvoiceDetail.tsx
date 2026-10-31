import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { VAT_FRANCHISE_NOTICE, invoiceAmounts, type InvoiceView } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, formatCents, formatDate } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { invoiceIssuer, type InvoiceIssuerConfig } from "../../../lib/env";
import { QueryBoundary } from "../../components/common";

const MISSING_LABELS: Record<InvoiceIssuerConfig["missing"][number], string> = { address: "adresse", siren: "SIREN", vatNumber: "numéro de TVA", email: "email de contact" };

/**
 * Vue imprimable d'une facture (window.print) : mentions de l'émetteur lues dans la configuration
 * (« à compléter » tant qu'elles manquent), client, numéro, date, désignation, HT / TVA / TTC ou
 * mention de franchise. À l'impression, seule la feuille s'imprime, en noir sur blanc (styles.css).
 */
export default function InvoiceDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const manage = can(session.role, "billing.manage");
  const q = useQuery({ queryKey: ["invoice", id], queryFn: () => client.getInvoice(id), enabled: manage && id !== "" });
  if (!manage) return <Alert tone="info" title="Factures">Seul le propriétaire de l'organisation peut consulter les factures.</Alert>;
  const issuer = invoiceIssuer();
  return (
    <div className="flex flex-col gap-4">
      <div className="print-hidden flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/settings/invoices" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"><ArrowLeft className="size-4" aria-hidden />Toutes les factures</Link>
        <Button size="sm" variant="secondary" onClick={() => window.print()} disabled={!q.data}><Printer />Imprimer ou enregistrer en PDF</Button>
      </div>
      {issuer.missing.length ? (
        <Alert tone="warning" className="print-hidden" title="Mentions de l'émetteur à compléter">
          {issuer.missing.map((m) => MISSING_LABELS[m]).join(", ")} : à renseigner dans la configuration du site (variables VITE_INVOICE_ISSUER_*) avant d'envoyer une facture à un client.
        </Alert>
      ) : null}
      <QueryBoundary query={q} skeleton="spinner">
        {(view) => <InvoiceSheet view={view} issuer={issuer} />}
      </QueryBoundary>
    </div>
  );
}

export function InvoiceSheet({ view, issuer }: { view: InvoiceView; issuer: InvoiceIssuerConfig }) {
  const { invoice, totals } = view;
  const franchise = totals.vatRate === 0;
  const vatNotice = invoice.vatNotice ?? view.issuer.vatNotice ?? (franchise ? VAT_FRANCHISE_NOTICE : null);
  return (
    <article className="invoice-sheet rounded-lg border border-border bg-surface p-5 text-sm text-text md:p-10" aria-labelledby="invoice-title">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-2xl font-semibold tracking-[-0.02em]">{issuer.name}</p>
          <address className="mt-2 text-sm text-text-muted not-italic">
            {issuer.addressLines.map((l) => <span key={l} className="block">{l}</span>)}
            <span className="block">SIREN : {issuer.siren}</span>
            <span className="block">TVA intracommunautaire : {issuer.vatNumber}</span>
            <span className="block">{issuer.email}</span>
          </address>
        </div>
        <div className="text-right">
          <h2 id="invoice-title" className="text-xl font-semibold">Facture <span className="num">{invoice.number}</span></h2>
          <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-text-muted">Date d'émission</dt><dd className="num">{formatDate(invoice.issuedAt, "long")}</dd>
            <dt className="text-text-muted">Paiement</dt><dd>{view.paymentProvider === "revolut" ? "Carte bancaire via Revolut" : "Manuel"}</dd>
            {invoice.orderId ? <><dt className="text-text-muted">Référence</dt><dd className="num break-all">{invoice.orderId}</dd></> : null}
          </dl>
        </div>
      </header>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wider text-text-muted uppercase">Facturé à</p>
          <p className="mt-1 text-base font-semibold">{view.customer.orgName}</p>
          {view.customer.email ? <p className="text-text-muted">{view.customer.email}</p> : null}
        </div>
        <div>
          <p className="text-xs font-medium tracking-wider text-text-muted uppercase">Période couverte</p>
          <p className="mt-1 num">{formatDate(invoice.periodStart, "long")} → {formatDate(invoice.periodEnd, "long")}</p>
        </div>
      </section>

      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium tracking-wider text-text-muted uppercase">
            <th className="py-2 pr-3 font-medium">Désignation</th>
            <th className="num py-2 pr-3 text-right font-medium">Montant HT</th>
            <th className="num py-2 pr-3 text-right font-medium">TVA</th>
            <th className="num py-2 text-right font-medium">Montant TTC</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((line, i) => {
            const a = invoiceAmounts(line.amountCents, totals.vatRate);
            return (
              <tr key={i} className="border-b border-border align-top">
                <td className="py-3 pr-3">
                  <p className="font-medium text-text">{line.label}</p>
                  <p className="text-text-muted">{line.periodLabel}</p>
                </td>
                <td className="num py-3 pr-3 text-right">{formatCents(a.exclVatCents)}</td>
                <td className="num py-3 pr-3 text-right">{franchise ? "—" : formatCents(a.vatCents)}</td>
                <td className="num py-3 text-right">{formatCents(a.inclVatCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="mt-4 ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-text-muted">Total HT</dt><dd className="num text-right">{formatCents(totals.exclVatCents)}</dd>
        <dt className="text-text-muted">{franchise ? "TVA" : `TVA ${totals.vatRate.toLocaleString("fr-FR")} %`}</dt><dd className="num text-right">{franchise ? formatCents(0) : formatCents(totals.vatCents)}</dd>
        <dt className="border-t border-border pt-2 text-base font-semibold">Total TTC</dt><dd className="num border-t border-border pt-2 text-right text-base font-semibold">{formatCents(totals.inclVatCents)}</dd>
      </dl>

      <footer className="mt-8 space-y-1 border-t border-border pt-4 text-xs text-text-muted">
        {vatNotice ? <p className="font-medium text-text">{vatNotice}</p> : null}
        <p>Facture acquittée le {formatDate(invoice.issuedAt, "long")}{view.paymentProvider === "revolut" ? " par carte bancaire via Revolut" : ""}. Les frais du prestataire de paiement restent à la charge de {issuer.name} et ne sont jamais refacturés.</p>
        <p>{issuer.name} — {issuer.addressLines.join(", ")} — SIREN {issuer.siren}. Document généré par Selio ; contact : {issuer.email}.</p>
      </footer>
    </article>
  );
}
