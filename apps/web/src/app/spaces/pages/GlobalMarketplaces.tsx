import { Link } from "react-router";
import { PageHeader, StatusBadge, cn } from "@selio/ui";
import { MARKETPLACES } from "../global-data";
import { PreviewNotice } from "../components";

export default function GlobalMarketplaces() {
  return (
    <>
      <PageHeader
        eyebrow="Selio Global · En préparation"
        title="Places de marché"
        description="Vinted aujourd'hui. Ensuite, dans cet ordre : Leboncoin, eBay, Etsy et Shopify — le même stock, les mêmes règles, les mêmes annonces de Studio."
      />
      <PreviewNotice space="global">Aucun connecteur n'existe encore en dehors de Vinted. Selio n'annonce rien qui ne soit construit et testé.</PreviewNotice>

      <ol className="flex flex-col gap-3" aria-label="Places de marché, dans l'ordre prévu">
        {MARKETPLACES.map((m, i) => {
          const active = m.state === "active";
          return (
            <li key={m.id} className={cn("card flex flex-col gap-3 p-4 sm:flex-row sm:items-start md:p-5", !active && "bg-surface")} aria-labelledby={`place-${m.id}`}>
              <span className={cn("num inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", active ? "bg-accent text-accent-on" : "bg-surface-muted text-text-muted")} aria-hidden>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`place-${m.id}`} className="text-md font-semibold text-text">{m.name}</h2>
                  <StatusBadge tone={active ? "success" : "neutral"}>{active ? "Actif" : "Prévu"}</StatusBadge>
                  <span className="text-sm text-text-muted">{m.kind}</span>
                </div>
                <p className="mt-1.5 text-sm text-text">{m.value}</p>
                <p className="mt-1 text-xs text-text-muted">{m.note}</p>
                {active ? <p className="mt-2 text-sm"><Link to="/app/accounts" className="font-medium text-accent hover:underline">Vos comptes Vinted →</Link></p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
