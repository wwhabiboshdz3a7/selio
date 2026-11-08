import {
  priceModelRecord as priceModelRecordSchema, priceReference as priceReferenceSchema, trackFilter as trackFilterSchema, trackPhotoSearch as trackPhotoSearchSchema, trackScan as trackScanSchema, trackSnapshot as trackSnapshotSchema,
  type ItemCategory, type PriceModelMetrics, type PriceModelRecord, type PriceReference, type PriceReferenceInput, type PriceReferenceSource, type TrackCriteria, type TrackFilter, type TrackPhotoSearch, type TrackScan, type TrackSnapshot, type TrackSource,
  referral as referralSchema, subscriptionCredit as subscriptionCreditSchema, type Referral, type ReferralStatus, type SubscriptionCredit,
  aiRequest, auditLog, cloudAccount as cloudAccountSchema, cloudAction as cloudActionSchema, cloudConsent as cloudConsentSchema, cloudLoginSession as cloudLoginSessionSchema, automationRule, conversation as conversationSchema, customer as customerSchema, extensionToken, inventoryEvent, inventoryItem, invoice as invoiceSchema, job as jobSchema, marketplaceConnection, membership as membershipSchema, message as messageSchema, opportunity as opportunitySchema, order as orderSchema, organization as organizationSchema, paymentOrder as paymentOrderSchema, purchaseRequest as purchaseSchema, radarSearch as radarSchema, radarRead as radarReadSchema, radarAlert as radarAlertSchema, pushSubscription as pushSubscriptionSchema, RADAR_BLOCK_OUTCOMES, shipment as shipmentSchema, subscription as subscriptionSchema, usageEvent, user as userSchema, quotasForPlan, isLegacyQuotas, resolveQuotas,
  type AiRequest, type AuditLog, type AutomationRule, type CloudAccount, type CloudAction, type CloudActionDetail, type CloudConsent, type CloudJournalQuery, type CloudLoginSession, type Conversation, type ConversationQuery, type Customer, type CustomerQuery, type ExtensionToken, type InventoryEvent, type InventoryItem, type InventoryQuery, type Invoice, type Job, type JobQuery, type MarketplaceConnection, type Membership, type Message, type Opportunity, type Order, type OrderQuery, type Organization, type Page, type PaymentOrder, type PurchaseRequest, type RadarSearch, type RadarRead, type RadarReadOutcome, type RadarSourceKind, type RadarAlert, type RadarAlertKind, type RadarAlertPayload, type PushSubscription, type Shipment, type Subscription, type UsageEvent, type User,
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

// ---------------------------------------------------------------- parrainage (0016)
/**
 * Codes de parrainage : un par organisation (table globale, cherchée à l'inscription avant de connaître
 * la marraine). `create` rend null en cas de collision (code déjà pris ou organisation déjà pourvue) :
 * le service relit ou retire un autre code.
 */
export const referralCodes = {
  async byOrg(tx: Tx, orgId: string): Promise<string | null> {
    return (await tx.maybeOne<{ code: string }>("select code from referral_codes where org_id = $1", [orgId]))?.code ?? null;
  },
  async byCode(tx: Tx, code: string): Promise<{ orgId: string; code: string } | null> {
    return tx.maybeOne<{ orgId: string; code: string }>("select org_id, code from referral_codes where code = $1", [code]);
  },
  async create(tx: Tx, orgId: string, code: string): Promise<string | null> {
    const r = await tx.maybeOne<{ code: string }>("insert into referral_codes (org_id, code) values ($1, $2) on conflict do nothing returning code", [orgId, code]);
    return r?.code ?? null;
  },
};

/** Liens marraine → filleule (table globale ; transitions conditionnelles, donc idempotentes). */
export const referrals = {
  /** Lien « en attente » ; null si la filleule est déjà parrainée (une seule fois). */
  async create(tx: Tx, input: { code: string; referrerOrgId: string; referredOrgId: string }): Promise<Referral | null> {
    const r = await tx.maybeOne("insert into referrals (code, referrer_org_id, referred_org_id) values ($1, $2, $3) on conflict (referred_org_id) do nothing returning *", [input.code, input.referrerOrgId, input.referredOrgId]);
    return r ? parse(referralSchema, r) : null;
  },
  async byId(tx: Tx, id: string): Promise<Referral | null> {
    const r = await tx.maybeOne("select * from referrals where id = $1", [id]);
    return r ? parse(referralSchema, r) : null;
  },
  async byReferred(tx: Tx, referredOrgId: string): Promise<Referral | null> {
    const r = await tx.maybeOne("select * from referrals where referred_org_id = $1", [referredOrgId]);
    return r ? parse(referralSchema, r) : null;
  },
  /** Filleules d'une marraine par état (compteurs seulement : rien sur les organisations filleules). */
  async countByStatus(tx: Tx, referrerOrgId: string): Promise<Record<ReferralStatus, number>> {
    const rows = await tx.query<{ status: ReferralStatus; n: number }>("select status, count(*)::int as n from referrals where referrer_org_id = $1 group by status", [referrerOrgId]);
    const out: Record<ReferralStatus, number> = { pending: 0, qualified: 0, credited: 0, refused: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  },
  /** pending → qualified, une seule fois : null si le lien n'était plus en attente. */
  async markQualified(tx: Tx, id: string, at: string): Promise<Referral | null> {
    const r = await tx.maybeOne("update referrals set status = 'qualified', qualified_at = $2 where id = $1 and status = 'pending' returning *", [id, at]);
    return r ? parse(referralSchema, r) : null;
  },
  /** pending → refused (contrôle d'auto-parrainage ou plafond au premier paiement) : null si plus en attente. */
  async markRefused(tx: Tx, id: string, at: string, reason: NonNullable<Referral["refusedReason"]>): Promise<Referral | null> {
    const r = await tx.maybeOne("update referrals set status = 'refused', refused_at = $2, refused_reason = $3 where id = $1 and status = 'pending' returning *", [id, at, reason]);
    return r ? parse(referralSchema, r) : null;
  },
  /** Filleules qualifiées (crédits accordés) d'une marraine depuis `since` : sert au plafond par marraine. */
  async countQualifiedSince(tx: Tx, referrerOrgId: string, since: string): Promise<number> {
    return tx.count("select count(*) from referrals where referrer_org_id = $1 and status in ('qualified', 'credited') and qualified_at >= $2", [referrerOrgId, since]);
  },
  /** qualified → credited quand les deux crédits sont consommés (fonction SQL bornée : crédits sous RLS). */
  async settle(tx: Tx, id: string, at: string): Promise<ReferralStatus | null> {
    const r = await tx.maybeOne<{ status: ReferralStatus | null }>("select app_referral_settle($1, $2) as status", [id, at]);
    return r?.status ?? null;
  },
};

/**
 * Mois offerts (table d'organisation sous RLS : app.org_id doit valoir `orgId`). Un crédit par organisation
 * et par parrainage (index unique) : accorder deux fois ne crée rien.
 */
export const subscriptionCredits = {
  async grant(tx: Tx, input: { orgId: string; kind: SubscriptionCredit["kind"]; months: number; sourceReferralId: string | null }): Promise<SubscriptionCredit | null> {
    const r = await tx.maybeOne("insert into subscription_credits (org_id, kind, months, source_referral_id) values ($1, $2, $3, $4) on conflict do nothing returning *", [input.orgId, input.kind, input.months, input.sourceReferralId]);
    return r ? parse(subscriptionCreditSchema, r) : null;
  },
  /** Plus ancien crédit disponible, verrouillé pour la transaction (deux renouvellements concurrents n'en consomment qu'un). */
  async takeAvailable(tx: Tx, orgId: string): Promise<SubscriptionCredit | null> {
    const r = await tx.maybeOne("select * from subscription_credits where org_id = $1 and consumed_at is null order by created_at, id limit 1 for update skip locked", [orgId]);
    return r ? parse(subscriptionCreditSchema, r) : null;
  },
  /** Consommation conditionnelle : null si le crédit l'était déjà. */
  async consume(tx: Tx, id: string, invoiceId: string, at: string): Promise<SubscriptionCredit | null> {
    const r = await tx.maybeOne("update subscription_credits set consumed_at = $3, invoice_id = $2 where id = $1 and consumed_at is null returning *", [id, invoiceId, at]);
    return r ? parse(subscriptionCreditSchema, r) : null;
  },
  async list(tx: Tx, orgId: string): Promise<SubscriptionCredit[]> {
    return (await tx.query("select * from subscription_credits where org_id = $1 order by created_at, id", [orgId])).map((r) => parse(subscriptionCreditSchema, r));
  },
  async countAvailable(tx: Tx, orgId: string): Promise<number> {
    return tx.count("select count(*) from subscription_credits where org_id = $1 and consumed_at is null", [orgId]);
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
  /** Tâches encore en cours (en file, en exécution ou à valider) de ces règles pour une conversation. */
  async pendingForConversation(tx: Tx, ruleIds: readonly string[], conversationId: string): Promise<number> {
    if (ruleIds.length === 0) return 0;
    return tx.count("select count(*) from jobs where org_id = $1 and rule_id = any($2::text[]) and payload->>'conversationId' = $3 and status in ('queued', 'running', 'awaiting_approval')", [tx.orgId, [...ruleIds], conversationId]);
  },
  /**
   * Tâches de ces règles pour une conversation créées depuis `since` (null : depuis toujours), QUEL QUE
   * SOIT leur statut (annulée, échouée, réussie, en cours) : une relance refusée, supprimée ou au résultat
   * incertain compte comme faite (jamais une deuxième relance sans réponse de l'acheteur).
   */
  async countForConversationSince(tx: Tx, ruleIds: readonly string[], conversationId: string, since: string | null): Promise<number> {
    if (ruleIds.length === 0) return 0;
    if (since === null) return tx.count("select count(*) from jobs where org_id = $1 and rule_id = any($2::text[]) and payload->>'conversationId' = $3", [tx.orgId, [...ruleIds], conversationId]);
    return tx.count("select count(*) from jobs where org_id = $1 and rule_id = any($2::text[]) and payload->>'conversationId' = $3 and created_at >= $4", [tx.orgId, [...ruleIds], conversationId, since]);
  },
  /** Contre-offres encore à envoyer (en file, en cours ou à valider) pour une conversation. */
  async pendingCounterOffers(tx: Tx, conversationId: string, excludeJobId?: string): Promise<number> {
    return tx.count("select count(*) from jobs where org_id = $1 and kind = 'automation.send_message' and payload->>'conversationId' = $2 and payload->>'decision' = 'counter' and status in ('queued', 'running', 'awaiting_approval') and id <> $3", [tx.orgId, conversationId, excludeJobId ?? ""]);
  },
  /** Relances encore à envoyer (en file ou à valider) d'une conversation : l'acheteur vient de répondre. */
  async pendingFollowUps(tx: Tx, conversationId: string): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and payload->>'conversationId' = $2 and payload->>'followUp' = 'true' and status in ('queued', 'awaiting_approval')", [tx.orgId, conversationId])).map((r) => parse(jobSchema, r));
  },
  /** Transmissions au vendeur encore ouvertes (situation, IA) d'une conversation. */
  async openHandoffs(tx: Tx, conversationId: string): Promise<Job[]> {
    return (await tx.query("select * from jobs where org_id = $1 and payload->>'conversationId' = $2 and payload->>'handoff' = 'true' and status = 'awaiting_approval'", [tx.orgId, conversationId])).map((r) => parse(jobSchema, r));
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
  /** Recherches prioritaires (Radar Auto) de l'organisation, hors `excludeId` : 3 au plus. */
  async countPriority(tx: Tx, excludeId: string | null = null): Promise<number> {
    return tx.count("select count(*) from radar_searches where org_id = $1 and priority and id is distinct from $2", [tx.orgId, excludeId]);
  },
  /**
   * Mesures d'une lecture, écrites d'un bloc (compteurs incrémentés en SQL, jamais relus puis
   * réécrits) : dernière lecture, pages lues en direct, blocages, facteur de ralentissement.
   */
  async recordRead(tx: Tx, id: string, input: { readAt: string; livePages: number; blocked: boolean; slowdownFactor: number; anomaly?: boolean | null }): Promise<RadarSearch> {
    // `anomaly` : vrai → une lecture anormale de plus ; faux → compteur remis à zéro ; null → inchangé.
    const anomaly = input.anomaly === true ? 1 : input.anomaly === false ? 0 : -1;
    return parse(
      radarSchema,
      await tx.one(
        "update radar_searches set last_run_at = $3, last_read_at = $3, pages_read = pages_read + $4, blocks_count = blocks_count + $5, last_block_at = case when $5 > 0 then $3::timestamptz else last_block_at end, slowdown_factor = $6, consecutive_failures = case when $7 = 1 then consecutive_failures + 1 when $7 = 0 then 0 else consecutive_failures end, updated_at = now() where org_id = $1 and id = $2 returning *",
        [tx.orgId, id, input.readAt, Math.max(0, input.livePages), input.blocked ? 1 : 0, Math.max(1, Math.min(64, Math.round(input.slowdownFactor))), anomaly],
        "Recherche",
      ),
    );
  },
  /**
   * Arrêt de la lecture en direct décidé par Selio (lectures anormales consécutives) : recherche
   * désactivée avec la raison. Le client la réactive lui-même après vérification.
   */
  async suspend(tx: Tx, id: string, reason: string): Promise<RadarSearch> {
    return parse(radarSchema, await tx.one("update radar_searches set enabled = false, suspended_reason = $3, updated_at = now() where org_id = $1 and id = $2 returning *", [tx.orgId, id, reason.slice(0, 300)], "Recherche"));
  },
};

/**
 * Ralentissement de Selio Radar par organisation : un facteur pour toutes les recherches en direct
 * (même adresse, mêmes comptes Achat), gardé hors des recherches (une recherche supprimée puis
 * recréée ne repart pas à ×1).
 */
export const radarOrgState = {
  async get(tx: Tx): Promise<{ slowdownFactor: number; lastBlockAt: string | null }> {
    const r = await tx.maybeOne<{ slowdownFactor: number; lastBlockAt: Date | string | null }>("select slowdown_factor, last_block_at from radar_org_state where org_id = $1", [tx.orgId]);
    const at = r?.lastBlockAt ?? null;
    return { slowdownFactor: Number(r?.slowdownFactor ?? 1), lastBlockAt: at === null ? null : new Date(at).toISOString() };
  },
  /** Fixe le facteur (borné à 1 – 64) et, si `blockAt` est donné, la date du dernier blocage. */
  async set(tx: Tx, input: { slowdownFactor: number; blockAt?: string | null }): Promise<void> {
    const f = Math.max(1, Math.min(64, Math.round(input.slowdownFactor)));
    await tx.query(
      "insert into radar_org_state (org_id, slowdown_factor, last_block_at, updated_at) values ($1, $2, $3, now()) on conflict (org_id) do update set slowdown_factor = excluded.slowdown_factor, last_block_at = coalesce(excluded.last_block_at, radar_org_state.last_block_at), updated_at = now()",
      [tx.orgId, f, input.blockAt ?? null],
    );
  },
};

/** Raison de la note qui remplace, à la purge, un ancien texte citant la note du vendeur. */
export const SELLER_REASON_PURGED = "Fiabilité du vendeur : détail effacé après 30 jours.";

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
  /**
   * Crée l'affaire sauf si la même annonce Vinted (référence) existe déjà pour l'organisation
   * (`insert … on conflict do nothing`) : deux lectures simultanées ne créent jamais deux affaires et
   * n'interrompent pas la transaction. Null si elle existait.
   */
  async createIfAbsent(tx: Tx, input: Partial<Opportunity>): Promise<Opportunity | null> {
    const { columns, values } = objectToColumns({ ...input, orgId: tx.orgId });
    const r = await tx.maybeOne(`insert into opportunities (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing returning *`, values);
    return r ? parse(opportunitySchema, r) : null;
  },
  /** Une annonce Vinted (référence numérique) ne donne qu'une affaire par organisation. */
  async byExternalRef(tx: Tx, externalRef: string): Promise<Opportunity | null> {
    const r = await tx.maybeOne("select * from opportunities where org_id = $1 and observed->>'externalRef' = $2 limit 1", [tx.orgId, externalRef]);
    return r ? parse(opportunitySchema, r) : null;
  },
  /**
   * Délais publication → détection des affaires lues EN DIRECT (source « connector ») créées depuis
   * `since`, hors stock initial, dont la date de publication est absolue ou à la minute près (date
   * relative de moins d'une heure : « il y a 3 min », jamais « il y a 2 h » ni « il y a 3 j »).
   */
  async detectionDelays(tx: Tx, since: string): Promise<{ publishedAt: string; detectedAt: string }[]> {
    return tx.query<{ publishedAt: string; detectedAt: string }>(
      `select observed->>'publishedAt' as published_at, observed->>'detectedAt' as detected_at from opportunities
       where org_id = $1 and created_at >= $2 and observed->>'source' = 'connector' and observed->>'publishedAt' is not null and observed->>'detectedAt' is not null
         and coalesce(observed->>'initialStock', 'false') <> 'true'
         and (observed->>'publishedAtSource' = 'absolute'
              or (observed->>'publishedAtSource' = 'relative' and (observed->>'detectedAt')::timestamptz - (observed->>'publishedAt')::timestamptz < interval '1 hour'))`,
      [tx.orgId, since],
    );
  },
  /**
   * Données du vendeur gardées le temps de l'affaire seulement : les affaires écartées depuis plus de
   * `days` jours sont supprimées (alertes comprises) ; les autres perdent pseudo, note, nombre d'avis,
   * photo et adresse de l'annonce (qui mène au vendeur), et toute raison de la note qui citerait la
   * note du vendeur (affaires d'avant le texte générique) est remplacée.
   */
  async purgeSellerData(tx: Tx, days: number, now: Date): Promise<{ deleted: number; stripped: number }> {
    const before = new Date(now.getTime() - days * 86_400_000).toISOString();
    const deleted = (await tx.query("delete from opportunities where org_id = $1 and status = 'dismissed' and updated_at < $2 returning id", [tx.orgId, before])).length;
    const stripped = (
      await tx.query(
        `update opportunities set
           observed = observed || jsonb_build_object('sellerHandle', null, 'sellerRating', null, 'sellerReviews', null, 'photoUrl', null, 'url', null),
           reasons = coalesce((select jsonb_agg(case when r.value like 'Vendeur noté%' then to_jsonb($3::text) else to_jsonb(r.value) end order by r.ordinality) from jsonb_array_elements_text(reasons) with ordinality as r(value, ordinality)), '[]'::jsonb),
           updated_at = now()
         where org_id = $1 and created_at < $2
           and (observed->>'sellerHandle' is not null or observed->>'photoUrl' is not null or observed->>'sellerRating' is not null
                or observed->>'sellerReviews' is not null or observed->>'url' is not null or reasons::text like '%Vendeur noté%')
         returning id`,
        [tx.orgId, before, SELLER_REASON_PURGED],
      )
    ).length;
    return { deleted, stripped };
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
  /**
   * Montant engagé par Radar Auto depuis `since` (horloge des services) : achats automatiques faits
   * (réels ou simulés), en attente de validation 3-D Secure, réservés par un achat en cours, et toute
   * demande dont « Payer » a été cliqué même si elle a fini bloquée ou annulée (issue incertaine : le
   * paiement a pu partir). Total relu s'il est connu, sinon le maximum accepté. Les achats faits à la
   * main par le client ne comptent pas dans le plafond de Radar Auto.
   */
  async spentSince(tx: Tx, since: string, excludeId: string | null = null): Promise<number> {
    const row = await tx.maybeOne<{ total: number | string | null }>(
      `select coalesce(sum(coalesce(total_cents, max_price_cents)), 0) as total from purchase_requests
       where org_id = $1 and id is distinct from $2 and mode = 'auto'
         and (status in ('simulated', 'executed', 'awaiting_3ds', 'draft') or (payment_attempted and status in ('blocked', 'cancelled')))
         and coalesce(executed_at, confirmed_at, created_at) >= $3`,
      [tx.orgId, excludeId, since],
    );
    return Number(row?.total ?? 0);
  },
  /** Retire une réservation d'achat automatique qui n'a lancé aucun navigateur (rien n'a touché Vinted). */
  async deleteDraft(tx: Tx, id: string): Promise<boolean> {
    return (await tx.query("delete from purchase_requests where org_id = $1 and id = $2 and status = 'draft' returning id", [tx.orgId, id])).length > 0;
  },
  /** Achats qui attendent la validation 3-D Secure du client (un seul achat à la fois par organisation). */
  async awaiting3dsCount(tx: Tx): Promise<number> {
    return tx.count("select count(*) from purchase_requests where org_id = $1 and status = 'awaiting_3ds'", [tx.orgId]);
  },
  /** Demandes en attente de validation 3-D Secure dont le délai est passé à l'instant `now`. */
  async awaiting3dsExpired(tx: Tx, now: string): Promise<PurchaseRequest[]> {
    return (await tx.query("select * from purchase_requests where org_id = $1 and status = 'awaiting_3ds' and awaiting3ds_until <= $2 order by awaiting3ds_until", [tx.orgId, now])).map((r) => parse(purchaseSchema, r));
  },
  /** Délais détection → achat des achats RÉELS exécutés depuis `since`. */
  async detectToPurchaseDelays(tx: Tx, since: string): Promise<{ detectedAt: string; executedAt: string }[]> {
    return tx.query<{ detectedAt: string; executedAt: string }>(
      "select o.observed->>'detectedAt' as detected_at, p.executed_at from purchase_requests p join opportunities o on o.id = p.opportunity_id and o.org_id = p.org_id where p.org_id = $1 and p.status = 'executed' and p.real_purchase_enabled and p.executed_at >= $2 and o.observed->>'detectedAt' is not null",
      [tx.orgId, since],
    );
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
  /**
   * Enregistre un événement ; rend son identifiant (réservation d'une place de quota, retirée en cas
   * d'échec). `at` : date de l'événement (horloge du service), sinon l'heure de la base.
   */
  async record(tx: Tx, kind: UsageEvent["kind"], meta: Record<string, unknown> = {}, quantity = 1, at?: string): Promise<string> {
    const row = await tx.insert<{ id: string }>("usage_events", { orgId: tx.orgId, kind, quantity, meta, ...(at ? { createdAt: at } : {}) });
    return String(row.id);
  },
  /** Retire un événement de l'organisation (place de quota réservée puis rendue après un échec). */
  async remove(tx: Tx, id: string): Promise<boolean> {
    return (await tx.query("delete from usage_events where org_id = $1 and id = $2 returning id", [tx.orgId, id])).length > 0;
  },
  /**
   * Verrou de transaction propre à l'organisation et à un compteur : deux contrôles de quota simultanés
   * de la même organisation passent l'un après l'autre (le second voit la réservation du premier).
   */
  async lock(tx: Tx, scope: string): Promise<void> {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`${tx.orgId}:${scope}`]);
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
    // Un compte tenu par un achat Radar Auto en attente de validation 3-D Secure (`held_until` futur)
    // n'est jamais verrouillé : ni lecture, ni action Cloud, ni second achat avec la même session.
    const r = await tx.maybeOne(`update cloud_accounts set running_since = $3 where org_id = $1 and id = $2 and status = 'active' and (running_since is null or running_since < $4) and (held_until is null or held_until <= $3::timestamptz) returning ${CLOUD_ACCOUNT_COLUMNS}`, [tx.orgId, id, now, staleBefore]);
    return r ? parse(cloudAccountSchema, r) : null;
  },
  async unlock(tx: Tx, id: string): Promise<void> {
    await tx.query("update cloud_accounts set running_since = null where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  /** Compte tenu par un achat qui attend la banque, jusqu'à `until` (ou jusqu'à `release`). */
  async hold(tx: Tx, id: string, until: string): Promise<void> {
    await tx.query("update cloud_accounts set held_until = $3 where org_id = $1 and id = $2", [tx.orgId, id, until]);
  },
  async release(tx: Tx, id: string): Promise<void> {
    await tx.query("update cloud_accounts set held_until = null where org_id = $1 and id = $2", [tx.orgId, id]);
  },
  /** Fin de la tenue du compte par un achat en attente de la banque (null : libre). */
  async heldUntil(tx: Tx, id: string): Promise<string | null> {
    const r = await tx.maybeOne<{ heldUntil: Date | string | null }>("select held_until from cloud_accounts where org_id = $1 and id = $2", [tx.orgId, id]);
    return r?.heldUntil ? new Date(r.heldUntil).toISOString() : null;
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

// ---------------------------------------------------------------- Selio Radar (0012)

const RADAR_BLOCKS_SQL = `outcome in (${RADAR_BLOCK_OUTCOMES.map((o) => `'${o}'`).join(", ")})`;

/** Mesures de chaque lecture (90 jours) : taux de blocage, ralentissement, plafond de pages par minute. */
export const radarReads = {
  async add(tx: Tx, input: { searchId: string | null; connectionId: string | null; source: RadarSourceKind; readAt: string; durationMs: number; outcome: RadarReadOutcome; itemsSeen: number; itemsNew: number; factor: number; kind?: "search" | "purchase"; pages?: number }): Promise<RadarRead> {
    return parse(radarReadSchema, await tx.insert("radar_reads", { ...input, kind: input.kind ?? "search", pages: Math.max(0, Math.round(input.pages ?? 1)), durationMs: Math.max(0, Math.round(input.durationMs)), orgId: tx.orgId }));
  },
  /** Annonces nouvelles d'une lecture, écrites après leur traitement (la mesure est enregistrée avant). */
  async setItemsNew(tx: Tx, id: string, itemsNew: number): Promise<void> {
    await tx.query("update radar_reads set items_new = $3 where org_id = $1 and id = $2", [tx.orgId, id, Math.max(0, Math.round(itemsNew))]);
  },
  /** Pages lues EN DIRECT par l'organisation depuis `since`, achats compris (le simulateur ne compte jamais). */
  async countLiveSince(tx: Tx, since: string): Promise<number> {
    return tx.count("select coalesce(sum(pages), 0) as count from radar_reads where org_id = $1 and source = 'cloud' and read_at >= $2", [tx.orgId, since]);
  },
  /** Fenêtre glissante : pages et blocages parmi les `limit` dernières mesures en direct de l'organisation. */
  async liveWindow(tx: Tx, limit: number): Promise<{ reads: number; blocks: number }> {
    const r = await tx.maybeOne<{ reads: number | string | null; blocks: number | string }>(
      `select coalesce(sum(pages), 0) as reads, count(*) filter (where ${RADAR_BLOCKS_SQL}) as blocks from (select outcome, pages from radar_reads where org_id = $1 and source = 'cloud' order by read_at desc, id desc limit $2) w`,
      [tx.orgId, Math.max(1, limit)],
    );
    return { reads: Number(r?.reads ?? 0), blocks: Number(r?.blocks ?? 0) };
  },
  /** Pages lues et blocages en direct par jour (UTC) depuis `since`, achats compris. */
  async dailyLive(tx: Tx, since: string): Promise<{ day: string; reads: number; blocks: number }[]> {
    const rows = await tx.query<{ day: string; reads: number | string; blocks: number | string }>(
      `select to_char(date_trunc('day', read_at at time zone 'UTC'), 'YYYY-MM-DD') as day, coalesce(sum(pages), 0) as reads, count(*) filter (where ${RADAR_BLOCKS_SQL}) as blocks from radar_reads where org_id = $1 and source = 'cloud' and read_at >= $2 group by 1 order by 1`,
      [tx.orgId, since],
    );
    return rows.map((r) => ({ day: r.day, reads: Number(r.reads), blocks: Number(r.blocks) }));
  },
  async list(tx: Tx, q: { searchId?: string; limit?: number } = {}): Promise<RadarRead[]> {
    const params: unknown[] = [tx.orgId];
    const where = ["org_id = $1"];
    if (q.searchId) { params.push(q.searchId); where.push(`search_id = $${params.length}`); }
    params.push(Math.min(1000, Math.max(1, q.limit ?? 100)));
    return (await tx.query(`select * from radar_reads where ${where.join(" and ")} order by read_at desc, id desc limit $${params.length}`, params)).map((r) => parse(radarReadSchema, r));
  },
  /** Rétention : mesures gardées 90 jours. */
  async purgeOlderThan(tx: Tx, days: number, now: Date): Promise<number> {
    const before = new Date(now.getTime() - days * 86_400_000).toISOString();
    return (await tx.query("delete from radar_reads where org_id = $1 and read_at < $2 returning id", [tx.orgId, before])).length;
  },
};

/** Abonnements Web Push (PWA). Les clés ne sortent du serveur que vers le service de notification. */
export const pushSubscriptions = {
  /**
   * Enregistre (ou rafraîchit) l'abonnement d'un appareil. L'adresse est unique : un appareil abonné
   * pour une autre organisation y est d'abord retiré (fonction limitée), puis réabonné ici.
   */
  async upsert(tx: Tx, input: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }): Promise<PushSubscription> {
    await tx.query("select app_push_endpoint_release($1, $2)", [input.endpoint, tx.orgId]);
    return parse(
      pushSubscriptionSchema,
      await tx.one(
        "insert into push_subscriptions (org_id, user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5, $6) on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0, disabled_at = null returning *",
        [tx.orgId, input.userId, input.endpoint, input.p256dh, input.auth, input.userAgent ? input.userAgent.slice(0, 120) : null],
      ),
    );
  },
  async list(tx: Tx): Promise<PushSubscription[]> {
    return (await tx.query("select * from push_subscriptions where org_id = $1 order by created_at", [tx.orgId])).map((r) => parse(pushSubscriptionSchema, r));
  },
  /**
   * Abonnements actifs (non désactivés), d'un utilisateur ou de toute l'organisation, des seuls MEMBRES
   * ACTUELS de l'organisation (un ancien membre ne reçoit plus rien, même si son abonnement traîne),
   * avec leur rôle (l'appelant vérifie le droit de voir Radar).
   */
  async listActive(tx: Tx, userId: string | null = null): Promise<(PushSubscription & { role: Membership["role"] })[]> {
    const rows = await tx.query<Record<string, unknown>>(
      "select p.*, m.role as member_role from push_subscriptions p join memberships m on m.org_id = p.org_id and m.user_id = p.user_id where p.org_id = $1 and p.disabled_at is null and ($2::text is null or p.user_id = $2) order by p.created_at",
      [tx.orgId, userId],
    );
    return rows.map((r) => ({ ...parse(pushSubscriptionSchema, r), role: r.memberRole as Membership["role"] }));
  },
  /** Membre retiré de l'organisation : tous ses appareils sont désabonnés (`orgId` explicite : appel hors contexte d'organisation). */
  async removeForUser(tx: Tx, orgId: string, userId: string): Promise<number> {
    return (await tx.query("delete from push_subscriptions where org_id = $1 and user_id = $2 returning id", [orgId, userId])).length;
  },
  /** Retire un appareil de l'utilisateur (Paramètres › Notifications), par son identifiant. */
  async removeById(tx: Tx, id: string, userId: string): Promise<boolean> {
    return (await tx.query("delete from push_subscriptions where org_id = $1 and id = $2 and user_id = $3 returning id", [tx.orgId, id, userId])).length > 0;
  },
  async markUsed(tx: Tx, id: string, at: string): Promise<void> {
    await tx.query("update push_subscriptions set last_used_at = $3, failures = 0 where org_id = $1 and id = $2", [tx.orgId, id, at]);
  },
  /** Échec d'envoi : compteur, et désactivation au-delà de `maxFailures` échecs consécutifs. */
  async markFailure(tx: Tx, id: string, at: string, maxFailures: number): Promise<PushSubscription | null> {
    const r = await tx.maybeOne("update push_subscriptions set failures = failures + 1, disabled_at = case when failures + 1 >= $4 then $3::timestamptz else disabled_at end where org_id = $1 and id = $2 returning *", [tx.orgId, id, at, maxFailures]);
    return r ? parse(pushSubscriptionSchema, r) : null;
  },
  /** Le service de notification a répondu 404 ou 410 : l'abonnement n'existe plus. */
  async disable(tx: Tx, id: string, at: string): Promise<void> {
    await tx.query("update push_subscriptions set disabled_at = coalesce(disabled_at, $3::timestamptz) where org_id = $1 and id = $2", [tx.orgId, id, at]);
  },
  async removeByEndpoint(tx: Tx, endpoint: string, userId: string | null = null): Promise<boolean> {
    return (await tx.query("delete from push_subscriptions where org_id = $1 and endpoint = $2 and ($3::text is null or user_id = $3) returning id", [tx.orgId, endpoint, userId])).length > 0;
  },
};

/** File des alertes Radar : une par affaire (clé `opportunity:<id>`), sans donnée du vendeur. */
export const radarAlerts = {
  /** Met une alerte en file ; null si elle existe déjà (même clé ou même affaire). */
  async enqueue(tx: Tx, input: { kind: RadarAlertKind; dedupeKey: string; payload: RadarAlertPayload; scheduledFor: string; opportunityId?: string | null; purchaseId?: string | null; userId?: string | null; channel?: "push" | "email" }): Promise<RadarAlert | null> {
    const { columns, values } = objectToColumns({ orgId: tx.orgId, kind: input.kind, dedupeKey: input.dedupeKey, payload: input.payload, scheduledFor: input.scheduledFor, opportunityId: input.opportunityId ?? null, purchaseId: input.purchaseId ?? null, userId: input.userId ?? null, channel: input.channel ?? "push" });
    const r = await tx.maybeOne(`insert into radar_alerts (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing returning *`, values);
    return r ? parse(radarAlertSchema, r) : null;
  },
  async byDedupeKey(tx: Tx, dedupeKey: string): Promise<RadarAlert | null> {
    const r = await tx.maybeOne("select * from radar_alerts where org_id = $1 and dedupe_key = $2", [tx.orgId, dedupeKey]);
    return r ? parse(radarAlertSchema, r) : null;
  },
  async list(tx: Tx, limit = 100): Promise<RadarAlert[]> {
    return (await tx.query("select * from radar_alerts where org_id = $1 order by created_at desc, id limit $2", [tx.orgId, Math.min(500, Math.max(1, limit))])).map((r) => parse(radarAlertSchema, r));
  },
  /** Alertes en file dont l'envoi est échu à l'instant `now`. */
  async due(tx: Tx, now: string, limit = 50): Promise<RadarAlert[]> {
    return (await tx.query("select * from radar_alerts where org_id = $1 and status = 'queued' and scheduled_for <= $2 order by scheduled_for, id limit $3", [tx.orgId, now, limit])).map((r) => parse(radarAlertSchema, r));
  },
  /**
   * Prise de l'alerte pour un envoi (UPDATE conditionnel sur le nombre d'essais) : un second passage
   * simultané ne l'envoie pas une deuxième fois. Le prochain essai éventuel est repoussé à `leaseUntil`.
   */
  async claim(tx: Tx, id: string, attempts: number, leaseUntil: string): Promise<RadarAlert | null> {
    const r = await tx.maybeOne("update radar_alerts set attempts = attempts + 1, scheduled_for = $4, updated_at = now() where org_id = $1 and id = $2 and status = 'queued' and attempts = $3 returning *", [tx.orgId, id, attempts, leaseUntil]);
    return r ? parse(radarAlertSchema, r) : null;
  },
  async markSent(tx: Tx, id: string, at: string): Promise<void> {
    await tx.query("update radar_alerts set status = 'sent', sent_at = $3, error = null, updated_at = now() where org_id = $1 and id = $2", [tx.orgId, id, at]);
  },
  async markFailed(tx: Tx, id: string, error: string): Promise<void> {
    await tx.query("update radar_alerts set status = 'failed', error = $3, updated_at = now() where org_id = $1 and id = $2", [tx.orgId, id, error.slice(0, 300)]);
  },
  /** Remet une alerte prise en file (échec passager), avec la raison. */
  async retryLater(tx: Tx, id: string, scheduledFor: string, error: string): Promise<void> {
    await tx.query("update radar_alerts set scheduled_for = $3, error = $4, updated_at = now() where org_id = $1 and id = $2 and status = 'queued'", [tx.orgId, id, scheduledFor, error.slice(0, 300)]);
  },
  async purgeOlderThan(tx: Tx, days: number, now: Date): Promise<number> {
    const before = new Date(now.getTime() - days * 86_400_000).toISOString();
    return (await tx.query("delete from radar_alerts where org_id = $1 and created_at < $2 and status <> 'queued' returning id", [tx.orgId, before])).length;
  },
};

export type EmbeddingKind = "sale" | "market" | "opportunity";

/** Vecteurs du modèle 2 en cache, par organisation, sorte, référence et modèle. */
export const embeddingsCache = {
  async get(tx: Tx, kind: EmbeddingKind, refs: readonly string[], model: string): Promise<Map<string, { vector: number[]; textHash: string }>> {
    if (refs.length === 0) return new Map();
    const rows = await tx.query<{ ref: string; vector: unknown; textHash: string }>("select ref, vector, text_hash from embeddings_cache where org_id = $1 and kind = $2 and model = $3 and ref = any($4)", [tx.orgId, kind, model, [...refs]]);
    const out = new Map<string, { vector: number[]; textHash: string }>();
    for (const r of rows) {
      if (Array.isArray(r.vector) && r.vector.every((x) => typeof x === "number" && Number.isFinite(x))) out.set(r.ref, { vector: r.vector as number[], textHash: r.textHash });
    }
    return out;
  },
  async put(tx: Tx, rows: readonly { kind: EmbeddingKind; ref: string; model: string; textHash: string; vector: readonly number[] }[]): Promise<number> {
    let n = 0;
    for (const r of rows) {
      if (r.vector.length === 0) continue;
      await tx.query(
        "insert into embeddings_cache (org_id, kind, ref, model, dims, text_hash, vector) values ($1, $2, $3, $4, $5, $6, $7) on conflict (org_id, kind, ref, model) do update set dims = excluded.dims, text_hash = excluded.text_hash, vector = excluded.vector, created_at = now()",
        [tx.orgId, r.kind, r.ref, r.model, r.vector.length, r.textHash, JSON.stringify(r.vector)],
      );
      n++;
    }
    return n;
  },
  async count(tx: Tx, kind?: EmbeddingKind): Promise<number> {
    return tx.count("select count(*) from embeddings_cache where org_id = $1 and ($2::text is null or kind = $2)", [tx.orgId, kind ?? null]);
  },
};

export const radarOrgs = {
  /**
   * Organisations ayant une recherche active, une alerte en file ou un paiement 3-D Secure en attente
   * (fonction SECURITY DEFINER, sans aucune donnée) : passages du worker uniquement.
   */
  async ids(tx: Tx): Promise<string[]> {
    return (await tx.query<{ orgId: string }>("select org_id from app_radar_org_ids()")).map((r) => r.orgId);
  },
};

// ---------------------------------------------------------------- Selio Track et estimation des prix (0013)

/** Filtres suivis par l'organisation (RLS). `lastReadAt` / `nextReadAt` viennent de `trackReads.state`. */
export const trackFilters = {
  async list(tx: Tx): Promise<TrackFilter[]> {
    return (await tx.query("select * from track_filters where org_id = $1 order by created_at, id", [tx.orgId])).map((r) => parse(trackFilterSchema, r));
  },
  async byId(tx: Tx, id: string): Promise<TrackFilter> {
    return parse(trackFilterSchema, await tx.one("select * from track_filters where org_id = $1 and id = $2", [tx.orgId, id], "Filtre Track"));
  },
  async byFingerprint(tx: Tx, fingerprint: string): Promise<TrackFilter | null> {
    const r = await tx.maybeOne("select * from track_filters where org_id = $1 and fingerprint = $2", [tx.orgId, fingerprint]);
    return r ? parse(trackFilterSchema, r) : null;
  },
  /** Filtres de l'organisation (actifs ou non) : base du quota « filtres suivis ». */
  async count(tx: Tx): Promise<number> {
    return tx.count("select count(*) from track_filters where org_id = $1", [tx.orgId]);
  },
  /** Filtres actifs de l'organisation, en dehors de `exceptId` (réactivation sous le quota). */
  async countEnabled(tx: Tx, exceptId?: string): Promise<number> {
    return tx.count("select count(*) from track_filters where org_id = $1 and enabled and ($2::text is null or id <> $2)", [tx.orgId, exceptId ?? null]);
  },
  async create(tx: Tx, input: { name: string; criteria: TrackCriteria; fingerprint: string; enabled: boolean }): Promise<TrackFilter> {
    return parse(trackFilterSchema, await tx.insert("track_filters", { ...input, orgId: tx.orgId }));
  },
  async update(tx: Tx, id: string, patch: { name?: string; criteria?: TrackCriteria; fingerprint?: string; enabled?: boolean }): Promise<TrackFilter> {
    const { columns, values } = objectToColumns({ ...patch, updatedAt: new Date().toISOString() });
    const sets = columns.map((c, i) => `${c} = $${i + 3}`);
    return parse(trackFilterSchema, await tx.one(`update track_filters set ${sets.join(", ")} where org_id = $1 and id = $2 returning *`, [tx.orgId, id, ...values], "Filtre Track"));
  },
  async delete(tx: Tx, id: string): Promise<boolean> {
    return (await tx.query("delete from track_filters where org_id = $1 and id = $2 returning id", [tx.orgId, id])).length > 0;
  },
};

/** État de lecture d'une empreinte suivie par l'organisation courante. */
export interface TrackReadState {
  fingerprint: string;
  lastReadAt: string | null;
  nextReadAt: string;
  reads: number;
  lastOutcome: string | null;
  factor: number;
}

/** Empreinte due (passage du worker) : critères normalisés, sans aucune donnée d'organisation. */
export interface TrackDueRead {
  fingerprint: string;
  criteria: unknown;
  lastReadAt: string | null;
  nextReadAt: string;
  reads: number;
  factor: number;
}

/** Lecture prise par un passage : critères et état précédent (annonces actives, empreintes salées). */
export interface TrackClaimedRead {
  criteria: unknown;
  state: unknown;
  stateSource: TrackSource | null;
  lastReadAt: string | null;
  reads: number;
  consecutiveFailures: number;
  factor: number;
}

/** Réglages partagés de Track : fenêtre glissante des lectures en direct, facteur, pause. */
export interface TrackRuntime {
  windowReads: number;
  windowBlocks: number;
  slowdownFactor: number;
  lastBlockAt: string | null;
  pausedUntil: string | null;
  pauseReason: string | null;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

/**
 * Lectures partagées par empreinte (`track_filter_reads`, `track_runtime`) : le rôle applicatif n'a
 * AUCUN droit direct sur ces tables, tout passe par des fonctions SECURITY DEFINER limitées.
 */
export const trackReads = {
  /**
   * Crée la ligne partagée de l'empreinte si l'organisation courante la suit, lue à `nextReadAt`. Avec
   * `defer`, une ligne existante que personne d'autre ne suit est repoussée à `nextReadAt`.
   */
  async follow(tx: Tx, fingerprint: string, criteria: TrackCriteria, nextReadAt: string, defer = false): Promise<void> {
    await tx.query("select app_track_follow($1, $2::jsonb, $3, $4)", [fingerprint, JSON.stringify(criteria), nextReadAt, defer]);
  },
  /** État des empreintes suivies par l'organisation courante (aucune autre n'est rendue). */
  async state(tx: Tx, fingerprints: readonly string[]): Promise<Map<string, TrackReadState>> {
    if (fingerprints.length === 0) return new Map();
    const rows = await tx.query<Record<string, unknown>>("select * from app_track_state($1)", [[...fingerprints]]);
    return new Map(rows.map((r) => [String(r.fingerprint), { fingerprint: String(r.fingerprint), lastReadAt: iso(r.lastReadAt), nextReadAt: iso(r.nextReadAt)!, reads: Number(r.reads ?? 0), lastOutcome: (r.lastOutcome as string | null) ?? null, factor: Number(r.factor ?? 1) }]));
  },
  async due(tx: Tx, now: string, limit = 50): Promise<TrackDueRead[]> {
    const rows = await tx.query<Record<string, unknown>>("select * from app_track_due($1, $2)", [now, limit]);
    return rows.map((r) => ({ fingerprint: String(r.fingerprint), criteria: r.criteria, lastReadAt: iso(r.lastReadAt), nextReadAt: iso(r.nextReadAt)!, reads: Number(r.reads ?? 0), factor: Number(r.factor ?? 1) }));
  },
  /** Prend la lecture (null : pas due, déjà prise par un autre passage ou plus suivie). */
  async claim(tx: Tx, fingerprint: string, now: string, leaseUntil: string): Promise<TrackClaimedRead | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from app_track_claim($1, $2, $3)", [fingerprint, now, leaseUntil]);
    if (!r) return null;
    return { criteria: r.criteria, state: r.state, stateSource: (r.stateSource as TrackSource | null) ?? null, lastReadAt: iso(r.lastReadAt), reads: Number(r.reads ?? 0), consecutiveFailures: Number(r.consecutiveFailures ?? 0), factor: Number(r.factor ?? 1) };
  },
  async finish(tx: Tx, input: { fingerprint: string; readAt: string; nextReadAt: string; outcome: string | null; counted: boolean; blocked: boolean; anomaly: boolean; factor: number; state: unknown | null; stateSource: TrackSource | null }): Promise<void> {
    await tx.query("select app_track_finish($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)", [
      input.fingerprint, input.readAt, input.nextReadAt, input.outcome, input.counted, input.blocked, input.anomaly, Math.max(1, Math.round(input.factor)),
      input.state === null ? null : JSON.stringify(input.state), input.stateSource,
    ]);
  },
  /** Empreintes salées des références d'annonces (le sel reste dans la base). */
  async refKeys(tx: Tx, refs: readonly string[]): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();
    const rows = await tx.query<{ ref: string; key: string }>("select * from app_track_ref_keys($1)", [[...new Set(refs)]]);
    return new Map(rows.map((r) => [r.ref, r.key]));
  },
  /**
   * Références de Track (vues ou disparues) écrites par la base : la clé de dédoublonnage est dérivée de la
   * clé de l'état avec un AUTRE sel et n'est jamais rendue. Dates au jour, photos par tranches. Rend le
   * nombre de lignes écrites (la dernière ligne d'une clé l'emporte).
   */
  async storeReferences(tx: Tx, source: "track" | "demo", rows: readonly TrackReferenceRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r, j) => ({
        k: r.key, status: r.status, brand: r.brand ?? null, category: r.category, size: r.size ?? null, condition: r.condition ?? null,
        listed_price_cents: r.listedPriceCents ?? null, final_price_cents: r.finalPriceCents ?? null, final_price_estimated: r.finalPriceEstimated ?? false,
        listed_at: r.listedAt ?? null, sold_at: r.soldAt ?? null, photo_count: r.photoCount ?? null, ord: i + j,
      }));
      const row = await tx.maybeOne<{ n: number | string }>("select app_track_store_references($1, $2::jsonb) as n", [source, JSON.stringify(chunk)]);
      n += Number(row?.n ?? 0);
    }
    return n;
  },
  async runtime(tx: Tx): Promise<TrackRuntime> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from app_track_runtime()");
    return { windowReads: Number(r?.windowReads ?? 0), windowBlocks: Number(r?.windowBlocks ?? 0), slowdownFactor: Number(r?.slowdownFactor ?? 1), lastBlockAt: iso(r?.lastBlockAt), pausedUntil: iso(r?.pausedUntil), pauseReason: (r?.pauseReason as string | null) ?? null };
  },
  /**
   * Mesure d'une lecture en direct dans la fenêtre partagée, facteur, pause éventuelle. `factor` null
   * (lecture sans blocage) : facteur et dernier blocage gardés tels quels.
   */
  async recordRuntime(tx: Tx, input: { blocked: boolean; factor: number | null; blockAt: string | null; pauseUntil: string | null; pauseReason: string | null }): Promise<void> {
    await tx.query("select app_track_runtime_record($1, $2, $3, $4, $5)", [input.blocked, input.factor === null ? null : Math.max(1, Math.round(input.factor)), input.blockAt, input.pauseUntil, input.pauseReason]);
  },
  /** Rétention des instantanés (historique du plan le plus long, 12 mois au plus) et des empreintes plus suivies. */
  async purge(tx: Tx, now: string): Promise<{ snapshots: number; fingerprints: number }> {
    const r = await tx.maybeOne<{ snapshots: number; fingerprints: number }>("select * from app_track_purge($1)", [now]);
    return { snapshots: Number(r?.snapshots ?? 0), fingerprints: Number(r?.fingerprints ?? 0) };
  },
};

