import { ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_STATUSES, type InventoryItemCreate, type ItemCategory, type ItemCondition, type ItemStatus } from "@selio/contracts";
import { parseEuroInput, centsToDecimalString } from "./money";

/** Analyseur CSV RFC 4180 minimal (guillemets, retours à la ligne dans les champs, ; ou , ou tab). */
export function parseCsv(text: string, delimiter?: "," | ";" | "\t"): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

export function detectDelimiter(text: string): "," | ";" | "\t" {
  const head = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Array<["," | ";" | "\t", number]> = [
    [";", (head.match(/;/g) ?? []).length],
    [",", (head.match(/,/g) ?? []).length],
    ["\t", (head.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ";";
}

export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ";"): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise les injections de formule tableur (=, +, -, @).
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n\r,\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(delimiter)).join("\r\n") + "\r\n";
}

/** Colonnes acceptées à l'import (en-têtes insensibles à la casse et aux accents). */
export const IMPORT_COLUMNS = {
  title: ["titre", "title", "nom", "article"],
  sku: ["sku", "reference", "référence", "ref"],
  brand: ["marque", "brand"],
  size: ["taille", "size"],
  category: ["categorie", "catégorie", "category"],
  condition: ["etat", "état", "condition"],
  purchasePrice: ["prix achat", "prix d'achat", "purchase price", "achat", "cout"],
  purchaseFees: ["frais", "frais achat", "fees", "purchase fees"],
  listedPrice: ["prix vente", "prix affiche", "prix affiché", "listed price", "prix"],
  floorPrice: ["prix plancher", "plancher", "floor price", "floor"],
  status: ["statut", "status"],
  tags: ["tags", "etiquettes", "étiquettes"],
  description: ["description"],
  purchasedAt: ["date achat", "date d'achat", "purchased at"],
} as const;

export type ImportColumn = keyof typeof IMPORT_COLUMNS;

const CATEGORY_ALIASES: Record<string, ItemCategory> = {
  femme: "women", femmes: "women", women: "women",
  homme: "men", hommes: "men", men: "men",
  enfant: "kids", enfants: "kids", kids: "kids",
  chaussure: "shoes", chaussures: "shoes", shoes: "shoes",
  sac: "bags", sacs: "bags", bags: "bags",
  accessoire: "accessories", accessoires: "accessories", accessories: "accessories",
  maison: "home", home: "home",
  electronique: "electronics", électronique: "electronics", electronics: "electronics",
  autre: "other", other: "other",
};

const CONDITION_ALIASES: Record<string, ItemCondition> = {
  "neuf avec etiquette": "new_with_tags", "neuf avec étiquette": "new_with_tags", new_with_tags: "new_with_tags",
  "neuf sans etiquette": "new_without_tags", "neuf sans étiquette": "new_without_tags", new_without_tags: "new_without_tags", neuf: "new_without_tags",
  "tres bon etat": "very_good", "très bon état": "very_good", very_good: "very_good",
  "bon etat": "good", "bon état": "good", good: "good",
  satisfaisant: "satisfactory", satisfactory: "satisfactory",
};

const STATUS_ALIASES: Record<string, ItemStatus> = {
  "en stock": "in_stock", stock: "in_stock", in_stock: "in_stock",
  "en vente": "listed", listed: "listed",
  reserve: "reserved", réservé: "reserved", reserved: "reserved",
  vendu: "sold", sold: "sold",
  archive: "archived", archivé: "archived", archived: "archived",
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

export function mapHeaders(headers: string[]): Partial<Record<ImportColumn, number>> {
  const out: Partial<Record<ImportColumn, number>> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [col, aliases] of Object.entries(IMPORT_COLUMNS) as [ImportColumn, readonly string[]][]) {
      if (out[col] !== undefined) continue;
      if (aliases.some((a) => norm(a) === n)) out[col] = i;
    }
  });
  return out;
}

export interface ImportRowResult {
  line: number;
  item: InventoryItemCreate | null;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  columns: Partial<Record<ImportColumn, number>>;
  headers: string[];
  rows: ImportRowResult[];
  validCount: number;
  errorCount: number;
}

