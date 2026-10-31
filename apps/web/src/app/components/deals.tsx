import { Link } from "react-router";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Images, ShoppingCart, Star, Timer } from "lucide-react";
import { ITEM_CONDITION_LABELS, type BuyerFees, type Opportunity } from "@selio/contracts";
import { REVIEW_THRESHOLD, SCORE_BANDS, dealEconomics, scoreBand, type ScoreBand } from "@selio/domain";
import { Button, Card, Tag, buttonClass, cn, formatCents, formatPercent, formatRelative } from "@selio/ui";
import { ScoreRing, scoreTone } from "../../components/charts";
import { useRequiredSession } from "../../lib/data/provider";
import { detectionDelaySeconds, formatDuration } from "../../lib/radar";

/** Bandes de note : neutre → améthyste (bonne) → or (très bonne, exceptionnelle). */
const BAND_CLASS: Record<ScoreBand["key"], string> = {
  weak: "bg-surface-muted text-text-muted",
  fair: "bg-surface-muted text-text-muted",
  good: "bg-accent-soft text-accent",
  great: "bg-gold-soft text-gold-text",
  exceptional: "bg-gold-soft text-gold-text ring-1 ring-gold/40",
};

export function BandBadge({ score, className }: { score: number; className?: string }) {
  const band = scoreBand(score);
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap", BAND_CLASS[band.key], className)}>{band.label}</span>;
}

