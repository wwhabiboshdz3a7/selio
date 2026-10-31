import { sanitizeUntrustedText } from "@selio/domain";
import { all, attr, first, text, type MinimalDocument, type MinimalElement } from "./dom";
import { parseHtmlDocument } from "./html";
import { parsePriceCents } from "./v1";

/**
 * Adaptateur « checkout-page » — bouton « Acheter » d'une annonce et page de
 * paiement Vinted, pour Selio Radar Auto (achat automatique, désactivé par
 * défaut, réservé aux comptes de l'équipe).
 *
 * CONSTRUIT SUR FIXTURES SYNTHÉTIQUES (`fixtures/item-buy.v1.html`,
 * `checkout-page.v1.html`, `checkout-3ds.v1.html`, `checkout-done.v1.html`),
 * NON VÉRIFIÉ EN RÉEL. Les sélecteurs sont à relever sur une vraie page avec un
 * compte de l'équipe avant tout achat réel (D11 : achat réel désactivé).
 *
 * Ce que l'adaptateur sait reconnaître, pour s'arrêter au bon endroit :
 * - la page de paiement (montants, porte-monnaie Vinted proposé ou choisi,
 *   bouton de paiement) ;
 * - une demande de validation 3-D Secure de la banque : l'achat ATTEND le
 *   client, rien n'est jamais saisi à sa place (aucun sélecteur de champ de
 *   code n'existe ici, volontairement) ;
 * - la confirmation de commande et sa référence ;
 * - un refus de paiement.
 */
export const CHECKOUT_ADAPTER_VERSION = "vinted-checkout-v1";

/** Bouton « Acheter » de la page d'une annonce. */
export const ITEM_BUY_BUTTON_SELECTORS = ['[data-testid="item-buy-button"]', 'button[data-testid*="buy-button"]'];
export const ITEM_BUY_BUTTON_NAME = /^\s*acheter\s*$/i;

/** Marques d'une annonce qui ne peut plus être achetée. */
export const ITEM_UNAVAILABLE_SELECTORS: readonly { selector: string; state: ItemUnavailableReason }[] = [
  { selector: '[data-testid="item-status--sold"]', state: "sold" },
  { selector: '[data-testid="item-status--reserved"]', state: "reserved" },
  { selector: '[data-testid="item-status--hidden"]', state: "hidden" },
];

export type ItemUnavailableReason = "sold" | "reserved" | "hidden";

export const CHECKOUT_SELECTORS = {
  root: ['[data-testid="checkout"]', '[data-testid="checkout-page"]'],
  itemPrice: ['[data-testid="checkout-item-price"]'],
  shipping: ['[data-testid="checkout-shipping-price"]'],
  protection: ['[data-testid="checkout-protection-fee"]'],
  total: ['[data-testid="checkout-total"]', '[data-testid="pricing-total"]'],
  /** Option « Porte-monnaie Vinted » (le clic vise d'abord le bouton radio, sinon l'option). */
  walletOption: ['[data-testid="payment-method-wallet"]'],
  walletClick: ['[data-testid="payment-method-wallet"] input[type="radio"]', '[data-testid="payment-method-wallet"]'],
  walletBalance: ['[data-testid="payment-method-wallet-balance"]'],
  payButton: ['[data-testid="checkout-pay-button"]', 'button[data-testid="pay-button"]'],
  threeDs: ['[data-testid="three-d-secure"]', 'iframe[name^="three-ds"]', 'iframe[title*="3-D Secure"]', 'iframe[src*="/3ds/"]'],
  confirmation: ['[data-testid="checkout-success"]', '[data-testid="purchase-confirmation"]'],
  paidTotal: ['[data-testid="checkout-paid-total"]'],
  orderLink: ['[data-testid="order-link"]', "a[href*='/transactions/']"],
  orderReference: ['[data-testid="order-reference"]'],
  paymentError: ['[data-testid="payment-error"]'],
} as const;

export const WALLET_OPTION_NAME = /porte-monnaie\s+vinted/i;
export const PAY_BUTTON_NAME = /^\s*(?:payer|confirmer et payer|confirmer le paiement)\b/i;

export type CheckoutPageKind = "checkout" | "three_ds" | "confirmation" | "payment_error" | "unknown";

export interface CheckoutPageData {
  kind: CheckoutPageKind;
  itemPriceCents: number | null;
  shippingCents: number | null;
  buyerProtectionCents: number | null;
  /** Total à payer (page de paiement) ou payé (confirmation). */
  totalCents: number | null;
  wallet: { offered: boolean; selected: boolean; balanceCents: number | null };
  payButtonFound: boolean;
  /** Référence de la commande (confirmation seulement). */
  orderRef: string | null;
}

