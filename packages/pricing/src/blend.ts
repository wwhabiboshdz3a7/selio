/**
 * Combinaison des deux moteurs (partie 07) : les comparables (ventes proches retrouvées par le
 * modèle 2, explicables) et le modèle entraîné (qui couvre les cas rares). Plus il y a de
 * comparables, plus on leur fait confiance : 0 comparable → modèle seul ; à partir de 12 →
 * comparables à 80 %, modèle à 20 % ; entre les deux, poids linéaire (0,8 × n / 12).
 *
 * Les quantiles sont combinés un à un (moyenne pondérée de P25, de P50 et de P75), ce qui garde
 * leur ordre. Trois stratégies en sortent : vente rapide = P25, standard = P50, marge maximale =
 * P75, arrondies au prix psychologique (x,90 par défaut, x,99 ou sans arrondi en option).
 *
 * L'explication est structurée pour mon IA perso : elle exprime le prix en mots, elle ne le choisit
 * jamais (D07 : l'IA rédige, la politique décide).
 */
import type { PriceConfidence, PriceFactor, PricePrediction } from "./types";

/** Résumé des ventes comparables (prix en centimes). */
export interface ComparablesSummary {
  p25: number;
  p50: number;
  p75: number;
  count: number;
  /** Délai de vente médian des comparables, en jours, s'il est connu. */
  delayDays?: number | null;
}

export interface BlendOptions {
  /** Terminaison du prix psychologique en centimes (90 → x,90 ; 99 → x,99) ; null = arrondi au centime. */
  psychologicalEnding?: number | null;
  /** Nombre de comparables à partir duquel leur poids est maximal (12). */
  fullWeightAt?: number;
  /** Poids maximal des comparables (0,8). */
  maxComparablesWeight?: number;
}

export type StrategyKey = "fast" | "standard" | "max";

export interface PriceStrategy {
  key: StrategyKey;
  label: string;
  quantile: "p25" | "p50" | "p75";
  /** Prix conseillé, arrondi au prix psychologique. */
  priceCents: number;
  /** Prix avant arrondi. */
  rawCents: number;
  /** Délai de vente médian estimé à ce prix, en jours (null si inconnu). */
  delayDays: number | null;
}

export interface PriceExplanation {
  /** Texte de repli, déterministe, en français (quand mon IA perso est indisponible). */
  summary: string;
  factors: PriceFactor[];
  /** Faits chiffrés à reprendre tels quels par mon IA perso. */
  facts: string[];
  /** Consignes pour mon IA perso. */
  rules: string[];
}

export interface BlendedEstimate {
  method: "comparables" | "model" | "blend" | "none";
  p25: number | null;
  p50: number | null;
  p75: number | null;
  delayDays: number | null;
  confidence: PriceConfidence;
  weights: { comparables: number; model: number };
  comparablesCount: number;
  strategies: PriceStrategy[];
  /** Le modèle a été entraîné sur des données de démonstration (« données de démonstration » à l'écran). */
  demoData: boolean;
  /** Erreur médiane mesurée du modèle, ou null (« modèle non mesuré »). */
  measuredMdape: number | null;
  explanation: PriceExplanation;
}

export const STRATEGY_LABELS: Readonly<Record<StrategyKey, string>> = { fast: "Vente rapide", standard: "Standard", max: "Marge maximale" };

/** Poids des comparables selon leur nombre : 0 → 0 ; ≥ 12 → 0,8 ; linéaire entre les deux. */
export function comparablesWeight(count: number, options: BlendOptions = {}): number {
  const full = options.fullWeightAt ?? 12;
  const max = options.maxComparablesWeight ?? 0.8;
  if (!(count > 0)) return 0;
  return Math.round(max * Math.min(1, count / full) * 1000) / 1000;
}

/**
 * Prix psychologique le plus proche se terminant par `ending` centimes (2 690 → 2 690 ;
 * 2 743 → 2 790 avec 90). Jamais sous 1 € : sous ce seuil, arrondi aux 10 centimes, 1 € au moins.
 */
export function roundPsychological(cents: number, ending: number | null = 90): number {
  const c = Math.round(cents);
  if (ending === null) return Math.max(1, c);
  if (!Number.isInteger(ending) || ending < 0 || ending > 99) throw new RangeError("Terminaison du prix psychologique : entier de 0 à 99");
  const below = Math.floor((c - ending) / 100) * 100 + ending;
  const above = below + 100;
  const nearest = c - below <= above - c ? below : above;
  if (nearest < 100) return Math.max(100, Math.round(c / 10) * 10);
  return nearest;
}

