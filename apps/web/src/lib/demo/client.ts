import {
  type AiRequest, type AuditLog, type AutomationRule, type AutomationRuleCreate, type BulkItemAction, type ConnectionCreate, type ConnectionTestResult, type Conversation, type ConversationQuery, type Customer, type CustomerCreate, type CustomerQuery, type CustomerUpdate, type ExtensionToken, type InventoryEvent, type InventoryItem, type InventoryItemCreate, type InventoryItemUpdate, type InventoryQuery, type Job, type JobQuery, type MarketplaceConnection, type Membership, type Message, type Opportunity, type Order, type OrderCreate, type OrderQuery, type OrderStatus, type Organization, type OrgSettings, type Page, type Plan, type PurchaseRequest, type RadarSearch, type RadarSearchCreate, type Role, type Shipment, type Subscription, type UsageEvent, type User,
  automationRuleCreate as automationRuleCreateSchema, inventoryItemCreate as inventoryItemCreateSchema, inventoryItemUpdate as inventoryItemUpdateSchema, customerCreate as customerCreateSchema, orderCreate as orderCreateSchema, radarSearchCreate as radarSearchCreateSchema, orgSettings as orgSettingsSchema, connectionCreate as connectionCreateSchema,
} from "@selio/contracts";
import {
  ItemTransitionError, OrderTransitionError, breakdownBy, canChangeItemStatus, comparablesFromSales, daysInStock, diffItem, estimateResale, evaluateOffer, extractOfferCents, gateRule, itemStatusForOrder, jobDedupeKey, newId, orderDedupeKey, orderMargin, periodFromPreset, previousPeriod, purchaseOutcome, rankOpportunities, renderTemplate, runPurchaseChecks, salesKpis, salesSeries, sanitizeUntrustedText, scanForInjection, scoreOpportunity, stockKpis, transitionOrder, toCsv, EXPORT_HEADERS, inventoryToCsvRow, nextSku, seededRandom, hashString, localDayKey, type NegotiationResult, type PeriodPreset,
} from "@selio/domain";
import { getConnector, describeConnectors } from "@selio/connectors";
import { AIService, MockAIProvider } from "@selio/ai";
import { buildDemoState } from "@selio/demo-data";
import { LocalDemoStorage, type DemoState, type DemoStorage } from "@selio/demo-data";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { DataError, type AdminOverview, type AnalyticsData, type AnalyticsFilters, type AutomationState, type ConversationDetail, type CustomerTimeline, type DataClient, type OverviewData, type ServiceStatus, type Session, type SuggestionResult, type UsageSummary } from "../data/types";

function paginate<T>(items: T[], page = 1, pageSize = 25): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), total, page: p, pageSize, pageCount };
}

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Client de démonstration : applique les mêmes règles métier que le serveur
 * (packages/domain), persiste dans un stockage local et simule toute action
 * externe en la marquant `simulated`. Aucun appel réseau.
 */
export class DemoClient implements DataClient {
  readonly mode = "demo" as const;
  private state: DemoState | null;
  private readonly ai: AIService;
  private listeners = new Set<() => void>();

