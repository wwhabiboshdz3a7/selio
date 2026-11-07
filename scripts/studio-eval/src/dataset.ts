import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { GARMENT_KINDS, MEASUREMENT_NAMES, STUDIO_TAPE_MAX_PHOTOS, type GarmentKind, type LabelFieldName, type MeasurementName } from "@selio/contracts";
import type { LabelTruth } from "./compare";
import { parseCsv } from "./csv";

/**
 * Jeu de validation (docs/STUDIO.md, « Protocole de validation ») : un dossier HORS du dépôt.
 *
 *   <dossier>/
 *     etiquettes/verite.csv   photo;brand;size;material;reference   (200 photos d'étiquettes visées)
 *     etiquettes/*.jpg        photos réduites (côté long ≤ 1 024 px, JPEG ≈ 80, ≤ 1 Mo)
 *     mesures/verite.csv      article;garmentKind;photos;chest;length;shoulders;sleeve;waist;hips;inseam;rise;sole
 *     mesures/*.jpg           1 à 3 photos avec mètre ruban par article, séparées par « | » (50 articles visés)
 *
 * Règles : en-tête obligatoire ; toute colonne inconnue refuse le fichier entier (le jeu ne porte que des
 * photos de nos propres articles et leurs mesures, jamais une personne) ; une vérité vide n'est pas évaluée ;
 * une photo introuvable, en double ou en trop est signalée et le cas est écarté, jamais deviné.
 */

export const LABELS_DIR = "etiquettes";
export const TAPES_DIR = "mesures";
export const TRUTH_FILE = "verite.csv";
export const PHOTO_LIST_SEPARATOR = "|";

export interface LabelCase {
  id: string;
  photo: string;
  file: string;
  truth: LabelTruth;
  line: number;
}

export interface TapeCase {
  id: string;
  article: string;
  photos: string[];
  files: string[];
  garmentKind: GarmentKind;
  truth: Partial<Record<MeasurementName, number>>;
  line: number;
}

export interface DatasetProblem {
  section: "etiquettes" | "mesures";
  line: number;
  message: string;
}

export interface Dataset {
  root: string;
  labels: LabelCase[];
  tapes: TapeCase[];
  problems: DatasetProblem[];
  /** Sections présentes sur le disque (une seule suffit). */
  sections: { labels: boolean; tapes: boolean };
}

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

export interface LoadDatasetOptions {
  only?: "labels" | "tapes";
  /** Nombre de cas gardés par section (les premiers du fichier). */
  limit?: number;
}

// ---------------------------------------------------------------- colonnes

