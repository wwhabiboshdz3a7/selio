/**
 * Valeur d'un `<input type="date">` (AAAA-MM-JJ) → instant ISO à midi UTC.
 * `null` si le champ est vide ou si la date sort de la plage de `Date` : Chrome accepte des années
 * à 5 ou 6 chiffres (jusqu'à 275760), que `new Date(…)` refuse (`toISOString()` lèverait alors
 * « RangeError: Invalid time value »).
 */
export function dateInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