export type TrackSnapshotInput = Omit<TrackSnapshot, "id" | "createdAt">;

/** Référence de Track à écrire (`trackReads.storeReferences`) : clé de l'état, jamais d'identifiant d'annonce. */
export interface TrackReferenceRow {
  key: string;
  status: "listed" | "gone";
  brand?: string | null;
  category: ItemCategory;
  size?: string | null;
  condition?: PriceReference["condition"];
  listedPriceCents?: number | null;
  finalPriceCents?: number | null;
  finalPriceEstimated?: boolean;
  listedAt?: string | null;
  soldAt?: string | null;
  photoCount?: number | null;
}

/** Instantanés par empreinte (partagés, sans donnée d'organisation ni de personne). */
export const trackSnapshots = {
  async add(tx: Tx, input: TrackSnapshotInput): Promise<TrackSnapshot | null> {
    const { columns, values } = objectToColumns({ ...input });
    const r = await tx.maybeOne(`insert into track_snapshots (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (fingerprint, read_at, source) do nothing returning *`, values);
    return r ? parse(trackSnapshotSchema, r) : null;
  },
  /** Instantanés d'une empreinte depuis `since`, du plus ancien au plus récent. */
  async since(tx: Tx, fingerprint: string, since: string, limit = 2000): Promise<TrackSnapshot[]> {
    return (await tx.query("select * from track_snapshots where fingerprint = $1 and read_at >= $2 order by read_at, id limit $3", [fingerprint, since, Math.max(1, limit)])).map((r) => parse(trackSnapshotSchema, r));
  },
  /**
   * Dernier instantané (depuis `since`) de chaque empreinte limitée à CETTE seule catégorie, catégorie
   * réellement appliquée à la page (`categoriesVerified`) : une page de toutes catégories, ou dont la
   * catégorie n'a pas été vérifiée (lecture en direct), ne compte pour aucune catégorie.
   */
  async latestForCategory(tx: Tx, category: ItemCategory, since: string): Promise<TrackSnapshot[]> {
    return (await tx.query(
      `select distinct on (fingerprint) * from track_snapshots
       where read_at >= $2 and coalesce(scope->'categories', '[]'::jsonb) = jsonb_build_array($1::text)
         and coalesce((scope->>'categoriesVerified')::boolean, true)
       order by fingerprint, read_at desc`,
      [category, since],
    )).map((r) => parse(trackSnapshotSchema, r));
  },
  async count(tx: Tx, fingerprint?: string): Promise<number> {
    return tx.count("select count(*) from track_snapshots where ($1::text is null or fingerprint = $1)", [fingerprint ?? null]);
  },
};