  constructor(private readonly storage: DemoStorage = new LocalDemoStorage(), private readonly clock: () => Date = () => new Date()) {
    this.state = storage.load();
    this.ai = new AIService({ provider: new MockAIProvider({ latencyMs: 250 }), concurrency: 2, maxPending: 20, circuitFailures: 3, circuitCooldownMs: 30_000, timeoutMs: 5000, allowFallback: true });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- internes ----------
  private get s(): DemoState {
    if (!this.state) throw new DataError("unauthorized", "Session de démonstration absente", 401);
    return this.state;
  }
  private now(): string {
    return this.clock().toISOString();
  }
  private persist(): void {
    if (this.state) this.storage.save(this.state);
    for (const l of this.listeners) l();
  }
  private audit(action: string, targetType: string | null, targetId: string | null, meta: Record<string, unknown> = {}): void {
    this.s.audit.unshift({ id: newId(), orgId: this.s.org.id, actorUserId: this.s.user.id, action, targetType, targetId, meta, ip: null, createdAt: this.now() });
    if (this.s.audit.length > 500) this.s.audit.length = 500;
  }
  private usage(kind: UsageEvent["kind"], meta: Record<string, unknown> = {}): void {
    this.s.usage.unshift({ id: newId(), orgId: this.s.org.id, kind, quantity: 1, meta, createdAt: this.now() });
  }
  private session(): Session {
    const st = this.s;
    const membership = st.memberships.find((m) => m.userId === st.user.id)!;
    return { mode: "demo", user: st.user, org: st.org, role: membership.role, memberships: st.memberships.filter((m) => m.userId === st.user.id).map((m) => ({ ...m, orgName: st.org.name })) };
  }
  private itemById(id: string): InventoryItem {
    const it = this.s.items.find((i) => i.id === id);
    if (!it) throw new DataError("not_found", "Article introuvable", 404);
    return it;
  }
  private customerById(id: string): Customer {
    const c = this.s.customers.find((i) => i.id === id);
    if (!c) throw new DataError("not_found", "Client introuvable", 404);
    return c;
  }
  private convById(id: string): Conversation {
    const c = this.s.conversations.find((i) => i.id === id);
    if (!c) throw new DataError("not_found", "Conversation introuvable", 404);
    return c;
  }
  private orderById(id: string): Order {
    const o = this.s.orders.find((i) => i.id === id);
    if (!o) throw new DataError("not_found", "Commande introuvable", 404);
    return o;
  }
  private logEvent(itemId: string, kind: InventoryEvent["kind"], changes: InventoryEvent["changes"] = {}, note: string | null = null): void {
    this.s.itemEvents.unshift({ id: newId(), orgId: this.s.org.id, itemId, actorUserId: this.s.user.id, kind, changes, note, createdAt: this.now() });
  }
  private margin() {
    return this.s.org.settings.margin;
  }
  private lastOffer(conv: Conversation): { offerCents: number; evaluation: NegotiationResult } | null {
    const item = conv.itemId ? this.s.items.find((i) => i.id === conv.itemId) : null;
    const lastInbound = [...this.s.messages].filter((m) => m.conversationId === conv.id && m.direction === "inbound").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop();
    if (!item || !lastInbound?.offerCents) return null;
    return { offerCents: lastInbound.offerCents, evaluation: evaluateOffer({ item, offerCents: lastInbound.offerCents, rules: this.margin(), roundsSoFar: conv.negotiationRounds, now: this.clock() }) };
  }
  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------- session ----------
  async getSession(): Promise<Session | null> {
    return this.state ? this.session() : null;
  }
  async login(input: { email: string; password: string }): Promise<Session> {
    await this.delay(200);
    if (!this.state) this.state = buildDemoState(this.clock());
    if (input.email.trim() && !/^demo$/i.test(input.password) && input.password !== "") {
      // En démo, tout mot de passe est accepté : on le dit clairement dans l'interface.
    }
    this.audit("auth.login", null, null, { mode: "demo" });
    this.persist();
    return this.session();
  }
  async register(input: { email: string; password: string; displayName: string; orgName: string }): Promise<Session> {
    await this.delay(200);
    this.state = buildDemoState(this.clock());
    this.state.user = { ...this.state.user, email: input.email, displayName: input.displayName };
    this.state.users[0] = this.state.user;
    this.state.org = { ...this.state.org, name: input.orgName, settings: { ...this.state.org.settings, onboarding: { completedSteps: ["account"], dismissed: false } } };
    this.audit("auth.register", null, null, { mode: "demo" });
    this.persist();
    return this.session();
  }
  async logout(): Promise<void> {
    if (this.state) this.audit("auth.logout", null, null, {});
    this.persist();
    this.state = null;
    for (const l of this.listeners) l();
  }
  async switchOrg(): Promise<Session> {
    return this.session();
  }

  // ---------- organisation ----------
  async updateOrg(input: { name?: string; settings?: Partial<OrgSettings> }): Promise<Organization> {
    const st = this.s;
    const merged = orgSettingsSchema.parse({
      ...st.org.settings,
      ...(input.settings ?? {}),
      margin: { ...st.org.settings.margin, ...(input.settings?.margin ?? {}) },
      ai: { ...st.org.settings.ai, ...(input.settings?.ai ?? {}) },
      notifications: { ...st.org.settings.notifications, ...(input.settings?.notifications ?? {}) },
      retentionDays: { ...st.org.settings.retentionDays, ...(input.settings?.retentionDays ?? {}) },
      onboarding: { ...st.org.settings.onboarding, ...(input.settings?.onboarding ?? {}) },
    });
    st.org = { ...st.org, name: input.name?.trim() || st.org.name, settings: merged, updatedAt: this.now() };
    this.audit("org.updated", "organization", st.org.id, { fields: Object.keys(input.settings ?? {}) });
    this.persist();
    return st.org;
  }
  async listMembers() {
    return this.s.memberships.map((m) => ({ ...m, user: this.s.users.find((u) => u.id === m.userId)! }));
  }
  async inviteMember(input: { email: string; role: Role }) {
    const st = this.s;
    if (st.users.some((u) => u.email === input.email)) throw new DataError("conflict", "Cet utilisateur est déjà membre.", 409);
    if (st.memberships.length >= st.subscription.quotas.members) throw new DataError("quota_exceeded", `Quota de membres atteint (${st.subscription.quotas.members}).`, 402);
    const user: User = { id: newId(), email: input.email, displayName: input.email.split("@")[0]!, isOperator: false, createdAt: this.now() };
    const m: Membership = { id: newId(), orgId: st.org.id, userId: user.id, role: input.role, createdAt: this.now() };
    st.users.push(user);
    st.memberships.push(m);
    this.audit("member.invited", "membership", m.id, { role: input.role });
    this.persist();
    return { ...m, user };
  }
  async updateMemberRole(membershipId: string, role: Role): Promise<void> {
    const m = this.s.memberships.find((x) => x.id === membershipId);
    if (!m) throw new DataError("not_found", "Membre introuvable", 404);
    if (m.userId === this.s.user.id && role !== "owner") throw new DataError("validation", "Le propriétaire ne peut pas rétrograder son propre rôle.", 400);
    m.role = role;
    this.audit("member.role_changed", "membership", m.id, { role });
    this.persist();
  }
  async removeMember(membershipId: string): Promise<void> {
    const m = this.s.memberships.find((x) => x.id === membershipId);
    if (!m) throw new DataError("not_found", "Membre introuvable", 404);
    if (m.userId === this.s.user.id) throw new DataError("validation", "Vous ne pouvez pas vous retirer vous-même.", 400);
    this.s.memberships = this.s.memberships.filter((x) => x.id !== membershipId);
    this.audit("member.removed", "membership", membershipId, {});
    this.persist();
  }
  async completeOnboardingStep(step: string): Promise<Organization> {
    const steps = new Set(this.s.org.settings.onboarding.completedSteps);
    steps.add(step);
    return this.updateOrg({ settings: { onboarding: { completedSteps: [...steps], dismissed: this.s.org.settings.onboarding.dismissed } } });
  }

  // ---------- articles ----------
  async listItems(query: Partial<InventoryQuery>): Promise<Page<InventoryItem>> {
    const rules = this.margin();
    let list = [...this.s.items];
    if (query.status) list = list.filter((i) => i.status === query.status);
    else list = list.filter((i) => i.status !== "archived");
    if (query.category) list = list.filter((i) => i.category === query.category);
    if (query.brand) list = list.filter((i) => norm(i.brand) === norm(query.brand));
    if (query.q) {
      const q = norm(query.q);
      list = list.filter((i) => norm(i.title).includes(q) || norm(i.brand).includes(q) || norm(i.sku).includes(q) || i.tags.some((t) => norm(t).includes(q)));
    }
    const projected = (i: InventoryItem) => (i.listedPriceCents === null ? -Infinity : i.listedPriceCents - i.purchasePriceCents - i.purchaseFeesCents - rules.defaultShippingCostCents);
    switch (query.sort ?? "updated_desc") {
      case "created_desc": list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break;
      case "title_asc": list.sort((a, b) => a.title.localeCompare(b.title, "fr")); break;
      case "price_asc": list.sort((a, b) => (a.listedPriceCents ?? 0) - (b.listedPriceCents ?? 0)); break;
      case "price_desc": list.sort((a, b) => (b.listedPriceCents ?? 0) - (a.listedPriceCents ?? 0)); break;
      case "margin_desc": list.sort((a, b) => projected(b) - projected(a)); break;
      default: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return paginate(list, query.page, query.pageSize);
  }
  async listItemBrands(): Promise<string[]> {
    return [...new Set(this.s.items.map((i) => i.brand).filter((b): b is string => Boolean(b)))].sort((a, b) => a.localeCompare(b, "fr"));
  }
  async getItem(id: string): Promise<InventoryItem> {
    return this.itemById(id);
  }
  async createItem(input: InventoryItemCreate): Promise<InventoryItem> {
    const st = this.s;
    const parsed = inventoryItemCreateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Article invalide", 400, parsed.error.flatten());
    const active = st.items.filter((i) => i.status !== "archived").length;
    if (active >= st.subscription.quotas.items) throw new DataError("quota_exceeded", `Quota d'articles atteint (${st.subscription.quotas.items}).`, 402);
    const now = this.now();
    const item: InventoryItem = { ...parsed.data, id: newId(), orgId: st.org.id, sku: parsed.data.sku || nextSku(parsed.data.category, st.items.map((i) => i.sku)), listedAt: parsed.data.status === "listed" ? now : null, soldAt: null, archivedAt: null, createdAt: now, updatedAt: now };
    st.items.unshift(item);
    this.logEvent(item.id, "created", {}, "Création");
    this.audit("item.created", "inventory_item", item.id, {});
    this.persist();
    return item;
  }
  async updateItem(id: string, input: InventoryItemUpdate): Promise<InventoryItem> {
    const parsed = inventoryItemUpdateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Modification invalide", 400, parsed.error.flatten());
    const before = this.itemById(id);
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<InventoryItem>;
    if (patch.status && patch.status !== before.status && !canChangeItemStatus(before.status, patch.status)) throw new DataError("validation", `Transition de statut interdite : ${before.status} → ${patch.status}`, 400);
    const after: InventoryItem = { ...before, ...patch, updatedAt: this.now() };
    if (patch.status === "listed" && !before.listedAt) after.listedAt = after.updatedAt;
    if (patch.status === "archived") after.archivedAt = after.updatedAt;
    if (patch.status && patch.status !== "archived") after.archivedAt = null;
    const changes = diffItem(before, after);
    const idx = this.s.items.findIndex((i) => i.id === id);
    this.s.items[idx] = after;
    if (Object.keys(changes).length > 0) {
      const kind: InventoryEvent["kind"] = changes.status ? "status_changed" : changes.listedPriceCents || changes.floorPriceCents ? "price_changed" : "updated";
      this.logEvent(id, kind, changes);
      this.audit("item.updated", "inventory_item", id, { fields: Object.keys(changes) });
    }
    this.persist();
    return after;
  }
  async setItemStatus(id: string, status: InventoryItem["status"]): Promise<InventoryItem> {
    const it = this.itemById(id);
    if (!canChangeItemStatus(it.status, status)) throw new ItemTransitionError(it.status, status);
    return this.updateItem(id, { status, ...(status === "sold" ? {} : {}) });
  }
  async deleteItem(id: string): Promise<void> {
    const it = this.itemById(id);
    if (this.s.orders.some((o) => o.itemId === id)) throw new DataError("conflict", "Cet article est lié à une commande : archivez-le plutôt.", 409);
    this.s.items = this.s.items.filter((i) => i.id !== id);
    this.s.itemEvents = this.s.itemEvents.filter((e) => e.itemId !== id);
    this.audit("item.deleted", "inventory_item", id, { title: it.title });
    this.persist();
  }
  async bulkItems(action: BulkItemAction): Promise<{ affected: number }> {
    let affected = 0;
    for (const id of action.ids) {
      const it = this.s.items.find((i) => i.id === id);
      if (!it) continue;
      try {
        switch (action.action) {
          case "archive": if (it.status !== "archived") { await this.updateItem(id, { status: "archived" }); affected++; } break;
          case "restore": if (it.status === "archived") { await this.updateItem(id, { status: "in_stock" }); affected++; } break;
          case "set_status": if (action.status && action.status !== it.status) { await this.updateItem(id, { status: action.status }); affected++; } break;
          case "set_floor_margin": if (action.floorMarginCents !== undefined) { await this.updateItem(id, { floorPriceCents: it.purchasePriceCents + it.purchaseFeesCents + action.floorMarginCents }); affected++; } break;
          case "add_tag": if (action.tag && !it.tags.includes(action.tag)) { await this.updateItem(id, { tags: [...it.tags, action.tag] }); affected++; } break;
          case "delete": await this.deleteItem(id); affected++; break;
        }
      } catch {
        // une ligne en échec n'interrompt pas le lot ; elle n'est pas comptée
      }
    }
    this.audit("item.bulk", "inventory_item", null, { action: action.action, affected });
    this.persist();
    return { affected };
  }
  async importItems(items: InventoryItemCreate[]): Promise<{ created: number }> {
    let created = 0;
    for (const input of items) {
      const it = await this.createItem(input);
      this.logEvent(it.id, "imported", {}, "Import CSV");
      created++;
    }
    this.audit("item.imported", "inventory_item", null, { created });
    this.persist();
    return { created };
  }
  async exportItemsCsv(): Promise<string> {
    this.usage("export.csv", { kind: "items" });
    this.persist();
    return toCsv([EXPORT_HEADERS, ...this.s.items.map((i) => inventoryToCsvRow(i))]);
  }
  async itemHistory(id: string): Promise<InventoryEvent[]> {
    return this.s.itemEvents.filter((e) => e.itemId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---------- clients ----------
  private customerStats(id: string) {
    const orders = this.s.orders.filter((o) => o.customerId === id && o.status !== "cancelled" && o.status !== "refunded");
    return { orderCount: orders.length, revenueCents: orders.reduce((s, o) => s + o.salePriceCents, 0), marginCents: orders.reduce((s, o) => s + orderMargin(o).marginCents, 0) };
  }
  async listCustomers(query: Partial<CustomerQuery>) {
    let list = this.s.customers.map((c) => ({ ...c, ...this.customerStats(c.id) }));
    if (query.q) {
      const q = norm(query.q);
      list = list.filter((c) => norm(c.displayName).includes(q) || norm(c.handle).includes(q) || norm(c.city).includes(q));
    }
    if (query.tag) list = list.filter((c) => c.tags.includes(query.tag!));
    switch (query.sort ?? "last_contact_desc") {
      case "name_asc": list.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr")); break;
      case "orders_desc": list.sort((a, b) => b.orderCount - a.orderCount); break;
      default: list.sort((a, b) => (b.lastContactAt ?? "").localeCompare(a.lastContactAt ?? ""));
    }
    return paginate(list, query.page, query.pageSize);
  }
  async getCustomerTimeline(id: string): Promise<CustomerTimeline> {
    const customer = this.customerById(id);
    const conversations = this.s.conversations.filter((c) => c.customerId === id).sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    const orders = this.s.orders.filter((o) => o.customerId === id).map((o) => ({ ...o, item: this.s.items.find((i) => i.id === o.itemId) ?? null }));
    const events: CustomerTimeline["events"] = [{ at: customer.createdAt, kind: "created", label: "Fiche créée" }];
    for (const c of conversations) for (const m of this.s.messages.filter((m) => m.conversationId === c.id)) events.push({ at: m.createdAt, kind: "message", label: `${m.direction === "inbound" ? "Message reçu" : "Message envoyé"} : ${m.body.slice(0, 80)}`, to: `/app/messages/${c.id}` });
    for (const o of orders) events.push({ at: o.createdAt, kind: "order", label: `Commande ${o.item?.title ?? ""} — ${o.status}`, to: `/app/orders/${o.id}` });
    events.sort((a, b) => b.at.localeCompare(a.at));
    const stats = this.customerStats(id);
    return { customer, conversations, orders, events, totals: { orders: stats.orderCount, revenueCents: stats.revenueCents, marginCents: stats.marginCents } };
  }
  async createCustomer(input: CustomerCreate): Promise<Customer> {
    const parsed = customerCreateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Client invalide", 400, parsed.error.flatten());
    const dup = this.s.customers.find((c) => parsed.data.handle && norm(c.handle) === norm(parsed.data.handle) && c.provider === parsed.data.provider);
    if (dup) throw new DataError("conflict", `Un client avec le pseudo « ${parsed.data.handle} » existe déjà.`, 409, { existingId: dup.id });
    const now = this.now();
    const c: Customer = { ...parsed.data, id: newId(), orgId: this.s.org.id, createdAt: now, updatedAt: now };
    this.s.customers.unshift(c);
    this.audit("customer.created", "customer", c.id, {});
    this.persist();
    return c;
  }
  async updateCustomer(id: string, input: CustomerUpdate): Promise<Customer> {
    const c = this.customerById(id);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<Customer>;
    const after = { ...c, ...patch, updatedAt: this.now() };
    this.s.customers[this.s.customers.findIndex((x) => x.id === id)] = after;
    this.audit("customer.updated", "customer", id, { fields: Object.keys(patch) });
    this.persist();
    return after;
  }
  async mergeCustomers(keepId: string, mergeId: string): Promise<Customer> {
    const keep = this.customerById(keepId);
    const merge = this.customerById(mergeId);
    for (const c of this.s.conversations) if (c.customerId === mergeId) c.customerId = keepId;
    for (const o of this.s.orders) if (o.customerId === mergeId) o.customerId = keepId;
    keep.tags = [...new Set([...keep.tags, ...merge.tags])];
    keep.notes = [keep.notes, merge.notes].filter(Boolean).join("\n");
    keep.lastContactAt = [keep.lastContactAt, merge.lastContactAt].filter(Boolean).sort().pop() ?? null;
    this.s.customers = this.s.customers.filter((c) => c.id !== mergeId);
    this.audit("customer.merged", "customer", keepId, { mergedId: mergeId });
    this.persist();
    return keep;
  }

  // ---------- messagerie ----------
  async listConversations(query: Partial<ConversationQuery>) {
    let list = this.s.conversations.map((c) => ({ ...c, customer: this.customerById(c.customerId), item: c.itemId ? this.s.items.find((i) => i.id === c.itemId) ?? null : null }));
    list = list.filter((c) => c.status === (query.status ?? "open"));
    if (query.unread) list = list.filter((c) => c.unreadCount > 0);
    if (query.itemId) list = list.filter((c) => c.itemId === query.itemId);
    if (query.customerId) list = list.filter((c) => c.customerId === query.customerId);
    if (query.q) {
      const q = norm(query.q);
      list = list.filter((c) => norm(c.customer.displayName).includes(q) || norm(c.item?.title).includes(q) || norm(c.lastMessagePreview).includes(q));
    }
    list.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    return paginate(list, query.page, query.pageSize ?? 50);
  }
  async getConversation(id: string): Promise<ConversationDetail> {
    const conversation = this.convById(id);
    const messages = this.s.messages.filter((m) => m.conversationId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { conversation, messages, customer: this.customerById(conversation.customerId), item: conversation.itemId ? this.s.items.find((i) => i.id === conversation.itemId) ?? null : null, connection: this.s.connections.find((c) => c.id === conversation.connectionId) ?? null, lastOffer: this.lastOffer(conversation) };
  }
  async markConversationRead(id: string): Promise<void> {
    const c = this.convById(id);
    if (c.unreadCount === 0) return;
    c.unreadCount = 0;
    const now = this.now();
    for (const m of this.s.messages) if (m.conversationId === id && m.direction === "inbound" && !m.readAt) m.readAt = now;
    this.persist();
  }
  async setConversationStatus(id: string, status: Conversation["status"]): Promise<void> {
    const c = this.convById(id);
    c.status = status;
    c.updatedAt = this.now();
    this.persist();
  }
  async createDraft(input: { conversationId: string; body: string; offerCents?: number | null }): Promise<Message> {
    const conv = this.convById(input.conversationId);
    const body = sanitizeUntrustedText(input.body, 4000);
    if (!body) throw new DataError("validation", "Le message est vide.", 400);
    const m: Message = { id: newId(), orgId: this.s.org.id, conversationId: conv.id, direction: "outbound", source: "user", status: "draft", body, offerCents: input.offerCents ?? null, aiRequestId: null, ruleId: null, externalRef: null, error: null, simulated: false, createdAt: this.now(), sentAt: null, readAt: null };
    this.s.messages.push(m);
    this.persist();
    return m;
  }
  async updateDraft(messageId: string, body: string): Promise<Message> {
    const m = this.s.messages.find((x) => x.id === messageId);
    if (!m) throw new DataError("not_found", "Brouillon introuvable", 404);
    if (m.status !== "draft" && m.status !== "failed") throw new DataError("conflict", "Seul un brouillon (ou un envoi en échec) peut être modifié.", 409);
    m.body = sanitizeUntrustedText(body, 4000);
    m.status = "draft";
    m.error = null;
    this.persist();
    return m;
  }
  async deleteDraft(messageId: string): Promise<void> {
    const m = this.s.messages.find((x) => x.id === messageId);
    if (!m) return;
    if (m.status !== "draft" && m.status !== "failed") throw new DataError("conflict", "Seul un brouillon peut être supprimé.", 409);
    this.s.messages = this.s.messages.filter((x) => x.id !== messageId);
    this.persist();
  }
  async sendMessage(messageId: string): Promise<Message> {
    const m = this.s.messages.find((x) => x.id === messageId);
    if (!m) throw new DataError("not_found", "Message introuvable", 404);
    if (m.status === "sent" || m.status === "pending") throw new DataError("conflict", "Ce message est déjà envoyé ou en cours d'envoi.", 409);
    const conv = this.convById(m.conversationId);
    const connection = this.s.connections.find((c) => c.id === conv.connectionId);
    const connector = getConnector(connection?.provider ?? "demo");
    const sendCap = connection?.capabilities.find((c) => c.capability === "send_message");
    if (!connection || !connector.sendMessage || !sendCap || sendCap.state === "unavailable" || connection.status === "disconnected" || connection.status === "expired") {
      m.status = "failed";
      m.error = !connection ? "Aucune connexion associée à cette conversation." : sendCap?.state === "unavailable" ? "Ce connecteur ne permet pas l'envoi automatique : utilisez l'extension pour valider le message dans Vinted." : `Connexion « ${connection.label} » ${connection.status === "expired" ? "expirée" : "déconnectée"}.`;
      this.persist();
      return m;
    }
    m.status = "pending";
    this.persist();
    await this.delay(400);
    const result = await connector.sendMessage({ orgId: this.s.org.id, connectionId: connection.id, config: connection.config, now: this.clock() }, { conversationRef: conv.externalRef ?? conv.id, body: m.body, idempotencyKey: m.id });
    if (result.ok) {
      m.status = "sent";
      m.sentAt = result.data.sentAt;
      m.externalRef = result.data.externalRef;
      m.simulated = result.simulated;
      m.error = null;
      conv.lastMessageAt = m.sentAt;
      conv.lastMessagePreview = m.body.slice(0, 120);
      conv.updatedAt = m.sentAt;
      if (m.offerCents !== null && m.source !== "buyer") conv.negotiationRounds += 1;
      const customer = this.customerById(conv.customerId);
      customer.lastContactAt = m.sentAt;
    } else {
      m.status = "failed";
      m.error = result.message;
    }
    this.audit("message.sent", "message", m.id, { status: m.status, simulated: m.simulated });
    this.persist();
    return m;
  }
  async evaluateOffer(conversationId: string, offerCents: number): Promise<NegotiationResult> {
    const conv = this.convById(conversationId);
    if (!conv.itemId) throw new DataError("validation", "Cette conversation n'est liée à aucun article.", 400);
    const item = this.itemById(conv.itemId);
    return evaluateOffer({ item, offerCents, rules: this.margin(), roundsSoFar: conv.negotiationRounds, now: this.clock() });
  }
  async suggestReply(conversationId: string): Promise<SuggestionResult> {
    const st = this.s;
    const detail = await this.getConversation(conversationId);
    if (!st.org.settings.ai.enabled) throw new DataError("ai_unavailable", "L'assistant IA est désactivé dans les paramètres.", 409);
    const monthKey = this.now().slice(0, 7);
    const used = st.aiRequests.filter((r) => r.createdAt.startsWith(monthKey)).length;
    const quota = Math.min(st.subscription.quotas.aiRequestsPerMonth, st.org.settings.ai.monthlyRequestQuota || Infinity);
    if (used >= quota) throw new DataError("quota_exceeded", `Quota IA mensuel atteint (${quota}).`, 402);
    const item = detail.item;
    const evaluation = detail.lastOffer?.evaluation ?? null;
    const inbound = detail.messages.filter((m) => m.direction === "inbound");
    const suspicious = inbound.some((m) => scanForInjection(m.body).suspicious);
    const started = Date.now();
    const req: AiRequest = { id: newId(), orgId: st.org.id, kind: "reply_suggestion", provider: "mock", model: "selio-mock-v1", status: "running", conversationId, itemId: item?.id ?? null, promptTokens: 0, outputTokens: 0, latencyMs: 0, validated: false, rejectionReason: null, error: null, createdAt: this.now(), finishedAt: null };
    st.aiRequests.unshift(req);
    const result = await this.ai.suggestReply(st.org.id, {
      buyerName: detail.customer.displayName.split(" ")[0] ?? null,
      itemTitle: item?.title ?? "l'article",
      listedPriceCents: item?.listedPriceCents ?? null,
      floorPriceCents: item?.floorPriceCents ?? 0,
      purchasePriceCents: item?.purchasePriceCents ?? 0,
      decision: evaluation,
      offerCents: detail.lastOffer?.offerCents ?? null,
      messages: detail.messages.map((m) => ({ direction: m.direction, body: m.body })),
      settings: { tone: st.org.settings.ai.tone, signature: st.org.settings.ai.signature },
    });
    req.status = result.validated ? "succeeded" : "rejected";
    req.promptTokens = result.usage.promptTokens;
    req.outputTokens = result.usage.outputTokens;
    req.latencyMs = Math.max(result.latencyMs, Date.now() - started);
    req.validated = result.validated;
    req.rejectionReason = result.rejectionReason;
    req.finishedAt = this.now();
    this.usage("ai.request", { requestId: req.id, suspicious });
    const draft: Message = { id: newId(), orgId: st.org.id, conversationId, direction: "outbound", source: "ai", status: "draft", body: result.suggestion.reply, offerCents: result.suggestion.proposedPriceCents, aiRequestId: req.id, ruleId: null, externalRef: null, error: null, simulated: false, createdAt: this.now(), sentAt: null, readAt: null };
    st.messages.push(draft);
    this.persist();
    return { draft, suggestion: result.suggestion, evaluation, source: result.source, provider: result.provider, model: result.model, validated: result.validated, rejectionReason: result.rejectionReason, simulated: true };
  }
  async simulateIncomingMessage(conversationId: string | null, body?: string): Promise<Conversation> {
    const st = this.s;
    const now = this.now();
    let conv: Conversation;
    if (conversationId) conv = this.convById(conversationId);
    else {
      const connector = getConnector("demo");
      const res = await connector.readConversations!({ orgId: st.org.id, connectionId: "conn-demo", config: {}, now: this.clock() });
      const ext = res.ok ? res.data[0]! : null;
      const listed = st.items.filter((i) => i.status === "listed");
      const item = listed[hashString(now) % Math.max(1, listed.length)] ?? null;
      let customer = ext ? st.customers.find((c) => c.handle === ext.buyerHandle) : undefined;
      if (!customer) {
        customer = { id: newId(), orgId: st.org.id, displayName: ext?.buyerHandle ?? "Acheteur", handle: ext?.buyerHandle ?? null, provider: "demo", externalRef: null, notes: "", tags: [], city: null, firstContactAt: now, lastContactAt: now, createdAt: now, updatedAt: now };
        st.customers.unshift(customer);
      }
      conv = { id: newId(), orgId: st.org.id, customerId: customer.id, itemId: item?.id ?? null, connectionId: "conn-demo", provider: "demo", externalRef: ext?.externalRef ?? null, status: "open", unreadCount: 0, negotiationRounds: 0, lastMessageAt: null, lastMessagePreview: "", createdAt: now, updatedAt: now };
      st.conversations.unshift(conv);
      body = body ?? ext?.messages[0]?.body ?? "Bonjour, est-ce toujours disponible ?";
    }
    const text = sanitizeUntrustedText(body ?? "Bonjour, est-ce toujours disponible ?", 2000);
    const m: Message = { id: newId(), orgId: st.org.id, conversationId: conv.id, direction: "inbound", source: "buyer", status: "received", body: text, offerCents: extractOfferCents(text), aiRequestId: null, ruleId: null, externalRef: `sim-${newId().slice(0, 8)}`, error: null, simulated: true, createdAt: now, sentAt: null, readAt: null };
    st.messages.push(m);
    conv.unreadCount += 1;
    conv.lastMessageAt = now;
    conv.lastMessagePreview = text.slice(0, 120);
    conv.updatedAt = now;
    conv.status = "open";
    this.customerById(conv.customerId).lastContactAt = now;
    this.persist();
    return conv;
  }

  // ---------- commandes ----------
  async listOrders(query: Partial<OrderQuery>) {
    let list = this.s.orders.map((o) => ({ ...o, item: this.s.items.find((i) => i.id === o.itemId) ?? null, customer: this.s.customers.find((c) => c.id === o.customerId) ?? null }));
    if (query.status) list = list.filter((o) => o.status === query.status);
    if (query.customerId) list = list.filter((o) => o.customerId === query.customerId);
    if (query.itemId) list = list.filter((o) => o.itemId === query.itemId);
    if (query.q) {
      const q = norm(query.q);
      list = list.filter((o) => norm(o.item?.title).includes(q) || norm(o.customer?.displayName).includes(q) || norm(o.externalRef).includes(q));
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(list, query.page, query.pageSize);
  }
  async getOrder(id: string) {
    const order = this.orderById(id);
    return { order, item: this.s.items.find((i) => i.id === order.itemId) ?? null, customer: this.s.customers.find((c) => c.id === order.customerId) ?? null, shipment: this.s.shipments.find((sh) => sh.orderId === id) ?? null, marginCents: orderMargin(order).marginCents };
  }
  async createOrder(input: OrderCreate): Promise<{ order: Order; created: boolean }> {
    const parsed = orderCreateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Commande invalide", 400, parsed.error.flatten());
    const st = this.s;
    const item = this.itemById(parsed.data.itemId);
    this.customerById(parsed.data.customerId);
    const now = this.now();
    const provider = st.connections.find((c) => c.id === item.connectionId)?.provider ?? "demo";
    const dedupeKey = orderDedupeKey({ provider, externalRef: parsed.data.externalRef ?? null, itemId: item.id, customerId: parsed.data.customerId, day: localDayKey(this.clock(), st.org.settings.timezone) });
    const existing = st.orders.find((o) => o.dedupeKey === dedupeKey);
    if (existing) return { order: existing, created: false };
    if (item.status === "sold") throw new DataError("conflict", "Cet article est déjà vendu.", 409);
    const status = parsed.data.status ?? "pending";
    const order: Order = {
      id: newId(), orgId: st.org.id, itemId: item.id, customerId: parsed.data.customerId, conversationId: parsed.data.conversationId ?? null, connectionId: item.connectionId, provider, externalRef: parsed.data.externalRef ?? null, dedupeKey, status,
      salePriceCents: parsed.data.salePriceCents, platformFeeCents: parsed.data.platformFeeCents ?? 0, shippingCostCents: parsed.data.shippingCostCents ?? st.org.settings.margin.defaultShippingCostCents, otherCostsCents: parsed.data.otherCostsCents ?? 0,
      purchasePriceCents: item.purchasePriceCents, purchaseFeesCents: item.purchaseFeesCents,
      statusHistory: [{ status, at: now, note: null }], simulated: true, createdAt: now, updatedAt: now,
    };
    st.orders.unshift(order);
    const newStatus = itemStatusForOrder(status);
    if (canChangeItemStatus(item.status, newStatus)) await this.updateItem(item.id, { status: newStatus, ...(newStatus === "sold" ? {} : {}) });
    if (newStatus === "sold") { const it = this.itemById(item.id); it.soldAt = now; }
    this.audit("order.created", "order", order.id, { status });
    this.persist();
    return { order, created: true };
  }
  async updateOrder(id: string, input: Partial<Pick<Order, "salePriceCents" | "platformFeeCents" | "shippingCostCents" | "otherCostsCents">>): Promise<Order> {
    const o = this.orderById(id);
    Object.assign(o, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), { updatedAt: this.now() });
    this.audit("order.updated", "order", id, { fields: Object.keys(input) });
    this.persist();
    return o;
  }
  async transitionOrder(id: string, status: OrderStatus, note?: string): Promise<Order> {
    const o = this.orderById(id);
    let next: Order;
    try {
      next = transitionOrder(o, status, this.now(), note ?? null);
    } catch (e) {
      if (e instanceof OrderTransitionError) throw new DataError("validation", e.message, 400);
      throw e;
    }
    this.s.orders[this.s.orders.findIndex((x) => x.id === id)] = next;
    const item = this.s.items.find((i) => i.id === o.itemId);
    if (item) {
      const target = itemStatusForOrder(status);
      if (item.status !== target && canChangeItemStatus(item.status, target)) {
        await this.updateItem(item.id, { status: target });
        if (target === "sold") this.itemById(item.id).soldAt = next.updatedAt;
        if (target === "listed") this.itemById(item.id).soldAt = null;
      }
    }
    if (status === "shipped" && !this.s.shipments.some((sh) => sh.orderId === id)) {
      this.s.shipments.push({ id: newId(), orgId: this.s.org.id, orderId: id, carrier: null, trackingNumber: null, status: "in_transit", document: null, createdAt: next.updatedAt, updatedAt: next.updatedAt });
    }
    this.audit("order.transition", "order", id, { status });
    this.persist();
    return next;
  }
  async updateShipment(orderId: string, input: Partial<Pick<Shipment, "carrier" | "trackingNumber" | "status">>): Promise<Shipment> {
    this.orderById(orderId);
    let sh = this.s.shipments.find((x) => x.orderId === orderId);
    if (!sh) {
      sh = { id: newId(), orgId: this.s.org.id, orderId, carrier: null, trackingNumber: null, status: "pending", document: null, createdAt: this.now(), updatedAt: this.now() };
      this.s.shipments.push(sh);
    }
    Object.assign(sh, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), { updatedAt: this.now() });
    this.persist();
    return sh;
  }
  async requestShippingDocument(orderId: string): Promise<Shipment> {
    const o = this.orderById(orderId);
    const connection = this.s.connections.find((c) => c.id === o.connectionId);
    const connector = getConnector(connection?.provider ?? "demo");
    if (!connector.shippingDocument) throw new DataError("connector_unavailable", "Ce connecteur ne fournit pas de document d'expédition.", 409);
    const res = await connector.shippingDocument({ orgId: this.s.org.id, connectionId: connection?.id ?? "", config: connection?.config ?? {}, now: this.clock() }, { orderRef: o.externalRef ?? o.id });
    if (!res.ok) throw new DataError("connector_unavailable", res.message, 409);
    const sh = await this.updateShipment(orderId, { status: "label_ready" });
    sh.document = res.data;
    this.persist();
    return sh;
  }

  // ---------- analyses ----------
  async getOverview(period: PeriodPreset): Promise<OverviewData> {
    const st = this.s;
    const now = this.clock();
    const p = periodFromPreset(period, now);
    const prev = previousPeriod(p);
    const sales = salesKpis(st.orders, p);
    const previousSales = salesKpis(st.orders, prev);
    const stock = stockKpis(st.items, now);
    const series = salesSeries(st.orders, p, period === "7d" || period === "30d" ? "day" : period === "90d" ? "week" : "month");
    const open = st.conversations.filter((c) => c.status === "open");
    const alerts: OverviewData["alerts"] = [];
    for (const c of st.connections) {
      if (c.status === "expired" || c.status === "disconnected" || c.status === "degraded") alerts.push({ id: `conn-${c.id}`, tone: c.status === "degraded" ? "warning" : "danger", title: `Connexion « ${c.label} » ${c.status === "degraded" ? "dégradée" : c.status === "expired" ? "expirée" : "déconnectée"}`, description: c.lastError ?? "Vérifiez la connexion dans les paramètres.", to: "/app/settings/connections" });
      if (c.status === "ready") alerts.push({ id: `conn-ready-${c.id}`, tone: "info", title: `Connexion « ${c.label} » en attente de l'extension`, description: "Associez l'extension Selio pour activer la lecture des pages.", to: "/app/settings/connections" });
    }
    const failedJobs = st.jobs.filter((j) => j.status === "failed");
    if (failedJobs.length > 0) alerts.push({ id: "jobs-failed", tone: "danger", title: `${failedJobs.length} tâche(s) d'automatisation en échec`, description: failedJobs[0]!.error ?? "", to: "/app/automations?tab=jobs&status=failed" });
    const awaiting = st.jobs.filter((j) => j.status === "awaiting_approval");
    if (awaiting.length > 0) alerts.push({ id: "jobs-awaiting", tone: "warning", title: `${awaiting.length} action(s) automatique(s) à valider`, description: "Ces actions attendent votre validation avant exécution.", to: "/app/automations?tab=jobs&status=awaiting_approval" });
    if (st.automation.globalPaused) alerts.push({ id: "global-pause", tone: "warning", title: "Automatisations en arrêt global", description: "Aucune règle ne s'exécute tant que l'arrêt global est actif.", to: "/app/automations" });
    const staleItems = st.items.filter((i) => (i.status === "listed" || i.status === "in_stock") && daysInStock(i, now) > 45).slice(0, 5);
    return {
      period, sales, previousSales, stock, series,
      counts: { openConversations: open.length, unreadMessages: open.reduce((s, c) => s + c.unreadCount, 0), pendingOrders: st.orders.filter((o) => o.status === "pending" || o.status === "paid").length, jobsAwaiting: awaiting.length, jobsFailed: failedJobs.length },
      alerts,
      recentOrders: [...st.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
      recentConversations: [...open].sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")).slice(0, 5),
      staleItems,
    };
  }
  async getAnalytics(filters: AnalyticsFilters): Promise<AnalyticsData> {
    const st = this.s;
    const now = this.clock();
    const p = periodFromPreset(filters.period, now);
    const prev = previousPeriod(p);
    const itemMap = new Map(st.items.map((i) => [i.id, i]));
    let orders = st.orders;
    if (filters.category) orders = orders.filter((o) => itemMap.get(o.itemId)?.category === filters.category);
    if (filters.channel) orders = orders.filter((o) => o.provider === filters.channel);
    const granularity = filters.granularity ?? (filters.period === "7d" || filters.period === "30d" ? "day" : filters.period === "90d" ? "week" : "month");
    const inPeriod = orders.filter((o) => new Date(o.createdAt) >= p.from && new Date(o.createdAt) < p.to && (o.status !== "cancelled" && o.status !== "refunded"));
    return {
      period: filters.period,
      sales: salesKpis(orders, p),
      previousSales: salesKpis(orders, prev),
      stock: stockKpis(st.items, now, { period: p }),
      series: salesSeries(orders, p, granularity),
      byCategory: breakdownBy(orders, (o) => itemMap.get(o.itemId)?.category ?? "other", p),
      byChannel: breakdownBy(orders, (o) => o.provider, p),
      byBrand: breakdownBy(orders, (o) => itemMap.get(o.itemId)?.brand ?? "—", p).slice(0, 8),
      topItems: inPeriod.map((o) => ({ item: itemMap.get(o.itemId)!, order: o, marginCents: orderMargin(o).marginCents })).filter((x) => x.item).sort((a, b) => b.marginCents - a.marginCents).slice(0, 5),
    };
  }
  async exportAnalyticsCsv(filters: AnalyticsFilters): Promise<string> {
    const data = await this.getAnalytics(filters);
    const itemMap = new Map(this.s.items.map((i) => [i.id, i]));
    const p = periodFromPreset(filters.period, this.clock());
    const rows: (string | number | null)[][] = [["Date", "Article", "Marque", "Catégorie", "Canal", "Statut", "Prix de vente", "Frais plateforme", "Port vendeur", "Autres coûts", "Coût d'acquisition", "Marge brute", "Taux de marge"]];
    for (const o of this.s.orders.filter((o) => new Date(o.createdAt) >= p.from && new Date(o.createdAt) < p.to)) {
      const it = itemMap.get(o.itemId);
      if (filters.category && it?.category !== filters.category) continue;
      if (filters.channel && o.provider !== filters.channel) continue;
      const m = orderMargin(o);
      rows.push([o.createdAt.slice(0, 10), it?.title ?? "", it?.brand ?? "", it?.category ?? "", o.provider, o.status, (o.salePriceCents / 100).toFixed(2), (o.platformFeeCents / 100).toFixed(2), (o.shippingCostCents / 100).toFixed(2), (o.otherCostsCents / 100).toFixed(2), (m.acquisitionCents / 100).toFixed(2), (m.marginCents / 100).toFixed(2), (m.marginRate * 100).toFixed(1)]);
    }
    rows.push([]);
    rows.push(["Total CA", (data.sales.revenueCents / 100).toFixed(2)], ["Total marge brute", (data.sales.marginCents / 100).toFixed(2)], ["Commandes", data.sales.orderCount], ["Panier moyen", (data.sales.averageBasketCents / 100).toFixed(2)]);
    this.usage("export.csv", { kind: "analytics" });
    this.persist();
    return toCsv(rows);
  }

  // ---------- automatisations ----------
  async listRules(): Promise<AutomationRule[]> {
    return [...this.s.rules];
  }
  async createRule(input: AutomationRuleCreate): Promise<AutomationRule> {
    const parsed = automationRuleCreateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Règle invalide", 400, parsed.error.flatten());
    const now = this.now();
    const rule: AutomationRule = { ...parsed.data, id: newId(), orgId: this.s.org.id, lastRunAt: null, createdAt: now, updatedAt: now };
    this.s.rules.push(rule);
    this.audit("rule.created", "automation_rule", rule.id, { kind: rule.kind });
    this.persist();
    return rule;
  }
  async updateRule(id: string, input: Partial<AutomationRuleCreate>): Promise<AutomationRule> {
    const r = this.s.rules.find((x) => x.id === id);
    if (!r) throw new DataError("not_found", "Règle introuvable", 404);
    const merged = automationRuleCreateSchema.parse({ ...r, ...input, schedule: { ...r.schedule, ...(input.schedule ?? {}) }, limits: { ...r.limits, ...(input.limits ?? {}) }, config: { ...r.config, ...(input.config ?? {}) } });
    Object.assign(r, merged, { updatedAt: this.now() });
    this.audit("rule.updated", "automation_rule", id, { enabled: r.enabled });
    this.persist();
    return r;
  }
  async deleteRule(id: string): Promise<void> {
    this.s.rules = this.s.rules.filter((r) => r.id !== id);
    this.audit("rule.deleted", "automation_rule", id, {});
    this.persist();
  }
  async getAutomationState(): Promise<AutomationState> {
    const today = localDayKey(this.clock(), this.s.org.settings.timezone);
    return { globalPaused: this.s.automation.globalPaused, pausedAt: this.s.automation.pausedAt, actionsToday: this.s.jobs.filter((j) => j.status === "succeeded" && localDayKey(new Date(j.finishedAt ?? j.createdAt), this.s.org.settings.timezone) === today).length };
  }
  async setGlobalPause(paused: boolean): Promise<AutomationState> {
    this.s.automation = { globalPaused: paused, pausedAt: paused ? this.now() : null };
    this.audit(paused ? "automation.global_pause" : "automation.global_resume", null, null, {});
    this.persist();
    return this.getAutomationState();
  }
  private async executeJob(job: Job): Promise<void> {
    const rule = this.s.rules.find((r) => r.id === job.ruleId);
    job.status = "running";
    job.startedAt = this.now();
    job.attempts += 1;
    const conversationId = typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
    const itemId = typeof job.payload.itemId === "string" ? job.payload.itemId : null;
    try {
      if (job.kind === "automation.send_message" && conversationId && rule) {
        const conv = this.convById(conversationId);
        const customer = this.customerById(conv.customerId);
        const item = conv.itemId ? this.s.items.find((i) => i.id === conv.itemId) : null;
        const body = typeof job.payload.body === "string" ? job.payload.body : renderTemplate(rule.config.template ?? "Bonjour {{prenom}}, merci pour votre message.", { prenom: customer.displayName.split(" ")[0], article: item?.title ?? "l'article" });
        const draft: Message = { id: newId(), orgId: this.s.org.id, conversationId, direction: "outbound", source: "automation", status: "draft", body, offerCents: typeof job.payload.offerCents === "number" ? job.payload.offerCents : null, aiRequestId: null, ruleId: rule.id, externalRef: null, error: null, simulated: false, createdAt: this.now(), sentAt: null, readAt: null };
        this.s.messages.push(draft);
        const sent = await this.sendMessage(draft.id);
        if (sent.status !== "sent") throw new Error(sent.error ?? "Envoi refusé");
        job.result = { messageId: sent.id, simulated: sent.simulated };
      } else if (job.kind === "automation.evaluate" && itemId && rule?.kind === "price_drop_stale") {
        const item = this.itemById(itemId);
        const drop = rule.config.dropRate ?? 0.05;
        const next = Math.max(item.floorPriceCents ?? 0, Math.round((item.listedPriceCents ?? 0) * (1 - drop)));
        if (next < (item.listedPriceCents ?? 0)) await this.updateItem(itemId, { listedPriceCents: next });
        job.result = { from: item.listedPriceCents, to: next };
      } else {
        job.result = { noop: true };
      }
      job.status = "succeeded";
      job.error = null;
      this.usage("automation.action", { jobId: job.id });
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e);
      job.status = job.attempts >= job.maxAttempts ? "failed" : "queued";
      if (job.status === "queued") job.scheduledFor = new Date(this.clock().getTime() + 60_000 * 2 ** job.attempts).toISOString();
    }
    job.finishedAt = this.now();
    job.updatedAt = job.finishedAt;
  }
  async runRuleNow(id: string): Promise<{ evaluated: number; created: number; skipped: { reason: string; count: number }[] }> {
    const st = this.s;
    const rule = st.rules.find((r) => r.id === id);
    if (!rule) throw new DataError("not_found", "Règle introuvable", 404);
    const now = this.clock();
    const skipped = new Map<string, number>();
    const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
    const today = localDayKey(now, rule.schedule.timezone);
    const actionsToday = st.jobs.filter((j) => j.ruleId === rule.id && j.status === "succeeded" && localDayKey(new Date(j.createdAt), rule.schedule.timezone) === today).length;
    let evaluated = 0, created = 0;
    const targets: { targetId: string; payload: Record<string, unknown>; kind: Job["kind"] }[] = [];
    if (rule.kind === "reply_on_new_message" || rule.kind === "follow_up_no_reply" || rule.kind === "auto_negotiate" || rule.kind === "post_sale_message") {
      for (const conv of st.conversations.filter((c) => c.status === "open")) {
        evaluated++;
        const msgs = st.messages.filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const last = msgs[msgs.length - 1];
        if (!last) continue;
        if (rule.kind === "reply_on_new_message" && !(last.direction === "inbound" && conv.unreadCount > 0)) { skip("Pas de nouveau message non lu"); continue; }
        if (rule.kind === "follow_up_no_reply") {
          const hours = (now.getTime() - new Date(last.createdAt).getTime()) / 3_600_000;
          if (!(last.direction === "outbound" && hours >= (rule.config.delayHours ?? 48))) { skip("Délai de relance non atteint"); continue; }
        }
        if (rule.kind === "auto_negotiate") {
          const offer = this.lastOffer(conv);
          if (!offer || last.direction !== "inbound" || !last.offerCents) { skip("Aucune offre à traiter"); continue; }
          const ev = offer.evaluation;
          if (ev.decision === "hold" || ev.decision === "escalate") { skip(`Politique : ${ev.decision}`); continue; }
          const customer = this.customerById(conv.customerId);
          const item = conv.itemId ? this.itemById(conv.itemId) : null;
          const fmt = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
          const body = ev.decision === "accept" ? `Bonjour ${customer.displayName.split(" ")[0]}, c'est d'accord pour ${fmt(offer.offerCents)}. Faites l'offre sur l'annonce et je l'accepte.` : ev.decision === "counter" ? `Bonjour ${customer.displayName.split(" ")[0]}, merci pour votre proposition. Je peux descendre à ${fmt(ev.counterCents!)}, c'est mon meilleur prix pour ${item?.title ?? "cet article"}.` : `Bonjour ${customer.displayName.split(" ")[0]}, merci pour l'intérêt. Je ne peux pas descendre à ce prix, l'article reste disponible au prix affiché.`;
          targets.push({ targetId: conv.id, kind: "automation.send_message", payload: { conversationId: conv.id, customerId: conv.customerId, body, offerCents: ev.decision === "counter" ? ev.counterCents : ev.decision === "accept" ? offer.offerCents : null, decision: ev.decision, reasons: ev.reasons, ruleName: rule.name } });
          continue;
        }
        if (rule.kind === "post_sale_message") {
          const order = st.orders.find((o) => o.conversationId === conv.id || (o.customerId === conv.customerId && o.itemId === conv.itemId));
          if (!order || (order.status !== "paid" && order.status !== "shipped")) { skip("Pas de vente récente"); continue; }
        }
        targets.push({ targetId: conv.id, kind: "automation.send_message", payload: { conversationId: conv.id, customerId: conv.customerId, ruleName: rule.name } });
      }
    } else if (rule.kind === "price_drop_stale" || rule.kind === "relist_stale") {
      for (const item of st.items.filter((i) => i.status === "listed")) {
        evaluated++;
        if (daysInStock(item, now) < (rule.config.staleDays ?? 45)) { skip("Article pas encore dormant"); continue; }
        if (rule.kind === "price_drop_stale" && (item.listedPriceCents ?? 0) <= (item.floorPriceCents ?? 0)) { skip("Déjà au prix plancher"); continue; }
        targets.push({ targetId: item.id, kind: "automation.evaluate", payload: { itemId: item.id, ruleName: rule.name } });
      }
    }
    let actions = actionsToday;
    let lastActionAt: Date | null = null;
    for (const t of targets) {
      const customerId = typeof t.payload.customerId === "string" ? t.payload.customerId : null;
      const actionsForCustomer = customerId ? st.jobs.filter((j) => j.ruleId === rule.id && j.payload.customerId === customerId && localDayKey(new Date(j.createdAt), rule.schedule.timezone) === today && j.status !== "cancelled").length : undefined;
      const gate = gateRule({ rule, globalPaused: st.automation.globalPaused, now, actionsToday: actions, actionsTodayForCustomer: actionsForCustomer, lastActionAt });
      if (!gate.allowed) { skip(gate.reason); continue; }
      const dedupeKey = jobDedupeKey(rule, t.targetId, now);
      if (st.jobs.some((j) => j.dedupeKey === dedupeKey)) { skip("Déjà planifié aujourd'hui (idempotence)"); continue; }
      const job: Job = { id: newId(), orgId: st.org.id, kind: t.kind, status: rule.requiresApproval ? "awaiting_approval" : "queued", dedupeKey, ruleId: rule.id, payload: t.payload, result: null, error: null, attempts: 0, maxAttempts: 3, runsIn: rule.runsIn, scheduledFor: this.now(), startedAt: null, finishedAt: null, createdAt: this.now(), updatedAt: this.now() };
      st.jobs.unshift(job);
      created++;
      actions++;
      lastActionAt = now;
      if (job.status === "queued") await this.executeJob(job);
    }
    rule.lastRunAt = this.now();
    this.audit("rule.run", "automation_rule", rule.id, { evaluated, created });
    this.persist();
    return { evaluated, created, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })) };
  }
  async listJobs(query: Partial<JobQuery>): Promise<Page<Job>> {
    let list = [...this.s.jobs];
    if (query.status) list = list.filter((j) => j.status === query.status);
    if (query.kind) list = list.filter((j) => j.kind === query.kind);
    if (query.ruleId) list = list.filter((j) => j.ruleId === query.ruleId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(list, query.page, query.pageSize);
  }
  async approveJob(id: string): Promise<Job> {
    const job = this.s.jobs.find((j) => j.id === id);
    if (!job) throw new DataError("not_found", "Tâche introuvable", 404);
    if (job.status !== "awaiting_approval") throw new DataError("conflict", "Cette tâche n'attend pas de validation.", 409);
    await this.executeJob(job);
    this.audit("job.approved", "job", id, { status: job.status });
    this.persist();
    return job;
  }
  async cancelJob(id: string): Promise<Job> {
    const job = this.s.jobs.find((j) => j.id === id);
    if (!job) throw new DataError("not_found", "Tâche introuvable", 404);
    if (job.status === "succeeded" || job.status === "running") throw new DataError("conflict", "Impossible d'annuler une tâche terminée ou en cours.", 409);
    job.status = "cancelled";
    job.updatedAt = this.now();
    this.audit("job.cancelled", "job", id, {});
    this.persist();
    return job;
  }
  async retryJob(id: string): Promise<Job> {
    const job = this.s.jobs.find((j) => j.id === id);
    if (!job) throw new DataError("not_found", "Tâche introuvable", 404);
    if (job.status !== "failed") throw new DataError("conflict", "Seule une tâche en échec peut être relancée.", 409);
    job.attempts = 0;
    await this.executeJob(job);
    this.audit("job.retried", "job", id, { status: job.status });
    this.persist();
    return job;
  }

  // ---------- radar ----------
  async listSearches(): Promise<RadarSearch[]> {
    return [...this.s.searches];
  }
  async createSearch(input: RadarSearchCreate): Promise<RadarSearch> {
    const parsed = radarSearchCreateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Recherche invalide", 400, parsed.error.flatten());
    const now = this.now();
    const s: RadarSearch = { ...parsed.data, id: newId(), orgId: this.s.org.id, lastRunAt: null, createdAt: now, updatedAt: now };
    this.s.searches.unshift(s);
    this.audit("radar.search_created", "radar_search", s.id, {});
    this.persist();
    return s;
  }
  async updateSearch(id: string, input: Partial<RadarSearchCreate>): Promise<RadarSearch> {
    const s = this.s.searches.find((x) => x.id === id);
    if (!s) throw new DataError("not_found", "Recherche introuvable", 404);
    const merged = radarSearchCreateSchema.parse({ ...s, ...input, criteria: { ...s.criteria, ...(input.criteria ?? {}) } });
    Object.assign(s, merged, { updatedAt: this.now() });
    this.persist();
    return s;
  }
  async deleteSearch(id: string): Promise<void> {
    this.s.searches = this.s.searches.filter((s) => s.id !== id);
    this.s.opportunities = this.s.opportunities.filter((o) => o.searchId !== id);
    this.audit("radar.search_deleted", "radar_search", id, {});
    this.persist();
  }
  async runSearch(id: string): Promise<{ found: number }> {
    const st = this.s;
    const search = st.searches.find((x) => x.id === id);
    if (!search) throw new DataError("not_found", "Recherche introuvable", 404);
    await this.delay(500);
    const now = this.clock();
    const rnd = seededRandom(hashString(search.id + localDayKey(now, st.org.settings.timezone) + st.opportunities.length));
    const brands = search.criteria.brands.length ? search.criteria.brands : ["Nike", "Zara", "Levi's"];
    const cats = search.criteria.categories.length ? search.criteria.categories : (["shoes", "men", "women"] as const);
    const comps = comparablesFromSales(st.orders, new Map(st.items.map((i) => [i.id, i])));
    const count = 1 + Math.floor(rnd() * 3);
    let found = 0;
    for (let i = 0; i < count; i++) {
      const brand = brands[Math.floor(rnd() * brands.length)]!;
      const category = cats[Math.floor(rnd() * cats.length)]!;
      const conditions = search.criteria.conditions.length ? search.criteria.conditions : (["very_good", "good", "satisfactory"] as const);
      const condition = conditions[Math.floor(rnd() * conditions.length)]!;
      const priceCents = Math.round((search.criteria.maxPriceCents * (0.5 + rnd() * 0.6)) / 100) * 100;
      const shippingCents = 450 + Math.floor(rnd() * 3) * 100;
      const size = search.criteria.sizes.length ? search.criteria.sizes[Math.floor(rnd() * search.criteria.sizes.length)]! : "M";
      const seenAt = new Date(now.getTime() - Math.floor(rnd() * 20) * 3_600_000).toISOString();
      const est = estimateResale({ priceCents, brand, category, condition }, comps);
      const scored = scoreOpportunity({ priceCents, shippingCents, seenAt }, est, search, 0, now);
      const title = `${brand} ${search.criteria.keywords[0] ?? (category === "shoes" ? "sneakers" : "pièce")} ${size}`;
      const dedupe = `${search.id}:${title}:${priceCents}`;
      if (st.opportunities.some((o) => o.searchId === search.id && `${search.id}:${o.title}:${o.observed.priceCents}` === dedupe)) continue;
      st.opportunities.unshift({ id: newId(), orgId: st.org.id, searchId: search.id, title, observed: { priceCents, shippingCents, brand, size, condition, category, sellerHandle: `vendeur_${Math.floor(rnd() * 900 + 100)}`, url: `https://demo.invalid/items/${Math.floor(rnd() * 90000)}`, seenAt, source: "demo_simulator" }, estimate: { resalePriceCents: est.resalePriceCents, expectedFeesCents: 0, marginCents: scored.marginCents, marginRate: scored.marginRate, confidence: est.confidence, method: est.method, comparableCount: est.comparableCount }, score: scored.score, reasons: scored.reasons, status: "new", createdAt: seenAt, updatedAt: this.now() });
      found++;
    }
    search.lastRunAt = this.now();
    this.usage("connector.sync", { kind: "radar", searchId: id });
    this.audit("radar.run", "radar_search", id, { found });
    this.persist();
    return { found };
  }
  async listOpportunities(query: { searchId?: string; status?: Opportunity["status"] }): Promise<Opportunity[]> {
    let list = this.s.opportunities;
    if (query.searchId) list = list.filter((o) => o.searchId === query.searchId);
    if (query.status) list = list.filter((o) => o.status === query.status);
    return rankOpportunities(list);
  }
  async setOpportunityStatus(id: string, status: Opportunity["status"]): Promise<Opportunity> {
    const o = this.s.opportunities.find((x) => x.id === id);
    if (!o) throw new DataError("not_found", "Opportunité introuvable", 404);
    o.status = status;
    o.updatedAt = this.now();
    this.persist();
    return o;
  }

  // ---------- achat assisté ----------
  async listPurchaseRequests() {
    return [...this.s.purchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ ...p, opportunity: this.s.opportunities.find((o) => o.id === p.opportunityId) ?? null }));
  }
  async createPurchaseRequest(input: { opportunityId: string; maxPriceCents: number; budgetCents: number }): Promise<PurchaseRequest> {
    const opp = this.s.opportunities.find((o) => o.id === input.opportunityId);
    if (!opp) throw new DataError("not_found", "Opportunité introuvable", 404);
    const dedupeKey = `purchase:${opp.id}`;
    const existing = this.s.purchases.find((p) => p.dedupeKey === dedupeKey && p.status !== "cancelled" && p.status !== "blocked");
    if (existing) throw new DataError("conflict", "Une demande d'achat existe déjà pour cette opportunité (prévention des doublons).", 409, { existingId: existing.id });
    const now = this.now();
    const p: PurchaseRequest = { id: newId(), orgId: this.s.org.id, opportunityId: opp.id, dedupeKey, maxPriceCents: input.maxPriceCents, budgetCents: input.budgetCents, status: "awaiting_confirmation", checks: [], realPurchaseEnabled: false, confirmedAt: null, executedAt: null, resultNote: null, createdAt: now, updatedAt: now };
    this.s.purchases.unshift(p);
    this.audit("purchase.requested", "purchase_request", p.id, {});
    this.persist();
    return p;
  }
  async confirmPurchaseRequest(id: string): Promise<PurchaseRequest> {
    const p = this.s.purchases.find((x) => x.id === id);
    if (!p) throw new DataError("not_found", "Demande introuvable", 404);
    if (p.status !== "awaiting_confirmation") throw new DataError("conflict", "Cette demande n'est plus en attente de confirmation.", 409);
    const opp = this.s.opportunities.find((o) => o.id === p.opportunityId)!;
    p.confirmedAt = this.now();
    const today = localDayKey(this.clock(), this.s.org.settings.timezone);
    const spentToday = this.s.purchases.filter((x) => x.id !== p.id && (x.status === "simulated" || x.status === "executed") && (x.executedAt ?? "").startsWith(today)).reduce((s, x) => s + x.maxPriceCents, 0);
    const checks = runPurchaseChecks({ opportunity: opp, request: p, spentTodayCents: spentToday, dailyBudgetCents: 50_000, duplicateExists: this.s.purchases.some((x) => x.id !== p.id && x.opportunityId === p.opportunityId && (x.status === "simulated" || x.status === "executed")), connectorAllowsPurchase: false });
    p.checks = checks.map(({ code, ok, label }) => ({ code, ok, label }));
    const outcome = purchaseOutcome(checks, p.realPurchaseEnabled);
    p.status = outcome;
    p.executedAt = outcome === "blocked" ? null : this.now();
    p.resultNote = outcome === "blocked" ? "Contrôles non satisfaits : aucun achat (même simulé) n'a été effectué." : "Achat SIMULÉ de bout en bout : aucun paiement ni commande réels. L'achat réel est désactivé et exige un connecteur autorisé.";
    if (outcome !== "blocked") { opp.status = "purchased"; opp.updatedAt = this.now(); }
    p.updatedAt = this.now();
    this.audit("purchase.confirmed", "purchase_request", id, { outcome });
    this.persist();
    return p;
  }
  async cancelPurchaseRequest(id: string): Promise<PurchaseRequest> {
    const p = this.s.purchases.find((x) => x.id === id);
    if (!p) throw new DataError("not_found", "Demande introuvable", 404);
    p.status = "cancelled";
    p.updatedAt = this.now();
    this.persist();
    return p;
  }

