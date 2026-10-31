import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentMode } from "@selio/contracts";
import {
  PAYMENT_WEBHOOK_EVENTS,
  PaymentApiError,
  PaymentConfigError,
  type CheckoutOrder,
  type CreateOrderInput,
  type PaymentLogger,
  type PaymentOrderInfo,
  type PaymentProvider,
  type PaymentState,
  type PaymentWebhookEvent,
  type SavedPaymentMethod,
  type WebhookHeaders,
  type WebhookVerification,
} from "./types";

/**
 * Adaptateur Revolut Merchant API, côté serveur uniquement, sans SDK (surface réduite,
 * testable avec un `fetch` injecté).
 * - Hôte selon le mode : bac à sable par défaut ; la production exige REVOLUT_LIVE_ALLOWED=true.
 * - Authentification : `Authorization: Bearer sk_…` et `Revolut-Api-Version` sur chaque appel.
 * - Webhooks : HMAC-SHA256 de `v1.<horodatage>.<corps brut>`, plusieurs signatures acceptées,
 *   tolérance de cinq minutes sur l'horodatage.
 * - Journaux : méthode, chemin, statut et durée ; jamais la clé ni un corps complet.
 */
export const REVOLUT_HOSTS: Record<PaymentMode, string> = {
  sandbox: "https://sandbox-merchant.revolut.com",
  live: "https://merchant.revolut.com",
};
export const DEFAULT_REVOLUT_API_VERSION = "2026-08-17";
/** Tolérance sur l'horodatage d'un webhook (rejeu). */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;
/** Frais Revolut par carte européenne (information : factures, documentation). Jamais refacturés. */
export const REVOLUT_CARD_FEE = { rate: 0.01, fixedCents: 20 } as const;

export interface RevolutConfig {
  secretKey: string;
  /** Secret de signature des webhooks (`wsk_…`) ; sans lui, toute livraison est refusée. */
  webhookSecret?: string | null;
  mode?: PaymentMode;
  apiVersion?: string;
  /** Doit être explicitement `true` pour parler à l'hôte de production. */
  liveAllowed?: boolean;
  fetchImpl?: typeof fetch;
  logger?: PaymentLogger;
  timeoutMs?: number;
  /** Remplace l'hôte (tests) ; sinon déduit du mode. */
  apiBase?: string;
}

const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_");

/** Normalise un état Revolut (commande ou paiement) vers l'état commun. */
export function normalizeState(raw: unknown): PaymentState {
  const s = typeof raw === "string" ? snake(raw) : "";
  if (s === "completed" || s === "captured") return "completed";
  if (s === "authorised" || s === "authorized" || s === "authorisation_passed") return "authorised";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "failed" || s === "declined" || s === "soft_declined") return "failed";
  if (s === "pending") return "pending";
  return "processing";
}

/** Signature attendue d'une livraison : HMAC-SHA256(secret, "v1." + horodatage + "." + corps). */
export function computeRevolutSignature(secret: string, timestamp: string | number, rawBody: string): string {
  return createHmac("sha256", secret).update(`v1.${timestamp}.${rawBody}`).digest("hex");
}

function headerValue(headers: WebhookHeaders, name: string): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v.join(",");
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Lit `v1=<hex>` (plusieurs valeurs possibles, séparées par des virgules). */
export function parseRevolutSignatures(header: string): string[] {
  return header
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3).trim().toLowerCase())
    .filter((p) => /^[0-9a-f]{64}$/.test(p));
}

/**
 * Vérification pure (testable sans client) : signature, horodatage, corps.
 * Retourne l'événement et l'identifiant de commande ; jamais le corps complet.
 */
