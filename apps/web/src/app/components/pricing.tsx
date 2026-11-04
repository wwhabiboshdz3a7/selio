import type { ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Info, Sparkles } from "lucide-react";
import { PRICE_METHOD_LABELS, PRICE_MODEL_MIN_REFERENCES, PRICE_MODEL_RETRAIN_DAYS, PRICE_STRATEGY_LABELS, type PriceEstimate, type PriceEstimateInput, type PriceModelStatus, type PriceStrategies } from "@selio/contracts";
import { Button, Card, DescriptionList, StatusBadge, cn, formatCents, formatDate, formatNumber, formatPercent } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import type { PricingModelView } from "../../lib/data/types";
import { QueryBoundary } from "./common";
import { CONFIDENCE_LABELS, formatDelayDays, hasPrice, modelStatusView } from "../../lib/track";
import { useDebouncedValue } from "./hooks";

/**
 * Prix conseillés (§5.10) : fourchette P25 / P50 / P75, trois stratégies, méthode, confiance, délai et
 * explication en mots par mon IA perso. Le prix vient de l'estimation (comparables et modèle de prix) ;
 * mon IA perso l'explique seulement, elle ne le choisit jamais (D07). Rien n'est présenté comme mesuré
 * sans mesure : « modèle non entraîné » et « données de démonstration » sont affichés tels quels.
 */

const STRATEGY_KEYS = ["fast", "standard", "max"] as const;
const STRATEGY_HINTS: Record<(typeof STRATEGY_KEYS)[number], string> = { fast: "Quart bas (P25)", standard: "Médiane (P50)", max: "Quart haut (P75)" };

/** État du modèle de prix en une pastille (« Modèle non entraîné », « Données de démonstration »…). */
export function ModelStatusBadge({ status, className }: { status: PriceModelStatus | null | undefined; className?: string }) {
  const v = modelStatusView(status);
  return <StatusBadge tone={v.tone} className={className}>{v.label}{v.measuredError !== null ? ` · erreur ${Math.round(v.measuredError * 100)} %` : ""}</StatusBadge>;
}

/** Fourchette P25 – P75 avec la médiane. */
export function PriceRange({ p25, p50, p75, className }: { p25: number; p50: number; p75: number; className?: string }) {
  const span = Math.max(1, p75 - p25);
  const mid = Math.min(100, Math.max(0, ((p50 - p25) / span) * 100));
  return (
    <div className={className}>
      <div className="relative h-2 rounded-full bg-surface-muted" aria-hidden>
        <div className="absolute inset-y-0 right-[8%] left-[8%] rounded-full bg-accent-vivid/35" />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent-vivid" style={{ left: `${8 + mid * 0.84}%` }} />
      </div>
      <p className="num mt-1.5 flex justify-between text-xs text-text-muted">
        <span>P25 <span className="font-medium text-text">{formatCents(p25)}</span></span>
        <span>P50 <span className="font-medium text-text">{formatCents(p50)}</span></span>
        <span>P75 <span className="font-medium text-text">{formatCents(p75)}</span></span>
      </p>
    </div>
  );
}

/**
 * Les trois stratégies (vente rapide, standard, marge maximale) dans une seule carte découpée par des
 * filets ; « Appliquer » facultatif (désactivé sous le plancher).
 */
