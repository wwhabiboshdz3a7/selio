import { createHash } from "node:crypto";
import {
  ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, PRICE_METHOD_LABELS, PRICE_MODEL_DEMO_DATA, PRICE_MODEL_MIN_REFERENCES, PRICE_MODEL_NOT_TRAINED, PRICE_NOT_ENOUGH_REFERENCES,
  PRICE_REFERENCE_RETENTION_MONTHS, RADAR_EMBEDDING_MIN_SIMILARITY, RADAR_EMBEDDING_TOP_K, priceEstimateInput, quotasForPlan,
  type InventoryItem, type ItemCategory, type ItemCondition, type Order, type PriceConfidenceLevel, type PriceEstimate, type PriceFeatures, type PriceMethod, type PriceModelMetrics,
  type PriceModelRecord, type PriceModelStatus, type PriceReference, type PriceReferenceInput, type PriceReferenceSource,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { AIError, buildPriceExplanationRequest, priceExplanationFacts, toAIError, validatePriceExplanation, type PriceExplanationContext, type StructuredRequest, type StructuredResult } from "@selio/ai";
import { comparableText, cosineSimilarity } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services } from "../context";

/**
 * Estimation des prix (prompt §5.10), service interne utilisé par Studio, Manager, Radar et Track.
 *
 * Deux moteurs :
 * - les COMPARABLES : ventes réelles de l'organisation (ses commandes et articles) et base de références
 *   partagée (`price_references`, sans donnée personnelle) LIMITÉE aux annonces lues par Track et aux lots
 *   importés : jamais les données de démonstration, jamais les ventes versées par une organisation
 *   (`source = 'sale'` : celles d'une autre organisation ne sont jamais montrées une à une, les siennes
 *   viennent déjà de ses commandes et ne sont pas comptées deux fois). Ils sont
 *   d'abord pris dans la même catégorie et affinés par similarité des titres (modèle 2, vecteurs gardés
 *   dans `embeddings_cache`, le cache de Radar) : 8 au plus au-dessus de 0,6, la marque étant dans le
 *   texte comparé ; sinon, même marque et catégorie (3 au moins), sinon même marque (2 au moins) ;
 * - le MODÈLE DE PRIX entraîné (gradient boosting, quantiles P25 / P50 / P75 et délai), fourni par le
 *   worker ou l'API dans `services.pricing.model` (paquet @selio/pricing, chargé depuis `price_models`).
 *   Les ventes versées par les organisations qui l'ont accepté (`settings.pricing.shareSales`, désactivé par
 *   défaut) ne servent qu'à cet entraînement agrégé.
 *
 * Règle de combinaison (la même que @selio/pricing) : 0 comparable → modèle seul ; avec n comparables, poids
 * des comparables = 0,8 × min(1, n / 12), le modèle garde le reste ; sans modèle → comparables seuls ;
 * sans les deux → méthode « none » et « pas assez de références » : aucun prix n'est inventé.
 * Trois stratégies arrondies au prix psychologique (x,90) : vente rapide (P25), standard (P50), marge
 * maximale (P75). Mon IA perso explique le prix en mots (facultatif, jamais bloquant) ; elle ne le choisit
 * jamais (D07) : sa sortie est relue et écartée si elle cite un montant ou un chiffre absent des faits.
 */

// ---------------------------------------------------------------- interfaces minimales (modèle, entraîneur)

/** Prédiction d'un modèle de prix (forme compatible avec `predictPrice` de @selio/pricing). Prix en centimes. */
export interface PricePredictionLike {
  p25: number;
  p50: number;
  p75: number;
  delayDays: number | null;
  /** Confiance : un nombre de 0 à 1, ou un niveau. */
  confidence: number | PriceConfidenceLevel;
  /** Origine des données d'entraînement (« demo » : données de démonstration). */
  dataOrigin?: "real" | "demo" | "mixed";
}

/** Modèle de prix chargé (le cœur ne dépend pas de @selio/pricing : le worker et l'API l'adaptent). */
export interface PriceModelLike {
  readonly version?: string;
  /** Vrai : entraîné sur des données de démonstration. */
  readonly synthetic?: boolean;
  predict(features: PriceFeatures): PricePredictionLike;
}

/**
 * Ligne d'entraînement : les champs autorisés d'une référence de @selio/pricing (`PriceReferenceFields`),
 * rien d'autre (aucun pseudo, aucun identifiant, aucune photo, aucun titre).
 */
export interface PriceTrainingRow {
  brand: string;
  category: string;
  subcategory: string | null;
  size: string | null;
  material: string | null;
  color: string | null;
  /** État (code Selio) ; null s'il est inconnu (jamais inventé : le nettoyage de @selio/pricing l'accepte). */
  condition: string | null;
  listedPriceCents: number;
  finalPriceCents: number | null;
  /** Vrai : prix final ESTIMÉ (annonce disparue, dernier prix affiché) : jamais compté dans le mois de test. */
  finalPriceEstimated: boolean;
  listedAt: string;
  soldAt: string | null;
  photoCount: number | null;
  views: number | null;
  favorites: number | null;
  source: "client_sale" | "track" | "provided_base" | "demo";
}

export type PriceTrainOutcome =
  | { ok: true; version: string; model: unknown; metrics: PriceModelMetrics; nReferences?: number }
  | { ok: false; reason: string };