  // ---------- connexions ----------
  async describeConnectors() {
    return describeConnectors();
  }
  async listConnections(): Promise<MarketplaceConnection[]> {
    return [...this.s.connections];
  }
  async createConnection(input: ConnectionCreate): Promise<MarketplaceConnection> {
    const parsed = connectionCreateSchema.safeParse(input);
    if (!parsed.success) throw new DataError("validation", "Connexion invalide", 400, parsed.error.flatten());
    if (this.s.connections.length >= this.s.subscription.quotas.connections) throw new DataError("quota_exceeded", `Quota de connexions atteint (${this.s.subscription.quotas.connections}).`, 402);
    const desc = getConnector(parsed.data.provider).describe();
    const now = this.now();
    const c: MarketplaceConnection = { id: newId(), orgId: this.s.org.id, provider: parsed.data.provider, label: parsed.data.label, status: parsed.data.provider === "demo" ? "connected" : "ready", capabilities: desc.capabilities, config: parsed.data.config ?? {}, hasSecret: Boolean(parsed.data.secret), lastSyncAt: null, lastTestAt: null, lastError: null, transport: desc.transport, createdAt: now, updatedAt: now };
    this.s.connections.push(c);
    this.audit("connection.created", "marketplace_connection", c.id, { provider: c.provider });
    this.persist();
    return c;
  }
  async testConnection(id: string): Promise<ConnectionTestResult> {
    const c = this.s.connections.find((x) => x.id === id);
    if (!c) throw new DataError("not_found", "Connexion introuvable", 404);
    await this.delay(400);
    const res = await getConnector(c.provider).test({ orgId: this.s.org.id, connectionId: c.id, config: c.config, now: this.clock() });
    if (c.status !== "disconnected") c.status = res.status;
    c.lastTestAt = res.testedAt;
    c.lastError = res.ok ? null : res.message;
    c.capabilities = res.capabilities;
    c.updatedAt = this.now();
    this.audit("connection.tested", "marketplace_connection", id, { status: res.status });
    this.persist();
    return res;
  }
  async syncConnection(id: string) {
    const c = this.s.connections.find((x) => x.id === id);
    if (!c) throw new DataError("not_found", "Connexion introuvable", 404);
    if (c.status !== "connected" && c.status !== "degraded") throw new DataError("connector_unavailable", `La connexion est « ${c.status} » : synchronisation impossible.`, 409);
    const connector = getConnector(c.provider);
    if (!connector.readConversations) throw new DataError("connector_unavailable", "Ce connecteur ne permet pas la lecture des conversations côté serveur.", 409);
    await this.delay(600);
    const res = await connector.readConversations({ orgId: this.s.org.id, connectionId: c.id, config: c.config, now: this.clock() });
    if (!res.ok) { c.status = "degraded"; c.lastError = res.message; this.persist(); throw new DataError("connector_unavailable", res.message, 502); }
    let conversations = 0;
    for (const ext of res.data) {
      await this.simulateIncomingMessage(null, ext.messages[0]?.body);
      conversations++;
    }
    c.lastSyncAt = this.now();
    c.lastError = null;
    this.usage("connector.sync", { connectionId: id });
    this.persist();
    return { conversations, items: 0, orders: 0, simulated: res.simulated };
  }
  async disconnectConnection(id: string): Promise<MarketplaceConnection> {
    const c = this.s.connections.find((x) => x.id === id);
    if (!c) throw new DataError("not_found", "Connexion introuvable", 404);
    c.status = "disconnected";
    c.hasSecret = false;
    c.updatedAt = this.now();
    this.audit("connection.revoked", "marketplace_connection", id, {});
    this.persist();
    return c;
  }
  async deleteConnection(id: string): Promise<void> {
    this.s.connections = this.s.connections.filter((c) => c.id !== id);
    this.audit("connection.deleted", "marketplace_connection", id, {});
    this.persist();
  }

