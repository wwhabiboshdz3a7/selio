import type { Capability, ConnectionTestResult, ConnectorStatus, ItemCondition, Provider } from "@selio/contracts";

export interface ConnectorContext {
  orgId: string;
  connectionId: string;
  /** Configuration non secrète de la connexion. */
  config: Record<string, unknown>;
  /** Secret déchiffré côté serveur, jamais transmis au client. */
  secret?: string | null;
  now: Date;
}

export type CapabilityErrorCode = "unsupported" | "not_connected" | "expired" | "degraded" | "rejected" | "network" | "needs_browser";

export type CapabilityResult<T> =
  | { ok: true; data: T; simulated: boolean }
  | { ok: false; code: CapabilityErrorCode; message: string; retryable: boolean };

export interface ExternalItem {
  externalRef: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: ItemCondition | null;
  priceCents: number;
  url: string | null;
  photoUrls: string[];
  status: "listed" | "reserved" | "sold";
  observedAt: string;
}

export interface ExternalMessage {
  externalRef: string;
  direction: "inbound" | "outbound";
  body: string;
  at: string;
}

export interface ExternalConversation {
  externalRef: string;
  buyerHandle: string;
  itemExternalRef: string | null;
  messages: ExternalMessage[];
  observedAt: string;
}

export interface ExternalOrder {
  externalRef: string;
  itemExternalRef: string;
  buyerHandle: string;
  salePriceCents: number;
  status: "paid" | "shipped" | "delivered" | "completed" | "cancelled";
  at: string;
}

export interface PreparedMessage {
  conversationRef: string;
  body: string;
  /** Instructions pour l'exécuteur (extension) : où coller, quoi vérifier. */
  steps: string[];
}

export interface SendReceipt {
  externalRef: string;
  sentAt: string;
}

export interface ShippingDocument {
  kind: "demo" | "connector";
  url: string | null;
  note: string;
}

export interface ConnectorDescriptor {
  provider: Provider;
  label: string;
  description: string;
  transport: "extension" | "server" | "simulator";
  experimental: boolean;
  capabilities: { capability: Capability; state: "available" | "experimental" | "unavailable"; note: string }[];
  /** Ce que l'utilisateur doit fournir pour configurer (jamais un mot de passe Vinted). */
  configFields: { key: string; label: string; secret: boolean; help: string }[];
  verificationNotes: string[];
}

export interface Connector {
  readonly provider: Provider;
  describe(): ConnectorDescriptor;
  test(ctx: ConnectorContext): Promise<ConnectionTestResult>;
  readItems?(ctx: ConnectorContext, opts?: { since?: string }): Promise<CapabilityResult<ExternalItem[]>>;
  readConversations?(ctx: ConnectorContext, opts?: { since?: string }): Promise<CapabilityResult<ExternalConversation[]>>;
  syncOrders?(ctx: ConnectorContext, opts?: { since?: string }): Promise<CapabilityResult<ExternalOrder[]>>;
  prepareMessage?(ctx: ConnectorContext, input: { conversationRef: string; body: string }): Promise<CapabilityResult<PreparedMessage>>;
  sendMessage?(ctx: ConnectorContext, input: { conversationRef: string; body: string; idempotencyKey: string }): Promise<CapabilityResult<SendReceipt>>;
  shippingDocument?(ctx: ConnectorContext, input: { orderRef: string }): Promise<CapabilityResult<ShippingDocument>>;
}

export function unsupported(message: string): CapabilityResult<never> {
  return { ok: false, code: "unsupported", message, retryable: false };
}

export function statusFromTest(result: Pick<ConnectionTestResult, "ok" | "status">): ConnectorStatus {
  return result.status;
}