/** Entraîneur (worker : @selio/pricing ; tests : `FakePriceTrainer`). */
export interface PriceTrainerLike {
  train(rows: readonly PriceTrainingRow[], opts: { now: Date; synthetic: boolean }): PriceTrainOutcome | Promise<PriceTrainOutcome>;
}

/** Ce que le worker et l'API fournissent dans `services.pricing`. */
export interface PricingServices {
  /** Modèle actif chargé (null : modèle non entraîné, ou non chargé dans ce processus). */
  model: PriceModelLike | null;
  trainer?: PriceTrainerLike;
  /** Recharge un modèle enregistré (`price_models.model`) en `PriceModelLike` (après un entraînement). */
  loader?: (stored: { version: string; model: unknown; synthetic: boolean }) => PriceModelLike;
}

/** Modèle factice (tests) : rend la prédiction donnée et garde les caractéristiques reçues. */
export class FakePriceModel implements PriceModelLike {
  readonly calls: PriceFeatures[] = [];
  constructor(
    private readonly out: Partial<PricePredictionLike> & { p50: number },
    readonly version = "fake-1",
    readonly synthetic = false,
  ) {}
  predict(features: PriceFeatures): PricePredictionLike {
    this.calls.push(structuredClone(features));
    const p50 = this.out.p50;
    return { p25: this.out.p25 ?? Math.round(p50 * 0.8), p50, p75: this.out.p75 ?? Math.round(p50 * 1.25), delayDays: this.out.delayDays === undefined ? 9 : this.out.delayDays, confidence: this.out.confidence ?? 0.6, dataOrigin: this.out.dataOrigin };
  }
}

/** Entraîneur factice (tests) : garde les lignes reçues et rend un modèle sérialisable. */
export class FakePriceTrainer implements PriceTrainerLike {
  readonly calls: { rows: PriceTrainingRow[]; now: Date; synthetic: boolean }[] = [];
  constructor(private readonly result?: PriceTrainOutcome) {}
  train(rows: readonly PriceTrainingRow[], opts: { now: Date; synthetic: boolean }): PriceTrainOutcome {
    this.calls.push({ rows: [...rows], now: opts.now, synthetic: opts.synthetic });
    if (this.result) return this.result;
    const prices = rows.map((r) => r.finalPriceCents ?? r.listedPriceCents).sort((a, b) => a - b);
    return { ok: true, version: `fake-${opts.now.toISOString().slice(0, 10)}`, model: { median: prices[Math.floor(prices.length / 2)] ?? 0 }, metrics: { n: Math.min(30, rows.length), mdape: 0.2 }, nReferences: rows.length };
  }
}

// ---------------------------------------------------------------- outils (purs)

/** Facteurs d'état : les mêmes que l'estimation de revente de @selio/domain (radar.ts). État inconnu : 0,95. */
const CONDITION_FACTOR: Record<ItemCondition, number> = { new_with_tags: 1.15, new_without_tags: 1.05, very_good: 1, good: 0.9, satisfactory: 0.75 };
export const conditionFactor = (c: ItemCondition | null | undefined): number => (c ? CONDITION_FACTOR[c] : 0.95);

/** Quantile par interpolation linéaire (méthode 7), arrondi au centime ; null sans valeur. */
export function quantileCents(values: readonly number[], q: number): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const h = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h);
  return Math.round(s[lo]! + (h - lo) * (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!));
}

function median(values: readonly number[]): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Prix psychologique le plus proche finissant par 90 centimes (2 743 → 2 790 ; 2 690 → 2 690), comme
 * @selio/pricing ; sous 1 €, arrondi aux 10 centimes (1 € au moins).
 */
export function roundPrice(cents: number): number {
  const c = Math.round(cents);
  const below = Math.floor((c - 90) / 100) * 100 + 90;
  const above = below + 100;
  const nearest = c - below <= above - c ? below : above;
  if (nearest < 100) return Math.max(100, Math.round(c / 10) * 10);
  return nearest;
}

/** Poids des comparables dans la combinaison : 0,8 × min(1, n / 12) (0 comparable → modèle seul). */
export function comparablesWeight(count: number): number {
  if (!(count > 0)) return 0;
  return Math.round(0.8 * Math.min(1, count / 12) * 1000) / 1000;
}

const LEVEL_VALUE: Record<PriceConfidenceLevel, number> = { low: 0.35, medium: 0.6, high: 0.8 };
export function confidenceLevel(v: number): PriceConfidenceLevel {
  return v >= 0.75 ? "high" : v >= 0.5 ? "medium" : "low";
}
const confidenceValue = (c: number | PriceConfidenceLevel): number => (typeof c === "number" && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : LEVEL_VALUE[c as PriceConfidenceLevel] ?? 0.35);

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- comparables

/** Une vente comparable : vente de l'organisation (`sale`) ou référence de la base partagée (`market`). */
export interface PricingComparable {
  /** Identifiant de la commande ou de la référence : clé du cache d'embeddings. */
  ref: string;
  kind: "sale" | "market";
  /** Texte comparé par le modèle 2 (marque et titre, ou attributs d'une référence) ; jamais de donnée de personne. */
  text: string | null;
  brand: string | null;
  category: ItemCategory | null;
  condition: ItemCondition | null;
  priceCents: number;
  /** Délai de vente (mise en ligne → vente), en jours, s'il est connu. */
  delayDays: number | null;
  /** Vrai : prix final estimé (annonce disparue, Track). */
  estimated: boolean;
  at: string;
}

