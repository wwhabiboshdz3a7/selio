import type { ConnectionTestResult } from "@selio/contracts";
import type { CapabilityResult, Connector, ConnectorContext, ConnectorDescriptor, PreparedMessage, SendReceipt, ShippingDocument } from "../types";
import { VINTED_ADAPTER_VERSION } from "./adapters";

/**
 * Connecteur Vinted — EXPÉRIMENTAL, NON VÉRIFIÉ EN RÉEL.
 *
 * Vinted n'expose pas d'API publique pour les vendeurs et Selio ne crée pas
 * de faux OAuth. Le transport est l'extension navigateur : l'utilisateur est
 * connecté à son compte dans son propre navigateur, l'extension lit la page
 * visible (adaptateurs DOM versionnés) et prépare les actions, qui exigent
 * une confirmation explicite. Le serveur ne possède jamais la session Vinted.
 *
 * Toutes les capacités ci-dessous sont construites sur des fixtures et
 * doivent être validées dans un vrai navigateur avant d'être présentées
 * comme fonctionnelles (voir docs/CONNECTORS.md).
 */
export class VintedExtensionConnector implements Connector {
  readonly provider = "vinted" as const;

  describe(): ConnectorDescriptor {
    return {
      provider: "vinted",
      label: "Vinted (via extension)",
      description: "Lecture de la page visible et préparation des actions depuis l'extension Selio installée dans votre navigateur.",
      transport: "extension",
      experimental: true,
      capabilities: [
        { capability: "read_items", state: "experimental", note: `Capture d'un article visible (adaptateur DOM ${VINTED_ADAPTER_VERSION}, non vérifié en réel)` },
        { capability: "read_conversations", state: "experimental", note: "Lecture d'une conversation visible, non vérifiée en réel" },
        { capability: "sync_orders", state: "unavailable", note: "Aucune source fiable sans API officielle" },
        { capability: "prepare_message", state: "experimental", note: "Pré-remplissage du champ de réponse, confirmation manuelle" },
        { capability: "send_message", state: "unavailable", note: "Aucun envoi automatique : la validation se fait dans Vinted, par vous" },
        { capability: "shipping_document", state: "unavailable", note: "Le bordereau reste généré par Vinted" },
      ],
      configFields: [
        { key: "displayHandle", label: "Pseudo Vinted (affichage)", secret: false, help: "Uniquement pour reconnaître la connexion. Aucun mot de passe n'est demandé ni stocké." },
      ],
      verificationNotes: [
        "Sélecteurs DOM construits sur des fixtures : à valider sur vinted.fr dans un navigateur réel.",
        "Aucun endpoint d'achat ou d'envoi n'est appelé par le serveur.",
        "Le connecteur respecte les conditions d'utilisation : pas de contournement de CAPTCHA ni de collecte de session.",
      ],
    };
  }

  async test(ctx: ConnectorContext): Promise<ConnectionTestResult> {
    const lastSeen = typeof ctx.config.extensionLastSeenAt === "string" ? new Date(ctx.config.extensionLastSeenAt) : null;
    const caps = this.describe().capabilities;
    if (!lastSeen) {
      return { ok: false, status: "ready", message: "Connexion créée. Associez l'extension Selio à ce compte pour activer la lecture des pages Vinted.", capabilities: caps, testedAt: ctx.now.toISOString(), simulated: false };
    }
    const ageMin = (ctx.now.getTime() - lastSeen.getTime()) / 60_000;
    if (ageMin > 24 * 60) {
      return { ok: false, status: "expired", message: "L'extension n'a pas donné signe de vie depuis plus de 24 h : rouvrez le navigateur avec l'extension active.", capabilities: caps, testedAt: ctx.now.toISOString(), simulated: false };
    }
    if (ageMin > 60) {
      return { ok: true, status: "degraded", message: "Extension vue il y a plus d'une heure : les actions nécessitent un navigateur ouvert.", capabilities: caps, testedAt: ctx.now.toISOString(), simulated: false };
    }
    return { ok: true, status: "connected", message: "Extension active récemment. Les capacités restent expérimentales tant qu'elles n'ont pas été validées en réel.", capabilities: caps, testedAt: ctx.now.toISOString(), simulated: false };
  }

  async prepareMessage(_ctx: ConnectorContext, input: { conversationRef: string; body: string }): Promise<CapabilityResult<PreparedMessage>> {
    return {
      ok: true,
      simulated: false,
      data: {
        conversationRef: input.conversationRef,
        body: input.body,
        steps: ["Ouvrir la conversation dans Vinted", "L'extension pré-remplit le champ de réponse", "Relire puis cliquer vous-même sur Envoyer"],
      },
    };
  }

  async sendMessage(): Promise<CapabilityResult<SendReceipt>> {
    return { ok: false, code: "needs_browser", message: "L'envoi n'est pas automatisé côté serveur : préparez le message, puis validez-le dans Vinted via l'extension.", retryable: false };
  }

  async shippingDocument(): Promise<CapabilityResult<ShippingDocument>> {
    return { ok: false, code: "unsupported", message: "Le bordereau d'expédition est fourni par Vinted ; Selio ne génère pas de faux document.", retryable: false };
  }
}
