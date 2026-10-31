import type {
  AiRequest, AiStatus, AuditLog, ListingDraft, ListingGenerationInput, AutomationRule, AutomationRuleCreate, BulkItemAction, ConnectionCreate, ConnectionTestResult, ConnectionUpdate, Conversation, ConversationQuery, Customer, CustomerCreate, CustomerQuery, CustomerUpdate, ExtensionToken, InventoryEvent, InventoryItem, InventoryItemCreate, InventoryItemUpdate, InventoryQuery, Job, JobQuery, MarketplaceConnection, Membership, Message, Opportunity, Order, OrderCreate, OrderQuery, OrderStatus, Organization, OrgSettings, Page, Plan, PurchaseRequest, RadarSearch, RadarSearchCreate, Role, Shipment, Subscription, UsageEvent, User,
} from "@selio/contracts";
import type { WhiteLabel, WhiteLabelInput } from "@selio/contracts";
import type { ConnectorDescriptor } from "@selio/connectors";
import type { ReplySuggestion } from "@selio/contracts";
import type { BillingCycle, CheckoutResult, Invoice, InvoiceView, PaidPlan, SubsidiaryUsage, TrialDays, UsageCounter } from "@selio/contracts";
import type { HelpAnswer } from "@selio/contracts";
import type { CloudAccount, CloudAction, CloudActionKind, CloudActionLevel, CloudActionStatus, CloudAvailability, CloudConsentView, CloudLoginTicket } from "@selio/contracts";
import type { AutoBuySettings, PushSubscriptionInput, PushSubscriptionView, RadarAlertPayload, RadarMetrics, RadarReadOutcome, RadarSettings, RadarSettingsUpdate, RadarSourceKind } from "@selio/contracts";
import type { AccountStats, AiHealthSummary, BreakdownRow, DashboardData, DressingSummary, ListingPerformance, MarketInsights, NegotiationResult, PeriodPreset, RepublicationPlan, SalesKpis, SeriesPoint, StockKpis, variantLeaderboard } from "@selio/domain";

export type VariantLeaderboardRow = ReturnType<typeof variantLeaderboard>[number];

export type Mode = "demo" | "connected";

/**
 * Résultat du démarrage de paiement côté application : identique à `CheckoutResult` de l'API, sauf
 * que la démonstration peut le marquer `simulated` (aucun formulaire ouvert, succès immédiat).
 */
export type CheckoutOutcome = Omit<CheckoutResult, "simulated"> & { simulated: boolean };

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
  /** Vrai : un verrou de Radar Auto est fermé, rien n'a été évalué (`reasons`). */
  disabled?: boolean;
  reasons?: string[];
  /** Achats en attente de la validation 3-D Secure du client. */
  awaiting3ds?: number;
  /** Achat réel ouvert sur le serveur (sinon essai à blanc, enregistré « simulé »). */
  realPurchase?: boolean;
  notice?: string;
}

// ---------------------------------------------------------------- Selio Radar (miroir de packages/core/src/services/radar.ts)

/**
 * Résultat d'une analyse (miroir de `RunSearchResult`). Les champs autres que `found` sont facultatifs :
 * la démonstration et les serveurs plus anciens ne les rendent pas tous.
 */
export interface RadarRunResult {
  found: number;
  autoBought?: number;
  source?: RadarSourceKind;
  /** Résultat de la lecture (null : aucune page lue). */
  outcome?: RadarReadOutcome | null;
  /** Lecture écartée (`too_soon`, `pages_per_minute`, `machine_paused`…), avec son explication. */
  skipped?: string | null;
  message?: string;
  itemsSeen?: number;
  duplicates?: number;
  factor?: number;
  intervalSeconds?: number;
  nextReadAt?: string | null;
  /** Vinted a arrêté la lecture : compte Cloud en pause. */
  paused?: boolean;
  /** Démonstration : lecture simulée, aucune page Vinted lue. */
  simulated?: boolean;
}

/** Statistiques de Radar ; `demo` : chiffres fictifs de la démonstration (jamais présentés comme mesurés). */
export interface RadarMetricsView extends RadarMetrics {
  demo?: boolean;
}

/** Verrou de Radar Auto (mêmes clés que `RadarAutoStatus`, packages/core/src/services/radar.ts). */
export type RadarAutoLockKey = "server" | "shared_address" | "organization" | "cloud" | "consent" | (string & {});

export interface RadarAutoLock {
  key: RadarAutoLockKey;
  /** Verrou levé. */
  ok: boolean;
  label: string;
  detail: string;
}

/**
 * État de Radar Auto (GET /api/radar/auto/status) : verrous et réglages. Radar Auto n'achète que si TOUS
 * les verrous sont levés ; le réglage n'est modifiable que si le verrou serveur (RADAR_AUTO_ENABLED,
 * comptes de l'équipe sur l'adresse partagée) est ouvert.
 */
