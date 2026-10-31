import type { InventoryItem } from "@selio/contracts";

/** Ancienneté en ligne d'une annonce (module sans dépendance, partagé par le dressing et les republications). */
export const DEFAULT_REPUBLISH_AFTER_DAYS = 7;

/** Dernière mise en ligne : republication la plus récente, sinon date de mise en vente. */
export function lastOnlineAt(item: Pick<InventoryItem, "listedAt" | "republications">): string | null {
  const last = item.republications.reduce<string | null>((acc, r) => (acc === null || r.at > acc ? r.at : acc), null);
  if (last && (!item.listedAt || last > item.listedAt)) return last;
  return item.listedAt;
}

/** Jours depuis la dernière mise en ligne (null si l'article n'a jamais été en vente). */
export function daysOnline(item: Pick<InventoryItem, "listedAt" | "republications">, now: Date): number | null {
  const at = lastOnlineAt(item);
  if (!at) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000));
}
