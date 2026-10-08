export type ClassValue = string | number | bigint | null | undefined | boolean | ClassValue[] | Record<string, boolean | null | undefined>;

/** Concatène des classes conditionnelles (équivalent minimal de clsx). */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (v === true) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") out.push(String(v));
    else if (Array.isArray(v)) {
      const inner = cn(...v);
      if (inner) out.push(inner);
    } else {
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
    }
  }
  return out.join(" ");
}
