import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Adaptateur Stripe minimal, côté serveur uniquement.
 * - Vérification de signature des webhooks (HMAC-SHA256, tolérance temporelle).
 * - Appels REST limités (Checkout, portail client) en MODE TEST tant que la
 *   clé n'est pas une clé live explicitement autorisée.
 * Aucune dépendance SDK : surface réduite, testable sans réseau.
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Doit être explicitement `true` pour accepter une clé `sk_live_`. */
  liveAllowed?: boolean;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export class StripeConfigError extends Error {}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
  livemode: boolean;
}

export function parseSignatureHeader(header: string): { t: number; v1: string[] } | null {
  const parts = header.split(",").map((p) => p.trim());
  let t: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t" && v) t = Number.parseInt(v, 10);
    if (k === "v1" && v) v1.push(v);
  }
  if (t === null || !Number.isFinite(t) || v1.length === 0) return null;
  return { t, v1 };
}

export function computeSignature(secret: string, timestamp: number, payload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

export type WebhookVerification = { ok: true; event: StripeEvent } | { ok: false; reason: string };

export function verifyWebhook(payload: string, signatureHeader: string | null | undefined, secret: string, opts: { toleranceSeconds?: number; now?: () => number } = {}): WebhookVerification {
  if (!signatureHeader) return { ok: false, reason: "En-tête Stripe-Signature absent" };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "En-tête Stripe-Signature illisible" };
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  const tolerance = opts.toleranceSeconds ?? 300;
  if (Math.abs(now - parsed.t) > tolerance) return { ok: false, reason: "Horodatage hors tolérance (rejeu ?)" };
  const expected = computeSignature(secret, parsed.t, payload);
  const expectedBuf = Buffer.from(expected, "hex");
  const match = parsed.v1.some((sig) => {
    const buf = Buffer.from(sig, "hex");
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
  if (!match) return { ok: false, reason: "Signature invalide" };
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return { ok: false, reason: "Corps JSON invalide" };
  }
  if (!event.id || !event.type) return { ok: false, reason: "Événement incomplet" };
  return { ok: true, event };
}

export class StripeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  readonly testMode: boolean;

  constructor(private readonly config: StripeConfig) {
    if (!config.secretKey.startsWith("sk_test_") && !config.secretKey.startsWith("sk_live_") && !config.secretKey.startsWith("rk_")) {
      throw new StripeConfigError("Clé Stripe invalide (attendu sk_test_… ou sk_live_…)");
    }
    this.testMode = !config.secretKey.startsWith("sk_live_");
    if (!this.testMode && !config.liveAllowed) {
      throw new StripeConfigError("Clé Stripe live refusée : STRIPE_LIVE_ALLOWED doit être explicitement activé après validation.");
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.apiBase = config.apiBase ?? "https://api.stripe.com/v1";
  }

  private async post<T>(path: string, form: Record<string, string>, idempotencyKey?: string): Promise<T> {
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${res.status} : ${body.error?.message ?? "erreur"}`);
    return body;
  }

  createCheckoutSession(input: { priceId: string; customerEmail: string; orgId: string; successUrl: string; cancelUrl: string }, idempotencyKey: string) {
    return this.post<{ id: string; url: string }>("/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      customer_email: input.customerEmail,
      "metadata[orgId]": input.orgId,
      "subscription_data[metadata][orgId]": input.orgId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    }, idempotencyKey);
  }

  createPortalSession(input: { customerId: string; returnUrl: string }) {
    return this.post<{ url: string }>("/billing_portal/sessions", { customer: input.customerId, return_url: input.returnUrl });
  }
}
