import type {
  AiRequest, AiStatus, AuditLog, AutomationRule, AutomationRuleCreate, BulkItemAction, ConnectionCreate, ConnectionTestResult, Conversation, ConversationQuery, Customer, CustomerCreate, CustomerQuery, CustomerUpdate, ExtensionToken, InventoryEvent, InventoryItem, InventoryItemCreate, InventoryItemUpdate, InventoryQuery, Job, JobQuery, MarketplaceConnection, Membership, Message, Opportunity, Order, OrderCreate, OrderQuery, OrderStatus, Organization, OrgSettings, Page, Plan, PurchaseRequest, RadarSearch, RadarSearchCreate, Role, Shipment, Subscription, UsageEvent, User,
} from "@selio/contracts";
import type { ConnectorDescriptor } from "@selio/connectors";
import type { NegotiationResult, PeriodPreset } from "@selio/domain";
import { DataError, type AdminOverview, type AnalyticsData, type AnalyticsFilters, type AutomationState, type ConversationDetail, type CustomerTimeline, type DataClient, type OverviewData, type ServiceStatus, type Session, type SuggestionResult, type UsageSummary } from "../data/types";

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q: Query | undefined): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Client du mode connecté : appels HTTP vers l'API Selio (apps/api), cookie
 * de session HttpOnly, aucune donnée fictive en repli. Les erreurs sont
 * remontées telles quelles pour un affichage honnête.
 */
