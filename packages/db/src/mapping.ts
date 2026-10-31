/** Conversion lignes SQL (snake_case, Date, numeric) ↔ objets métier (camelCase, ISO, number). */

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

const NUMERIC_KEYS = new Set(["target_margin_rate"]);

export function rowToObject<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    let value: unknown = v;
    if (v instanceof Date) value = v.toISOString();
    else if (NUMERIC_KEYS.has(k) && typeof v === "string") value = Number(v);
    else if (typeof v === "bigint") value = Number(v);
    out[toCamel(k)] = value;
  }
  return out as T;
}

const COLUMN_RE = /^[a-z][a-z0-9_]*$/;

/** Sérialise une valeur pour pg : objets/tableaux → JSON (colonnes jsonb), le reste tel quel. */
export function toSqlValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

export function objectToColumns(obj: Record<string, unknown>, omit: string[] = []): { columns: string[]; values: unknown[] } {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || omit.includes(k)) continue;
    const col = toSnake(k);
    if (!COLUMN_RE.test(col)) throw new Error(`Nom de colonne invalide : ${col}`);
    columns.push(col);
    values.push(toSqlValue(v));
  }
  return { columns, values };
}