/** Prévisualisation d'import : chaque ligne est validée indépendamment, les erreurs sont listées. */
export function previewInventoryImport(text: string, opts: { maxRows?: number } = {}): ImportPreview {
  const parsed = parseCsv(text);
  const headers = (parsed[0] ?? []).map((h) => h.trim());
  const columns = mapHeaders(headers);
  const rows: ImportRowResult[] = [];
  if (columns.title === undefined) {
    return { columns, headers, rows: [{ line: 1, item: null, errors: ["Colonne « Titre » introuvable."], warnings: [] }], validCount: 0, errorCount: 1 };
  }
  const body = parsed.slice(1, 1 + (opts.maxRows ?? 2000));
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (c: ImportColumn) => (columns[c] === undefined ? "" : (cells[columns[c]!] ?? "").trim());
    const errors: string[] = [];
    const warnings: string[] = [];
    const title = get("title");
    if (!title) errors.push("Titre manquant.");
    if (title.length > 200) errors.push("Titre trop long (200 max).");
    const money = (c: ImportColumn, label: string, required = false): number | null => {
      const raw = get(c);
      if (raw === "") {
        if (required) errors.push(`${label} manquant.`);
        return null;
      }
      const v = parseEuroInput(raw);
      if (v === null) errors.push(`${label} illisible : « ${raw} ».`);
      else if (v < 0) errors.push(`${label} négatif.`);
      return v;
    };
    const purchasePriceCents = money("purchasePrice", "Prix d'achat");
    const purchaseFeesCents = money("purchaseFees", "Frais");
    const listedPriceCents = money("listedPrice", "Prix affiché");
    const floorPriceCents = money("floorPrice", "Prix plancher");
    const catRaw = get("category");
    const category = catRaw ? CATEGORY_ALIASES[norm(catRaw)] : undefined;
    if (catRaw && !category) warnings.push(`Catégorie inconnue « ${catRaw} » → « Autre ».`);
    const condRaw = get("condition");
    const condition = condRaw ? CONDITION_ALIASES[norm(condRaw)] : undefined;
    if (condRaw && !condition) warnings.push(`État inconnu « ${condRaw} » → « Bon état ».`);
    const statusRaw = get("status");
    const status = statusRaw ? STATUS_ALIASES[norm(statusRaw)] : undefined;
    if (statusRaw && !status) errors.push(`Statut inconnu « ${statusRaw} » (attendu : ${ITEM_STATUSES.join(", ")}).`);
    if (listedPriceCents !== null && floorPriceCents !== null && floorPriceCents > listedPriceCents)
      warnings.push("Prix plancher supérieur au prix affiché.");
    const purchasedAtRaw = get("purchasedAt");
    let purchasedAt: string | null = null;
    if (purchasedAtRaw) {
      const d = parseFrDate(purchasedAtRaw);
      if (!d) errors.push(`Date d'achat illisible : « ${purchasedAtRaw} ».`);
      else purchasedAt = d;
    }
    const tags = get("tags")
      .split(/[|,]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 30);
    const item: InventoryItemCreate | null =
      errors.length > 0
        ? null
        : {
            title,
            sku: get("sku") || null,
            brand: get("brand") || null,
            size: get("size") || null,
            category: category ?? (ITEM_CATEGORIES.includes(catRaw as ItemCategory) ? (catRaw as ItemCategory) : "other"),
            condition: condition ?? (ITEM_CONDITIONS.includes(condRaw as ItemCondition) ? (condRaw as ItemCondition) : "good"),
            purchasePriceCents: purchasePriceCents ?? 0,
            purchaseFeesCents: purchaseFeesCents ?? 0,
            listedPriceCents,
            floorPriceCents,
            status: status ?? "in_stock",
            description: get("description"),
            tags,
            purchasedAt,
            photos: [],
          };
    rows.push({ line, item, errors, warnings });
  });
  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return { columns, headers, rows, validCount: rows.length - errorCount, errorCount };
}

/** JJ/MM/AAAA ou AAAA-MM-JJ → ISO (UTC midi, pour éviter les décalages de fuseau). */
export function parseFrDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else {
    match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString();
}

export const EXPORT_HEADERS = ["Titre", "SKU", "Marque", "Taille", "Catégorie", "État", "Statut", "Prix d'achat", "Frais", "Prix affiché", "Prix plancher", "Tags", "Date d'achat", "Description"];

export function inventoryToCsvRow(item: {
  title: string; sku: string | null; brand: string | null; size: string | null; category: string; condition: string; status: string;
  purchasePriceCents: number; purchaseFeesCents: number; listedPriceCents: number | null; floorPriceCents: number | null; tags: string[]; purchasedAt: string | null; description: string;
}): (string | null)[] {
  return [
    item.title,
    item.sku,
    item.brand,
    item.size,
    item.category,
    item.condition,
    item.status,
    centsToDecimalString(item.purchasePriceCents),
    centsToDecimalString(item.purchaseFeesCents),
    item.listedPriceCents === null ? "" : centsToDecimalString(item.listedPriceCents),
    item.floorPriceCents === null ? "" : centsToDecimalString(item.floorPriceCents),
    item.tags.join("|"),
    item.purchasedAt ? item.purchasedAt.slice(0, 10) : "",
    item.description,
  ];
}
