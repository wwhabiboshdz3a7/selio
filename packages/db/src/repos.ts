import {
  aiRequest, auditLog, cloudAccount as cloudAccountSchema, cloudAction as cloudActionSchema, cloudConsent as cloudConsentSchema, cloudLoginSession as cloudLoginSessionSchema, automationRule, conversation as conversationSchema, customer as customerSchema, extensionToken, inventoryEvent, inventoryItem, invoice as invoiceSchema, job as jobSchema, marketplaceConnection, membership as membershipSchema, message as messageSchema, opportunity as opportunitySchema, order as orderSchema, organization as organizationSchema, paymentOrder as paymentOrderSchema, purchaseRequest as purchaseSchema, radarSearch as radarSchema, shipment as shipmentSchema, subscription as subscriptionSchema, usageEvent, user as userSchema, quotasForPlan, isLegacyQuotas, resolveQuotas,
  type AiRequest, type AuditLog, type AutomationRule, type CloudAccount, type CloudAction, type CloudActionDetail, type CloudConsent, type CloudJournalQuery, type CloudLoginSession, type Conversation, type ConversationQuery, type Customer, type CustomerQuery, type ExtensionToken, type InventoryEvent, type InventoryItem, type InventoryQuery, type Invoice, type Job, type JobQuery, type MarketplaceConnection, type Membership, type Message, type Opportunity, type Order, type OrderQuery, type Organization, type Page, type PaymentOrder, type PurchaseRequest, type RadarSearch, type Shipment, type Subscription, type UsageEvent, type User,
} from "@selio/contracts";
import type { ZodType, ZodTypeDef } from "zod";
import type { AccountStats } from "@selio/domain";
import { objectToColumns } from "./mapping";
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
  async updateProfile(tx: Tx, id: string, patch: { displayName?: string }): Promise<User> {
    return parse(userSchema, await tx.update("users", id, patch, "Utilisateur"));
  },
  async countOperators(tx: Tx): Promise<number> {
    return tx.count("select count(*) from users where is_operator");
  },
  /** Suppression d'un compte (cascade : appartenances, sessions, jetons) ; réservé à la compensation d'une invitation non envoyée. */
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from users where id = $1", [id]);
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

/**
 * Jetons de réinitialisation de mot de passe (table globale, hors contexte
 * d'organisation). Seule l'empreinte SHA-256 du jeton est stockée ; `now` est
 * l'horloge injectée des services (ISO) pour que les tests puissent la figer.
 */
export const passwordResets = {
  async create(tx: Tx, input: { userId: string; tokenHash: string; expiresAt: string }): Promise<{ id: string }> {
    const row = await tx.insert<{ id: string }>("password_resets", input);
    return { id: row.id };
  },
  /** Jeton encore valable : ni utilisé, ni expiré à l'instant `now`. */
  async findValid(tx: Tx, tokenHash: string, now: string) {
    return tx.maybeOne<{ id: string; userId: string; expiresAt: string }>("select id, user_id, expires_at from password_resets where token_hash = $1 and used_at is null and expires_at > $2", [tokenHash, now]);
  },
  async markUsed(tx: Tx, id: string, now: string): Promise<void> {
    await tx.query("update password_resets set used_at = $2 where id = $1 and used_at is null", [id, now]);
  },
  /** Invalide les demandes encore ouvertes d'un utilisateur (nouvelle demande, mot de passe changé). */
  async invalidateForUser(tx: Tx, userId: string, now: string): Promise<number> {
    return (await tx.query("update password_resets set used_at = $2 where user_id = $1 and used_at is null returning id", [userId, now])).length;
  },
  /** Ménage (tâche de rétention) : les jetons expirés depuis plus de 30 jours ne servent plus à rien, même à l'audit. */
  async purgeExpired(tx: Tx): Promise<number> {
    return (await tx.query("delete from password_resets where expires_at < now() - interval '30 days' returning id")).length;
  },
};

/** Invitations à rejoindre une organisation (table globale : la personne n'est pas connectée quand elle accepte). */
export const invites = {
  async create(tx: Tx, input: { orgId: string; userId: string; tokenHash: string; expiresAt: string }): Promise<{ id: string }> {
    const row = await tx.insert<{ id: string }>("invites", input);
    return { id: row.id };
  },
  async findValid(tx: Tx, tokenHash: string, now: string) {
    return tx.maybeOne<{ id: string; orgId: string; userId: string; expiresAt: string }>("select id, org_id, user_id, expires_at from invites where token_hash = $1 and accepted_at is null and expires_at > $2", [tokenHash, now]);
  },
  async markAccepted(tx: Tx, id: string, now: string): Promise<void> {
    await tx.query("update invites set accepted_at = $2 where id = $1 and accepted_at is null", [id, now]);
  },
  /** Invalide les invitations encore ouvertes d'un membre dans une organisation (ré-invitation, acceptation, retrait). */
  async invalidateForUser(tx: Tx, orgId: string, userId: string, now: string): Promise<number> {
    return (await tx.query("update invites set accepted_at = $3 where org_id = $1 and user_id = $2 and accepted_at is null returning id", [orgId, userId, now])).length;
  },
  async purgeExpired(tx: Tx): Promise<number> {
    return (await tx.query("delete from invites where expires_at < now() - interval '30 days' returning id")).length;
  },
};

