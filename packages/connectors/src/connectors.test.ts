import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { DemoConnector } from "./demo/simulator";
import { VintedExtensionConnector } from "./vinted/connector";
import { detectPage, parseConversationPage, parseItemPage, parsePriceCents } from "./vinted/adapters/v1";
import { describeConnectors, getConnector } from "./registry";
import { computeSignature, verifyWebhook } from "./payments/stripe";

const fixture = (name: string) => readFileSync(new URL(`./vinted/fixtures/${name}`, import.meta.url), "utf8");
function load(html: string) {
  const w = new Window();
  w.document.write(html);
  return w.document as unknown as Parameters<typeof parseItemPage>[0];
}
const ctx = { orgId: "org-1", connectionId: "c1", config: {}, now: new Date("2026-10-08T10:00:00Z") };

describe("DemoConnector", () => {
  it("envoie de façon simulée et idempotente, et sait refuser", async () => {
    const c = new DemoConnector();
    const a = await c.sendMessage(ctx, { conversationRef: "x", body: "Bonjour", idempotencyKey: "k1" });
    const b = await c.sendMessage(ctx, { conversationRef: "x", body: "Bonjour", idempotencyKey: "k1" });
    expect(a.ok && a.simulated).toBe(true);
    expect(a).toEqual(b);
    const fail = await c.sendMessage(ctx, { conversationRef: "x", body: "test [échec]", idempotencyKey: "k2" });
    expect(fail.ok).toBe(false);
  });
  it("décrit ses capacités comme simulées", async () => {
    const t = await new DemoConnector().test(ctx);
    expect(t.simulated).toBe(true);
    expect(t.status).toBe("connected");
  });
});

describe("VintedExtensionConnector", () => {
  it("n'envoie jamais côté serveur et reste expérimental", async () => {
    const c = new VintedExtensionConnector();
    expect(c.describe().experimental).toBe(true);
    const r = await c.sendMessage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("needs_browser");
  });
  it("calcule le statut depuis la dernière activité de l'extension", async () => {
    const c = new VintedExtensionConnector();
    expect((await c.test(ctx)).status).toBe("ready");
    expect((await c.test({ ...ctx, config: { extensionLastSeenAt: "2026-10-08T09:50:00Z" } })).status).toBe("connected");
    expect((await c.test({ ...ctx, config: { extensionLastSeenAt: "2026-10-08T07:00:00Z" } })).status).toBe("degraded");
    expect((await c.test({ ...ctx, config: { extensionLastSeenAt: "2026-10-01T07:00:00Z" } })).status).toBe("expired");
  });
});

describe("adaptateur DOM Vinted v1 (fixtures)", () => {
  it("détecte les pages prises en charge", () => {
    expect(detectPage("https://www.vinted.fr/items/123456-veste")).toBe("item");
    expect(detectPage("https://www.vinted.fr/inbox/987")).toBe("conversation");
    expect(detectPage("https://www.vinted.fr/catalog")).toBe("unknown");
    expect(detectPage("https://evil.example/items/1")).toBe("unknown");
    expect(detectPage("pas une url")).toBe("unknown");
  });
  it("parse une page article et nettoie le contenu non fiable", () => {
    const r = parseItemPage(load(fixture("item-page.v1.html")), "https://www.vinted.fr/items/123456-veste");
    expect(r.ok).toBe(true);
    expect(r.data?.title).toBe("Veste en jean Levi's Trucker");
    expect(r.data?.priceCents).toBe(3500);
    expect(r.data?.brand).toBe("Levi's");
    expect(r.data?.condition).toBe("very_good");
    expect(r.data?.externalRef).toBe("123456");
    expect(r.data?.photoUrls).toHaveLength(2);
    expect(r.data?.description).not.toMatch(/<b>/);
  });
  it("parse une conversation avec direction des messages et champ de réponse", () => {
    const r = parseConversationPage(load(fixture("conversation-page.v1.html")), "https://www.vinted.fr/inbox/987");
    expect(r.ok).toBe(true);
    expect(r.data?.buyerHandle).toBe("lea_m");
    expect(r.data?.messages.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
    expect(r.data?.composerFound).toBe(true);
    expect(r.data?.itemPriceCents).toBe(3500);
  });
  it("échoue proprement sur une structure inconnue", () => {
    const r = parseItemPage(load(fixture("unknown-page.html")), "https://www.vinted.fr/items/1");
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("title");
    expect(r.data).toBeNull();
  });
  it("parse les prix français", () => {
    expect(parsePriceCents("35,00 €")).toBe(3500);
    expect(parsePriceCents("1 250,5 €")).toBe(125050);
    expect(parsePriceCents("gratuit")).toBeNull();
  });
});

describe("registre", () => {
  it("expose les connecteurs et leurs capacités", () => {
    expect(describeConnectors().map((d) => d.provider).sort()).toEqual(["demo", "vinted"]);
    expect(getConnector("demo")).toBe(getConnector("demo"));
  });
});

describe("Stripe webhooks", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", created: 1, data: { object: {} }, livemode: false });
  it("accepte une signature valide et rejette rejeu, falsification, absence", () => {
    const t = 1_700_000_000;
    const header = `t=${t},v1=${computeSignature(secret, t, payload)}`;
    const now = () => t * 1000 + 1000;
    expect(verifyWebhook(payload, header, secret, { now }).ok).toBe(true);
    expect(verifyWebhook(payload, header, secret, { now: () => (t + 1000) * 1000 }).ok).toBe(false);
    expect(verifyWebhook(payload + " ", header, secret, { now }).ok).toBe(false);
    expect(verifyWebhook(payload, null, secret, { now }).ok).toBe(false);
    expect(verifyWebhook(payload, `t=${t},v1=deadbeef`, secret, { now }).ok).toBe(false);
  });
});