/** Scans de niche (RLS). */
export const trackScans = {
  async create(tx: Tx, input: Omit<TrackScan, "id" | "orgId" | "createdAt"> & { createdAt?: string }): Promise<TrackScan> {
    return parse(trackScanSchema, await tx.insert("track_scans", { ...input, orgId: tx.orgId }));
  },
  async list(tx: Tx, limit = 50): Promise<TrackScan[]> {
    return (await tx.query("select * from track_scans where org_id = $1 order by created_at desc, id limit $2", [tx.orgId, Math.min(500, Math.max(1, limit))])).map((r) => parse(trackScanSchema, r));
  },
  async purgeBefore(tx: Tx, before: string): Promise<number> {
    return (await tx.query("delete from track_scans where org_id = $1 and created_at < $2 returning id", [tx.orgId, before])).length;
  },
  /** Scans d'un état donné depuis une date (limite des scans « données insuffisantes » par jour). */
  async countSince(tx: Tx, status: TrackScan["status"], since: string): Promise<number> {
    return tx.count("select count(*) from track_scans where org_id = $1 and status = $2 and created_at >= $3", [tx.orgId, status, since]);
  },
};

/** Recherches par photo (RLS) : description et estimation seulement, jamais la photo. */
export const trackPhotoSearches = {
  async create(tx: Tx, input: Omit<TrackPhotoSearch, "id" | "orgId" | "createdAt"> & { createdAt?: string }): Promise<TrackPhotoSearch> {
    return parse(trackPhotoSearchSchema, await tx.insert("track_photo_searches", { ...input, orgId: tx.orgId }));
  },
  async list(tx: Tx, limit = 50): Promise<TrackPhotoSearch[]> {
    return (await tx.query("select * from track_photo_searches where org_id = $1 order by created_at desc, id limit $2", [tx.orgId, Math.min(500, Math.max(1, limit))])).map((r) => parse(trackPhotoSearchSchema, r));
  },
  async purgeBefore(tx: Tx, before: string): Promise<number> {
    return (await tx.query("delete from track_photo_searches where org_id = $1 and created_at < $2 returning id", [tx.orgId, before])).length;
  },
};

