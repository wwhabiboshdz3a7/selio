import type { InventoryItem, MarginRules } from "@selio/contracts";
import { ratio, type Cents } from "./money";
import { republicationPlan, variantLeaderboard, type RepublicationPlan } from "./republish";

/**
 * Dressing intelligent : rendement de chaque annonce en ligne, note sur 100
 * et pistes d'amélioration concrètes. Calcul pur et déterministe, à partir
 * des statistiques affichées par la plateforme (vues, favoris, offres) et
 * du contenu de l'annonce.
 */

export { DEFAULT_REPUBLISH_AFTER_DAYS, daysOnline, lastOnlineAt } from "./online";
import { DEFAULT_REPUBLISH_AFTER_DAYS, daysOnline } from "./online";

export interface ListingTip {
  key: string;
  label: string;
  detail: string;
  impact: "high" | "medium" | "low";
  action: "republish" | "photos" | "price" | "offer_favorites" | "title" | "description" | "attributes" | null;
}

export interface ListingScorePart {
  key: "visibility" | "appeal" | "quality" | "price";
  label: string;
  points: number;
  max: number;
  hint: string;
}

export interface ListingBand {
  key: "excellent" | "good" | "improve" | "weak";
  label: string;
}

export interface ListingPerformance {
  score: number;
  band: ListingBand;
  daysOnline: number;
  views: number;
  favorites: number;
  offers: number;
  viewsPerDay: number;
  /** Favoris / vues. */
  favoriteRate: number;
  parts: ListingScorePart[];
  tips: ListingTip[];
  republishDue: boolean;
  /** Prix affiché / prix de marché (null si pas de référence). */
  priceVsMarket: number | null;
  marketPriceCents: Cents | null;
}

export interface ListingScoreContext {
  now: Date;
  rules?: MarginRules;
  marketPriceCents?: Cents | null;
  republishAfterDays?: number;
}

export function listingBand(score: number): ListingBand {
  if (score >= 80) return { key: "excellent", label: "Excellente" };
  if (score >= 60) return { key: "good", label: "Bonne" };
  if (score >= 40) return { key: "improve", label: "À améliorer" };
  return { key: "weak", label: "Faible" };
}

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Note d'annonce sur 100 :
 * - visibilité (vues par jour en ligne) : 25 ;
 * - attractivité (favoris / vues, offres reçues) : 25 ;
 * - qualité de l'annonce (photos, titre, description, attributs) : 30 ;
 * - prix vs marché (médiane des ventes comparables) : 20.
 */