  // ---------- jetons d'extension ----------
  async listExtensionTokens(): Promise<ExtensionToken[]> {
    return [...this.s.tokens];
  }
  async createExtensionToken(input: { label: string }): Promise<{ token: ExtensionToken; secret: string }> {
    const now = this.clock();
    const prefix = `slx_${newId().slice(0, 5)}`;
    const secret = `${prefix}.${newId().replace(/-/g, "")}${newId().replace(/-/g, "").slice(0, 8)}`;
    const token: ExtensionToken = { id: newId(), orgId: this.s.org.id, userId: this.s.user.id, label: input.label.trim() || "Extension", prefix, scopes: ["capture:items", "read:rules", "draft:messages", "sync:conversations"], expiresAt: new Date(now.getTime() + 90 * 86_400_000).toISOString(), lastUsedAt: null, revokedAt: null, createdAt: now.toISOString() };
    this.s.tokens.unshift(token);
    this.audit("token.created", "extension_token", token.id, { label: token.label });
    this.persist();
    return { token, secret };
  }
  async revokeExtensionToken(id: string): Promise<void> {
    const t = this.s.tokens.find((x) => x.id === id);
    if (!t) throw new DataError("not_found", "Jeton introuvable", 404);
    t.revokedAt = this.now();
    this.audit("token.revoked", "extension_token", id, {});
    this.persist();
  }

