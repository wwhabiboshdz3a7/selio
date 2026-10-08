import type { ConnectionTestResult } from "@selio/contracts";
import { hashString, seededRandom } from "@selio/domain";
import type { CapabilityResult, Connector, ConnectorContext, ConnectorDescriptor, ExternalConversation, ExternalItem, ExternalOrder, PreparedMessage, SendReceipt, ShippingDocument } from "../types";

/**
 * Simulateur marketplace de démonstration : déterministe, sans réseau.
 * Toute action renvoie `simulated: true` ; aucun message n'est réellement envoyé.
 * Le marqueur « [échec] » dans un message simule un refus du connecteur
 * (pour tester le parcours d'erreur).
 */
export class DemoConnector implements Connector {
  readonly provider = "demo" as const;
  private sent = new Map<string, SendReceipt>();

  describe(): ConnectorDescriptor {
    return {
      provider: "demo",
      label: "Simulateur de démonstration",
      description: "Marketplace fictive : articles, conversations et commandes simulés de façon déterministe.",
      transport: "simulator",
      experimental: false,
      capabilities: [
        { capability: "read_items", state: "available", note: "Données fictives" },
        { capability: "read_conversations", state: "available", note: "Messages acheteurs fictifs" },
        { capability: "sync_orders", state: "available", note: "Commandes fictives" },
        { capability: "prepare_message", state: "available", note: "" },
        { capability: "send_message", state: "available", note: "Envoi simulé, jamais réel" },
        { capability: "shipping_document", state: "available", note: "Document marqué « Démonstration »" },
      ],
      configFields: [],
      verificationNotes: ["Aucune intégration externe : ce connecteur prouve le parcours, pas une intégration."],
    };
  }

  async test(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    return { ok: true, status: "connected", message: "Simulateur prêt (aucun service externe contacté).", capabilities: this.describe().capabilities, testedAt: ctx.now.toISOString(), simulated: true };
  }

  async readItems(ctx: ConnectorContext): Promise<CapabilityResult<ExternalItem[]>> {
    const rnd = seededRandom(hashString(ctx.orgId + ":items"));
    const brands = ["Levi's", "Nike", "Zara", "Sézane", "The North Face", "Adidas"];
    const items: ExternalItem[] = Array.from({ length: 4 }).map((_, i) => ({
      externalRef: `demo-item-${i + 1}`,
      title: `${brands[Math.floor(rnd() * brands.length)]} article importé ${i + 1}`,
      brand: brands[Math.floor(rnd() * brands.length)]!,
      size: ["S", "M", "L", "40", "42"][Math.floor(rnd() * 5)]!,
      condition: (["very_good", "good", "new_without_tags"] as const)[Math.floor(rnd() * 3)]!,
      priceCents: 1500 + Math.floor(rnd() * 60) * 100,
      url: `https://demo.invalid/items/${i + 1}`,
      photoUrls: [],
      status: "listed",
      observedAt: ctx.now.toISOString(),
    }));
    return { ok: true, data: items, simulated: true };
  }

  async readConversations(ctx: ConnectorContext): Promise<CapabilityResult<ExternalConversation[]>> {
    const rnd = seededRandom(hashString(ctx.orgId + ":conv:" + ctx.now.toISOString().slice(0, 13)));
    const samples = [
      "Bonjour, est-ce que l'article est toujours disponible ?",
      "Bonjour, vous accepteriez 20 € ?",
      "Est-ce que vous faites un lot avec un autre article ?",
      "Bonjour, pouvez-vous me donner les mesures exactes ?",
      "Je prends à 28 € si envoi rapide, merci !",
    ];
    const conv: ExternalConversation = {
      externalRef: `demo-conv-${Math.floor(rnd() * 1000)}`,
      buyerHandle: ["lea_m", "thomas.r", "camille_b", "nina_v"][Math.floor(rnd() * 4)]!,
      itemExternalRef: null,
      messages: [{ externalRef: `demo-msg-${Math.floor(rnd() * 100000)}`, direction: "inbound", body: samples[Math.floor(rnd() * samples.length)]!, at: ctx.now.toISOString() }],
      observedAt: ctx.now.toISOString(),
    };
    return { ok: true, data: [conv], simulated: true };
  }

  async syncOrders(ctx: ConnectorContext): Promise<CapabilityResult<ExternalOrder[]>> {
    return { ok: true, data: [], simulated: true };
  }

  async prepareMessage(_ctx: ConnectorContext, input: { conversationRef: string; body: string }): Promise<CapabilityResult<PreparedMessage>> {
    return { ok: true, simulated: true, data: { conversationRef: input.conversationRef, body: input.body, steps: ["Ouvrir la conversation (simulé)", "Coller le texte (simulé)", "Confirmer (simulé)"] } };
  }

  async sendMessage(ctx: ConnectorContext, input: { conversationRef: string; body: string; idempotencyKey: string }): Promise<CapabilityResult<SendReceipt>> {
    const existing = this.sent.get(input.idempotencyKey);
    if (existing) return { ok: true, data: existing, simulated: true };
    if (/\[échec\]|\[echec\]/i.test(input.body)) {
      return { ok: false, code: "rejected", message: "Le simulateur a refusé l'envoi (marqueur [échec] présent).", retryable: false };
    }
    const receipt: SendReceipt = { externalRef: `demo-sent-${hashString(input.idempotencyKey).toString(16)}`, sentAt: ctx.now.toISOString() };
    this.sent.set(input.idempotencyKey, receipt);
    return { ok: true, data: receipt, simulated: true };
  }

  async shippingDocument(_ctx: ConnectorContext, input: { orderRef: string }): Promise<CapabilityResult<ShippingDocument>> {
    return { ok: true, simulated: true, data: { kind: "demo", url: null, note: `Document de démonstration pour ${input.orderRef} — non utilisable pour un envoi réel.` } };
  }
}
