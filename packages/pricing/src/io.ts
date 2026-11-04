/**
 * Lecture d'une base de références depuis un fichier CSV ou JSON (script `pnpm prix:eval`).
 *
 * Toute colonne (ou clé) qui porterait une donnée personnelle ou un identifiant public d'annonce
 * (pseudo, identifiant, adresse, photo, titre…) fait refuser le fichier entier : la base de
 * références n'en contient jamais. Une colonne inconnue est refusée aussi, pour ne rien laisser
 * passer par mégarde.
 */
import { FORBIDDEN_REFERENCE_KEYS, priceReferenceSchema, type PriceReference, type PriceReferenceSource } from "./types";

export interface ParseError {
  /** Ligne du fichier (1 = en-tête pour un CSV) ou rang dans le tableau JSON (à partir de 1). */
  line: number;
  message: string;
}

export interface ParseResult {
  references: PriceReference[];
  errors: ParseError[];
}

/** Fichier refusé parce qu'il contient des données personnelles ou des identifiants d'annonce. */
export class PersonalDataError extends Error {
  constructor(public readonly columns: string[]) {
    super(`Fichier refusé : colonnes de données personnelles ou d'identifiants d'annonce (${columns.join(", ")}). Retirez-les : la base de références n'en contient jamais.`);
    this.name = "PersonalDataError";
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const FORBIDDEN = new Set(FORBIDDEN_REFERENCE_KEYS.map(norm));
for (const extra of ["vendeur", "acheteur", "membre", "profil", "lien", "annonce", "idannonce", "image", "titre", "email", "mail", "nom", "name", "telephone", "phone", "adresse", "address"]) FORBIDDEN.add(extra);

const TEXT_FIELDS = ["brand", "category", "subcategory", "size", "material", "color", "condition", "listedAt", "soldAt", "source"] as const;
const INT_FIELDS = ["listedPriceCents", "finalPriceCents", "photoCount", "views", "favorites"] as const;
type Field = (typeof TEXT_FIELDS)[number] | (typeof INT_FIELDS)[number];
/** En-têtes acceptés (normalisés) → champ ; les prix en euros sont convertis en centimes. */
const COLUMN_MAP: Record<string, { field: Field; euros?: true }> = {};
for (const f of [...TEXT_FIELDS, ...INT_FIELDS]) COLUMN_MAP[norm(f)] = { field: f };
for (const [alias, field] of [["listedprice", "listedPriceCents"], ["listedpriceeur", "listedPriceCents"], ["listedpriceeuros", "listedPriceCents"], ["finalprice", "finalPriceCents"], ["finalpriceeur", "finalPriceCents"], ["finalpriceeuros", "finalPriceCents"]] as const) COLUMN_MAP[alias] = { field, euros: true };

/** Colonnes acceptées, pour les messages. */
export const ACCEPTED_COLUMNS = [...TEXT_FIELDS, ...INT_FIELDS, "listedPriceEur", "finalPriceEur"];

/** Découpe un CSV (guillemets RFC 4180, séparateur « , », « ; » ou tabulation détecté sur l'en-tête). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  const delim = counts[0]![1] > 1 ? counts[0]![0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function toInt(v: string, euros: boolean): number | null | "invalid" {
  const t = v.trim().replace(/\s/g, "");
  if (t === "") return null;
  if (euros) {
    if (!/^-?\d+([.,]\d{1,2})?$/.test(t)) return "invalid";
    return Math.round(Number(t.replace(",", ".")) * 100);
  }
  if (!/^-?\d+$/.test(t)) return "invalid";
  return Number(t);
}

function validate(obj: Record<string, unknown>, line: number, errors: ParseError[]): PriceReference | null {
  const parsed = priceReferenceSchema.safeParse(obj);
  if (parsed.success) return parsed.data as PriceReference;
  errors.push({ line, message: parsed.error.issues.map((i) => `${i.path.join(".") || "ligne"} : ${i.message}`).join(" ; ") });
  return null;
}

/** Lit un CSV de références. Lève `PersonalDataError` ou une erreur d'en-tête ; les lignes invalides sont listées dans `errors`. */
export function parseReferencesCsv(text: string, options: { defaultSource?: PriceReferenceSource } = {}): ParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { references: [], errors: [] };
  const header = rows[0]!.map((h) => h.trim());
  const forbidden = header.filter((h) => FORBIDDEN.has(norm(h)));
  if (forbidden.length) throw new PersonalDataError(forbidden);
  const unknown = header.filter((h) => h !== "" && !COLUMN_MAP[norm(h)]);
  if (unknown.length) throw new Error(`Colonnes inconnues : ${unknown.join(", ")}. Colonnes acceptées : ${ACCEPTED_COLUMNS.join(", ")}.`);
  const cols = header.map((h) => (h === "" ? null : COLUMN_MAP[norm(h)]!));
  const defaultSource = options.defaultSource ?? "provided_base";
  const references: PriceReference[] = [];
  const errors: ParseError[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, unknown> = {};
    const cells = rows[r]!;
    let bad: string | null = null;
    for (let c = 0; c < cells.length && bad === null; c++) {
      const col = cols[c];
      const value = cells[c]!;
      if (!col) continue;
      if ((INT_FIELDS as readonly string[]).includes(col.field)) {
        const n = toInt(value, col.euros === true);
        if (n === "invalid") bad = `${header[c]} : nombre invalide « ${value} »`;
        else if (n !== null) obj[col.field] = n;
      } else if (value.trim() !== "") obj[col.field] = value.trim();
    }
    if (bad !== null) {
      errors.push({ line: r + 1, message: bad });
      continue;
    }
    if (obj.brand === undefined) obj.brand = "";
    if (obj.source === undefined) obj.source = defaultSource;
    const ref = validate(obj, r + 1, errors);
    if (ref) references.push(ref);
  }
  return { references, errors };
}

/** Lit un tableau JSON de références (ou `{ references: [...] }`). Lève `PersonalDataError` si une clé personnelle apparaît. */
export function parseReferencesJson(value: unknown, options: { defaultSource?: PriceReferenceSource } = {}): ParseResult {
  const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { references?: unknown }).references) ? (value as { references: unknown[] }).references : null;
  if (!list) throw new Error("JSON attendu : un tableau de références, ou un objet { references: [...] }");
  const forbidden = new Set<string>();
  for (const item of list) if (item && typeof item === "object") for (const k of Object.keys(item)) if (FORBIDDEN.has(norm(k))) forbidden.add(k);
  if (forbidden.size) throw new PersonalDataError([...forbidden]);
  const references: PriceReference[] = [];
  const errors: ParseError[] = [];
  const defaultSource = options.defaultSource ?? "provided_base";
  list.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push({ line: i + 1, message: "objet attendu" });
      return;
    }
    const obj = { ...(item as Record<string, unknown>) };
    if (obj.source === undefined) obj.source = defaultSource;
    if (obj.brand === undefined || obj.brand === null) obj.brand = "";
    const ref = validate(obj, i + 1, errors);
    if (ref) references.push(ref);
  });
  return { references, errors };
}
