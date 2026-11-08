import { bulkItemAction, inventoryItemCreate, inventoryItemUpdate, inventoryQuery, namedMeasurementField, photoRole, type InventoryEvent, type InventoryItem, type NamedMeasurementField, type Page, type PhotoRole } from "@selio/contracts";
import { repos } from "@selio/db";
import { ITEM_TRANSITIONS, canChangeItemStatus, checkListing, diffItem, nextSku, toCsv, EXPORT_HEADERS, inventoryToCsvRow, type ListingCheck } from "@selio/domain";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import type { Tx } from "@selio/db";

export function listItems(ctx: OrgContext, raw: unknown): Promise<Page<InventoryItem>> {
  const q = inventoryQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.items.list(tx, q.data));
}

export const listBrands = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.items.brands(tx));
export const getItem = (ctx: OrgContext, id: string) => withOrg(ctx, (tx) => repos.items.byId(tx, id));
export const itemHistory = (ctx: OrgContext, id: string): Promise<InventoryEvent[]> => withOrg(ctx, (tx) => repos.itemEvents.forItem(tx, id));

export async function createItemTx(ctx: OrgContext, tx: Tx, raw: unknown, note = "Création"): Promise<InventoryItem> {
  const parsed = inventoryItemCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Article invalide", 400, parsed.error.flatten());
  const quotas = (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free;
  if ((await repos.items.countActive(tx)) >= quotas.items) throw new AppError("quota_exceeded", `Quota d'articles atteint (${quotas.items}).`, 402);
  const sku = parsed.data.sku || nextSku(parsed.data.category, await repos.items.skus(tx));
  const now = nowIso(ctx);
  const item = await repos.items.create(tx, { ...parsed.data, sku, listedAt: parsed.data.status === "listed" ? now : null });
  await repos.itemEvents.add(tx, { itemId: item.id, actorUserId: ctx.userId, kind: note === "Import CSV" ? "imported" : note === "Capture via l'extension" ? "captured" : "created", changes: {}, note });
  await repos.audit.add(tx, { actorUserId: ctx.userId, action: "item.created", targetType: "inventory_item", targetId: item.id, ip: ctx.ip });
  return item;
}

export function createItem(ctx: OrgContext, raw: unknown): Promise<InventoryItem> {
  requireAction(ctx, "items.write");
  return withOrg(ctx, (tx) => createItemTx(ctx, tx, raw));
}

export async function updateItemTx(ctx: OrgContext, tx: Tx, id: string, raw: unknown): Promise<InventoryItem> {
  const parsed = inventoryItemUpdate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Modification invalide", 400, parsed.error.flatten());
  const before = await repos.items.byId(tx, id);
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<InventoryItem>;
  if (patch.status && patch.status !== before.status && !canChangeItemStatus(before.status, patch.status)) throw new AppError("validation", `Transition de statut interdite : ${before.status} → ${patch.status}`, 400);
  const now = nowIso(ctx);
  if (patch.status === "listed" && !before.listedAt) patch.listedAt = now;
  if (patch.status === "archived") patch.archivedAt = now;
  if (patch.status && patch.status !== "archived") patch.archivedAt = null;
  if (patch.status === "sold" && !before.soldAt) patch.soldAt = now;
  if (patch.status && patch.status !== "sold" && before.status === "sold") patch.soldAt = null;
  const after = await repos.items.update(tx, id, patch);
  const changes = diffItem(before, after);
  if (Object.keys(changes).length > 0) {
    await repos.itemEvents.add(tx, { itemId: id, actorUserId: ctx.userId, kind: changes.status ? "status_changed" : changes.listedPriceCents || changes.floorPriceCents ? "price_changed" : "updated", changes, note: null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "item.updated", targetType: "inventory_item", targetId: id, meta: { fields: Object.keys(changes) }, ip: ctx.ip });
  }
  return after;
}

export function updateItem(ctx: OrgContext, id: string, raw: unknown): Promise<InventoryItem> {
  requireAction(ctx, "items.write");
  return withOrg(ctx, (tx) => updateItemTx(ctx, tx, id, raw));
}

export function setItemStatus(ctx: OrgContext, id: string, status: InventoryItem["status"]): Promise<InventoryItem> {
  requireAction(ctx, "items.write");
  if (!Object.keys(ITEM_TRANSITIONS).includes(status)) throw new AppError("validation", "Statut inconnu", 400);
  return withOrg(ctx, (tx) => updateItemTx(ctx, tx, id, { status }));
}

export function deleteItem(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "items.delete");
  return withOrg(ctx, async (tx) => {
    const it = await repos.items.byId(tx, id);
    if ((await repos.orders.forItem(tx, id)).length > 0) throw new AppError("conflict", "Cet article est lié à une commande : archivez-le plutôt.", 409);
    await repos.items.delete(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "item.deleted", targetType: "inventory_item", targetId: id, meta: { title: it.title }, ip: ctx.ip });
  });
}