export interface AutoBuyStatus {
  /** Tous les verrous levés et rien n'arrête les achats : Radar Auto peut acheter au prochain passage. */
  active: boolean;
  /** Verrou serveur ouvert pour cette organisation (RADAR_AUTO_ENABLED et comptes de l'équipe). */
  serverEnabled: boolean;
  /** Réglage de l'organisation. */
  orgEnabled: boolean;
  /** Achat réel ouvert (D11 : faux par défaut ; sinon le parcours s'arrête avant le paiement). */
  realPurchase: boolean;
  locks: RadarAutoLock[];
  /** Raisons qui empêchent Radar Auto d'acheter, en clair. */
  reasons: string[];
  /** Mention de l'adresse partagée (décision d'Ibrahim en attente). */
  notice: string;
  account: { id: string; label: string } | null;
  settings: AutoBuySettings;
  /** Démonstration : état simulé (serveur de démonstration, Radar Auto fermé). */
  simulated?: boolean;
}

/** Une affaire prête pour le « 1 clic » (miroir de `OpportunityDetail`). */
export interface OpportunityDetail extends Opportunity {
  search: { id: string; name: string; source: RadarSourceKind } | null;
  /** Demande d'achat active (ni annulée ni bloquée), s'il y en a une. */
  purchase: PurchaseRequest | null;
  /** Adresse de l'annonce sur Vinted (https, liste fermée des domaines), sinon null. */
  itemUrl: string | null;
}

/** Reprise après une validation 3-D Secure : directe, ou mise en file pour le worker (réponse 202). */
export interface ResumeResult {
  purchase: PurchaseRequest;
  /** Vrai : la relecture de la confirmation est en file dans le worker ; l'issue se lit dans la liste des achats. */
  queued: boolean;
}

/** Notifications Web Push (GET /api/push/config) : clé publique VAPID seulement, jamais la clé privée. */
export interface PushConfig {
  /** Le serveur a ses clés VAPID et peut envoyer des notifications. */
  enabled: boolean;
  publicKey: string | null;
  /** Pourquoi les notifications sont indisponibles (null si elles le sont). */
  reason: string | null;
  /** Démonstration : rien ne part d'un serveur, le test s'affiche sur cet appareil. */
  simulated?: boolean;
}

/** Résultat d'une notification de test. */
export interface PushTestResult {
  sent: number;
  /** Appareils abonnés visés. */
  devices?: number;
  failed?: number;
  /** Appareils désactivés (le service de notification a répondu 404 ou 410). */
  disabled?: number;
  /** Démonstration : rien n'est envoyé, `payload` s'affiche localement. */
  simulated?: boolean;
  payload?: RadarAlertPayload;
  message?: string;
}

export type RadarSettingsResult = { radar: RadarSettings; autoBuy: AutoBuySettings };

/** Compte Cloud vu par l'application (miroir de `CloudAccountView`, packages/core/src/services/cloud.ts). */
export interface CloudAccountView extends CloudAccount {
  connectionLabel: string;
  displayHandle: string | null;
  /** Actions du jour (UTC) ayant ouvert le navigateur pour ce compte. */
  actionsToday: number;
}

/** Disponibilité du Cloud, plus ce que le serveur ajoute en mode connecté (apps/api/src/routes/cloud.ts). */
export interface CloudAvailabilityView extends CloudAvailability {
  /** Cloud activé sur ce serveur (CLOUD_ENABLED et Redis) ; absent en démonstration. */
  serverEnabled?: boolean;
  /** Heures actives appliquées par le serveur (CLOUD_ACTIVE_HOURS) ; sinon celles des contrats. */
  activeHours?: { startHour: number; endHour: number };
}