export interface CheckoutPageResult {
  adapterVersion: string;
  /** Page reconnue (paiement, 3-D Secure, confirmation ou refus). */
  ok: boolean;
  kind: CheckoutPageKind;
  data: CheckoutPageData;
  warnings: string[];
  missing: string[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

/** Texte « en évidence » d'une page : titres, dialogues, alertes. */
function headline(doc: MinimalDocument): string {
  const parts = [doc.title, ...all(doc, ["h1, h2, h3, [role='dialog'], [role='alertdialog'], [role='alert']"]).map((e) => text(e))];
  return norm(parts.join(" • "));
}

const THREE_DS_TEXT = /3-?d secure|authentification (?:forte|bancaire)|valide[rz]? (?:le|ce) paiement (?:dans|depuis|sur|avec) (?:l'application|ton application|votre application|l'appli)/;
const CONFIRMATION_TEXT = /merci pour (?:ton|votre) achat|paiement (?:confirme|accepte)|commande (?:confirmee|validee)/;
const PAYMENT_ERROR_TEXT = /paiement (?:refuse|a echoue|n'a pas abouti)|carte refusee|solde insuffisant/;

/** Élément cliquable dont le nom visible correspond (repli quand aucun sélecteur ne répond). */
export function findByName(root: MinimalElement, name: RegExp, selectors: string[] = ["button", "a", "[role='button']"]): MinimalElement | null {
  for (const el of all(root, [selectors.join(", ")])) {
    if (name.test(text(el)) || name.test(attr(el, "aria-label") ?? "")) return el;
  }
  return null;
}

function isChecked(el: MinimalElement | null): boolean {
  if (!el) return false;
  const marks = [attr(el, "aria-checked"), attr(el, "aria-selected"), attr(el, "data-selected")];
  if (marks.includes("true")) return true;
  const radio = first(el, ['input[type="radio"]', 'input[type="checkbox"]']);
  return radio !== null && attr(radio, "checked") !== null;
}

function cleanRef(raw: string | null): string | null {
  if (!raw) return null;
  const m = /([A-Za-z0-9-]{4,64})/.exec(raw);
  return m ? sanitizeUntrustedText(m[1]!, 64) : null;
}

function orderRefFrom(doc: MinimalDocument, url: string): string | null {
  const link = first(doc, [...CHECKOUT_SELECTORS.orderLink]);
  const fromLink = /\/transactions\/(\d{1,20})/.exec(attr(link, "href") ?? "")?.[1];
  if (fromLink) return fromLink;
  const fromText = cleanRef(text(first(doc, [...CHECKOUT_SELECTORS.orderReference])));
  if (fromText) return fromText;
  return /\/transactions\/(\d{1,20})/.exec(url)?.[1] ?? null;
}

/** État d'une annonce pour l'achat : bouton « Acheter » visible, ou raison de son absence. */
export function readItemPurchaseState(doc: MinimalDocument): { buyButtonFound: boolean; unavailable: ItemUnavailableReason | null } {
  for (const u of ITEM_UNAVAILABLE_SELECTORS) {
    if (first(doc, [u.selector])) return { buyButtonFound: false, unavailable: u.state };
  }
  const button = first(doc, ITEM_BUY_BUTTON_SELECTORS) ?? findByName(doc, ITEM_BUY_BUTTON_NAME);
  return { buyButtonFound: button !== null, unavailable: null };
}

export function parseCheckoutDocument(doc: MinimalDocument, url: string): CheckoutPageResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const head = headline(doc);
  const root = first(doc, [...CHECKOUT_SELECTORS.root]);

  let kind: CheckoutPageKind = "unknown";
  if (first(doc, [...CHECKOUT_SELECTORS.threeDs]) || THREE_DS_TEXT.test(head)) kind = "three_ds";
  else if (first(doc, [...CHECKOUT_SELECTORS.confirmation]) || CONFIRMATION_TEXT.test(head)) kind = "confirmation";
  else if (first(doc, [...CHECKOUT_SELECTORS.paymentError]) || PAYMENT_ERROR_TEXT.test(head)) kind = "payment_error";
  else if (root) kind = "checkout";

  const scope: MinimalElement = root ?? doc;
  const amount = (selectors: readonly string[]) => parsePriceCents(text(first(scope, [...selectors])));
  const walletEl = first(scope, [...CHECKOUT_SELECTORS.walletOption]);
  const wallet = {
    offered: walletEl !== null,
    selected: isChecked(walletEl),
    balanceCents: walletEl ? parsePriceCents(text(first(walletEl, [...CHECKOUT_SELECTORS.walletBalance]))) : null,
  };
  const payButton = first(scope, [...CHECKOUT_SELECTORS.payButton]) ?? findByName(scope, PAY_BUTTON_NAME, ["button", "[role='button']"]);
  const data: CheckoutPageData = {
    kind,
    itemPriceCents: amount(CHECKOUT_SELECTORS.itemPrice),
    shippingCents: amount(CHECKOUT_SELECTORS.shipping),
    buyerProtectionCents: amount(CHECKOUT_SELECTORS.protection),
    totalCents: kind === "confirmation" ? (amount(CHECKOUT_SELECTORS.paidTotal) ?? amount(CHECKOUT_SELECTORS.total)) : amount(CHECKOUT_SELECTORS.total),
    wallet,
    payButtonFound: payButton !== null,
    orderRef: kind === "confirmation" ? orderRefFrom(doc, url) : null,
  };
  if (kind === "checkout") {
    if (data.totalCents === null) missing.push("total");
    if (!data.payButtonFound) missing.push("pay_button");
    if (!wallet.offered) warnings.push("Porte-monnaie Vinted non proposé sur cette page.");
  }
  if (kind === "confirmation" && !data.orderRef) warnings.push("Référence de commande introuvable.");
  return { adapterVersion: CHECKOUT_ADAPTER_VERSION, ok: kind !== "unknown" && missing.length === 0, kind, data, warnings, missing };
}

/** Lit une page de paiement reçue en HTML. */
export function parseCheckoutPage(html: string, options: { url: string }): CheckoutPageResult {
  return parseCheckoutDocument(parseHtmlDocument(html), options.url);
}
