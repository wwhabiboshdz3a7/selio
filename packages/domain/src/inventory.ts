import type { InventoryItem, ItemStatus } from "@selio/contracts";

export const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  in_stock: ["listed", "archived", "sold"],
  listed: ["in_stock", "reserved", "sold", "archived"],
  reserved: ["listed", "sold", "in_stock"],
  sold: ["in_stock", "archived"],
  archived: ["in_stock"],
};

export function canChangeItemStatus(from: ItemStatus, to: ItemStatus): boolean {
  return from === to || ITEM_TRANSITIONS[from].includes(to);
}

export class ItemTransitionError extends Error {
  constructor(public readonly from: ItemStatus, public readonly to: ItemStatus) {
    super(`Changement de statut interdit : ${from} → ${to}`);
    this.name = "ItemTransitionError";
  }
}

/** Nombre de jours en stock (depuis l'achat, sinon la création) jusqu'à la vente ou maintenant. */
export function daysInStock(item: Pick<InventoryItem, "purchasedAt" | "createdAt" | "soldAt">, now: Date): number {
  const start = new Date(item.purchasedAt ?? item.createdAt).getTime();
  const end = item.soldAt ? new Date(item.soldAt).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** Calcule le diff champ à champ pour l'historique de modification. */
export function diffItem(before: Partial<InventoryItem>, after: Partial<InventoryItem>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === "updatedAt" || k === "photos") continue;
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return out;
}

export function normalizeBrand(brand: string | null | undefined): string | null {
  const b = (brand ?? "").trim().replace(/\s+/g, " ");
  return b === "" ? null : b;
}

/** Génère un SKU lisible et unique (préfixe catégorie + compteur). */
export function nextSku(category: string, existing: Iterable<string | null>): string {
  const prefix = category.slice(0, 3).toUpperCase();
  let max = 0;
  for (const s of existing) {
    if (!s || !s.startsWith(prefix + "-")) continue;
    const n = Number.parseInt(s.slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
