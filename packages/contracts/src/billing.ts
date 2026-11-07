import { z } from "zod";
import { id, isoDate, nonNegCents } from "./common";
import { billingCycle, paidPlan, plan } from "./org";

/**
 * Facturation : factures, commandes de paiement (tentatives) et règles de relance,
 * partagées par l'API, le worker et l'application web (rendu d'une facture imprimable).
 * Aucune donnée de carte n'apparaît ici : seuls des identifiants Revolut.
 */

/** Environnement du fournisseur de paiement : bac à sable (défaut) ou production. */
export const PAYMENT_MODES = ["sandbox", "live"] as const;
export const paymentMode = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof paymentMode>;

/** Capture : « manual » = autorisation seule (essai : rien n'est débité), « automatic » = débit immédiat. */
export const CAPTURE_MODES = ["automatic", "manual"] as const;
export const captureMode = z.enum(CAPTURE_MODES);
export type CaptureMode = z.infer<typeof captureMode>;

/**
 * Relances après un débit échoué à l'échéance : J+1, J+3 puis J+7 après l'échéance, chacune
 * avec un email. Quand la troisième relance échoue aussi, l'espace repasse à l'accès de base
 * et les données sont conservées 30 jours.
 */
export const CHARGE_RETRY_DELAYS_DAYS = [1, 3, 7] as const;
export const DATA_RETENTION_DAYS_AFTER_END = 30;

/**
 * Délai (en jours après l'échéance) de la prochaine tentative après `failures` débits échoués
 * sur la même échéance ; null quand les relances sont épuisées (retour à l'accès de base).
 */
export function nextChargeDelayDays(failures: number): number | null {
  if (!Number.isInteger(failures) || failures < 1) return CHARGE_RETRY_DELAYS_DAYS[0];
  return CHARGE_RETRY_DELAYS_DAYS[failures - 1] ?? null;
}

/** TVA française par défaut ; 0 en franchise en base (art. 293 B du CGI), avec la mention obligatoire. */
export const DEFAULT_VAT_RATE = 20;
export const VAT_FRANCHISE_NOTICE = "TVA non applicable, art. 293 B du CGI";

/**
 * Enregistrement d'une carte sans paiement (essai, changement de carte) : le formulaire Revolut
 * autorise ce montant de vérification en capture manuelle, puis Selio annule l'autorisation dès que
 * la carte est enregistrée « pour le marchand ». Rien n'est débité ; la banque peut afficher la
 * réservation quelques heures. Jamais le prix de l'offre (une réservation de 499,90 € pendant un
 * essai « sans débit » n'est pas acceptable).
 */
export const CARD_VERIFICATION_AMOUNT_CENTS = 100;

/** Numéro de facture : SEL-AAAA-000001, continu par année (compteur transactionnel en base). */
export const INVOICE_NUMBER_RE = /^SEL-\d{4}-\d{6}$/;

/**
 * Photos portées au-delà du quota du plan (Studio, §5.11) : 0,25 € la photo. PROPOSITION, pas un prix
 * décidé (docs §7) : le serveur peut le régler (WORN_OVERAGE_UNIT_CENTS) et rien n'est facturé tant que
 * WORN_OVERAGE_ENABLED n'est pas activé. Chaque photo au-delà demande l'accord explicite du client ; les
 * photos produites sont facturées au renouvellement, comme une ligne de dépassement de la facture.
 */
export const WORN_OVERAGE_UNIT_CENTS = 25;

/** Montant en euros pour un libellé de facture : 25 → « 0,25 € » (espace simple, deux décimales). */
export function euroLabel(cents: number): string {
  return `${(Math.max(0, Math.round(cents)) / 100).toFixed(2).replace(".", ",")} €`;
}

/**
 * Lignes supplémentaires d'une facture, comprises dans son montant TTC : aujourd'hui seulement le
 * dépassement des photos portées (`overage` / `worn_photo`). Aucune ligne quand le dépassement est
 * désactivé ou que rien n'a été produit au-delà du quota.
 */
