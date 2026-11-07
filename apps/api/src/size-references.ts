import { GARMENT_KINDS, MEASUREMENT_NAMES, type GarmentKind, type MeasurementName } from "@selio/contracts";
import { MEASUREMENT_BOUNDS_CM } from "@selio/ai";

/**
 * Import opérateur de la base des références de tailles (Studio, §5.11) : mesures connues d'un modèle,
 * retrouvées ensuite par la marque et la référence lues sur l'étiquette. Fichier CSV (séparateur `,` `;` ou
 * tabulation, en-tête obligatoire) ou JSON (tableau d'objets, ou `{ "references": [...] }`).
 *
 * Aucune donnée personnelle : le fichier ENTIER est refusé s'il contient une colonne personnelle (pseudo,
 * vendeur, email, nom, adresse, téléphone, photo, lien, titre, identifiant…), et toute colonne inconnue est
 * refusée. Tout ou rien : une seule ligne invalide refuse l'import (rien n'est écrit), avec le numéro de ligne.
 *
 * Jamais de mesure inventée : chaque mesure vient du fichier (en cm, 0,5 à 300, dans les bornes plausibles
 * de la lecture du mètre ruban) ; une taille est obligatoire, sauf pour un sac ou un accessoire (mesures
 * indépendantes de la taille).
 */

export const SIZE_REFERENCE_IMPORT_MAX_ROWS = 5000;
/** Erreurs rendues au plus (le reste est compté). */
const MAX_ERRORS = 25;

export interface SizeReferenceImportRow {
  brand: string;
  reference: string;
  size: string | null;
  category: GarmentKind;
  measurements: Partial<Record<MeasurementName, number>>;
}

export interface SizeReferenceImportError {
  /** Ligne du fichier (CSV : 1 = en-tête ; JSON : position dans le tableau, à partir de 1). 0 = le fichier entier. */
  line: number;
  message: string;
}

export type SizeReferenceImportResult =
  | { ok: true; format: "csv" | "json"; rows: SizeReferenceImportRow[] }
  | { ok: false; format: "csv" | "json" | null; errors: SizeReferenceImportError[]; errorCount: number; personalColumns?: string[]; unknownColumns?: string[] };

// ---------------------------------------------------------------- colonnes

