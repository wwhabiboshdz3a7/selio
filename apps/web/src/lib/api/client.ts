import type {
  AiRequest, AiStatus, AuditLog, ListingGenerationInput, AutomationRule, AutomationRuleCreate, BulkItemAction, ConnectionCreate, ConnectionTestResult, ConnectionUpdate, Conversation, ConversationQuery, Customer, CustomerCreate, CustomerQuery, CustomerUpdate, ExtensionToken, InventoryEvent, InventoryItem, InventoryItemCreate, InventoryItemUpdate, InventoryQuery, Job, JobQuery, MarketplaceConnection, Membership, Message, Opportunity, Order, OrderCreate, OrderQuery, OrderStatus, Organization, OrgSettings, Page, Plan, PurchaseRequest, RadarSearch, RadarSearchCreate, Role, Shipment, Subscription, UsageEvent, User,
} from "@selio/contracts";
import type { ConnectorDescriptor } from "@selio/connectors";
import type { HelpAnswer } from "@selio/contracts";
import type { AccountStats, NegotiationResult, PeriodPreset } from "@selio/domain";
import { DataError, type AdminOverview, type AdminUsageReport, type AnalyticsData, type AnalyticsFilters, type AutoBuyRunResult, type AutomationState, type DressingData, type DressingQuery, type MarketData, type MarketQuery, type ConversationDetail, type CustomerTimeline, type DataClient, type OverviewData, type ServiceStatus, type Session, type SuggestionResult, type UsageSummary } from "../data/types";
import type { AutoBuyStatus, OpportunityDetail, PushConfig, PushTestResult, RadarMetricsView, RadarRunResult, RadarSettingsResult, ResumeResult } from "../data/types";
import { autoBuySettings, type PushSubscriptionInput, type PushSubscriptionView, type RadarSettingsUpdate } from "@selio/contracts";
import { normalizeAutoBuyStatus, normalizePushConfig } from "../radar";
import type { AiHealthData } from "../data/types";
import type { BillingCycle, Invoice, InvoiceView, PaidPlan, TrackSource, UsageCounter, WhiteLabel, WhiteLabelInput } from "@selio/contracts";
import type { CheckoutOutcome, CloudAccountView, CloudAvailabilityView, CloudJournalFilters, CloudLoginStart } from "../data/types";
import type { CloudAccount, CloudAction, CloudActionLevel, CloudConsentView, CloudLoginTicket } from "@selio/contracts";
import { loginSocketUrl } from "../cloud/login-protocol";
import type { PriceEstimate, PriceEstimateInput, TrackFilter, TrackFilterCreate, TrackFilterUpdate, TrackPhotoSearch, TrackPhotoSearchInput, TrackSalesFeed, TrackScan, TrackScanInput } from "@selio/contracts";
import type { PricingModelView, StudioDraft, TrackTrendsView, TrackUsageView } from "../data/types";
import type { StoredStudioPhoto, StudioGenerateFromPrepInput, StudioPrepAnswersInput, StudioPrepareOptions, StudioPrepareRequest, StudioPrepResultView, StudioPrepView, ValidatePrepResultView, WornPhotoRequestInput, WornPhotosView, WornPhotoStatusView, WornPhotoView } from "../data/types";
import { buildUsageCounter, type GeneratorPhoto } from "@selio/contracts";
import { buildTrackUsage } from "../track";

type Query = Record<string, string | number | boolean | undefined | null>;

/** Réponse de GET /api/track/usage (apps/api/src/routes/track.ts). */
interface ApiTrackUsage {
  plan: string;
  period: { from: string; to: string };
  counters: { filtersFollowed: UsageCounter; scans: UsageCounter; photoSearches: UsageCounter };
  historyMonths: number;
  history?: { month: string; scans: number; photoSearches: number }[];
  source?: TrackSource;
  sourceLabel?: string;
  notices?: string[];
}

/** Réponse de GET /api/studio/worn (apps/api/src/routes/studio.ts). */
interface ApiWornPhotos {
  jobs: WornPhotoView[];
  quota: { used: number; quota: number; remaining: number };
  provider: { name: string; configured: boolean; message?: string };
  overage: { enabled: boolean; unitCents: number; proposal: boolean };
  nightWindow: { startHour: number; endHour: number; timezone: string; nextStart: string; nextEnd: string; inWindow: boolean };
}