/** Colonnes rendues d'une référence : jamais l'organisation qui a fourni une vente. */
const PRICE_REFERENCE_COLUMNS = "id, dedupe_key, source, status, brand, category, subcategory, size, material, color, condition, listed_price_cents, final_price_cents, final_price_estimated, listed_at, sold_at, photo_count, views, favorites, created_at, updated_at";
const PRICE_REFERENCE_WRITE = ["dedupe_key", "source", "contributor_org_id", "status", "brand", "category", "subcategory", "size", "material", "color", "condition", "listed_price_cents", "final_price_cents", "final_price_estimated", "listed_at", "sold_at", "photo_count", "views", "favorites"] as const;

export interface PriceReferenceQuery {
  category?: ItemCategory;
  brand?: string | null;
  /** Vrai : seulement les références au prix final connu ou estimé (vendues, disparues). */
  withFinalPrice?: boolean;
  /** Faux par défaut : les références du simulateur ne servent jamais de comparables réels. */
  includeDemo?: boolean;
  /** Seulement ces sources (sinon toutes, hors démonstration selon `includeDemo`). */
  sources?: readonly PriceReferenceSource[];
  since?: string;
  limit?: number;
}

/**
 * Ventes versées par une organisation (`source = 'sale'`) : jamais rendues une à une à une AUTRE
 * organisation. Condition SQL commune des agrégats lus par une organisation (`$n` : son identifiant).
 */