export interface PricingPools {
  sales: PricingComparable[];
  references: PricingComparable[];
}

/** Ventes de l'organisation embarquées par lecture, au plus (les plus récentes d'abord ; le cache fait le reste). */
export const PRICING_SALES_EMBED_CAP = 500;
/** Vecteurs calculés au plus par estimation ou par lecture Radar (le reste vient du cache, ou attend). */
export const PRICING_EMBED_CAP_PER_CALL = 200;
/** Références chargées au plus par catégorie et par marque. */
const REFERENCES_PER_CATEGORY = 1000;
const REFERENCES_PER_BRAND = 300;

/** Texte d'une référence (aucun titre libre n'est gardé) : marque, type de pièce, catégorie, matière, couleur, taille. */
export function referenceText(r: Pick<PriceReference, "brand" | "subcategory" | "category" | "material" | "color" | "size">): string {
  return [r.brand, r.subcategory, ITEM_CATEGORY_LABELS[r.category], r.material, r.color, r.size].filter((x) => x && String(x).trim()).join(" ").slice(0, 300);
}

/** Ventes de l'organisation (commandes non annulées ni remboursées), avec leur titre, les plus récentes d'abord. */
export function salesComparables(orders: Iterable<Order>, items: Map<string, InventoryItem>): PricingComparable[] {
  const out: PricingComparable[] = [];
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "refunded") continue;
    const it = items.get(o.itemId);
    if (!it) continue;
    const listed = it.listedAt ? new Date(it.listedAt).getTime() : null;
    const sold = new Date(o.createdAt).getTime();
    out.push({
      ref: o.id, kind: "sale", text: it.title.trim() ? comparableText(it.title, it.brand) : null, brand: it.brand, category: it.category, condition: it.condition,
      priceCents: o.salePriceCents, delayDays: listed !== null && sold >= listed ? (sold - listed) / DAY_MS : null, estimated: false, at: o.createdAt,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.ref.localeCompare(b.ref));
}

/** Références au prix final connu (ou estimé) devenues comparables (jamais celles du simulateur ni les ventes versées). */
export function referenceComparables(refs: Iterable<PriceReference>): PricingComparable[] {
  const out: PricingComparable[] = [];
  for (const r of refs) {
    if (r.finalPriceCents === null || !COMPARABLE_REFERENCE_SOURCES.includes(r.source)) continue;
    const listed = r.listedAt ? new Date(r.listedAt).getTime() : null;
    const sold = r.soldAt ? new Date(r.soldAt).getTime() : null;
    out.push({
      ref: r.id, kind: "market", text: referenceText(r) || null, brand: r.brand, category: r.category, condition: r.condition, priceCents: r.finalPriceCents,
      delayDays: listed !== null && sold !== null && sold >= listed ? (sold - listed) / DAY_MS : null, estimated: r.finalPriceEstimated, at: r.soldAt ?? r.listedAt ?? r.createdAt,
    });
  }
  return out;
}

/**
 * Sources de la base partagée servies comme comparables : annonces lues par Track et lots importés. Jamais
 * `sale` (ventes versées par les organisations : entraînement agrégé seulement) ni `demo`.
 */
export const COMPARABLE_REFERENCE_SOURCES: readonly PriceReferenceSource[] = ["track", "import"];

/**
 * Charge les comparables utiles aux articles : toutes les ventes de l'organisation, et les références de la
 * base partagée de leurs catégories et de leurs marques (bornées, sources `COMPARABLE_REFERENCE_SOURCES`). À
 * appeler dans une transaction de l'organisation (les références n'ont pas de RLS : aucune donnée de personne).
 */
export async function loadPoolsTx(tx: Tx, targets: readonly { brand?: string | null; category?: ItemCategory | null }[]): Promise<PricingPools> {
  const orders = await repos.orders.all(tx);
  const items = new Map((await repos.items.all(tx)).map((i) => [i.id, i]));
  const sales = salesComparables(orders, items);
  const seen = new Map<string, PriceReference>();
  const sources = COMPARABLE_REFERENCE_SOURCES;
  for (const category of new Set(targets.map((t) => t.category).filter((c): c is ItemCategory => !!c))) {
    for (const r of await repos.priceReferences.search(tx, { category, withFinalPrice: true, sources, limit: REFERENCES_PER_CATEGORY })) seen.set(r.id, r);
  }
  for (const brand of new Set(targets.map((t) => norm(t.brand)).filter(Boolean))) {
    for (const r of await repos.priceReferences.search(tx, { brand, withFinalPrice: true, sources, limit: REFERENCES_PER_BRAND })) seen.set(r.id, r);
  }
  return { sales, references: referenceComparables(seen.values()) };
}

// ---------------------------------------------------------------- embeddings (cache de Radar)

type EmbeddingKind = Parameters<typeof repos.embeddingsCache.get>[1];

export function embedModelName(services: Services): string {
  const p = services.ai.provider as { embedModel?: string | null; model: string };
  return (typeof p.embedModel === "string" && p.embedModel) || p.model;
}

