/**
 * Toutes les sommes sont des centimes entiers. Aucun flottant ne circule
 * dans les règles métier ; les taux sont appliqués avec un arrondi
 * « demi vers l'infini » (round half away from zero) explicite.
 */

export type Cents = number;

export function assertCents(value: number, label = "montant"): Cents {
  if (!Number.isInteger(value)) throw new RangeError(`${label} doit être un entier de centimes (reçu ${value})`);
  return value;
}

/** Arrondi demi vers l'infini (0.5 → 1, -0.5 → -1), contrairement à Math.round sur les négatifs. */
export function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Applique un taux (0.2 = 20 %) à un montant en centimes. */
export function applyRate(cents: Cents, rate: number): Cents {
  assertCents(cents);
  if (!Number.isFinite(rate)) throw new RangeError("taux invalide");
  return roundHalfAway(cents * rate);
}

/** Retourne le ratio a/b (0 si b = 0). */
export function ratio(a: Cents, b: Cents): number {
  return b === 0 ? 0 : a / b;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return total;
}

/** « 12,50 » / « 12.5 » / « 1 286,00 € » → 128600. Retourne null si illisible. */
export function parseEuroInput(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? roundHalfAway(input * 100) : null;
  const cleaned = input
    .replace(/[€\s  ]/g, "")
    .replace(/,/g, ".")
    .trim();
  if (cleaned === "" || cleaned === "-") return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [intPart, decPart = ""] = cleaned.split(".");
  const negative = intPart!.startsWith("-");
  const whole = Math.abs(Number.parseInt(intPart!, 10));
  const dec = Number.parseInt((decPart + "00").slice(0, 2), 10);
  const cents = whole * 100 + dec;
  return negative ? -cents : cents;
}

/** 128600 → "1286.00" (export CSV, champs de formulaire). */
export function centsToDecimalString(cents: Cents, separator: "." | "," = ","): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}${separator}${dec}`;
}