/** État des photos portées pour l'écran, à partir de la réponse du serveur et de l'abonnement. */
export function wornStatusFromApi(r: ApiWornPhotos, sub: Subscription | null): WornPhotoStatusView {
  const billable = !!sub && sub.cardOnFile && sub.provider === "revolut" && (sub.status === "active" || sub.status === "trialing") && !sub.cancelAtPeriodEnd;
  return {
    counter: buildUsageCounter(r.quota.used, r.quota.quota),
    planQuota: r.quota.quota,
    overage: { enabled: r.overage.enabled === true, unitCents: r.overage.unitCents, proposal: r.overage.proposal !== false, billable },
    window: { startHour: r.nightWindow.startHour, endHour: r.nightWindow.endHour, timezone: r.nightWindow.timezone },
    nextWindow: { start: r.nightWindow.nextStart, end: r.nightWindow.nextEnd, inWindow: r.nightWindow.inWindow },
    provider: { name: r.provider.name, configured: r.provider.configured === true, message: r.provider.message ?? null },
  };
}

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
  requestPasswordReset(email: string) { return this.post<void>("/api/auth/password/forgot", { email }); }
  resetPassword(input: { token: string; password: string }) { return this.post<void>("/api/auth/password/reset", input); }
  acceptInvite(input: { token: string; password: string; displayName?: string }) { return this.post<Session>("/api/auth/invite/accept", input); }

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
  runSearch(id: string) { return this.post<RadarRunResult>(`/api/radar/searches/${id}/run`); }
  listOpportunities(query: { searchId?: string; status?: Opportunity["status"] }) { return this.get<Opportunity[]>("/api/radar/opportunities", query); }
  async getOpportunity(id: string): Promise<OpportunityDetail> {
    const o = await this.get<Opportunity & Partial<Pick<OpportunityDetail, "search" | "purchase" | "itemUrl">>>(`/api/radar/opportunities/${encodeURIComponent(id)}`);
    return { ...o, search: o.search ?? null, purchase: o.purchase ?? null, itemUrl: o.itemUrl ?? null };
  }
  setOpportunityStatus(id: string, status: Opportunity["status"]) { return this.post<Opportunity>(`/api/radar/opportunities/${id}/status`, { status }); }
  radarMetrics(days?: number) { return this.get<RadarMetricsView>("/api/radar/metrics", { days }); }
  updateRadarSettings(input: RadarSettingsUpdate) { return this.patch<RadarSettingsResult>("/api/radar/settings", input); }

  quickBuy(opportunityId: string, opts: { paidCents?: number | null } = {}) { return this.post<PurchaseRequest>(`/api/radar/opportunities/${opportunityId}/buy`, typeof opts.paidCents === "number" ? { paidCents: opts.paidCents } : {}); }
  runAutoBuy() { return this.post<AutoBuyRunResult>("/api/purchases/auto-run"); }
  /** Lu sans confiance : tout verrou absent de la réponse est affiché fermé. */
  async autoBuyStatus(): Promise<AutoBuyStatus> {
    return normalizeAutoBuyStatus(await this.get<unknown>("/api/radar/auto/status"), autoBuySettings.parse({}));
  }
  /** 202 `{ queued, purchase }` : la relecture est en file dans le worker ; sinon la demande à jour. */
  async resumePurchase(id: string): Promise<ResumeResult> {
    const r = await this.post<PurchaseRequest | { queued: true; purchase: PurchaseRequest }>(`/api/purchases/${encodeURIComponent(id)}/resume`);
    return "queued" in r && r.queued ? { purchase: r.purchase, queued: true } : { purchase: r as PurchaseRequest, queued: false };
  }

  // Notifications de la PWA : seule la clé PUBLIQUE VAPID transite ; l'abonnement de l'appareil est envoyé une fois.
  async pushConfig(): Promise<PushConfig> {
    return normalizePushConfig(await this.get<unknown>("/api/push/config"));
  }
  listPushSubscriptions() { return this.get<PushSubscriptionView[]>("/api/push/subscriptions"); }
  subscribePush(input: PushSubscriptionInput) { return this.post<PushSubscriptionView>("/api/push/subscriptions", input); }
  unsubscribePush(endpoint: string) { return this.request<{ removed: boolean }>("DELETE", "/api/push/subscriptions", { endpoint }); }
  removePushSubscription(id: string) { return this.request<{ removed: boolean }>("DELETE", `/api/push/subscriptions/${encodeURIComponent(id)}`); }
  testPush() { return this.post<PushTestResult>("/api/push/test"); }
  /** Générateur (POST /api/studio/generate) ; avec `prepId`, à partir d'une préparation validée. */
  generateListing(input: ListingGenerationInput | StudioGenerateFromPrepInput) { return this.post<StudioDraft>("/api/studio/generate", input); }
  // Studio façon Kavis (apps/api/src/routes/studio.ts) : les indices du simulateur ne quittent jamais le navigateur.
  prepareStudio(input: StudioPrepareRequest, _opts?: StudioPrepareOptions) { return this.post<StudioPrepResultView>("/api/studio/prepare", input); }
  getStudioPrep(prepId: string) { return this.get<StudioPrepView>(`/api/studio/preps/${encodeURIComponent(prepId)}`); }
  validateStudioPrep(prepId: string, answers: StudioPrepAnswersInput) { return this.post<ValidatePrepResultView>(`/api/studio/preps/${encodeURIComponent(prepId)}/validate`, answers); }
  /**
   * Photos portées (GET /api/studio/worn) : demandes, quota du mois, dépassement (réglage serveur, prix
   * proposé), fenêtre de nuit et fournisseur. « Facturable » se lit sur l'abonnement (carte enregistrée,
   * en cours, non résilié), comme le serveur le vérifie au moment de la demande.
   */
  async wornPhotos(): Promise<WornPhotosView> {
    const [r, sub] = await Promise.all([this.get<ApiWornPhotos>("/api/studio/worn"), this.getSubscription().catch(() => null)]);
    return { jobs: r.jobs, status: wornStatusFromApi(r, sub) };
  }
  /**
   * Envoi d'une photo réduite au stockage de l'organisation (docs/STOCKAGE.md) : URL signée par l'API
   * (sorte « studio-photo », type et taille imposés), PUT direct vers le stockage, puis la clé seule.
   */
  async uploadStudioPhoto(photo: GeneratorPhoto): Promise<StoredStudioPhoto> {
    const comma = photo.url.indexOf(",");
    const contentType = photo.url.slice(5, photo.url.indexOf(";")) || "image/jpeg";
    const bin = atob(photo.url.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const presign = await this.post<{ key: string; uploadUrl: string; method: string; headers: Record<string, string>; readUrl: string | null }>("/api/uploads/presign", { kind: "studio-photo", contentType, size: bytes.length });
    let res: Response;
    try {
      // En-têtes renvoyés tels quels : Content-Type et Content-Length font partie de la signature.
      const headers = Object.fromEntries(Object.entries(presign.headers ?? {}).filter(([k]) => k.toLowerCase() !== "content-length"));
      res = await fetch(presign.uploadUrl, { method: presign.method || "PUT", headers, body: new Blob([bytes], { type: contentType }) });
    } catch (e) {
      throw new DataError("network", "Impossible d'envoyer la photo au stockage. Vérifiez votre connexion.", 0, e);
    }
    if (!res.ok) throw new DataError("upload_failed", `Envoi de la photo refusé par le stockage (${res.status}).`, res.status);
    return { key: presign.key, readUrl: presign.readUrl ?? null };
  }
  deleteStudioPhoto(key: string) { return this.del<{ deleted: true; key: string }>(`/api/uploads/object?key=${encodeURIComponent(key)}`); }
  requestWornPhoto(input: WornPhotoRequestInput) { return this.post<WornPhotoView>("/api/studio/worn", input); }
  cancelWornPhoto(id: string) { return this.del<{ cancelled: true; id: string }>(`/api/studio/worn/${encodeURIComponent(id)}`); }
  getDressing(query: DressingQuery) { return this.get<DressingData>("/api/dressing", query as Query); }
  republishItem(id: string, variantId: string) { return this.post<InventoryItem>(`/api/items/${id}/republish`, { variantId }); }
  getMarketInsights(query: MarketQuery) { return this.get<MarketData>("/api/market/insights", query as Query); }
  // Selio Track (/api/track/*) : statistiques seulement ; la photo d'une recherche n'est jamais conservée.
  trackFilters() { return this.get<TrackFilter[]>("/api/track/filters"); }
  createTrackFilter(input: TrackFilterCreate) { return this.post<TrackFilter>("/api/track/filters", input); }
  updateTrackFilter(id: string, input: TrackFilterUpdate) { return this.patch<TrackFilter>(`/api/track/filters/${encodeURIComponent(id)}`, input); }
  deleteTrackFilter(id: string) { return this.del<void>(`/api/track/filters/${encodeURIComponent(id)}`); }
  trackTrends(filterId: string, days?: number) { return this.get<TrackTrendsView>(`/api/track/filters/${encodeURIComponent(filterId)}/trends`, { days }); }
  trackScans() { return this.get<TrackScan[]>("/api/track/scans"); }
  runNicheScan(input: TrackScanInput) { return this.post<TrackScan>("/api/track/scans", input); }
  trackPhotoSearches() { return this.get<TrackPhotoSearch[]>("/api/track/photo-search"); }
  trackPhotoSearch(input: TrackPhotoSearchInput) { return this.post<TrackPhotoSearch>("/api/track/photo-search", input); }
  trackSalesFeed() { return this.get<TrackSalesFeed>("/api/track/sales-feed"); }
  /**
   * Utilisation de Track (GET /api/track/usage) : compteurs du mois, historique, source des lectures. Sans
   * Track dans l'offre, l'API répond 402 : la vue « indisponible » est construite depuis l'abonnement.
   */
  async trackUsage(): Promise<TrackUsageView> {
    try {
      const u = await this.get<ApiTrackUsage>("/api/track/usage");
      const sub = await this.getSubscription();
      return {
        ...buildTrackUsage({ period: u.period, track: { filtersFollowed: u.counters.filtersFollowed, scans: u.counters.scans, photoSearches: u.counters.photoSearches } }, sub, u.counters.filtersFollowed.used),
        historyMonths: u.historyMonths, source: u.source, sourceLabel: u.sourceLabel, notices: u.notices, history: u.history,
      };
    } catch (e) {
      if (!(e instanceof DataError) || e.status !== 402) throw e;
      const [usage, sub] = await Promise.all([this.getUsage(), this.getSubscription()]);
      return buildTrackUsage(usage, sub, 0);
    }
  }
  // Estimation des prix (/api/pricing/*) : le prix est décidé par l'estimation, mon IA perso l'explique seulement.
  estimatePrice(input: PriceEstimateInput) { return this.post<PriceEstimate>("/api/pricing/estimate", input); }
  pricingModelStatus() { return this.get<PricingModelView>("/api/pricing/model"); }
  listPurchaseRequests() { return this.get<(PurchaseRequest & { opportunity: Opportunity | null })[]>("/api/purchases"); }
  createPurchaseRequest(input: { opportunityId: string; maxPriceCents: number; budgetCents: number }) { return this.post<PurchaseRequest>("/api/purchases", input); }
  confirmPurchaseRequest(id: string) { return this.post<PurchaseRequest>(`/api/purchases/${id}/confirm`); }
  cancelPurchaseRequest(id: string) { return this.post<PurchaseRequest>(`/api/purchases/${id}/cancel`); }

  describeConnectors() { return this.get<ConnectorDescriptor[]>("/api/connectors"); }
  listConnections() { return this.get<MarketplaceConnection[]>("/api/connections"); }
  createConnection(input: ConnectionCreate) { return this.post<MarketplaceConnection>("/api/connections", input); }
  updateConnection(id: string, input: ConnectionUpdate) { return this.patch<MarketplaceConnection>(`/api/connections/${id}`, input); }
  getConnectionStats() { return this.get<AccountStats[]>("/api/connections/stats"); }
  testConnection(id: string) { return this.post<ConnectionTestResult>(`/api/connections/${id}/test`); }
  syncConnection(id: string) { return this.post<{ conversations: number; items: number; orders: number; simulated: boolean }>(`/api/connections/${id}/sync`); }
  disconnectConnection(id: string) { return this.post<MarketplaceConnection>(`/api/connections/${id}/disconnect`); }
  deleteConnection(id: string) { return this.del<void>(`/api/connections/${id}`); }

  listExtensionTokens() { return this.get<ExtensionToken[]>("/api/extension-tokens"); }
  createExtensionToken(input: { label: string }) { return this.post<{ token: ExtensionToken; secret: string }>("/api/extension-tokens", input); }
  revokeExtensionToken(id: string) { return this.del<void>(`/api/extension-tokens/${id}`); }

  getAiStatus() { return this.get<AiStatus>("/api/ai/status"); }
  listAiRequests() { return this.get<AiRequest[]>("/api/ai/requests"); }
  getAiHealth(windowDays?: number) { return this.get<AiHealthData>("/api/ai/stats", { days: windowDays }); }

  getSubscription() { return this.get<Subscription>("/api/billing/subscription"); }
  getUsage() { return this.get<UsageSummary>("/api/billing/usage"); }
  startCheckout(plan: PaidPlan, opts: { cycle?: BillingCycle } = {}) { return this.post<CheckoutOutcome>("/api/billing/checkout", { plan, cycle: opts.cycle ?? "monthly" }); }
  startCardUpdate() { return this.post<CheckoutOutcome>("/api/billing/card"); }
  cancelSubscription() { return this.post<Subscription>("/api/billing/cancel"); }
  reactivateSubscription() { return this.post<Subscription>("/api/billing/reactivate"); }
  changePlan(plan: PaidPlan) { return this.post<Subscription>("/api/billing/plan", { plan }); }
  listInvoices() { return this.get<Invoice[]>("/api/billing/invoices"); }
  getInvoice(id: string) { return this.get<InvoiceView>(`/api/billing/invoices/${encodeURIComponent(id)}`); }
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
  getAdminUsage() { return this.get<AdminUsageReport>("/api/admin/usage"); }
  adminSetPlan(orgId: string, plan: Plan) { return this.post<void>(`/api/admin/orgs/${orgId}/plan`, { plan }); }
  adminListAudit(limit = 100) { return this.get<AuditLog[]>("/api/admin/audit", { limit }); }

  // Selio Agents est en aperçu : aucune donnée serveur, rien n'est enregistré sur le compte.
  async getWhiteLabel(): Promise<WhiteLabel | null> {
    return null;
  }
  async saveWhiteLabel(input: WhiteLabelInput): Promise<WhiteLabel> {
    void input;
    throw new DataError("preview_only", "Selio Agents est en aperçu : la marque blanche n'est pas encore enregistrée sur votre compte. Essayez-la dans la démonstration.", 501);
  }

  // Selio Cloud (/api/cloud/*). La session Vinted ne transite jamais ici : seulement « une session existe » et sa date.
  cloudAvailability() { return this.get<CloudAvailabilityView>("/api/cloud/availability"); }
  cloudConsent() { return this.get<CloudConsentView>("/api/cloud/consent"); }
  acceptCloudConsent(input: { version: string; accepted: true }) { return this.post<CloudConsentView>("/api/cloud/consent", input); }
  cloudAccounts() { return this.get<CloudAccountView[]>("/api/cloud/accounts"); }
  enableCloudAccount(connectionId: string) { return this.post<CloudAccount>("/api/cloud/accounts", { connectionId }); }
  pauseCloudAccount(id: string) { return this.post<CloudAccount>(`/api/cloud/accounts/${encodeURIComponent(id)}/pause`); }
  resumeCloudAccount(id: string, opts: { acknowledge?: boolean } = {}) { return this.post<CloudAccount>(`/api/cloud/accounts/${encodeURIComponent(id)}/resume`, { acknowledge: opts.acknowledge === true }); }
  stopCloudAccount(id: string) { return this.post<CloudAccount>(`/api/cloud/accounts/${encodeURIComponent(id)}/stop`); }
  deleteCloudSession(id: string) { return this.del<CloudAccount>(`/api/cloud/accounts/${encodeURIComponent(id)}/session`); }
  updateCloudSettings(id: string, input: { levels: CloudActionLevel[] }) { return this.patch<CloudAccount>(`/api/cloud/accounts/${encodeURIComponent(id)}/settings`, input); }
  cloudJournal(filters: CloudJournalFilters) { return this.get<Page<CloudAction>>("/api/cloud/journal", filters as Query); }
  exportCloudJournalCsv(filters: CloudJournalFilters) { return this.request<string>("GET", "/api/cloud/journal.csv" + qs({ kind: filters.kind, status: filters.status, accountId: filters.accountId }), undefined, { raw: true }); }
  async startCloudLogin(accountId: string): Promise<CloudLoginStart> {
    const t = await this.post<CloudLoginTicket>(`/api/cloud/accounts/${encodeURIComponent(accountId)}/login`);
    const href = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    return { ...t, socketUrl: loginSocketUrl(this.baseUrl, t.loginSessionId, t.ticket, href), simulated: false };
  }
  cancelCloudLogin(loginSessionId: string) { return this.post<void>(`/api/cloud/login/${encodeURIComponent(loginSessionId)}/cancel`); }
  async completeSimulatedCloudLogin(): Promise<CloudAccount> {
    throw new DataError("demo_only", "La connexion simulée n'existe qu'en démonstration : sur votre compte, connectez-vous dans la fenêtre sécurisée.", 409);
  }

  async resetDemo() {
    throw new DataError("conflict", "La réinitialisation n'existe qu'en mode démonstration.", 409);
  }

  askHelp(question: string) { return this.post<HelpAnswer>("/api/help/ask", { question }); }
}
