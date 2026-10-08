import { customerCreate, customerQuery, customerUpdate, type Customer } from "@selio/contracts";
import { repos } from "@selio/db";
import { orderMargin } from "@selio/domain";
import { AppError, requireAction, withOrg, type OrgContext } from "../context";
import type { CustomerTimeline } from "../types-data";

export function listCustomers(ctx: OrgContext, raw: unknown) {
  const q = customerQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.customers.list(tx, q.data));
}

export function getCustomerTimeline(ctx: OrgContext, id: string): Promise<CustomerTimeline> {
  return withOrg(ctx, async (tx) => {
    const customer = await repos.customers.byId(tx, id);
    const conversations = (await repos.conversations.list(tx, { customerId: id, pageSize: 100 })).items.map(({ customer: _c, item: _i, ...c }) => c);
    const ordersPage = await repos.orders.list(tx, { customerId: id, pageSize: 100 });
    const orders = ordersPage.items.map(({ customer: _c, ...o }) => o);
    const events: CustomerTimeline["events"] = [{ at: customer.createdAt, kind: "created", label: "Fiche créée" }];
    for (const c of conversations) for (const m of await repos.messages.forConversation(tx, c.id)) events.push({ at: m.createdAt, kind: "message", label: `${m.direction === "inbound" ? "Message reçu" : "Message envoyé"} : ${m.body.slice(0, 80)}`, to: `/app/messages/${c.id}` });
    for (const o of orders) events.push({ at: o.createdAt, kind: "order", label: `Commande ${o.item?.title ?? ""} — ${o.status}`, to: `/app/orders/${o.id}` });
    events.sort((a, b) => b.at.localeCompare(a.at));
    const valid = orders.filter((o) => o.status !== "cancelled" && o.status !== "refunded");
    return { customer, conversations, orders, events, totals: { orders: valid.length, revenueCents: valid.reduce((s, o) => s + o.salePriceCents, 0), marginCents: valid.reduce((s, o) => s + orderMargin(o).marginCents, 0) } };
  });
}

export function createCustomer(ctx: OrgContext, raw: unknown): Promise<Customer> {
  requireAction(ctx, "customers.write");
  const parsed = customerCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Client invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    if (parsed.data.handle) {
      const dup = await repos.customers.byHandle(tx, parsed.data.provider, parsed.data.handle);
      if (dup) throw new AppError("conflict", `Un client avec le pseudo « ${parsed.data.handle} » existe déjà.`, 409, { existingId: dup.id });
    }
    const c = await repos.customers.create(tx, parsed.data);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "customer.created", targetType: "customer", targetId: c.id, ip: ctx.ip });
    return c;
  });
}

export function updateCustomer(ctx: OrgContext, id: string, raw: unknown): Promise<Customer> {
  requireAction(ctx, "customers.write");
  const parsed = customerUpdate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Modification invalide", 400, parsed.error.flatten());
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<Customer>;
  return withOrg(ctx, async (tx) => {
    const c = await repos.customers.update(tx, id, patch);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "customer.updated", targetType: "customer", targetId: id, meta: { fields: Object.keys(patch) }, ip: ctx.ip });
    return c;
  });
}

export function mergeCustomers(ctx: OrgContext, keepId: string, mergeId: string): Promise<Customer> {
  requireAction(ctx, "customers.write");
  if (keepId === mergeId) throw new AppError("validation", "Choisissez deux fiches différentes.", 400);
  return withOrg(ctx, async (tx) => {
    const keep = await repos.customers.byId(tx, keepId);
    const merge = await repos.customers.byId(tx, mergeId);
    await repos.customers.reassign(tx, mergeId, keepId);
    const updated = await repos.customers.update(tx, keepId, { tags: [...new Set([...keep.tags, ...merge.tags])], notes: [keep.notes, merge.notes].filter(Boolean).join("\n"), lastContactAt: [keep.lastContactAt, merge.lastContactAt].filter(Boolean).sort().pop() ?? null });
    await repos.customers.delete(tx, mergeId);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "customer.merged", targetType: "customer", targetId: keepId, meta: { mergedId: mergeId }, ip: ctx.ip });
    return updated;
  });
}
