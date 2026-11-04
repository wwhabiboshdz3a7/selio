import {
  ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, PRICE_METHOD_LABELS, PRICE_MODEL_DEMO_DATA, PRICE_NOT_ENOUGH_REFERENCES,
  type InventoryItem, type ItemCategory, type ItemCondition, type MarketObservation, type Order, type PriceConfidenceLevel, type PriceEstimate, type PriceFeatures, type PriceMethod, type PriceModelStatus,
} from "@selio/contracts";
import { MockAIProvider, buildPriceExplanationRequest, priceExplanationFacts, validatePriceExplanation, type PriceExplanationContext } from "@selio/ai";
import { hashString } from "@selio/domain";
import { comparablesWeight, quantileCents, roundPrice } from "../track";

/**
 * Estimation des prix dans la démonstration : même règle que le serveur (packages/core/src/services/pricing.ts)
 * — comparables de même marque et catégorie (3 au moins) ou de la marque (2 au moins), combinés avec le
 * modèle de prix au poids 0,8 × min(1, n / 12), trois stratégies arrondies à x,90 — sur les ventes de la
 * démonstration et le marché simulé. Le « modèle » est un modèle de DÉMONSTRATION (médianes du simulateur) :
 * aucune erreur n'est mesurée, tout est marqué « données de démonstration ».
 */

export const DEMO_MODEL_VERSION = "demo-2026.10";

export interface DemoComparable {
  kind: "sale" | "market";
  brand: string | null;
  category: ItemCategory | null;
  condition: ItemCondition | null;
  priceCents: number;
  /** Délai mise en ligne → vente, en jours (null : inconnu). */
  delayDays: number | null;
}

const CONDITION_FACTOR: Record<ItemCondition, number> = { new_with_tags: 1.15, new_without_tags: 1.05, very_good: 1, good: 0.9, satisfactory: 0.75 };
const conditionFactor = (c: ItemCondition | null | undefined) => (c ? CONDITION_FACTOR[c] : 0.95);
const LEVEL_VALUE: Record<PriceConfidenceLevel, number> = { low: 0.35, medium: 0.6, high: 0.8 };
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const DAY = 86_400_000;

/** Délai de vente fictif et stable d'une observation du simulateur (1 à 24 jours). */
export function demoDelayDays(id: string): number {
  const h = hashString(`delai:${id}`);
  return 1 + (h % 1000) / 1000 * (h % 3 === 0 ? 23 : 11);
}

/** Comparables de la démonstration : ventes de l'atelier, puis ventes du marché simulé (sans vendeur). */
export function demoPricingPool(orders: readonly Order[], items: readonly InventoryItem[], market: readonly MarketObservation[]): DemoComparable[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: DemoComparable[] = [];
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "refunded" || o.status === "pending") continue;
    const it = byId.get(o.itemId);
    if (!it) continue;
    const listedAt = it.listedAt ?? it.createdAt;
    const delay = listedAt ? (new Date(o.createdAt).getTime() - new Date(listedAt).getTime()) / DAY : null;
    out.push({ kind: "sale", brand: it.brand, category: it.category, condition: it.condition, priceCents: o.salePriceCents, delayDays: delay !== null && delay >= 0 ? delay : null });
  }
  for (const m of market) {
    if (m.status !== "sold") continue;
    out.push({ kind: "market", brand: m.brand, category: m.category, condition: null, priceCents: m.priceCents, delayDays: demoDelayDays(m.id) });
  }
  return out;
}

function median(values: readonly number[]): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

interface Selection { method: "brand_category" | "brand" | "none"; comparables: DemoComparable[]; level: PriceConfidenceLevel }

/** Comparables : même marque et catégorie (3 au moins), sinon même marque (2 au moins), sinon aucun. */
export function selectDemoComparables(target: Pick<PriceFeatures, "brand" | "category">, pool: readonly DemoComparable[]): Selection {
  const brand = norm(target.brand);
  if (brand) {
    const sameBrand = pool.filter((c) => norm(c.brand) === brand);
    const sameBrandCat = sameBrand.filter((c) => c.category === target.category);
    if (sameBrandCat.length >= 3) return { method: "brand_category", comparables: sameBrandCat, level: "high" };
    if (sameBrand.length >= 2) return { method: "brand", comparables: sameBrand, level: "medium" };
  }
  return { method: "none", comparables: [], level: "low" };
}

/**
 * Modèle de prix de démonstration : médiane du simulateur pour la catégorie, ajustée par la marque (bornée),
 * puis par l'état ; quantiles à −22 % et +27 %. Ce n'est pas un modèle entraîné : il sert à montrer le
 * fonctionnement, toujours avec la mention « données de démonstration ».
 */
export function demoModelPredict(target: PriceFeatures, pool: readonly DemoComparable[]): { p25: number; p50: number; p75: number; delayDays: number | null } | null {
  const market = pool.filter((c) => c.kind === "market");
  const sameCat = market.filter((c) => c.category === target.category);
  const base = median((sameCat.length >= 3 ? sameCat : market).map((c) => c.priceCents));
  if (base === null) return null;
  const brandPrices = target.brand ? market.filter((c) => norm(c.brand) === norm(target.brand)).map((c) => c.priceCents) : [];
  const brandMedian = brandPrices.length >= 2 ? median(brandPrices) : null;
  const brandFactor = brandMedian !== null ? Math.min(1.8, Math.max(0.6, brandMedian / base)) : 1;
  const p50 = base * brandFactor * conditionFactor(target.condition);
  return { p25: Math.round(p50 * 0.78), p50: Math.round(p50), p75: Math.round(p50 * 1.27), delayDays: median((sameCat.length ? sameCat : market).map((c) => c.delayDays).filter((d): d is number => d !== null)) };
}

