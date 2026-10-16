import { inventoryItem, type InventoryItem } from "@selio/contracts";

/** Fixtures de tests (non exportées par le paquet). */
const now = new Date("2026-10-16T12:00:00Z");

export function makeItem(over: Partial<InventoryItem> = {}): InventoryItem {
  return inventoryItem.parse({
    id: "it-1", orgId: "org", title: "Sweat à capuche The North Face", description: "Sweat The North Face, très peu porté, coton épais. Taille M. Mesures : aisselles 55 cm, longueur 68 cm. Aucun défaut visible, envoi soigné.",
    brand: "The North Face", size: "M", category: "men", condition: "very_good",
    photos: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, url: "data:image/png;base64,AAAA", alt: "", position: i })),
    purchasePriceCents: 2500, purchaseFeesCents: 0, listedPriceCents: 6000, floorPriceCents: 4500, status: "listed",
    listingStats: { views: 150, favorites: 15, offers: 1, updatedAt: now.toISOString() },
    attributes: { colors: ["Noir"], material: "Coton" },
    listedAt: "2026-10-11T12:00:00Z", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-11T12:00:00Z",
    ...over,
  });
}
