import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@selio/ui";
import { QueryBoundary } from "../../components/common";
import { useAutoBuyStatus } from "../../components/radar";
import { AutoBuyBody } from "../AutoBuy";
import { useAutomationSummary } from "../automation/status";
import { PurchaseModes } from "./shared";

/**
 * Selio Bot — « Achat automatique » : les deux façons d'acheter, côte à côte. L'achat rapide (vous validez
 * chaque affaire en 1 clic) est toujours là ; l'achat automatique reste derrière ses deux verrous du serveur,
 * visibles et expliqués, puis ceux de l'organisation (réglage, compte Achat dans le Cloud, accord). Les
 * réglages (note minimale, budget par jour, prix maximum) sont repris tels quels de l'ancien Radar Auto.
 */
export default function BotAutoBuy() {
  const summary = useAutomationSummary();
  const status = useAutoBuyStatus();
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/bot" className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="size-3.5" aria-hidden />Selio Bot</Link>}
        title="Achat automatique"
        description="Soit Selio Bot achète seul, au-dessus d'une note minimale et dans un budget par jour (achat automatique, fermé tant que la validation juridique manque) ; soit il vous propose chaque bonne affaire et vous validez en 1 clic (achat rapide)."
      />
      <QueryBoundary query={summary} skeleton="spinner">{(s) => <PurchaseModes summary={s} />}</QueryBoundary>
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wider text-text uppercase">Achat automatique : verrous, réglages et achats</h2>
      <QueryBoundary query={status} skeleton="spinner">{(st) => <AutoBuyBody status={st} />}</QueryBoundary>
    </>
  );
}
