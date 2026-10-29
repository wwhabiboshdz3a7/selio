import type {
  AiRequest, AiStatus, AuditLog, ListingDraft, ListingGenerationInput, AutomationRule, AutomationRuleCreate, BulkItemAction, ConnectionCreate, ConnectionTestResult, ConnectionUpdate, Conversation, ConversationQuery, Customer, CustomerCreate, CustomerQuery, CustomerUpdate, ExtensionToken, InventoryEvent, InventoryItem, InventoryItemCreate, InventoryItemUpdate, InventoryQuery, Job, JobQuery, MarketplaceConnection, Membership, Message, Opportunity, Order, OrderCreate, OrderQuery, OrderStatus, Organization, OrgSettings, Page, Plan, PurchaseRequest, RadarSearch, RadarSearchCreate, Role, Shipment, Subscription, UsageEvent, User,
} from "@selio/contracts";
import type { WhiteLabel, WhiteLabelInput } from "@selio/contracts";
import type { ConnectorDescriptor } from "@selio/connectors";
import type { ReplySuggestion } from "@selio/contracts";
import type { PaidPlan, SubsidiaryUsage, TrialDays, UsageCounter } from "@selio/contracts";
import type { HelpAnswer } from "@selio/contracts";
import type { AccountStats, AiHealthSummary, BreakdownRow, DashboardData, DressingSummary, ListingPerformance, MarketInsights, NegotiationResult, PeriodPreset, RepublicationPlan, SalesKpis, SeriesPoint, StockKpis, variantLeaderboard } from "@selio/domain";

export type VariantLeaderboardRow = ReturnType<typeof variantLeaderboard>[number];

export type Mode = "demo" | "connected";

export interface Session {
  mode: Mode;
  user: User;
  org: Organization;
  role: Role;
  memberships: (Membership & { orgName: string })[];
}

export interface OverviewData {
  period: PeriodPreset;
  sales: SalesKpis;
  previousSales: SalesKpis;
  stock: StockKpis;
  series: SeriesPoint[];
  counts: { openConversations: number; unreadMessages: number; pendingOrders: number; jobsAwaiting: number; jobsFailed: number };
  alerts: { id: string; tone: "warning" | "danger" | "info"; title: string; description: string; to: string }[];
  recentOrders: Order[];
  recentConversations: Conversation[];
  staleItems: InventoryItem[];
  /** Libellé humain de la période (« octobre 2026 » pour ce mois-ci). */
  periodLabel: string;
  /** Données des graphiques ajoutables. */
  dashboard: DashboardData;
  /** Rendement du dressing (note moyenne, annonces à republier). */
  dressing: DressingSummary;
}

export interface AnalyticsData {
  period: PeriodPreset;
  sales: SalesKpis;
  previousSales: SalesKpis;
  stock: StockKpis;
  series: SeriesPoint[];
  byCategory: BreakdownRow[];
  byChannel: BreakdownRow[];
  byBrand: BreakdownRow[];
  topItems: { item: InventoryItem; order: Order; marginCents: number }[];
}

export interface AnalyticsFilters {
  period: PeriodPreset;
  category?: string;
  channel?: string;
  granularity?: "day" | "week" | "month";
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  customer: Customer;
  item: InventoryItem | null;
  connection: MarketplaceConnection | null;
  lastOffer: { offerCents: number; evaluation: NegotiationResult } | null;
}

export interface SuggestionResult {
  draft: Message;
  suggestion: ReplySuggestion;
  evaluation: NegotiationResult | null;
  source: "ai" | "fallback";
  provider: string;
  model: string;
  validated: boolean;
  rejectionReason: string | null;
  simulated: boolean;
}

export interface CustomerTimeline {
  customer: Customer;
  conversations: Conversation[];
  orders: (Order & { item: InventoryItem | null })[];
  events: { at: string; kind: "message" | "order" | "note" | "created"; label: string; to?: string }[];
  totals: { orders: number; revenueCents: number; marginCents: number };
}

export interface AutomationState {
  globalPaused: boolean;
  pausedAt: string | null;
  actionsToday: number;
}

/**
 * Utilisation du mois (miroir de `UsageReport` dans packages/core/src/services/billing.ts) :
 * champs historiques, compteurs généraux avec alerte à 80 % (`counters`) et un bloc par filiale
 * (`studio`, `track`, `cloud`). `period.from` est le 1er du mois (UTC) : la date de remise à zéro.
 */
export interface UsageSummary extends SubsidiaryUsage {
  period: { from: string; to: string };
  aiRequests: number;
  automationActions: number;
  connectorSyncs: number;
  exports: number;
  extensionCaptures: number;
  quotas: Subscription["quotas"];
  itemsCount: number;
  connectionsCount: number;
  membersCount: number;
  counters: { aiRequests: UsageCounter; items: UsageCounter; connections: UsageCounter; members: UsageCounter };
  /** Au moins un compteur à 80 % ou plus. */
  warning: boolean;
}

