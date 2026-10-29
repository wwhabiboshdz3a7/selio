import type { CaptureMode, PaymentMode } from "@selio/contracts";

/**
 * Interface d'un fournisseur de paiement (abonnements Selio). Revolut Merchant API est le
 * fournisseur par défaut ; l'interface reste neutre pour brancher Mollie en secours.
 *
 * Règles : aucune donnée de carte ne transite par Selio (le formulaire du fournisseur
 * encaisse, Selio ne manipule que des identifiants) ; le serveur seul détient la clé
 * secrète ; le navigateur ne reçoit que le `token` public d'une commande.
 */

/** État normalisé d'une commande ou d'un paiement, quel que soit le fournisseur. */
export const PAYMENT_STATES = ["pending", "processing", "authorised", "completed", "cancelled", "failed"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Événements de webhook pris en charge (vocabulaire Revolut, repris tel quel). */
export const PAYMENT_WEBHOOK_EVENTS = ["ORDER_COMPLETED", "ORDER_AUTHORISED", "ORDER_PAYMENT_DECLINED", "ORDER_PAYMENT_FAILED", "ORDER_CANCELLED"] as const;
export type PaymentWebhookEvent = (typeof PAYMENT_WEBHOOK_EVENTS)[number];

export interface CreateOrderInput {
  orgId: string;
  plan: string;
  /** Montant TTC en centimes (entier). */
  amountCents: number;
  currency: "EUR";
  /** Client déjà créé chez le fournisseur (préféré) ; sinon l'email crée ou retrouve le client. */
  customerId?: string | null;
  customerEmail?: string | null;
  /** « manual » = autorisation seule (essai : rien n'est débité), « automatic » = débit immédiat. */
  captureMode: CaptureMode;
  description: string;
  /** Métadonnées libres (orgId, plan, kind, cycle) renvoyées avec la commande ; jamais de secret. */
  metadata?: Record<string, string>;
  /** Référence marchand reprise dans les webhooks (`merchant_order_ext_ref`). */
  merchantOrderRef?: string;
}

export interface PaymentOrderInfo {
  orderId: string;
  /** Identifiant public pour le formulaire du fournisseur (jamais la clé secrète). */
  token: string | null;
  state: PaymentState;
  amountCents: number;
  currency: string;
  customerId: string | null;
  /** Référence marchand telle que renvoyée par le fournisseur. */
  merchantOrderRef: string | null;
  /** Nombre de tentatives de paiement sur la commande (0 = jamais présentée à une banque). */
  paymentAttempts: number;
  /** Moyen de paiement de la dernière tentative aboutie (autorisée ou payée) : la carte que le client vient d'utiliser. */
  paymentMethodId: string | null;
}

export interface CheckoutOrder {
  orderId: string;
  token: string;
  customerId: string | null;
}

export interface SavedPaymentMethod {
  id: string;
  type: "card" | "revolut_pay" | "other";
  /** Marque et quatre derniers chiffres : les seules informations de carte conservées ou affichées. */
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  /** Date d'enregistrement (ISO) quand le fournisseur la donne : sert à retenir la carte la plus récente. */
  createdAt: string | null;
}

export type WebhookVerification =
  | { ok: true; event: PaymentWebhookEvent; orderId: string; merchantOrderRef: string | null }
  | { ok: false; reason: string };

/** En-têtes HTTP tels que Fastify les expose (noms en minuscules). */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: "revolut";
  /** Bac à sable (aucun argent réel). */
  readonly testMode: boolean;
  createCustomer(input: { email: string; fullName: string }): Promise<{ customerId: string }>;
  /** Commande destinée au formulaire intégré : renvoie le jeton public à passer au navigateur. */
  createCheckoutOrder(input: CreateOrderInput): Promise<CheckoutOrder>;
  /** Commande sans formulaire (renouvellement à l'initiative du marchand). */
  createOrder(input: CreateOrderInput): Promise<PaymentOrderInfo>;
  /** Paie une commande avec un moyen enregistré « pour le marchand » (initiateur : marchand). */
  chargeSavedMethod(input: { orderId: string; paymentMethodId: string }): Promise<{ state: PaymentState }>;
  cancelOrder(orderId: string): Promise<{ state: PaymentState }>;
  getOrder(orderId: string): Promise<PaymentOrderInfo>;
  /** Moyens de paiement d'un client utilisables à l'initiative du marchand. */
  listMerchantPaymentMethods(customerId: string): Promise<SavedPaymentMethod[]>;
  /** Vérifie la signature d'une livraison de webhook (corps brut, en-têtes, horloge injectée). */
  verifyWebhook(rawBody: string, headers: WebhookHeaders, now: Date): WebhookVerification;
}

/** Journal minimal (pino) : jamais la clé, jamais le corps complet. */
export interface PaymentLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
}

/** Configuration refusée (clé absente ou invalide, mode live non autorisé). */
export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigError";
  }
}

/** Réponse HTTP non 2xx ou panne réseau du fournisseur : code court, sans corps complet. */
export class PaymentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PaymentApiError";
  }
}

export type { CaptureMode, PaymentMode };