/** Vecteurs des textes : depuis `embeddings_cache` (même empreinte de texte), sinon calculés (au plus `cap`) puis gardés. */
export async function vectorsFor(ctx: OrgContext, kind: EmbeddingKind, entries: readonly { ref: string; text: string }[], cap: number): Promise<Map<string, number[]>> {
  const model = embedModelName(ctx.services);
  const out = new Map<string, number[]>();
  if (entries.length === 0) return out;
  const cached = await withOrg(ctx, (tx) => repos.embeddingsCache.get(tx, kind, entries.map((e) => e.ref), model));
  const missing: { ref: string; text: string }[] = [];
  for (const e of entries) {
    const c = cached.get(e.ref);
    if (c && c.textHash === sha(e.text)) out.set(e.ref, c.vector);
    else missing.push(e);
  }
  const todo = missing.slice(0, Math.max(0, cap));
  if (todo.length > 0) {
    const res = await ctx.services.ai.embed(ctx.orgId, todo.map((e) => e.text));
    if (res.embeddings.length !== todo.length) throw new Error("embeddings incomplets");
    const rows = todo.map((e, i) => ({ kind, ref: e.ref, model, textHash: sha(e.text), vector: res.embeddings[i]! }));
    await withOrg(ctx, (tx) => repos.embeddingsCache.put(tx, rows));
    for (const r of rows) out.set(r.ref, r.vector);
  }
  return out;
}

/** Cible d'une estimation (caractéristiques, catégorie inconnue possible pour une annonce lue par Radar). */
export interface PricingTarget extends Omit<PriceFeatures, "category"> {
  category: ItemCategory | null;
}

/** Vecteurs des cibles et des comparables candidats (même catégorie), ou null si le modèle 2 est indisponible. */
async function similarityContext(ctx: OrgContext, targets: readonly PricingTarget[], pools: PricingPools): Promise<{ targets: (number[] | null)[]; pool: Map<string, number[]> } | null> {
  if (!ctx.services.ai.canEmbed || !targets.some((t) => t.title)) return null;
  const all = [...pools.sales.filter((s) => s.text).slice(0, PRICING_SALES_EMBED_CAP), ...pools.references.filter((r) => r.text)];
  if (all.length === 0) return null;
  try {
    const categories = new Set(targets.map((t) => t.category));
    const wanted = categories.has(null) ? all : all.filter((c) => categories.has(c.category));
    const sales = wanted.filter((c) => c.kind === "sale").map((c) => ({ ref: c.ref, text: c.text! }));
    const market = wanted.filter((c) => c.kind === "market").map((c) => ({ ref: c.ref, text: c.text! }));
    const salesVectors = await vectorsFor(ctx, "sale", sales, PRICING_EMBED_CAP_PER_CALL);
    const marketVectors = await vectorsFor(ctx, "market", market, Math.max(0, PRICING_EMBED_CAP_PER_CALL - sales.length));
    const texts = targets.map((t) => (t.title ? comparableText(t.title, t.brand ?? null) : null));
    const unique = [...new Map(texts.filter((x): x is string => !!x).map((x) => [sha(x), { ref: sha(x), text: x }])).values()];
    const targetVectors = await vectorsFor(ctx, "opportunity", unique, unique.length);
    return {
      targets: texts.map((x) => (x ? targetVectors.get(sha(x)) ?? null : null)),
      pool: new Map([...[...salesVectors.entries()].map(([k, v]) => [`sale:${k}`, v] as const), ...[...marketVectors.entries()].map(([k, v]) => [`market:${k}`, v] as const)]),
    };
  } catch {
    // Panne, disjoncteur ouvert ou quota de l'IA : l'estimation se replie sur la marque et la catégorie.
    return null;
  }
}

// ---------------------------------------------------------------- moteur (pur une fois les vecteurs connus)

/** Choix des comparables d'une cible. */
export interface ComparableSelection {
  method: "embeddings" | "brand_category" | "brand" | "none";
  comparables: PricingComparable[];
  /** Niveau de confiance des comparables (règles de Radar). */
  level: PriceConfidenceLevel;
  averageSimilarity: number | null;
}

/** Comparables proches nécessaires pour estimer par similarité (sinon : marque et catégorie). */
const MIN_SIMILAR = 2;

/**
 * Comparables d'une cible : par similarité (même catégorie, 8 au plus au-dessus de 0,6, 2 au moins), sinon
 * même marque et catégorie (3 au moins), sinon même marque (2 au moins), sinon aucun.
 */
export function selectComparables(target: PricingTarget, pool: readonly PricingComparable[], vectors?: { target: readonly number[] | null; pool: Map<string, number[]> } | null): ComparableSelection {
  if (vectors?.target) {
    const candidates = target.category ? pool.filter((c) => c.category === target.category) : pool;
    const near = candidates
      .map((c) => ({ c, v: vectors.pool.get(`${c.kind}:${c.ref}`) }))
      .filter((x): x is { c: PricingComparable; v: number[] } => !!x.v)
      .map((x) => ({ c: x.c, sim: cosineSimilarity(vectors.target!, x.v) }))
      .filter((x) => x.sim >= RADAR_EMBEDDING_MIN_SIMILARITY)
      .sort((a, b) => b.sim - a.sim || a.c.ref.localeCompare(b.c.ref))
      .slice(0, RADAR_EMBEDDING_TOP_K);
    if (near.length >= MIN_SIMILAR) {
      const avg = near.reduce((s, x) => s + x.sim, 0) / near.length;
      return { method: "embeddings", comparables: near.map((x) => x.c), level: near.length >= 5 && avg >= 0.75 ? "high" : near.length >= 3 ? "medium" : "low", averageSimilarity: Math.round(avg * 100) / 100 };
    }
  }
  const brand = norm(target.brand);
  if (brand) {
    const sameBrand = pool.filter((c) => norm(c.brand) === brand);
    const sameBrandCat = sameBrand.filter((c) => c.category === target.category);
    if (sameBrandCat.length >= 3) return { method: "brand_category", comparables: sameBrandCat, level: "high", averageSimilarity: null };
    if (sameBrand.length >= 2) return { method: "brand", comparables: sameBrand, level: "medium", averageSimilarity: null };
  }
  return { method: "none", comparables: [], level: "low", averageSimilarity: null };
}