  // ---------- IA ----------
  async getAiStatus() {
    return this.ai.status();
  }
  async listAiRequests(): Promise<AiRequest[]> {
    return [...this.s.aiRequests];
  }

  // ---------- abonnement ----------
  async getSubscription(): Promise<Subscription> {
    return this.s.subscription;
  }
  async getUsage(): Promise<UsageSummary> {
    const now = this.clock();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const inMonth = this.s.usage.filter((u) => new Date(u.createdAt) >= from);
    const count = (k: UsageEvent["kind"]) => inMonth.filter((u) => u.kind === k).reduce((s, u) => s + u.quantity, 0);
    return { period: { from: from.toISOString(), to: now.toISOString() }, aiRequests: count("ai.request"), automationActions: count("automation.action"), connectorSyncs: count("connector.sync"), exports: count("export.csv"), extensionCaptures: count("extension.capture"), quotas: this.s.subscription.quotas, itemsCount: this.s.items.filter((i) => i.status !== "archived").length, connectionsCount: this.s.connections.length, membersCount: this.s.memberships.length };
  }
  async startCheckout(plan: Plan) {
    await this.delay(300);
    this.audit("billing.checkout_simulated", "subscription", this.s.subscription.id, { plan });
    this.persist();
    return { url: null, simulated: true, message: `Démonstration : aucun paiement n'est déclenché. En mode connecté, Stripe (mode test) ouvrirait une page de paiement pour le plan « ${plan} ».` };
  }
  async listUsageEvents(limit = 50): Promise<UsageEvent[]> {
    return this.s.usage.slice(0, limit);
  }

