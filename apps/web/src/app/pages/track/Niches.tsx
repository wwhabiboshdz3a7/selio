import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Gauge, Radar, Search } from "lucide-react";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, TRACK_INSUFFICIENT_DATA, TRACK_SCAN_MIN_REFERENCES, TRACK_SCAN_MIN_SOLD, TRACK_SCAN_WEIGHTS, TRACK_SCAN_WINDOW_DAYS, type ItemCategory, type TrackScan, type TrackScanComponents } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, DescriptionList, EmptyState, Field, Input, PageHeader, Select, StatusBadge, buttonClass, formatCents, formatDate, formatNumber } from "@selio/ui";
import { ScoreRing, scoreTextTone } from "../../../components/charts";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { TrackUsageView } from "../../../lib/data/types";
import { errorMessage } from "../../../lib/errors";
import { SCAN_COMPONENT_LABELS } from "../../../lib/track";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { UsageMeter } from "../../components/usage";
import { TRACK_KEYS, TrackGate } from "./shared";

/**
 * Selio Track · scans de niche : une marque et une catégorie notées sur 100 (demande 35 %, vitesse 25 %,
 * concurrence 20 %, marge 20 %), sur les références des 90 derniers jours. Sous le seuil de données,
 * « données insuffisantes » : aucune note, et le scan n'est pas décompté.
 */
export default function TrackNiches() {
  return <TrackGate>{(u) => <Niches usage={u} />}</TrackGate>;
}

const COMPONENT_KEYS = Object.keys(TRACK_SCAN_WEIGHTS) as (keyof TrackScanComponents)[];
const nicheLabel = (s: Pick<TrackScan, "brand" | "category">) => [s.brand, ITEM_CATEGORY_LABELS[s.category]].filter(Boolean).join(" · ");

