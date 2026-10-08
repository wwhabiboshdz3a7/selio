import { orderCreate, orderQuery, orderTransition, orderUpdate, type Order, type OrderStatus, type Shipment } from "@selio/contracts";
import { repos } from "@selio/db";
import { getConnector } from "@selio/connectors";
import { OrderTransitionError, canChangeItemStatus, itemStatusForOrder, localDayKey, orderDedupeKey, orderMargin, transitionOrder } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import { updateItemTx } from "./items";

export function listOrders(ctx: OrgContext, raw: unknown) {
  const q = orderQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.orders.list(tx, q.data));
}

export function getOrder(ctx: OrgContext, id: string) {
  return withOrg(ctx, async (tx) => {
    const order = await repos.orders.byId(tx, id);
    return { order, item: await repos.items.byId(tx, order.itemId).catch(() => null), customer: await repos.customers.byId(tx, order.customerId).catch(() => null), shipment: await repos.shipments.forOrder(tx, id), marginCents: orderMargin(order).marginCents };
  });
}

export function createOrder(ctx: OrgContext, raw: unknown): Promise<{ order: Order; created: boolean }> {
  requireAction(ctx, "orders.write");
  const parsed = orderCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Commande invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  return withOrg(ctx, async (tx) => {
    const item = await repos.items.byId(tx, input.itemId);
    await repos.customers.byId(tx, input.customerId);
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const connection = item.connectionId ? await repos.connections.byId(tx, item.connectionId).catch(() => null) : null;
    const provider = connection?.provider ?? "demo";
    const dedupeKey = orderDedupeKey({ provider, externalRef: input.externalRef ?? null, itemId: item.id, customerId: input.customerId, day: localDayKey(ctx.services.now(), org.settings.timezone) });
    const existing = await repos.orders.byDedupe(tx, dedupeKey);
    if (existing) return { order: existing, created: false };
    if (item.status === "sold") throw new AppError("conflict", "Cet article est déjà vendu.", 409);
    const status = input.status ?? "pending";
    const now = nowIso(ctx);
    const order = await repos.orders.create(tx, {
      itemId: item.id, customerId: input.customerId, conversationId: input.conversationId ?? null, connectionId: item.connectionId, provider, externalRef: input.externalRef ?? null, dedupeKey, status,
      salePriceCents: input.salePriceCents, platformFeeCents: input.platformFeeCents ?? 0, shippingCostCents: input.shippingCostCents ?? org.settings.margin.defaultShippingCostCents, otherCostsCents: input.otherCostsCents ?? 0,
      purchasePriceCents: item.purchasePriceCents, purchaseFeesCents: item.purchaseFeesCents, statusHistory: [{ status, at: now, note: null }], simulated: provider === "demo",
    });
    const target = itemStatusForOrder(status);
    if (item.status !== target && canChangeItemStatus(item.status, target)) await updateItemTx(ctx, tx, item.id, { status: target });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "order.created", targetType: "order", targetId: order.id, meta: { status }, ip: ctx.ip });
    return { order, created: true };
  });
}

export function updateOrder(ctx: OrgContext, id: string, raw: unknown): Promise<Order> {
  requireAction(ctx, "orders.write");
  const parsed = orderUpdate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Modification invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const o = await repos.orders.update(tx, id, Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<Order>);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "order.updated", targetType: "order", targetId: id, meta: { fields: Object.keys(parsed.data) }, ip: ctx.ip });
    return o;
  });
}

export function transition(ctx: OrgContext, id: string, raw: unknown): Promise<Order> {
  requireAction(ctx, "orders.write");
  const parsed = orderTransition.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Transition invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const o = await repos.orders.byId(tx, id);
    let next: Order;
    try {
      next = transitionOrder(o, parsed.data.status as OrderStatus, nowIso(ctx), parsed.data.note ?? null);
    } catch (e) {
      if (e instanceof OrderTransitionError) throw new AppError("validation", e.message, 400);
      throw e;
    }
    const saved = await repos.orders.update(tx, id, { status: next.status, statusHistory: next.statusHistory });
    const item = await repos.items.byId(tx, o.itemId).catch(() => null);
    if (item) {
      const target = itemStatusForOrder(saved.status);
      if (item.status !== target && canChangeItemStatus(item.status, target)) await updateItemTx(ctx, tx, item.id, { status: target });
    }
    if (saved.status === "shipped" && !(await repos.shipments.forOrder(tx, id))) await repos.shipments.upsert(tx, id, { status: "in_transit" });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "order.transition", targetType: "order", targetId: id, meta: { status: saved.status }, ip: ctx.ip });
    return saved;
  });
}

export function updateShipment(ctx: OrgContext, orderId: string, raw: { carrier?: string | null; trackingNumber?: string | null; status?: Shipment["status"] }): Promise<Shipment> {
  requireAction(ctx, "orders.write");
  const patch: Partial<Shipment> = {};
  if (raw.carrier !== undefined) patch.carrier = raw.carrier ? String(raw.carrier).slice(0, 60) : null;
  if (raw.trackingNumber !== undefined) patch.trackingNumber = raw.trackingNumber ? String(raw.trackingNumber).slice(0, 80) : null;
  if (raw.status !== undefined) patch.status = raw.status;
  return withOrg(ctx, async (tx) => {
    await repos.orders.byId(tx, orderId);
    return repos.shipments.upsert(tx, orderId, patch);
  });
}

export function requestShippingDocument(ctx: OrgContext, orderId: string): Promise<Shipment> {
  requireAction(ctx, "orders.write");
  return withOrg(ctx, async (tx) => {
    const o = await repos.orders.byId(tx, orderId);
    const connection = o.connectionId ? await repos.connections.byId(tx, o.connectionId).catch(() => null) : null;
    const connector = getConnector(connection?.provider ?? "demo");
    if (!connector.shippingDocument) throw new AppError("connector_unavailable", "Ce connecteur ne fournit pas de document d'expédition.", 409);
    const res = await connector.shippingDocument({ orgId: ctx.orgId, connectionId: connection?.id ?? "", config: connection?.config ?? {}, now: ctx.services.now() }, { orderRef: o.externalRef ?? o.id });
    if (!res.ok) throw new AppError("connector_unavailable", res.message, 409);
    return repos.shipments.upsert(tx, orderId, { status: "label_ready", document: res.data });
  });
}