/** Filtres et page du journal Cloud (gardé 90 jours). */
export interface CloudJournalFilters {
  kind?: CloudActionKind;
  status?: CloudActionStatus;
  accountId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Ouverture d'une fenêtre de connexion : ticket à usage unique (jamais réaffiché), adresse du
 * WebSocket en mode connecté ; en démonstration, `simulated` et aucune adresse (rien ne touche Vinted).
 */
export interface CloudLoginStart extends CloudLoginTicket {
  socketUrl: string | null;
  simulated: boolean;
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
  /** Analyse une recherche ; en direct, une lecture non prête est refusée avec son explication. */
  runSearch(id: string): Promise<RadarRunResult>;
  listOpportunities(query: { searchId?: string; status?: Opportunity["status"] }): Promise<Opportunity[]>;
  /** Une affaire (page « 1 clic ») : recherche d'origine, demande d'achat active, lien Vinted vérifié. */
  getOpportunity(id: string): Promise<OpportunityDetail>;
  setOpportunityStatus(id: string, status: Opportunity["status"]): Promise<Opportunity>;
  /** Mesures de Radar sur `days` jours : « à mesurer » tant qu'aucune lecture en direct n'existe. */
  radarMetrics(days?: number): Promise<RadarMetricsView>;
  /** Réglages Radar (alertes, heures calmes) et Radar Auto ; activer Radar Auto exige le verrou serveur. */
  updateRadarSettings(input: RadarSettingsUpdate): Promise<RadarSettingsResult>;
  // Bonnes affaires : validation en un clic et achat automatique
  /** « Je l'ai achetée » : report d'un achat fait par le client ; `paidCents` = prix réellement payé (port compris), sinon le coût estimé. */
  quickBuy(opportunityId: string, opts?: { paidCents?: number | null }): Promise<PurchaseRequest>;
  runAutoBuy(): Promise<AutoBuyRunResult>;
  /** Verrous, réglages et dépense du jour de Radar Auto. */
  autoBuyStatus(): Promise<AutoBuyStatus>;
  /** Le client a validé le paiement 3-D Secure dans son application bancaire : Selio relit la confirmation. */
  resumePurchase(id: string): Promise<ResumeResult>;
  // Alertes Radar sur le téléphone (notifications de la PWA)
  pushConfig(): Promise<PushConfig>;
  /** Appareils abonnés de l'utilisateur (sans les clés). */
  listPushSubscriptions(): Promise<PushSubscriptionView[]>;
  subscribePush(input: PushSubscriptionInput): Promise<PushSubscriptionView>;
  unsubscribePush(endpoint: string): Promise<{ removed: boolean }>;
  /** Retire un appareil abonné de l'utilisateur (appareil perdu, ancien téléphone). */
  removePushSubscription(id: string): Promise<{ removed: boolean }>;
  /** Notification de test vers les appareils abonnés de l'utilisateur. */
  testPush(): Promise<PushTestResult>;
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
  /**
   * Démarre le paiement d'une offre payante (Starter, Pro ou Agence ; « free » n'est pas une offre) :
   * crée la commande Revolut et renvoie son jeton public pour le formulaire. Pendant l'essai, la
   * carte est seulement enregistrée (rien débité avant la fin) ; carte déjà enregistrée = changement
   * d'offre sans formulaire (`orderToken` null). En démonstration, le succès est immédiat.
   */
  startCheckout(plan: PaidPlan, opts?: { cycle?: BillingCycle }): Promise<CheckoutOutcome>;
  /** Changement de carte sans paiement (abonnement en cours) : autorisation de vérification annulée aussitôt. */
  startCardUpdate(): Promise<CheckoutOutcome>;
  /** Résiliation : l'accès continue jusqu'à la fin de la période payée (ou de l'essai). */
  cancelSubscription(): Promise<Subscription>;
  /** Annule une résiliation demandée tant que la période court. */
  reactivateSubscription(): Promise<Subscription>;
  /** Changement d'offre, appliqué au prochain renouvellement (carte enregistrée requise). */
  changePlan(plan: PaidPlan): Promise<Subscription>;
  listInvoices(): Promise<Invoice[]>;
  /** Facture prête pour un rendu imprimable (mentions, lignes, HT / TVA / TTC ou franchise). */
  getInvoice(id: string): Promise<InvoiceView>;
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
  // Selio Cloud : accord, comptes, journal, fenêtre de connexion (le client se connecte lui-même)
  /** Le Cloud selon l'offre : compris (Agence), en option à prix à décider (Pro), indisponible (accès de base, Starter). */
  cloudAvailability(): Promise<CloudAvailabilityView>;
  /** Texte d'accord courant, version et dernier accord enregistré (valable pour la version courante ou non). */
  cloudConsent(): Promise<CloudConsentView>;
  /** Enregistre l'accord (case cochée) pour la version courante : utilisateur, date, empreinte du texte. */
  acceptCloudConsent(input: { version: string; accepted: true }): Promise<CloudConsentView>;
  cloudAccounts(): Promise<CloudAccountView[]>;
  /** Relie un compte Vinted au Cloud (accord valide, offre compatible, 10 comptes au plus) : il démarre « connexion à faire ». */
  enableCloudAccount(connectionId: string): Promise<CloudAccount>;
  pauseCloudAccount(id: string): Promise<CloudAccount>;
  /** Reprise ; après un signal de Vinted (CAPTCHA, avertissement…), `acknowledge: true` est exigé. */
  resumeCloudAccount(id: string, opts?: { acknowledge?: boolean }): Promise<CloudAccount>;
  /** Arrête le Cloud du compte : session effacée, tâches annulées. */
  stopCloudAccount(id: string): Promise<CloudAccount>;
  /** Supprime la session enregistrée en un clic (le compte repasse « connexion à faire »). */
  deleteCloudSession(id: string): Promise<CloudAccount>;
  /** Niveaux d'action ; « lourd » refusé tant que le réglage serveur ne l'ouvre pas (à décider). */
  updateCloudSettings(id: string, input: { levels: CloudActionLevel[] }): Promise<CloudAccount>;
  cloudJournal(filters: CloudJournalFilters): Promise<Page<CloudAction>>;
  exportCloudJournalCsv(filters: CloudJournalFilters): Promise<string>;
  /** Ouvre une fenêtre de connexion sécurisée pour un compte Cloud. */
  startCloudLogin(accountId: string): Promise<CloudLoginStart>;
  /** Ferme une fenêtre de connexion sans rien enregistrer. */
  cancelCloudLogin(loginSessionId: string): Promise<void>;
  /** Démonstration seulement : la connexion simulée aboutit (aucune saisie, rien ne touche Vinted). */
  completeSimulatedCloudLogin(loginSessionId: string): Promise<CloudAccount>;
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