/** Estimation sans explication : même combinaison que le serveur (`combineEstimate`). */
export function demoEstimate(target: PriceFeatures, pool: readonly DemoComparable[], opts: { model?: boolean } = {}): PriceEstimate {
  const selection = selectDemoComparables(target, pool);
  const factor = conditionFactor(target.condition);
  const prices = selection.comparables.map((c) => c.priceCents);
  const comp = prices.length > 0
    ? {
        p25: Math.round((quantileCents(prices, 0.25) ?? 0) * factor),
        p50: Math.round((quantileCents(prices, 0.5) ?? 0) * factor),
        p75: Math.round((quantileCents(prices, 0.75) ?? 0) * factor),
        delay: median(selection.comparables.map((c) => c.delayDays).filter((d): d is number => d !== null)),
        confidence: LEVEL_VALUE[selection.level],
      }
    : null;
  const prediction = opts.model === false ? null : demoModelPredict(target, pool);
  const n = selection.comparables.length;
  const factors: string[] = [];
  if (comp) {
    const fromMarket = selection.comparables.filter((c) => c.kind === "market").length;
    factors.push(`${n} vente(s) comparable(s) ${selection.method === "brand_category" ? "de même marque et catégorie" : "de la marque"}${fromMarket ? `, dont ${fromMarket} du marché simulé` : ""}`);
    if (target.condition) factors.push(`État : ${ITEM_CONDITION_LABELS[target.condition]}`);
  }
  if (prediction) factors.push(`Modèle de prix ${DEMO_MODEL_VERSION} (données de démonstration)`);
  if (!comp && !prediction) {
    return { p25: null, p50: null, p75: null, delayDays: null, confidence: 0, confidenceLevel: "low", method: "none", strategies: null, comparableCount: 0, modelVersion: null, explanation: null, explanationSource: null, factors: [], demo: true, message: PRICE_NOT_ENOUGH_REFERENCES };
  }
  const method: PriceMethod = comp && prediction ? "blend" : comp ? "comparables" : "model";
  const wc = comp && prediction ? comparablesWeight(n) : comp ? 1 : 0;
  const wm = Math.round((1 - wc) * 1000) / 1000;
  const mix = (c: number | undefined, m: number | undefined) => Math.round((c ?? 0) * wc + (m ?? 0) * wm);
  const [p25, p50, p75] = [mix(comp?.p25, prediction?.p25), mix(comp?.p50, prediction?.p50), mix(comp?.p75, prediction?.p75)].sort((a, b) => a - b) as [number, number, number];
  const compDelay = comp?.delay ?? null;
  const modelDelay = prediction?.delayDays ?? null;
  const delayDays = compDelay !== null && modelDelay !== null ? compDelay * wc + modelDelay * wm : compDelay ?? modelDelay;
  const confidence = Math.round(((comp?.confidence ?? 0) * wc + (prediction ? LEVEL_VALUE.low : 0) * wm) * 100) / 100;
  if (method === "blend") factors.push(`Poids des comparables : ${Math.round(wc * 100)} %`);
  if (delayDays !== null) factors.push(`Délai de vente estimé : ${Math.round(delayDays)} jours`);
  return {
    p25, p50, p75,
    delayDays: delayDays === null ? null : Math.round(delayDays * 10) / 10,
    confidence,
    confidenceLevel: method === "comparables" ? selection.level : confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low",
    method,
    strategies: { fast: roundPrice(p25), standard: roundPrice(p50), max: roundPrice(p75) },
    comparableCount: n,
    modelVersion: prediction ? DEMO_MODEL_VERSION : null,
    explanation: null,
    explanationSource: null,
    factors: factors.slice(0, 12),
    demo: true,
    message: `${PRICE_MODEL_DEMO_DATA} : ventes et modèle de prix du simulateur.`,
  };
}

const explainer = new MockAIProvider({ latencyMs: 120 });

/**
 * Explication en mots par mon IA perso (simulée en démonstration) : elle ne choisit jamais le prix, sa
 * sortie est relue (aucun montant ni chiffre hors des faits fournis) ; refusée ou en échec, rien n'est affiché.
 */
export async function explainDemoEstimate(target: PriceFeatures, est: PriceEstimate): Promise<PriceEstimate> {
  if (est.method === "none" || !est.strategies) return est;
  const ctx: PriceExplanationContext = {
    item: { title: target.title ?? null, brand: target.brand ?? null, category: ITEM_CATEGORY_LABELS[target.category], condition: target.condition ? ITEM_CONDITION_LABELS[target.condition] : null, size: target.size ?? null },
    prices: { fastCents: est.strategies.fast, standardCents: est.strategies.standard, maxCents: est.strategies.max },
    methodLabel: PRICE_METHOD_LABELS[est.method],
    comparableCount: est.comparableCount,
    delayDays: est.delayDays,
    confidenceLevel: est.confidenceLevel,
    factors: est.factors,
    demo: est.demo,
  };
  try {
    const res = await explainer.generateStructured(buildPriceExplanationRequest(ctx));
    const v = validatePriceExplanation(res.data.explanation, { allowedPricesCents: [est.strategies.fast, est.strategies.standard, est.strategies.max], facts: [...priceExplanationFacts(ctx), target.title ?? ""] });
    return v.ok ? { ...est, explanation: v.explanation, explanationSource: "ai" } : est;
  } catch {
    return est;
  }
}

/** État du modèle de démonstration : jamais « mesuré ». */
export function demoModelStatus(trainedAt: string, nReferences: number): PriceModelStatus {
  return { trained: true, version: DEMO_MODEL_VERSION, trainedAt, nReferences, metrics: null, synthetic: true, label: PRICE_MODEL_DEMO_DATA };
}