export class ApiClient implements DataClient {
  readonly mode = "connected" as const;
  constructor(private readonly baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        credentials: "include",
        headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new DataError("network", "Impossible de joindre le serveur Selio. Vérifiez votre connexion ou l'état des services.", 0, e);
    }
    if (opts.raw) {
      if (!res.ok) throw new DataError("http", `Erreur ${res.status}`, res.status);
      return (await res.text()) as unknown as T;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new DataError("internal", "Réponse serveur illisible.", res.status);
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new DataError(err?.code ?? "http", err?.message ?? `Erreur ${res.status}`, res.status, err?.details);
    }
    return json as T;
  }
  private get<T>(path: string, q?: Query) { return this.request<T>("GET", path + qs(q)); }
  private post<T>(path: string, body?: unknown) { return this.request<T>("POST", path, body ?? {}); }
  private patch<T>(path: string, body?: unknown) { return this.request<T>("PATCH", path, body ?? {}); }
  private del<T>(path: string) { return this.request<T>("DELETE", path); }

  getSession() { return this.get<Session | null>("/api/auth/session"); }
  login(input: { email: string; password: string }) { return this.post<Session>("/api/auth/login", input); }
  register(input: { email: string; password: string; displayName: string; orgName: string }) { return this.post<Session>("/api/auth/register", input); }
  logout() { return this.post<void>("/api/auth/logout"); }
  switchOrg(orgId: string) { return this.post<Session>("/api/auth/switch-org", { orgId }); }

  updateOrg(input: { name?: string; settings?: Partial<OrgSettings> }) { return this.patch<Organization>("/api/org", input); }
  listMembers() { return this.get<(Membership & { user: User })[]>("/api/org/members"); }
  inviteMember(input: { email: string; role: Role }) { return this.post<Membership & { user: User }>("/api/org/members", input); }
  updateMemberRole(membershipId: string, role: Role) { return this.patch<void>(`/api/org/members/${membershipId}`, { role }); }
  removeMember(membershipId: string) { return this.del<void>(`/api/org/members/${membershipId}`); }
  completeOnboardingStep(step: string) { return this.post<Organization>(`/api/org/onboarding/${encodeURIComponent(step)}`); }

  listItems(query: Partial<InventoryQuery>) { return this.get<Page<InventoryItem>>("/api/items", query as Query); }
  listItemBrands() { return this.get<string[]>("/api/items/brands"); }
  getItem(id: string) { return this.get<InventoryItem>(`/api/items/${id}`); }
  createItem(input: InventoryItemCreate) { return this.post<InventoryItem>("/api/items", input); }
  updateItem(id: string, input: InventoryItemUpdate) { return this.patch<InventoryItem>(`/api/items/${id}`, input); }
  setItemStatus(id: string, status: InventoryItem["status"]) { return this.post<InventoryItem>(`/api/items/${id}/status`, { status }); }
  deleteItem(id: string) { return this.del<void>(`/api/items/${id}`); }
  bulkItems(action: BulkItemAction) { return this.post<{ affected: number }>("/api/items/bulk", action); }
  importItems(items: InventoryItemCreate[]) { return this.post<{ created: number }>("/api/items/import", { items }); }
  exportItemsCsv() { return this.request<string>("GET", "/api/items/export.csv", undefined, { raw: true }); }
  itemHistory(id: string) { return this.get<InventoryEvent[]>(`/api/items/${id}/history`); }

  listCustomers(query: Partial<CustomerQuery>) { return this.get<Page<Customer & { orderCount: number; revenueCents: number }>>("/api/customers", query as Query); }
  getCustomerTimeline(id: string) { return this.get<CustomerTimeline>(`/api/customers/${id}/timeline`); }
  createCustomer(input: CustomerCreate) { return this.post<Customer>("/api/customers", input); }
  updateCustomer(id: string, input: CustomerUpdate) { return this.patch<Customer>(`/api/customers/${id}`, input); }
  mergeCustomers(keepId: string, mergeId: string) { return this.post<Customer>(`/api/customers/${keepId}/merge`, { mergeId }); }

  listConversations(query: Partial<ConversationQuery>) { return this.get<Page<Conversation & { customer: Customer; item: InventoryItem | null }>>("/api/conversations", query as Query); }
  getConversation(id: string) { return this.get<ConversationDetail>(`/api/conversations/${id}`); }
  markConversationRead(id: string) { return this.post<void>(`/api/conversations/${id}/read`); }
  setConversationStatus(id: string, status: Conversation["status"]) { return this.post<void>(`/api/conversations/${id}/status`, { status }); }
  createDraft(input: { conversationId: string; body: string; offerCents?: number | null }) { return this.post<Message>(`/api/conversations/${input.conversationId}/drafts`, { body: input.body, offerCents: input.offerCents ?? null }); }
  updateDraft(messageId: string, body: string) { return this.patch<Message>(`/api/messages/${messageId}`, { body }); }
  deleteDraft(messageId: string) { return this.del<void>(`/api/messages/${messageId}`); }
  sendMessage(messageId: string) { return this.post<Message>(`/api/messages/${messageId}/send`); }
  suggestReply(conversationId: string) { return this.post<SuggestionResult>(`/api/conversations/${conversationId}/suggest`); }
  evaluateOffer(conversationId: string, offerCents: number) { return this.post<NegotiationResult>(`/api/conversations/${conversationId}/evaluate`, { offerCents }); }
  simulateIncomingMessage(conversationId: string | null, body?: string) { return this.post<Conversation>("/api/conversations/simulate", { conversationId, body }); }

  listOrders(query: Partial<OrderQuery>) { return this.get<Page<Order & { item: InventoryItem | null; customer: Customer | null }>>("/api/orders", query as Query); }
  getOrder(id: string) { return this.get<{ order: Order; item: InventoryItem | null; customer: Customer | null; shipment: Shipment | null; marginCents: number }>(`/api/orders/${id}`); }
  createOrder(input: OrderCreate) { return this.post<{ order: Order; created: boolean }>("/api/orders", input); }
  updateOrder(id: string, input: Partial<Pick<Order, "salePriceCents" | "platformFeeCents" | "shippingCostCents" | "otherCostsCents">>) { return this.patch<Order>(`/api/orders/${id}`, input); }
  transitionOrder(id: string, status: OrderStatus, note?: string) { return this.post<Order>(`/api/orders/${id}/transition`, { status, note }); }
  updateShipment(orderId: string, input: Partial<Pick<Shipment, "carrier" | "trackingNumber" | "status">>) { return this.patch<Shipment>(`/api/orders/${orderId}/shipment`, input); }
  requestShippingDocument(orderId: string) { return this.post<Shipment>(`/api/orders/${orderId}/shipping-document`); }

  getOverview(period: PeriodPreset) { return this.get<OverviewData>("/api/analytics/overview", { period }); }
  getAnalytics(filters: AnalyticsFilters) { return this.get<AnalyticsData>("/api/analytics", filters as unknown as Query); }
  exportAnalyticsCsv(filters: AnalyticsFilters) { return this.request<string>("GET", "/api/analytics/export.csv" + qs(filters as unknown as Query), undefined, { raw: true }); }

  listRules() { return this.get<AutomationRule[]>("/api/automations/rules"); }
  createRule(input: AutomationRuleCreate) { return this.post<AutomationRule>("/api/automations/rules", input); }
  updateRule(id: string, input: Partial<AutomationRuleCreate>) { return this.patch<AutomationRule>(`/api/automations/rules/${id}`, input); }
  deleteRule(id: string) { return this.del<void>(`/api/automations/rules/${id}`); }
  getAutomationState() { return this.get<AutomationState>("/api/automations/state"); }
  setGlobalPause(paused: boolean) { return this.post<AutomationState>("/api/automations/pause", { paused }); }
  runRuleNow(id: string) { return this.post<{ evaluated: number; created: number; skipped: { reason: string; count: number }[] }>(`/api/automations/rules/${id}/run`); }
  listJobs(query: Partial<JobQuery>) { return this.get<Page<Job>>("/api/automations/jobs", query as Query); }
  approveJob(id: string) { return this.post<Job>(`/api/automations/jobs/${id}/approve`); }
  cancelJob(id: string) { return this.post<Job>(`/api/automations/jobs/${id}/cancel`); }
  retryJob(id: string) { return this.post<Job>(`/api/automations/jobs/${id}/retry`); }

  listSearches() { return this.get<RadarSearch[]>("/api/radar/searches"); }
  createSearch(input: RadarSearchCreate) { return this.post<RadarSearch>("/api/radar/searches", input); }
  updateSearch(id: string, input: Partial<RadarSearchCreate>) { return this.patch<RadarSearch>(`/api/radar/searches/${id}`, input); }
  deleteSearch(id: string) { return this.del<void>(`/api/radar/searches/${id}`); }
  runSearch(id: string) { return this.post<{ found: number }>(`/api/radar/searches/${id}/run`); }
  listOpportunities(query: { searchId?: string; status?: Opportunity["status"] }) { return this.get<Opportunity[]>("/api/radar/opportunities", query); }
  setOpportunityStatus(id: string, status: Opportunity["status"]) { return this.post<Opportunity>(`/api/radar/opportunities/${id}/status`, { status }); }

  listPurchaseRequests() { return this.get<(PurchaseRequest & { opportunity: Opportunity | null })[]>("/api/purchases"); }
  createPurchaseRequest(input: { opportunityId: string; maxPriceCents: number; budgetCents: number }) { return this.post<PurchaseRequest>("/api/purchases", input); }
  confirmPurchaseRequest(id: string) { return this.post<PurchaseRequest>(`/api/purchases/${id}/confirm`); }
  cancelPurchaseRequest(id: string) { return this.post<PurchaseRequest>(`/api/purchases/${id}/cancel`); }

  describeConnectors() { return this.get<ConnectorDescriptor[]>("/api/connectors"); }
  listConnections() { return this.get<MarketplaceConnection[]>("/api/connections"); }
  createConnection(input: ConnectionCreate) { return this.post<MarketplaceConnection>("/api/connections", input); }
  testConnection(id: string) { return this.post<ConnectionTestResult>(`/api/connections/${id}/test`); }
  syncConnection(id: string) { return this.post<{ conversations: number; items: number; orders: number; simulated: boolean }>(`/api/connections/${id}/sync`); }
  disconnectConnection(id: string) { return this.post<MarketplaceConnection>(`/api/connections/${id}/disconnect`); }
  deleteConnection(id: string) { return this.del<void>(`/api/connections/${id}`); }

  listExtensionTokens() { return this.get<ExtensionToken[]>("/api/extension-tokens"); }
  createExtensionToken(input: { label: string }) { return this.post<{ token: ExtensionToken; secret: string }>("/api/extension-tokens", input); }
  revokeExtensionToken(id: string) { return this.del<void>(`/api/extension-tokens/${id}`); }

  getAiStatus() { return this.get<AiStatus>("/api/ai/status"); }
  listAiRequests() { return this.get<AiRequest[]>("/api/ai/requests"); }

  getSubscription() { return this.get<Subscription>("/api/billing/subscription"); }
  getUsage() { return this.get<UsageSummary>("/api/billing/usage"); }
  startCheckout(plan: Plan) { return this.post<{ url: string | null; simulated: boolean; message: string }>("/api/billing/checkout", { plan }); }
  listUsageEvents(limit = 50) { return this.get<UsageEvent[]>("/api/billing/usage-events", { limit }); }

  listAuditLogs(limit = 100) { return this.get<AuditLog[]>("/api/audit", { limit }); }
  changePassword(input: { current: string; next: string }) { return this.post<void>("/api/auth/password", input); }
  async exportAllData() {
    const text = await this.request<string>("GET", "/api/data/export", undefined, { raw: true });
    return new Blob([text], { type: "application/json" });
  }
  deleteOrganization(confirmName: string) { return this.request<void>("DELETE", "/api/org", { confirmName }); }
  getServiceStatus() { return this.get<ServiceStatus[]>("/api/status"); }

  getAdminOverview() { return this.get<AdminOverview>("/api/admin/overview"); }
  adminSetPlan(orgId: string, plan: Plan) { return this.post<void>(`/api/admin/orgs/${orgId}/plan`, { plan }); }
  adminListAudit(limit = 100) { return this.get<AuditLog[]>("/api/admin/audit", { limit }); }

  async resetDemo() {
    throw new DataError("conflict", "La réinitialisation n'existe qu'en mode démonstration.", 409);
  }
}