export const INVOICE_EXTRA_LINE_KINDS = ["overage"] as const;
export const INVOICE_EXTRA_LINE_PRODUCTS = ["worn_photo"] as const;
export const invoiceExtraLine = z.object({
  kind: z.enum(INVOICE_EXTRA_LINE_KINDS),
  product: z.enum(INVOICE_EXTRA_LINE_PRODUCTS),
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(100_000),
  /** Prix unitaire TTC en centimes. */
  unitCents: nonNegCents,
  /** quantity × unitCents, TTC en centimes. */
  amountCents: nonNegCents,
});
export type InvoiceExtraLine = z.infer<typeof invoiceExtraLine>;

/** « Photos portées au-delà du quota : 3 × 0,25 € ». */
export function wornOverageLineLabel(quantity: number, unitCents: number = WORN_OVERAGE_UNIT_CENTS): string {
  return `Photos portées au-delà du quota : ${Math.max(0, Math.round(quantity))} × ${euroLabel(unitCents)}`;
}

/** Ligne de dépassement des photos portées (quantité ≥ 1), ou null quand il n'y a rien à facturer. */
export function wornOverageLine(quantity: number, unitCents: number = WORN_OVERAGE_UNIT_CENTS): InvoiceExtraLine | null {
  const q = Math.max(0, Math.round(quantity));
  const unit = Math.max(0, Math.round(unitCents));
  if (q < 1) return null;
  return { kind: "overage", product: "worn_photo", label: wornOverageLineLabel(q, unit), quantity: q, unitCents: unit, amountCents: q * unit };
}

/** Total TTC des lignes supplémentaires (centimes). */
export function extraLinesTotal(lines: readonly Pick<InvoiceExtraLine, "amountCents">[] = []): number {
  return lines.reduce((sum, l) => sum + Math.max(0, Math.round(l.amountCents)), 0);
}

export const invoice = z.object({
  id,
  orgId: id,
  number: z.string().regex(INVOICE_NUMBER_RE),
  plan,
  cycle: billingCycle,
  /** Montant TTC débité, en centimes. */
  amountCents: nonNegCents,
  /** Taux de TVA appliqué (20 par défaut, 0 en franchise). */
  vatRate: z.number().min(0).max(100),
  /** Mention légale quand la TVA n'est pas appliquée, sinon null. */
  vatNotice: z.string().max(200).nullable().default(null),
  periodStart: isoDate,
  periodEnd: isoDate,
  /** Commande Revolut à l'origine du paiement (traçabilité), null pour une facture manuelle. */
  orderId: z.string().max(120).nullable().default(null),
  /**
   * Lignes supplémentaires (dépassement), comprises dans `amountCents` ; absentes ou vides pour une facture
   * d'abonnement seul (facultatif : les factures d'avant 0014 et la démonstration n'en ont pas).
   */
  extraLines: z.array(invoiceExtraLine).max(20).optional(),
  issuedAt: isoDate,
  createdAt: isoDate,
});
export type Invoice = z.infer<typeof invoice>;

export interface InvoiceAmounts {
  exclVatCents: number;
  vatCents: number;
  inclVatCents: number;
}

/**
 * Décompose un montant TTC : HT arrondi au centime, TVA = différence (le TTC reste exact).
 * `extraLines` (dépassement) s'ajoutent au montant de base : `invoiceAmounts(base, taux, lignes)`
 * vaut `invoiceAmounts(base + total des lignes, taux)`.
 */
export function invoiceAmounts(amountCents: number, vatRate: number, extraLines: readonly Pick<InvoiceExtraLine, "amountCents">[] = []): InvoiceAmounts {
  const incl = Math.max(0, Math.round(amountCents)) + extraLinesTotal(extraLines);
  const rate = Math.max(0, vatRate);
  const excl = rate > 0 ? Math.round(incl / (1 + rate / 100)) : incl;
  return { exclVatCents: excl, vatCents: incl - excl, inclVatCents: incl };
}

