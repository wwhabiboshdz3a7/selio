/**
 * Variables du modèle de prix : encodage cible lissé (marque, marque × catégorie, sous-catégorie),
 * modalités (catégorie, système de taille, matière, couleur, saison) et ordinaux (état, taille).
 *
 * Encodage cible lissé : pour une modalité vue n fois avec une cible moyenne ȳ,
 * valeur = (n·ȳ + m·a priori) / (n + m), m = `targetSmoothing`. L'a priori est hiérarchique :
 * moyenne générale pour la marque et la catégorie, valeur de la marque pour « marque × catégorie »,
 * valeur de la catégorie pour la sous-catégorie. Une marque jamais vue reçoit donc l'a priori.
 * À l'entraînement, les lignes sont encodées « hors pli » (5 plis) pour que leur propre prix
 * n'entre pas dans leur encodage (fuite de la cible).
 */
import { SEASONS, SIZE_SYSTEMS, type CleanReference, type ParsedSize, type Season } from "./clean";
import { createRng } from "./gbm";
import type { FeatureSpec, SerializedTargetEncoding } from "./types";

/** Ce que le modèle sait d'un article, déjà normalisé (référence nettoyée ou article à estimer). */
export interface ItemView {
  brand: string;
  category: string;
  subcategory: string | null;
  size: ParsedSize;
  material: string | null;
  color: string | null;
  /** Ordinal de l'état (0 à 4), -1 si inconnu. */
  conditionOrdinal: number;
  season: Season;
  photoCount: number | null;
}

export const PRICE_FEATURES: FeatureSpec[] = [
  { name: "brand_te", kind: "numeric" },
  { name: "brand_category_te", kind: "numeric" },
  { name: "subcategory_te", kind: "numeric" },
  { name: "category", kind: "onehot" },
  { name: "condition", kind: "numeric" },
  { name: "size", kind: "numeric" },
  { name: "size_system", kind: "onehot" },
  { name: "material", kind: "onehot" },
  { name: "color", kind: "onehot" },
  { name: "season", kind: "onehot" },
  { name: "photo_count", kind: "numeric" },
  { name: "brand_log_count", kind: "numeric" },
];

/** Variables du délai : celles du prix, plus l'encodage du délai par marque et l'écart du prix affiché au prix typique. */
export const DELAY_FEATURES: FeatureSpec[] = [
  ...PRICE_FEATURES,
  { name: "brand_delay_te", kind: "numeric" },
  { name: "relative_price", kind: "numeric" },
];

export const IDX = Object.fromEntries(DELAY_FEATURES.map((f, i) => [f.name, i])) as Record<string, number>;

/** Modalités retenues (au plus `limit` des plus fréquentes, puis « autre » et « inconnue »). */
export interface Vocab {
  categories: string[];
  materials: string[];
  colors: string[];
  brandCounts: Record<string, number>;
}

export const OTHER = "(autre)";
export const UNKNOWN = "(inconnue)";

function topValues(values: Iterable<string | null>, limit: number, withUnknown: boolean): string[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k]) => k);
  return withUnknown ? [...top, OTHER, UNKNOWN] : [...top, OTHER];
}

export function fitVocab(rows: readonly ItemView[]): Vocab {
  const brandCounts: Record<string, number> = {};
  for (const r of rows) brandCounts[r.brand] = (brandCounts[r.brand] ?? 0) + 1;
  return {
    categories: topValues(rows.map((r) => r.category), 40, false),
    materials: topValues(rows.map((r) => r.material), 20, true),
    colors: topValues(rows.map((r) => r.color), 20, true),
    brandCounts,
  };
}

function codeOf(list: readonly string[], value: string | null): number {
  if (value === null) {
    const u = list.indexOf(UNKNOWN);
    return u >= 0 ? u : list.indexOf(OTHER);
  }
  const i = list.indexOf(value);
  return i >= 0 && list[i] !== OTHER && list[i] !== UNKNOWN ? i : list.indexOf(OTHER);
}

// ------------------------------------------------------------------ encodage cible

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function fitTargetEncoding(keys: readonly string[], y: ArrayLike<number>, smoothing: number): SerializedTargetEncoding {
  const stats: Record<string, [number, number]> = {};
  let sum = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const s = stats[k] ?? (stats[k] = [0, 0]);
    s[0] += y[i]!;
    s[1] += 1;
    sum += y[i]!;
  }
  for (const k of Object.keys(stats)) stats[k] = [round6(stats[k]![0]), stats[k]![1]];
  return { smoothing, prior: keys.length ? round6(sum / keys.length) : 0, stats };
}

/** Valeur lissée d'une modalité ; `prior` remplace l'a priori général (encodage hiérarchique). */
export function encodeTarget(enc: SerializedTargetEncoding, key: string, prior: number = enc.prior): number {
  const s = Object.prototype.hasOwnProperty.call(enc.stats, key) ? enc.stats[key]! : undefined;
  if (!s) return round6(prior);
  return round6((s[0] + enc.smoothing * prior) / (s[1] + enc.smoothing));
}

export interface PriceEncodings {
  brand: SerializedTargetEncoding;
  category: SerializedTargetEncoding;
  brandCategory: SerializedTargetEncoding;
  subcategory: SerializedTargetEncoding;
}