function Niches({ usage }: { usage: TrackUsageView }) {
  const client = useClient();
  const session = useRequiredSession();
  const canWrite = can(session.role, "radar.write");
  const scans = useQuery({ queryKey: ["track-scans"], queryFn: () => client.trackScans() });
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState<ItemCategory>("men");
  const [result, setResult] = useState<TrackScan | null>(null);
  const run = useAppMutation(() => client.runNicheScan({ brand: brand.trim() || null, category }), {
    invalidate: TRACK_KEYS,
    success: (s) => (s.status === "ok" ? `Niche notée ${s.score}/100` : "Données insuffisantes : scan non décompté"),
    onSuccess: (s) => setResult(s),
  });
  const shown = result ?? scans.data?.[0] ?? null;
  const exhausted = usage.scans.exceeded;
  return (
    <>
      <PageHeader eyebrow="Selio Track" title="Scans de niche" description={`Une marque et une catégorie notées sur 100 à partir des références des ${TRACK_SCAN_WINDOW_DAYS} derniers jours : demande, vitesse de vente, concurrence et marge.`} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-md font-semibold">Scanner une niche</h2>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run.mutate(undefined); }}>
              <Field label="Marque" hint="Facultative : toute la catégorie sinon.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="ex. Ralph Lauren" maxLength={80} />}</Field>
              <Field label="Catégorie">{(p) => <Select id={p.id} value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>{ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{ITEM_CATEGORY_LABELS[c]}</option>)}</Select>}</Field>
              <Button type="submit" variant="accent" icon={<Search />} className="sm:col-span-2" loading={run.isPending} disabled={!canWrite || exhausted}>Scanner</Button>
            </form>
            {run.isError ? <Alert tone="danger" className="mt-3" title={(run.error as { status?: number }).status === 402 ? "Limite de votre offre" : "Scan impossible"}>{errorMessage(run.error)}</Alert> : null}
            {exhausted ? <p className="mt-3 text-xs text-text-muted">Quota du mois atteint : il repart à zéro le 1er du mois.</p> : null}
            <p className="mt-3 text-xs text-text-muted">Il faut au moins {TRACK_SCAN_MIN_REFERENCES} références et {TRACK_SCAN_MIN_SOLD} ventes pour noter une niche ; en dessous, rien n'est décompté.</p>
          </Card>
          <Card><UsageMeter label="Scans de niche du mois" counter={usage.scans} hint="Remis à zéro le 1er du mois." /></Card>
        </div>
        {shown ? <ScanResult scan={shown} /> : <Card className="flex items-center justify-center"><EmptyState icon={<Gauge />} title="Aucun scan pour l'instant" description="Choisissez une marque et une catégorie : la note apparaîtra ici, avec ce qui la compose." /></Card>}
      </div>
      <Card padding="none" className="mt-6">
        <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Historique des scans</h2>
        <QueryBoundary query={scans} empty={(d) => (d.length === 0 ? <p className="px-4 py-4 text-sm text-text-muted md:px-5">Aucun scan enregistré.</p> : null)}>
          {(list) => (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-y border-border text-left">{["Date", "Niche", "Note", "Références", "Statut"].map((h) => <th key={h} className="th-label px-4 py-2.5 first:pl-5">{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} tabIndex={0} onClick={() => setResult(s)} onKeyDown={(e) => { if (e.key === "Enter") setResult(s); }} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted">
                      <td className="num px-4 py-2.5 pl-5 text-text-muted">{formatDate(s.createdAt)}</td>
                      <td className="px-4 py-2.5 font-medium text-text">{nicheLabel(s)}</td>
                      <td className="num px-4 py-2.5 font-semibold" style={s.score !== null ? { color: scoreTextTone(s.score) } : undefined}>{s.score !== null ? `${s.score}/100` : "—"}</td>
                      <td className="num px-4 py-2.5">{formatNumber(s.basedOn.references)}</td>
                      <td className="px-4 py-2.5">{s.status === "ok" ? <StatusBadge tone="success">Noté{s.basedOn.demo ? " (démo)" : ""}</StatusBadge> : <StatusBadge tone="muted">Données insuffisantes</StatusBadge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}

function ScanResult({ scan }: { scan: TrackScan }) {
  const label = nicheLabel(scan);
  const query = `${scan.brand ? `brand=${encodeURIComponent(scan.brand)}&` : ""}category=${scan.category}`;
  return (
    <Card aria-label={`Résultat du scan ${label}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">Scan du {formatDate(scan.createdAt)}</p>
          <h2 className="text-lg font-semibold">{label}</h2>
        </div>
        {scan.basedOn.demo ? <StatusBadge tone="accent">Données de démonstration</StatusBadge> : null}
      </div>
      {scan.status !== "ok" || scan.score === null || !scan.components ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-text">{scan.message ?? TRACK_INSUFFICIENT_DATA}</p>
          <p className="text-sm text-text-muted">{formatNumber(scan.basedOn.references)} référence(s) et {formatNumber(scan.basedOn.sold)} vente(s) sur la période : pas assez pour une note honnête. Ce scan n'a pas été décompté.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
          <div className="flex flex-col items-center gap-1">
            <ScoreRing score={scan.score} size={112} stroke={9} label={`Note de la niche : ${scan.score} sur 100`} />
            <p className="text-xs text-text-muted">sur 100</p>
          </div>
          <ul className="flex flex-col gap-3" aria-label="Composantes de la note">
            {COMPONENT_KEYS.map((k) => (
              <li key={k}>
                <div className="flex items-baseline justify-between gap-2 text-sm"><span className="text-text">{SCAN_COMPONENT_LABELS[k].label} <span className="text-xs text-text-muted">({Math.round(TRACK_SCAN_WEIGHTS[k] * 100)} %)</span></span><span className="num font-semibold">{scan.components![k]}/100</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden><div className="h-full rounded-full bg-accent-vivid" style={{ width: `${scan.components![k]}%` }} /></div>
                <p className="mt-0.5 text-[11px] text-text-muted">{SCAN_COMPONENT_LABELS[k].detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <DescriptionList className="mt-5" columns={2} items={[
        { label: "Délai de vente médian", value: scan.details.medianDaysToSell !== null ? `${scan.details.medianDaysToSell.toLocaleString("fr-FR")} j` : "Inconnu", numeric: true },
        { label: "Annonces actives", value: formatNumber(scan.details.activeListings), numeric: true },
        { label: "Prix de revente médian", value: scan.details.medianResaleCents !== null ? formatCents(scan.details.medianResaleCents) : "—", numeric: true },
        { label: "Prix d'achat médian observé", value: scan.details.medianBuyCents !== null ? formatCents(scan.details.medianBuyCents) : "—", numeric: true },
        { label: "Références", value: formatNumber(scan.basedOn.references), numeric: true },
        { label: "Ventes", value: formatNumber(scan.basedOn.sold), numeric: true },
      ]} />
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to={`/track/filtres?${query}`} className={buttonClass({ variant: "secondary", size: "sm" })}>Suivre cette niche</Link>
        {scan.brand ? <Link to={`/app/radar?${query}`} className={buttonClass({ variant: "ghost", size: "sm" })}><Radar aria-hidden />Chercher des affaires</Link> : null}
      </div>
      <p className="mt-3 text-xs text-text-muted">Une note est un indicateur, pas une promesse de vente. Les ventes vues par Track sont souvent des disparitions d'annonces (vendues ou retirées) : une estimation.</p>
    </Card>
  );
}
