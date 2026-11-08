/** Supervision (Admin › Supervision) : mise en forme côté interface. */

/** Durée de fonctionnement lisible : « 3 j 4 h », « 12 min ». */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
