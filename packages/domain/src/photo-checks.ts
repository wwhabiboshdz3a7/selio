import { GARMENT_KINDS, ITEM_CATEGORIES, MEASUREMENT_LABELS, MEASUREMENT_NAMES, type GarmentKind, type ItemCategory, type MeasurementName, type MeasurementSource, type NamedMeasurementField, type PhotoRole } from "@selio/contracts";
import { EXPECTED_MEASUREMENTS, garmentKindFor, simplifyText } from "./studio";

/**
 * Contrôle des photos et des mesures (§5.14) : une photo floue est repérée par la variance du laplacien
 * (calcul pur sur une image en niveaux de gris, utilisable côté navigateur sur un canvas et côté serveur sur
 * une version réduite) ; les mesures attendues dépendent de la famille de la pièce (celles de Studio) ; les
 * avertissements d'une annonce reprennent les mesures de Studio avec provenance quand elles existent.
 * Aucune valeur n'est inventée : une mesure absente reste absente, on le signale.
 */

// ----------------------------------------------------------------- netteté

/**
 * Seuil par défaut de la variance du laplacien sous lequel une photo est considérée floue. Valeur classique
 * pour des images 8 bits réduites (côté long ≈ 512 à 1 024 px) ; à AJUSTER sur nos propres photos, et
 * paramétrable partout (`isBlurry(score, threshold)`).
 */
export const DEFAULT_BLUR_THRESHOLD = 100;
/** Côté long conseillé pour calculer le score côté serveur (version réduite, jamais la photo entière). */
export const BLUR_ANALYSIS_MAX_SIDE_PX = 512;
/** Sous ce nombre de photos, l'annonce est signalée (Vinted en accepte jusqu'à 20 ; 3 est le strict minimum utile). */
export const MIN_LISTING_PHOTOS = 3;

/**
 * Niveaux de gris (luma Rec. 601) d'un tampon RGBA (canvas `getImageData().data`) ou RGB.
 * Pur : utilisable dans le navigateur et sur le serveur.
 */
export function toGrayscale(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 3 | 4 = 4): Uint8Array {
  const n = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("dimensions invalides");
  if (pixels.length < n * channels) throw new RangeError(`tampon trop court : ${pixels.length} octets pour ${width}×${height}×${channels}`);
  const gray = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += channels) {
    gray[i] = Math.round(0.299 * pixels[p]! + 0.587 * pixels[p + 1]! + 0.114 * pixels[p + 2]!);
  }
  return gray;
}

/**
 * Score de netteté : variance du laplacien (noyau 3×3 en croix) sur les pixels intérieurs. Plus il est
 * élevé, plus l'image a de contours nets ; une image floue (ou uniforme) a un score proche de 0.
 * Image trop petite (< 3 px de côté) ou tampon incomplet : 0 (on ne devine pas).
 */
export function blurScore(grayscale: Uint8Array, width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) return 0;
  if (grayscale.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = 4 * grayscale[i]! - grayscale[i - 1]! - grayscale[i + 1]! - grayscale[i - width]! - grayscale[i + width]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

export function isBlurry(score: number, threshold: number = DEFAULT_BLUR_THRESHOLD): boolean {
  return !Number.isFinite(score) || score < threshold;
}

/**
 * Réduction d'une image en niveaux de gris (moyenne par zone) pour calculer le score sur une version
 * réduite côté serveur : côté long ramené à `maxSide` au plus (facteur entier, jamais d'agrandissement).
 */
export function downsampleGray(grayscale: Uint8Array, width: number, height: number, maxSide: number = BLUR_ANALYSIS_MAX_SIDE_PX): { gray: Uint8Array; width: number; height: number; factor: number } {
  const factor = Math.max(1, Math.ceil(Math.max(width, height) / Math.max(1, maxSide)));
  if (factor === 1) return { gray: grayscale, width, height, factor };
  const w = Math.max(1, Math.floor(width / factor));
  const h = Math.max(1, Math.floor(height / factor));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * width;
        for (let dx = 0; dx < factor; dx++) acc += grayscale[row + x * factor + dx]!;
      }
      out[y * w + x] = Math.round(acc / (factor * factor));
    }
  }
  return { gray: out, width: w, height: h, factor };
}

// ----------------------------------------------------------------- mesures attendues

const isGarmentKind = (v: string): v is GarmentKind => (GARMENT_KINDS as readonly string[]).includes(v);
const isItemCategory = (v: string): v is ItemCategory => (ITEM_CATEGORIES as readonly string[]).includes(v);