export const paymentEvents = {
  /** Identifiant d'idempotence d'une livraison de webhook : (fournisseur, commande, événement). */
  eventId(provider: string, orderId: string, event: string): string {
    return `${provider}:${orderId}:${event}`;
  },
  /**
   * Réserve l'événement pour traitement et retourne false s'il est déjà traité (idempotence) ou
   * en cours de traitement (réservation de moins de deux minutes : deux livraisons simultanées
   * du même événement n'en traitent qu'une). Un événement reçu dont le traitement a échoué
   * (processed_at nul, réservation relâchée ou expirée) peut être retraité : sinon le renvoi du
   * fournisseur serait pris pour un doublon et l'abonnement resterait faux.
   */
  async record(tx: Tx, input: { id: string; provider: string; type: string; orderId?: string | null; payload: unknown }): Promise<boolean> {
    const rows = await tx.query(
      `insert into payment_events (id, provider, type, order_id, payload, claimed_at) values ($1, $2, $3, $4, $5, now())
       on conflict (id) do update set payload = excluded.payload, claimed_at = now()
       where payment_events.processed_at is null and (payment_events.claimed_at is null or payment_events.claimed_at < now() - interval '2 minutes')
       returning id`,
      [input.id, input.provider, input.type, input.orderId ?? null, JSON.stringify(input.payload)],
    );
    return rows.length > 0;
  },
  async markProcessed(tx: Tx, id: string): Promise<void> {
    await tx.query("update payment_events set processed_at = now() where id = $1", [id]);
  },
  /** Traitement échoué : la réservation est relâchée pour que le renvoi du fournisseur soit retraité sans attendre. */
  async release(tx: Tx, id: string): Promise<void> {
    await tx.query("update payment_events set claimed_at = null where id = $1 and processed_at is null", [id]);
  },
  /** Événements reçus pour une commande (diagnostic), du plus récent au plus ancien. */
  async listForOrder(tx: Tx, orderId: string): Promise<{ id: string; type: string; receivedAt: string; processedAt: string | null }[]> {
    return tx.query("select id, type, received_at, processed_at from payment_events where order_id = $1 order by received_at desc", [orderId]);
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
    // Dernière mise en ligne : republication la plus récente, sinon mise en vente.
    const onlineSince = "greatest(listed_at, (select max((r->>'at')::timestamptz) from jsonb_array_elements(republications) r))";
    if (q.minDaysOnline !== undefined) { params.push(String(q.minDaysOnline)); where.push(`status in ('listed','reserved') and ${onlineSince} <= now() - ($${params.length} || ' days')::interval`); }
    const order = { updated_desc: "updated_at desc", created_desc: "created_at desc", title_asc: "title asc", price_asc: "listed_price_cents asc nulls first", price_desc: "listed_price_cents desc nulls last", margin_desc: "(coalesce(listed_price_cents, 0) - purchase_price_cents - purchase_fees_cents) desc", online_desc: `${onlineSince} asc nulls last` }[q.sort ?? "updated_desc"];
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
  /** Tâches serveur et navigateur échues ; les tâches Cloud ont leur propre planificateur (`dueCloud`). */
  async dueQueued(tx: Tx, limit = 50): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and status = 'queued' and runs_in <> 'cloud' and scheduled_for <= now() order by scheduled_for limit $2", [tx.orgId, limit])).map((r) => parse(jobSchema, r));
  },
  async recentErrors(tx: Tx, limit = 20): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and error is not null order by updated_at desc limit $2", [tx.orgId, limit])).map((r) => parse(jobSchema, r));
  },
  /** Tâches Cloud échues (en file, `runs_in = 'cloud'`) à l'instant `now` (horloge des services). */
  async dueCloud(tx: Tx, now: string, limit = 200): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and runs_in = 'cloud' and status = 'queued' and scheduled_for <= $2 order by scheduled_for, created_at, id limit $3", [tx.orgId, now, limit])).map((r) => parse(jobSchema, r));
  },
  /**
   * Prise d'une tâche Cloud (UPDATE conditionnel) : null si elle n'est plus en file (déjà prise par
   * un autre passage, annulée…). C'est ce qui garantit qu'une tâche ne s'exécute jamais deux fois.
   */
  async claimCloud(tx: Tx, id: string, now: string): Promise<Job | null> {
    const r = await tx.maybeOne("update jobs set status = 'running', started_at = $3, attempts = attempts + 1, updated_at = now() where org_id = $1 and id = $2 and status = 'queued' and runs_in = 'cloud' returning *", [tx.orgId, id, now]);
    return r ? parse(jobSchema, r) : null;
  },
  /** Tâches Cloud restées « en cours » depuis avant `before` (passage interrompu). */
  async staleCloudRunning(tx: Tx, before: string): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and runs_in = 'cloud' and status = 'running' and coalesce(started_at, updated_at) < $2 order by started_at limit 100", [tx.orgId, before])).map((r) => parse(jobSchema, r));
  },
  /** Annule les tâches Cloud pas encore exécutées d'un compte (arrêt du Cloud). */
  async cancelCloudForAccount(tx: Tx, cloudAccountId: string): Promise<number> {
    return (await tx.query("update jobs set status = 'cancelled', updated_at = now() where org_id = $1 and runs_in = 'cloud' and status in ('queued','awaiting_approval') and payload->>'cloudAccountId' = $2 returning id", [tx.orgId, cloudAccountId])).length;
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
  /** Comptes pris en compte dans le quota du plan : le simulateur de démonstration n'en fait pas partie. */
  async count(tx: Tx): Promise<number> {
    return tx.count("select count(*) from marketplace_connections where org_id = $1 and provider <> 'demo'", [tx.orgId]);
  },
  /** Chiffres utiles par compte : annonces en ligne, ventes depuis `since`, achats, conversations ouvertes. */
  async stats(tx: Tx, since: string): Promise<AccountStats[]> {
    const live = "o.org_id = c.org_id and o.connection_id = c.id and o.status not in ('cancelled','refunded') and o.created_at >= $2";
    const bought = "p.org_id = c.org_id and p.connection_id = c.id and p.status in ('simulated','executed')";
    return tx.query<AccountStats>(
      `select c.id as connection_id,
        (select count(*) from inventory_items i where i.org_id = c.org_id and i.connection_id = c.id and i.status in ('listed','reserved')) as listed_items,
        (select count(*) from orders o where ${live}) as sales_this_month,
        (select coalesce(sum(o.sale_price_cents), 0) from orders o where ${live}) as revenue_this_month_cents,
        (select count(*) from purchase_requests p where ${bought}) as purchases,
        (select coalesce(sum(p.max_price_cents), 0) from purchase_requests p where ${bought}) as purchases_spent_cents,
        (select count(*) from conversations v where v.org_id = c.org_id and v.connection_id = c.id and v.status = 'open') as open_conversations
      from marketplace_connections c where c.org_id = $1 order by c.created_at`,
      [tx.orgId, since],
    );
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
  /** Requêtes décomptées du quota IA mensuel : les questions d'aide (help_answer) n'y entrent pas. */
  async countSince(tx: Tx, since: string): Promise<number> {
    return tx.count("select count(*) from ai_requests where org_id = $1 and created_at >= $2 and kind <> 'help_answer'", [tx.orgId, since]);
  },
  /** Requêtes depuis une date (état de l'IA), plafonnées : le quota mensuel le plus large reste bien en dessous. */
  async listSince(tx: Tx, since: string, limit = 10_000): Promise<AiRequest[]> {
    return (await tx.query("select * from ai_requests where org_id = $1 and created_at >= $2 order by created_at desc limit $3", [tx.orgId, since, limit])).map((r) => parse(aiRequest, r));
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
  /** Total d'un seul compteur depuis une date (contrôle d'un quota par filiale avant une action). */
  async sumKindSince(tx: Tx, kind: UsageEvent["kind"], since: string): Promise<number> {
    const row = await tx.maybeOne<{ total: number | string | null }>("select coalesce(sum(quantity), 0) as total from usage_events where org_id = $1 and kind = $2 and created_at >= $3", [tx.orgId, kind, since]);
    return Number(row?.total ?? 0);
  },
};

/**
 * Ligne d'abonnement → objet : un JSON `quotas` d'avant les offres 1/3/10 (sans champs par filiale,
 * anciennes valeurs 3 000 réponses / 5 comptes / 10 membres) est remplacé par les quotas du plan
 * (`resolveQuotas`). La migration 0008 réécrit ces lignes ; ceci couvre celles insérées après coup.
 */
function toSubscription(row: Record<string, unknown>): Subscription {
  const sub = parse(subscriptionSchema, row);
  return isLegacyQuotas(row.quotas) ? { ...sub, quotas: resolveQuotas(sub.plan, row.quotas) } : sub;
}

export const subscriptions = {
  async get(tx: Tx): Promise<Subscription | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from subscriptions where org_id = $1", [tx.orgId]);
    return r ? toSubscription(r) : null;
  },
  async upsert(tx: Tx, input: Partial<Subscription>): Promise<Subscription> {
    const existing = await subscriptions.get(tx);
    if (existing) return toSubscription(await tx.update<Record<string, unknown>>("subscriptions", existing.id, input, "Abonnement"));
    const plan = input.plan ?? "free";
    return toSubscription(await tx.insert<Record<string, unknown>>("subscriptions", { plan, quotas: quotasForPlan(plan), ...input, orgId: tx.orgId }));
  },
  async findByExternalRef(tx: Tx, ref: string) {
    return tx.maybeOne<{ id: string; orgId: string }>("select * from app_find_subscription_by_ref($1)", [ref]);
  },
};

/**
 * Commandes créées chez le fournisseur de paiement (une ligne par tentative). Table d'organisation
 * (RLS) ; le webhook, qui ne connaît que l'identifiant de commande, passe par `findGlobal`.
 */
export const paymentOrders = {
  /** `createdAt` : horloge des services quand elle est fournie (âge d'une commande ouverte), sinon celle de la base. */
  async create(tx: Tx, input: Omit<PaymentOrder, "id" | "orgId" | "createdAt" | "updatedAt" | "state" | "attempt" | "error"> & Partial<Pick<PaymentOrder, "state" | "attempt" | "error" | "createdAt">>): Promise<PaymentOrder> {
    return parse(paymentOrderSchema, await tx.insert("payment_orders", { state: "pending", attempt: 0, error: null, ...input, orgId: tx.orgId }));
  },
  async byOrderId(tx: Tx, orderId: string): Promise<PaymentOrder | null> {
    const r = await tx.maybeOne("select * from payment_orders where org_id = $1 and order_id = $2", [tx.orgId, orderId]);
    return r ? parse(paymentOrderSchema, r) : null;
  },
  async update(tx: Tx, id: string, patch: Partial<Pick<PaymentOrder, "state" | "error" | "attempt">>): Promise<PaymentOrder> {
    return parse(paymentOrderSchema, await tx.update("payment_orders", id, patch, "Commande de paiement"));
  },
  /**
   * Transitions d'état conditionnelles et atomiques (un seul UPDATE … WHERE … RETURNING) : la
   * ligne est verrouillée jusqu'au commit, une transaction concurrente relit l'état après et
   * obtient null. C'est ce qui rend idempotents worker et webhook (jamais deux factures, jamais
   * deux échecs comptés pour une même commande).
   */
  /** Clôt une commande payée ; null si elle l'était déjà. */
  async complete(tx: Tx, id: string): Promise<PaymentOrder | null> {
    const r = await tx.maybeOne("update payment_orders set state = 'completed', error = null, updated_at = now() where id = $1 and org_id = $2 and state <> 'completed' returning *", [id, tx.orgId]);
    return r ? parse(paymentOrderSchema, r) : null;
  },
  /** Marque échouée une commande encore ouverte (pending ou authorised) ; null sinon (déjà close). */
  async fail(tx: Tx, id: string, error: string): Promise<PaymentOrder | null> {
    const r = await tx.maybeOne("update payment_orders set state = 'failed', error = $3, updated_at = now() where id = $1 and org_id = $2 and state in ('pending', 'authorised') returning *", [id, tx.orgId, error.slice(0, 500)]);
    return r ? parse(paymentOrderSchema, r) : null;
  },
  /** Marque annulée une commande ouverte (pending ou authorised) ; null sinon. */
  async cancel(tx: Tx, id: string, error: string | null = null): Promise<PaymentOrder | null> {
    const r = await tx.maybeOne("update payment_orders set state = 'cancelled', error = coalesce($3, error), updated_at = now() where id = $1 and org_id = $2 and state in ('pending', 'authorised') returning *", [id, tx.orgId, error ? error.slice(0, 500) : null]);
    return r ? parse(paymentOrderSchema, r) : null;
  },
  /** Dernière commande d'une sorte donnée (par exemple le renouvellement en cours), ou null. */
  async latest(tx: Tx, kind: PaymentOrder["kind"]): Promise<PaymentOrder | null> {
    const r = await tx.maybeOne("select * from payment_orders where org_id = $1 and kind = $2 order by created_at desc limit 1", [tx.orgId, kind]);
    return r ? parse(paymentOrderSchema, r) : null;
  },
  /** Commandes d'une organisation dans un état donné pour certaines sortes (autorisations restées ouvertes à annuler). */
  async listByState(tx: Tx, kinds: PaymentOrder["kind"][], state: PaymentOrder["state"], limit = 20): Promise<PaymentOrder[]> {
    return (await tx.query("select * from payment_orders where org_id = $1 and kind = any($2::text[]) and state = $3 order by created_at asc limit $4", [tx.orgId, kinds, state, limit])).map((r) => parse(paymentOrderSchema, r));
  },
  async list(tx: Tx, limit = 50): Promise<PaymentOrder[]> {
    return (await tx.query("select * from payment_orders where org_id = $1 order by created_at desc limit $2", [tx.orgId, limit])).map((r) => parse(paymentOrderSchema, r));
  },
  /** Recherche globale par identifiant de commande (fonction SECURITY DEFINER, sans ouvrir la table). */
  async findGlobal(tx: Tx, orderId: string) {
    return tx.maybeOne<{ id: string; orgId: string; kind: string; state: string }>("select * from app_find_payment_order($1)", [orderId]);
  },
};

function toInvoice(row: Record<string, unknown>): Invoice {
  // numeric(5,2) arrive en texte depuis pg : le taux de TVA redevient un nombre.
  return parse(invoiceSchema, { ...row, vatRate: Number(row.vatRate) });
}

/**
 * Factures (immuables : aucune mise à jour). Le numéro vient du compteur transactionnel de l'année
 * d'émission (`invoice_counters`, migration 0010) : si la transaction est annulée ensuite, le numéro
 * est rendu, la numérotation reste continue. `order_id` est unique : jamais deux factures pour une
 * même commande, même si deux clôtures se croisaient.
 */
export const invoices = {
  async create(tx: Tx, input: Omit<Invoice, "id" | "orgId" | "number" | "createdAt">): Promise<Invoice> {
    const year = new Date(input.issuedAt).getUTCFullYear();
    const { number } = await tx.one<{ number: string }>("select app_next_invoice_number($1) as number", [year]);
    return toInvoice(await tx.insert("invoices", { ...input, number, orgId: tx.orgId }));
  },
  async list(tx: Tx, limit = 100): Promise<Invoice[]> {
    return (await tx.query("select * from invoices where org_id = $1 order by issued_at desc, number desc limit $2", [tx.orgId, limit])).map(toInvoice);
  },
  async byId(tx: Tx, id: string): Promise<Invoice | null> {
    const r = await tx.maybeOne("select * from invoices where org_id = $1 and id = $2", [tx.orgId, id]);
    return r ? toInvoice(r) : null;
  },
  async count(tx: Tx): Promise<number> {
    return tx.count("select count(*) from invoices where org_id = $1", [tx.orgId]);
  },
};

// ---------------------------------------------------------------- Selio Cloud
/**
 * Comptes Cloud : la session chiffrée (`session_ciphertext`) n'est jamais lue par les lectures
 * ordinaires, seulement sa présence (`has_session`). Seul `cloudAccounts.session` rend le bloc
 * chiffré, à déchiffrer par le service au moment d'agir.
 */
const CLOUD_ACCOUNT_COLUMNS = "id, org_id, connection_id, status, paused_reason, paused_at, (session_ciphertext is not null) as has_session, session_saved_at, last_action_at, warnings_count, settings, created_at, updated_at";
/** Statuts d'une action qui a ouvert le navigateur (comptés dans les plafonds). */
const CLOUD_STARTED_STATUSES = ["running", "done", "failed", "paused"];

export const cloudConsents = {
  /** Dernier accord enregistré par l'organisation (tous membres confondus), ou null. */
  async latest(tx: Tx): Promise<CloudConsent | null> {
    const r = await tx.maybeOne("select * from cloud_consents where org_id = $1 order by accepted_at desc, created_at desc limit 1", [tx.orgId]);
    return r ? parse(cloudConsentSchema, r) : null;
  },
  async add(tx: Tx, input: { userId: string; version: string; textHash: string; acceptedAt: string; ip: string | null }): Promise<CloudConsent> {
    return parse(cloudConsentSchema, await tx.insert("cloud_consents", { ...input, orgId: tx.orgId }));
  },
};

export const cloudAccounts = {
  async list(tx: Tx): Promise<CloudAccount[]> {
    return (await tx.query(`select ${CLOUD_ACCOUNT_COLUMNS} from cloud_accounts where org_id = $1 order by created_at, id`, [tx.orgId])).map((r) => parse(cloudAccountSchema, r));
  },
  async byId(tx: Tx, id: string): Promise<CloudAccount> {
    return parse(cloudAccountSchema, await tx.one(`select ${CLOUD_ACCOUNT_COLUMNS} from cloud_accounts where org_id = $1 and id = $2`, [tx.orgId, id], "Compte Cloud"));
  },
  async byConnection(tx: Tx, connectionId: string): Promise<CloudAccount | null> {
    const r = await tx.maybeOne(`select ${CLOUD_ACCOUNT_COLUMNS} from cloud_accounts where org_id = $1 and connection_id = $2`, [tx.orgId, connectionId]);
    return r ? parse(cloudAccountSchema, r) : null;
  },
  async create(tx: Tx, input: { connectionId: string; status?: CloudAccount["status"]; settings?: CloudAccount["settings"] }): Promise<CloudAccount> {
    const { columns, values } = objectToColumns({ orgId: tx.orgId, connectionId: input.connectionId, status: input.status ?? "needs_login", settings: input.settings ?? { levels: ["light"] } });
    const placeholders = values.map((_, i) => `$${i + 1}`);
    return parse(cloudAccountSchema, await tx.one(`insert into cloud_accounts (${columns.join(", ")}) values (${placeholders.join(", ")}) returning ${CLOUD_ACCOUNT_COLUMNS}`, values));
  },
  async update(tx: Tx, id: string, patch: Partial<Pick<CloudAccount, "status" | "pausedReason" | "pausedAt" | "lastActionAt" | "warningsCount" | "settings">>): Promise<CloudAccount> {
    const { columns, values } = objectToColumns(patch);
    const sets = [...columns.map((c, i) => `${c} = $${i + 3}`), "updated_at = now()"];
    return parse(cloudAccountSchema, await tx.one(`update cloud_accounts set ${sets.join(", ")} where org_id = $1 and id = $2 returning ${CLOUD_ACCOUNT_COLUMNS}`, [tx.orgId, id, ...values], "Compte Cloud"));
  },
  /** Bloc chiffré de la session (SecretBox, données associées = id du compte), ou null. */
  async session(tx: Tx, id: string): Promise<Buffer | null> {
    const r = await tx.maybeOne<{ sessionCiphertext: Buffer | null }>("select session_ciphertext from cloud_accounts where org_id = $1 and id = $2", [tx.orgId, id]);
    return r?.sessionCiphertext ?? null;
  },
  /** Enregistre une session déjà chiffrée par l'appelant (jamais de clair en base). */
  async setSession(tx: Tx, id: string, ciphertext: Buffer, savedAt: string): Promise<CloudAccount> {
    return parse(cloudAccountSchema, await tx.one(`update cloud_accounts set session_ciphertext = $3, session_saved_at = $4, updated_at = now() where org_id = $1 and id = $2 returning ${CLOUD_ACCOUNT_COLUMNS}`, [tx.orgId, id, ciphertext, savedAt], "Compte Cloud"));
  },
  /** Efface la session (arrêt, suppression demandée, session refusée par Vinted). */
  async clearSession(tx: Tx, id: string): Promise<CloudAccount> {
    return parse(cloudAccountSchema, await tx.one(`update cloud_accounts set session_ciphertext = null, session_saved_at = null, updated_at = now() where org_id = $1 and id = $2 returning ${CLOUD_ACCOUNT_COLUMNS}`, [tx.orgId, id], "Compte Cloud"));
  },
  /**
   * Compte relu SOUS VERROU de ligne (`for update`) : un arrêt ou une suppression de session en cours
   * dans une autre transaction est attendu, puis vu tel qu'il a été validé.
   */
  async lockedById(tx: Tx, id: string): Promise<CloudAccount> {
    return parse(cloudAccountSchema, await tx.one(`select ${CLOUD_ACCOUNT_COLUMNS} from cloud_accounts where org_id = $1 and id = $2 for update`, [tx.orgId, id], "Compte Cloud"));
  },
  /**
   * Remplace la session rendue par une action, seulement si le compte a toujours la MÊME session
   * qu'au début de l'action (date d'enregistrement inchangée), n'est pas arrêté et en a encore une :
   * jamais une session recréée après « Arrêter » ou « Supprimer la session », jamais une session
   * neuve (reconnexion pendant l'action) écrasée par l'ancienne. Vrai si la ligne a été écrite.
   */
  async replaceSessionIf(tx: Tx, id: string, ciphertext: Buffer, savedAt: string, expectedSavedAt: string | null): Promise<boolean> {
    const r = await tx.maybeOne(
      "update cloud_accounts set session_ciphertext = $3, session_saved_at = $4, updated_at = now() where org_id = $1 and id = $2 and session_ciphertext is not null and status <> 'stopped' and session_saved_at is not distinct from $5::timestamptz returning id",
      [tx.orgId, id, ciphertext, savedAt, expectedSavedAt],
    );
    return r !== null;
  },
  /** Efface la session seulement si c'est encore celle de l'action (une session neuve n'est jamais effacée). */
  async clearSessionIf(tx: Tx, id: string, expectedSavedAt: string | null): Promise<boolean> {
    const r = await tx.maybeOne(
      "update cloud_accounts set session_ciphertext = null, session_saved_at = null, updated_at = now() where org_id = $1 and id = $2 and session_ciphertext is not null and session_saved_at is not distinct from $3::timestamptz returning id",
      [tx.orgId, id, expectedSavedAt],
    );
    return r !== null;
  },
  /**
   * Pause après un signal de Vinted, écrite seule et en premier (transaction courte) : elle survit à
   * un échec de l'enregistrement du reste. Un compte arrêté le reste ; le compteur de signaux monte
   * dans tous les cas. Rend le compte à jour.
   */
  async pauseForSignal(tx: Tx, id: string, reason: NonNullable<CloudAccount["pausedReason"]>, at: string): Promise<CloudAccount> {
    return parse(
      cloudAccountSchema,
      await tx.one(
        `update cloud_accounts set status = case when status = 'stopped' then status else 'paused' end, paused_reason = case when status = 'stopped' then paused_reason else $3 end, paused_at = case when status = 'stopped' then paused_at else $4::timestamptz end, warnings_count = warnings_count + 1, last_action_at = $4::timestamptz, updated_at = now() where org_id = $1 and id = $2 returning ${CLOUD_ACCOUNT_COLUMNS}`,
        [tx.orgId, id, reason, at],
        "Compte Cloud",
      ),
    );
  },
  /** Comptes Cloud qui comptent dans la limite par organisation : tous sauf les arrêtés. */
  async countActive(tx: Tx): Promise<number> {
    return tx.count("select count(*) from cloud_accounts where org_id = $1 and status <> 'stopped'", [tx.orgId]);
  },
  /**
   * Verrou applicatif d'un compte (UPDATE conditionnel) : posé seulement si le compte est actif et
   * libre (ou si le verrou date d'avant `staleBefore`, passage interrompu). Null sinon.
   */
  async lock(tx: Tx, id: string, now: string, staleBefore: string): Promise<CloudAccount | null> {
    const r = await tx.maybeOne(`update cloud_accounts set running_since = $3 where org_id = $1 and id = $2 and status = 'active' and (running_since is null or running_since < $4) returning ${CLOUD_ACCOUNT_COLUMNS}`, [tx.orgId, id, now, staleBefore]);
    return r ? parse(cloudAccountSchema, r) : null;
  },
  async unlock(tx: Tx, id: string): Promise<void> {
    await tx.query("update cloud_accounts set running_since = null where org_id = $1 and id = $2", [tx.orgId, id]);
  },
};

export interface CloudJournalFilters extends Partial<CloudJournalQuery> {
  /** Bornes de date (ISO) sur la création de la ligne. */
  from?: string;
  to?: string;
}

function cloudJournalWhere(tx: Tx, q: CloudJournalFilters): { where: string[]; params: unknown[] } {
  const where = ["org_id = $1"];
  const params: unknown[] = [tx.orgId];
  if (q.kind) { params.push(q.kind); where.push(`kind = $${params.length}`); }
  if (q.status) { params.push(q.status); where.push(`status = $${params.length}`); }
  if (q.accountId) { params.push(q.accountId); where.push(`account_id = $${params.length}`); }
  if (q.from) { params.push(q.from); where.push(`created_at >= $${params.length}`); }
  if (q.to) { params.push(q.to); where.push(`created_at < $${params.length}`); }
  return { where, params };
}

/** Journal des actions Cloud (visible du client, conservé 90 jours). `detail` ne porte jamais de secret. */
export const cloudActions = {
  async add(tx: Tx, input: { accountId: string; kind: CloudAction["kind"]; level: CloudAction["level"]; status: CloudAction["status"]; detail?: CloudActionDetail; jobId?: string | null; startedAt?: string | null; finishedAt?: string | null; createdAt?: string }): Promise<CloudAction> {
    return parse(cloudActionSchema, await tx.insert("cloud_actions", { ...input, detail: input.detail ?? {}, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: Partial<Pick<CloudAction, "status" | "detail" | "startedAt" | "finishedAt">>): Promise<CloudAction> {
    const { columns, values } = objectToColumns(patch);
    if (columns.length === 0) return parse(cloudActionSchema, await tx.one("select * from cloud_actions where org_id = $1 and id = $2", [tx.orgId, id], "Action Cloud"));
    const sets = columns.map((c, i) => `${c} = $${i + 3}`);
    return parse(cloudActionSchema, await tx.one(`update cloud_actions set ${sets.join(", ")} where org_id = $1 and id = $2 returning *`, [tx.orgId, id, ...values], "Action Cloud"));
  },
  async byJob(tx: Tx, jobId: string): Promise<CloudAction | null> {
    const r = await tx.maybeOne("select * from cloud_actions where org_id = $1 and job_id = $2 order by created_at desc limit 1", [tx.orgId, jobId]);
    return r ? parse(cloudActionSchema, r) : null;
  },
  /** Retire une ligne « en cours » d'une action qui n'a jamais ouvert de navigateur (tâche remise en file). */
  async remove(tx: Tx, id: string): Promise<void> {
    await tx.query("delete from cloud_actions where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  async list(tx: Tx, q: CloudJournalFilters): Promise<Page<CloudAction>> {
    const { where, params } = cloudJournalWhere(tx, q);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
    const p = Math.max(1, q.page ?? 1);
    const total = await tx.count(`select count(*) from cloud_actions where ${where.join(" and ")}`, params);
    const rows = await tx.query(`select * from cloud_actions where ${where.join(" and ")} order by created_at desc, id limit ${pageSize} offset ${(p - 1) * pageSize}`, params);
    return page(rows.map((r) => parse(cloudActionSchema, r)), total, p, pageSize);
  },
  /** Lignes pour l'export CSV, plafonnées (le journal ne garde que 90 jours). */
  async listAll(tx: Tx, q: CloudJournalFilters, limit = 10_000): Promise<CloudAction[]> {
    const { where, params } = cloudJournalWhere(tx, q);
    params.push(limit);
    return (await tx.query(`select * from cloud_actions where ${where.join(" and ")} order by created_at desc, id limit $${params.length}`, params)).map((r) => parse(cloudActionSchema, r));
  },
  /**
   * Actions qui ont ouvert le navigateur depuis `since` (horloge des services), pour un compte ou
   * pour toute l'organisation : base des plafonds horaire et journalier.
   */
  async countSince(tx: Tx, since: string, accountId?: string): Promise<number> {
    if (accountId) return tx.count("select count(*) from cloud_actions where org_id = $1 and account_id = $2 and started_at >= $3 and status = any($4)", [tx.orgId, accountId, since, CLOUD_STARTED_STATUSES]);
    return tx.count("select count(*) from cloud_actions where org_id = $1 and started_at >= $2 and status = any($3)", [tx.orgId, since, CLOUD_STARTED_STATUSES]);
  },
  /** Rétention : supprime les lignes créées avant `now - days` (90 jours pour le journal Cloud). */
  async purgeOlderThan(tx: Tx, days: number, now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - days * 86_400_000).toISOString();
    return (await tx.query("delete from cloud_actions where org_id = $1 and created_at < $2 returning id", [tx.orgId, before])).length;
  },
};

/** Ligne globale d'une fenêtre de connexion (fonction SECURITY DEFINER, sans ouvrir la table). */
export interface CloudLoginLookup {
  id: string;
  orgId: string;
  accountId: string;
  status: CloudLoginSession["status"];
  expiresAt: string;
  ticketHash: string;
  /** Ticket déjà consommé par une WebSocket (null : jamais utilisé). */
  attachedAt: string | null;
}

/** Fenêtres de connexion : le ticket n'est stocké qu'haché (SHA-256). */
export const cloudLoginSessions = {
  async create(tx: Tx, input: { accountId: string; ticketHash: string; expiresAt: string }): Promise<CloudLoginSession> {
    return parse(cloudLoginSessionSchema, await tx.insert("cloud_login_sessions", { ...input, status: "open", orgId: tx.orgId }));
  },
  async byId(tx: Tx, id: string): Promise<CloudLoginSession | null> {
    const r = await tx.maybeOne("select * from cloud_login_sessions where org_id = $1 and id = $2", [tx.orgId, id]);
    return r ? parse(cloudLoginSessionSchema, r) : null;
  },
  /** Recherche globale par identifiant (worker qui ferme la fenêtre). */
  async findGlobal(tx: Tx, id: string): Promise<CloudLoginLookup | null> {
    return tx.maybeOne<CloudLoginLookup>("select * from app_find_cloud_login_session($1, null)", [id]);
  },
  /** Recherche globale par empreinte de ticket (connexion de la fenêtre côté API). */
  async byTicketHash(tx: Tx, ticketHash: string): Promise<CloudLoginLookup | null> {
    return tx.maybeOne<CloudLoginLookup>("select * from app_find_cloud_login_session(null, $1)", [ticketHash]);
  },
  /** Ferme une fenêtre encore ouverte (UPDATE conditionnel) ; null si elle ne l'était plus. */
  async close(tx: Tx, id: string, status: Exclude<CloudLoginSession["status"], "open">): Promise<CloudLoginSession | null> {
    const r = await tx.maybeOne("update cloud_login_sessions set status = $3, updated_at = now() where org_id = $1 and id = $2 and status = 'open' returning *", [tx.orgId, id, status]);
    return r ? parse(cloudLoginSessionSchema, r) : null;
  },
  /** Ferme toutes les fenêtres ouvertes d'un compte (nouvelle fenêtre, arrêt du Cloud). */
  async closeOpenForAccount(tx: Tx, accountId: string, status: Exclude<CloudLoginSession["status"], "open">): Promise<number> {
    return (await tx.query("update cloud_login_sessions set status = $3, updated_at = now() where org_id = $1 and account_id = $2 and status = 'open' returning id", [tx.orgId, accountId, status])).length;
  },
  /**
   * Consomme le ticket (première WebSocket) : UPDATE conditionnel, une seule fois, fenêtre ouverte
   * et non expirée. Faux si le ticket a déjà servi : toute seconde connexion est refusée.
   */
  async attach(tx: Tx, id: string, now: string): Promise<boolean> {
    const r = await tx.maybeOne("update cloud_login_sessions set attached_at = $3, updated_at = now() where org_id = $1 and id = $2 and status = 'open' and attached_at is null and expires_at > $3 returning id", [tx.orgId, id, now]);
    return r !== null;
  },
  /** Fenêtres encore ouvertes et non expirées de l'organisation (limite par organisation). */
  async countOpen(tx: Tx, now: string): Promise<number> {
    return tx.count("select count(*) from cloud_login_sessions where org_id = $1 and status = 'open' and expires_at > $2", [tx.orgId, now]);
  },
  /** Fenêtres ouvertes dont l'échéance est passée à l'instant `now` → « expired ». */
  async expireStale(tx: Tx, now: string): Promise<number> {
    return (await tx.query("update cloud_login_sessions set status = 'expired', updated_at = now() where org_id = $1 and status = 'open' and expires_at <= $2 returning id", [tx.orgId, now])).length;
  },
};

/**
 * Coupe-circuit de la machine (table `cloud_runtime`, une ligne, sans donnée d'organisation) : après
 * un « trop de requêtes » ou un blocage de Vinted, plus aucune action Cloud jusqu'à `suspendedUntil`.
 */
export const cloudRuntime = {
  async get(tx: Tx): Promise<{ suspendedUntil: string | null; reason: "rate_limited" | "blocked" | null }> {
    const r = await tx.maybeOne<{ suspendedUntil: string | Date | null; reason: "rate_limited" | "blocked" | null }>("select suspended_until, reason from cloud_runtime where id = 1");
    const until = r?.suspendedUntil ?? null;
    return { suspendedUntil: until === null ? null : new Date(until).toISOString(), reason: r?.reason ?? null };
  },
  /** Prolonge la suspension jusqu'à `until` (jamais raccourcie par un signal plus ancien). */
  async suspend(tx: Tx, until: string, reason: "rate_limited" | "blocked"): Promise<void> {
    await tx.query(
      "update cloud_runtime set suspended_until = greatest(coalesce(suspended_until, $1::timestamptz), $1::timestamptz), reason = $2, updated_at = now() where id = 1",
      [until, reason],
    );
  },
  async clear(tx: Tx): Promise<void> {
    await tx.query("update cloud_runtime set suspended_until = null, reason = null, updated_at = now() where id = 1");
  },
};

export const cloudOrgs = {
  /** Organisations ayant au moins un compte Cloud (fonction SECURITY DEFINER) : worker uniquement. */
  async ids(tx: Tx): Promise<string[]> {
    return (await tx.query<{ orgId: string }>("select org_id from app_cloud_org_ids()")).map((r) => r.orgId);
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

/** Ligne brute de la vue administrateur de l'utilisation (fonction SQL security definer, migration 0006). */
export interface AdminOrgUsageRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  /** JSON `quotas` de l'abonnement tel qu'en base (anciens abonnements : champs par filiale absents). */
  quotas: Record<string, unknown>;
  createdAt: string;
  members: number;
  items: number;
  connections: number;
  /** Totaux du mois par type d'événement (`ai.request`, `studio.listing`…). */
  monthUsage: Record<string, number>;
  /** Actions Cloud du jour (UTC). */
  cloudToday: number;
  /**
   * Requêtes IA du mois décomptées du quota (table `ai_requests`, échecs compris, questions d'aide
   * exclues) : la même source que le refus à la 501e requête, pas seulement les succès.
   */
  aiRequestsMonth: number;
  /** Réglage `settings.ai` de l'organisation tel qu'en base (quota mensuel propre, `monthlyRequestQuota`). */
  aiSettings: Record<string, unknown>;
}

export const admin = {
  async orgSummary(tx: Tx) {
    return tx.query<{ id: string; name: string; plan: string; members: number; items: number; createdAt: string }>("select * from app_admin_org_summary()");
  },
  /** Utilisation par organisation depuis `monthStart` (compteurs mensuels) et `dayStart` (actions Cloud du jour). */
  async orgUsage(tx: Tx, monthStart: string, dayStart: string): Promise<AdminOrgUsageRow[]> {
    const rows = await tx.query<AdminOrgUsageRow>("select * from app_admin_org_usage($1, $2)", [monthStart, dayStart]);
    return rows.map((r) => ({
      ...r,
      members: Number(r.members),
      items: Number(r.items),
      connections: Number(r.connections),
      cloudToday: Number(r.cloudToday ?? 0),
      aiRequestsMonth: Number(r.aiRequestsMonth ?? 0),
      quotas: r.quotas && typeof r.quotas === "object" ? r.quotas : {},
      aiSettings: r.aiSettings && typeof r.aiSettings === "object" ? r.aiSettings : {},
      monthUsage: Object.fromEntries(Object.entries(r.monthUsage ?? {}).map(([k, v]) => [k, Number(v)])),
    }));
  },
};
