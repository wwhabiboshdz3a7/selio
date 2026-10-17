import type { AiStatus, Conversation, Customer, InventoryItem, MarketplaceConnection, Message, Order, Plan, ReplySuggestion, Subscription } from "@selio/contracts";
import type { BreakdownRow, DashboardData, DressingSummary, ListingPerformance, MarketInsights, NegotiationResult, PeriodPreset, RepublicationPlan, SalesKpis, SeriesPoint, StockKpis, variantLeaderboard } from "@selio/domain";
import type { AiHealthSummary } from "@selio/domain";

export type VariantLeaderboardRow = ReturnType<typeof variantLeaderboard>[number];

/** Types de réponse partagés avec le client web (miroir de apps/web/src/lib/data/types.ts). */
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
export interface UsageSummary {
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
}