function normalizeHeader(h: string): string {
  return h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type LabelColumn = "photo" | LabelFieldName | "ignore";
const LABEL_COLUMNS: Record<string, LabelColumn> = {
  photo: "photo", fichier: "photo", file: "photo", image: "photo", filename: "photo", nomphoto: "photo",
  brand: "brand", marque: "brand",
  size: "size", taille: "size",
  material: "material", matiere: "material", composition: "material",
  reference: "reference", ref: "reference", modele: "reference", model: "reference",
  note: "ignore", notes: "ignore", commentaire: "ignore", remarque: "ignore",
};

type TapeColumn = "article" | "garmentKind" | "photos" | "ignore" | { measure: MeasurementName };
const TAPE_FIELD_COLUMNS: Record<string, Exclude<TapeColumn, { measure: MeasurementName }>> = {
  article: "article", numero: "article", piece: "article",
  garmentkind: "garmentKind", famille: "garmentKind", kind: "garmentKind", type: "garmentKind", category: "garmentKind", categorie: "garmentKind",
  photos: "photos", photo: "photos", fichiers: "photos", files: "photos", images: "photos",
  note: "ignore", notes: "ignore", commentaire: "ignore", remarque: "ignore",
};
const MEASURE_ALIASES: Record<string, MeasurementName> = {
  poitrine: "chest", longueur: "length", epaules: "shoulders", manche: "sleeve", tourdetaille: "waist", ceinture: "waist",
  hanches: "hips", entrejambe: "inseam", montant: "rise", semelle: "sole",
};

function tapeColumnOf(header: string): TapeColumn | null {
  const n = normalizeHeader(header);
  if (TAPE_FIELD_COLUMNS[n]) return TAPE_FIELD_COLUMNS[n]!;
  const base = n.endsWith("cm") ? n.slice(0, -2) : n;
  const direct = MEASUREMENT_NAMES.find((m) => m === base);
  if (direct) return { measure: direct };
  const alias = MEASURE_ALIASES[base];
  return alias ? { measure: alias } : null;
}

const GARMENT_ALIASES: Record<string, GarmentKind> = {
  haut: "top", top: "top", tshirt: "top", pull: "top", chemise: "top",
  vesteoumanteau: "outerwear", veste: "outerwear", manteau: "outerwear", outerwear: "outerwear",
  robeoucombinaison: "dress", robe: "dress", combinaison: "dress", dress: "dress",
  bas: "bottom", pantalon: "bottom", jean: "bottom", jupe: "bottom", short: "bottom", bottom: "bottom",
  chaussures: "shoes", chaussure: "shoes", shoes: "shoes",
  sac: "bag", bag: "bag",
  accessoire: "accessory", accessory: "accessory",
  autre: "other", other: "other",
};

export function garmentKindOf(raw: string): GarmentKind | null {
  const n = normalizeHeader(raw);
  if (!n) return null;
  if ((GARMENT_KINDS as readonly string[]).includes(n)) return n as GarmentKind;
  return GARMENT_ALIASES[n] ?? null;
}

/** « 52 », « 52,5 », « 52.5 cm » → 52,5 ; null si illisible ; undefined si vide. */
export function cmOf(raw: string): number | null | undefined {
  const s = raw.trim().toLowerCase().replace(/\s*cm$/, "").replace(",", ".");
  if (!s) return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v > 0 && v <= 300 ? v : null;
}

const emptyToNull = (v: string | undefined): string | null => (v && v.trim().length > 0 ? v.trim() : null);

// ---------------------------------------------------------------- lecture

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Un nom de photo reste dans son dossier : ni chemin absolu, ni « .. ». */
function safePhotoName(name: string): boolean {
  return name.length > 0 && !path.isAbsolute(name) && !name.split(/[\\/]/).includes("..");
}

async function loadLabels(dir: string, problems: DatasetProblem[], limit: number | undefined): Promise<LabelCase[]> {
  const table = parseCsv(await readFile(path.join(dir, TRUTH_FILE), "utf8"));
  const columns = table.header.map((h) => ({ header: h, column: LABEL_COLUMNS[normalizeHeader(h)] ?? null }));
  const unknown = columns.filter((c) => c.column === null).map((c) => c.header);
  if (unknown.length > 0) throw new DatasetError(`${LABELS_DIR}/${TRUTH_FILE} : colonne(s) inconnue(s) « ${unknown.join(" », « ")} » : fichier refusé (colonnes acceptées : photo, brand, size, material, reference).`);
  if (!columns.some((c) => c.column === "photo")) throw new DatasetError(`${LABELS_DIR}/${TRUTH_FILE} : colonne « photo » obligatoire.`);
  if (!columns.some((c) => c.column === "brand" || c.column === "size" || c.column === "material" || c.column === "reference")) {
    throw new DatasetError(`${LABELS_DIR}/${TRUTH_FILE} : au moins une colonne de vérité (brand, size, material, reference).`);
  }
  const seen = new Set<string>();
  const cases: LabelCase[] = [];
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r]!;
    const line = table.lineNumbers[r]!;
    const cells: Partial<Record<LabelColumn, string>> = {};
    columns.forEach((c, i) => {
      if (c.column && c.column !== "ignore" && row[i] !== undefined) cells[c.column] = row[i];
    });
    const photo = (cells.photo ?? "").trim();
    if (!safePhotoName(photo)) {
      problems.push({ section: "etiquettes", line, message: `ligne ${line} : nom de photo manquant ou invalide (« ${photo} »)` });
      continue;
    }
    if (seen.has(photo)) {
      problems.push({ section: "etiquettes", line, message: `ligne ${line} : photo « ${photo} » en double, ligne ignorée` });
      continue;
    }
    seen.add(photo);
    const truth: LabelTruth = { brand: emptyToNull(cells.brand), size: emptyToNull(cells.size), material: emptyToNull(cells.material), reference: emptyToNull(cells.reference) };
    if (!truth.brand && !truth.size && !truth.material && !truth.reference) {
      problems.push({ section: "etiquettes", line, message: `ligne ${line} : aucune vérité pour « ${photo} », ligne ignorée` });
      continue;
    }
    const file = path.join(dir, photo);
    if (!(await isFile(file))) {
      problems.push({ section: "etiquettes", line, message: `ligne ${line} : photo « ${photo} » introuvable, ligne ignorée` });
      continue;
    }
    cases.push({ id: `E${String(cases.length + 1).padStart(3, "0")}`, photo, file, truth, line });
    if (limit !== undefined && cases.length >= limit) break;
  }
  return cases;
}