const OWN_SALES_ONLY = (param: string) => `(source <> 'sale' or contributor_org_id = ${param})`;

/** Statistiques d'une niche (marque × catégorie) pour un scan. */
export interface PriceNicheStats {
  total: number;
  sold: number;
  active: number;
  medianFinalCents: number | null;
  medianListedCents: number | null;
  p25ListedCents: number | null;
  medianDaysToSell: number | null;
}

/** Base de références de prix (partagée, sans donnée personnelle). */
export const priceReferences = {
  /**
   * Ajoute ou met à jour des références par clé de dédoublonnage (la dernière ligne d'une clé l'emporte).
   * Les attributs déjà connus ne sont pas effacés par une valeur absente ; l'état et les prix suivent la
   * dernière lecture (une annonce revenue redevient « listed »).
   */
  async upsertMany(tx: Tx, rows: readonly (PriceReferenceInput & { contributorOrgId?: string | null })[]): Promise<number> {
    const byKey = new Map<string, PriceReferenceInput & { contributorOrgId?: string | null }>();
    for (const r of rows) byKey.set(r.dedupeKey, r);
    const list = [...byKey.values()];
    let n = 0;
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const values: unknown[] = [];
      const tuples = chunk.map((r) => {
        const row: Record<(typeof PRICE_REFERENCE_WRITE)[number], unknown> = {
          dedupe_key: r.dedupeKey, source: r.source, contributor_org_id: r.contributorOrgId ?? null, status: r.status ?? "listed", brand: r.brand ?? null, category: r.category,
          subcategory: r.subcategory ?? null, size: r.size ?? null, material: r.material ?? null, color: r.color ?? null, condition: r.condition ?? null,
          listed_price_cents: r.listedPriceCents ?? null, final_price_cents: r.finalPriceCents ?? null, final_price_estimated: r.finalPriceEstimated ?? false,
          listed_at: r.listedAt ?? null, sold_at: r.soldAt ?? null, photo_count: r.photoCount ?? null, views: r.views ?? null, favorites: r.favorites ?? null,
        };
        const start = values.length;
        for (const c of PRICE_REFERENCE_WRITE) values.push(row[c]);
        return `(${PRICE_REFERENCE_WRITE.map((_, j) => `$${start + j + 1}`).join(", ")})`;
      });
      const res = await tx.query(
        `insert into price_references (${PRICE_REFERENCE_WRITE.join(", ")}) values ${tuples.join(", ")}
         on conflict (dedupe_key) do update set
           status = excluded.status,
           brand = coalesce(excluded.brand, price_references.brand),
           category = excluded.category,
           subcategory = coalesce(excluded.subcategory, price_references.subcategory),
           size = coalesce(excluded.size, price_references.size),
           material = coalesce(excluded.material, price_references.material),
           color = coalesce(excluded.color, price_references.color),
           condition = coalesce(excluded.condition, price_references.condition),
           listed_price_cents = coalesce(excluded.listed_price_cents, price_references.listed_price_cents),
           final_price_cents = excluded.final_price_cents,
           final_price_estimated = excluded.final_price_estimated,
           listed_at = coalesce(price_references.listed_at, excluded.listed_at),
           sold_at = excluded.sold_at,
           photo_count = coalesce(excluded.photo_count, price_references.photo_count),
           views = coalesce(excluded.views, price_references.views),
           favorites = coalesce(excluded.favorites, price_references.favorites),
           updated_at = now()
         returning id`,
        values,
      );
      n += res.length;
    }
    return n;
  },
  async search(tx: Tx, q: PriceReferenceQuery = {}): Promise<PriceReference[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
    if (q.category) add("category = ?", q.category);
    if (q.brand) add("lower(brand) = lower(?)", q.brand);
    if (q.withFinalPrice) where.push("final_price_cents is not null");
    if (q.sources && q.sources.length > 0) add("source = any(?)", [...q.sources]);
    else if (!q.includeDemo) where.push("source <> 'demo'");
    if (q.since) add("coalesce(sold_at, listed_at, created_at) >= ?", q.since);
    params.push(Math.min(200_000, Math.max(1, q.limit ?? 500)));
    const rows = await tx.query(`select ${PRICE_REFERENCE_COLUMNS} from price_references ${where.length ? `where ${where.join(" and ")}` : ""} order by coalesce(sold_at, listed_at, created_at) desc nulls last, id limit $${params.length}`, params);
    return rows.map((r) => parse(priceReferenceSchema, r));
  },
  async countBySource(tx: Tx): Promise<Record<PriceReferenceSource, number>> {
    const rows = await tx.query<{ source: PriceReferenceSource; n: number | string }>("select source, count(*) as n from price_references group by source");
    const out: Record<PriceReferenceSource, number> = { track: 0, sale: 0, demo: 0, import: 0 };
    for (const r of rows) out[r.source] = Number(r.n);
    return out;
  },
  /**
   * Ventes (prix final connu ou estimé) par source, dont celles au prix estimé : ce que l'entraîneur peut
   * utiliser (les annonces encore en ligne ne servent pas au modèle de prix).
   */
  async soldBySource(tx: Tx): Promise<{ sold: Record<PriceReferenceSource, number>; estimated: Record<PriceReferenceSource, number> }> {
    const rows = await tx.query<{ source: PriceReferenceSource; n: number | string; estimated: number | string }>(
      "select source, count(*) as n, count(*) filter (where final_price_estimated) as estimated from price_references where final_price_cents is not null group by source",
    );
    const sold: Record<PriceReferenceSource, number> = { track: 0, sale: 0, demo: 0, import: 0 };
    const estimated: Record<PriceReferenceSource, number> = { track: 0, sale: 0, demo: 0, import: 0 };
    for (const r of rows) { sold[r.source] = Number(r.n); estimated[r.source] = Number(r.estimated); }
    return { sold, estimated };
  },
  /**
   * Retire les ventes versées par une organisation, sauf celles de `keep` (clés encore attendues) : vente
   * remboursée, annulée ou supprimée, ou accord retiré (`keep` vide). Rend le nombre de lignes retirées.
   */
  async deleteContributed(tx: Tx, orgId: string, keep: readonly string[] = []): Promise<number> {
    return (await tx.query("delete from price_references where contributor_org_id = $1 and not (dedupe_key = any($2::text[])) returning id", [orgId, [...keep]])).length;
  },
  /** Conservation : efface les références dont la vente (ou la mise en ligne) est antérieure à `before`. */
  async purgeBefore(tx: Tx, before: string): Promise<number> {
    return (await tx.query("delete from price_references where coalesce(sold_at, listed_at, created_at) < $1 returning id", [before])).length;
  },
  /** Statistiques d'une niche depuis `since` (scans de niche) ; ventes versées par d'autres organisations exclues. */
  async nicheStats(tx: Tx, q: { category: ItemCategory; brand: string | null; since: string; includeDemo: boolean }): Promise<PriceNicheStats> {
    const r = await tx.maybeOne<Record<string, unknown>>(
      `select count(*) as total,
        count(*) filter (where final_price_cents is not null) as sold,
        count(*) filter (where status = 'listed') as active,
        percentile_cont(0.5) within group (order by final_price_cents) filter (where final_price_cents is not null) as median_final_cents,
        percentile_cont(0.5) within group (order by listed_price_cents) filter (where status = 'listed' and listed_price_cents is not null) as median_listed_cents,
        percentile_cont(0.25) within group (order by listed_price_cents) filter (where listed_price_cents is not null) as p25_listed_cents,
        percentile_cont(0.5) within group (order by extract(epoch from (sold_at - listed_at)) / 86400.0) filter (where sold_at is not null and listed_at is not null and sold_at >= listed_at) as median_days_to_sell
       from price_references
       where category = $1 and ($2::text is null or lower(brand) = lower($2)) and coalesce(sold_at, listed_at, created_at) >= $3 and (source <> 'demo' or $4)
         and ${OWN_SALES_ONLY("$5")}`,
      [q.category, q.brand, q.since, q.includeDemo, tx.orgId],
    );
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const cents = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n); };
    return { total: Number(r?.total ?? 0), sold: Number(r?.sold ?? 0), active: Number(r?.active ?? 0), medianFinalCents: cents(r?.medianFinalCents), medianListedCents: cents(r?.medianListedCents), p25ListedCents: cents(r?.p25ListedCents), medianDaysToSell: num(r?.medianDaysToSell) };
  },
  /** Niches (marque × catégorie) vues depuis `since` : annonces en ligne, vendues ou disparues, prix médians (ventes des autres organisations exclues). */
  async nicheSummary(tx: Tx, q: { since: string; includeDemo: boolean; category?: ItemCategory; limit?: number }): Promise<{ brand: string; category: ItemCategory; listed: number; sold: number; estimatedShare: number; medianFinalCents: number | null; medianListedCents: number | null }[]> {
    const rows = await tx.query<Record<string, unknown>>(
      `select coalesce(brand, 'Sans marque') as brand, category,
        count(*) filter (where status = 'listed') as listed,
        count(*) filter (where final_price_cents is not null) as sold,
        coalesce(avg(case when final_price_estimated then 1.0 else 0.0 end) filter (where final_price_cents is not null), 0) as estimated_share,
        percentile_cont(0.5) within group (order by final_price_cents) filter (where final_price_cents is not null) as median_final_cents,
        percentile_cont(0.5) within group (order by listed_price_cents) filter (where listed_price_cents is not null) as median_listed_cents
       from price_references
       where coalesce(sold_at, listed_at, created_at) >= $1 and (source <> 'demo' or $2) and ($3::text is null or category = $3) and ${OWN_SALES_ONLY("$5")}
       group by 1, 2 order by sold desc, listed desc, brand, category limit $4`,
      [q.since, q.includeDemo, q.category ?? null, Math.min(200, Math.max(1, q.limit ?? 30)), tx.orgId],
    );
    const cents = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));
    return rows.map((r) => ({ brand: String(r.brand), category: r.category as ItemCategory, listed: Number(r.listed), sold: Number(r.sold), estimatedShare: Math.round(Number(r.estimatedShare ?? 0) * 100) / 100, medianFinalCents: cents(r.medianFinalCents), medianListedCents: cents(r.medianListedCents) }));
  },
  /** Ventes (et disparitions estimées) depuis `since`, agrégées par marque et catégorie : aucune annonce, aucune vente d'une autre organisation. */
  async salesByNiche(tx: Tx, q: { since: string; includeDemo: boolean; limit?: number }): Promise<{ brand: string; category: ItemCategory; sold: number; estimatedShare: number; medianPriceCents: number | null; lastSoldAt: string | null }[]> {
    const rows = await tx.query<Record<string, unknown>>(
      `select coalesce(brand, 'Sans marque') as brand, category, count(*) as sold,
        avg(case when final_price_estimated then 1.0 else 0.0 end) as estimated_share,
        percentile_cont(0.5) within group (order by final_price_cents) as median_price_cents,
        max(sold_at) as last_sold_at
       from price_references
       where final_price_cents is not null and sold_at >= $1 and (source <> 'demo' or $2) and ${OWN_SALES_ONLY("$4")}
       group by 1, 2 order by sold desc, brand, category limit $3`,
      [q.since, q.includeDemo, Math.min(200, Math.max(1, q.limit ?? 50)), tx.orgId],
    );
    return rows.map((r) => ({ brand: String(r.brand), category: r.category as ItemCategory, sold: Number(r.sold), estimatedShare: Math.round(Number(r.estimatedShare ?? 0) * 100) / 100, medianPriceCents: r.medianPriceCents === null ? null : Math.round(Number(r.medianPriceCents)), lastSoldAt: iso(r.lastSoldAt) }));
  },
};