export function scoreListing(item: InventoryItem, ctx: ListingScoreContext): ListingPerformance {
  const days = daysOnline(item, ctx.now) ?? 0;
  const { views, favorites, offers } = item.listingStats;
  const viewsPerDay = views / Math.max(1, days);
  const favoriteRate = ratio(favorites, views);
  const parts: ListingScorePart[] = [];
  const tips: ListingTip[] = [];

  const visPts = Math.round(25 * Math.min(1, Math.log1p(viewsPerDay) / Math.log1p(15)));
  parts.push({ key: "visibility", label: "Visibilité", points: visPts, max: 25, hint: `${viewsPerDay.toFixed(1).replace(".", ",")} vue(s) par jour (objectif : 15)` });

  const appealPts = Math.min(25, Math.round(20 * Math.min(1, favoriteRate / 0.1)) + Math.min(5, offers * 2));
  parts.push({ key: "appeal", label: "Attractivité", points: appealPts, max: 25, hint: `${(favoriteRate * 100).toFixed(0)} % des visiteurs l'ajoutent en favori · ${offers} offre(s)` });

  const photos = item.photos.length;
  const photoPts = photos >= 8 ? 12 : photos >= 5 ? 9 : photos >= 3 ? 5 : photos >= 1 ? 2 : 0;
  const title = norm(item.title);
  const titleHasBrand = Boolean(item.brand) && title.includes(norm(item.brand));
  const titleLen = item.title.trim().length;
  const titlePts = (titleHasBrand ? 3 : 0) + (titleLen >= 20 && titleLen <= 70 ? 3 : titleLen >= 12 ? 1 : 0);
  const descLen = item.description.trim().length;
  const descPts = descLen >= 150 ? 6 : descLen >= 80 ? 4 : descLen >= 30 ? 2 : 0;
  const attrPts = (item.brand ? 2 : 0) + (item.size ? 2 : 0) + (item.attributes.colors.length > 0 ? 2 : 0);
  const qualityPts = photoPts + titlePts + descPts + attrPts;
  parts.push({ key: "quality", label: "Qualité de l'annonce", points: qualityPts, max: 30, hint: `${photos} photo(s) · titre ${titleLen} car. · description ${descLen} car.` });

  const market = ctx.marketPriceCents ?? null;
  const listed = item.listedPriceCents;
  const priceVsMarket = market && listed ? listed / market : null;
  const pricePts = listed === null ? 0 : priceVsMarket === null ? 12 : priceVsMarket <= 1 ? 20 : priceVsMarket <= 1.1 ? 15 : priceVsMarket <= 1.25 ? 9 : 4;
  parts.push({ key: "price", label: "Prix vs marché", points: pricePts, max: 20, hint: priceVsMarket === null ? "Pas encore de ventes comparables" : `${priceVsMarket <= 1 ? "Au prix du marché ou en dessous" : `${Math.round((priceVsMarket - 1) * 100)} % au-dessus du marché`}` });

  const score = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.points, 0)));
  const after = ctx.republishAfterDays ?? DEFAULT_REPUBLISH_AFTER_DAYS;
  const republishDue = (item.status === "listed" || item.status === "reserved") && days >= after;

  if (republishDue) tips.push({ key: "republish", label: `En ligne depuis ${days} jours : republiez`, detail: "Une annonce reprend de la visibilité quand elle réapparaît en tête des nouveautés. Utilisez la prochaine variante prête.", impact: "high", action: "republish" });
  if (priceVsMarket !== null && priceVsMarket > 1.1) tips.push({ key: "price", label: `Prix ${Math.round((priceVsMarket - 1) * 100)} % au-dessus du marché`, detail: `Les ventes comparables se font autour de ${((market ?? 0) / 100).toFixed(2).replace(".", ",")} €. Baissez le prix ou justifiez-le (état, rareté) dans la description.`, impact: "high", action: "price" });
  if (photos < 5) tips.push({ key: "photos", label: `Seulement ${photos} photo(s)`, detail: "Visez 8 photos : face, dos, étiquette, matière, défauts, portée. Les annonces bien photographiées sont plus vues et plus mises en favori.", impact: "high", action: "photos" });
  else if (photos < 8) tips.push({ key: "photos_more", label: `${photos} photos : ajoutez-en ${8 - photos}`, detail: "Ajoutez une photo portée et un gros plan de l'étiquette.", impact: "low", action: "photos" });
  if (favorites >= 3 && favoriteRate >= 0.08 && offers === 0) tips.push({ key: "offer_favorites", label: `${favorites} favoris sans offre`, detail: "L'annonce plaît : envoyez une offre réduite aux personnes qui l'ont mise en favori.", impact: "medium", action: "offer_favorites" });
  if (days >= 3 && viewsPerDay < 2) tips.push({ key: "low_views", label: "Peu de vues", detail: "Changez la photo de couverture et ajoutez la marque, le modèle et la taille dans le titre.", impact: "medium", action: "title" });
  if (item.brand && !titleHasBrand) tips.push({ key: "title_brand", label: "Marque absente du titre", detail: `Commencez le titre par « ${item.brand} » : c'est le premier mot-clé recherché.`, impact: "medium", action: "title" });
  else if (titleLen < 20) tips.push({ key: "title_short", label: "Titre trop court", detail: "Marque + type de pièce + couleur + taille, en 20 à 70 caractères.", impact: "low", action: "title" });
  if (descLen < 80) tips.push({ key: "description", label: "Description trop courte", detail: "Ajoutez mesures, matière, état précis et défauts éventuels.", impact: "medium", action: "description" });
  if (item.attributes.colors.length === 0 || !item.size) tips.push({ key: "attributes", label: "Attributs incomplets", detail: "Renseignez couleur(s) et taille : les filtres de recherche les utilisent.", impact: "low", action: "attributes" });

  const order = { high: 0, medium: 1, low: 2 } as const;
  tips.sort((a, b) => order[a.impact] - order[b.impact]);
  return { score, band: listingBand(score), daysOnline: days, views, favorites, offers, viewsPerDay, favoriteRate, parts, tips, republishDue, priceVsMarket, marketPriceCents: market };
}