export function bulkItems(ctx: OrgContext, raw: unknown): Promise<{ affected: number }> {
  requireAction(ctx, raw && typeof raw === "object" && (raw as { action?: string }).action === "delete" ? "items.delete" : "items.write");
  const parsed = bulkItemAction.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Action en lot invalide", 400, parsed.error.flatten());
  const action = parsed.data;
  return withOrg(ctx, async (tx) => {
    let affected = 0;
    for (const id of action.ids) {
      try {
        const it = await repos.items.byId(tx, id);
        switch (action.action) {
          case "archive": if (it.status !== "archived") { await updateItemTx(ctx, tx, id, { status: "archived" }); affected++; } break;
          case "restore": if (it.status === "archived") { await updateItemTx(ctx, tx, id, { status: "in_stock" }); affected++; } break;
          case "set_status": if (action.status && action.status !== it.status) { await updateItemTx(ctx, tx, id, { status: action.status }); affected++; } break;
          case "set_floor_margin": if (action.floorMarginCents !== undefined) { await updateItemTx(ctx, tx, id, { floorPriceCents: it.purchasePriceCents + it.purchaseFeesCents + action.floorMarginCents }); affected++; } break;
          case "add_tag": if (action.tag && !it.tags.includes(action.tag)) { await updateItemTx(ctx, tx, id, { tags: [...it.tags, action.tag] }); affected++; } break;
          case "delete": if ((await repos.orders.forItem(tx, id)).length === 0) { await repos.items.delete(tx, id); affected++; } break;
        }
      } catch (e) {
        if (e instanceof AppError) continue;
        throw e;
      }
    }
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "item.bulk", targetType: "inventory_item", meta: { action: action.action, affected }, ip: ctx.ip });
    return { affected };
  });
}

export function importItems(ctx: OrgContext, raw: unknown): Promise<{ created: number }> {
  requireAction(ctx, "items.write");
  const list = (raw as { items?: unknown[] })?.items;
  if (!Array.isArray(list) || list.length > 2000) throw new AppError("validation", "Import invalide (2 000 lignes max).", 400);
  return withOrg(ctx, async (tx) => {
    let created = 0;
    for (const input of list) { await createItemTx(ctx, tx, input, "Import CSV"); created++; }
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "item.imported", targetType: "inventory_item", meta: { created }, ip: ctx.ip });
    return { created };
  });
}

export function exportItemsCsv(ctx: OrgContext): Promise<string> {
  requireAction(ctx, "analytics.export");
  return withOrg(ctx, async (tx) => {
    const all = await repos.items.all(tx);
    await repos.usage.record(tx, "export.csv", { kind: "items" });
    return toCsv([EXPORT_HEADERS, ...all.map((i) => inventoryToCsvRow(i))]);
  });
}

// ---------------------------------------------------------------- contrôle des photos et des mesures (§5.14)

/** Scores de netteté calculés par le navigateur (variance du laplacien sur une image réduite), un par photo. */
function parsePhotoScores(raw: unknown): (number | null)[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null));
}

/**
 * Avertissements NON BLOQUANTS d'une annonce : aucune photo ou trop peu, photo floue (scores fournis par
 * le navigateur), pas de photo d'étiquette, mesures manquantes pour la famille de la pièce. Les mesures de
 * Studio comptent seulement avec leur provenance (jamais une mesure inventée).
 */
export async function listingCheckTx(tx: Tx, item: InventoryItem, photoScores: unknown = []): Promise<ListingCheck> {
  const prep = await tx.maybeOne<{ photos: unknown; measurements: unknown }>("select photos, measurements from studio_preps where org_id = $1 and item_id = $2 order by updated_at desc limit 1", [tx.orgId, item.id]);
  const measurements: NamedMeasurementField[] = Array.isArray(prep?.measurements) ? prep.measurements.flatMap((m) => { const p = namedMeasurementField.safeParse(m); return p.success ? [p.data] : []; }) : [];
  const prepPhotos = Array.isArray(prep?.photos) ? (prep.photos as { role?: unknown }[]) : [];
  const roles: PhotoRole[] | null = prepPhotos.length > 0 && prepPhotos.length === item.photos.length ? prepPhotos.map((p) => { const r = photoRole.safeParse(p.role); return r.success ? r.data : "other"; }) : null;
  return checkListing({ category: item.category, title: item.title, description: item.description, measurements, photos: item.photos.map((p) => ({ alt: p.alt })), photoRoles: roles }, parsePhotoScores(photoScores));
}

export function checkItem(ctx: OrgContext, id: string, photoScores: unknown = []): Promise<ListingCheck> {
  requireAction(ctx, "items.read");
  return withOrg(ctx, async (tx) => listingCheckTx(tx, await repos.items.byId(tx, id), photoScores));
}

/** Création avec contrôle : l'article est enregistré quoi qu'il arrive, les avertissements l'accompagnent. */
export function createItemChecked(ctx: OrgContext, raw: unknown): Promise<InventoryItem & { listingCheck: ListingCheck }> {
  requireAction(ctx, "items.write");
  return withOrg(ctx, async (tx) => {
    const item = await createItemTx(ctx, tx, raw);
    return { ...item, listingCheck: await listingCheckTx(tx, item, (raw as { photoScores?: unknown } | null)?.photoScores) };
  });
}

/** Modification avec contrôle (avertissements non bloquants). */
export function updateItemChecked(ctx: OrgContext, id: string, raw: unknown): Promise<InventoryItem & { listingCheck: ListingCheck }> {
  requireAction(ctx, "items.write");
  return withOrg(ctx, async (tx) => {
    const item = await updateItemTx(ctx, tx, id, raw);
    return { ...item, listingCheck: await listingCheckTx(tx, item, (raw as { photoScores?: unknown } | null)?.photoScores) };
  });
}