export function verifyRevolutWebhook(rawBody: string, headers: WebhookHeaders, secret: string | null | undefined, now: Date, toleranceMs = WEBHOOK_TOLERANCE_MS): WebhookVerification {
  if (!secret) return { ok: false, reason: "Webhook Revolut non configuré (REVOLUT_WEBHOOK_SECRET absent)" };
  const ts = headerValue(headers, "revolut-request-timestamp");
  const sigHeader = headerValue(headers, "revolut-signature");
  if (!ts) return { ok: false, reason: "En-tête Revolut-Request-Timestamp absent" };
  if (!sigHeader) return { ok: false, reason: "En-tête Revolut-Signature absent" };
  if (!/^\d{1,16}$/.test(ts)) return { ok: false, reason: "Horodatage illisible" };
  if (Math.abs(now.getTime() - Number(ts)) > toleranceMs) return { ok: false, reason: "Horodatage hors tolérance (rejeu ?)" };
  const candidates = parseRevolutSignatures(sigHeader);
  if (candidates.length === 0) return { ok: false, reason: "En-tête Revolut-Signature illisible" };
  const expected = Buffer.from(computeRevolutSignature(secret, ts, rawBody), "hex");
  const match = candidates.some((c) => {
    const buf = Buffer.from(c, "hex");
    return buf.length === expected.length && timingSafeEqual(buf, expected);
  });
  if (!match) return { ok: false, reason: "Signature invalide" };
  let body: { event?: unknown; order_id?: unknown; merchant_order_ext_ref?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return { ok: false, reason: "Corps JSON invalide" };
  }
  const event = typeof body.event === "string" ? body.event : "";
  if (!(PAYMENT_WEBHOOK_EVENTS as readonly string[]).includes(event)) return { ok: false, reason: `Événement non pris en charge : ${event.slice(0, 40) || "(vide)"}` };
  if (typeof body.order_id !== "string" || !body.order_id) return { ok: false, reason: "Identifiant de commande absent" };
  return { ok: true, event: event as PaymentWebhookEvent, orderId: body.order_id, merchantOrderRef: typeof body.merchant_order_ext_ref === "string" ? body.merchant_order_ext_ref : null };
}

interface RawPayment {
  state?: unknown;
  payment_method?: { id?: unknown; type?: unknown } | null;
}

interface RawOrder {
  id?: unknown;
  token?: unknown;
  state?: unknown;
  amount?: unknown;
  currency?: unknown;
  customer?: { id?: unknown } | null;
  customer_id?: unknown;
  merchant_order_ext_ref?: unknown;
  /** Tentatives de paiement sur la commande (formulaire ou débit à l'initiative du marchand). */
  payments?: unknown;
}

/** États d'une tentative de paiement qui ont présenté la carte avec succès (autorisée ou encaissée). */
const SUCCESSFUL_PAYMENT_STATES: readonly PaymentState[] = ["authorised", "completed"];

/**
 * Moyen de paiement « utilisé » : celui de la dernière tentative autorisée ou payée. C'est la carte
 * que le client vient de saisir dans le formulaire ; elle vaut mieux qu'un « premier de la liste ».
 */
export function orderPaymentMethodId(payments: unknown): { attempts: number; paymentMethodId: string | null } {
  const list = Array.isArray(payments) ? (payments as RawPayment[]) : [];
  let paymentMethodId: string | null = null;
  for (const p of list) {
    const id = p && typeof p === "object" && typeof p.payment_method?.id === "string" && p.payment_method.id ? p.payment_method.id : null;
    if (id && SUCCESSFUL_PAYMENT_STATES.includes(normalizeState(p.state))) paymentMethodId = id;
  }
  return { attempts: list.length, paymentMethodId };
}

