import {
  ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, PRICE_MODEL_DEMO_DATA, PRICE_MODEL_NOT_TRAINED, TRACK_SCAN_WEIGHTS, TRACK_TRENDS_DAYS, buildUsageCounter,
  type InventoryItem, type PriceConfidenceLevel, type PriceEstimate, type PriceEstimateInput, type PriceModelStatus, type Subscription, type TrackCriteria, type TrackScanComponents,
} from "@selio/contracts";
import type { TrackUsageView, UsageSummary } from "./data/types";

/**
 * Selio Track et l'estimation des prix dans l'application : règles pures partagées par les pages, le
 * client de l'API et la démonstration. Statistiques seulement : aucune annonce, aucune photo d'annonce,
 * aucun pseudo n'est affiché ni gardé.
 */

// ---------------------------------------------------------------- offre et quotas

/** Track est compris à partir de Pro : un quota de filtres nul (free, Starter) le rend indisponible. */
export function trackAvailable(quotas: Pick<Subscription["quotas"], "trackFiltersFollowed">): boolean {
  return quotas.trackFiltersFollowed > 0;
}

/**
 * Utilisation de Track (page « Mon utilisation » et tableau de bord) : scans et recherches par photo du
 * mois (compteurs « track.scan » et « track.photo_search »), filtres suivis (comptés depuis la liste des
 * filtres : le compteur général ne les compte pas encore), historique du plan.
 */
export function buildTrackUsage(usage: Pick<UsageSummary, "period" | "track">, sub: Pick<Subscription, "plan" | "quotas">, filterCount: number | null): TrackUsageView {
  const q = sub.quotas;
  const available = trackAvailable(q);
  return {
    plan: sub.plan,
    available,
    salesFeed: available && sub.plan === "agence",
    filters: buildUsageCounter(filterCount ?? usage.track.filtersFollowed.used, q.trackFiltersFollowed),
    scans: buildUsageCounter(usage.track.scans.used, q.trackScansPerMonth),
    photoSearches: buildUsageCounter(usage.track.photoSearches.used, q.trackPhotoSearchesPerMonth),
    historyMonths: q.trackHistoryMonths,
    period: usage.period,
  };
}

/** Périodes de tendance proposées (7, 30, 90 jours), bornées à l'historique du plan (3 mois en Pro). */
export function trendWindows(historyMonths: number): number[] {
  const max = Math.max(0, historyMonths) * 30;
  return (TRACK_TRENDS_DAYS as readonly number[]).filter((d) => d <= max);
}

// ---------------------------------------------------------------- critères

/** Résumé lisible d'un filtre (marques, catégories, tailles, états, mots-clés, prix maximal). */
export function criteriaTags(c: Partial<TrackCriteria>): string[] {
  return [
    ...(c.brands ?? []),
    ...(c.categories ?? []).map((x) => ITEM_CATEGORY_LABELS[x]),
    ...(c.keywords ?? []).map((k) => `« ${k} »`),
    ...(c.sizes ?? []).map((s) => `T. ${s}`),
    ...(c.conditions ?? []).map((x) => ITEM_CONDITION_LABELS[x]),
  ];
}