  // ---------- sécurité et données ----------
  async listAuditLogs(limit = 100): Promise<AuditLog[]> {
    return this.s.audit.slice(0, limit);
  }
  async changePassword(): Promise<void> {
    await this.delay(200);
    this.audit("auth.password_changed", null, null, { simulated: true });
    this.persist();
  }
  async exportAllData(): Promise<Blob> {
    const { passwordHint: _p, ...data } = this.s;
    this.usage("export.csv", { kind: "full_export" });
    this.audit("data.exported", null, null, {});
    this.persist();
    return new Blob([JSON.stringify({ exportedAt: this.now(), mode: "demo", ...data }, null, 2)], { type: "application/json" });
  }
  async deleteOrganization(confirmName: string): Promise<void> {
    if (confirmName !== this.s.org.name) throw new DataError("validation", "Le nom saisi ne correspond pas.", 400);
    this.storage.clear();
    this.state = null;
    for (const l of this.listeners) l();
  }
  async getServiceStatus(): Promise<ServiceStatus[]> {
    const ai = await this.ai.status();
    const at = this.now();
    return [
      { name: "Application web", ok: true, status: "ok", message: "Mode démonstration, données locales", latencyMs: 0, checkedAt: at },
      { name: "API", ok: true, status: "simulated", message: "Non utilisée en démonstration", latencyMs: null, checkedAt: at },
      { name: "Base de données", ok: true, status: "simulated", message: "Stockage local du navigateur", latencyMs: null, checkedAt: at },
      { name: "File de tâches", ok: true, status: "simulated", message: "Exécution immédiate simulée", latencyMs: null, checkedAt: at },
      { name: "Assistant IA", ok: ai.status === "mock", status: ai.status, message: ai.message, latencyMs: ai.latencyMs, checkedAt: at },
      { name: "Connecteur Vinted", ok: false, status: "experimental", message: "Non vérifié en réel : nécessite l'extension et une validation navigateur", latencyMs: null, checkedAt: at },
    ];
  }

