import type { PaymentMode } from "@selio/contracts";

/**
 * Formulaire Revolut Checkout (fenêtre « popup ») : la carte est saisie dans l'iframe de Revolut,
 * enregistrée « pour le marchand » (débits suivants à l'initiative de Selio, par le worker) et
 * aucun numéro de carte ne transite par Selio. Le navigateur ne reçoit que le jeton public de la
 * commande ; la confirmation finale vient du webhook, jamais du callback `onSuccess` seul.
 *
 * Le script `embed.js` est chargé à la demande depuis merchant.revolut.com (ou le bac à sable) :
 * la CSP du site autorise ces deux hôtes en `script-src` et `frame-src`.
 */

/** Mode du widget : le bac à sable de l'API devient « sandbox », la production « prod ». */
export type WidgetMode = "sandbox" | "prod";

export function widgetMode(mode: PaymentMode | null | undefined): WidgetMode {
  return mode === "live" ? "prod" : "sandbox";
}

export interface RevolutPopupRequest {
  /** Jeton public de la commande (`token` renvoyé par POST /api/billing/checkout). */
  token: string;
  mode: PaymentMode | null;
  email?: string;
  name?: string;
}

export interface RevolutPopupHandlers {
  /** Formulaire validé : la commande est autorisée ou payée côté Revolut ; Selio attend le webhook. */
  onSuccess: () => void;
  /** Message prêt à afficher (sans donnée de carte). */
  onError: (message: string) => void;
  onCancel: () => void;
}

/** Sous-ensemble de `RevolutCheckoutInstance` utilisé ici (et simulé dans les tests). */
export interface RevolutWidgetInstance {
  payWithPopup: (options: {
    savePaymentMethodFor?: "merchant" | "customer";
    email?: string;
    name?: string;
    locale?: string;
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
    onCancel?: () => void;
  }) => unknown;
  destroy: () => void;
}

export type RevolutLoader = (token: string, mode: WidgetMode) => Promise<RevolutWidgetInstance>;

let loaderOverride: RevolutLoader | null = null;

/** Tests : remplace le chargement du script Revolut par une instance simulée (null = retour au réel). */
export function setRevolutLoaderForTests(loader: RevolutLoader | null): void {
  loaderOverride = loader;
}

async function loadRevolut(token: string, mode: WidgetMode): Promise<RevolutWidgetInstance> {
  const mod = await import("@revolut/checkout");
  return (await mod.default(token, mode)) as unknown as RevolutWidgetInstance;
}

const ERROR_MESSAGES: Record<string, string> = {
  "error.declined": "Paiement refusé par votre banque. Aucun montant n'a été débité.",
  "error.do-not-honour": "Paiement refusé par votre banque. Aucun montant n'a été débité.",
  "error.insufficient-funds": "Fonds insuffisants : le paiement a été refusé.",
  "error.3ds-failed": "L'authentification 3-D Secure n'a pas abouti. Réessayez avec votre application bancaire ouverte.",
  "error.expired-card": "Cette carte est expirée.",
  "error.incorrect-cvv-code": "Cryptogramme (CVV) incorrect.",
  "error.order-already-completed": "Cette commande est déjà payée : rechargez la page.",
  "error.order-is-cancelled": "Cette commande a été annulée : relancez le paiement.",
  "error.email-is-not-specified": "Une adresse email est nécessaire pour le reçu.",
};

/** Message affichable pour une erreur du widget : jamais le message brut, jamais une donnée de carte. */
export function describeRevolutError(err: unknown): string {
  const type = err && typeof err === "object" && "type" in err && typeof (err as { type: unknown }).type === "string" ? (err as { type: string }).type : "";
  return ERROR_MESSAGES[type] ?? "Le paiement n'a pas abouti. Aucun montant n'a été débité : vous pouvez réessayer ou utiliser une autre carte.";
}

/**
 * Ouvre le formulaire Revolut pour une commande. Résout quand le formulaire est affiché ; rejette si
 * le script n'a pas pu être chargé (réseau, bloqueur, CSP). Les suites passent par les handlers.
 */
export async function payWithRevolutPopup(req: RevolutPopupRequest, handlers: RevolutPopupHandlers): Promise<RevolutWidgetInstance> {
  const loader = loaderOverride ?? loadRevolut;
  const instance = await loader(req.token, widgetMode(req.mode));
  instance.payWithPopup({
    savePaymentMethodFor: "merchant",
    email: req.email,
    name: req.name,
    locale: "fr",
    onSuccess: () => handlers.onSuccess(),
    onError: (error) => handlers.onError(describeRevolutError(error)),
    onCancel: () => handlers.onCancel(),
  });
  return instance;
}

/** Message quand le formulaire lui-même n'a pas pu s'ouvrir (script non chargé). */
export const WIDGET_LOAD_ERROR = "Le formulaire de paiement Revolut n'a pas pu s'ouvrir (connexion ou bloqueur). Rien n'a été débité : réessayez dans un instant.";