const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** Apostrophes typographiques (’ ‘ ‛ ʼ ` ´) ramenées à l'apostrophe droite. */
const APOSTROPHES = /[\u2018\u2019\u201B\u02BC\u0060\u00B4]/g;
/** Texte plié comme le serveur (`foldText`) : sans accents, apostrophes unifiées, espaces réduits, minuscules. */
export const foldText = (s: string) => clean(s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(APOSTROPHES, "'")).toLowerCase();
const uniqSorted = (xs: readonly string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Critères normalisés (même règle que le serveur, packages/core/src/services/track.ts) : marques et
 * mots-clés pliés (minuscules, sans accents, apostrophes unifiées), tailles en majuscules, listes
 * dédoublonnées et triées. Deux filtres qui ne diffèrent que par la casse, les accents, l'apostrophe,
 * l'ordre ou des espaces sont le même filtre (lu une seule fois).
 */
export function normalizeCriteria(c: Partial<TrackCriteria>): TrackCriteria {
  return {
    brands: uniqSorted((c.brands ?? []).map(foldText)),
    categories: uniqSorted(c.categories ?? []) as TrackCriteria["categories"],
    sizes: uniqSorted((c.sizes ?? []).map((s) => clean(s).toUpperCase())),
    conditions: uniqSorted(c.conditions ?? []) as TrackCriteria["conditions"],
    maxPriceCents: c.maxPriceCents ?? 5000,
    keywords: uniqSorted((c.keywords ?? []).map(foldText)),
  };
}

// ---------------------------------------------------------------- scans de niche

export const SCAN_COMPONENT_LABELS: Record<keyof TrackScanComponents, { label: string; detail: string }> = {
  demand: { label: "Demande", detail: "Part des annonces vendues ou disparues parmi celles de la niche." },
  speed: { label: "Vitesse de vente", detail: "100 pour une vente le jour même, 0 à partir de 30 jours de délai médian." },
  competition: { label: "Concurrence", detail: "Plus il y a d'annonces actives, plus la note baisse." },
  margin: { label: "Marge", detail: "Écart entre le prix de revente médian et le prix d'achat médian observé." },
};

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Composantes d'un scan (0 à 100) et note pondérée (35 / 25 / 20 / 20) : MÊME formule que le serveur
 * (`scanComponents`, packages/core/src/services/track.ts), utilisée par la démonstration.
 */
export function scanComponents(input: { sold: number; active: number; activeListings: number; medianDaysToSell: number | null; medianResaleCents: number | null; medianBuyCents: number | null }): { components: TrackScanComponents; score: number } {
  const demand = input.sold + input.active > 0 ? clamp100((100 * input.sold) / (input.sold + input.active)) : 0;
  const speed = input.medianDaysToSell === null ? 50 : clamp100(100 * (1 - input.medianDaysToSell / 30));
  const competition = clamp100(100 / (1 + input.activeListings / 50));
  const resale = input.medianResaleCents;
  const margin = resale && resale > 0 && input.medianBuyCents !== null ? clamp100(((resale - input.medianBuyCents) / resale / 0.5) * 100) : 0;
  const components = { demand, speed, competition, margin };
  const score = clamp100((Object.keys(TRACK_SCAN_WEIGHTS) as (keyof TrackScanComponents)[]).reduce((s, k) => s + TRACK_SCAN_WEIGHTS[k] * components[k], 0));
  return { components, score };
}

// ---------------------------------------------------------------- prix

export const CONFIDENCE_LABELS: Record<PriceConfidenceLevel, string> = { low: "Faible", medium: "Moyenne", high: "Élevée" };

/** Quantile par interpolation linéaire, arrondi au centime (null sans valeur). */
export function quantileCents(values: readonly number[], q: number): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const h = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h);
  return Math.round(s[lo]! + (h - lo) * (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!));
}

/** Prix psychologique le plus proche finissant par 90 centimes (même règle que le serveur), 1 € au moins. */
export function roundPrice(cents: number): number {
  const c = Math.round(cents);
  const below = Math.floor((c - 90) / 100) * 100 + 90;
  const above = below + 100;
  const nearest = c - below <= above - c ? below : above;
  if (nearest < 100) return Math.max(100, Math.round(c / 10) * 10);
  return nearest;
}

/** Poids des comparables dans la combinaison avec le modèle : 0,8 × min(1, n / 12). */
export function comparablesWeight(count: number): number {
  if (!(count > 0)) return 0;
  return Math.round(0.8 * Math.min(1, count / 12) * 1000) / 1000;
}

/** Caractéristiques d'un article pour l'estimation (titre, marque, attributs : aucune donnée de personne). */
export function itemPriceFeatures(it: Pick<InventoryItem, "title" | "brand" | "category" | "size" | "condition" | "attributes" | "photos">): PriceEstimateInput {
  return {
    title: it.title.trim().slice(0, 200) || undefined,
    brand: it.brand?.trim() || null,
    category: it.category,
    size: it.size?.trim() || null,
    material: it.attributes?.material?.trim() || null,
    color: it.attributes?.colors?.[0]?.trim() || null,
    condition: it.condition,
    photoCount: Math.min(30, it.photos?.length ?? 0),
  };
}

export type ModelStatusTone = "muted" | "accent" | "success" | "warning";

export interface ModelStatusView {
  /** « Modèle non entraîné », « Données de démonstration » ou « Modèle entraîné ». */
  label: string;
  tone: ModelStatusTone;
  /** Phrase d'explication, sans promesse. */
  detail: string;
  /** Erreur médiane MESURÉE sur le dernier mois de la vraie base (fraction), sinon null. */
  measuredError: number | null;
  /** Part des estimations à ± 20 % sur le test (fraction), sinon null. */
  within20: number | null;
  /** Ventes du mois de test, sinon null. */
  testSales: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Lecture honnête de l'état du modèle de prix : rien n'est présenté comme mesuré sans mesure. L'erreur
 * vient du test sur le dernier mois de la vraie base (`metrics.measured`) ; un modèle entraîné sur le
 * simulateur reste « données de démonstration », sans erreur affichée.
 */
export function modelStatusView(status: PriceModelStatus | null | undefined): ModelStatusView {
  if (!status || !status.trained) {
    return { label: PRICE_MODEL_NOT_TRAINED, tone: "muted", detail: "Le prix conseillé vient des ventes comparables seulement, tant que la base de références ne permet pas d'entraîner le modèle (500 ventes au moins).", measuredError: null, within20: null, testSales: null };
  }
  if (status.synthetic) {
    return { label: PRICE_MODEL_DEMO_DATA, tone: "accent", detail: "Modèle entraîné sur le simulateur : son erreur n'est pas mesurée sur de vraies ventes.", measuredError: null, within20: null, testSales: null };
  }
  const m = status.metrics ?? {};
  const measured = m.measured === true ? num(m.mdape) : null;
  return {
    label: "Modèle entraîné",
    tone: measured !== null ? "success" : "warning",
    detail: measured !== null
      ? "Erreur mesurée sur le dernier mois de la base, jamais vu pendant l'entraînement."
      : "Erreur non mesurée : pas assez de ventes dans le mois de test.",
    measuredError: measured,
    within20: measured !== null ? num(m.within20) : null,
    testSales: measured !== null ? num(m.nHoldout) : null,
  };
}

/** L'estimation propose-t-elle un prix ? (méthode « none » : à fixer à la main). */
export function hasPrice(e: PriceEstimate | null | undefined): e is PriceEstimate & { strategies: NonNullable<PriceEstimate["strategies"]>; p25: number; p50: number; p75: number } {
  return !!e && e.method !== "none" && e.strategies !== null && e.p25 !== null && e.p50 !== null && e.p75 !== null;
}

/** Délai lisible (« ≈ 9 jours », « moins d'un jour »), toujours présenté comme une estimation. */
export function formatDelayDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "Inconnu";
  const d = Math.round(days);
  if (d < 1) return "Moins d'un jour";
  return `≈ ${d} jour${d > 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------- photo (recherche par photo)

/** Côté le plus long d'une photo envoyée à Track : réduite dans le navigateur, jamais conservée. */
export const PHOTO_MAX_SIDE = 1200;
/** Taille maximale de la photo encodée acceptée par l'API (data URL). */
export const PHOTO_MAX_DATA_URL = 3_000_000;

/** Dimensions réduites (le plus long côté ≤ `maxSide`, proportions gardées, jamais agrandies). */
export function targetSize(width: number, height: number, maxSide = PHOTO_MAX_SIDE): { width: number; height: number; scaled: boolean } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scaled: scale < 1 };
}

