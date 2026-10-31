import type { BuyerFees, InventoryItem, ItemCondition, Opportunity, Order, RadarSearch } from "@selio/contracts";
import { computeMargin } from "./pricing";
import { purchaseCost } from "./buying";
import { ratio, type Cents } from "./money";

export interface Comparable {
  brand: string | null;
  category: string | null;
  condition: ItemCondition | null;
  salePriceCents: Cents;
}

/** Comparables issus des ventes réelles/démo de l'organisation. */
export function comparablesFromSales(orders: Iterable<Order>, items: Map<string, InventoryItem>): Comparable[] {
  const out: Comparable[] = [];
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "refunded") continue;
    const it = items.get(o.itemId);
    if (!it) continue;
    out.push({ brand: it.brand, category: it.category, condition: it.condition, salePriceCents: o.salePriceCents });
  }
  return out;
}

/** Comparables issus des ventes observées sur le marché (radar, extension, simulateur). */
export function comparablesFromMarket(observations: Iterable<{ status: string; brand: string | null; category: string | null; priceCents: Cents }>): Comparable[] {
  const out: Comparable[] = [];
  for (const o of observations) if (o.status === "sold") out.push({ brand: o.brand, category: o.category, condition: null, salePriceCents: o.priceCents });
  return out;
}

export interface Estimate {
  resalePriceCents: Cents;
  confidence: "low" | "medium" | "high";
  method: string;
  comparableCount: number;
}

const CONDITION_FACTOR: Record<ItemCondition, number> = {
  new_with_tags: 1.15,
  new_without_tags: 1.05,
  very_good: 1,
  good: 0.9,
  satisfactory: 0.75,
};

/**
 * Estimation de revente : médiane des comparables (marque + catégorie),
 * sinon marque seule, sinon repli sur un multiple prudent du prix observé.
 * L'estimation est toujours annoncée comme telle, jamais comme une donnée observée.
 */
export function estimateResale(observed: { priceCents: Cents; brand: string | null; category: string | null; condition: ItemCondition | null }, comparables: Comparable[]): Estimate {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const sameBrandCat = comparables.filter((c) => norm(c.brand) === norm(observed.brand) && c.category === observed.category && observed.brand);
  const sameBrand = comparables.filter((c) => norm(c.brand) === norm(observed.brand) && observed.brand);
  const factor = observed.condition ? CONDITION_FACTOR[observed.condition] : 0.95;
  const pick = (set: Comparable[], label: string, confidence: Estimate["confidence"]): Estimate => {
    const prices = set.map((c) => c.salePriceCents).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid]! : Math.round((prices[mid - 1]! + prices[mid]!) / 2);
    return { resalePriceCents: Math.round(median * factor), confidence, method: label, comparableCount: set.length };
  };
  if (sameBrandCat.length >= 3) return pick(sameBrandCat, "Médiane des ventes même marque et catégorie, ajustée à l'état", "high");
  if (sameBrand.length >= 2) return pick(sameBrand, "Médiane des ventes de la marque, ajustée à l'état", "medium");
  return {
    resalePriceCents: Math.round(observed.priceCents * 1.6 * factor),
    confidence: "low",
    method: "Aucun comparable : multiple prudent du prix observé (×1,6), ajusté à l'état",
    comparableCount: 0,
  };
}

export interface ScorePart {
  key: "margin" | "margin_rate" | "condition_photos" | "brand_demand" | "seller" | "shipping_freshness";
  label: string;
  points: number;
  max: number;
}

export interface Scored {
  score: number;
  reasons: string[];
  breakdown: ScorePart[];
  marginCents: Cents;
  marginRate: number;
  /** Coût total d'achat retenu (prix + port + frais acheteur si fournis). */
  costCents: Cents;
}

/** Informations complémentaires observées sur l'annonce (toutes facultatives). */
export interface OpportunitySignals {
  condition?: ItemCondition | null;
  photoCount?: number | null;
  sellerRating?: number | null;
  sellerReviews?: number | null;
  /** Frais acheteur (protection) à ajouter au coût. */
  fees?: BuyerFees | null;
}

const CONDITION_POINTS: Record<ItemCondition, number> = { new_with_tags: 10, new_without_tags: 9, very_good: 8, good: 6, satisfactory: 3 };

/**
 * Note sur 100, expliquée critère par critère :
 * - marge estimée (port et frais acheteur inclus) vs marge cible : 40 pts ;
 * - taux de marge vs taux cible : 15 pts ;
 * - état et qualité des photos : 15 pts ;
 * - marque et demande (ventes comparables) : 15 pts ;
 * - fiabilité du vendeur (note, nombre d'avis) : 10 pts ;
 * - port et fraîcheur de l'annonce : 5 pts.
 * Hors budget : plafonnée à 59 (« affaire faible »). Marge nulle ou négative : plafonnée à 10.
 */
