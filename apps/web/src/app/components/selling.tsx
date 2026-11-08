import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Landmark, Ruler } from "lucide-react";
import { MEASUREMENT_LABELS, type InventoryItem } from "@selio/contracts";
import { checkListing, type PeriodPreset } from "@selio/domain";
import { Card, Money, ProgressBar, StatStrip, StatusBadge, Table, TableWrap, Td, Th, Tr, cn, formatCents, formatPercent } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import type { DeclarationThresholdsView, EndToEndMarginsView } from "../../lib/data/types";
import { DEFAULT_BLUR_THRESHOLD, blurScoreFromUrl } from "../../lib/selling/blur";
import { QueryBoundary } from "./common";

/**
 * Composants des fonctions « que Bleam n'a pas » (§5.14) : seuils de déclaration, marge de bout en bout,
 * contrôle des photos et des mesures. Tout est calculé à partir de vos données ; aucun conseil fiscal.
 */

// ----------------------------------------------------------------- seuils de déclaration

const LEVEL: Record<DeclarationThresholdsView["level"], { label: string; tone: "success" | "warning" | "danger" }> = {
  none: { label: "En dessous des seuils", tone: "success" },
  approaching: { label: "Seuil proche", tone: "warning" },
  reached: { label: "Seuil atteint", tone: "danger" },
};