function toOrderInfo(raw: RawOrder): PaymentOrderInfo {
  if (typeof raw.id !== "string" || !raw.id) throw new PaymentApiError(502, "invalid_response", "Réponse Revolut sans identifiant de commande", false);
  const customerId = typeof raw.customer?.id === "string" ? raw.customer.id : typeof raw.customer_id === "string" ? raw.customer_id : null;
  const { attempts, paymentMethodId } = orderPaymentMethodId(raw.payments);
  return {
    orderId: raw.id,
    token: typeof raw.token === "string" && raw.token ? raw.token : null,
    state: normalizeState(raw.state),
    amountCents: typeof raw.amount === "number" ? raw.amount : 0,
    currency: typeof raw.currency === "string" ? raw.currency : "EUR",
    customerId,
    merchantOrderRef: typeof raw.merchant_order_ext_ref === "string" ? raw.merchant_order_ext_ref : null,
    paymentAttempts: attempts,
    paymentMethodId,
  };
}

export class RevolutClient implements PaymentProvider {
  readonly name = "revolut" as const;
  readonly testMode: boolean;
  readonly mode: PaymentMode;
  readonly apiVersion: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly secretKey: string;
  private readonly webhookSecret: string | null;
  private readonly logger: PaymentLogger | undefined;
  private readonly timeoutMs: number;

