import type { InventoryItem } from "@selio/contracts";
import { ratio, type Cents } from "./money";

/**
 * Selio Studio › « Ce qui performe » : ce que vos propres annonces apprennent.
 * Calcul pur et déterministe, sur les annonces déjà mises en ligne (en vente,
 * réservées, vendues ou retirées) : longueur du titre, photos, description,
 * attributs, prix face aux ventes comparables, rédaction IA ou manuelle.
 * Aucun chiffre extérieur : seulement vos articles et vos ventes.
 */

/** En dessous de ce nombre d'annonces, un groupe n'est jamais comparé (trop peu de données). */
export const INSIGHT_MIN_SAMPLE = 3;
/** À partir de ce nombre d'annonces dans chacun des deux groupes, l'écart est présenté comme net. */
export const INSIGHT_SOLID_SAMPLE = 8;

export type InsightDimensionKey = "title" | "photos" | "description" | "attributes" | "brandInTitle" | "price" | "origin";

export interface InsightBucket {
  key: string;
  label: string;
  /** Annonces mises en ligne dans ce groupe. */
  count: number;
  sold: number;
  /** Vendues / mises en ligne. */
  sellRate: number;
  /** Délai médian entre la mise en ligne et la vente (jours), null sans vente. */
  medianDaysToSell: number | null;
  views: number;
  favorites: number;
  /** Favoris / vues (null sans vues). */
  favoriteRate: number | null;
}

export interface InsightFinding {
  dimension: InsightDimensionKey;
  metric: "sellRate" | "favoriteRate";
  best: InsightBucket;
  worst: InsightBucket;
  /** Écart absolu entre les deux groupes (points de taux). */
  gap: number;
  /** « solid » : au moins INSIGHT_SOLID_SAMPLE annonces de chaque côté ; sinon tendance à confirmer. */
  strength: "solid" | "trend";
  text: string;
}

export interface InsightDimension {
  key: InsightDimensionKey;
  label: string;
  question: string;
  buckets: InsightBucket[];
  finding: InsightFinding | null;
}

export interface ListingInsights {
  /** Annonces mises en ligne prises en compte, dont vendues, dont rédigées avec le générateur. */
  sample: { listed: number; sold: number; generated: number };
  dimensions: InsightDimension[];
  /** Les écarts les plus marqués (ventes d'abord, puis favoris), 3 au plus. */
  highlights: InsightFinding[];
}

export interface InsightSale {
  itemId: string | null;
  brand: string | null;
  category: string | null;
  salePriceCents: Cents;
}

const DAY = 86_400_000;

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

const pct = (r: number) => `${Math.round(r * 100)} %`;

/** Annonce déjà mise en ligne (seules celles-ci ont un rendement à mesurer). */
export function wasListed(item: Pick<InventoryItem, "status" | "listedAt">): boolean {
  return item.listedAt !== null && item.status !== "in_stock";
}

/** Annonce rédigée par le générateur (IA ou gabarit de secours). */
export function isGenerated(item: Pick<InventoryItem, "attributes" | "tags">): boolean {
  return item.attributes.generatedBy === "ai" || item.attributes.generatedBy === "fallback" || item.tags.includes("générateur");
}

/** Prix de référence : médiane des AUTRES ventes de la même marque et catégorie (au moins 2). */
function referencePrice(item: InventoryItem, sales: InsightSale[]): Cents | null {
  if (!item.brand) return null;
  const brand = norm(item.brand);
  const prices = sales.filter((s) => s.itemId !== item.id && s.brand && norm(s.brand) === brand && s.category === item.category).map((s) => s.salePriceCents);
  return prices.length >= 2 ? median(prices) : null;
}

interface Classifier {
  key: InsightDimensionKey;
  label: string;
  question: string;
  /** Groupes dans l'ordre d'affichage (`subject` : sujet du constat) ; `of` renvoie la clé du groupe, ou null pour exclure l'annonce. */
  buckets: { key: string; label: string; subject: string }[];
  of: (item: InventoryItem, sales: InsightSale[]) => string | null;
}