/** Résumé (P25, P50, P75, délai médian) de prix de ventes comparables, ou null s'il n'y en a aucun. */
export function summarizeComparables(pricesCents: readonly number[], delaysDays: readonly number[] = []): ComparablesSummary | null {
  const prices = pricesCents.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const q = (s: number[], t: number) => {
    const h = (s.length - 1) * t;
    const lo = Math.floor(h);
    return s[lo]! + (h - lo) * (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!);
  };
  const delays = delaysDays.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  return {
    p25: Math.round(q(prices, 0.25)),
    p50: Math.round(q(prices, 0.5)),
    p75: Math.round(q(prices, 0.75)),
    count: prices.length,
    delayDays: delays.length ? Math.round(q(delays, 0.5) * 10) / 10 : null,
  };
}

const RANK: Record<PriceConfidence, number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: PriceConfidence[] = ["low", "medium", "high"];

function comparablesConfidence(count: number): PriceConfidence {
  if (count >= 12) return "high";
  if (count >= 5) return "medium";
  return "low";
}

/** « 29,90 € » (espace insécable). */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(Math.round(cents));
  const euros = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${euros},${String(c % 100).padStart(2, "0")} €`;
}

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)} %`;
const days = (d: number) => (d < 1 ? "moins d'un jour" : `${Math.round(d)} jour${Math.round(d) > 1 ? "s" : ""}`);