  constructor(config: RevolutConfig) {
    const key = (config.secretKey ?? "").trim();
    if (!key.startsWith("sk_") || key.length < 12) throw new PaymentConfigError("Clé Revolut invalide (attendu une clé secrète sk_…).");
    this.mode = config.mode ?? "sandbox";
    if (this.mode !== "sandbox" && this.mode !== "live") throw new PaymentConfigError(`REVOLUT_MODE invalide : ${String(this.mode)} (sandbox ou live).`);
    if (this.mode === "live" && !config.liveAllowed) {
      throw new PaymentConfigError("Mode Revolut live refusé : REVOLUT_LIVE_ALLOWED doit être explicitement true après validation (bac à sable par défaut).");
    }
    this.testMode = this.mode === "sandbox";
    this.apiVersion = (config.apiVersion ?? DEFAULT_REVOLUT_API_VERSION).trim() || DEFAULT_REVOLUT_API_VERSION;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.apiVersion)) throw new PaymentConfigError("REVOLUT_API_VERSION doit être une date AAAA-MM-JJ.");
    this.apiBase = (config.apiBase ?? REVOLUT_HOSTS[this.mode]).replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.secretKey = key;
    this.webhookSecret = config.webhookSecret?.trim() || null;
    this.logger = config.logger;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /** Les webhooks ne peuvent être vérifiés que si le secret de signature est configuré. */
  get webhooksEnabled(): boolean {
    return this.webhookSecret !== null;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const started = Date.now();
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.secretKey}`,
      accept: "application/json",
      "revolut-api-version": this.apiVersion,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.logger?.warn({ provider: "revolut", method, path, ms: Date.now() - started }, "Revolut injoignable");
      throw new PaymentApiError(0, "network", `Revolut injoignable : ${err instanceof Error ? err.name : "erreur réseau"}`, true);
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    this.logger?.info({ provider: "revolut", method, path: path.replace(/\/[A-Za-z0-9_-]{16,}/g, "/…"), status: res.status, ms: Date.now() - started }, "appel Revolut");
    if (!res.ok) {
      const err = (json ?? {}) as { code?: unknown; message?: unknown; errorId?: unknown };
      const code = typeof err.code === "string" || typeof err.code === "number" ? String(err.code) : `http_${res.status}`;
      const message = typeof err.message === "string" ? err.message.slice(0, 200) : "erreur";
      throw new PaymentApiError(res.status, code, `Revolut ${res.status} (${code}) : ${message}`, res.status === 429 || res.status >= 500);
    }
    if (json === null && text) throw new PaymentApiError(502, "invalid_response", "Réponse Revolut illisible (JSON attendu)", false);
    return json as T;
  }

  async createCustomer(input: { email: string; fullName: string }): Promise<{ customerId: string }> {
    const res = await this.request<{ id?: unknown }>("POST", "/api/1.0/customers", { email: input.email, full_name: input.fullName.slice(0, 120) });
    if (typeof res?.id !== "string" || !res.id) throw new PaymentApiError(502, "invalid_response", "Réponse Revolut sans identifiant de client", false);
    return { customerId: res.id };
  }

  private orderBody(input: CreateOrderInput): Record<string, unknown> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new PaymentConfigError("Montant de commande invalide (entier en centimes, strictement positif).");
    const customer = input.customerId ? { id: input.customerId } : input.customerEmail ? { email: input.customerEmail } : undefined;
    return {
      amount: input.amountCents,
      currency: input.currency,
      description: input.description.slice(0, 1024),
      capture_mode: input.captureMode,
      ...(customer ? { customer } : {}),
      ...(input.merchantOrderRef ? { merchant_order_ext_ref: input.merchantOrderRef.slice(0, 255) } : {}),
      metadata: { orgId: input.orgId, plan: input.plan, ...(input.metadata ?? {}) },
    };
  }

  async createOrder(input: CreateOrderInput): Promise<PaymentOrderInfo> {
    return toOrderInfo(await this.request<RawOrder>("POST", "/api/orders", this.orderBody(input)));
  }

  async createCheckoutOrder(input: CreateOrderInput): Promise<CheckoutOrder> {
    const order = await this.createOrder(input);
    if (!order.token) throw new PaymentApiError(502, "invalid_response", "Réponse Revolut sans jeton de commande (formulaire)", false);
    return { orderId: order.orderId, token: order.token, customerId: order.customerId };
  }

  async chargeSavedMethod(input: { orderId: string; paymentMethodId: string }): Promise<{ state: PaymentState }> {
    const res = await this.request<{ state?: unknown }>("POST", `/api/orders/${encodeURIComponent(input.orderId)}/payments`, {
      saved_payment_method: { type: "card", id: input.paymentMethodId, initiator: "merchant" },
    });
    return { state: normalizeState(res?.state) };
  }

  async cancelOrder(orderId: string): Promise<{ state: PaymentState }> {
    const res = await this.request<RawOrder>("POST", `/api/orders/${encodeURIComponent(orderId)}/cancel`);
    return { state: res && typeof res === "object" && "state" in res ? normalizeState(res.state) : "cancelled" };
  }

  async getOrder(orderId: string): Promise<PaymentOrderInfo> {
    return toOrderInfo(await this.request<RawOrder>("GET", `/api/orders/${encodeURIComponent(orderId)}`));
  }

  async listMerchantPaymentMethods(customerId: string): Promise<SavedPaymentMethod[]> {
    const res = await this.request<unknown>("GET", `/api/1.0/customers/${encodeURIComponent(customerId)}/payment-methods?only_merchant=true`);
    const list = Array.isArray(res) ? res : [];
    return list
      .map((raw): SavedPaymentMethod | null => {
        const r = raw as { id?: unknown; type?: unknown; created_at?: unknown; method_details?: { brand?: unknown; last4?: unknown; expiry_month?: unknown; expiry_year?: unknown } | null };
        if (typeof r.id !== "string" || !r.id) return null;
        const t = typeof r.type === "string" ? snake(r.type) : "";
        const d = r.method_details ?? {};
        const created = typeof r.created_at === "string" && !Number.isNaN(Date.parse(r.created_at)) ? new Date(r.created_at).toISOString() : null;
        return {
          id: r.id,
          type: t === "card" ? "card" : t === "revolut_pay" ? "revolut_pay" : "other",
          brand: typeof d.brand === "string" ? d.brand : null,
          last4: typeof d.last4 === "string" ? d.last4.slice(-4) : null,
          expiryMonth: typeof d.expiry_month === "number" ? d.expiry_month : null,
          expiryYear: typeof d.expiry_year === "number" ? d.expiry_year : null,
          createdAt: created,
        };
      })
      .filter((m): m is SavedPaymentMethod => m !== null);
  }

  verifyWebhook(rawBody: string, headers: WebhookHeaders, now: Date): WebhookVerification {
    return verifyRevolutWebhook(rawBody, headers, this.webhookSecret, now);
  }
}