/** Prix de marché de référence : médiane des ventes de la même marque et catégorie (≥ 2 ventes). */
export function marketPriceFor(item: Pick<InventoryItem, "brand" | "category">, sales: { brand: string | null; category: string | null; salePriceCents: Cents }[]): Cents | null {
  const same = sales.filter((s) => s.brand && item.brand && norm(s.brand) === norm(item.brand) && s.category === item.category).map((s) => s.salePriceCents).sort((a, b) => a - b);
  if (same.length < 2) return null;
  const mid = Math.floor(same.length / 2);
  return same.length % 2 ? same[mid]! : Math.round((same[mid - 1]! + same[mid]!) / 2);
}

export interface DressingSummary {
  listed: number;
  averageScore: number;
  toRepublish: number;
  totalViews: number;
  totalFavorites: number;
  viewsPerDay: number;
  favoriteRate: number;
  byBand: Record<ListingBand["key"], number>;
}

export function summarizeDressing(perfs: ListingPerformance[]): DressingSummary {
  const byBand: DressingSummary["byBand"] = { excellent: 0, good: 0, improve: 0, weak: 0 };
  let score = 0, views = 0, favorites = 0, vpd = 0, due = 0;
  for (const p of perfs) {
    byBand[p.band.key]++;
    score += p.score;
    views += p.views;
    favorites += p.favorites;
    vpd += p.viewsPerDay;
    if (p.republishDue) due++;
  }
  const n = perfs.length;
  return { listed: n, averageScore: n ? Math.round(score / n) : 0, toRepublish: due, totalViews: views, totalFavorites: favorites, viewsPerDay: n ? vpd / n : 0, favoriteRate: ratio(favorites, views), byBand };
}

export interface DressingFilters {
  filter?: "all" | "due" | "7" | "14" | "30" | "weak";
  sort?: "online_desc" | "score_asc" | "score_desc" | "views_desc" | "favorites_desc";
  q?: string;
  connectionId?: string;
}

function textNorm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Vue complète du dressing intelligent : annonces en ligne (en vente ou
 * réservées) avec note, plan de republication, filtres « en ligne depuis
 * N jours » et tris. Partagée par la démonstration et le serveur.
 */
export function buildDressing(items: InventoryItem[], sales: { brand: string | null; category: string | null; salePriceCents: Cents }[], opts: { now: Date; rules?: MarginRules; republishAfterDays: number }, query: DressingFilters = {}): { listings: { item: InventoryItem; performance: ListingPerformance; plan: RepublicationPlan }[]; summary: DressingSummary; leaderboard: ReturnType<typeof variantLeaderboard>; republishAfterDays: number } {
  const all = items.filter((i) => i.status === "listed" || i.status === "reserved").map((item) => ({
    item,
    performance: scoreListing(item, { now: opts.now, rules: opts.rules, marketPriceCents: marketPriceFor(item, sales), republishAfterDays: opts.republishAfterDays }),
    plan: republicationPlan(item, { now: opts.now, republishAfterDays: opts.republishAfterDays }),
  }));
  const summary = summarizeDressing(all.map((l) => l.performance));
  let list = all;
  const f = query.filter ?? "all";
  if (f === "due") list = list.filter((l) => l.performance.republishDue);
  else if (f === "weak") list = list.filter((l) => l.performance.score < 60);
  else if (f !== "all") list = list.filter((l) => l.performance.daysOnline >= Number(f));
  if (query.connectionId) list = list.filter((l) => l.item.connectionId === query.connectionId);
  if (query.q) {
    const q = textNorm(query.q);
    list = list.filter((l) => textNorm(l.item.title).includes(q) || textNorm(l.item.brand).includes(q) || textNorm(l.item.sku).includes(q));
  }
  const sort = query.sort ?? "online_desc";
  list = [...list].sort((a, b) =>
    sort === "score_asc" ? a.performance.score - b.performance.score
    : sort === "score_desc" ? b.performance.score - a.performance.score
    : sort === "views_desc" ? b.performance.views - a.performance.views
    : sort === "favorites_desc" ? b.performance.favorites - a.performance.favorites
    : b.performance.daysOnline - a.performance.daysOnline);
  return { listings: list, summary, leaderboard: variantLeaderboard(items), republishAfterDays: opts.republishAfterDays };
}
