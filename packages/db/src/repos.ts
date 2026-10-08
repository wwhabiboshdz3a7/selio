import {
  PLAN_QUOTAS, aiRequest, auditLog, automationRule, conversation as conversationSchema, customer as customerSchema, extensionToken, inventoryEvent, inventoryItem, job as jobSchema, marketplaceConnection, membership as membershipSchema, message as messageSchema, opportunity as opportunitySchema, order as orderSchema, organization as organizationSchema, purchaseRequest as purchaseSchema, radarSearch as radarSchema, shipment as shipmentSchema, subscription as subscriptionSchema, usageEvent, user as userSchema,
  type AiRequest, type AuditLog, type AutomationRule, type Conversation, type ConversationQuery, type Customer, type CustomerQuery, type ExtensionToken, type InventoryEvent, type InventoryItem, type InventoryQuery, type Job, type JobQuery, type MarketplaceConnection, type Membership, type Message, type Opportunity, type Order, type OrderQuery, type Organization, type Page, type PurchaseRequest, type RadarSearch, type Shipment, type Subscription, type UsageEvent, type User,
} from "@selio/contracts";
import type { ZodType, ZodTypeDef } from "zod";
import { DbError, type Tx } from "./pool";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema<T> = ZodType<T, ZodTypeDef, any>;

