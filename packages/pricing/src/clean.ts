/**
 * Nettoyage de la base de références : normalisation (marque, catégorie, taille, matière, couleur,
 * état, saison), dédoublonnage et écartement des aberrations, avec un rapport ligne à ligne
 * (combien gardées, combien écartées et pourquoi).
 *
 * Seuls les champs autorisés sont recopiés : une clé personnelle (pseudo, identifiant, photo…)
 * présente à l'exécution fait écarter la ligne (raison `personal_data`), elle n'est jamais propagée.
 */
import {
  FORBIDDEN_REFERENCE_KEYS,
  PRICE_REFERENCE_SOURCES,
  type DateInput,
  type PriceCondition,
  type PriceReference,
  type PriceReferenceSource,
} from "./types";

// ------------------------------------------------------------------ texte

/** Minuscules, sans accents ni apostrophes, ponctuation remplacée par des espaces, espaces réduits. */
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------ marques

/** Clé des articles sans marque. */
export const NO_BRAND = "sansmarque";

/**
 * Alias courants (clé normalisée → clé canonique). Les clés sont des marques normalisées sans
 * espaces (`normalizeBrand` sans alias). Paramétrable : `cleanReferences(…, { brandAliases })`
 * complète ou remplace ces entrées.
 */
export const DEFAULT_BRAND_ALIASES: Readonly<Record<string, string>> = {
  "": NO_BRAND,
  sansmarque: NO_BRAND,
  aucunemarque: NO_BRAND,
  nobrand: NO_BRAND,
  unbranded: NO_BRAND,
  autre: NO_BRAND,
  autremarque: NO_BRAND,
  inconnue: NO_BRAND,
  levistrauss: "levis",
  levistraussco: "levis",
  levi: "levis",
  tnf: "thenorthface",
  northface: "thenorthface",
  hetm: "hm",
  handm: "hm",
  hennesetmauritz: "hm",
  ck: "calvinklein",
  ckjeans: "calvinklein",
  calvinkleinjeans: "calvinklein",
  poloralphlauren: "ralphlauren",
  polobyralphlauren: "ralphlauren",
  laurenralphlauren: "ralphlauren",
  docmartens: "drmartens",
  doctormartens: "drmartens",
  drmarten: "drmartens",
  tommy: "tommyhilfiger",
  tommyjeans: "tommyhilfiger",
  zarawoman: "zara",
  zaratrf: "zara",
  zaraman: "zara",
  zarakids: "zara",
  nikesportswear: "nike",
  nikeair: "nike",
  adidasoriginals: "adidas",
  newbalanceathletics: "newbalance",
  nb: "newbalance",
  carharttwip: "carhartt",
  carhartwip: "carhartt",
  carhart: "carhartt",
  stoneisland: "stoneisland",
  lacostelive: "lacoste",
  thekooples: "thekooples",
  kooples: "thekooples",
  sezaneparis: "sezane",
  ysl: "saintlaurent",
  yvessaintlaurent: "saintlaurent",
  lv: "louisvuitton",
  mk: "michaelkors",
};

/** Clé de marque : texte normalisé sans espaces, puis alias (« Levi’s », « LEVIS », « Levi Strauss » → `levis`). */
export function normalizeBrand(raw: string | null | undefined, aliases: Readonly<Record<string, string>> = DEFAULT_BRAND_ALIASES): string {
  const key = normalizeText(raw).replace(/\s+/g, "");
  const alias = aliases[key] ?? DEFAULT_BRAND_ALIASES[key];
  return alias ?? key;
}

// ------------------------------------------------------------------ catégories