/**
 * Mesures requises pour une catégorie d'article (ou une famille Studio), affinées par le titre quand il
 * est donné (« jean » → bas : taille et entrejambe). Même table que Studio (`EXPECTED_MEASUREMENTS`).
 */
export function requiredMeasurementsFor(category: ItemCategory | GarmentKind | null | undefined, title?: string | null): readonly MeasurementName[] {
  const kind = garmentKindOf(category, title);
  return EXPECTED_MEASUREMENTS[kind];
}

function garmentKindOf(category: ItemCategory | GarmentKind | null | undefined, title?: string | null): GarmentKind {
  const text = title ?? "";
  if (category && isGarmentKind(category) && !isItemCategory(category)) {
    // Famille Studio donnée explicitement (top, bottom…) : le titre ne peut que la préciser, jamais la contredire.
    const fromText = text ? garmentKindFor({ text }) : "other";
    return fromText !== "other" ? fromText : category;
  }
  const itemCategory = category && isItemCategory(category) ? category : null;
  return garmentKindFor({ text, category: itemCategory });
}

/** Synonymes français des mesures dans un texte (mot entier, sans accent). « taille » seule est une taille (S, M…), pas un tour de taille. */
const MEASUREMENT_WORDS: Record<MeasurementName, string[]> = {
  chest: ["poitrine", "aisselle a aisselle", "aisselles", "largeur poitrine", "tour de poitrine", "buste"],
  length: ["longueur", "hauteur", "long"],
  shoulders: ["epaules", "epaule", "largeur epaules", "carrure"],
  sleeve: ["manche", "manches", "longueur manche", "longueur de manche"],
  waist: ["tour de taille", "taille a plat", "ceinture", "largeur taille"],
  hips: ["hanches", "bassin", "tour de hanches"],
  inseam: ["entrejambe", "entre jambe", "interieur jambe"],
  rise: ["montant", "fourche", "hauteur de fourche"],
  sole: ["semelle", "semelle interieure", "longueur semelle", "longueur interieure"],
};

/**
 * Mesures (cm) trouvées dans un texte écrit par le vendeur (« poitrine 48 cm », « longueur : 70cm »).
 * Provenance « seller » : c'est lui qui l'a écrite. Une mesure en pouces ou sans unité est ignorée.
 */
export function measurementsInText(text: string | null | undefined): Partial<Record<MeasurementName, number>> {
  const out: Partial<Record<MeasurementName, number>> = {};
  const t = ` ${simplifyText(text ?? "")} `;
  if (t.trim().length === 0) return out;
  for (const name of MEASUREMENT_NAMES) {
    for (const word of MEASUREMENT_WORDS[name]) {
      const re = new RegExp(`(?:^|[^a-z])${word.replace(/ /g, "\\s+")}\\s*(?:[:=]|de|d)?\\s*(?:environ|env\\.?|~)?\\s*(\\d{1,3}(?:[.,]\\d)?)\\s*cm\\b`, "i");
      const m = t.match(re);
      if (!m) continue;
      const v = Number.parseFloat(m[1]!.replace(",", "."));
      if (Number.isFinite(v) && v > 0 && v <= 300) {
        out[name] = Math.round(v * 2) / 2;
        break;
      }
    }
  }
  return out;
}

export interface PresentMeasurement {
  name: MeasurementName;
  valueCm: number;
  source: MeasurementSource;
}

export interface MissingMeasurements {
  garmentKind: GarmentKind;
  required: MeasurementName[];
  present: PresentMeasurement[];
  missing: MeasurementName[];
}

export interface MeasuredItem {
  category?: ItemCategory | GarmentKind | null;
  title?: string | null;
  description?: string | null;
  /** Mesures de Studio avec provenance (gardées seulement avec une valeur ET une provenance). */
  measurements?: readonly NamedMeasurementField[] | null;
}

/**
 * Mesures manquantes d'un article : les mesures attendues pour sa famille, moins celles de Studio qui
 * portent une provenance (ruban, base des références, vendeur), moins celles écrites dans la description.
 */