/** Organisations qui ont des données Track (fonction SECURITY DEFINER, sans aucune donnée) : rétention du worker. */
export const trackOrgs = {
  async ids(tx: Tx): Promise<string[]> {
    return (await tx.query<{ orgId: string }>("select org_id from app_track_org_ids()")).map((r) => r.orgId);
  },
};

/** Modèles de prix entraînés (partagés) : un seul « active » à la fois. */
export const priceModels = {
  async active(tx: Tx): Promise<(PriceModelRecord & { model: unknown }) | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from price_models where status = 'active' limit 1");
    return r ? { ...parse(priceModelRecordSchema, r), model: r.model } : null;
  },
  async list(tx: Tx, limit = 20): Promise<PriceModelRecord[]> {
    return (await tx.query("select id, version, trained_at, n_references, metrics, status, synthetic, created_at from price_models order by trained_at desc, id limit $1", [Math.min(200, Math.max(1, limit))])).map((r) => parse(priceModelRecordSchema, r));
  },
  /** Enregistre un nouveau modèle actif ; l'ancien est archivé dans la même transaction. */
  async activate(tx: Tx, input: { version: string; trainedAt: string; nReferences: number; metrics: PriceModelMetrics; model: unknown; synthetic: boolean }): Promise<PriceModelRecord> {
    await tx.query("update price_models set status = 'archived' where status = 'active'");
    return parse(priceModelRecordSchema, await tx.one(
      "insert into price_models (version, trained_at, n_references, metrics, model, status, synthetic) values ($1, $2, $3, $4::jsonb, $5::jsonb, 'active', $6) returning id, version, trained_at, n_references, metrics, status, synthetic, created_at",
      [input.version, input.trainedAt, Math.max(0, Math.round(input.nReferences)), JSON.stringify(input.metrics ?? {}), JSON.stringify(input.model ?? null), input.synthetic],
    ));
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

// ---------------------------------------------------------------- Studio façon Kavis (0014)
//
// Les colonnes JSON des préparations sont rendues telles qu'en base et validées par le service (`@selio/core`,
// schémas `studioFields`, `namedMeasurementField`, `sellerQuestion` de `@selio/contracts`).

export type SizeReferenceSource = "provided" | "seller_validated";

/**
 * Référence de tailles (table partagée, sans donnée personnelle ni d'organisation) : mesures en cm d'un
 * modèle retrouvé par la référence lue sur l'étiquette (et la taille quand ses mesures en dépendent).
 * Lecture pour tous ; écriture par deux fonctions SECURITY DEFINER (opérateur, partage anonyme du vendeur).
 */
export interface SizeReferenceRecord {
  id: string;
  brand: string;
  reference: string;
  /** Taille mesurée ; null quand les mesures ne dépendent pas de la taille (sac, accessoire). */
  size: string | null;
  /** Famille de la pièce (GARMENT_KINDS). */
  category: string;
  /** { nom de mesure: cm } (par exemple { chest: 52, length: 70 }). */
  measurements: Record<string, number>;
  source: SizeReferenceSource;
  createdAt: string;
  updatedAt: string;
}

export interface SizeReferenceInput {
  brand: string;
  reference: string;
  size: string | null;
  category: string;
  measurements: Record<string, number>;
}

function toSizeReference(r: Record<string, unknown>): SizeReferenceRecord {
  const m = r.measurements && typeof r.measurements === "object" && !Array.isArray(r.measurements) ? (r.measurements as Record<string, unknown>) : {};
  const measurements = Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).map(([k, v]) => [k, Number(v)]));
  return {
    id: String(r.id),
    brand: String(r.brand),
    reference: String(r.reference),
    size: (r.size as string | null) ?? null,
    category: String(r.category ?? "other"),
    measurements,
    source: r.source === "provided" ? "provided" : "seller_validated",
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

const SIZE_REFERENCE_COLUMNS = "id, brand, reference, size, category, measurements, source, created_at, updated_at";
const SIZE_BRAND_KEY = "lower(regexp_replace($1, '[^[:alnum:]]', '', 'g'))";
const SIZE_REFERENCE_KEY = "upper(regexp_replace($2, '[^A-Za-z0-9]', '', 'g'))";

export const sizeReferences = {
  /**
   * Toutes les tailles connues d'un modèle, par marque et référence normalisées (« Levi's » = « levis »,
   * « AB-123 » = « ab 123 ») ; le service choisit celle qui correspond à l'article (`matchSizeReference`).
   */
  async findAll(tx: Tx, brand: string, reference: string, limit = 50): Promise<SizeReferenceRecord[]> {
    const rows = await tx.query<Record<string, unknown>>(
      `select ${SIZE_REFERENCE_COLUMNS} from size_references where brand_key = ${SIZE_BRAND_KEY} and reference_key = ${SIZE_REFERENCE_KEY} order by size_key limit $3`,
      [brand, reference, Math.min(200, Math.max(1, limit))],
    );
    return rows.map(toSizeReference);
  },
  async list(tx: Tx, opts: { brand?: string; limit?: number } = {}): Promise<SizeReferenceRecord[]> {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const rows = opts.brand
      ? await tx.query<Record<string, unknown>>(`select ${SIZE_REFERENCE_COLUMNS} from size_references where brand_key = ${SIZE_BRAND_KEY} order by reference_key, size_key limit $2`, [opts.brand, limit])
      : await tx.query<Record<string, unknown>>(`select ${SIZE_REFERENCE_COLUMNS} from size_references order by brand_key, reference_key, size_key limit $1`, [limit]);
    return rows.map(toSizeReference);
  },
  async count(tx: Tx): Promise<number> {
    return tx.count("select count(*) from size_references");
  },
  /** Référence fournie par l'opérateur (le service vérifie `isOperator`) : crée ou remplace. */
  async provide(tx: Tx, input: SizeReferenceInput): Promise<SizeReferenceRecord> {
    const r = await tx.one<{ id: string }>("select * from app_size_reference_provide($1, $2, $3, $4, $5::jsonb)", [input.brand, input.reference, input.size, input.category, JSON.stringify(input.measurements)], "Référence");
    return toSizeReference(await tx.one<Record<string, unknown>>(`select ${SIZE_REFERENCE_COLUMNS} from size_references where id = $1`, [r.id], "Référence"));
  },
  /**
   * Mesures validées et partagées anonymement par un vendeur : nouvelle ligne « seller_validated » ou ajout
   * des seules mesures manquantes. Null quand la référence est fournie par l'opérateur (jamais modifiée).
   */
  async contribute(tx: Tx, input: SizeReferenceInput): Promise<{ id: string; source: SizeReferenceSource } | null> {
    const r = await tx.maybeOne<{ id: string; source: SizeReferenceSource }>("select * from app_size_reference_contribute($1, $2, $3, $4, $5::jsonb)", [input.brand, input.reference, input.size, input.category, JSON.stringify(input.measurements)]);
    return r ?? null;
  },
};

export type StudioPrepStatus = "draft" | "validated";

/** Préparation Studio d'un article (RLS). Aucune image : seulement des clés de stockage et des rôles. */
export interface StudioPrepRecord {
  id: string;
  orgId: string;
  batchId: string;
  articleGroup: number;
  itemId: string | null;
  status: StudioPrepStatus;
  photos: unknown[];
  fields: Record<string, unknown>;
  measurements: unknown[];
  questions: unknown[];
  warnings: string[];
  details: Record<string, unknown>;
  garment: string | null;
  category: ItemCategory | null;
  simulated: boolean;
  shareMeasurements: boolean;
  validatedAt: string | null;
  listingGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StudioPrepInput = Pick<StudioPrepRecord, "batchId" | "articleGroup" | "photos" | "fields" | "measurements" | "questions" | "warnings" | "details" | "garment" | "category" | "simulated"> & { itemId?: string | null; createdAt?: string };
export type StudioPrepPatch = Partial<Pick<StudioPrepRecord, "itemId" | "status" | "fields" | "measurements" | "questions" | "warnings" | "details" | "garment" | "shareMeasurements" | "validatedAt" | "listingGeneratedAt">>;

function toStudioPrep(r: Record<string, unknown>): StudioPrepRecord {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const iso = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id),
    orgId: String(r.orgId),
    batchId: String(r.batchId),
    articleGroup: Number(r.articleGroup ?? 1),
    itemId: (r.itemId as string | null) ?? null,
    status: r.status === "validated" ? "validated" : "draft",
    photos: arr(r.photos),
    fields: obj(r.fields),
    measurements: arr(r.measurements),
    questions: arr(r.questions),
    warnings: arr(r.warnings).filter((w): w is string => typeof w === "string"),
    details: obj(r.details),
    garment: (r.garment as string | null) ?? null,
    category: (r.category as ItemCategory | null) ?? null,
    simulated: r.simulated === true,
    shareMeasurements: r.shareMeasurements === true,
    validatedAt: iso(r.validatedAt),
    listingGeneratedAt: iso(r.listingGeneratedAt),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

export const studioPreps = {
  async create(tx: Tx, input: StudioPrepInput): Promise<StudioPrepRecord> {
    return toStudioPrep(await tx.insert("studio_preps", { ...input, itemId: input.itemId ?? null, orgId: tx.orgId }));
  },
  async byId(tx: Tx, id: string): Promise<StudioPrepRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from studio_preps where org_id = $1 and id = $2", [tx.orgId, id]);
    return r ? toStudioPrep(r) : null;
  },
  /** Lit et verrouille la préparation jusqu'à la fin de la transaction (validation et génération concurrentes). */
  async lock(tx: Tx, id: string): Promise<StudioPrepRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from studio_preps where org_id = $1 and id = $2 for update", [tx.orgId, id]);
    return r ? toStudioPrep(r) : null;
  },
  async update(tx: Tx, id: string, patch: StudioPrepPatch): Promise<StudioPrepRecord> {
    const { columns, values } = objectToColumns({ ...patch, updatedAt: new Date().toISOString() });
    const sets = columns.map((c, i) => `${c} = $${i + 3}`);
    return toStudioPrep(await tx.one(`update studio_preps set ${sets.join(", ")} where org_id = $1 and id = $2 returning *`, [tx.orgId, id, ...values], "Préparation Studio"));
  },
  async byBatch(tx: Tx, batchId: string): Promise<StudioPrepRecord[]> {
    return (await tx.query<Record<string, unknown>>("select * from studio_preps where org_id = $1 and batch_id = $2 order by article_group, id", [tx.orgId, batchId])).map(toStudioPrep);
  },
  async list(tx: Tx, limit = 20): Promise<StudioPrepRecord[]> {
    return (await tx.query<Record<string, unknown>>("select * from studio_preps where org_id = $1 order by created_at desc, article_group, id limit $2", [tx.orgId, Math.min(200, Math.max(1, limit))])).map(toStudioPrep);
  },
  /** Brouillons jamais validés créés avant `before` (ils ne contiennent que des clés et des champs). */
  async purgeDraftsBefore(tx: Tx, before: string): Promise<number> {
    return (await tx.query("delete from studio_preps where org_id = $1 and status = 'draft' and created_at < $2 returning id", [tx.orgId, before])).length;
  },
};