/** Estimation détaillée (avant l'explication). */
export interface EngineEstimate extends Omit<PriceEstimate, "explanation" | "explanationSource"> {
  selection: ComparableSelection;
  weights: { comparables: number; model: number };
}

/** Combine les comparables choisis et la prédiction du modèle (règle documentée en tête de fichier). */
export function combineEstimate(target: PricingTarget, selection: ComparableSelection, model: PriceModelLike | null): EngineEstimate {
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
  let prediction: PricePredictionLike | null = null;
  if (model) {
    try {
      prediction = model.predict({ ...target, category: target.category ?? "other" });
      if (![prediction.p25, prediction.p50, prediction.p75].every((v) => Number.isFinite(v) && v >= 0)) prediction = null;
    } catch {
      prediction = null;
    }
  }
  const demo = prediction !== null && (model?.synthetic === true || (prediction.dataOrigin !== undefined && prediction.dataOrigin !== "real"));
  const factors: string[] = [];
  const n = selection.comparables.length;
  if (comp) {
    const fromBase = selection.comparables.filter((c) => c.kind === "market").length;
    const what = selection.method === "embeddings" ? "proches par le titre" : selection.method === "brand_category" ? "de même marque et catégorie" : "de la marque";
    factors.push(`${n} vente(s) comparable(s) ${what}${fromBase ? `, dont ${fromBase} de la base de références` : ""}`);
    const estimated = selection.comparables.filter((c) => c.estimated).length;
    if (estimated) factors.push(`${estimated} prix final estimé(s) au dernier prix affiché (annonces disparues)`);
    if (target.condition) factors.push(`État : ${ITEM_CONDITION_LABELS[target.condition]}`);
  }
  if (prediction) factors.push(`Modèle de prix${model?.version ? ` ${model.version}` : ""}${demo ? " (données de démonstration)" : ""}`);

  if (!comp && !prediction) {
    return { p25: null, p50: null, p75: null, delayDays: null, confidence: 0, confidenceLevel: "low", method: "none", strategies: null, comparableCount: 0, modelVersion: null, factors: [], demo: false, message: PRICE_NOT_ENOUGH_REFERENCES, selection, weights: { comparables: 0, model: 0 } };
  }
  const method: PriceMethod = comp && prediction ? "blend" : comp ? (selection.method === "embeddings" ? "embeddings" : "comparables") : "model";
  const wc = comp && prediction ? comparablesWeight(n) : comp ? 1 : 0;
  const wm = Math.round((1 - wc) * 1000) / 1000;
  const mix = (c: number | undefined, m: number | undefined) => Math.round((c ?? 0) * wc + (m ?? 0) * wm);
  const [p25, p50, p75] = [mix(comp?.p25, prediction?.p25), mix(comp?.p50, prediction?.p50), mix(comp?.p75, prediction?.p75)].sort((a, b) => a - b) as [number, number, number];
  const compDelay: number | null = comp?.delay ?? null;
  const modelDelay: number | null = prediction && typeof prediction.delayDays === "number" && Number.isFinite(prediction.delayDays) ? prediction.delayDays : null;
  const delayDays: number | null = compDelay !== null && modelDelay !== null ? compDelay * wc + modelDelay * wm : compDelay ?? modelDelay;
  const confidence = Math.round(((comp?.confidence ?? 0) * wc + (prediction ? confidenceValue(prediction.confidence) : 0) * wm) * 100) / 100;
  if (method === "blend") factors.push(`Poids des comparables : ${Math.round(wc * 100)} %`);
  if (delayDays !== null) factors.push(`Délai de vente estimé : ${Math.round(delayDays)} jours`);
  return {
    p25, p50, p75,
    delayDays: delayDays === null ? null : Math.round(delayDays * 10) / 10,
    confidence,
    confidenceLevel: method === "embeddings" || method === "comparables" ? selection.level : confidenceLevel(confidence),
    method,
    strategies: { fast: roundPrice(p25), standard: roundPrice(p50), max: roundPrice(p75) },
    comparableCount: n,
    modelVersion: prediction ? model?.version ?? null : null,
    factors: factors.slice(0, 12),
    demo,
    message: demo ? `${PRICE_MODEL_DEMO_DATA} : le modèle de prix a été entraîné sur le simulateur.` : null,
    selection,
    weights: { comparables: wc, model: wm },
  };
}

/**
 * Estimations de plusieurs cibles avec les mêmes comparables (une lecture Radar : un seul chargement, une
 * seule passe d'embeddings). Sans explication.
 */
export async function estimateMany(ctx: OrgContext, targets: readonly PricingTarget[], pools: PricingPools): Promise<EngineEstimate[]> {
  const pool = [...pools.sales, ...pools.references];
  const sim = targets.length > 0 && pool.length > 0 ? await similarityContext(ctx, targets, pools) : null;
  const model = ctx.services.pricing?.model ?? null;
  return targets.map((t, i) => combineEstimate(t, selectComparables(t, pool, sim ? { target: sim.targets[i] ?? null, pool: sim.pool } : null), model));
}