/** Clé de catégorie : texte normalisé, pluriels simples retirés (« Jeans » et « jean » → `jean`). */
export function normalizeCategory(raw: string | null | undefined): string {
  return normalizeText(raw)
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

const BUNDLE = /(^|\s)(lot|lots)(\s|$)/;
/** Une catégorie « lot » ne décrit pas un article : on l'écarte. */
export function isBundleCategory(categoryKey: string, subcategoryKey: string | null): boolean {
  return BUNDLE.test(categoryKey) || (subcategoryKey !== null && BUNDLE.test(subcategoryKey));
}

const SHOES = /(chaussure|basket|sneaker|botte|bottine|escarpin|sandale|mocassin|derby|richelieu|espadrille|tong|mule|shoe|boot|chausson|ballerine|talon|running)/;
export function isShoeCategory(categoryKey: string, subcategoryKey: string | null = null): boolean {
  return SHOES.test(categoryKey) || (subcategoryKey !== null && SHOES.test(subcategoryKey));
}

// ------------------------------------------------------------------ état

/** Ordinal de l'état : neuf avec étiquette (4) > neuf (3) > très bon (2) > bon (1) > satisfaisant (0). */
export const CONDITION_ORDINAL: Readonly<Record<PriceCondition, number>> = {
  new_with_tags: 4,
  new_without_tags: 3,
  very_good: 2,
  good: 1,
  satisfactory: 0,
};

export const CONDITION_LABELS: Readonly<Record<PriceCondition, string>> = {
  new_with_tags: "Neuf avec étiquette",
  new_without_tags: "Neuf sans étiquette",
  very_good: "Très bon état",
  good: "Bon état",
  satisfactory: "Satisfaisant",
};

const CONDITION_ALIASES: Readonly<Record<string, PriceCondition>> = {
  "new with tags": "new_with_tags",
  "neuf avec etiquette": "new_with_tags",
  "neuf avec etiquettes": "new_with_tags",
  "neuf avec etiquette s": "new_with_tags",
  nwt: "new_with_tags",
  "new without tags": "new_without_tags",
  new: "new_without_tags",
  neuf: "new_without_tags",
  "neuf sans etiquette": "new_without_tags",
  "neuf sans etiquettes": "new_without_tags",
  "very good": "very_good",
  "tres bon etat": "very_good",
  "tres bon": "very_good",
  "tres bonne etat": "very_good",
  good: "good",
  "bon etat": "good",
  bon: "good",
  satisfactory: "satisfactory",
  satisfaisant: "satisfactory",
  "etat satisfaisant": "satisfactory",
  correct: "satisfactory",
  fair: "satisfactory",
};

/** État reconnu (code Selio ou libellé français / anglais), sinon null. */
export function parseCondition(raw: string | null | undefined): PriceCondition | null {
  return CONDITION_ALIASES[normalizeText(raw)] ?? null;
}

// ------------------------------------------------------------------ tailles

export type SizeSystem = "letter" | "eu" | "waist" | "shoe" | "kids" | "one_size" | "unknown";
export const SIZE_SYSTEMS: readonly SizeSystem[] = ["letter", "eu", "waist", "shoe", "kids", "one_size", "unknown"];

/**
 * Taille en classe ordinale sur une échelle commune de 0 (XXS) à 8 (4XL et plus) pour les
 * vêtements adultes (lettres, tailles européennes, tour de taille W) et les chaussures
 * (35 → 0, 47 → 8) ; âge en années pour les enfants ; -1 si inconnue ou taille unique.
 */
export interface ParsedSize {
  system: SizeSystem;
  ordinal: number;
  /** Clé stable pour le dédoublonnage. */
  key: string;
}

const LETTERS: Readonly<Record<string, number>> = {
  xxxs: 0, "3xs": 0, xxs: 0, "2xs": 0, xs: 1, s: 2, m: 3, l: 4, xl: 5, xxl: 6, "2xl": 6, xxxl: 7, "3xl": 7,
  xxxxl: 8, "4xl": 8, "5xl": 8, "6xl": 8, t0: 1, t1: 2, t2: 3, t3: 4, t4: 5, t5: 6, t6: 7,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const sized = (system: SizeSystem, ordinal: number): ParsedSize => ({ system, ordinal: round1(ordinal), key: system === "unknown" || system === "one_size" ? system : `${system}:${round1(ordinal)}` });
const UNKNOWN_SIZE: ParsedSize = { system: "unknown", ordinal: -1, key: "unknown" };

/** Taille lue : « M », « S/M », « XL », « W32 L34 », « 32/34 », « 38 », « 42,5 », « 10 ans », « Taille unique »… */
export function parseSize(raw: string | null | undefined, categoryKey = "", subcategoryKey: string | null = null): ParsedSize {
  if (!raw) return UNKNOWN_SIZE;
  let t = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/^(taille|size|tg|eu|fr|it)\s*[:.]?\s*/, "").trim();
  // « M (38) » : la mention entre parenthèses est une équivalence ; on lit la taille principale.
  const main = t.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  t = main || t.replace(/[()]/g, "").trim();
  if (!t) return UNKNOWN_SIZE;
  if (/^(tu|t\.u\.?|unique|taille unique|one size|onesize|os|universel|universelle)$/.test(t)) return { system: "one_size", ordinal: -1, key: "one_size" };

  const years = /(\d{1,2}(?:\.\d)?)\s*(ans|an|years|year|yrs|y)\b/.exec(t);
  if (years) return sized("kids", clamp(Number(years[1]), 0, 18));
  const months = /(\d{1,2})\s*(mois|months|month|m)\b/.exec(t);
  if (months && !/^m$/.test(t)) return sized("kids", clamp(Number(months[1]) / 12, 0, 3));
  const cm = /(\d{2,3})\s*cm\b/.exec(t);
  if (cm) return sized("kids", clamp((Number(cm[1]) - 75) / 6, 0, 18));

  const waist = /\bw\s*(\d{2})\b/.exec(t) ?? /^(\d{2})\s*[/x]\s*(\d{2})$/.exec(t);
  if (waist) {
    const w = Number(waist[1]);
    if (w >= 22 && w <= 50) return sized("waist", clamp((w - 24) / 2, 0, 8));
  }

  const parts = t.split(/[\s/\-–]+/).filter(Boolean);
  const letters = parts.map((p) => LETTERS[p]).filter((v): v is number => v !== undefined);
  if (letters.length > 0 && letters.length === parts.length) return sized("letter", letters.reduce((a, b) => a + b, 0) / letters.length);

  const num = /^(\d{1,3}(?:\.\d)?)$/.exec(t);
  if (num) {
    const n = Number(num[1]);
    const shoes = isShoeCategory(categoryKey, subcategoryKey);
    if (shoes && n >= 30 && n <= 50) return sized("shoe", clamp(((n - 35) * 8) / 12, 0, 8));
    if (!Number.isInteger(n) && n >= 34 && n <= 48) return sized("shoe", clamp(((n - 35) * 8) / 12, 0, 8));
    if (Number.isInteger(n) && n >= 30 && n <= 64) return sized("eu", clamp((n - 32) / 2, 0, 8));
    if (Number.isInteger(n) && n >= 62 && n <= 176) return sized("kids", clamp((n - 75) / 6, 0, 18));
  }
  return UNKNOWN_SIZE;
}

// ------------------------------------------------------------------ matière et couleur

const MATERIAL_WORDS: Readonly<Record<string, string>> = {
  coton: "coton", cotton: "coton",
  laine: "laine", wool: "laine", merinos: "laine", merino: "laine", alpaga: "laine", mohair: "laine",
  cachemire: "cachemire", cashmere: "cachemire",
  cuir: "cuir", leather: "cuir",
  daim: "daim", suede: "daim", nubuck: "daim",
  denim: "denim", jean: "denim", jeans: "denim",
  polyester: "polyester",
  soie: "soie", silk: "soie", satin: "soie",
  lin: "lin", linen: "lin",
  viscose: "viscose", rayonne: "viscose", rayon: "viscose", modal: "viscose", lyocell: "viscose", tencel: "viscose",
  nylon: "nylon", polyamide: "nylon",
  acrylique: "synthetique", acrylic: "synthetique", elasthanne: "synthetique", elastane: "synthetique", spandex: "synthetique",
  lycra: "synthetique", synthetique: "synthetique", synthetic: "synthetique", polyurethane: "synthetique", simili: "synthetique",
  toile: "toile", canvas: "toile",
  velours: "velours", velvet: "velours", corduroy: "velours",
  polaire: "polaire", fleece: "polaire",
  fourrure: "fourrure", fur: "fourrure",
};

/**
 * Matière principale : celle au plus fort pourcentage d'une composition (« 80 % coton 20 % polyester »
 * → `coton`), sinon le premier mot reconnu ; « autre » si rien n'est reconnu, null si vide.
 */
export function normalizeMaterial(raw: string | null | undefined): string | null {
  const t = normalizeText(raw);
  if (!t) return null;
  const shares = new Map<string, number>();
  const re = /(\d{1,3})\s*%?\s*([a-z]+)|([a-z]+)\s*(\d{1,3})\s*%/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const word = m[2] ?? m[3] ?? "";
    const pct = Number(m[1] ?? m[4] ?? 0);
    const canonical = MATERIAL_WORDS[word];
    if (canonical && pct > 0 && pct <= 100) shares.set(canonical, (shares.get(canonical) ?? 0) + pct);
  }
  if (shares.size > 0) return [...shares.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  for (const word of t.split(" ")) {
    const canonical = MATERIAL_WORDS[word];
    if (canonical) return canonical;
  }
  return "autre";
}

const COLOR_WORDS: Readonly<Record<string, string>> = {
  noir: "noir", noire: "noir", black: "noir",
  blanc: "blanc", blanche: "blanc", white: "blanc", ecru: "blanc", ivoire: "blanc",
  gris: "gris", grise: "gris", grey: "gris", gray: "gris", anthracite: "gris",
  bleu: "bleu", bleue: "bleu", blue: "bleu", marine: "bleu", navy: "bleu", turquoise: "bleu", indigo: "bleu",
  rouge: "rouge", red: "rouge", bordeaux: "rouge", burgundy: "rouge",
  rose: "rose", pink: "rose", fuchsia: "rose",
  vert: "vert", verte: "vert", green: "vert", kaki: "vert", khaki: "vert", olive: "vert",
  jaune: "jaune", yellow: "jaune", moutarde: "jaune",
  orange: "orange",
  violet: "violet", violette: "violet", purple: "violet", mauve: "violet", lilas: "violet",
  marron: "marron", brown: "marron", chocolat: "marron", camel: "marron", cognac: "marron",
  beige: "beige", creme: "beige", sable: "beige", taupe: "beige", nude: "beige",
  multicolore: "multicolore", multi: "multicolore", imprime: "multicolore",
  dore: "dore", gold: "dore", argente: "argente", silver: "argente",
};

/** Couleur principale normalisée (premier mot reconnu), « autre » si rien n'est reconnu, null si vide. */
export function normalizeColor(raw: string | null | undefined): string | null {
  const t = normalizeText(raw);
  if (!t) return null;
  for (const word of t.split(" ")) {
    const canonical = COLOR_WORDS[word];
    if (canonical) return canonical;
  }
  return "autre";
}

// ------------------------------------------------------------------ saison et dates

export type Season = "winter" | "spring" | "summer" | "autumn";
export const SEASONS: readonly Season[] = ["winter", "spring", "summer", "autumn"];
export const SEASON_LABELS: Readonly<Record<Season, string>> = { winter: "Hiver", spring: "Printemps", summer: "Été", autumn: "Automne" };

/** Saison (hémisphère nord, mois de Paris approximé en UTC) d'une date de mise en ligne. */
export function seasonOf(time: number): Season {
  const month = new Date(time).getUTCMonth();
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

export const DAY_MS = 86_400_000;

/** Horodatage en millisecondes, ou null si la date est absente ou invalide. */
export function toTime(v: DateInput | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// ------------------------------------------------------------------ nettoyage

/** Référence nettoyée, prête pour l'entraînement. Aucun champ personnel. */
export interface CleanReference {
  brand: string;
  category: string;
  subcategory: string | null;
  size: ParsedSize;
  material: string | null;
  color: string | null;
  /** État reconnu, ou null s'il n'était pas renseigné. */
  condition: PriceCondition | null;
  /** Ordinal de l'état (0 à 4), -1 si inconnu. */
  conditionOrdinal: number;
  listedPriceCents: number;
  finalPriceCents: number | null;
  /** Vrai : prix final estimé (annonce disparue) ; faux pour une vente au prix réel ou une annonce en ligne. */
  finalPriceEstimated: boolean;
  listedAt: number;
  soldAt: number | null;
  /** Délai de vente en jours (null si non vendue). */
  delayDays: number | null;
  season: Season;
  photoCount: number | null;
  views: number | null;
  favorites: number | null;
  source: PriceReferenceSource;
  /** Vendue (date de vente ou prix final connu). */
  sold: boolean;
  /** Prix que le modèle apprend à prédire : prix final, sinon prix affiché d'un article vendu ; null si non vendue. */
  targetPriceCents: number | null;
}

export const CLEANING_REASONS = [
  "personal_data",
  "invalid_source",
  "missing_category",
  "invalid_condition",
  "invalid_price",
  "invalid_date",
  "future_date",
  "negative_delay",
  "bundle",
  "price_too_low",
  "duplicate",
  "price_too_high",
] as const;
export type CleaningReason = (typeof CLEANING_REASONS)[number];

export const CLEANING_REASON_LABELS: Readonly<Record<CleaningReason, string>> = {
  personal_data: "Champ personnel présent (pseudo, identifiant, photo…) : ligne refusée",
  invalid_source: "Source inconnue",
  missing_category: "Catégorie absente",
  invalid_condition: "État renseigné mais non reconnu",
  invalid_price: "Prix absent ou invalide",
  invalid_date: "Date absente ou invalide",
  future_date: "Date dans le futur",
  negative_delay: "Vendue avant d'être mise en ligne (délai négatif)",
  bundle: "Lot (plusieurs articles)",
  price_too_low: "Prix inférieur à 1 €",
  duplicate: "Doublon (même marque, catégorie, taille, prix et jour)",
  price_too_high: "Prix aberrant (plus de 50 × la médiane de la marque et de la catégorie)",
};

export interface CleaningReport {
  input: number;
  kept: number;
  /** Gardées et vendues : utilisables pour le modèle de prix. */
  sold: number;
  /** Gardées mais non vendues (prix affichés seulement) : hors modèle de prix. */
  unsold: number;
  dropped: Record<CleaningReason, number>;
  bySource: Record<PriceReferenceSource, number>;
}

export interface CleanOptions {
  /** Date de référence : toute date postérieure est écartée (`future_date`). Par défaut : aucune limite. */
  now?: DateInput;
  /** Alias de marque supplémentaires (clé normalisée sans espaces → clé canonique). */
  brandAliases?: Readonly<Record<string, string>>;
  /** Prix minimal en centimes (100 = 1 €). */
  minPriceCents?: number;
  /** Facteur maximal par rapport à la médiane de la marque et de la catégorie (50). */
  maxMedianFactor?: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 100_000_000;
const optCount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const optText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Une ligne vendue l'emporte sur une ligne non vendue, puis la plus complète. */
function completeness(r: CleanReference): number {
  return (r.soldAt !== null ? 8 : 0) + (r.finalPriceCents !== null ? (r.finalPriceEstimated ? 2 : 4) : 0) + (r.photoCount !== null ? 1 : 0) + (r.material !== null ? 1 : 0);
}

/**
 * Nettoie une base de références. Ordre : champs refusés et invalides, lots, prix sous 1 €,
 * délai négatif, dates futures ; puis dédoublonnage (même marque, catégorie, taille, prix
 * affiché et jour de mise en ligne : la ligne vendue la plus complète est gardée) ; puis prix
 * aberrants (au-delà de `maxMedianFactor` × la médiane de la marque et de la catégorie, à défaut
 * de la catégorie, à défaut de toute la base). L'ordre de sortie suit l'ordre d'entrée.
 */
export function cleanReferences(references: readonly PriceReference[], options: CleanOptions = {}): { references: CleanReference[]; report: CleaningReport } {
  const aliases = { ...DEFAULT_BRAND_ALIASES, ...(options.brandAliases ?? {}) };
  const minPrice = options.minPriceCents ?? 100;
  const maxFactor = options.maxMedianFactor ?? 50;
  const now = options.now === undefined ? null : toTime(options.now);
  const dropped = Object.fromEntries(CLEANING_REASONS.map((r) => [r, 0])) as Record<CleaningReason, number>;
  const bySource = Object.fromEntries(PRICE_REFERENCE_SOURCES.map((s) => [s, 0])) as Record<PriceReferenceSource, number>;
  const forbidden = new Set<string>(FORBIDDEN_REFERENCE_KEYS);
  const drop = (reason: CleaningReason) => {
    dropped[reason]++;
    return null;
  };

  const first: (CleanReference | null)[] = references.map((raw) => {
    const r = raw as unknown as Record<string, unknown>;
    if (Object.keys(r).some((k) => forbidden.has(k) && r[k] !== undefined && r[k] !== null)) return drop("personal_data");
    if (!(PRICE_REFERENCE_SOURCES as readonly string[]).includes(String(r.source))) return drop("invalid_source");
    const category = normalizeCategory(optText(r.category));
    if (!category) return drop("missing_category");
    const subcategory = normalizeCategory(optText(r.subcategory)) || null;
    // État absent : gardé (ordinal −1) ; état renseigné mais illisible : écarté.
    const conditionText = optText(r.condition);
    const condition = conditionText === null ? null : parseCondition(conditionText);
    if (conditionText !== null && !condition) return drop("invalid_condition");
    if (!isCents(r.listedPriceCents)) return drop("invalid_price");
    const finalPrice = r.finalPriceCents === null || r.finalPriceCents === undefined ? null : r.finalPriceCents;
    if (finalPrice !== null && !isCents(finalPrice)) return drop("invalid_price");
    const listedAt = toTime(r.listedAt as DateInput);
    if (listedAt === null) return drop("invalid_date");
    const soldRaw = r.soldAt as DateInput | null | undefined;
    const soldAt = soldRaw === null || soldRaw === undefined || soldRaw === "" ? null : toTime(soldRaw);
    if (soldRaw !== null && soldRaw !== undefined && soldRaw !== "" && soldAt === null) return drop("invalid_date");
    if (isBundleCategory(category, subcategory)) return drop("bundle");
    if (r.listedPriceCents < minPrice || (finalPrice !== null && finalPrice < minPrice)) return drop("price_too_low");
    if (soldAt !== null && soldAt < listedAt) return drop("negative_delay");
    if (now !== null && (listedAt > now || (soldAt !== null && soldAt > now))) return drop("future_date");
    const sold = soldAt !== null || finalPrice !== null;
    return {
      brand: normalizeBrand(typeof r.brand === "string" ? r.brand : "", aliases),
      category,
      subcategory,
      size: parseSize(optText(r.size), category, subcategory),
      material: normalizeMaterial(optText(r.material)),
      color: normalizeColor(optText(r.color)),
      condition,
      conditionOrdinal: condition ? CONDITION_ORDINAL[condition] : -1,
      listedPriceCents: r.listedPriceCents,
      finalPriceCents: finalPrice,
      finalPriceEstimated: finalPrice !== null && r.finalPriceEstimated === true,
      listedAt,
      soldAt,
      delayDays: soldAt === null ? null : (soldAt - listedAt) / DAY_MS,
      season: seasonOf(listedAt),
      photoCount: optCount(r.photoCount),
      views: optCount(r.views),
      favorites: optCount(r.favorites),
      source: r.source as PriceReferenceSource,
      sold,
      targetPriceCents: sold ? (finalPrice ?? r.listedPriceCents) : null,
    } satisfies CleanReference;
  });

  // Dédoublonnage : même marque, catégorie, taille, prix affiché et jour de mise en ligne (UTC).
  const best = new Map<string, number>();
  first.forEach((r, i) => {
    if (!r) return;
    const key = `${r.brand}|${r.category}|${r.size.key}|${r.listedPriceCents}|${Math.floor(r.listedAt / DAY_MS)}`;
    const j = best.get(key);
    if (j === undefined) best.set(key, i);
    else if (completeness(r) > completeness(first[j]!)) best.set(key, i);
  });
  const keepIndex = new Set(best.values());
  const deduped: CleanReference[] = [];
  first.forEach((r, i) => {
    if (!r) return;
    if (keepIndex.has(i)) deduped.push(r);
    else dropped.duplicate++;
  });

  // Prix aberrants : au-delà de maxFactor × la médiane (marque et catégorie ≥ 5 lignes, sinon catégorie ≥ 5, sinon tout).
  const priceOf = (r: CleanReference) => r.targetPriceCents ?? r.listedPriceCents;
  const groups = new Map<string, number[]>();
  const push = (k: string, v: number) => {
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  for (const r of deduped) {
    push(`b|${r.brand}|${r.category}`, priceOf(r));
    push(`c|${r.category}`, priceOf(r));
    push("*", priceOf(r));
  }
  const medians = new Map<string, number>();
  for (const [k, v] of groups) if (v.length >= 5 || k === "*") medians.set(k, median(v));
  const kept = deduped.filter((r) => {
    const m = medians.get(`b|${r.brand}|${r.category}`) ?? medians.get(`c|${r.category}`) ?? medians.get("*")!;
    if (priceOf(r) > maxFactor * m) {
      dropped.price_too_high++;
      return false;
    }
    return true;
  });

  for (const r of kept) bySource[r.source]++;
  const sold = kept.filter((r) => r.sold).length;
  return {
    references: kept,
    report: { input: references.length, kept: kept.length, sold, unsold: kept.length - sold, dropped, bySource },
  };
}