export function scoreOpportunity(
  observed: { priceCents: Cents; shippingCents: number; seenAt: string },
  estimate: Estimate,
  search: Pick<RadarSearch, "budgetCents" | "targetMarginCents" | "targetMarginRate">,
  expectedFeesCents: Cents,
  now: Date,
  signals: OpportunitySignals = {},
): Scored {
  const cost = purchaseCost(observed, signals.fees).totalCents;
  const m = computeMargin({ salePriceCents: estimate.resalePriceCents, platformFeeCents: expectedFeesCents, purchasePriceCents: cost });
  const reasons: string[] = [];
  const breakdown: ScorePart[] = [];
  const add = (part: ScorePart, reason: string) => {
    breakdown.push(part);
    reasons.push(reason);
  };
  const eur = (c: number) => `${(c / 100).toFixed(0)} €`;

  const marginVsTarget = ratio(m.marginCents, Math.max(1, search.targetMarginCents));
  const marginPts = Math.max(0, Math.min(40, Math.round(marginVsTarget * 30)));
  add({ key: "margin", label: "Marge estimée", points: marginPts, max: 40 }, `Marge estimée ${eur(m.marginCents)} (achat ${eur(cost)} tout compris) vs cible ${eur(search.targetMarginCents)} : +${marginPts}/40.`);

  const ratePts = m.marginRate >= search.targetMarginRate ? 15 : Math.max(0, Math.round((m.marginRate / Math.max(0.01, search.targetMarginRate)) * 15));
  add({ key: "margin_rate", label: "Taux de marge", points: ratePts, max: 15 }, `Taux de marge ${(m.marginRate * 100).toFixed(0)} % vs cible ${(search.targetMarginRate * 100).toFixed(0)} % : +${ratePts}/15.`);

  const condPts = signals.condition ? CONDITION_POINTS[signals.condition] : 5;
  const photos = signals.photoCount ?? null;
  const photoPts = photos === null ? 2 : photos >= 5 ? 5 : photos >= 3 ? 3 : photos >= 1 ? 1 : 0;
  add({ key: "condition_photos", label: "État et photos", points: condPts + photoPts, max: 15 }, `État ${signals.condition ? "déclaré" : "non précisé"} (+${condPts}) et ${photos === null ? "photos non comptées" : `${photos} photo(s)`} (+${photoPts}) : +${condPts + photoPts}/15.`);

  const demandPts = estimate.confidence === "high" ? 15 : estimate.confidence === "medium" ? 10 : 4;
  add({ key: "brand_demand", label: "Marque et demande", points: demandPts, max: 15 }, `Demande prouvée par ${estimate.comparableCount} vente(s) comparable(s), confiance ${estimate.confidence} : +${demandPts}/15.`);

  const rating = signals.sellerRating ?? null;
  const reviews = signals.sellerReviews ?? 0;
  const sellerPts = rating === null ? 5 : rating >= 4.8 && reviews >= 20 ? 10 : rating >= 4.5 ? 8 : rating >= 4 ? 5 : 2;
  // Texte générique : ni la note ni le nombre d'avis du vendeur ne sont recopiés dans les raisons (elles
  // restent après la purge des données du vendeur, 30 jours) ; la note reste dans `observed` le temps de l'affaire.
  add({ key: "seller", label: "Fiabilité du vendeur", points: sellerPts, max: 10 }, rating === null ? "Vendeur sans note visible : +5/10." : `Fiabilité du vendeur (note et avis visibles sur l'annonce) : +${sellerPts}/10.`);

  const ageH = (now.getTime() - new Date(observed.seenAt).getTime()) / 3_600_000;
  const freshPts = ageH < 6 ? 3 : ageH < 48 ? 2 : 0;
  const shipPts = observed.shippingCents <= 500 ? 2 : observed.shippingCents <= 800 ? 1 : 0;
  add({ key: "shipping_freshness", label: "Port et délai", points: freshPts + shipPts, max: 5 }, `${ageH < 6 ? "Annonce de moins de 6 h" : ageH < 48 ? "Annonce de moins de 48 h" : "Annonce ancienne"}, port ${eur(observed.shippingCents)} : +${freshPts + shipPts}/5.`);

  let score = breakdown.reduce((s, p) => s + p.points, 0);
  if (cost > search.budgetCents) {
    score = Math.min(score, 59);
    reasons.push(`Coût total ${eur(cost)} au-dessus du budget ${eur(search.budgetCents)} : note plafonnée à 59.`);
  }
  if (m.marginCents <= 0) {
    score = Math.min(score, 10);
    reasons.push("Marge estimée nulle ou négative : note plafonnée à 10.");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons, breakdown, marginCents: m.marginCents, marginRate: m.marginRate, costCents: cost };
}

export function rankOpportunities(list: Opportunity[]): Opportunity[] {
  return [...list].sort((a, b) => b.score - a.score || b.estimate.marginCents - a.estimate.marginCents);
}