export type WornPhotoStatus = "queued" | "running" | "done" | "failed" | "refused";
export type WornPhotoPose = "front" | "three_quarter" | "back";

/** Demande de photo portée (RLS). La photo d'origine et le résultat ne sont que des clés de stockage. */
export interface WornPhotoJobRecord {
  id: string;
  orgId: string;
  itemId: string | null;
  photoKey: string;
  pose: WornPhotoPose;
  status: WornPhotoStatus;
  provider: string;
  resultKey: string | null;
  error: string | null;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  usageEventId: string | null;
  /** Prix unitaire du dépassement accepté (centimes) ; 0 = dans le quota du plan. */
  overageCents: number;
  overageAcceptedAt: string | null;
  billedInvoiceId: string | null;
  billedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toWornPhotoJob(r: Record<string, unknown>): WornPhotoJobRecord {
  const iso = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id),
    orgId: String(r.orgId),
    itemId: (r.itemId as string | null) ?? null,
    photoKey: String(r.photoKey),
    pose: (r.pose as WornPhotoPose) ?? "front",
    status: r.status as WornPhotoStatus,
    provider: String(r.provider),
    resultKey: (r.resultKey as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    scheduledFor: String(r.scheduledFor),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    usageEventId: (r.usageEventId as string | null) ?? null,
    overageCents: Number(r.overageCents ?? 0),
    overageAcceptedAt: iso(r.overageAcceptedAt),
    billedInvoiceId: (r.billedInvoiceId as string | null) ?? null,
    billedAt: iso(r.billedAt),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

export interface WornPhotoDue {
  orgId: string;
  id: string;
  status: "queued" | "running";
}

export const wornPhotoJobs = {
  async create(tx: Tx, input: { id?: string; itemId?: string | null; photoKey: string; pose: WornPhotoPose; provider: string; scheduledFor: string; usageEventId?: string | null; overageCents?: number; overageAcceptedAt?: string | null; createdAt?: string }): Promise<WornPhotoJobRecord> {
    return toWornPhotoJob(await tx.insert("worn_photo_jobs", { ...input, provider: input.provider.slice(0, 40), itemId: input.itemId ?? null, overageCents: Math.max(0, Math.round(input.overageCents ?? 0)), status: "queued", orgId: tx.orgId }));
  },
  async byId(tx: Tx, id: string): Promise<WornPhotoJobRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from worn_photo_jobs where org_id = $1 and id = $2", [tx.orgId, id]);
    return r ? toWornPhotoJob(r) : null;
  },
  async list(tx: Tx, opts: { itemId?: string | null; limit?: number } = {}): Promise<WornPhotoJobRecord[]> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const rows = opts.itemId
      ? await tx.query<Record<string, unknown>>("select * from worn_photo_jobs where org_id = $1 and item_id = $2 order by created_at desc, id limit $3", [tx.orgId, opts.itemId, limit])
      : await tx.query<Record<string, unknown>>("select * from worn_photo_jobs where org_id = $1 order by created_at desc, id limit $2", [tx.orgId, limit]);
    return rows.map(toWornPhotoJob);
  },
  /** Prise conditionnelle d'une demande en file dont l'heure est venue ; null si un autre passage l'a prise. */
  async claim(tx: Tx, id: string, now: string, provider: string): Promise<WornPhotoJobRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>(
      "update worn_photo_jobs set status = 'running', started_at = $3, provider = $4, updated_at = now() where org_id = $1 and id = $2 and status = 'queued' and scheduled_for <= $3 returning *",
      [tx.orgId, id, now, provider.slice(0, 40)],
    );
    return r ? toWornPhotoJob(r) : null;
  },
  /**
   * Fin d'une demande en cours (transition conditionnelle depuis « running » ; avec `staleBefore`, seulement
   * si elle a commencé avant). Sans photo produite (`keepOverage` faux), le dépassement et la place de quota
   * sont retirés de la ligne (le service supprime l'événement d'utilisation).
   */
  async finish(tx: Tx, id: string, input: { status: "done" | "refused" | "failed"; finishedAt: string; resultKey?: string | null; error?: string | null; staleBefore?: string; keepOverage: boolean }): Promise<WornPhotoJobRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>(
      `update worn_photo_jobs set status = $3, finished_at = $4, result_key = $5, error = $6,
         overage_cents = case when $7::boolean then overage_cents else 0 end,
         usage_event_id = case when $7::boolean then usage_event_id else null end, updated_at = now()
       where org_id = $1 and id = $2 and status = 'running' and ($8::timestamptz is null or started_at < $8::timestamptz) returning *`,
      [tx.orgId, id, input.status, input.finishedAt, input.resultKey ?? null, input.error ? input.error.slice(0, 500) : null, input.keepOverage, input.staleBefore ?? null],
    );
    return r ? toWornPhotoJob(r) : null;
  },
  /** Supprime une demande encore en file (annulation) et la rend ; null si elle a déjà commencé. */
  async deleteQueued(tx: Tx, id: string): Promise<WornPhotoJobRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("delete from worn_photo_jobs where org_id = $1 and id = $2 and status = 'queued' returning *", [tx.orgId, id]);
    return r ? toWornPhotoJob(r) : null;
  },
  /**
   * Dépassement produit et pas encore facturé, terminé au plus tard à `cutoff`, groupé par prix unitaire
   * (le même filtre que `markOverageBilled`).
   */
  async unbilledOverage(tx: Tx, cutoff: string): Promise<{ unitCents: number; quantity: number }[]> {
    const rows = await tx.query<{ unitCents: number; quantity: number }>(
      "select overage_cents as unit_cents, count(*)::int as quantity from worn_photo_jobs where org_id = $1 and status = 'done' and overage_cents > 0 and billed_invoice_id is null and finished_at <= $2 group by overage_cents order by overage_cents",
      [tx.orgId, cutoff],
    );
    return rows.map((r) => ({ unitCents: Number(r.unitCents), quantity: Number(r.quantity) }));
  },
  /** Rattache à une facture `quantity` photos au prix `unitCents`, terminées au plus tard à `cutoff` (les plus anciennes d'abord). */
  async markOverageBilled(tx: Tx, input: { invoiceId: string; cutoff: string; unitCents: number; quantity: number; at: string }): Promise<number> {
    if (input.quantity <= 0) return 0;
    return (await tx.query(
      `update worn_photo_jobs set billed_invoice_id = $2, billed_at = $6, updated_at = now() where org_id = $1 and id in (
         select id from worn_photo_jobs where org_id = $1 and status = 'done' and overage_cents = $4 and billed_invoice_id is null and finished_at <= $3
         order by finished_at, id limit $5 for update
       ) returning id`,
      [tx.orgId, input.invoiceId, input.cutoff, input.unitCents, input.quantity, input.at],
    )).length;
  },
  /** Autres demandes de l'organisation qui utilisent la même photo d'origine (avant de supprimer l'objet du stockage). */
  async countByPhotoKey(tx: Tx, photoKey: string, excludeId: string | null = null): Promise<number> {
    return tx.count("select count(*) from worn_photo_jobs where org_id = $1 and photo_key = $2 and ($3::text is null or id <> $3)", [tx.orgId, photoKey, excludeId]);
  },
  /**
   * Rétention : demandes terminées (produite, refusée ou en échec) avant `before`, sauf un dépassement produit et
   * pas encore facturé (il attend le renouvellement). Les lignes sont supprimées ; leurs clés sont rendues pour
   * effacer les objets du stockage.
   */
  async purgeFinishedBefore(tx: Tx, before: string): Promise<{ id: string; status: WornPhotoStatus; photoKey: string; resultKey: string | null }[]> {
    const rows = await tx.query<{ id: string; status: WornPhotoStatus; photoKey: string; resultKey: string | null }>(
      "delete from worn_photo_jobs where org_id = $1 and status in ('done', 'refused', 'failed') and finished_at < $2 and (overage_cents = 0 or billed_invoice_id is not null) returning id, status, photo_key, result_key",
      [tx.orgId, before],
    );
    return rows.map((r) => ({ id: String(r.id), status: r.status, photoKey: String(r.photoKey), resultKey: (r.resultKey as string | null) ?? null }));
  },
  /** Demandes à exécuter, toutes organisations (fonction SECURITY DEFINER, identifiants seulement) : worker. */
  async due(tx: Tx, now: string, staleBefore: string, limit = 50): Promise<WornPhotoDue[]> {
    return (await tx.query<WornPhotoDue>("select * from app_worn_photo_due($1, $2, $3)", [now, staleBefore, limit])).map((r) => ({ orgId: r.orgId, id: r.id, status: r.status }));
  },
};