/** Combine comparables et modèle en une estimation finale, trois stratégies et une explication. */
export function blendEstimate(input: { comparables: ComparablesSummary | null; model: PricePrediction | null }, options: BlendOptions = {}): BlendedEstimate {
  const comp = input.comparables && input.comparables.count > 0 ? input.comparables : null;
  const model = input.model;
  const ending = options.psychologicalEnding === undefined ? 90 : options.psychologicalEnding;
  const count = comp?.count ?? 0;
  const demoData = model !== null && model.dataOrigin !== undefined && model.dataOrigin !== "real";
  const measuredMdape = model?.measuredMdape ?? null;

  let method: BlendedEstimate["method"];
  let wc: number;
  if (comp && model) {
    method = "blend";
    wc = comparablesWeight(count, options);
  } else if (comp) {
    method = "comparables";
    wc = 1;
  } else if (model) {
    method = "model";
    wc = 0;
  } else {
    method = "none";
    wc = 0;
  }
  const wm = method === "none" ? 0 : Math.round((1 - wc) * 1000) / 1000;
  const mix = (c: number | undefined, m: number | undefined) => (c ?? 0) * wc + (m ?? 0) * wm;

  if (method === "none") {
    return {
      method,
      p25: null,
      p50: null,
      p75: null,
      delayDays: null,
      confidence: "low",
      weights: { comparables: 0, model: 0 },
      comparablesCount: 0,
      strategies: [],
      demoData: false,
      measuredMdape: null,
      explanation: {
        summary: "Aucune estimation : ni vente comparable, ni modèle de prix entraîné.",
        factors: [],
        facts: ["Aucune vente comparable trouvée.", "Modèle de prix non entraîné."],
        rules: EXPLANATION_RULES,
      },
    };
  }

  const p25 = Math.round(mix(comp?.p25, model?.p25));
  const p50 = Math.round(mix(comp?.p50, model?.p50));
  const p75 = Math.round(mix(comp?.p75, model?.p75));
  const compDelay = comp?.delayDays ?? null;
  const modelDelay = model?.delayDays ?? null;
  let delayDays: number | null;
  if (compDelay !== null && modelDelay !== null) delayDays = Math.round(((compDelay * wc + modelDelay * wm) / (wc + wm)) * 10) / 10;
  else delayDays = modelDelay ?? compDelay;

  const fastDelay = model?.delayAt ? Math.min(model.delayAt.p25, delayDays ?? model.delayAt.p25) : null;
  const maxDelay = model?.delayAt ? Math.max(model.delayAt.p75, delayDays ?? model.delayAt.p75) : null;
  const strategies: PriceStrategy[] = [
    { key: "fast", label: STRATEGY_LABELS.fast, quantile: "p25", priceCents: roundPsychological(p25, ending), rawCents: p25, delayDays: fastDelay },
    { key: "standard", label: STRATEGY_LABELS.standard, quantile: "p50", priceCents: roundPsychological(p50, ending), rawCents: p50, delayDays },
    { key: "max", label: STRATEGY_LABELS.max, quantile: "p75", priceCents: roundPsychological(p75, ending), rawCents: p75, delayDays: maxDelay },
  ];

  let confidence: PriceConfidence;
  if (method === "comparables") confidence = comparablesConfidence(count);
  else if (method === "model") confidence = model!.confidence;
  else confidence = BY_RANK[Math.max(RANK[comparablesConfidence(count)], RANK[model!.confidence])]!;

  const factors: PriceFactor[] = [...(model?.factors ?? []).filter((f) => f.key !== "model_error")];
  factors.push({ key: "comparables", label: "Ventes comparables", value: `${count} vente${count > 1 ? "s" : ""} proche${count > 1 ? "s" : ""}`, effect: null, support: count });
  const modelError = model?.factors?.find((f) => f.key === "model_error");
  if (model) factors.push(modelError ?? { key: "model_error", label: "Erreur du modèle", value: measuredMdape === null ? "Non mesurée" : `${Math.round(measuredMdape * 100)} % d'erreur médiane sur le dernier mois`, effect: null });

  const [fast, standard, max] = strategies as [PriceStrategy, PriceStrategy, PriceStrategy];
  const facts: string[] = [
    `Prix standard conseillé : ${formatEuros(standard.priceCents)}.`,
    `Vente rapide : ${formatEuros(fast.priceCents)} ; marge maximale : ${formatEuros(max.priceCents)}.`,
  ];
  if (method === "blend") facts.push(`Estimation combinée : ${count} vente${count > 1 ? "s" : ""} comparable${count > 1 ? "s" : ""} (poids ${Math.round(wc * 100)} %) et modèle de prix (poids ${Math.round(wm * 100)} %).`);
  else if (method === "comparables") facts.push(`Estimation par ${count} vente${count > 1 ? "s" : ""} comparable${count > 1 ? "s" : ""}, sans modèle de prix.`);
  else facts.push("Estimation par le modèle de prix seul : aucune vente comparable trouvée.");
  if (delayDays !== null) facts.push(`Délai de vente estimé au prix standard : ${days(delayDays)}.`);
  for (const f of factors) {
    if (f.key === "comparables" || f.key === "model_error") continue;
    // Un effet nul ou presque n'apprend rien au vendeur : on ne le cite pas.
    if (f.effect === null || Math.round(Math.abs(f.effect) * 100) === 0) continue;
    facts.push(`${f.label} (${f.value}) : ${pct(f.effect)} sur le prix médian par rapport à ${f.versus ?? "la référence"}.`);
  }
  if (model) facts.push(measuredMdape === null ? "Erreur du modèle : non mesurée." : `Erreur médiane du modèle mesurée sur le dernier mois : ${Math.round(measuredMdape * 100)} %.`);
  if (demoData) facts.push("Attention : modèle entraîné sur des données de démonstration.");

  const summaryParts = [
    `Prix conseillé ${formatEuros(standard.priceCents)} (standard), entre ${formatEuros(fast.priceCents)} (vente rapide) et ${formatEuros(max.priceCents)} (marge maximale).`,
    method === "blend"
      ? `Calculé à partir de ${count} vente${count > 1 ? "s" : ""} comparable${count > 1 ? "s" : ""} (${Math.round(wc * 100)} %) et du modèle de prix (${Math.round(wm * 100)} %).`
      : method === "comparables"
        ? `Calculé à partir de ${count} vente${count > 1 ? "s" : ""} comparable${count > 1 ? "s" : ""}.`
        : "Calculé par le modèle de prix, sans vente comparable.",
  ];
  if (delayDays !== null) summaryParts.push(`Délai de vente estimé : ${days(delayDays)}.`);
  if (demoData) summaryParts.push("Données de démonstration.");
  else if (model && measuredMdape === null) summaryParts.push("Erreur du modèle non mesurée.");

  return {
    method,
    p25,
    p50,
    p75,
    delayDays,
    confidence,
    weights: { comparables: wc, model: wm },
    comparablesCount: count,
    strategies,
    demoData,
    measuredMdape,
    explanation: { summary: summaryParts.join(" "), factors, facts, rules: EXPLANATION_RULES },
  };
}

/** Consignes données à mon IA perso avec les faits : elle explique, elle ne décide pas. */
export const EXPLANATION_RULES: string[] = [
  "Les prix et délais fournis sont calculés : ne les modifie pas, n'en propose pas d'autres et n'invente aucun chiffre.",
  "Explique en quelques phrases simples pourquoi ce prix, à partir des faits fournis seulement.",
  "Présente toujours le résultat comme une estimation, jamais comme une garantie de vente.",
  "Ne cite aucun vendeur, aucun pseudo ni aucune annonce précise.",
];