export interface ReducedPhoto {
  dataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/** Source dessinable et ses dimensions. */
interface Drawable { source: CanvasImageSource; width: number; height: number; release: () => void }

const UNREADABLE_PHOTO = "Photo illisible dans ce navigateur : choisissez une image JPEG, PNG ou WebP.";

async function decode(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      // Format que le navigateur ne sait pas décoder (HEIC hors Safari, fichier abîmé…) : message en clair.
      throw new Error(UNREADABLE_PHOTO);
    }
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(UNREADABLE_PHOTO));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Réduit une photo dans le navigateur (le plus long côté ≤ 1 200 px, JPEG) avant l'envoi : la photo
 * d'origine ne quitte jamais l'appareil, la photo réduite n'est pas conservée par Selio.
 */
export async function reducePhoto(file: Blob, maxSide = PHOTO_MAX_SIDE): Promise<ReducedPhoto> {
  const img = await decode(file);
  try {
    const size = targetSize(img.width, img.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Réduction de la photo indisponible dans ce navigateur.");
    // Fond blanc sous une photo transparente (PNG) : le JPEG n'a pas de transparence. Pixel de l'image, pas une couleur d'interface.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img.source, 0, 0, size.width, size.height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    for (const quality of [0.7, 0.55]) {
      if (dataUrl.length <= PHOTO_MAX_DATA_URL) break;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) throw new Error("Réduction de la photo impossible dans ce navigateur.");
    if (dataUrl.length > PHOTO_MAX_DATA_URL) throw new Error("Photo trop lourde, même réduite : choisissez-en une autre.");
    return { dataUrl, width: size.width, height: size.height, originalWidth: img.width, originalHeight: img.height };
  } finally {
    img.release();
  }
}