const CLASSIFIERS: Classifier[] = [
  {
    key: "title", label: "Longueur du titre", question: "Quelle longueur de titre se vend le mieux ?",
    buckets: [
      { key: "short", label: "Moins de 20 caractères", subject: "Les annonces au titre de moins de 20 caractères" },
      { key: "medium", label: "20 à 34 caractères", subject: "Les annonces au titre de 20 à 34 caractères" },
      { key: "long", label: "35 à 70 caractères", subject: "Les annonces au titre de 35 à 70 caractères" },
      { key: "xlong", label: "Plus de 70 caractères", subject: "Les annonces au titre de plus de 70 caractères" },
    ],
    of: (it) => { const n = it.title.trim().length; return n < 20 ? "short" : n < 35 ? "medium" : n <= 70 ? "long" : "xlong"; },
  },
  {
    key: "photos", label: "Nombre de photos", question: "Combien de photos faut-il ?",
    buckets: [
      { key: "1-2", label: "1 à 2 photos", subject: "Les annonces avec 1 à 2 photos" },
      { key: "3-4", label: "3 à 4 photos", subject: "Les annonces avec 3 à 4 photos" },
      { key: "5-7", label: "5 à 7 photos", subject: "Les annonces avec 5 à 7 photos" },
      { key: "8+", label: "8 photos ou plus", subject: "Les annonces avec 8 photos ou plus" },
    ],
    of: (it) => { const n = it.photos.length; return n <= 2 ? "1-2" : n <= 4 ? "3-4" : n <= 7 ? "5-7" : "8+"; },
  },
  {
    key: "description", label: "Longueur de la description", question: "Une description détaillée change-t-elle quelque chose ?",
    buckets: [
      { key: "short", label: "Moins de 80 caractères", subject: "Les annonces avec une description de moins de 80 caractères" },
      { key: "medium", label: "80 à 149 caractères", subject: "Les annonces avec une description de 80 à 149 caractères" },
      { key: "long", label: "150 caractères ou plus", subject: "Les annonces avec une description de 150 caractères ou plus" },
    ],
    of: (it) => { const n = it.description.trim().length; return n < 80 ? "short" : n < 150 ? "medium" : "long"; },
  },
  {
    key: "attributes", label: "Attributs renseignés", question: "Marque, taille et couleur : faut-il tout remplir ?",
    buckets: [
      { key: "complete", label: "Marque, taille et couleur", subject: "Les annonces avec marque, taille et couleur" },
      { key: "partial", label: "Au moins un attribut manquant", subject: "Les annonces où un attribut manque" },
    ],
    of: (it) => (it.brand && it.size && it.attributes.colors.length > 0 ? "complete" : "partial"),
  },
  {
    key: "brandInTitle", label: "Marque dans le titre", question: "Faut-il citer la marque dans le titre ?",
    buckets: [
      { key: "yes", label: "Marque dans le titre", subject: "Les annonces avec la marque dans le titre" },
      { key: "no", label: "Marque absente du titre", subject: "Les annonces sans la marque dans le titre" },
    ],
    of: (it) => (it.brand ? (norm(it.title).includes(norm(it.brand)) ? "yes" : "no") : null),
  },
  {
    key: "price", label: "Prix face aux ventes comparables", question: "Le prix affiché pèse-t-il sur la vente ?",
    buckets: [
      { key: "at", label: "Au prix des ventes comparables ou dessous", subject: "Les annonces au prix des ventes comparables ou en dessous" },
      { key: "above10", label: "Jusqu'à 10 % au-dessus", subject: "Les annonces jusqu'à 10 % au-dessus des ventes comparables" },
      { key: "above", label: "Plus de 10 % au-dessus", subject: "Les annonces à plus de 10 % au-dessus des ventes comparables" },
      { key: "none", label: "Sans vente comparable", subject: "Les annonces sans vente comparable" },
    ],
    of: (it, sales) => {
      if (it.listedPriceCents === null) return null;
      const ref = referencePrice(it, sales);
      if (ref === null) return "none";
      const r = it.listedPriceCents / ref;
      return r <= 1 ? "at" : r <= 1.1 ? "above10" : "above";
    },
  },
  {
    key: "origin", label: "Rédaction", question: "Les annonces rédigées avec le générateur font-elles mieux ?",
    buckets: [
      { key: "generated", label: "Rédigées avec le générateur", subject: "Les annonces rédigées avec le générateur" },
      { key: "manual", label: "Rédigées à la main", subject: "Les annonces rédigées à la main" },
    ],
    of: (it) => (isGenerated(it) ? "generated" : "manual"),
  },
];