/** Données d'une facture prêtes pour un rendu HTML imprimable (GET /api/billing/invoices/:id). */
export interface InvoiceView {
  invoice: Invoice;
  issuer: { name: string; vatNotice: string | null };
  customer: { orgName: string; email: string | null };
  /**
   * Abonnement d'abord (`kind: "plan"`), puis les lignes de dépassement (`kind: "overage"`, avec
   * quantité et prix unitaire). La somme des lignes est le TTC de la facture.
   */
  lines: { label: string; periodLabel: string; amountCents: number; kind?: "plan" | "overage"; quantity?: number; unitCents?: number }[];
  totals: InvoiceAmounts & { vatRate: number };
  /** Frais du fournisseur de paiement : information, jamais refacturés au client. */
  paymentProvider: "revolut" | null;
}

/**
 * Commandes de paiement créées chez le fournisseur : une ligne par tentative (autorisation pendant
 * l'essai, changement de carte, paiement depuis le formulaire, renouvellement et relances à
 * l'initiative du marchand). Le webhook retrouve l'organisation par `orderId` ; les transitions
 * d'état conditionnelles rendent le traitement idempotent.
 */
export const PAYMENT_ORDER_KINDS = ["trial_authorisation", "card_update", "checkout", "renewal"] as const;
export const paymentOrderKind = z.enum(PAYMENT_ORDER_KINDS);
export type PaymentOrderKind = z.infer<typeof paymentOrderKind>;
/** Commandes qui enregistrent une carte sans rien débiter (capture manuelle d'un montant de vérification, annulée aussitôt). */
export const CARD_ONLY_ORDER_KINDS: readonly PaymentOrderKind[] = ["trial_authorisation", "card_update"];

export const PAYMENT_ORDER_STATES = ["pending", "authorised", "completed", "failed", "cancelled"] as const;
export const paymentOrderState = z.enum(PAYMENT_ORDER_STATES);
export type PaymentOrderState = z.infer<typeof paymentOrderState>;

export const paymentOrder = z.object({
  id,
  orgId: id,
  orderId: z.string().min(1).max(120),
  kind: paymentOrderKind,
  plan,
  cycle: billingCycle,
  amountCents: nonNegCents,
  captureMode,
  state: paymentOrderState.default("pending"),
  /** Numéro de la tentative sur l'échéance (1 = échéance, 2 à 4 = relances J+1, J+3, J+7). */
  attempt: z.number().int().min(0).default(0),
  /** Motif d'échec rapporté par le fournisseur, sans donnée de carte. */
  error: z.string().max(500).nullable().default(null),
  /**
   * Lignes supplémentaires comprises dans `amountCents` (renouvellement : dépassement des photos portées
   * quand WORN_OVERAGE_ENABLED). Reprises telles quelles sur la facture quand la commande est payée.
   */
  extraLines: z.array(invoiceExtraLine).max(20).optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type PaymentOrder = z.infer<typeof paymentOrder>;

/** POST /api/billing/checkout */
export const checkoutInput = z.object({ plan: paidPlan, cycle: billingCycle.default("monthly") });
export type CheckoutInput = z.infer<typeof checkoutInput>;

/**
 * Réponse du démarrage de paiement (POST /api/billing/checkout) ou de changement de carte
 * (POST /api/billing/card). `orderToken` est l'identifiant public de la commande pour le
 * formulaire Revolut (jamais la clé secrète) ; null quand le paiement n'est pas configuré.
 */
export interface CheckoutResult {
  orderToken: string | null;
  orderId: string | null;
  mode: PaymentMode | null;
  /**
   * Montant de la commande créée : le prix de l'offre hors essai ; pendant l'essai ou pour un
   * changement de carte, le montant de vérification (`CARD_VERIFICATION_AMOUNT_CENTS`), autorisé en
   * capture manuelle puis annulé, jamais débité.
   */
  amountCents: number;
  captureMode: CaptureMode | null;
  /** Jamais simulé : sans configuration, aucune commande n'est créée et `orderToken` est null. */
  simulated: false;
  message: string;
}

/** POST /api/billing/plan : changement d'offre appliqué au prochain renouvellement. */
export const changePlanInput = z.object({ plan: paidPlan });
export type ChangePlanInput = z.infer<typeof changePlanInput>;