function parse<T>(schema: AnySchema<T>, row: unknown): T {
  const r = schema.safeParse(row);
  if (!r.success) throw new DbError("internal", `Ligne invalide : ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}

function page<T>(items: T[], total: number, p: number, pageSize: number): Page<T> {
  return { items, total, page: p, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

function like(q: string): string {
  return `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
}

// ---------------------------------------------------------------- global
export const users = {
  async byEmail(tx: Tx, email: string) {
    return tx.maybeOne<{ id: string; email: string; displayName: string; passwordHash: string; passwordSalt: string; isOperator: boolean; createdAt: string }>("select * from users where email = $1", [email.toLowerCase()]);
  },
  async byId(tx: Tx, id: string): Promise<User> {
    return parse(userSchema, await tx.one("select id, email, display_name, is_operator, created_at from users where id = $1", [id], "Utilisateur"));
  },
  async create(tx: Tx, input: { email: string; displayName: string; passwordHash: string; passwordSalt: string; isOperator?: boolean }): Promise<User> {
    return parse(userSchema, await tx.insert("users", { ...input, email: input.email.toLowerCase(), isOperator: input.isOperator ?? false }));
  },
  async setPassword(tx: Tx, id: string, passwordHash: string, passwordSalt: string): Promise<void> {
    await tx.update("users", id, { passwordHash, passwordSalt });
  },
  async countOperators(tx: Tx): Promise<number> {
    return tx.count("select count(*) from users where is_operator");
  },
};

export const orgs = {
  async byId(tx: Tx, id: string): Promise<Organization> {
    return parse(organizationSchema, await tx.one("select * from organizations where id = $1", [id], "Organisation"));
  },
  async create(tx: Tx, input: { name: string; slug: string; settings: Record<string, unknown> }): Promise<Organization> {
    return parse(organizationSchema, await tx.insert("organizations", input));
  },
  async update(tx: Tx, id: string, patch: { name?: string; settings?: Record<string, unknown> }): Promise<Organization> {
    return parse(organizationSchema, await tx.update("organizations", id, patch, "Organisation"));
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from organizations where id = $1", [id]);
  },
  async slugExists(tx: Tx, slug: string): Promise<boolean> {
    return (await tx.count("select count(*) from organizations where slug = $1", [slug])) > 0;
  },
};

export const memberships = {
  async forUser(tx: Tx, userId: string): Promise<(Membership & { orgName: string })[]> {
    const rows = await tx.query<Membership & { orgName: string }>("select m.*, o.name as org_name from memberships m join organizations o on o.id = m.org_id where m.user_id = $1 order by m.created_at", [userId]);
    return rows.map((r) => ({ ...parse(membershipSchema, r), orgName: r.orgName }));
  },
  async get(tx: Tx, orgId: string, userId: string): Promise<Membership | null> {
    const r = await tx.maybeOne("select * from memberships where org_id = $1 and user_id = $2", [orgId, userId]);
    return r ? parse(membershipSchema, r) : null;
  },
  async listOrg(tx: Tx, orgId: string): Promise<(Membership & { user: User })[]> {
    const rows = await tx.query<Record<string, unknown>>("select m.*, u.email as u_email, u.display_name as u_display_name, u.is_operator as u_is_operator, u.created_at as u_created_at from memberships m join users u on u.id = m.user_id where m.org_id = $1 order by m.created_at", [orgId]);
    return rows.map((r) => ({ ...parse(membershipSchema, r), user: parse(userSchema, { id: r.userId, email: r.uEmail, displayName: r.uDisplayName, isOperator: r.uIsOperator, createdAt: r.uCreatedAt }) }));
  },
  async create(tx: Tx, input: { orgId: string; userId: string; role: Membership["role"] }): Promise<Membership> {
    return parse(membershipSchema, await tx.insert("memberships", input));
  },
  async byId(tx: Tx, id: string): Promise<Membership> {
    return parse(membershipSchema, await tx.one("select * from memberships where id = $1", [id], "Membre"));
  },
  async setRole(tx: Tx, id: string, role: Membership["role"]): Promise<void> {
    await tx.query("update memberships set role = $2 where id = $1", [id, role]);
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from memberships where id = $1", [id]);
  },
  async countOrg(tx: Tx, orgId: string): Promise<number> {
    return tx.count("select count(*) from memberships where org_id = $1", [orgId]);
  },
};

export const sessions = {
  async create(tx: Tx, input: { id: string; userId: string; orgId: string | null; expiresAt: string; ip: string | null; userAgent: string | null }): Promise<void> {
    await tx.insert("sessions", input);
  },
  async get(tx: Tx, id: string) {
    return tx.maybeOne<{ id: string; userId: string; orgId: string | null; expiresAt: string; lastSeenAt: string }>("select * from sessions where id = $1", [id]);
  },
  async touch(tx: Tx, id: string, expiresAt: string, orgId?: string | null): Promise<void> {
    if (orgId !== undefined) await tx.query("update sessions set last_seen_at = now(), expires_at = $2, org_id = $3 where id = $1", [id, expiresAt, orgId]);
    else await tx.query("update sessions set last_seen_at = now(), expires_at = $2 where id = $1", [id, expiresAt]);
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from sessions where id = $1", [id]);
  },
  async deleteForUser(tx: Tx, userId: string): Promise<void> {
    await tx.query("delete from sessions where user_id = $1", [userId]);
  },
  async purgeExpired(tx: Tx): Promise<number> {
    const rows = await tx.query("delete from sessions where expires_at < now() returning id");
    return rows.length;
  },
};

export const paymentEvents = {
  /** Retourne false si l'événement a déjà été reçu (idempotence). */
  async record(tx: Tx, input: { id: string; provider: string; type: string; payload: unknown }): Promise<boolean> {
    const rows = await tx.query("insert into payment_events (id, provider, type, payload) values ($1, $2, $3, $4) on conflict (id) do nothing returning id", [input.id, input.provider, input.type, JSON.stringify(input.payload)]);
    return rows.length > 0;
  },
  async markProcessed(tx: Tx, id: string): Promise<void> {
    await tx.query("update payment_events set processed_at = now() where id = $1", [id]);
  },
};

export const rateLimits = {
  /** Compteur fenêtre fixe ; retourne le nombre d'occurrences dans la fenêtre. */
  async hit(tx: Tx, key: string, windowMs: number): Promise<number> {
    const rows = await tx.query<{ count: number }>(
      `insert into rate_limits (key, count, window_start) values ($1, 1, now())
       on conflict (key) do update set
         count = case when rate_limits.window_start < now() - ($2 || ' milliseconds')::interval then 1 else rate_limits.count + 1 end,
         window_start = case when rate_limits.window_start < now() - ($2 || ' milliseconds')::interval then now() else rate_limits.window_start end
       returning count`,
      [key, String(windowMs)],
    );
    return Number(rows[0]?.count ?? 0);
  },
};

// ---------------------------------------------------------------- par organisation
export const items = {
  async list(tx: Tx, q: Partial<InventoryQuery>): Promise<Page<InventoryItem>> {
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [tx.orgId];
    if (q.status) { params.push(q.status); where.push(`status = $${params.length}`); } else where.push("status <> 'archived'");
    if (q.category) { params.push(q.category); where.push(`category = $${params.length}`); }
    if (q.brand) { params.push(q.brand); where.push(`lower(brand) = lower($${params.length})`); }
    if (q.q) { params.push(like(q.q)); where.push(`(title ilike $${params.length} or coalesce(brand,'') ilike $${params.length} or coalesce(sku,'') ilike $${params.length} or tags::text ilike $${params.length})`); }
    const order = { updated_desc: "updated_at desc", created_desc: "created_at desc", title_asc: "title asc", price_asc: "listed_price_cents asc nulls first", price_desc: "listed_price_cents desc nulls last", margin_desc: "(coalesce(listed_price_cents, 0) - purchase_price_cents - purchase_fees_cents) desc" }[q.sort ?? "updated_desc"];
    const pageSize = q.pageSize ?? 25;
    const p = q.page ?? 1;
    const total = await tx.count(`select count(*) from inventory_items where ${where.join(" and ")}`, params);
    const rows = await tx.query(`select * from inventory_items where ${where.join(" and ")} order by ${order}, id limit ${pageSize} offset ${(p - 1) * pageSize}`, params);
    return page(rows.map((r) => parse(inventoryItem, r)), total, p, pageSize);
  },
  async all(tx: Tx): Promise<InventoryItem[]> {
    return (await tx.query("select * from inventory_items where org_id = $1", [tx.orgId])).map((r) => parse(inventoryItem, r));
  },
  async brands(tx: Tx): Promise<string[]> {
    return (await tx.query<{ brand: string }>("select distinct brand from inventory_items where org_id = $1 and brand is not null order by brand", [tx.orgId])).map((r) => r.brand);
  },
  async byId(tx: Tx, id: string): Promise<InventoryItem> {
    return parse(inventoryItem, await tx.one("select * from inventory_items where org_id = $1 and id = $2", [tx.orgId, id], "Article"));
  },
  async byIds(tx: Tx, ids: string[]): Promise<Map<string, InventoryItem>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.query("select * from inventory_items where org_id = $1 and id = any($2)", [tx.orgId, ids]);
    return new Map(rows.map((r) => { const it = parse(inventoryItem, r); return [it.id, it]; }));
  },
  async countActive(tx: Tx): Promise<number> {
    return tx.count("select count(*) from inventory_items where org_id = $1 and status <> 'archived'", [tx.orgId]);
  },
  async skus(tx: Tx): Promise<string[]> {
    return (await tx.query<{ sku: string }>("select sku from inventory_items where org_id = $1 and sku is not null", [tx.orgId])).map((r) => r.sku);
  },
  async create(tx: Tx, input: Partial<InventoryItem>): Promise<InventoryItem> {
    return parse(inventoryItem, await tx.insert("inventory_items", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<InventoryItem>): Promise<InventoryItem> {
    return parse(inventoryItem, await tx.update("inventory_items", id, patch, "Article"));
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from inventory_items where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  async stale(tx: Tx, statuses: string[], days: number, limit = 5): Promise<InventoryItem[]> {
    return (await tx.query("select * from inventory_items where org_id = $1 and status = any($2) and coalesce(purchased_at, created_at) < now() - ($3 || ' days')::interval order by coalesce(purchased_at, created_at) limit $4", [tx.orgId, statuses, String(days), limit])).map((r) => parse(inventoryItem, r));
  },
};

export const itemEvents = {
  async add(tx: Tx, e: Omit<InventoryEvent, "id" | "orgId" | "createdAt">): Promise<void> {
    await tx.insert("inventory_events", { ...e, orgId: tx.orgId });
  },
  async forItem(tx: Tx, itemId: string): Promise<InventoryEvent[]> {
    return (await tx.query("select * from inventory_events where org_id = $1 and item_id = $2 order by created_at desc limit 200", [tx.orgId, itemId])).map((r) => parse(inventoryEvent, r));
  },
};

export const customers = {
  async list(tx: Tx, q: Partial<CustomerQuery>): Promise<Page<Customer & { orderCount: number; revenueCents: number }>> {
    const where = ["c.org_id = $1"];
    const params: unknown[] = [tx.orgId];
    if (q.q) { params.push(like(q.q)); where.push(`(c.display_name ilike $${params.length} or coalesce(c.handle,'') ilike $${params.length} or coalesce(c.city,'') ilike $${params.length})`); }
    if (q.tag) { params.push(JSON.stringify([q.tag])); where.push(`c.tags @> $${params.length}::jsonb`); }
    const order = { last_contact_desc: "c.last_contact_at desc nulls last", name_asc: "c.display_name asc", orders_desc: "order_count desc" }[q.sort ?? "last_contact_desc"];
    const pageSize = q.pageSize ?? 25;
    const p = q.page ?? 1;
    const base = `from customers c left join lateral (select count(*) as order_count, coalesce(sum(sale_price_cents),0) as revenue_cents from orders o where o.customer_id = c.id and o.status not in ('cancelled','refunded')) s on true where ${where.join(" and ")}`;
    const total = await tx.count(`select count(*) ${base}`, params);
    const rows = await tx.query<Record<string, unknown>>(`select c.*, s.order_count, s.revenue_cents ${base} order by ${order}, c.id limit ${pageSize} offset ${(p - 1) * pageSize}`, params);
    return page(rows.map((r) => ({ ...parse(customerSchema, r), orderCount: Number(r.orderCount), revenueCents: Number(r.revenueCents) })), total, p, pageSize);
  },
  async byId(tx: Tx, id: string): Promise<Customer> {
    return parse(customerSchema, await tx.one("select * from customers where org_id = $1 and id = $2", [tx.orgId, id], "Client"));
  },
  async byHandle(tx: Tx, provider: string, handle: string): Promise<Customer | null> {
    const r = await tx.maybeOne("select * from customers where org_id = $1 and provider = $2 and lower(handle) = lower($3)", [tx.orgId, provider, handle]);
    return r ? parse(customerSchema, r) : null;
  },
  async byIds(tx: Tx, ids: string[]): Promise<Map<string, Customer>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.query("select * from customers where org_id = $1 and id = any($2)", [tx.orgId, ids]);
    return new Map(rows.map((r) => { const c = parse(customerSchema, r); return [c.id, c]; }));
  },
  async create(tx: Tx, input: Partial<Customer>): Promise<Customer> {
    return parse(customerSchema, await tx.insert("customers", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Customer>): Promise<Customer> {
    return parse(customerSchema, await tx.update("customers", id, patch, "Client"));
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from customers where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  async reassign(tx: Tx, fromId: string, toId: string): Promise<void> {
    await tx.query("update conversations set customer_id = $2 where org_id = $3 and customer_id = $1", [fromId, toId, tx.orgId]);
    await tx.query("update orders set customer_id = $2 where org_id = $3 and customer_id = $1", [fromId, toId, tx.orgId]);
  },
};

export const conversations = {
  async list(tx: Tx, q: Partial<ConversationQuery>): Promise<Page<Conversation & { customer: Customer; item: InventoryItem | null }>> {
    const where = ["c.org_id = $1", "c.status = $2"];
    const params: unknown[] = [tx.orgId, q.status ?? "open"];
    if (q.unread) where.push("c.unread_count > 0");
    if (q.itemId) { params.push(q.itemId); where.push(`c.item_id = $${params.length}`); }
    if (q.customerId) { params.push(q.customerId); where.push(`c.customer_id = $${params.length}`); }
    if (q.q) { params.push(like(q.q)); where.push(`(cu.display_name ilike $${params.length} or coalesce(i.title,'') ilike $${params.length} or c.last_message_preview ilike $${params.length})`); }
    const pageSize = q.pageSize ?? 50;
    const p = q.page ?? 1;
    const base = `from conversations c join customers cu on cu.id = c.customer_id left join inventory_items i on i.id = c.item_id where ${where.join(" and ")}`;
    const total = await tx.count(`select count(*) ${base}`, params);
    const rows = await tx.query<Record<string, unknown>>(`select c.*, row_to_json(cu) as customer_json, row_to_json(i) as item_json ${base} order by c.last_message_at desc nulls last, c.id limit ${pageSize} offset ${(p - 1) * pageSize}`, params);
    const { rowToObject } = await import("./mapping");
    return page(rows.map((r) => ({ ...parse(conversationSchema, r), customer: parse(customerSchema, rowToObject(r.customerJson as Record<string, unknown>)), item: r.itemJson ? parse(inventoryItem, rowToObject(r.itemJson as Record<string, unknown>)) : null })), total, p, pageSize);
  },
  async open(tx: Tx): Promise<Conversation[]> {
    return (await tx.query("select * from conversations where org_id = $1 and status = 'open'", [tx.orgId])).map((r) => parse(conversationSchema, r));
  },
  async byId(tx: Tx, id: string): Promise<Conversation> {
    return parse(conversationSchema, await tx.one("select * from conversations where org_id = $1 and id = $2", [tx.orgId, id], "Conversation"));
  },
  async byExternalRef(tx: Tx, provider: string, ref: string): Promise<Conversation | null> {
    const r = await tx.maybeOne("select * from conversations where org_id = $1 and provider = $2 and external_ref = $3", [tx.orgId, provider, ref]);
    return r ? parse(conversationSchema, r) : null;
  },
  async recent(tx: Tx, limit = 5): Promise<Conversation[]> {
    return (await tx.query("select * from conversations where org_id = $1 and status = 'open' order by last_message_at desc nulls last limit $2", [tx.orgId, limit])).map((r) => parse(conversationSchema, r));
  },
  async counts(tx: Tx): Promise<{ open: number; unread: number }> {
    const r = await tx.one<{ open: number; unread: number }>("select count(*) as open, coalesce(sum(unread_count),0) as unread from conversations where org_id = $1 and status = 'open'", [tx.orgId]);
    return { open: Number(r.open), unread: Number(r.unread) };
  },
  async create(tx: Tx, input: Partial<Conversation>): Promise<Conversation> {
    return parse(conversationSchema, await tx.insert("conversations", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Conversation>): Promise<Conversation> {
    return parse(conversationSchema, await tx.update("conversations", id, patch, "Conversation"));
  },
};

export const messages = {
  async forConversation(tx: Tx, conversationId: string): Promise<Message[]> {
    return (await tx.query("select * from messages where org_id = $1 and conversation_id = $2 order by created_at, id", [tx.orgId, conversationId])).map((r) => parse(messageSchema, r));
  },
  async byId(tx: Tx, id: string): Promise<Message> {
    return parse(messageSchema, await tx.one("select * from messages where org_id = $1 and id = $2", [tx.orgId, id], "Message"));
  },
  async create(tx: Tx, input: Partial<Message>): Promise<Message> {
    return parse(messageSchema, await tx.insert("messages", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Message>): Promise<Message> {
    const { columns, values } = (await import("./mapping")).objectToColumns(patch);
    if (columns.length === 0) return messages.byId(tx, id);
    const sets = columns.map((c, i) => `${c} = $${i + 3}`);
    return parse(messageSchema, await tx.one(`update messages set ${sets.join(", ")} where org_id = $1 and id = $2 returning *`, [tx.orgId, id, ...values], "Message"));
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from messages where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  async markRead(tx: Tx, conversationId: string): Promise<void> {
    await tx.query("update messages set read_at = now() where org_id = $1 and conversation_id = $2 and direction = 'inbound' and read_at is null", [tx.orgId, conversationId]);
  },
  async purgeOlderThan(tx: Tx, days: number): Promise<number> {
    return (await tx.query("delete from messages where org_id = $1 and created_at < now() - ($2 || ' days')::interval returning id", [tx.orgId, String(days)])).length;
  },
};

export const orders = {
  async list(tx: Tx, q: Partial<OrderQuery>): Promise<Page<Order & { item: InventoryItem | null; customer: Customer | null }>> {
    const where = ["o.org_id = $1"];
    const params: unknown[] = [tx.orgId];
    if (q.status) { params.push(q.status); where.push(`o.status = $${params.length}`); }
    if (q.customerId) { params.push(q.customerId); where.push(`o.customer_id = $${params.length}`); }
    if (q.itemId) { params.push(q.itemId); where.push(`o.item_id = $${params.length}`); }
    if (q.q) { params.push(like(q.q)); where.push(`(coalesce(i.title,'') ilike $${params.length} or coalesce(cu.display_name,'') ilike $${params.length} or coalesce(o.external_ref,'') ilike $${params.length})`); }
    const pageSize = q.pageSize ?? 25;
    const p = q.page ?? 1;
    const base = `from orders o left join inventory_items i on i.id = o.item_id left join customers cu on cu.id = o.customer_id where ${where.join(" and ")}`;
    const total = await tx.count(`select count(*) ${base}`, params);
    const rows = await tx.query<Record<string, unknown>>(`select o.*, row_to_json(i) as item_json, row_to_json(cu) as customer_json ${base} order by o.created_at desc, o.id limit ${pageSize} offset ${(p - 1) * pageSize}`, params);
    const { rowToObject } = await import("./mapping");
    return page(rows.map((r) => ({ ...parse(orderSchema, r), item: r.itemJson ? parse(inventoryItem, rowToObject(r.itemJson as Record<string, unknown>)) : null, customer: r.customerJson ? parse(customerSchema, rowToObject(r.customerJson as Record<string, unknown>)) : null })), total, p, pageSize);
  },
  async all(tx: Tx): Promise<Order[]> {
    return (await tx.query("select * from orders where org_id = $1", [tx.orgId])).map((r) => parse(orderSchema, r));
  },
  async byId(tx: Tx, id: string): Promise<Order> {
    return parse(orderSchema, await tx.one("select * from orders where org_id = $1 and id = $2", [tx.orgId, id], "Commande"));
  },
  async byDedupe(tx: Tx, key: string): Promise<Order | null> {
    const r = await tx.maybeOne("select * from orders where org_id = $1 and dedupe_key = $2", [tx.orgId, key]);
    return r ? parse(orderSchema, r) : null;
  },
  async forItem(tx: Tx, itemId: string): Promise<Order[]> {
    return (await tx.query("select * from orders where org_id = $1 and item_id = $2", [tx.orgId, itemId])).map((r) => parse(orderSchema, r));
  },
  async recent(tx: Tx, limit = 5): Promise<Order[]> {
    return (await tx.query("select * from orders where org_id = $1 order by created_at desc limit $2", [tx.orgId, limit])).map((r) => parse(orderSchema, r));
  },
  async create(tx: Tx, input: Partial<Order>): Promise<Order> {
    return parse(orderSchema, await tx.insert("orders", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Order>): Promise<Order> {
    return parse(orderSchema, await tx.update("orders", id, patch, "Commande"));
  },
  async countPending(tx: Tx): Promise<number> {
    return tx.count("select count(*) from orders where org_id = $1 and status in ('pending','paid')", [tx.orgId]);
  },
};

export const shipments = {
  async forOrder(tx: Tx, orderId: string): Promise<Shipment | null> {
    const r = await tx.maybeOne("select * from shipments where org_id = $1 and order_id = $2", [tx.orgId, orderId]);
    return r ? parse(shipmentSchema, r) : null;
  },
  async upsert(tx: Tx, orderId: string, patch: Partial<Shipment>): Promise<Shipment> {
    const existing = await shipments.forOrder(tx, orderId);
    if (existing) return parse(shipmentSchema, await tx.update("shipments", existing.id, patch, "Expédition"));
    return parse(shipmentSchema, await tx.insert("shipments", { ...patch, orderId, orgId: tx.orgId }));
  },
};

export const rules = {
  async list(tx: Tx): Promise<AutomationRule[]> {
    return (await tx.query("select * from automation_rules where org_id = $1 order by created_at", [tx.orgId])).map((r) => parse(automationRule, r));
  },
  async byId(tx: Tx, id: string): Promise<AutomationRule> {
    return parse(automationRule, await tx.one("select * from automation_rules where org_id = $1 and id = $2", [tx.orgId, id], "Règle"));
  },
  async create(tx: Tx, input: Partial<AutomationRule>): Promise<AutomationRule> {
    return parse(automationRule, await tx.insert("automation_rules", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<AutomationRule>): Promise<AutomationRule> {
    return parse(automationRule, await tx.update("automation_rules", id, patch, "Règle"));
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from automation_rules where org_id = $1 and id = $2", [tx.orgId, id]);
  },
};

export const automationState = {
  async get(tx: Tx): Promise<{ globalPaused: boolean; pausedAt: string | null }> {
    const r = await tx.maybeOne<{ globalPaused: boolean; pausedAt: string | null }>("select * from automation_state where org_id = $1", [tx.orgId]);
    return r ? { globalPaused: r.globalPaused, pausedAt: r.pausedAt } : { globalPaused: false, pausedAt: null };
  },
  async set(tx: Tx, paused: boolean): Promise<void> {
    await tx.query("insert into automation_state (org_id, global_paused, paused_at) values ($1, $2, case when $2 then now() else null end) on conflict (org_id) do update set global_paused = $2, paused_at = case when $2 then now() else null end", [tx.orgId, paused]);
  },
};

export const jobs = {
  async list(tx: Tx, q: Partial<JobQuery>): Promise<Page<Job>> {
    const where = ["org_id = $1"];
    const params: unknown[] = [tx.orgId];
    if (q.status) { params.push(q.status); where.push(`status = $${params.length}`); }
    if (q.kind) { params.push(q.kind); where.push(`kind = $${params.length}`); }
    if (q.ruleId) { params.push(q.ruleId); where.push(`rule_id = $${params.length}`); }
    const pageSize = q.pageSize ?? 25;
    const p = q.page ?? 1;
    const total = await tx.count(`select count(*) from jobs where ${where.join(" and ")}`, params);
    const rows = await tx.query(`select * from jobs where ${where.join(" and ")} order by created_at desc, id limit ${pageSize} offset ${(p - 1) * pageSize}`, params);
    return page(rows.map((r) => parse(jobSchema, r)), total, p, pageSize);
  },
  async byId(tx: Tx, id: string): Promise<Job> {
    return parse(jobSchema, await tx.one("select * from jobs where org_id = $1 and id = $2", [tx.orgId, id], "Tâche"));
  },
  async byDedupe(tx: Tx, key: string): Promise<Job | null> {
    const r = await tx.maybeOne("select * from jobs where org_id = $1 and dedupe_key = $2", [tx.orgId, key]);
    return r ? parse(jobSchema, r) : null;
  },
  async create(tx: Tx, input: Partial<Job>): Promise<Job> {
    return parse(jobSchema, await tx.insert("jobs", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Job>): Promise<Job> {
    return parse(jobSchema, await tx.update("jobs", id, patch, "Tâche"));
  },
  async countByStatus(tx: Tx): Promise<Record<string, number>> {
    const rows = await tx.query<{ status: string; count: number }>("select status, count(*) as count from jobs where org_id = $1 group by status", [tx.orgId]);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  },
  async countForRuleSince(tx: Tx, ruleId: string, since: string, customerId?: string): Promise<number> {
    if (customerId) return tx.count("select count(*) from jobs where org_id = $1 and rule_id = $2 and created_at >= $3 and status <> 'cancelled' and payload->>'customerId' = $4", [tx.orgId, ruleId, since, customerId]);
    return tx.count("select count(*) from jobs where org_id = $1 and rule_id = $2 and created_at >= $3 and status = 'succeeded'", [tx.orgId, ruleId, since]);
  },
  async dueQueued(tx: Tx, limit = 50): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and status = 'queued' and scheduled_for <= now() order by scheduled_for limit $2", [tx.orgId, limit])).map((r) => parse(jobSchema, r));
  },
  async recentErrors(tx: Tx, limit = 20): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and error is not null order by updated_at desc limit $2", [tx.orgId, limit])).map((r) => parse(jobSchema, r));
  },
};

export const searches = {
  async list(tx: Tx): Promise<RadarSearch[]> {
    return (await tx.query("select * from radar_searches where org_id = $1 order by created_at desc", [tx.orgId])).map((r) => parse(radarSchema, r));
  },
  async byId(tx: Tx, id: string): Promise<RadarSearch> {
    return parse(radarSchema, await tx.one("select * from radar_searches where org_id = $1 and id = $2", [tx.orgId, id], "Recherche"));
  },
  async create(tx: Tx, input: Partial<RadarSearch>): Promise<RadarSearch> {
    return parse(radarSchema, await tx.insert("radar_searches", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<RadarSearch>): Promise<RadarSearch> {
    return parse(radarSchema, await tx.update("radar_searches", id, patch, "Recherche"));
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from radar_searches where org_id = $1 and id = $2", [tx.orgId, id]);
  },
};

export const opportunities = {
  async list(tx: Tx, q: { searchId?: string; status?: string }): Promise<Opportunity[]> {
    const where = ["org_id = $1"];
    const params: unknown[] = [tx.orgId];
    if (q.searchId) { params.push(q.searchId); where.push(`search_id = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`status = $${params.length}`); }
    return (await tx.query(`select * from opportunities where ${where.join(" and ")} order by score desc, created_at desc limit 500`, params)).map((r) => parse(opportunitySchema, r));
  },
  async byId(tx: Tx, id: string): Promise<Opportunity> {
    return parse(opportunitySchema, await tx.one("select * from opportunities where org_id = $1 and id = $2", [tx.orgId, id], "Opportunité"));
  },
  async exists(tx: Tx, searchId: string, title: string, priceCents: number): Promise<boolean> {
    return (await tx.count("select count(*) from opportunities where org_id = $1 and search_id = $2 and title = $3 and (observed->>'priceCents')::int = $4", [tx.orgId, searchId, title, priceCents])) > 0;
  },
  async create(tx: Tx, input: Partial<Opportunity>): Promise<Opportunity> {
    return parse(opportunitySchema, await tx.insert("opportunities", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Opportunity>): Promise<Opportunity> {
    return parse(opportunitySchema, await tx.update("opportunities", id, patch, "Opportunité"));
  },
};

export const purchases = {
  async list(tx: Tx): Promise<(PurchaseRequest & { opportunity: Opportunity | null })[]> {
    const rows = await tx.query<Record<string, unknown>>("select p.*, row_to_json(o) as opportunity_json from purchase_requests p left join opportunities o on o.id = p.opportunity_id where p.org_id = $1 order by p.created_at desc", [tx.orgId]);
    const { rowToObject } = await import("./mapping");
    return rows.map((r) => ({ ...parse(purchaseSchema, r), opportunity: r.opportunityJson ? parse(opportunitySchema, rowToObject(r.opportunityJson as Record<string, unknown>)) : null }));
  },
  async byId(tx: Tx, id: string): Promise<PurchaseRequest> {
    return parse(purchaseSchema, await tx.one("select * from purchase_requests where org_id = $1 and id = $2", [tx.orgId, id], "Demande d'achat"));
  },
  async activeForOpportunity(tx: Tx, opportunityId: string): Promise<PurchaseRequest | null> {
    const r = await tx.maybeOne("select * from purchase_requests where org_id = $1 and opportunity_id = $2 and status not in ('cancelled','blocked') limit 1", [tx.orgId, opportunityId]);
    return r ? parse(purchaseSchema, r) : null;
  },
  async spentToday(tx: Tx, excludeId: string): Promise<number> {
    return tx.count("select coalesce(sum(max_price_cents),0) as count from purchase_requests where org_id = $1 and id <> $2 and status in ('simulated','executed') and executed_at::date = now()::date", [tx.orgId, excludeId]);
  },
  async create(tx: Tx, input: Partial<PurchaseRequest>): Promise<PurchaseRequest> {
    return parse(purchaseSchema, await tx.insert("purchase_requests", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<PurchaseRequest>): Promise<PurchaseRequest> {
    return parse(purchaseSchema, await tx.update("purchase_requests", id, patch, "Demande d'achat"));
  },
};

export const connections = {
  async list(tx: Tx): Promise<MarketplaceConnection[]> {
    return (await tx.query("select *, (secret_ciphertext is not null) as has_secret from marketplace_connections where org_id = $1 order by created_at", [tx.orgId])).map((r) => parse(marketplaceConnection, r));
  },
  async byId(tx: Tx, id: string): Promise<MarketplaceConnection> {
    return parse(marketplaceConnection, await tx.one("select *, (secret_ciphertext is not null) as has_secret from marketplace_connections where org_id = $1 and id = $2", [tx.orgId, id], "Connexion"));
  },
  async secret(tx: Tx, id: string): Promise<Buffer | null> {
    const r = await tx.maybeOne<{ secretCiphertext: Buffer | null }>("select secret_ciphertext from marketplace_connections where org_id = $1 and id = $2", [tx.orgId, id]);
    return r?.secretCiphertext ?? null;
  },
  async create(tx: Tx, input: Partial<MarketplaceConnection> & { secretCiphertext?: Buffer | null }): Promise<MarketplaceConnection> {
    const { hasSecret: _h, ...rest } = input;
    const row = await tx.insert<Record<string, unknown>>("marketplace_connections", { ...rest, orgId: tx.orgId });
    return parse(marketplaceConnection, { ...row, hasSecret: Boolean(row.secretCiphertext) });
  },
  async update(tx: Tx, id: string, patch: Partial<MarketplaceConnection> & { secretCiphertext?: Buffer | null }): Promise<MarketplaceConnection> {
    const { hasSecret: _h, ...rest } = patch;
    const row = await tx.update<Record<string, unknown>>("marketplace_connections", id, rest, "Connexion");
    return parse(marketplaceConnection, { ...row, hasSecret: Boolean(row.secretCiphertext) });
  },
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from marketplace_connections where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  async count(tx: Tx): Promise<number> {
    return tx.count("select count(*) from marketplace_connections where org_id = $1", [tx.orgId]);
  },
};

export const tokens = {
  async list(tx: Tx): Promise<ExtensionToken[]> {
    return (await tx.query("select id, org_id, user_id, label, prefix, scopes, expires_at, last_used_at, revoked_at, created_at from extension_tokens where org_id = $1 order by created_at desc", [tx.orgId])).map((r) => parse(extensionToken, r));
  },
  async create(tx: Tx, input: Partial<ExtensionToken> & { secretHash: string }): Promise<ExtensionToken> {
    const row = await tx.insert<Record<string, unknown>>("extension_tokens", { ...input, orgId: tx.orgId });
    delete row.secretHash;
    return parse(extensionToken, row);
  },
  async revoke(tx: Tx, id: string): Promise<void> {
    await tx.query("update extension_tokens set revoked_at = now() where org_id = $1 and id = $2 and revoked_at is null", [tx.orgId, id]);
  },
  /** Recherche globale par préfixe (fonction SECURITY DEFINER, sans ouvrir la table). */
  async findByPrefix(tx: Tx, prefix: string) {
    return tx.maybeOne<{ id: string; orgId: string; userId: string; secretHash: string; scopes: string[]; expiresAt: string; revokedAt: string | null }>("select * from app_find_extension_token($1)", [prefix]);
  },
  async touch(tx: Tx, id: string): Promise<void> {
    await tx.query("select app_touch_extension_token($1)", [id]);
  },
};

export const aiRequests = {
  async list(tx: Tx, limit = 50): Promise<AiRequest[]> {
    return (await tx.query("select * from ai_requests where org_id = $1 order by created_at desc limit $2", [tx.orgId, limit])).map((r) => parse(aiRequest, r));
  },
  async countSince(tx: Tx, since: string): Promise<number> {
    return tx.count("select count(*) from ai_requests where org_id = $1 and created_at >= $2", [tx.orgId, since]);
  },
  async create(tx: Tx, input: Partial<AiRequest>): Promise<AiRequest> {
    return parse(aiRequest, await tx.insert("ai_requests", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<AiRequest>): Promise<AiRequest> {
    const { objectToColumns } = await import("./mapping");
    const { columns, values } = objectToColumns(patch);
    const sets = columns.map((c, i) => `${c} = $${i + 3}`);
    return parse(aiRequest, await tx.one(`update ai_requests set ${sets.join(", ")} where org_id = $1 and id = $2 returning *`, [tx.orgId, id, ...values], "Requête IA"));
  },
  async purgeOlderThan(tx: Tx, days: number): Promise<number> {
    return (await tx.query("delete from ai_requests where org_id = $1 and created_at < now() - ($2 || ' days')::interval returning id", [tx.orgId, String(days)])).length;
  },
};

export const usage = {
  async record(tx: Tx, kind: UsageEvent["kind"], meta: Record<string, unknown> = {}, quantity = 1): Promise<void> {
    await tx.insert("usage_events", { orgId: tx.orgId, kind, quantity, meta });
  },
  async list(tx: Tx, limit = 50): Promise<UsageEvent[]> {
    return (await tx.query("select * from usage_events where org_id = $1 order by created_at desc limit $2", [tx.orgId, limit])).map((r) => parse(usageEvent, r));
  },
  async sumSince(tx: Tx, since: string): Promise<Record<string, number>> {
    const rows = await tx.query<{ kind: string; total: number }>("select kind, sum(quantity) as total from usage_events where org_id = $1 and created_at >= $2 group by kind", [tx.orgId, since]);
    return Object.fromEntries(rows.map((r) => [r.kind, Number(r.total)]));
  },
};

export const subscriptions = {
  async get(tx: Tx): Promise<Subscription | null> {
    const r = await tx.maybeOne("select * from subscriptions where org_id = $1", [tx.orgId]);
    return r ? parse(subscriptionSchema, r) : null;
  },
  async upsert(tx: Tx, input: Partial<Subscription> & { stripeCustomerId?: string | null }): Promise<Subscription> {
    const existing = await subscriptions.get(tx);
    if (existing) return parse(subscriptionSchema, await tx.update("subscriptions", existing.id, input, "Abonnement"));
    const plan = input.plan ?? "free";
    return parse(subscriptionSchema, await tx.insert("subscriptions", { plan, quotas: PLAN_QUOTAS[plan], ...input, orgId: tx.orgId }));
  },
  async findByExternalRef(tx: Tx, ref: string) {
    return tx.maybeOne<{ id: string; orgId: string }>("select * from app_find_subscription_by_ref($1)", [ref]);
  },
};

export const audit = {
  async add(tx: Tx, e: { orgId?: string | null; actorUserId: string | null; action: string; targetType?: string | null; targetId?: string | null; meta?: Record<string, unknown>; ip?: string | null }): Promise<void> {
    await tx.insert("audit_logs", { orgId: e.orgId ?? tx.orgId, actorUserId: e.actorUserId, action: e.action, targetType: e.targetType ?? null, targetId: e.targetId ?? null, meta: e.meta ?? {}, ip: e.ip ?? null });
  },
  async list(tx: Tx, limit = 100): Promise<AuditLog[]> {
    return (await tx.query("select * from audit_logs where org_id = $1 order by created_at desc limit $2", [tx.orgId, limit])).map((r) => parse(auditLog, r));
  },
  async purgeOlderThan(tx: Tx, days: number): Promise<number> {
    return (await tx.query("delete from audit_logs where org_id = $1 and created_at < now() - ($2 || ' days')::interval returning id", [tx.orgId, String(days)])).length;
  },
};

export const admin = {
  async orgSummary(tx: Tx) {
    return tx.query<{ id: string; name: string; plan: string; members: number; items: number; createdAt: string }>("select * from app_admin_org_summary()");
  },
};