/** Utilisation d'un client vue par l'opérateur (miroir de `AdminOrgUsage` dans packages/core/src/services/admin.ts). */
export interface AdminOrgUsage {
  id: string;
  name: string;
  plan: Plan;
  status: string;
  createdAt: string;
  counters: UsageSummary["counters"];
  studio: SubsidiaryUsage["studio"];
  track: SubsidiaryUsage["track"];
  cloud: SubsidiaryUsage["cloud"];
  /** Actions automatiques du mois (information, sans quota mensuel). */
  automationActions: number;
  /** Pourcentage du compteur le plus avancé (0–100). */
  maxPercent: number;
  warning: boolean;
  exceeded: boolean;
}

export interface AdminUsageReport {
  period: { from: string; to: string };
  orgs: AdminOrgUsage[];
}

export interface ServiceStatus {
  name: string;
  ok: boolean;
  status: string;
  message: string;
  latencyMs: number | null;
  checkedAt: string;
}

/** État de l'IA (Paramètres › Assistant IA) : taux sur la période, quota du mois, limites de la passerelle. */
export interface AiHealthData extends AiHealthSummary {
  quota: { used: number; limit: number; planLimit: number; orgLimit: number; monthStart: string };
  limits: { timeoutMs: number; concurrency: number; maxPending: number; circuitFailures: number; circuitCooldownMs: number };
}

export interface AdminOverview {
  services: ServiceStatus[];
  queues: { name: string; waiting: number; active: number; failed: number; completed: number; paused: boolean }[];
  connectors: { provider: string; connections: number; byStatus: Record<string, number> }[];
  ai: { status: AiStatus; requests24h: number; failures24h: number; tokens24h: number; byOrg: { orgId: string; orgName: string; requests: number }[] };
  errors: { at: string; source: string; message: string; orgId: string | null }[];
  orgs: { id: string; name: string; plan: Plan; members: number; items: number; createdAt: string }[];
  plans: { plan: Plan; quotas: Subscription["quotas"]; orgCount: number }[];
}

/** Dressing intelligent : annonces en ligne avec note, rendement et plan de republication. */
export interface DressingListing {
  item: InventoryItem;
  performance: ListingPerformance;
  plan: RepublicationPlan;
}
export interface DressingQuery {
  /** due = à republier ; 7/14/30 = en ligne depuis au moins N jours ; weak = note < 60. */
  filter?: "all" | "due" | "7" | "14" | "30" | "weak";
  sort?: "online_desc" | "score_asc" | "score_desc" | "views_desc" | "favorites_desc";
  q?: string;
  connectionId?: string;
}
export interface DressingData {
  listings: DressingListing[];
  summary: DressingSummary;
  leaderboard: VariantLeaderboardRow[];
  republishAfterDays: number;
}
export interface MarketQuery {
  windowDays?: number;
  category?: string;
}
export interface MarketData extends MarketInsights {
  /** demo_simulator : marché fictif ; observations : annonces observées par le radar et l'extension. */
  source: "demo_simulator" | "observations";
  observedCount: number;
  generatedAt: string;
}
export interface AutoBuyRunResult {
  evaluated: number;
  bought: number;
  spentCents: number;
  skipped: { reason: string; count: number }[];
  /** Compte Achat utilisé (null = aucun compte Achat actif). */
  account?: { id: string; label: string } | null;
}