async function loadTapes(dir: string, problems: DatasetProblem[], limit: number | undefined): Promise<TapeCase[]> {
  const table = parseCsv(await readFile(path.join(dir, TRUTH_FILE), "utf8"));
  const columns = table.header.map((h) => ({ header: h, column: tapeColumnOf(h) }));
  const unknown = columns.filter((c) => c.column === null).map((c) => c.header);
  if (unknown.length > 0) {
    throw new DatasetError(`${TAPES_DIR}/${TRUTH_FILE} : colonne(s) inconnue(s) « ${unknown.join(" », « ")} » : fichier refusé (colonnes acceptées : article, garmentKind, photos, ${MEASUREMENT_NAMES.join(", ")}).`);
  }
  for (const required of ["article", "garmentKind", "photos"] as const) {
    if (!columns.some((c) => c.column === required)) throw new DatasetError(`${TAPES_DIR}/${TRUTH_FILE} : colonne « ${required}${required === "photos" ? " » (ou « photo »" : " »"} obligatoire.`);
  }
  if (!columns.some((c) => typeof c.column === "object")) throw new DatasetError(`${TAPES_DIR}/${TRUTH_FILE} : au moins une colonne de mesure (${MEASUREMENT_NAMES.join(", ")}).`);
  const seenArticles = new Set<string>();
  const seenPhotos = new Set<string>();
  const cases: TapeCase[] = [];
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r]!;
    const line = table.lineNumbers[r]!;
    let article = "";
    let kindRaw = "";
    let photosRaw = "";
    const truth: Partial<Record<MeasurementName, number>> = {};
    const bad: string[] = [];
    columns.forEach((c, i) => {
      const v = row[i];
      if (v === undefined || c.column === null || c.column === "ignore") return;
      if (c.column === "article") article = v.trim();
      else if (c.column === "garmentKind") kindRaw = v.trim();
      else if (c.column === "photos") photosRaw = v.trim();
      else {
        const cm = cmOf(v);
        if (cm === null) bad.push(`${c.column.measure} = « ${v} » (nombre en cm attendu, 0 à 300)`);
        else if (cm !== undefined) truth[c.column.measure] = cm;
      }
    });
    const label = article || `ligne ${line}`;
    if (!article) {
      problems.push({ section: "mesures", line, message: `ligne ${line} : article sans nom, ligne ignorée` });
      continue;
    }
    if (seenArticles.has(article)) {
      problems.push({ section: "mesures", line, message: `ligne ${line} : article « ${article} » en double, ligne ignorée` });
      continue;
    }
    const garmentKind = garmentKindOf(kindRaw);
    if (!garmentKind) {
      problems.push({ section: "mesures", line, message: `${label} : famille « ${kindRaw} » inconnue (${GARMENT_KINDS.join(", ")}), ligne ignorée` });
      continue;
    }
    if (bad.length > 0) {
      problems.push({ section: "mesures", line, message: `${label} : ${bad.join(" ; ")}, ligne ignorée` });
      continue;
    }
    if (Object.keys(truth).length === 0) {
      problems.push({ section: "mesures", line, message: `${label} : aucune mesure vraie, ligne ignorée` });
      continue;
    }
    const photos = photosRaw.split(PHOTO_LIST_SEPARATOR).map((p) => p.trim()).filter((p) => p.length > 0);
    if (photos.length === 0 || photos.some((p) => !safePhotoName(p))) {
      problems.push({ section: "mesures", line, message: `${label} : photos manquantes ou invalides, ligne ignorée` });
      continue;
    }
    if (photos.length > STUDIO_TAPE_MAX_PHOTOS) {
      problems.push({ section: "mesures", line, message: `${label} : ${photos.length} photos, ${STUDIO_TAPE_MAX_PHOTOS} au plus par lecture de mesures, ligne ignorée` });
      continue;
    }
    const dup = photos.find((p) => seenPhotos.has(p));
    if (dup) {
      problems.push({ section: "mesures", line, message: `${label} : photo « ${dup} » déjà utilisée par un autre article, ligne ignorée` });
      continue;
    }
    const files = photos.map((p) => path.join(dir, p));
    const missing: string[] = [];
    for (let i = 0; i < files.length; i++) if (!(await isFile(files[i]!))) missing.push(photos[i]!);
    if (missing.length > 0) {
      problems.push({ section: "mesures", line, message: `${label} : photo(s) introuvable(s) « ${missing.join(" », « ")} », ligne ignorée` });
      continue;
    }
    seenArticles.add(article);
    photos.forEach((p) => seenPhotos.add(p));
    cases.push({ id: `M${String(cases.length + 1).padStart(3, "0")}`, article, photos, files, garmentKind, truth, line });
    if (limit !== undefined && cases.length >= limit) break;
  }
  return cases;
}

export async function loadDataset(root: string, opts: LoadDatasetOptions = {}): Promise<Dataset> {
  const abs = path.resolve(root);
  if (!(await isDir(abs))) throw new DatasetError(`Dossier introuvable : ${abs}`);
  const labelsDir = path.join(abs, LABELS_DIR);
  const tapesDir = path.join(abs, TAPES_DIR);
  const sections = { labels: await isFile(path.join(labelsDir, TRUTH_FILE)), tapes: await isFile(path.join(tapesDir, TRUTH_FILE)) };
  if (!sections.labels && !sections.tapes) {
    throw new DatasetError(`Aucune vérité terrain dans ${abs} : attendu ${LABELS_DIR}/${TRUTH_FILE} et/ou ${TAPES_DIR}/${TRUTH_FILE} (structure dans docs/STUDIO.md).`);
  }
  const problems: DatasetProblem[] = [];
  const labels = sections.labels && opts.only !== "tapes" ? await loadLabels(labelsDir, problems, opts.limit) : [];
  const tapes = sections.tapes && opts.only !== "labels" ? await loadTapes(tapesDir, problems, opts.limit) : [];
  return { root: abs, labels, tapes, problems, sections };
}