function bucketStats(key: string, label: string, items: InventoryItem[]): InsightBucket {
  const sold = items.filter((i) => i.status === "sold");
  const days = sold.filter((i) => i.soldAt && i.listedAt).map((i) => Math.max(0, Math.round((new Date(i.soldAt!).getTime() - new Date(i.listedAt!).getTime()) / DAY)));
  const views = items.reduce((s, i) => s + i.listingStats.views, 0);
  const favorites = items.reduce((s, i) => s + i.listingStats.favorites, 0);
  return { key, label, count: items.length, sold: sold.length, sellRate: ratio(sold.length, items.length), medianDaysToSell: median(days), views, favorites, favoriteRate: views > 0 ? ratio(favorites, views) : null };
}

function findingFor(c: Classifier, buckets: InsightBucket[]): InsightFinding | null {
  const subject = (b: InsightBucket) => c.buckets.find((x) => x.key === b.key)?.subject ?? b.label;
  // « Sans vente comparable » n'est pas un choix de rédaction : jamais comparé.
  const eligible = buckets.filter((b) => b.count >= INSIGHT_MIN_SAMPLE && b.key !== "none");
  if (eligible.length < 2) return null;
  const strength = (a: InsightBucket, b: InsightBucket): InsightFinding["strength"] => (Math.min(a.count, b.count) >= INSIGHT_SOLID_SAMPLE ? "solid" : "trend");
  const bySell = [...eligible].sort((a, b) => b.sellRate - a.sellRate || b.count - a.count);
  const best = bySell[0]!;
  const worst = bySell[bySell.length - 1]!;
  if (best.sellRate - worst.sellRate >= 0.15) {
    return {
      dimension: c.key, metric: "sellRate", best, worst, gap: best.sellRate - worst.sellRate, strength: strength(best, worst),
      text: `${subject(best)} se vendent mieux : ${pct(best.sellRate)} vendues, contre ${pct(worst.sellRate)} pour « ${worst.label.toLowerCase()} » (${best.count} et ${worst.count} annonces).`,
    };
  }
  const withViews = eligible.filter((b) => b.favoriteRate !== null && b.views >= 100);
  if (withViews.length < 2) return null;
  const byFav = [...withViews].sort((a, b) => (b.favoriteRate ?? 0) - (a.favoriteRate ?? 0));
  const fBest = byFav[0]!;
  const fWorst = byFav[byFav.length - 1]!;
  const hi = fBest.favoriteRate ?? 0;
  const lo = fWorst.favoriteRate ?? 0;
  if (hi - lo >= 0.02 && (lo === 0 || hi / lo >= 1.3)) {
    return {
      dimension: c.key, metric: "favoriteRate", best: fBest, worst: fWorst, gap: hi - lo, strength: strength(fBest, fWorst),
      text: `${subject(fBest)} attirent plus de favoris : ${pct(hi)} des visiteurs, contre ${pct(lo)} pour « ${fWorst.label.toLowerCase()} » (${fBest.count} et ${fWorst.count} annonces).`,
    };
  }
  return null;
}

/**
 * Enseignements tirés de vos annonces : pour chaque critère, les groupes
 * d'annonces, leur taux de vente, leur délai médian et leur taux de favoris,
 * puis un constat seulement si l'écart est net et l'échantillon suffisant.
 */
export function listingInsights(items: InventoryItem[], sales: InsightSale[]): ListingInsights {
  const population = items.filter(wasListed);
  const dimensions: InsightDimension[] = CLASSIFIERS.map((c) => {
    const groups = new Map<string, InventoryItem[]>();
    for (const it of population) {
      const k = c.of(it, sales);
      if (k === null) continue;
      const list = groups.get(k);
      if (list) list.push(it);
      else groups.set(k, [it]);
    }
    const buckets = c.buckets.filter((b) => groups.has(b.key)).map((b) => bucketStats(b.key, b.label, groups.get(b.key)!));
    return { key: c.key, label: c.label, question: c.question, buckets, finding: findingFor(c, buckets) };
  });
  const highlights = dimensions
    .map((d) => d.finding)
    .filter((f): f is InsightFinding => f !== null)
    .sort((a, b) => (a.metric === b.metric ? b.gap - a.gap : a.metric === "sellRate" ? -1 : 1))
    .slice(0, 3);
  return {
    sample: { listed: population.length, sold: population.filter((i) => i.status === "sold").length, generated: population.filter(isGenerated).length },
    dimensions,
    highlights,
  };
}
