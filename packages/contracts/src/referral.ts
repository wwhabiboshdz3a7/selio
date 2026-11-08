import { z } from "zod";
import { id, isoDate } from "./common";

/**
 * Parrainage (§5.15) : « un mois offert aux deux ». Chaque organisation a un code unique de 6 caractères
 * lisibles ; une organisation qui s'inscrit avec ce code est rattachée à sa marraine (lien « en attente »).
 * Au PREMIER paiement réussi de la filleule (hors essai : l'autorisation de vérification ne compte pas),
 * chacune des deux reçoit un crédit d'un mois, consommé au renouvellement suivant à la place du débit
 * (facture à 0 € avec la ligne « Mois offert — parrainage », période prolongée d'un mois).
 *
 * Désactivé par défaut (REFERRAL_ENABLED=false) : ni code ni page tant que l'activation n'est pas décidée.
 */

/** Alphabet sans caractères ambigus (ni 0/O, ni 1/I/L) : un code se dicte et se recopie sans erreur. */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_CODE_RE = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/** Durée offerte à chacune des deux organisations, en mois. */
export const REFERRAL_CREDIT_MONTHS = 1;
/** Libellé de la ligne de facture d'un mois offert. */
export const REFERRAL_CREDIT_LINE_LABEL = "Mois offert — parrainage";

/**
 * Code saisi par une personne (« ab3-k7q », « AB3 K7Q ») ramené à sa forme canonique, ou null s'il ne peut
 * pas être un code Selio (longueur ou caractère hors alphabet).
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s\-_.]/g, "");
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

export const referralCode = z.string().regex(REFERRAL_CODE_RE, "Code de parrainage : 6 caractères (lettres et chiffres lisibles)");

/**
 * - pending : la filleule s'est inscrite avec le code, aucun paiement encore ;
 * - qualified : premier paiement réussi de la filleule, un crédit d'un mois accordé à chacune ;
 * - credited : les deux mois offerts ont été appliqués (consommés à un renouvellement) ;
 * - refused : contrôle d'auto-parrainage échoué au premier paiement (même personne, même email canonique,
 *   même client ou moyen de paiement Revolut) ou plafond de la marraine atteint : aucun crédit.
 */
export const REFERRAL_STATUSES = ["pending", "qualified", "credited", "refused"] as const;
export const referralStatus = z.enum(REFERRAL_STATUSES);
export type ReferralStatus = z.infer<typeof referralStatus>;

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: "Inscrite, en attente du premier paiement",
  qualified: "Premier paiement reçu : un mois offert à chacune",
  credited: "Mois offerts appliqués",
  refused: "Refusé (même titulaire ou même moyen de paiement, ou plafond atteint)",
};

/** Raisons d'un refus au premier paiement (contrôle refait au moment de qualifier). */
export const REFERRAL_REFUSAL_REASONS = ["shared_member", "same_email", "same_payment", "cap_reached"] as const;
export type ReferralRefusalReason = (typeof REFERRAL_REFUSAL_REASONS)[number];

/**
 * Plafond de mois offerts qu'une marraine peut gagner sur 12 mois glissants : au-delà, le lien est refusé
 * (pas de crédit). Limite l'abus « inscriptions en série » ; à revoir avec Ibrahim à l'ouverture.
 */
export const REFERRAL_MAX_CREDITS_PER_REFERRER = 12;

/** Domaines où les points de la partie locale ne comptent pas (Gmail). */
const DOTLESS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Email canonique pour comparer deux comptes : minuscules, sans « +alias », sans points pour Gmail
 * (googlemail.com ramené à gmail.com). « Alice.Martin+2@gmail.com » → « alicemartin@gmail.com ».
 * Sert seulement au contrôle d'auto-parrainage : l'email enregistré n'est jamais modifié.
 */
export function canonicalEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0]!;
  if (DOTLESS_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export const referral = z.object({
  id,
  code: referralCode,
  referrerOrgId: id,
  referredOrgId: id,
  status: referralStatus,
  createdAt: isoDate,
  qualifiedAt: isoDate.nullable().default(null),
  creditedAt: isoDate.nullable().default(null),
  refusedAt: isoDate.nullable().default(null),
  refusedReason: z.enum(REFERRAL_REFUSAL_REASONS).nullable().default(null),
});
export type Referral = z.infer<typeof referral>;

export const SUBSCRIPTION_CREDIT_KINDS = ["referral"] as const;
export const subscriptionCreditKind = z.enum(SUBSCRIPTION_CREDIT_KINDS);
export type SubscriptionCreditKind = z.infer<typeof subscriptionCreditKind>;

/** Crédit d'abonnement : un mois offert, disponible tant que `consumedAt` est vide. */
export const subscriptionCredit = z.object({
  id,
  orgId: id,
  kind: subscriptionCreditKind,
  months: z.number().int().min(1).max(12),
  sourceReferralId: id.nullable().default(null),
  consumedAt: isoDate.nullable().default(null),
  /** Facture à 0 € émise quand le crédit a été consommé. */
  invoiceId: id.nullable().default(null),
  createdAt: isoDate,
});
export type SubscriptionCredit = z.infer<typeof subscriptionCredit>;

/** Raisons pour lesquelles un code saisi à l'inscription n'a pas été retenu (l'inscription continue). */
export const REFERRAL_APPLY_REASONS = ["disabled", "empty", "invalid_code", "unknown_code", "self_referral", "already_referred"] as const;
export type ReferralApplyReason = (typeof REFERRAL_APPLY_REASONS)[number];

export interface ReferralApplyOutcome {
  applied: boolean;
  reason?: ReferralApplyReason;
  /** Phrase affichable (jamais bloquante : un code refusé n'empêche pas l'inscription). */
  message: string;
  referral?: Referral;
}

export interface ReferralQualifyOutcome {
  /** Vrai si c'est cet appel qui a qualifié le parrainage et accordé les deux crédits. */
  qualified: boolean;
  reason?: "disabled" | "no_referral" | "already_qualified" | "refused";
  /** Refus au premier paiement : la raison (jamais de donnée sur l'autre organisation). */
  refusal?: ReferralRefusalReason;
  referral?: Referral;
  credits?: SubscriptionCredit[];
}

/** GET /api/referral : ce que voit l'organisation (page Parrainage). */
export interface ReferralOverview {
  enabled: boolean;
  /** Code de l'organisation (null si le parrainage est désactivé). */
  code: string | null;
  /** Lien d'inscription prérempli avec le code. */
  shareUrl: string | null;
  /** Filleules par état (aucune donnée sur elles au-delà du compte : pas de nom, pas d'adresse). */
  referred: Record<ReferralStatus, number>;
  creditsAvailable: number;
  creditsConsumed: number;
  /** Vrai si cette organisation s'est elle-même inscrite avec un code. */
  referredBy: { status: ReferralStatus } | null;
}

/** Libellé de la mention, affichée sur la page et dans les conditions. */
export const REFERRAL_TERMS = `Un mois d'abonnement offert à vous et à l'organisation parrainée, accordé au premier paiement réussi de celle-ci et appliqué à votre prochain renouvellement. Pas d'auto-parrainage (même personne, même email ou même moyen de paiement, contrôlé au premier paiement) ; une organisation n'est parrainée qu'une fois ; au plus ${REFERRAL_MAX_CREDITS_PER_REFERRER} mois offerts par marraine sur 12 mois.`;