export function missingMeasurements(item: MeasuredItem): MissingMeasurements {
  const kind = garmentKindOf(item.category ?? null, item.title ?? null);
  const required = [...EXPECTED_MEASUREMENTS[kind]];
  const present = new Map<MeasurementName, PresentMeasurement>();
  for (const m of item.measurements ?? []) {
    if (m.valueCm === null || m.source === null || present.has(m.name)) continue;
    present.set(m.name, { name: m.name, valueCm: m.valueCm, source: m.source });
  }
  const fromText = measurementsInText(item.description ?? null);
  for (const name of MEASUREMENT_NAMES) {
    const v = fromText[name];
    if (v !== undefined && !present.has(name)) present.set(name, { name, valueCm: v, source: "seller" });
  }
  return { garmentKind: kind, required, present: [...present.values()], missing: required.filter((n) => !present.has(n)) };
}

// ----------------------------------------------------------------- avertissements d'une annonce

export type ListingWarningCode = "no_photos" | "few_photos" | "blurry_photo" | "no_label_photo" | "missing_measurements";
export type ListingWarningSeverity = "high" | "medium" | "low";

export interface ListingWarning {
  code: ListingWarningCode;
  severity: ListingWarningSeverity;
  message: string;
  /** Photo concernée (position dans l'annonce, à partir de 0). */
  photoIndex?: number;
  /** Mesures concernées. */
  measurements?: MeasurementName[];
}

export interface ListingCheckInput extends MeasuredItem {
  /** Photos de l'annonce (légendes) ou leur nombre. */
  photos: readonly { alt?: string | null }[] | number;
  /** Rôles des photos selon le tri Studio (même ordre que `photos`) ; absents : les légendes servent de repère. */
  photoRoles?: readonly (PhotoRole | null | undefined)[] | null;
}

export interface ListingCheckOptions {
  blurThreshold?: number;
  minPhotos?: number;
}

export interface ListingCheck {
  ok: boolean;
  warnings: ListingWarning[];
  measurements: MissingMeasurements;
}

function looksLikeLabel(alt: string | null | undefined): boolean {
  return /etiquette|label|composition|\btag\b/.test(simplifyText(alt ?? ""));
}

/**
 * Avertissements d'une annonce : aucune photo, moins de 3 photos, photo floue n° X (d'après les scores
 * fournis, un score null = non calculé), aucune photo d'étiquette (rôles Studio, sinon légendes), mesures
 * manquantes pour la famille de la pièce.
 */
export function checkListing(item: ListingCheckInput, photoScores: readonly (number | null | undefined)[] = [], opts: ListingCheckOptions = {}): ListingCheck {
  const threshold = opts.blurThreshold ?? DEFAULT_BLUR_THRESHOLD;
  const minPhotos = opts.minPhotos ?? MIN_LISTING_PHOTOS;
  const warnings: ListingWarning[] = [];
  const photos = typeof item.photos === "number" ? Array.from({ length: Math.max(0, item.photos) }, () => ({ alt: null })) : item.photos;
  const count = photos.length;

  if (count === 0) warnings.push({ code: "no_photos", severity: "high", message: "Aucune photo : une annonce sans photo ne se vend pas." });
  else if (count < minPhotos) warnings.push({ code: "few_photos", severity: "high", message: `Seulement ${count} photo${count > 1 ? "s" : ""} : ajoutez-en au moins ${minPhotos} (face, dos, étiquette).` });

  photoScores.forEach((score, i) => {
    if (score === null || score === undefined || i >= count) return;
    if (isBlurry(score, threshold)) warnings.push({ code: "blurry_photo", severity: "medium", photoIndex: i, message: `Photo n° ${i + 1} floue (netteté ${Math.round(score)} < ${threshold}) : reprenez-la.` });
  });

  if (count > 0) {
    const roles = item.photoRoles ?? null;
    const hasLabel = roles ? roles.some((r) => r === "label") : photos.some((p) => looksLikeLabel(p.alt));
    if (!hasLabel) {
      warnings.push({
        code: "no_label_photo",
        severity: roles ? "medium" : "low",
        message: roles ? "Aucune photo d'étiquette : ajoutez l'étiquette (marque, taille, composition)." : "Aucune photo d'étiquette repérée d'après les légendes : ajoutez l'étiquette (marque, taille, composition), ou vérifiez.",
      });
    }
  }

  const measurements = missingMeasurements(item);
  if (measurements.missing.length > 0) {
    warnings.push({
      code: "missing_measurements",
      severity: "medium",
      measurements: measurements.missing,
      message: `Mesures manquantes : ${measurements.missing.map((n) => MEASUREMENT_LABELS[n].toLowerCase()).join(", ")}. Mesurez à plat, en cm ; Selio n'en invente aucune.`,
    });
  }
  return { ok: warnings.length === 0, warnings, measurements };
}