  // ---------- administration ----------
  async getAdminOverview(): Promise<AdminOverview> {
    const st = this.s;
    if (!st.user.isOperator) throw new DataError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
    const ai = await this.ai.status();
    const dayAgo = new Date(this.clock().getTime() - 86_400_000).toISOString();
    const recentAi = st.aiRequests.filter((r) => r.createdAt >= dayAgo);
    const services = await this.getServiceStatus();
    return {
      services,
      queues: [
        { name: "automation", waiting: st.jobs.filter((j) => j.status === "queued").length, active: st.jobs.filter((j) => j.status === "running").length, failed: st.jobs.filter((j) => j.status === "failed").length, completed: st.jobs.filter((j) => j.status === "succeeded").length, paused: st.automation.globalPaused },
        { name: "ai", waiting: ai.queue.pending, active: ai.queue.running, failed: st.aiRequests.filter((r) => r.status === "failed" || r.status === "rejected").length, completed: st.aiRequests.filter((r) => r.status === "succeeded").length, paused: ai.circuit.state === "open" },
        { name: "connector-sync", waiting: 0, active: 0, failed: 0, completed: st.usage.filter((u) => u.kind === "connector.sync").length, paused: false },
      ],
      connectors: ["demo", "vinted"].map((p) => ({ provider: p, connections: st.connections.filter((c) => c.provider === p).length, byStatus: st.connections.filter((c) => c.provider === p).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {}) })),
      ai: { status: ai, requests24h: recentAi.length, failures24h: recentAi.filter((r) => r.status !== "succeeded").length, tokens24h: recentAi.reduce((s, r) => s + r.promptTokens + r.outputTokens, 0), byOrg: [{ orgId: st.org.id, orgName: st.org.name, requests: recentAi.length }] },
      errors: [...st.jobs.filter((j) => j.error).map((j) => ({ at: j.updatedAt, source: `job ${j.kind}`, message: j.error!, orgId: st.org.id })), ...st.aiRequests.filter((r) => r.rejectionReason).map((r) => ({ at: r.createdAt, source: "ai.validation", message: r.rejectionReason!, orgId: st.org.id }))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      orgs: [{ id: st.org.id, name: st.org.name, plan: st.subscription.plan, members: st.memberships.length, items: st.items.length, createdAt: st.org.createdAt }],
      plans: (["free", "starter", "pro"] as const).map((plan) => ({ plan, quotas: PLAN_QUOTAS[plan], orgCount: st.subscription.plan === plan ? 1 : 0 })),
    };
  }
  async adminSetPlan(orgId: string, plan: Plan): Promise<void> {
    if (!this.s.user.isOperator) throw new DataError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
    if (orgId !== this.s.org.id) throw new DataError("not_found", "Organisation introuvable", 404);
    this.s.subscription = { ...this.s.subscription, plan, quotas: PLAN_QUOTAS[plan], updatedAt: this.now() };
    this.audit("admin.plan_changed", "organization", orgId, { plan });
    this.persist();
  }
  async adminListAudit(limit = 100): Promise<AuditLog[]> {
    if (!this.s.user.isOperator) throw new DataError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
    return this.s.audit.filter((a) => a.action.startsWith("admin.") || a.action.startsWith("auth.") || a.action.startsWith("token.") || a.action.startsWith("connection.")).slice(0, limit);
  }

  // ---------- démo ----------
  async resetDemo(): Promise<void> {
    this.state = buildDemoState(this.clock());
    this.audit("demo.reset", null, null, {});
    this.persist();
  }
}