// ---------------------------------------------------------------- 0015 : limites de Vinted mesurées

/**
 * Mesure des limites de Vinted (RLS : ses mesures et les mesures globales de l'équipe en lecture). Une
 * mesure globale (`orgId` null) ne s'écrit que par `recordGlobal` (fonction SECURITY DEFINER, contrôle
 * opérateur côté application). Historique : la plus récente s'applique, rien n'est modifié ni supprimé.
 */
export interface NegotiationLimitsRecord {
  id: string;
  orgId: string | null;
  maxCounterOffersPerConversation: number;
  offerDurationHours: number;
  minDelayBetweenMessagesSeconds: number;
  source: "default_conservative" | "measured";
  measuredAt: string | null;
  measuredBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface NegotiationLimitsInput {
  maxCounterOffersPerConversation: number;
  offerDurationHours: number;
  minDelayBetweenMessagesSeconds: number;
  measuredAt: string;
  measuredBy?: string | null;
  note?: string | null;
}

function toNegotiationLimits(r: Record<string, unknown>): NegotiationLimitsRecord {
  return {
    id: String(r.id),
    orgId: (r.orgId as string | null) ?? null,
    maxCounterOffersPerConversation: Number(r.maxCounterOffersPerConversation),
    offerDurationHours: Number(r.offerDurationHours),
    minDelayBetweenMessagesSeconds: Number(r.minDelayBetweenMessagesSeconds),
    source: r.source === "measured" ? "measured" : "default_conservative",
    measuredAt: r.measuredAt === null || r.measuredAt === undefined ? null : String(r.measuredAt),
    measuredBy: (r.measuredBy as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: String(r.createdAt),
  };
}

export const negotiationLimits = {
  /** Mesure la plus récente de l'organisation (null : aucune). */
  async latestForOrg(tx: Tx): Promise<NegotiationLimitsRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from negotiation_limits where org_id = $1 order by created_at desc, id desc limit 1", [tx.orgId]);
    return r ? toNegotiationLimits(r) : null;
  },
  /** Mesure globale la plus récente (équipe), lisible par toutes les organisations. */
  async latestGlobal(tx: Tx): Promise<NegotiationLimitsRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from negotiation_limits where org_id is null order by created_at desc, id desc limit 1");
    return r ? toNegotiationLimits(r) : null;
  },
  /** Historique visible (ses mesures et les mesures globales), les plus récentes d'abord. */
  async history(tx: Tx, limit = 20): Promise<NegotiationLimitsRecord[]> {
    const rows = await tx.query<Record<string, unknown>>(
      "select * from negotiation_limits where org_id is null or org_id = $1 order by created_at desc, id desc limit $2",
      [tx.orgId, Math.min(100, Math.max(1, limit))],
    );
    return rows.map(toNegotiationLimits);
  },
  /** Mesure propre à l'organisation. */
  async recordForOrg(tx: Tx, input: NegotiationLimitsInput): Promise<NegotiationLimitsRecord> {
    return toNegotiationLimits(await tx.insert("negotiation_limits", { ...input, measuredBy: input.measuredBy ?? null, note: input.note ?? null, source: "measured", orgId: tx.orgId }));
  },
  /** Mesure globale de l'équipe (fonction SECURITY DEFINER) : le contrôle opérateur est fait par le service. */
  async recordGlobal(tx: Tx, input: NegotiationLimitsInput): Promise<NegotiationLimitsRecord> {
    const row = await tx.one<{ id: string }>("select * from app_negotiation_limits_record_global($1, $2, $3, $4, $5, $6)", [
      input.maxCounterOffersPerConversation, input.offerDurationHours, input.minDelayBetweenMessagesSeconds, input.measuredAt, input.measuredBy ?? null, input.note ?? null,
    ], "Mesure");
    return toNegotiationLimits(await tx.one("select * from negotiation_limits where id = $1", [row.id], "Mesure"));
  },
};

// ---------------------------------------------------------------- 0015 : migration des réglages

export type MigrationMappingStatus = "draft" | "applied";
export type MigrationInputKindRecord = "text" | "screenshot" | "rgpd_file";

/**
 * Correspondance « ancien → nouveau » (RLS). `rawInput` : texte collé ou fichier RGPD, gardé 7 jours au
 * plus (`rawInputPurgeAt`) ; les captures d'écran ne sont jamais stockées (`screenshotCount` seulement).
 */
export interface MigrationMappingRecord {
  id: string;
  orgId: string;
  source: string;
  inputKind: MigrationInputKindRecord;
  mapping: Record<string, unknown>;
  status: MigrationMappingStatus;
  rawInput: string | null;
  rawInputPurgeAt: string | null;
  screenshotCount: number;
  appliedFieldIds: string[];
  appliedResult: Record<string, unknown> | null;
  createdBy: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toMigrationMapping(r: Record<string, unknown>): MigrationMappingRecord {
  const iso = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return {
    id: String(r.id),
    orgId: String(r.orgId),
    source: String(r.source),
    inputKind: r.inputKind as MigrationInputKindRecord,
    mapping: obj(r.mapping),
    status: r.status === "applied" ? "applied" : "draft",
    rawInput: (r.rawInput as string | null) ?? null,
    rawInputPurgeAt: iso(r.rawInputPurgeAt),
    screenshotCount: Number(r.screenshotCount ?? 0),
    appliedFieldIds: Array.isArray(r.appliedFieldIds) ? (r.appliedFieldIds as unknown[]).map(String) : [],
    appliedResult: r.appliedResult && typeof r.appliedResult === "object" ? (r.appliedResult as Record<string, unknown>) : null,
    createdBy: (r.createdBy as string | null) ?? null,
    appliedBy: (r.appliedBy as string | null) ?? null,
    appliedAt: iso(r.appliedAt),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

export const migrationMappings = {
  async create(tx: Tx, input: { source: string; inputKind: MigrationInputKindRecord; mapping: Record<string, unknown>; rawInput?: string | null; rawInputPurgeAt?: string | null; screenshotCount?: number; createdBy?: string | null; createdAt?: string }): Promise<MigrationMappingRecord> {
    const rawInput = input.rawInput && input.rawInput.length > 0 ? input.rawInput : null;
    return toMigrationMapping(await tx.insert("migration_mappings", {
      ...input,
      rawInput,
      rawInputPurgeAt: rawInput ? input.rawInputPurgeAt ?? null : null,
      screenshotCount: Math.max(0, Math.min(4, input.screenshotCount ?? 0)),
      createdBy: input.createdBy ?? null,
      orgId: tx.orgId,
    }));
  },
  async byId(tx: Tx, id: string): Promise<MigrationMappingRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from migration_mappings where org_id = $1 and id = $2", [tx.orgId, id]);
    return r ? toMigrationMapping(r) : null;
  },
  /** Lit et verrouille la correspondance (application concurrente). */
  async lock(tx: Tx, id: string): Promise<MigrationMappingRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>("select * from migration_mappings where org_id = $1 and id = $2 for update", [tx.orgId, id]);
    return r ? toMigrationMapping(r) : null;
  },
  async list(tx: Tx, limit = 20): Promise<MigrationMappingRecord[]> {
    return (await tx.query<Record<string, unknown>>("select * from migration_mappings where org_id = $1 order by created_at desc, id desc limit $2", [tx.orgId, Math.min(100, Math.max(1, limit))])).map(toMigrationMapping);
  },
  /** Correction d'un brouillon (écran « ancien → nouveau ») : une correspondance appliquée ne change plus. */
  async updateDraft(tx: Tx, id: string, patch: { mapping: Record<string, unknown>; source?: string }): Promise<MigrationMappingRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>(
      "update migration_mappings set mapping = $3, source = coalesce($4, source), updated_at = now() where org_id = $1 and id = $2 and status = 'draft' returning *",
      [tx.orgId, id, JSON.stringify(patch.mapping), patch.source ?? null],
    );
    return r ? toMigrationMapping(r) : null;
  },
  async markApplied(tx: Tx, id: string, input: { appliedFieldIds: string[]; appliedResult: Record<string, unknown>; appliedBy: string | null; appliedAt: string; mapping?: Record<string, unknown> }): Promise<MigrationMappingRecord | null> {
    const r = await tx.maybeOne<Record<string, unknown>>(
      `update migration_mappings set status = 'applied', applied_field_ids = $3, applied_result = $4, applied_by = $5, applied_at = $6,
         mapping = coalesce($7::jsonb, mapping), updated_at = now()
       where org_id = $1 and id = $2 and status = 'draft' returning *`,
      [tx.orgId, id, JSON.stringify(input.appliedFieldIds), JSON.stringify(input.appliedResult), input.appliedBy, input.appliedAt, input.mapping ? JSON.stringify(input.mapping) : null],
    );
    return r ? toMigrationMapping(r) : null;
  },
  /** Rétention de l'organisation : efface l'entrée brute arrivée à échéance. */
  async purgeRawInputs(tx: Tx, now: string): Promise<number> {
    return (await tx.query("update migration_mappings set raw_input = null, raw_input_purge_at = null, updated_at = now() where org_id = $1 and raw_input is not null and raw_input_purge_at <= $2 returning id", [tx.orgId, now])).length;
  },
  /** Rétention, toutes organisations (fonction SECURITY DEFINER, nombre de lignes seulement) : worker. */
  async purgeRawInputsAll(tx: Tx, now: string): Promise<number> {
    const r = await tx.maybeOne<{ appMigrationPurgeRawInputs: number }>("select app_migration_purge_raw_inputs($1)", [now]);
    return Number(r?.appMigrationPurgeRawInputs ?? 0);
  },
};