/** Mot d'en-tête normalisé : minuscules, sans accents, séparateurs retirés (« Garment_Kind » → « garmentkind »). */
function normalizeHeader(h: string): string {
  return h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Mots d'un en-tête (« sellerName » → seller, name ; « e_mail » → e, mail). */
function headerTokens(h: string): string[] {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const PERSONAL_TOKENS = new Set([
  "id", "ids", "uid", "uuid", "user", "users", "username", "login", "name", "nom", "prenom", "firstname", "lastname", "pseudo", "handle",
  "email", "mail", "courriel", "phone", "tel", "telephone", "mobile", "address", "adresse", "city", "ville", "zip", "postal", "ip",
  "photo", "photos", "image", "images", "picture", "avatar", "url", "urls", "lien", "link", "href", "title", "titre", "description",
  "seller", "vendeur", "vendeuse", "buyer", "acheteur", "acheteuse", "customer", "client", "member", "membre", "profile", "profil",
  "owner", "org", "organisation", "organization", "account", "compte", "iban", "siret",
]);
const PERSONAL_PATTERN = /(pseudo|vendeu|seller|username|utilisat|e?mail|courriel|telephone|phone|adresse|address|photo|image|avatar|profil|identifiant|acheteu|buyer|customer)/;

/** Une colonne personnelle refuse le fichier entier. */
export function isPersonalColumn(header: string): boolean {
  const n = normalizeHeader(header);
  return headerTokens(header).some((t) => PERSONAL_TOKENS.has(t)) || PERSONAL_PATTERN.test(n);
}

type Column = { kind: "brand" | "reference" | "size" | "category" } | { kind: "measure"; name: MeasurementName } | { kind: "measurements" };

const FIELD_ALIASES: Record<string, Column> = {
  brand: { kind: "brand" },
  marque: { kind: "brand" },
  reference: { kind: "reference" },
  ref: { kind: "reference" },
  size: { kind: "size" },
  category: { kind: "category" },
  garmentkind: { kind: "category" },
  famille: { kind: "category" },
  measurements: { kind: "measurements" },
};

/** Colonne reconnue : champ, mesure (« chest », « chest_cm », « chestCm ») ; null si inconnue. */
function columnOf(header: string): Column | null {
  const n = normalizeHeader(header);
  if (FIELD_ALIASES[n]) return FIELD_ALIASES[n]!;
  const base = n.endsWith("cm") ? n.slice(0, -2) : n;
  const name = MEASUREMENT_NAMES.find((m) => m === base);
  return name ? { kind: "measure", name } : null;
}

// ---------------------------------------------------------------- valeurs

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

function garmentOf(raw: string): GarmentKind | null {
  const n = normalizeHeader(raw);
  if (!n) return "other";
  if ((GARMENT_KINDS as readonly string[]).includes(n)) return n as GarmentKind;
  return GARMENT_ALIASES[n] ?? null;
}

/** « 52 », « 52,5 », « 52.5 cm » → 52,5 ; null si illisible ; undefined si vide. */
function cmOf(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().toLowerCase().replace(/\s*cm$/, "").replace(",", ".");
  if (!s) return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

const SIZE_FREE: readonly GarmentKind[] = ["bag", "accessory"];

/** Valide une ligne déjà ramenée à ses colonnes reconnues. */
function validateRow(cells: Map<Column, unknown>): { row: SizeReferenceImportRow } | { error: string } {
  let brand = "", reference = "", size = "", categoryRaw = "";
  const measurements: Partial<Record<MeasurementName, number>> = {};
  const problems: string[] = [];
  const setMeasure = (name: MeasurementName, raw: unknown) => {
    const v = cmOf(raw);
    if (v === undefined) return;
    if (v === null) { problems.push(`${name} : nombre en cm attendu`); return; }
    const [min, max] = MEASUREMENT_BOUNDS_CM[name];
    if (v < 0.5 || v > 300 || v < min || v > max) { problems.push(`${name} = ${v} cm hors des bornes plausibles (${min} à ${max} cm)`); return; }
    measurements[name] = Math.round(v * 2) / 2;
  };
  for (const [col, raw] of cells) {
    if (col.kind === "brand") brand = text(raw);
    else if (col.kind === "reference") reference = text(raw);
    else if (col.kind === "size") size = text(raw);
    else if (col.kind === "category") categoryRaw = text(raw);
    else if (col.kind === "measure") setMeasure(col.name, raw);
    else if (raw !== null && raw !== undefined && raw !== "") {
      if (typeof raw !== "object" || Array.isArray(raw)) { problems.push("measurements : objet { nom: cm } attendu"); continue; }
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const c = columnOf(k);
        if (c?.kind !== "measure") { problems.push(`mesure inconnue « ${k.slice(0, 30)} » (attendu : ${MEASUREMENT_NAMES.join(", ")})`); continue; }
        setMeasure(c.name, v);
      }
    }
  }
  if (!brand || brand.length > 80 || !/[\p{L}\p{N}]/u.test(brand)) problems.push("marque (brand) obligatoire, 80 caractères au plus");
  if (!reference || reference.length > 80 || reference.replace(/[^A-Za-z0-9]/g, "").length < 2) problems.push("référence (reference) obligatoire : 2 lettres ou chiffres au moins, 80 caractères au plus");
  const category = garmentOf(categoryRaw);
  if (!category) problems.push(`famille (category) inconnue « ${categoryRaw.slice(0, 30)} » : ${GARMENT_KINDS.join(", ")}`);
  if (size.length > 40) problems.push("taille (size) : 40 caractères au plus");
  if (category && !size && !SIZE_FREE.includes(category)) problems.push("taille (size) obligatoire : les mesures d'un vêtement ou de chaussures dépendent de la taille");
  if (Object.keys(measurements).length === 0 && problems.length === 0) problems.push("au moins une mesure en cm est nécessaire");
  if (problems.length > 0) return { error: problems.join(" ; ") };
  return { row: { brand, reference, size: size || null, category: category!, measurements } };
}

// ---------------------------------------------------------------- CSV

/** Découpe un CSV (guillemets doubles, "" échappé, retours à la ligne dans un champ cité). */
export function parseCsv(input: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === separator) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function detectSeparator(headerLine: string): string {
  const counts = [";", "\t", ","].map((sep) => ({ sep, n: headerLine.split(sep).length - 1 }));
  return counts.sort((a, b) => b.n - a.n)[0]!.n > 0 ? counts[0]!.sep : ",";
}

// ---------------------------------------------------------------- point d'entrée

function checkHeaders(headers: string[]): { columns: (Column | null)[]; personal: string[]; unknown: string[] } {
  const personal = headers.filter((h) => h.trim() && isPersonalColumn(h));
  const columns = headers.map((h) => (h.trim() ? columnOf(h) : null));
  const unknown = headers.filter((h, i) => h.trim() && !columns[i] && !personal.includes(h));
  return { columns, personal, unknown };
}

function refuse(format: "csv" | "json" | null, message: string, extra: { personalColumns?: string[]; unknownColumns?: string[] } = {}): SizeReferenceImportResult {
  return { ok: false, format, errors: [{ line: 0, message }], errorCount: 1, ...extra };
}

/** Clé d'unicité (comme la base) : marque, référence et taille normalisées. */
function uniqueKey(r: SizeReferenceImportRow): string {
  return [r.brand.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), r.reference.toUpperCase().replace(/[^A-Z0-9]/g, ""), (r.size ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")].join("|");
}

function finish(format: "csv" | "json", parsed: { line: number; result: ReturnType<typeof validateRow> }[]): SizeReferenceImportResult {
  const errors: SizeReferenceImportError[] = [];
  const rows: SizeReferenceImportRow[] = [];
  const seen = new Map<string, number>();
  let errorCount = 0;
  for (const p of parsed) {
    if ("error" in p.result) {
      errorCount++;
      if (errors.length < MAX_ERRORS) errors.push({ line: p.line, message: p.result.error });
      continue;
    }
    const key = uniqueKey(p.result.row);
    const first = seen.get(key);
    if (first !== undefined) {
      errorCount++;
      if (errors.length < MAX_ERRORS) errors.push({ line: p.line, message: `doublon de la ligne ${first} (même marque, référence et taille)` });
      continue;
    }
    seen.set(key, p.line);
    rows.push(p.result.row);
  }
  if (errorCount > 0) return { ok: false, format, errors, errorCount };
  if (rows.length === 0) return refuse(format, "Aucune référence dans le fichier.");
  return { ok: true, format, rows };
}

function parseCsvImport(csv: string): SizeReferenceImportResult {
  const firstLine = csv.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const table = parseCsv(csv, detectSeparator(firstLine));
  if (table.length < 2) return refuse("csv", "CSV vide : un en-tête puis au moins une ligne sont attendus.");
  const headers = table[0]!.map((h) => h.trim());
  const { columns, personal, unknown } = checkHeaders(headers);
  if (personal.length > 0) return refuse("csv", `Fichier refusé : colonne personnelle (${personal.join(", ")}). La base des références ne garde aucune donnée personnelle.`, { personalColumns: personal });
  if (unknown.length > 0) return refuse("csv", `Colonne inconnue (${unknown.join(", ")}) : brand, reference, size, category et les mesures en cm (${MEASUREMENT_NAMES.join(", ")}).`, { unknownColumns: unknown });
  if (table.length - 1 > SIZE_REFERENCE_IMPORT_MAX_ROWS) return refuse("csv", `${table.length - 1} lignes : ${SIZE_REFERENCE_IMPORT_MAX_ROWS} au plus par import.`);
  const parsed = table.slice(1).map((cells, i) => {
    const map = new Map<Column, unknown>();
    columns.forEach((c, j) => { if (c) map.set(c, cells[j] ?? ""); });
    return { line: i + 2, result: validateRow(map) };
  });
  return finish("csv", parsed);
}

function parseJsonImport(data: unknown): SizeReferenceImportResult {
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? ((data as Record<string, unknown>).references ?? (data as Record<string, unknown>).sizeReferences) : undefined;
  if (!Array.isArray(list)) return refuse("json", "JSON attendu : un tableau de références, ou { \"references\": [...] }.");
  if (list.length === 0) return refuse("json", "Aucune référence dans le fichier.");
  if (list.length > SIZE_REFERENCE_IMPORT_MAX_ROWS) return refuse("json", `${list.length} références : ${SIZE_REFERENCE_IMPORT_MAX_ROWS} au plus par import.`);
  if (list.some((r) => !r || typeof r !== "object" || Array.isArray(r))) return refuse("json", "Chaque référence doit être un objet.");
  const headers = [...new Set(list.flatMap((r) => Object.keys(r as Record<string, unknown>)))];
  const { personal, unknown } = checkHeaders(headers);
  if (personal.length > 0) return refuse("json", `Fichier refusé : champ personnel (${personal.join(", ")}). La base des références ne garde aucune donnée personnelle.`, { personalColumns: personal });
  if (unknown.length > 0) return refuse("json", `Champ inconnu (${unknown.join(", ")}) : brand, reference, size, category, measurements ou les mesures en cm (${MEASUREMENT_NAMES.join(", ")}).`, { unknownColumns: unknown });
  const parsed = list.map((r, i) => {
    const map = new Map<Column, unknown>();
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) map.set(columnOf(k)!, v);
    return { line: i + 1, result: validateRow(map) };
  });
  return finish("json", parsed);
}

/**
 * Lit un import : texte CSV, texte JSON, ou données JSON déjà décodées. `format` force la lecture ; sinon un
 * texte qui commence par `[` ou `{` est lu comme du JSON.
 */
export function parseSizeReferenceImport(input: unknown, format?: "csv" | "json"): SizeReferenceImportResult {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return refuse(format ?? null, "Fichier vide.");
    if (format === "json" || (!format && (trimmed.startsWith("[") || trimmed.startsWith("{")))) {
      try {
        return parseJsonImport(JSON.parse(trimmed));
      } catch {
        return refuse("json", "JSON illisible.");
      }
    }
    return parseCsvImport(input);
  }
  return parseJsonImport(input);
}