/** Grille de lecture de la note sur 100 (retours démo : expliquer à partir de quand une affaire est intéressante). */
export function ScoreLegend({ threshold, compact = false, className }: { threshold?: number; compact?: boolean; className?: string }) {
  return (
    <ol className={cn("grid gap-x-3 gap-y-3", compact ? "grid-cols-5" : "sm:grid-cols-5", className)}>
      {SCORE_BANDS.map((b) => {
        const active = threshold !== undefined && threshold >= b.min && threshold <= b.max;
        return (
          <li key={b.key} className={cn("min-w-0 border-l-2 pl-3 sm:border-t-2 sm:border-l-0 sm:pt-2.5 sm:pl-0", compact && "border-t-2 border-l-0 pt-2.5 pl-0")} style={{ borderColor: scoreTone(b.min === 0 ? 40 : b.min) }}>
            <p className="num text-xs text-text-muted">{b.min} – {b.max}</p>
            <p className={cn("mt-0.5 text-sm font-medium", active ? "text-accent" : "text-text")}>{b.label}</p>
            {!compact ? <p className="text-xs text-text-muted">{b.advice}{active ? " · votre seuil" : ""}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

export const SCORE_CRITERIA: { label: string; max: number; detail: string }[] = [
  { label: "Marge estimée", max: 40, detail: "Écart entre l'achat (prix + port + protection acheteurs) et la revente estimée, comparé à votre marge cible." },
  { label: "Taux de marge", max: 15, detail: "Bénéfice rapporté au prix de revente, comparé à votre taux cible." },
  { label: "État et photos", max: 15, detail: "État déclaré par le vendeur et nombre de photos (5 et plus = annonce fiable)." },
  { label: "Marque et demande", max: 15, detail: "Nombre de ventes comparables de la marque dans la catégorie : la preuve que ça se revend." },
  { label: "Fiabilité du vendeur", max: 10, detail: "Note et nombre d'évaluations du vendeur." },
  { label: "Port et délai", max: 5, detail: "Prix du port et fraîcheur de l'annonce (les bonnes affaires partent vite)." },
];

/** Achat (prix + port + protection = total) → revente → bénéfice et marges, calculés et additionnés. */
export function DealMath({ opportunity, fees, className }: { opportunity: Pick<Opportunity, "observed" | "estimate">; fees: BuyerFees; className?: string }) {
  const d = dealEconomics(opportunity.observed, opportunity.estimate.resalePriceCents, fees, opportunity.estimate.expectedFeesCents);
  const row = (label: string, value: string, strong = false, muted = false) => (
    <div className={cn("flex items-baseline justify-between gap-3", muted && "text-text-muted")}>
      <span className={cn("text-sm", strong ? "font-medium text-text" : "text-text-muted")}>{label}</span>
      <span className={cn("num text-sm", strong ? "font-semibold text-text" : "text-text")}>{value}</span>
    </div>
  );
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]", className)}>
      <div className="bg-surface p-3">
        <p className="mb-1.5 text-xs font-medium tracking-wide text-text-muted uppercase">Achat (observé)</p>
        {row("Prix", formatCents(d.itemCents))}
        {row("+ Port", formatCents(d.shippingCents))}
        {row("+ Protection acheteurs", formatCents(d.protectionCents))}
        <div className="my-1.5 border-t border-dashed border-border" />
        {row("= Total à payer", formatCents(d.totalCents), true)}
      </div>
      <div className="bg-surface p-3">
        <p className="mb-1.5 text-xs font-medium tracking-wide text-text-muted uppercase">Vente (estimée)</p>
        {row("Prix de revente", formatCents(d.resaleCents), true)}
        {row("− Frais vendeur", formatCents(d.sellerFeesCents))}
        <p className="mt-1.5 text-xs text-text-muted">Confiance {opportunity.estimate.confidence === "high" ? "élevée" : opportunity.estimate.confidence === "medium" ? "moyenne" : "faible"} · {opportunity.estimate.comparableCount} vente(s) comparable(s)</p>
      </div>
      <div className="bg-surface p-3">
        <p className="mb-1.5 text-xs font-medium tracking-wide text-text-muted uppercase">Bénéfice</p>
        <p className={cn("num text-xl font-semibold tracking-tight", d.profitCents > 0 ? "text-success" : "text-danger")}>{d.profitCents > 0 ? "+" : ""}{formatCents(d.profitCents)}</p>
        <p className="num mt-0.5 text-sm text-text">Marge {formatPercent(d.marginRate)} <span className="text-text-muted">du prix de vente</span></p>
        <p className="num text-sm text-text">Rentabilité {d.roi >= 0 ? "+" : ""}{formatPercent(d.roi)} <span className="text-text-muted">sur l'achat</span></p>
      </div>
    </div>
  );
}

/** Détail de la note par critère (barres). */
export function ScoreBreakdown({ breakdown, reasons }: { breakdown: Opportunity["breakdown"]; reasons: string[] }) {
  if (breakdown.length === 0) return <ul className="list-disc pl-5 text-xs text-text-muted">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {breakdown.map((b, i) => (
        <li key={b.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-2"><span className="text-text">{b.label}</span><span className="num text-xs text-text-muted">{b.points} / {b.max}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-accent-vivid" style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
          {reasons[i] ? <p className="mt-0.5 text-xs text-text-muted">{reasons[i]}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Carte d'une affaire : photo, note, calcul complet, actions ; `to` : page « 1 clic » de l'affaire. */
export function OpportunityCard({ o, canWrite, onBuy, buying, onStatus, compact = false, to }: { o: Opportunity; canWrite: boolean; onBuy: () => void; buying: boolean; onStatus: (s: Opportunity["status"]) => void; compact?: boolean; to?: string }) {
  const session = useRequiredSession();
  const good = o.score >= REVIEW_THRESHOLD;
  const delay = detectionDelaySeconds(o);
  return (
    <Card className="grid gap-4 md:grid-cols-[132px_minmax(0,1fr)]">
      <div className="relative">
        {o.observed.photoUrl ? <img src={o.observed.photoUrl} alt={o.title} className="aspect-square w-full rounded-lg object-cover md:w-[132px]" loading="lazy" /> : <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-surface-muted text-text-subtle md:w-[132px]"><Images className="size-7" aria-hidden /></div>}
        <span className="absolute -top-2 -left-2 rounded-full bg-surface p-0.5 shadow-sm"><ScoreRing score={o.score} size={52} stroke={5} /></span>
        {o.observed.photoCount ? <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] text-white"><Images className="size-3" aria-hidden />{o.observed.photoCount}</span> : null}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-md font-semibold text-text">{to ? <Link to={to} className="hover:underline underline-offset-2">{o.title}</Link> : o.title}</h2>
          <BandBadge score={o.score} />
          {o.status === "purchased" ? <Tag accent><CheckCircle2 className="mr-1 size-3" aria-hidden />Achetée</Tag> : o.status === "watching" ? <Tag>Suivie</Tag> : o.status === "dismissed" ? <Tag>Écartée</Tag> : null}
        </div>
        <p className="mt-0.5 text-sm text-text-muted">{[o.observed.brand, o.observed.size ? `taille ${o.observed.size}` : null, o.observed.condition ? ITEM_CONDITION_LABELS[o.observed.condition] : null].filter(Boolean).join(" · ")}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
          {o.observed.sellerHandle ? <span>Vendeur @{o.observed.sellerHandle}</span> : null}
          {o.observed.sellerRating !== null ? <span className="inline-flex items-center gap-0.5"><Star className="size-3 fill-current text-gold" aria-hidden />{o.observed.sellerRating.toFixed(1).replace(".", ",")} ({o.observed.sellerReviews ?? 0} avis)</span> : null}
          <span>· vue {formatRelative(o.observed.seenAt)}</span>
          {delay !== null ? <span className="num inline-flex items-center gap-0.5"><Timer className="size-3" aria-hidden />repérée {formatDuration(delay)} après publication</span> : null}
        </p>
        <DealMath opportunity={o} fees={session.org.settings.buyerFees} className="mt-3" />
        {!compact ? <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-text-muted hover:text-text">Pourquoi {o.score}/100 ?</summary><div className="mt-2"><ScoreBreakdown breakdown={o.breakdown} reasons={o.reasons} /></div></details> : null}
        {canWrite && o.status !== "purchased" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant={good ? "accent" : "secondary"} icon={<ShoppingCart />} onClick={onBuy} loading={buying}>Valider l'achat</Button>
            {o.status !== "watching" ? <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => onStatus("watching")}>Suivre</Button> : null}
            {o.status !== "dismissed" ? <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={() => onStatus("dismissed")}>Écarter</Button> : <Button size="sm" variant="ghost" onClick={() => onStatus("new")}>Restaurer</Button>}
            {to ? <Link to={to} className={buttonClass({ variant: "ghost", size: "sm" })}>Ouvrir l'affaire<ArrowRight aria-hidden /></Link> : null}
          </div>
        ) : to ? <Link to={to} className={buttonClass({ variant: "ghost", size: "sm", className: "mt-3" })}>Ouvrir l'affaire<ArrowRight aria-hidden /></Link> : null}
      </div>
    </Card>
  );
}