export interface DataClient {
  readonly mode: Mode;
  // Session
  getSession(): Promise<Session | null>;
  login(input: { email: string; password: string }): Promise<Session>;
  /** `trialDays` : durée de l'essai, 14 jours (seule valeur ; carte enregistrée, rien débité avant la fin). */
  register(input: { email: string; password: string; displayName: string; orgName: string; trialDays?: TrialDays }): Promise<Session>;
  logout(): Promise<void>;
  switchOrg(orgId: string): Promise<Session>;
  /**
   * Mot de passe oublié : se résout toujours sans dire si un compte existe (aucune énumération) ;
   * si c'est le cas, un email avec un lien à usage unique (1 heure) part.
   */
  requestPasswordReset(email: string): Promise<void>;
  /** Nouveau mot de passe depuis le lien reçu par email ; `token_invalid` si le lien est inconnu, expiré ou déjà utilisé. */
  resetPassword(input: { token: string; password: string }): Promise<void>;
  /** Acceptation d'une invitation : mot de passe (et nom) définis, session ouverte dans l'organisation. */
  acceptInvite(input: { token: string; password: string; displayName?: string }): Promise<Session>;
  // Organisation
  updateOrg(input: { name?: string; settings?: Partial<OrgSettings> }): Promise<Organization>;
  listMembers(): Promise<(Membership & { user: User })[]>;
  inviteMember(input: { email: string; role: Role }): Promise<Membership & { user: User }>;
  updateMemberRole(membershipId: string, role: Role): Promise<void>;
  removeMember(membershipId: string): Promise<void>;
  completeOnboardingStep(step: string): Promise<Organization>;
  // Articles
  listItems(query: Partial<InventoryQuery>): Promise<Page<InventoryItem>>;
  listItemBrands(): Promise<string[]>;
  getItem(id: string): Promise<InventoryItem>;
  createItem(input: InventoryItemCreate): Promise<InventoryItem>;
  updateItem(id: string, input: InventoryItemUpdate): Promise<InventoryItem>;
  setItemStatus(id: string, status: InventoryItem["status"]): Promise<InventoryItem>;
  deleteItem(id: string): Promise<void>;
  bulkItems(action: BulkItemAction): Promise<{ affected: number }>;
  importItems(items: InventoryItemCreate[]): Promise<{ created: number }>;
  exportItemsCsv(): Promise<string>;
  itemHistory(id: string): Promise<InventoryEvent[]>;
  // Clients
  listCustomers(query: Partial<CustomerQuery>): Promise<Page<Customer & { orderCount: number; revenueCents: number }>>;
  getCustomerTimeline(id: string): Promise<CustomerTimeline>;
  createCustomer(input: CustomerCreate): Promise<Customer>;
  updateCustomer(id: string, input: CustomerUpdate): Promise<Customer>;
  mergeCustomers(keepId: string, mergeId: string): Promise<Customer>;
  // Messagerie
  listConversations(query: Partial<ConversationQuery>): Promise<Page<Conversation & { customer: Customer; item: InventoryItem | null }>>;
  getConversation(id: string): Promise<ConversationDetail>;
  markConversationRead(id: string): Promise<void>;
  setConversationStatus(id: string, status: Conversation["status"]): Promise<void>;
  createDraft(input: { conversationId: string; body: string; offerCents?: number | null }): Promise<Message>;
  updateDraft(messageId: string, body: string): Promise<Message>;
  deleteDraft(messageId: string): Promise<void>;
  sendMessage(messageId: string): Promise<Message>;
  suggestReply(conversationId: string): Promise<SuggestionResult>;
  evaluateOffer(conversationId: string, offerCents: number): Promise<NegotiationResult>;
  simulateIncomingMessage(conversationId: string | null, body?: string): Promise<Conversation>;
  // Commandes
  listOrders(query: Partial<OrderQuery>): Promise<Page<Order & { item: InventoryItem | null; customer: Customer | null }>>;
  getOrder(id: string): Promise<{ order: Order; item: InventoryItem | null; customer: Customer | null; shipment: Shipment | null; marginCents: number }>;
  createOrder(input: OrderCreate): Promise<{ order: Order; created: boolean }>;
  updateOrder(id: string, input: Partial<Pick<Order, "salePriceCents" | "platformFeeCents" | "shippingCostCents" | "otherCostsCents">>): Promise<Order>;
  transitionOrder(id: string, status: OrderStatus, note?: string): Promise<Order>;
  updateShipment(orderId: string, input: Partial<Pick<Shipment, "carrier" | "trackingNumber" | "status">>): Promise<Shipment>;
  requestShippingDocument(orderId: string): Promise<Shipment>;
  // Analyses
  getOverview(period: PeriodPreset): Promise<OverviewData>;
  getAnalytics(filters: AnalyticsFilters): Promise<AnalyticsData>;
  exportAnalyticsCsv(filters: AnalyticsFilters): Promise<string>;
  // Automatisations
  listRules(): Promise<AutomationRule[]>;
  createRule(input: AutomationRuleCreate): Promise<AutomationRule>;
  updateRule(id: string, input: Partial<AutomationRuleCreate>): Promise<AutomationRule>;
  deleteRule(id: string): Promise<void>;
  getAutomationState(): Promise<AutomationState>;
  setGlobalPause(paused: boolean): Promise<AutomationState>;
  runRuleNow(id: string): Promise<{ evaluated: number; created: number; skipped: { reason: string; count: number }[] }>;
  listJobs(query: Partial<JobQuery>): Promise<Page<Job>>;
  approveJob(id: string): Promise<Job>;
  cancelJob(id: string): Promise<Job>;
  retryJob(id: string): Promise<Job>;
  // Radar
  listSearches(): Promise<RadarSearch[]>;
  createSearch(input: RadarSearchCreate): Promise<RadarSearch>;
  updateSearch(id: string, input: Partial<RadarSearchCreate>): Promise<RadarSearch>;
  deleteSearch(id: string): Promise<void>;
  runSearch(id: string): Promise<{ found: number; autoBought?: number }>;
  listOpportunities(query: { searchId?: string; status?: Opportunity["status"] }): Promise<Opportunity[]>;
  setOpportunityStatus(id: string, status: Opportunity["status"]): Promise<Opportunity>;
  // Bonnes affaires : validation en un clic et achat automatique
  quickBuy(opportunityId: string): Promise<PurchaseRequest>;
  runAutoBuy(): Promise<AutoBuyRunResult>;
  // Générateur d'annonces (IA)
  generateListing(input: ListingGenerationInput): Promise<ListingDraft>;
  // Dressing intelligent
  getDressing(query: DressingQuery): Promise<DressingData>;
  republishItem(id: string, variantId: string): Promise<InventoryItem>;
  // Analyse des revendeurs et des niches
  getMarketInsights(query: MarketQuery): Promise<MarketData>;
  // Achat assisté
  listPurchaseRequests(): Promise<(PurchaseRequest & { opportunity: Opportunity | null })[]>;
  createPurchaseRequest(input: { opportunityId: string; maxPriceCents: number; budgetCents: number }): Promise<PurchaseRequest>;
  confirmPurchaseRequest(id: string): Promise<PurchaseRequest>;
  cancelPurchaseRequest(id: string): Promise<PurchaseRequest>;
  // Connexions
  describeConnectors(): Promise<ConnectorDescriptor[]>;
  listConnections(): Promise<MarketplaceConnection[]>;
  createConnection(input: ConnectionCreate): Promise<MarketplaceConnection>;
  /** Renomme un compte, change sa catégorie (vente, achat, perso) ou son pseudo Vinted affiché. */
  updateConnection(id: string, input: ConnectionUpdate): Promise<MarketplaceConnection>;
  /** Chiffres utiles par compte : annonces en ligne, ventes du mois, achats, conversations ouvertes. */
  getConnectionStats(): Promise<AccountStats[]>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  syncConnection(id: string): Promise<{ conversations: number; items: number; orders: number; simulated: boolean }>;
  disconnectConnection(id: string): Promise<MarketplaceConnection>;
  deleteConnection(id: string): Promise<void>;
  // Jetons d'extension
  listExtensionTokens(): Promise<ExtensionToken[]>;
  createExtensionToken(input: { label: string }): Promise<{ token: ExtensionToken; secret: string }>;
  revokeExtensionToken(id: string): Promise<void>;
  // IA
  getAiStatus(): Promise<AiStatus>;
  listAiRequests(): Promise<AiRequest[]>;
  /** Taux de réussite, quota du mois et limites, sur les `windowDays` derniers jours (30 par défaut). */
  getAiHealth(windowDays?: number): Promise<AiHealthData>;
  // Abonnement et consommation
  getSubscription(): Promise<Subscription>;
  getUsage(): Promise<UsageSummary>;
  /** Ouvre le paiement d'une offre payante (Starter, Pro ou Agence) ; « free » n'est pas une offre. */
  startCheckout(plan: PaidPlan): Promise<{ url: string | null; simulated: boolean; message: string }>;
  // Sécurité et données
  listAuditLogs(limit?: number): Promise<AuditLog[]>;
  changePassword(input: { current: string; next: string }): Promise<void>;
  exportAllData(): Promise<Blob>;
  deleteOrganization(confirmName: string): Promise<void>;
  // Statut des services
  getServiceStatus(): Promise<ServiceStatus[]>;
  // Administration opérateur
  getAdminOverview(): Promise<AdminOverview>;
  /** Utilisation par client : compteurs du mois, pourcentage et alerte à 80 % pour chaque organisation. */
  getAdminUsage(): Promise<AdminUsageReport>;
  adminSetPlan(orgId: string, plan: Plan): Promise<void>;
  adminListAudit(limit?: number): Promise<AuditLog[]>;
  // Selio Agents (aperçu) : marque blanche
  /** Marque blanche enregistrée (null tant qu'elle n'est pas personnalisée, et toujours en mode connecté). */
  getWhiteLabel(): Promise<WhiteLabel | null>;
  /** Enregistre la marque blanche dans la démonstration. Mode connecté : aperçu non enregistré (erreur « preview_only »). */
  saveWhiteLabel(input: WhiteLabelInput): Promise<WhiteLabel>;
  // Démo
  resetDemo(): Promise<void>;
  // Usage (pour la page Consommation)
  listUsageEvents(limit?: number): Promise<UsageEvent[]>;
  // Aide : réponse rédigée à partir de la FAQ (IA en mode connecté, recherche locale en démo)
  askHelp(question: string): Promise<HelpAnswer>;
}

export class DataError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = "DataError";
  }
}