const brandCatKey = (r: ItemView) => `${r.brand}|${r.category}`;
const subcatKey = (r: ItemView) => `${r.category}|${r.subcategory ?? ""}`;

/** Encodages du prix (cible : logarithme du prix en centimes). */
export function fitPriceEncodings(rows: readonly ItemView[], logPrice: ArrayLike<number>, smoothing: number): PriceEncodings {
  return {
    brand: fitTargetEncoding(rows.map((r) => r.brand), logPrice, smoothing),
    category: fitTargetEncoding(rows.map((r) => r.category), logPrice, smoothing),
    brandCategory: fitTargetEncoding(rows.map(brandCatKey), logPrice, smoothing),
    subcategory: fitTargetEncoding(rows.map(subcatKey), logPrice, smoothing),
  };
}

export interface EncodedTargets {
  brand: number;
  brandCategory: number;
  subcategory: number;
}

export function encodePrice(enc: PriceEncodings, r: ItemView): EncodedTargets {
  const brand = encodeTarget(enc.brand, r.brand);
  const category = encodeTarget(enc.category, r.category);
  return {
    brand,
    brandCategory: encodeTarget(enc.brandCategory, brandCatKey(r), brand),
    subcategory: encodeTarget(enc.subcategory, subcatKey(r), category),
  };
}

// ------------------------------------------------------------------ lignes

/** Ligne de variables du prix (ordre de `PRICE_FEATURES`). */
export function priceRow(r: ItemView, te: EncodedTargets, vocab: Vocab): number[] {
  return [
    te.brand,
    te.brandCategory,
    te.subcategory,
    codeOf(vocab.categories, r.category),
    r.conditionOrdinal,
    r.size.ordinal,
    SIZE_SYSTEMS.indexOf(r.size.system),
    codeOf(vocab.materials, r.material),
    codeOf(vocab.colors, r.color),
    SEASONS.indexOf(r.season),
    r.photoCount ?? -1,
    round6(Math.log1p(vocab.brandCounts[r.brand] ?? 0)),
  ];
}

/** Ligne de variables du délai : prix + encodage du délai par marque + écart (log) du prix affiché au prix typique. */
export function delayRow(r: ItemView, te: EncodedTargets, vocab: Vocab, brandDelay: SerializedTargetEncoding, logListedPrice: number): number[] {
  return [...priceRow(r, te, vocab), encodeTarget(brandDelay, r.brand), round6(logListedPrice - te.brandCategory)];
}

/** Vue d'une référence nettoyée. */
export function viewOf(r: CleanReference): ItemView {
  return {
    brand: r.brand,
    category: r.category,
    subcategory: r.subcategory,
    size: r.size,
    material: r.material,
    color: r.color,
    conditionOrdinal: r.conditionOrdinal,
    season: r.season,
    photoCount: r.photoCount,
  };
}

/** Plis pour l'encodage hors pli (tirage à graine). */
export function assignFolds(n: number, k: number, seed: number): Int32Array {
  const rng = createRng(seed);
  const folds = new Int32Array(n);
  for (let i = 0; i < n; i++) folds[i] = Math.floor(rng() * k);
  return folds;
}

/** Encodage hors pli : chaque ligne est encodée par les encodages appris sur les autres plis. */
export function outOfFoldTargets(rows: readonly ItemView[], logPrice: Float64Array, smoothing: number, folds: Int32Array, k: number): EncodedTargets[] {
  const out: EncodedTargets[] = new Array(rows.length);
  for (let f = 0; f < k; f++) {
    const fitIdx: number[] = [];
    for (let i = 0; i < rows.length; i++) if (folds[i] !== f) fitIdx.push(i);
    const enc = fitPriceEncodings(fitIdx.map((i) => rows[i]!), Float64Array.from(fitIdx, (i) => logPrice[i]!), smoothing);
    for (let i = 0; i < rows.length; i++) if (folds[i] === f) out[i] = encodePrice(enc, rows[i]!);
  }
  return out;
}

/** Encodage hors pli du délai par marque. */
export function outOfFoldDelay(rows: readonly ItemView[], logDelay: Float64Array, smoothing: number, folds: Int32Array, k: number): number[] {
  const out: number[] = new Array(rows.length);
  for (let f = 0; f < k; f++) {
    const fitIdx: number[] = [];
    for (let i = 0; i < rows.length; i++) if (folds[i] !== f) fitIdx.push(i);
    const enc = fitTargetEncoding(fitIdx.map((i) => rows[i]!.brand), Float64Array.from(fitIdx, (i) => logDelay[i]!), smoothing);
    for (let i = 0; i < rows.length; i++) if (folds[i] === f) out[i] = encodeTarget(enc, rows[i]!.brand);
  }
  return out;
}

/** Colonnes (Float64Array) à partir de lignes. */
export function toColumns(rows: readonly number[][], width: number): Float64Array[] {
  const cols = Array.from({ length: width }, () => new Float64Array(rows.length));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    for (let j = 0; j < width; j++) cols[j]![i] = r[j]!;
  }
  return cols;
}