// ---------------------------------------------------------------- comparables par similarité (modèle 2)

/** Vente comparable avec son texte (titre de l'annonce), pour la recherche par similarité. */
export interface TitledComparable {
  /** Référence stable (identifiant de la commande, de l'observation…) : clé du cache d'embeddings. */
  ref: string;
  /** Texte vectorisé : marque et titre, sans aucune donnée de personne. */
  text: string;
  comparable: Comparable;
}

/**
 * Texte vectorisé d'une annonce : la marque (si le titre ne la contient pas déjà) puis le titre.
 * Jamais de pseudo, de nom ni de donnée de personne.
 */
export function comparableText(title: string, brand: string | null | undefined): string {
  const t = title.replace(/\s+/g, " ").trim();
  const b = (brand ?? "").replace(/\s+/g, " ").trim();
  if (!b || t.toLowerCase().includes(b.toLowerCase())) return t.slice(0, 300);
  return `${b} ${t}`.slice(0, 300);
}

/** Ventes de l'organisation avec leur titre (commandes non annulées ni remboursées), les plus récentes d'abord. */
export function titledComparablesFromSales(orders: Iterable<Order>, items: Map<string, InventoryItem>, limit = 500): TitledComparable[] {
  const out: (TitledComparable & { at: string })[] = [];
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "refunded") continue;
    const it = items.get(o.itemId);
    if (!it || !it.title.trim()) continue;
    out.push({ ref: o.id, text: comparableText(it.title, it.brand), at: o.createdAt, comparable: { brand: it.brand, category: it.category, condition: it.condition, salePriceCents: o.salePriceCents } });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.max(0, limit)).map(({ at: _at, ...rest }) => rest);
}

/** Similarité cosinus de deux vecteurs (0 si l'un est nul ou si les tailles diffèrent). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SimilarComparable {
  comparable: Comparable;
  ref: string;
  similarity: number;
}

/**
 * Les `k` comparables les plus proches du vecteur cible, au-dessus du seuil de similarité
 * (par défaut 8 au-dessus de 0,6), du plus proche au moins proche.
 */
export function nearestComparables(target: readonly number[], pool: readonly { ref: string; vector: readonly number[]; comparable: Comparable }[], opts: { k?: number; minSimilarity?: number } = {}): SimilarComparable[] {
  const k = opts.k ?? 8;
  const min = opts.minSimilarity ?? 0.6;
  return pool
    .map((p) => ({ ref: p.ref, comparable: p.comparable, similarity: cosineSimilarity(target, p.vector) }))
    .filter((p) => p.similarity >= min)
    .sort((a, b) => b.similarity - a.similarity || a.ref.localeCompare(b.ref))
    .slice(0, Math.max(0, k));
}

/** Comparables proches nécessaires pour estimer par similarité (sinon : marque et catégorie). */
export const MIN_SIMILAR_COMPARABLES = 2;

/**
 * Estimation de revente par les ventes les plus proches (modèle 2) : médiane de leurs prix de vente,
 * ajustée à l'état de l'annonce. Null s'il y a moins de MIN_SIMILAR_COMPARABLES ventes proches :
 * l'appelant se replie alors sur `estimateResale` (marque et catégorie). Méthode « embeddings ».
 */
export function estimateResaleFromSimilar(observed: { condition: ItemCondition | null }, similar: readonly SimilarComparable[]): Estimate | null {
  if (similar.length < MIN_SIMILAR_COMPARABLES) return null;
  const prices = similar.map((s) => s.comparable.salePriceCents).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid]! : Math.round((prices[mid - 1]! + prices[mid]!) / 2);
  const factor = observed.condition ? CONDITION_FACTOR[observed.condition] : 0.95;
  const avg = similar.reduce((s, c) => s + c.similarity, 0) / similar.length;
  const confidence: Estimate["confidence"] = similar.length >= 5 && avg >= 0.75 ? "high" : similar.length >= 3 ? "medium" : "low";
  return { resalePriceCents: Math.round(median * factor), confidence, method: "embeddings", comparableCount: similar.length };
}

/** Explication d'une estimation, en français, pour la fiche de l'affaire. */
export function describeEstimate(e: Pick<Estimate, "method" | "comparableCount">, similarity?: { min: number }): string {
  if (e.method === "embeddings") return `Revente estimée par la médiane de ${e.comparableCount} vente(s) proche(s) (similarité de titre d'au moins ${String(similarity?.min ?? 0.6).replace(".", ",")}), ajustée à l'état.`;
  if (e.comparableCount > 0) return `Revente estimée par la médiane de ${e.comparableCount} vente(s) de même marque (et catégorie), ajustée à l'état.`;
  return "Revente estimée sans vente comparable : multiple prudent du prix observé (×1,6), ajusté à l'état.";
}
