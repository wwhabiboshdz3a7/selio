import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InventoryItem, Order } from "@selio/contracts";
import { isGenerated, listingInsights, type InsightSale, type ListingPerformance } from "@selio/domain";
import type { DataClient } from "../../lib/data/types";
import { useClient } from "../../lib/data/provider";

/**
 * Données de Selio Studio, lues avec les méthodes existantes (démonstration
 * comme mode connecté) : aucun calcul côté serveur, aucune donnée inventée.
 * Les clés commencent par « items », « orders » et « dressing » : toute
 * création d'article les rafraîchit.
 */
const PAGE_SIZE = 200;
/** Au-delà, les enseignements portent sur les articles les plus récents (affiché à l'écran). */
export const STUDIO_MAX_ITEMS = 2000;

async function allItems(client: DataClient): Promise<{ items: InventoryItem[]; total: number }> {
  const first = await client.listItems({ pageSize: PAGE_SIZE, page: 1, sort: "created_desc" });
  const items = [...first.items];
  const pages = Math.min(first.pageCount, Math.ceil(STUDIO_MAX_ITEMS / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) items.push(...(await client.listItems({ pageSize: PAGE_SIZE, page, sort: "created_desc" })).items);
  return { items, total: first.total };
}

async function allSales(client: DataClient): Promise<InsightSale[]> {
  const out: InsightSale[] = [];
  const keep = (o: Order & { item: InventoryItem | null }) => {
    if (o.status === "cancelled" || o.status === "refunded") return;
    out.push({ itemId: o.itemId, brand: o.item?.brand ?? null, category: o.item?.category ?? null, salePriceCents: o.salePriceCents });
  };
  const first = await client.listOrders({ pageSize: PAGE_SIZE, page: 1 });
  first.items.forEach(keep);
  const pages = Math.min(first.pageCount, Math.ceil(STUDIO_MAX_ITEMS / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) (await client.listOrders({ pageSize: PAGE_SIZE, page })).items.forEach(keep);
  return out;
}

export function useAllItems() {
  const client = useClient();
  return useQuery({ queryKey: ["items", "studio-all"], queryFn: () => allItems(client) });
}

export function useAllSales() {
  const client = useClient();
  return useQuery({ queryKey: ["orders", "studio-sales"], queryFn: () => allSales(client) });
}

/** Note du dressing (sur 100) des annonces en ligne, par article. */
export function useDressingScores() {
  const client = useClient();
  return useQuery({
    queryKey: ["dressing", "studio-scores"],
    queryFn: async () => new Map<string, ListingPerformance>((await client.getDressing({ filter: "all" })).listings.map((l) => [l.item.id, l.performance])),
  });
}

export interface GeneratedSummary {
  generated: InventoryItem[];
  online: number;
  sold: number;
  drafts: number;
  /** Note moyenne des annonces générées en ligne, et celle des autres annonces en ligne (null sans annonce). */
  averageScore: number | null;
  othersAverageScore: number | null;
}

export function summarizeGenerated(items: InventoryItem[], scores: Map<string, ListingPerformance> | undefined): GeneratedSummary {
  const generated = items.filter(isGenerated);
  const avg = (list: InventoryItem[]) => {
    const values = list.map((i) => scores?.get(i.id)?.score).filter((v): v is number => typeof v === "number");
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  };
  return {
    generated,
    online: generated.filter((i) => i.status === "listed" || i.status === "reserved").length,
    sold: generated.filter((i) => i.status === "sold").length,
    drafts: generated.filter((i) => i.status === "in_stock").length,
    averageScore: avg(generated),
    othersAverageScore: avg(items.filter((i) => !isGenerated(i))),
  };
}

/** Enseignements « Ce qui performe », recalculés quand les articles ou les ventes changent. */
export function useListingInsights() {
  const items = useAllItems();
  const sales = useAllSales();
  const insights = useMemo(() => (items.data && sales.data ? listingInsights(items.data.items, sales.data) : null), [items.data, sales.data]);
  return { items, sales, insights };
}