// ---------------------------------------------------------------- explication par mon IA perso

/** Passage par la file et le disjoncteur de la passerelle IA (comme les autres requêtes). */
export async function runStructuredAi<T>(services: Services, req: StructuredRequest<T>, signal?: AbortSignal): Promise<StructuredResult<T>> {
  const ai = services.ai;
  const kind = req.kind ?? "structured";
  ai.metrics.start(kind);
  try {
    const res = await ai.queue.enqueue(() => ai.breaker.run(() => ai.provider.generateStructured(req, { signal, timeoutMs: ai.limits.timeoutMs })), signal);
    ai.metrics.success(res.latencyMs, res.usage, kind);
    return res;
  } catch (err) {
    const e = toAIError(err);
    ai.metrics.failure(kind, e.code);
    throw e;
  }
}

/** Quota IA du mois (plan et réglage de l'organisation) : vrai s'il reste au moins une requête. */
export async function aiQuotaLeftTx(tx: Tx, services: Services, orgId: string): Promise<{ enabled: boolean; left: boolean; quota: number }> {
  const org = await repos.orgs.byId(tx, orgId);
  const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
  const now = services.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const quota = Math.min(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota || Infinity);
  return { enabled: org.settings.ai.enabled, left: (await repos.aiRequests.countSince(tx, monthStart)) < quota, quota };
}

/**
 * Explication en mots (facultative, jamais bloquante) : rien si l'IA est désactivée, le quota atteint, ou si
 * mon IA perso échoue ou cite un montant ou un chiffre absent des faits (sortie écartée).
 */
async function explain(ctx: OrgContext, features: PriceFeatures, est: EngineEstimate, signal?: AbortSignal): Promise<{ explanation: string | null; explanationSource: "ai" | null }> {
  if (est.method === "none" || !est.strategies) return { explanation: null, explanationSource: null };
  const pctx: PriceExplanationContext = {
    item: { title: features.title ?? null, brand: features.brand ?? null, category: ITEM_CATEGORY_LABELS[features.category], condition: features.condition ? ITEM_CONDITION_LABELS[features.condition] : null, size: features.size ?? null },
    prices: { fastCents: est.strategies.fast, standardCents: est.strategies.standard, maxCents: est.strategies.max },
    methodLabel: PRICE_METHOD_LABELS[est.method],
    comparableCount: est.comparableCount,
    delayDays: est.delayDays,
    confidenceLevel: est.confidenceLevel,
    factors: est.factors,
    demo: est.demo,
  };
  const gate = await withOrg(ctx, async (tx) => {
    const q = await aiQuotaLeftTx(tx, ctx.services, ctx.orgId);
    if (!q.enabled || !q.left) return null;
    // Requête décomptée du quota IA comme les autres (sorte « summary » : un résumé en mots).
    return repos.aiRequests.create(tx, { kind: "summary", provider: ctx.services.ai.provider.name, model: ctx.services.ai.provider.model, status: "running" });
  });
  if (!gate) return { explanation: null, explanationSource: null };
  const started = Date.now();
  try {
    const res = await runStructuredAi(ctx.services, buildPriceExplanationRequest(pctx), signal);
    const v = validatePriceExplanation(res.data.explanation, { allowedPricesCents: [est.strategies.fast, est.strategies.standard, est.strategies.max], facts: [...priceExplanationFacts(pctx), features.title ?? ""] });
    await withOrg(ctx, async (tx) => {
      await repos.aiRequests.update(tx, gate.id, { status: v.ok ? "succeeded" : "rejected", validated: v.ok, rejectionReason: v.ok ? null : v.reason.slice(0, 300), promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens, latencyMs: Math.max(res.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
      await repos.usage.record(tx, "ai.request", { requestId: gate.id, kind: "price_explanation" });
    });
    return v.ok ? { explanation: v.explanation, explanationSource: "ai" } : { explanation: null, explanationSource: null };
  } catch (err) {
    const e = err instanceof AIError ? err : toAIError(err);
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, gate.id, { status: e.code === "timeout" ? "timeout" : e.code === "cancelled" ? "cancelled" : "failed", error: e.message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) })).catch(() => undefined);
    return { explanation: null, explanationSource: null };
  }
}

// ---------------------------------------------------------------- API du service

/** Retire le détail interne (sélection, poids) d'une estimation. */
export function publicEstimate(est: EngineEstimate, explanation: { explanation: string | null; explanationSource: "ai" | null } = { explanation: null, explanationSource: null }): PriceEstimate {
  const { selection: _s, weights: _w, ...rest } = est;
  return { ...rest, explanation: explanation.explanation, explanationSource: explanation.explanationSource };
}

/**
 * Estimation d'un article : comparables (ventes de l'organisation et base de références), modèle de prix,
 * trois stratégies arrondies, explication en mots si demandée. Sans modèle ni comparable : méthode « none »
 * et « pas assez de références ».
 */
export async function estimate(ctx: OrgContext, raw: unknown, opts: { explain?: boolean; signal?: AbortSignal; pools?: PricingPools } = {}): Promise<PriceEstimate> {
  requireAction(ctx, "items.read");
  const parsed = priceEstimateInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Caractéristiques invalides", 400, parsed.error.flatten());
  const { explain: explainInput, ...features } = parsed.data;
  const wantExplanation = opts.explain ?? explainInput;
  if (wantExplanation) requireAction(ctx, "ai.use");
  const pools = opts.pools ?? (await withOrg(ctx, (tx) => loadPoolsTx(tx, [features])));
  const [est] = await estimateMany(ctx, [features], pools);
  return publicEstimate(est!, wantExplanation ? await explain(ctx, features, est!, opts.signal) : undefined);
}

