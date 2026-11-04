import { Link } from "react-router";
import { Scale } from "lucide-react";
import { TRACK_SELLER_ANALYSIS_NOTICE } from "@selio/contracts";
import { Card, IconTile, PageHeader, StatusBadge, buttonClass } from "@selio/ui";
import { TrackGate } from "./shared";

/**
 * Selio Track · analyse d'un vendeur concurrent (Agence) : À VALIDER JURIDIQUEMENT (RGPD). Rien n'est
 * construit au-delà de cet écran d'explication : aucun pseudo n'est lu, cherché ni gardé.
 */
export default function TrackSellers() {
  return <TrackGate agency={{ title: "Vendeurs concurrents" }}>{() => <Sellers />}</TrackGate>;
}

function Sellers() {
  return (
    <>
      <PageHeader eyebrow="Selio Track · Agence" title="Vendeurs concurrents" description="L'analyse d'un vendeur concurrent n'est pas disponible." />
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <IconTile icon={<Scale />} size={44} />
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-md font-semibold">À valider juridiquement (RGPD)</h2><StatusBadge tone="warning">Indisponible</StatusBadge></div>
            <p className="mt-1 text-sm text-text">{TRACK_SELLER_ANALYSIS_NOTICE}</p>
          </div>
        </div>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-muted">
          <li>Un pseudo et l'activité d'un vendeur sont des données personnelles : leur analyse demande une base légale et un avis de l'avocat.</li>
          <li>Tant que cet avis n'est pas rendu, Selio ne lit, ne cherche et ne garde aucun pseudo de vendeur.</li>
          <li>Track reste utile sans cela : statistiques par marque et catégorie, scans de niche et flux des ventes, sans aucun vendeur.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link to="/track/ventes" className={buttonClass({ variant: "secondary" })}>Voir le flux des ventes</Link>
          <Link to="/track/niches" className={buttonClass({ variant: "ghost" })}>Scanner une niche</Link>
        </div>
      </Card>
    </>
  );
}
