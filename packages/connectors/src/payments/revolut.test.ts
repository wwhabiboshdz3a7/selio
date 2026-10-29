import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPaymentProvider, loadPaymentConfig, paymentStartupNotices } from "./config";
import { DEFAULT_REVOLUT_API_VERSION, REVOLUT_HOSTS, RevolutClient, computeRevolutSignature, normalizeState, orderPaymentMethodId, parseRevolutSignatures, verifyRevolutWebhook } from "./revolut";
import { PaymentApiError, PaymentConfigError } from "./types";

/** HTTP simulé : enregistre chaque requête (URL, méthode, en-têtes, corps) et répond selon un script. */
interface Recorded { method: string; url: string; headers: Record<string, string>; body: unknown }
function fakeFetch(script: (req: Recorded) => { status: number; body?: unknown; text?: string }) {
  const calls: Recorded[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const rec: Recorded = { method: init?.method ?? "GET", url: String(input), headers, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(rec);
    const r = script(rec);
    const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const KEY = "sk_test_placeholder_0123456789";

describe("RevolutClient : configuration", () => {
  it("refuse une clé invalide, le mode live sans autorisation explicite, une version d'API mal formée", () => {
    expect(() => new RevolutClient({ secretKey: "pk_123456789012" })).toThrow(PaymentConfigError);
    expect(() => new RevolutClient({ secretKey: KEY, mode: "live" })).toThrow(/REVOLUT_LIVE_ALLOWED/);
    expect(() => new RevolutClient({ secretKey: KEY, apiVersion: "hier" })).toThrow(PaymentConfigError);
    const live = new RevolutClient({ secretKey: KEY, mode: "live", liveAllowed: true });
    expect(live.testMode).toBe(false);
    const sandbox = new RevolutClient({ secretKey: KEY });
    expect(sandbox.testMode).toBe(true);
    expect(sandbox.apiVersion).toBe(DEFAULT_REVOLUT_API_VERSION);
    expect(sandbox.webhooksEnabled).toBe(false);
  });

  it("lit l'environnement : désactivé sans clé, bac à sable par défaut, live refusé sans REVOLUT_LIVE_ALLOWED", () => {
    expect(loadPaymentConfig({})).toBeNull();
    expect(loadPaymentConfig({ REVOLUT_SECRET_KEY: "" })).toBeNull();
    expect(loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY })).toMatchObject({ provider: "revolut", mode: "sandbox", apiVersion: "2026-08-17", webhookSecret: null, liveAllowed: false });
    expect(loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY, REVOLUT_WEBHOOK_SECRET: "wsk_x", REVOLUT_API_VERSION: "2026-09-01" })).toMatchObject({ webhookSecret: "wsk_x", apiVersion: "2026-09-01" });
    expect(() => loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY, REVOLUT_MODE: "live" })).toThrow(/REVOLUT_LIVE_ALLOWED/);
    expect(() => loadPaymentConfig({ REVOLUT_SECRET_KEY: "abc" })).toThrow(/sk_/);
    expect(() => loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY, REVOLUT_MODE: "prod" })).toThrow(PaymentConfigError);
    expect(loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY, REVOLUT_MODE: "live", REVOLUT_LIVE_ALLOWED: "true" })?.mode).toBe("live");
    expect(createPaymentProvider(null)).toBeNull();
    expect(createPaymentProvider(loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY }))?.name).toBe("revolut");
    expect(paymentStartupNotices(null, "production")[0]?.level).toBe("warn");
    expect(paymentStartupNotices(loadPaymentConfig({ REVOLUT_SECRET_KEY: KEY }), "development").map((n) => n.message).join(" ")).toMatch(/REVOLUT_WEBHOOK_SECRET absent/);
  });
});

