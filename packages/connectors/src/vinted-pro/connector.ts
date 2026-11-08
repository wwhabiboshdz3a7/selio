import { normalizeVintedProBaseUrl } from "@selio/contracts";
import type { CapabilityResult, Connector, ConnectorContext, ConnectorDescriptor, ConnectorTestResult, ExternalItem, ExternalOrder } from "../types";

/**
 * Connecteur Vinted Pro Integrations — SQUELETTE, AUCUN APPEL À L'API.
 *
 * C'est la voie officielle pour les comptes Pro : Vinted publie une documentation (pro-docs.svc.vinted.com)
 * mais l'API est réservée aux entreprises admises par Vinted, sur demande (à faire par Ibrahim). Cette
 * documentation n'a pas pu être lue depuis l'environnement de développement : aucun point d'accès, aucun
 * en-tête et aucun algorithme de signature n'est donc écrit ici. Ce qui est vérifié et ce qui ne l'est pas
 * est tenu à jour dans `README.md` (même dossier).
 *
 * Ce que fait le squelette :
 * - il se décrit honnêtement (expérimental, capacités « unavailable » annotées) ;
 * - `test()` répond « needs_access » (statut d'accès) avec ce qu'il manque, sans aucun appel réseau ;
 * - l'adresse de l'API se saisit en configuration (vide par défaut), HTTPS sous vinted.com seulement ;
 * - la clé est fournie par Vinted (portail Pro Integrations) et stockée chiffrée côté serveur
 *   (`secret_ciphertext`) : jamais un mot de passe Vinted ;
 * - `fetch` est injectable pour brancher l'API une fois la documentation obtenue (HTTP simulé en test).
 */

export const VINTED_PRO_DOCS_URL = "https://pro-docs.svc.vinted.com";
export const VINTED_PRO_ACCESS_NOTE = "Accès et documentation à obtenir auprès de Vinted Pro";

/** Requête HTTP minimale (fetch standard ou simulé en test). */
export type VintedProFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export interface VintedProOptions {
  /** HTTP injectable ; aucun appel n'est fait tant que les points d'accès ne sont pas documentés. */
  fetch?: VintedProFetch;
}

/** Ce qui manque pour qu'un appel soit seulement envisageable (libellés pour l'interface). */
export interface VintedProReadiness {
  proAccountId: string | null;
  baseUrl: string | null;
  /** Adresse saisie mais refusée (pas HTTPS ou hors vinted.com). */
  invalidBaseUrl: boolean;
  hasKey: boolean;
  missing: string[];
}

export function vintedProReadiness(ctx: Pick<ConnectorContext, "config" | "secret">): VintedProReadiness {
  const rawAccount = typeof ctx.config.proAccountId === "string" ? ctx.config.proAccountId.trim() : "";
  const rawBase = typeof ctx.config.apiBaseUrl === "string" ? ctx.config.apiBaseUrl.trim() : "";
  const baseUrl = normalizeVintedProBaseUrl(rawBase);
  const hasKey = typeof ctx.secret === "string" && ctx.secret.trim().length > 0;
  const missing: string[] = [];
  if (!rawAccount) missing.push("identifiant de compte Pro");
  if (!hasKey) missing.push("clé API fournie par Vinted");
  if (!baseUrl) missing.push(rawBase ? "adresse de l'API valide (HTTPS, domaine vinted.com)" : "adresse de l'API remise par Vinted");
  return { proAccountId: rawAccount || null, baseUrl, invalidBaseUrl: rawBase !== "" && baseUrl === null, hasKey, missing };
}

const NOT_IMPLEMENTED = `${VINTED_PRO_ACCESS_NOTE} : aucun appel n'est fait tant que les points d'accès ne sont pas documentés et vérifiés.`;

export class VintedProConnector implements Connector {
  readonly provider = "vinted_pro" as const;
  /** Gardé pour l'intégration à venir : jamais appelé par le squelette (vérifié en test). */
  protected readonly fetchImpl: VintedProFetch | undefined;

  constructor(opts: VintedProOptions = {}) {
    this.fetchImpl = opts.fetch;
  }

  describe(): ConnectorDescriptor {
    return {
      provider: "vinted_pro",
      label: "Vinted Pro (API officielle)",
      description: "Connexion des comptes Vinted Pro par l'API officielle Vinted Pro Integrations (articles, commandes, webhooks). Accès réservé aux comptes Pro admis par Vinted : à demander auprès de Vinted Pro.",
      transport: "server",
      experimental: true,
      capabilities: [
        { capability: "read_items", state: "unavailable", note: `Articles : ${VINTED_PRO_ACCESS_NOTE}` },
        { capability: "read_conversations", state: "unavailable", note: `Messagerie non annoncée par l'API Pro (à confirmer) : ${VINTED_PRO_ACCESS_NOTE}` },
        { capability: "sync_orders", state: "unavailable", note: `Commandes : ${VINTED_PRO_ACCESS_NOTE}` },
        { capability: "prepare_message", state: "unavailable", note: `Aucune messagerie par l'API Pro connue : ${VINTED_PRO_ACCESS_NOTE}` },
        { capability: "send_message", state: "unavailable", note: `Aucun envoi : ${VINTED_PRO_ACCESS_NOTE}` },
        { capability: "shipping_document", state: "unavailable", note: `Bordereaux des commandes : ${VINTED_PRO_ACCESS_NOTE}` },
      ],
      configFields: [
        { key: "proAccountId", label: "Identifiant de compte Pro", secret: false, help: "Identifiant de votre compte Vinted Pro, tel que Vinted le communique avec l'accès à l'API." },
        { key: "apiBaseUrl", label: "Adresse de l'API (remise par Vinted)", secret: false, help: "Vide tant que Vinted n'a pas ouvert l'accès. HTTPS et domaine vinted.com seulement." },
        { key: "apiKey", label: "Clé API (fournie par Vinted)", secret: true, help: "Clé générée dans le portail Vinted Pro Integrations, stockée chiffrée côté serveur. Jamais votre mot de passe Vinted." },
      ],
      verificationNotes: [
        `Documentation publique repérée (${VINTED_PRO_DOCS_URL}) mais non lue depuis l'environnement de développement : aucun point d'accès n'est écrit.`,
        "Accès réservé aux comptes Pro admis par Vinted : demande à faire par Ibrahim.",
        "Webhooks (articles, ventes) et validation de leur signature : à brancher d'après la documentation, rien n'est reçu aujourd'hui.",
        "Aucun mot de passe Vinted n'est demandé ni stocké ; la clé fournie par Vinted est chiffrée côté serveur.",
      ],
    };
  }

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    const r = vintedProReadiness(ctx);
    const message = r.missing.length
      ? `Accès Vinted Pro Integrations à obtenir. Il manque : ${r.missing.join(", ")}. ${VINTED_PRO_ACCESS_NOTE}.`
      : `Réglages enregistrés, mais l'API Vinted Pro n'est pas encore branchée dans Selio : ${NOT_IMPLEMENTED}`;
    return { ok: false, status: "not_configured", accessStatus: "needs_access", message: message.slice(0, 500), capabilities: this.describe().capabilities, testedAt: ctx.now.toISOString(), simulated: false };
  }

  async readItems(): Promise<CapabilityResult<ExternalItem[]>> {
    return { ok: false, code: "unsupported", message: NOT_IMPLEMENTED, retryable: false };
  }

  async syncOrders(): Promise<CapabilityResult<ExternalOrder[]>> {
    return { ok: false, code: "unsupported", message: NOT_IMPLEMENTED, retryable: false };
  }
}
