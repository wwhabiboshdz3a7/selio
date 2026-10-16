import { repos } from "@selio/db";
import { applyVariant, buildDressing, comparablesFromSales, newId, recordRepublication, republicationPlan, type DressingFilters } from "@selio/domain";
import type { InventoryItem } from "@selio/contracts";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import { updateItemTx } from "./items";
import type { DressingData } from "../types-data";

const FILTERS = ["all", "due", "7", "14", "30", "weak"] as const;
const SORTS = ["online_desc", "score_asc", "score_desc", "views_desc", "favorites_desc"] as const;

function parseQuery(raw: Record<string, unknown>): DressingFilters {
  return {
    filter: FILTERS.includes(raw.filter as (typeof FILTERS)[number]) ? (raw.filter as DressingFilters["filter"]) : "all",
    sort: SORTS.includes(raw.sort as (typeof SORTS)[number]) ? (raw.sort as DressingFilters["sort"]) : "online_desc",
    q: typeof raw.q === "string" ? raw.q.slice(0, 120) : undefined,
    connectionId: typeof raw.connectionId === "string" && raw.connectionId ? raw.connectionId.slice(0, 64) : undefined,
  };
}

/** Dressing intelligent : annonces en ligne notées, rendement, variantes de republication. */
export function getDressing(ctx: OrgContext, raw: Record<string, unknown>): Promise<DressingData> {
  const query = parseQuery(raw);
  return withOrg(ctx, async (tx) => {
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const items = await repos.items.all(tx);
    const sales = comparablesFromSales(await repos.orders.all(tx), new Map(items.map((i) => [i.id, i])));
    return buildDressing(items, sales, { now: ctx.services.now(), rules: org.settings.margin, republishAfterDays: org.settings.dressing.republishAfterDays }, query);
  });
}

/**
 * Republication avec une variante pré-faite : l'article prend le titre, la
 * description, le prix et l'ordre de photos de la variante, et la
 * republication est historisée (variante marquée « déjà utilisée »).
 */
export function republishItem(ctx: OrgContext, id: string, variantId: unknown): Promise<InventoryItem> {
  requireAction(ctx, "items.write");
  if (typeof variantId !== "string" || !/^v\d{1,2}$/.test(variantId)) throw new AppError("validation", "Variante invalide", 400);
  return withOrg(ctx, async (tx) => {
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const item = await repos.items.byId(tx, id);
    if (item.status !== "listed" && item.status !== "reserved") throw new AppError("validation", "Seule une annonce en ligne peut être republiée.", 400);
    const plan = republicationPlan(item, { now: ctx.services.now(), republishAfterDays: org.settings.dressing.republishAfterDays });
    const variant = plan.variants.find((v) => v.id === variantId);
    if (!variant) throw new AppError("not_found", "Variante inconnue", 404);
    const after = await updateItemTx(ctx, tx, id, { ...applyVariant(item, variant), ...recordRepublication(item, variant.id, "manual", nowIso(ctx), newId()) });
    await repos.itemEvents.add(tx, { itemId: id, actorUserId: ctx.userId, kind: "updated", changes: {}, note: `Republication — variante ${variant.index} « ${variant.name} »` });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "item.republished", targetType: "inventory_item", targetId: id, meta: { variantId }, ip: ctx.ip });
    return after;
  });
}