export function StrategyStrip({ values, onApply, applying, floorCents, current, disabled, className }: {
  values: PriceStrategies;
  onApply?: (cents: number, key: keyof PriceStrategies) => void;
  applying?: keyof PriceStrategies | null;
  /** Prix plancher : une stratégie en dessous ne s'applique pas. */
  floorCents?: number | null;
  /** Prix actuel (repéré « actuel »). */
  current?: number | null;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ul aria-label="Trois stratégies de prix" className={cn("grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3", className)}>
      {STRATEGY_KEYS.map((k) => {
        const cents = values[k];
        const belowFloor = floorCents != null && cents < floorCents;
        return (
          <li key={k} className="flex min-w-0 flex-col gap-0.5 bg-surface p-3" aria-label={`${PRICE_STRATEGY_LABELS[k]} : ${formatCents(cents)}`}>
            <span className="text-xs text-text-muted">{PRICE_STRATEGY_LABELS[k]}</span>
            <span className="num text-lg font-semibold text-text">{formatCents(cents)}</span>
            <span className="text-[11px] text-text-muted">{STRATEGY_HINTS[k]}{current === cents ? " · prix actuel" : ""}</span>
            {belowFloor ? <span className="text-[11px] text-warning">Sous votre prix plancher</span> : null}
            {onApply ? (
              <Button size="sm" variant={k === "standard" ? "primary" : "secondary"} className="mt-2" onClick={() => onApply(cents, k)} loading={applying === k} disabled={disabled || belowFloor || current === cents} aria-label={`Appliquer ${PRICE_STRATEGY_LABELS[k].toLowerCase()} (${formatCents(cents)})`}>
                Appliquer
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Explication en mots par mon IA perso (ou rien : elle est facultative et jamais bloquante). */
export function PriceExplanation({ estimate, action, simulated }: { estimate: PriceEstimate; action?: ReactNode; simulated?: boolean }) {
  if (!estimate.explanation) {
    return action ? <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">{action}<span>Mon IA perso explique le prix en mots ; elle ne le choisit jamais.</span></div> : null;
  }
  return (
    <figure className="rounded-lg border border-dashed border-accent px-3 py-2.5">
      <figcaption className="mb-1 flex items-center gap-1.5 text-xs font-medium text-accent"><Sparkles className="size-3.5" aria-hidden />{estimate.explanationSource === "template" ? "Explication (texte fixe)" : `Expliqué par mon IA perso${simulated ? " (simulée en démonstration)" : ""}`}</figcaption>
      <blockquote className="text-sm text-text">{estimate.explanation}</blockquote>
      <p className="mt-1 text-[11px] text-text-muted">L'explication ne change pas le prix : il vient des ventes comparables et du modèle.</p>
    </figure>
  );
}

/** Méthode, confiance, comparables, délai et version du modèle. */
export function EstimateFacts({ estimate, className }: { estimate: PriceEstimate; className?: string }) {
  return (
    <DescriptionList className={className} columns={2} items={[
      { label: "Méthode", value: PRICE_METHOD_LABELS[estimate.method] },
      { label: "Confiance", value: `${CONFIDENCE_LABELS[estimate.confidenceLevel]} (${Math.round(estimate.confidence * 100)} %)`, numeric: true },
      { label: "Ventes comparables", value: String(estimate.comparableCount), numeric: true },
      { label: "Délai de vente estimé", value: formatDelayDays(estimate.delayDays), numeric: true },
    ]} />
  );
}

/** Mentions honnêtes : modèle non entraîné, données de démonstration, message de l'estimation. */
export function EstimateNotices({ estimate, modelStatus }: { estimate: PriceEstimate; modelStatus?: PriceModelStatus | null }) {
  const v = modelStatus !== undefined ? modelStatusView(modelStatus) : null;
  const notes: string[] = [];
  if (v && (!modelStatus || !modelStatus.trained)) notes.push(`${v.label} : ${v.detail}`);
  if (estimate.message) notes.push(estimate.message);
  else if (estimate.demo) notes.push("Données de démonstration.");
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-text-muted">
      {[...new Set(notes)].map((n) => <li key={n} className="flex items-start gap-1.5"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{n}</li>)}
    </ul>
  );
}

/**
 * Estimation complète : fourchette, stratégies (avec « Appliquer » facultatif), faits, explication et
 * mentions. Sans prix (méthode « none ») : « pas assez de références », à fixer à la main.
 */
export function PriceEstimateView({ estimate, modelStatus, strategies, onApply, applying, floorCents, current, disabled, explainAction, simulated }: {
  estimate: PriceEstimate;
  modelStatus?: PriceModelStatus | null;
  /** Valeurs affichées des stratégies (par défaut celles de l'estimation ; Studio y applique le plancher). */
  strategies?: PriceStrategies;
  onApply?: (cents: number, key: keyof PriceStrategies) => void;
  applying?: keyof PriceStrategies | null;
  floorCents?: number | null;
  current?: number | null;
  disabled?: boolean;
  explainAction?: ReactNode;
  simulated?: boolean;
}) {
  if (!hasPrice(estimate)) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text">{estimate.message ?? "Pas assez de références pour proposer un prix : fixez-le à la main."}</p>
        <div className="flex flex-wrap items-center gap-2"><StatusBadge tone="muted">{PRICE_METHOD_LABELS.none}</StatusBadge>{modelStatus !== undefined ? <ModelStatusBadge status={modelStatus} /> : null}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="accent">{PRICE_METHOD_LABELS[estimate.method]}</StatusBadge>
        {modelStatus !== undefined ? <ModelStatusBadge status={modelStatus} /> : null}
        {estimate.demo ? <StatusBadge tone="muted">Démo</StatusBadge> : null}
      </div>
      <PriceRange p25={estimate.p25} p50={estimate.p50} p75={estimate.p75} />
      <StrategyStrip values={strategies ?? estimate.strategies} onApply={onApply} applying={applying} floorCents={floorCents} current={current} disabled={disabled} />
      <EstimateFacts estimate={estimate} />
      <PriceExplanation estimate={estimate} action={explainAction} simulated={simulated} />
      <EstimateNotices estimate={estimate} modelStatus={modelStatus} />
    </div>
  );
}

/** Suggestion tant que l'article est décrit : une marque (2 caractères) ou une catégorie précise. */
export function suggestionReady(f: Pick<PriceEstimateInput, "brand" | "category">): boolean {
  return (f.brand ?? "").trim().length >= 2 || f.category !== "other";
}

/**
 * Suggestion de prix à la saisie (formulaire d'article) : dès qu'une marque ou une catégorie est connue,
 * l'estimation est demandée (une requête après 500 ms sans frappe, sans explication ni requête IA).
 * « Utiliser » recopie la stratégie dans le prix affiché, que l'utilisateur garde ou corrige.
 */
export function PriceSuggestion({ features, onPick, floorCents, current }: {
  features: PriceEstimateInput;
  onPick: (cents: number) => void;
  floorCents?: number | null;
  current?: number | null;
}) {
  const client = useClient();
  // Clé texte (stable) : l'objet des caractéristiques est recréé à chaque rendu du formulaire.
  const key = useDebouncedValue(JSON.stringify({ ...features, explain: false }), 500);
  const ready = suggestionReady(JSON.parse(key) as PriceEstimateInput);
  const estimate = useQuery({
    queryKey: ["price-estimate", "form", key],
    queryFn: () => client.estimatePrice(JSON.parse(key) as PriceEstimateInput),
    enabled: ready,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <section aria-label="Prix conseillé par les ventes réelles" className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text">Prix conseillé par les ventes réelles</h3>
        {estimate.data && hasPrice(estimate.data) ? <span className="text-[11px] text-text-muted">{PRICE_METHOD_LABELS[estimate.data.method]}{estimate.data.demo ? " · démo" : ""}</span> : null}
      </div>
      {!ready ? (
        <p className="mt-1 text-xs text-text-muted">Saisissez la marque ou choisissez la catégorie : un prix vous sera suggéré.</p>
      ) : estimate.isPending ? (
        <p className="mt-1 text-xs text-text-muted" aria-live="polite">Estimation en cours…</p>
      ) : estimate.isError ? (
        <p className="mt-1 text-xs text-text-muted">Estimation indisponible pour le moment : fixez le prix à la main.</p>
      ) : estimate.data && hasPrice(estimate.data) ? (
        <>
          <ul className="mt-2 grid grid-cols-3 gap-2" aria-label="Stratégies suggérées">
            {STRATEGY_KEYS.map((k) => {
              const cents = estimate.data.strategies![k];
              const below = floorCents != null && cents < floorCents;
              return (
                <li key={k} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onPick(cents)}
                    disabled={below}
                    aria-label={`Utiliser ${PRICE_STRATEGY_LABELS[k].toLowerCase()} (${formatCents(cents)})`}
                    className={cn("w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60", current === cents ? "border-accent bg-accent-soft" : "border-border")}
                  >
                    <span className="block truncate text-[11px] text-text-muted">{PRICE_STRATEGY_LABELS[k]}</span>
                    <span className="num block text-sm font-semibold text-text">{formatCents(cents)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[11px] text-text-muted">
            {estimate.data.comparableCount} vente(s) comparable(s) · confiance {CONFIDENCE_LABELS[estimate.data.confidenceLevel].toLowerCase()} · délai {formatDelayDays(estimate.data.delayDays).toLowerCase()}
            {estimate.data.strategies && floorCents != null && estimate.data.strategies.fast < floorCents ? " · une stratégie est sous votre prix plancher" : ""}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-text-muted">{estimate.data?.message ?? "Pas assez de références pour proposer un prix : fixez-le à la main."}</p>
      )}
    </section>
  );
}

const pct = (v: number | null) => (v === null ? null : formatPercent(v));

/** Détail de l'état du modèle de prix (Paramètres › IA) : version, références, erreur mesurée ou non. */
export function PriceModelDetails({ status }: { status: PricingModelView }) {
  const v = modelStatusView(status);
  const refs = status.references;
  const items: { label: string; value: ReactNode; numeric?: boolean }[] = [
    { label: "Version", value: status.version ?? "—" },
    { label: "Entraîné le", value: status.trainedAt ? formatDate(status.trainedAt) : "—", numeric: true },
    { label: "Références d'entraînement", value: status.trained ? formatNumber(status.nReferences) : "—", numeric: true },
    { label: "Erreur médiane (dernier mois)", value: pct(v.measuredError) ?? (status.trained && !status.synthetic ? "Non mesurée" : "—"), numeric: true },
  ];
  if (v.measuredError !== null) {
    items.push({ label: "Estimations à ± 20 %", value: pct(v.within20) ?? "—", numeric: true });
    items.push({ label: "Ventes du mois de test", value: v.testSales !== null ? formatNumber(v.testSales) : "—", numeric: true });
  }
  if (refs) {
    items.push({ label: "Ventes réelles dans la base", value: `${formatNumber(refs.real)} / ${formatNumber(refs.minimum)} au moins`, numeric: true });
    if (refs.demo > 0) items.push({ label: "Ventes de démonstration", value: formatNumber(refs.demo), numeric: true });
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><ModelStatusBadge status={status} />{status.synthetic ? <StatusBadge tone="muted">Démo</StatusBadge> : null}</div>
      <p className="text-sm text-text-muted">{v.detail}</p>
      <DescriptionList columns={2} items={items} />
    </div>
  );
}

/**
 * Carte « Modèle de prix » : rien n'est présenté comme mesuré sans mesure. L'erreur affichée est celle du
 * test sur le dernier mois de la vraie base ; sinon « modèle non entraîné » ou « données de démonstration ».
 */
export function PriceModelCard({ className }: { className?: string }) {
  const client = useClient();
  const model = useQuery({ queryKey: ["pricing-model"], queryFn: () => client.pricingModelStatus(), staleTime: 60_000 });
  return (
    <Card className={className} aria-label="Modèle de prix">
      <h2 className="text-md font-semibold">Modèle de prix</h2>
      <p className="mb-3 text-sm text-text-muted">
        Prédit la fourchette P25 / P50 / P75 et le délai de vente, avec les ventes comparables. Entraîné sur le passé, testé sur le dernier mois jamais vu,
        ré-entraîné tous les {PRICE_MODEL_RETRAIN_DAYS} jours ; {formatNumber(PRICE_MODEL_MIN_REFERENCES)} ventes au moins. Mon IA perso explique le prix en mots, elle ne le choisit jamais.
      </p>
      <QueryBoundary query={model} skeleton="spinner">{(m) => <PriceModelDetails status={m} />}</QueryBoundary>
    </Card>
  );
}