// ---------------------------------------------------------------- base de références depuis les ventes

/** Date ramenée au jour (UTC) : moins de quasi-identifiants dans la base de références. */
export function dayIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())).toISOString();
}

/** Nombre de photos par tranches (0, 1, 2–3, 4–5, 6–9, 10 et plus) : borne basse de la tranche. */
export function photoBucket(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return n >= 10 ? 10 : n >= 6 ? 6 : n >= 4 ? 4 : n >= 2 ? 2 : Math.max(0, Math.floor(n));
}

const saleKey = (prefix: "sale" | "demo", orgId: string, orderId: string) => `${prefix}:${createHash("sha256").update(`${orgId}:${orderId}`, "utf8").digest("hex")}`;

export interface SalesReferencesResult {
  /** Références écrites (ajoutées ou mises à jour). */
  written: number;
  /** Références retirées : vente remboursée, annulée ou supprimée, ou accord retiré. */
  removed: number;
  /** Faux : l'organisation n'a pas donné son accord (rien n'est versé, tout est retiré). */
  shared: boolean;
}

/**
 * Verse les ventes de l'organisation dans la base de références SI ELLE L'A ACCEPTÉ
 * (`settings.pricing.shareSales`, désactivé par défaut, à valider juridiquement) : SANS donnée personnelle
 * (ni client, ni titre, ni identifiant de commande : clé = empreinte de l'organisation et de la commande, ni
 * photo), dates au jour, nombre de photos par tranches. Les ventes simulées deviennent des références
 * « demo ». Les références déjà versées dont la commande n'est plus éligible (remboursée, annulée, en
 * attente, supprimée) sont retirées ; sans accord, toutes le sont. Ces ventes ne servent qu'à
 * l'entraînement agrégé du modèle (jamais comme comparables d'une autre organisation).
 */
export async function addReferencesFromSales(services: Services, orgId: string): Promise<SalesReferencesResult> {
  return services.db.withOrg(orgId, async (tx) => {
    const org = await repos.orgs.byId(tx, orgId);
    if (!org.settings.pricing.shareSales) {
      return { written: 0, removed: await repos.priceReferences.deleteContributed(tx, orgId), shared: false };
    }
    const items = new Map((await repos.items.all(tx)).map((i) => [i.id, i]));
    const rows: (PriceReferenceInput & { contributorOrgId: string })[] = [];
    for (const o of await repos.orders.all(tx)) {
      if (o.status === "cancelled" || o.status === "refunded" || o.status === "pending") continue;
      const it = items.get(o.itemId);
      if (!it) continue;
      const source: PriceReferenceSource = o.simulated || o.provider === "demo" ? "demo" : "sale";
      const statsKnown = it.listingStats.updatedAt !== null;
      rows.push({
        dedupeKey: saleKey(source === "demo" ? "demo" : "sale", orgId, o.id),
        source,
        status: "sold",
        brand: it.brand?.trim() || null,
        category: it.category,
        subcategory: null,
        size: it.size?.trim() || null,
        material: it.attributes.material?.trim() || null,
        color: it.attributes.colors[0]?.trim() || null,
        condition: it.condition,
        listedPriceCents: it.listedPriceCents ?? o.salePriceCents,
        finalPriceCents: o.salePriceCents,
        finalPriceEstimated: false,
        // Mise en ligne inconnue : rien d'inventé (pas de délai de 0 jour).
        listedAt: dayIso(it.listedAt),
        soldAt: dayIso(o.createdAt),
        photoCount: photoBucket(Math.min(30, it.photos.length)),
        views: statsKnown ? it.listingStats.views : null,
        favorites: statsKnown ? it.listingStats.favorites : null,
        contributorOrgId: orgId,
      });
    }
    const removed = await repos.priceReferences.deleteContributed(tx, orgId, rows.map((r) => r.dedupeKey));
    const written = rows.length ? await repos.priceReferences.upsertMany(tx, rows) : 0;
    return { written, removed, shared: true };
  });
}

/** Conservation de la base de références (24 mois après la vente ou la mise en ligne) : passage quotidien du worker. */
export function purgeReferences(services: Services, now: Date = services.now()): Promise<number> {
  const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - PRICE_REFERENCE_RETENTION_MONTHS, now.getUTCDate())).toISOString();
  return services.db.withGlobal((tx) => repos.priceReferences.purgeBefore(tx, before));
}

// ---------------------------------------------------------------- modèle de prix : entraînement et état

const TRAINING_SOURCE: Record<PriceReferenceSource, PriceTrainingRow["source"]> = { sale: "client_sale", track: "track", import: "provided_base", demo: "demo" };

/**
 * Références → lignes d'entraînement (champs autorisés de @selio/pricing seulement). Une référence sans date
 * de mise en ligne garde sa date de vente comme date de l'événement, SANS date de vente séparée : son délai
 * reste inconnu (jamais un délai de 0 jour inventé). Le marquage « prix final estimé » est transmis.
 */