describe("RevolutClient : appels HTTP (simulés)", () => {
  it("crée un client, une commande de formulaire et une commande marchand avec les bons en-têtes et corps", async () => {
    const { calls, fetchImpl } = fakeFetch((req) => {
      if (req.url.endsWith("/api/1.0/customers")) return { status: 201, body: { id: "cus_1", email: "a@b.fr" } };
      if (req.url.endsWith("/api/orders")) return { status: 201, body: { id: "ord_1", token: "tok_public_1", state: "pending", amount: 2499, currency: "EUR", customer: { id: "cus_1" }, merchant_order_ext_ref: "org-1" } };
      return { status: 404, body: { code: "not_found", message: "?" } };
    });
    const client = new RevolutClient({ secretKey: KEY, fetchImpl, apiVersion: "2026-08-17" });
    const customer = await client.createCustomer({ email: "a@b.fr", fullName: "Alice" });
    expect(customer).toEqual({ customerId: "cus_1" });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${REVOLUT_HOSTS.sandbox}/api/1.0/customers`, body: { email: "a@b.fr", full_name: "Alice" } });
    expect(calls[0]?.headers).toMatchObject({ authorization: `Bearer ${KEY}`, "revolut-api-version": "2026-08-17", "content-type": "application/json" });

    const checkout = await client.createCheckoutOrder({ orgId: "org-1", plan: "pro", amountCents: 2499, currency: "EUR", customerId: "cus_1", captureMode: "manual", description: "Selio Pro", metadata: { kind: "trial_authorisation", cycle: "monthly" }, merchantOrderRef: "org-1" });
    expect(checkout).toEqual({ orderId: "ord_1", token: "tok_public_1", customerId: "cus_1" });
    expect(calls[1]?.body).toEqual({ amount: 2499, currency: "EUR", description: "Selio Pro", capture_mode: "manual", customer: { id: "cus_1" }, merchant_order_ext_ref: "org-1", metadata: { orgId: "org-1", plan: "pro", kind: "trial_authorisation", cycle: "monthly" } });

    const order = await client.createOrder({ orgId: "org-1", plan: "pro", amountCents: 2499, currency: "EUR", customerEmail: "a@b.fr", captureMode: "automatic", description: "Renouvellement" });
    expect(order).toMatchObject({ orderId: "ord_1", state: "pending", amountCents: 2499, customerId: "cus_1", merchantOrderRef: "org-1", paymentAttempts: 0, paymentMethodId: null });
    expect(calls[2]?.body).toMatchObject({ capture_mode: "automatic", customer: { email: "a@b.fr" } });
    await expect(client.createOrder({ orgId: "o", plan: "pro", amountCents: 24.99, currency: "EUR", captureMode: "automatic", description: "x" })).rejects.toThrow(PaymentConfigError);
  });

  it("paie avec un moyen enregistré à l'initiative du marchand, annule, relit et liste les moyens « pour le marchand »", async () => {
    const { calls, fetchImpl } = fakeFetch((req) => {
      if (req.url.endsWith("/api/orders/ord_1/payments")) return { status: 201, body: { id: "pay_1", order_id: "ord_1", state: "COMPLETED" } };
      if (req.url.endsWith("/api/orders/ord_2/cancel")) return { status: 200, body: { id: "ord_2", state: "cancelled" } };
      // Deux tentatives sur la commande : une carte refusée puis une autre autorisée → c'est la seconde qui compte.
      if (req.url.endsWith("/api/orders/ord_2")) return { status: 200, body: { id: "ord_2", state: "authorised", amount: 699, currency: "EUR", token: "tok_2", payments: [{ id: "pay_a", state: "DECLINED", payment_method: { id: "pm_refusee", type: "CARD" } }, { id: "pay_b", state: "AUTHORISED", payment_method: { id: "pm_nouvelle", type: "CARD" } }] } };
      if (req.url.endsWith("/api/1.0/customers/cus_1/payment-methods?only_merchant=true")) return { status: 200, body: [{ id: "pm_1", type: "CARD", created_at: "2026-10-01T10:00:00Z", method_details: { brand: "visa", last4: "4242", expiry_month: 12, expiry_year: 2030 } }, { id: "pm_2", type: "REVOLUT_PAY" }, { nope: true }] };
      return { status: 404, body: { code: "not_found", message: "?" } };
    });
    const client = new RevolutClient({ secretKey: KEY, fetchImpl });
    expect(await client.chargeSavedMethod({ orderId: "ord_1", paymentMethodId: "pm_1" })).toEqual({ state: "completed" });
    expect(calls[0]).toMatchObject({ method: "POST", body: { saved_payment_method: { type: "card", id: "pm_1", initiator: "merchant" } } });
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(await client.cancelOrder("ord_2")).toEqual({ state: "cancelled" });
    expect(calls[1]).toMatchObject({ method: "POST", url: `${REVOLUT_HOSTS.sandbox}/api/orders/ord_2/cancel` });
    expect(calls[1]?.body).toBeUndefined();
    expect(await client.getOrder("ord_2")).toMatchObject({ orderId: "ord_2", state: "authorised", amountCents: 699, token: "tok_2", customerId: null, paymentAttempts: 2, paymentMethodId: "pm_nouvelle" });
    expect(calls[2]?.method).toBe("GET");
    expect(orderPaymentMethodId([{ state: "FAILED", payment_method: { id: "pm_x" } }])).toEqual({ attempts: 1, paymentMethodId: null });
    expect(orderPaymentMethodId(undefined)).toEqual({ attempts: 0, paymentMethodId: null });
    const methods = await client.listMerchantPaymentMethods("cus_1");
    expect(methods).toEqual([
      { id: "pm_1", type: "card", brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2030, createdAt: "2026-10-01T10:00:00.000Z" },
      { id: "pm_2", type: "revolut_pay", brand: null, last4: null, expiryMonth: null, expiryYear: null, createdAt: null },
    ]);
  });

  it("transforme les erreurs HTTP et réseau en erreurs typées, sans corps complet", async () => {
    const { fetchImpl } = fakeFetch((req) => {
      if (req.url.endsWith("/api/orders/declined/payments")) return { status: 422, body: { code: 3000, message: "Payment declined by the issuer", secret_echo: "ne doit pas fuiter" } };
      if (req.url.endsWith("/api/orders/busy")) return { status: 503, text: "<html>maintenance</html>" };
      if (req.url.endsWith("/api/orders/weird")) return { status: 200, text: "pas du json" };
      throw new TypeError("fetch failed");
    });
    const client = new RevolutClient({ secretKey: KEY, fetchImpl });
    const declined = await client.chargeSavedMethod({ orderId: "declined", paymentMethodId: "pm" }).catch((e: unknown) => e);
    expect(declined).toBeInstanceOf(PaymentApiError);
    expect(declined as PaymentApiError).toMatchObject({ status: 422, code: "3000", retryable: false });
    expect((declined as Error).message).not.toMatch(/fuiter/);
    const busy = await client.getOrder("busy").catch((e: unknown) => e);
    expect(busy as PaymentApiError).toMatchObject({ status: 503, code: "http_503", retryable: true });
    const weird = await client.getOrder("weird").catch((e: unknown) => e);
    expect(weird as PaymentApiError).toMatchObject({ status: 502, code: "invalid_response" });
    const down = await client.getOrder("down").catch((e: unknown) => e);
    expect(down as PaymentApiError).toMatchObject({ status: 0, code: "network", retryable: true });
  });

  it("journalise méthode, chemin et statut, jamais la clé", async () => {
    const lines: Record<string, unknown>[] = [];
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { id: "ord_1234567890abcdef", state: "pending" } }));
    const client = new RevolutClient({ secretKey: KEY, fetchImpl, logger: { info: (m) => lines.push(m), warn: (m) => lines.push(m) } });
    await client.getOrder("ord_1234567890abcdef");
    expect(lines[0]).toMatchObject({ provider: "revolut", method: "GET", status: 200 });
    expect(JSON.stringify(lines)).not.toContain(KEY);
    expect(JSON.stringify(lines)).not.toContain("ord_1234567890abcdef");
  });
});

describe("webhooks Revolut : signature", () => {
  const secret = "wsk_test_secret_0123456789";
  const body = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "ord_1", merchant_order_ext_ref: "org-1" });
  const t = Date.UTC(2026, 9, 29, 10, 0, 0);
  const sign = (ts: number | string, raw = body, s = secret) => createHmac("sha256", s).update(`v1.${ts}.${raw}`).digest("hex");
  const headers = (sig: string, ts: number | string = t) => ({ "revolut-request-timestamp": String(ts), "revolut-signature": sig });

  it("accepte une signature valide (vecteur calculé avec node:crypto), plusieurs signatures, et renvoie l'événement", () => {
    expect(computeRevolutSignature(secret, t, body)).toBe(sign(t));
    const ok = verifyRevolutWebhook(body, headers(`v1=${sign(t)}`), secret, new Date(t + 1000));
    expect(ok).toEqual({ ok: true, event: "ORDER_COMPLETED", orderId: "ord_1", merchantOrderRef: "org-1" });
    const rotated = verifyRevolutWebhook(body, headers(`v1=${sign(t, body, "wsk_ancien")},v1=${sign(t)}`), secret, new Date(t));
    expect(rotated.ok).toBe(true);
    expect(parseRevolutSignatures("v1=abc, v1=" + sign(t) + ",v2=zzz")).toEqual([sign(t)]);
    const client = new RevolutClient({ secretKey: KEY, webhookSecret: secret, fetchImpl: fetch });
    expect(client.webhooksEnabled).toBe(true);
    expect(client.verifyWebhook(body, { "revolut-request-timestamp": [String(t)], "revolut-signature": [`v1=${sign(t)}`] }, new Date(t)).ok).toBe(true);
  });

  it("refuse : horodatage trop ancien ou futur, signature fausse, corps modifié, en-têtes absents, secret absent, événement inconnu", () => {
    const old = verifyRevolutWebhook(body, headers(`v1=${sign(t)}`), secret, new Date(t + 6 * 60_000));
    expect(old).toMatchObject({ ok: false, reason: expect.stringMatching(/tolérance/) });
    expect(verifyRevolutWebhook(body, headers(`v1=${sign(t)}`), secret, new Date(t - 6 * 60_000)).ok).toBe(false);
    expect(verifyRevolutWebhook(body, headers(`v1=${sign(t)}`), secret, new Date(t + 4 * 60_000)).ok).toBe(true);
    expect(verifyRevolutWebhook(body, headers(`v1=${"0".repeat(64)}`), secret, new Date(t))).toMatchObject({ ok: false, reason: "Signature invalide" });
    expect(verifyRevolutWebhook(body + " ", headers(`v1=${sign(t)}`), secret, new Date(t)).ok).toBe(false);
    expect(verifyRevolutWebhook(body, headers(`v1=${sign(t + 1)}`), secret, new Date(t)).ok).toBe(false);
    expect(verifyRevolutWebhook(body, { "revolut-signature": `v1=${sign(t)}` }, secret, new Date(t))).toMatchObject({ ok: false, reason: expect.stringMatching(/Timestamp absent/) });
    expect(verifyRevolutWebhook(body, { "revolut-request-timestamp": String(t) }, secret, new Date(t))).toMatchObject({ ok: false, reason: expect.stringMatching(/Signature absent/) });
    expect(verifyRevolutWebhook(body, headers("v2=abc"), secret, new Date(t))).toMatchObject({ ok: false, reason: expect.stringMatching(/illisible/) });
    expect(verifyRevolutWebhook(body, headers(`v1=${sign(t)}`), null, new Date(t))).toMatchObject({ ok: false, reason: expect.stringMatching(/non configuré/) });
    const unknown = JSON.stringify({ event: "ORDER_REFUNDED", order_id: "ord_1" });
    expect(verifyRevolutWebhook(unknown, headers(`v1=${sign(t, unknown)}`), secret, new Date(t))).toMatchObject({ ok: false, reason: expect.stringMatching(/non pris en charge/) });
    const noOrder = JSON.stringify({ event: "ORDER_COMPLETED" });
    expect(verifyRevolutWebhook(noOrder, headers(`v1=${sign(t, noOrder)}`), secret, new Date(t)).ok).toBe(false);
    expect(verifyRevolutWebhook("{", headers(`v1=${sign(t, "{")}`), secret, new Date(t))).toMatchObject({ ok: false, reason: "Corps JSON invalide" });
  });

  it("normalise les états Revolut", () => {
    expect(normalizeState("COMPLETED")).toBe("completed");
    expect(normalizeState("captured")).toBe("completed");
    expect(normalizeState("AUTHORISED")).toBe("authorised");
    expect(normalizeState("declined")).toBe("failed");
    expect(normalizeState("SOFT_DECLINED")).toBe("failed");
    expect(normalizeState("cancelled")).toBe("cancelled");
    expect(normalizeState("pending")).toBe("pending");
    expect(normalizeState("AUTHENTICATION_CHALLENGE")).toBe("processing");
    expect(normalizeState(undefined)).toBe("processing");
  });
});