/** Bandeau factuel des seuils de transmission (30 ventes ou 2 000 € par an) : une information, jamais un conseil fiscal. */
export function ThresholdsBanner({ t }: { t: DeclarationThresholdsView }) {
  if (!t.enabled) return null;
  const level = LEVEL[t.level];
  const body = t.text.replace(t.disclaimer, "").trim();
  return (
    <section aria-label="Seuils de déclaration" className={cn("flex flex-col gap-3 rounded-lg border bg-surface px-4 py-3", t.level === "reached" ? "border-danger/35" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        <Landmark className="size-4 text-text-muted" aria-hidden />
        <h2 className="text-sm font-semibold text-text">Seuils de transmission à l'administration ({t.year})</h2>
        <StatusBadge tone={level.tone}>{level.label}</StatusBadge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="num flex justify-between text-xs text-text-muted"><span>Ventes</span><span>{t.salesThisYear} / {t.thresholds.salesCount}</span></p>
          <ProgressBar value={t.salesThisYear} max={t.thresholds.salesCount} label="Ventes de l'année face au seuil" className="mt-1" />
        </div>
        <div>
          <p className="num flex justify-between text-xs text-text-muted"><span>Montant encaissé</span><span>{formatCents(t.revenueThisYearCents)} / {formatCents(t.thresholds.revenueCents)}</span></p>
          <ProgressBar value={t.revenueThisYearCents} max={t.thresholds.revenueCents} label="Montant encaissé de l'année face au seuil" className="mt-1" />
        </div>
      </div>
      <p className="text-sm text-text-muted">{body}</p>
      <p className="text-xs text-text-muted">{t.disclaimer}</p>
    </section>
  );
}

// ----------------------------------------------------------------- marge de bout en bout

/** Marge de bout en bout : prix d'achat (Radar ou saisi) → revente, réalisée sur la période et projetée sur le stock. */
export function EndToEndMarginCard({ period }: { period: PeriodPreset }) {
  const client = useClient();
  const q = useQuery({ queryKey: ["analytics", "margins", period], queryFn: () => client.getEndToEndMargins(period) });
  return (
    <Card padding="none" role="region" aria-label="Marge de bout en bout">
      <div className="px-4 pt-4 md:px-5">
        <h2 className="text-md font-semibold">Marge de bout en bout (achat → revente)</h2>
        <p className="text-sm text-text-muted">Du prix payé (achat Radar ou saisi dans le stock, port et frais compris) au prix de revente, frais vendeur et coûts déduits.</p>
      </div>
      <div className="px-4 pt-3 pb-4 md:px-5">
        <QueryBoundary query={q}>{(d) => <MarginBody d={d} />}</QueryBoundary>
      </div>
    </Card>
  );
}

function MarginBody({ d }: { d: EndToEndMarginsView }) {
  const rows = d.rows.slice(0, 8);
  return (
    <div className="flex flex-col gap-4">
      <StatStrip
        className="grid-cols-1 sm:grid-cols-3"
        items={[
          { label: "Vendus sur la période (réalisée)", value: <Money cents={d.sold.marginCents} signed />, sub: <>{d.sold.count} vente(s) · {formatPercent(d.sold.marginRate)} du CA · coût {formatCents(d.sold.costCents)}</> },
          { label: "Stock en vente (projetée)", value: <Money cents={d.inStock.marginCents} signed />, sub: <>{d.inStock.pricedCount} article(s) avec prix sur {d.inStock.count}</> },
          { label: "Achats Radar", value: <Money cents={d.radar.marginCents} signed />, sub: <>{d.radar.count} article(s) acheté(s) avec Radar</> },
        ]}
      />
      {rows.length === 0 ? <p className="text-sm text-text-muted">Aucun article ni vente sur la période.</p> : (
        <TableWrap>
          <Table dense>
            <thead><tr><Th>Article</Th><Th>Achat</Th><Th>Marge</Th><Th numeric>Coût</Th><Th numeric>Revente</Th><Th numeric>Marge</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={`${r.itemId}-${r.status}`}>
                  <Td><Link to={`/app/items/${r.itemId}`} className="hover:text-accent">{r.title}</Link></Td>
                  <Td className="text-text-muted">{r.purchaseSource === "radar" ? "Radar" : "Saisi"}</Td>
                  <Td className="text-text-muted">{r.status === "realized" ? "Réalisée" : r.priceKnown ? "Projetée" : "Sans prix"}</Td>
                  <Td numeric><Money cents={r.costCents} /></Td>
                  <Td numeric>{r.priceKnown ? <Money cents={r.revenueCents} /> : "—"}</Td>
                  <Td numeric><Money cents={r.marginCents} signed /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- contrôle des photos et des mesures

/**
 * Scores de netteté des photos, calculés dans le navigateur (canvas) ; null tant qu'ils ne sont pas
 * calculés, ou si la photo ne peut pas être lue (autre domaine sans autorisation).
 */
export function useBlurScores(urls: readonly string[]): (number | null)[] {
  const key = urls.join("|");
  const [scores, setScores] = useState<(number | null)[]>(() => urls.map(() => null));
  useEffect(() => {
    let alive = true;
    setScores(urls.map(() => null));
    void Promise.all(urls.map((u) => blurScoreFromUrl(u))).then((s) => { if (alive) setScores(s); });
    return () => { alive = false; };
  }, [key]);
  return scores;
}

/** Avertissements d'une annonce : photos (nombre, flou, étiquette) et mesures manquantes pour sa catégorie. */
export function ListingChecks({ item, scores, className }: { item: Pick<InventoryItem, "title" | "category" | "description" | "photos">; scores: readonly (number | null)[]; className?: string }) {
  const check = checkListing({ title: item.title, category: item.category, description: item.description, photos: item.photos.map((p) => ({ alt: p.alt })) }, scores);
  const computed = scores.filter((s) => s !== null).length;
  return (
    <section aria-label="Contrôle de l'annonce" className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-md font-semibold">Contrôle de l'annonce</h2>
        <StatusBadge tone={check.ok ? "success" : "warning"}>{check.ok ? "Rien à signaler" : `${check.warnings.length} point(s) à vérifier`}</StatusBadge>
      </div>
      {check.warnings.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {check.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="flex gap-2">
              {w.code === "missing_measurements" ? <Ruler className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <Camera className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
              <span className="text-text">{w.message}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-muted">Photos nettes, étiquette présente et mesures attendues renseignées.</p>}
      <p className="text-xs text-text-muted">
        Netteté calculée dans votre navigateur ({computed}/{item.photos.length} photo(s) analysée(s), seuil {DEFAULT_BLUR_THRESHOLD}). Mesures attendues pour cette catégorie : {check.measurements.required.map((n) => MEASUREMENT_LABELS[n].toLowerCase()).join(", ") || "aucune"}.
      </p>
    </section>
  );
}