export function trainingRows(refs: readonly PriceReference[]): PriceTrainingRow[] {
  const out: PriceTrainingRow[] = [];
  for (const r of refs) {
    const listed = r.listedPriceCents ?? r.finalPriceCents;
    if (listed === null) continue;
    const listedKnown = r.listedAt !== null;
    out.push({
      brand: r.brand ?? "", category: r.category, subcategory: r.subcategory, size: r.size, material: r.material, color: r.color, condition: r.condition,
      listedPriceCents: listed, finalPriceCents: r.finalPriceCents, finalPriceEstimated: r.finalPriceCents !== null && r.finalPriceEstimated,
      listedAt: r.listedAt ?? r.soldAt ?? r.createdAt, soldAt: listedKnown ? r.soldAt : null,
      photoCount: r.photoCount, views: r.views, favorites: r.favorites, source: TRAINING_SOURCE[r.source],
    });
  }
  return out;
}

export type TrainModelResult =
  | { trained: true; record: PriceModelRecord; synthetic: boolean; references: number }
  | { trained: false; reason: string; references: number };

/** Ventes lues au plus pour un entraînement (les plus récentes d'abord). */
export const PRICING_TRAIN_MAX_ROWS = 200_000;

/**
 * Entraîne le modèle de prix sur la base de références (tâche hebdomadaire du worker) : seulement les
 * VENTES (prix final connu ou estimé ; une annonce encore en ligne n'apprend rien au modèle de prix), les
 * réelles si elles suffisent (PRICE_MODEL_MIN_REFERENCES), sinon celles du simulateur, marquées « données de
 * démonstration ». Refuse en dessous du seuil, sans entraîneur, ou si l'entraîneur refuse. Le nouveau modèle
 * devient actif (l'ancien est archivé) et est rechargé si un `loader` est fourni.
 */
export async function trainActiveModel(services: Services, opts: { now?: Date; minReferences?: number } = {}): Promise<TrainModelResult> {
  const now = opts.now ?? services.now();
  const trainer = services.pricing?.trainer;
  // Seuil du serveur (PRICING_MIN_REFERENCES) : jamais sous celui des contrats (l'entraîneur refuse en dessous).
  const minimum = Math.max(PRICE_MODEL_MIN_REFERENCES, Math.round(opts.minReferences ?? PRICE_MODEL_MIN_REFERENCES));
  const all = await services.db.withGlobal((tx) => repos.priceReferences.search(tx, { includeDemo: true, withFinalPrice: true, limit: PRICING_TRAIN_MAX_ROWS }));
  const real = all.filter((r) => r.source !== "demo");
  const synthetic = real.length < minimum;
  const refs = synthetic ? all.filter((r) => r.source === "demo") : real;
  if (refs.length < minimum) return { trained: false, reason: `Pas assez de ventes pour entraîner le modèle de prix (${real.length} réelles, ${all.length - real.length} de démonstration ; ${minimum} nécessaires).`, references: all.length };
  if (!trainer) return { trained: false, reason: "Aucun entraîneur de modèle de prix n'est disponible dans ce processus (worker).", references: refs.length };
  const rows = trainingRows(refs);
  let outcome: PriceTrainOutcome;
  try {
    outcome = await trainer.train(rows, { now, synthetic });
  } catch (err) {
    return { trained: false, reason: `Entraînement en échec : ${err instanceof Error ? err.message.slice(0, 200) : "erreur"}`, references: rows.length };
  }
  if (!outcome.ok) return { trained: false, reason: outcome.reason, references: rows.length };
  const ok = outcome;
  const record = await services.db.withGlobal((tx) => repos.priceModels.activate(tx, { version: ok.version, trainedAt: now.toISOString(), nReferences: ok.nReferences ?? rows.length, metrics: ok.metrics, model: ok.model, synthetic }));
  if (services.pricing?.loader) {
    try {
      services.pricing.model = services.pricing.loader({ version: record.version, model: ok.model, synthetic });
    } catch {
      // Le modèle reste enregistré ; il sera rechargé au prochain démarrage (refreshActiveModel).
    }
  }
  return { trained: true, record, synthetic, references: rows.length };
}

/** Recharge le modèle actif enregistré dans `services.pricing.model` (démarrage de l'API et du worker). */
export async function refreshActiveModel(services: Services): Promise<PriceModelRecord | null> {
  const active = await services.db.withGlobal((tx) => repos.priceModels.active(tx));
  if (!active || !services.pricing?.loader) return active;
  services.pricing.model = services.pricing.loader({ version: active.version, model: active.model, synthetic: active.synthetic });
  return active;
}

/** État du modèle pour l'interface : « modèle non entraîné », « données de démonstration » ou date d'entraînement. */
export async function getModelStatus(ctx: OrgContext): Promise<PriceModelStatus> {
  requireAction(ctx, "org.read");
  const active = await ctx.services.db.withGlobal((tx) => repos.priceModels.active(tx));
  if (!active) return { trained: false, version: null, trainedAt: null, nReferences: 0, metrics: null, synthetic: false, label: PRICE_MODEL_NOT_TRAINED };
  const { model: _m, ...record } = active;
  return {
    trained: true, version: record.version, trainedAt: record.trainedAt, nReferences: record.nReferences,
    // Mesures d'un modèle de démonstration : gardées pour l'équipe, jamais présentées comme une mesure réelle.
    metrics: record.synthetic ? null : record.metrics, synthetic: record.synthetic,
    label: record.synthetic ? PRICE_MODEL_DEMO_DATA : `Modèle entraîné le ${new Date(record.trainedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} sur ${record.nReferences} références`,
  };
}
