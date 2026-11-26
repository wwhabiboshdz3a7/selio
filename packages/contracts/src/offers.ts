import { z } from "zod";
import { id, isoDate } from "./common";
import { PLAN_LABELS } from "./labels";
import { PAID_PLANS, paidPlan, type BillingCycle, type PaidPlan } from "./org";

/**
 * Offres commerciales (« c'est moi qui choisis qui la nomme et qui fixe la réduc et le code promo, et ça
 * l'affiche sur le bandeau en haut si besoin ») : une PROMOTION sur les forfaits payants existants (Starter,
 * Pro, Agence), gérée par l'équipe Selio depuis l'administration. Les forfaits eux-mêmes ne changent pas.
 *
 * - Une offre a un nom affiché, un code promo facultatif (A-Z, 0-9 et tiret, 3 à 24 caractères, stocké en
 *   majuscules, unique sans tenir compte de la casse), une remise en pourcentage (1 à 100) OU un montant fixe
 *   par échéance (exactement l'une des deux), les forfaits concernés (aucun = tous), une durée en mois
 *   (null = tant que l'abonnement dure), une période de validité, un maximum d'utilisations et un bandeau.
 * - Une organisation a au plus UNE offre (instantané de la remise au moment où le code est appliqué) : une
 *   nouvelle offre ne remplace l'ancienne que si l'équipe Selio le fait.
 * - Application : au paiement et à chaque renouvellement, montant = prix du forfait − remise (jamais négatif).
 *   À 100 % : facture à 0 €, sans débit. Les mois restants ne baissent que quand l'échéance est réellement
 *   payée ou facturée à 0 €.
 * - Cycle annuel : la remise s'applique UNE fois sur l'échéance annuelle (pourcentage du montant annuel, ou le
 *   montant fixe une fois) dès qu'il reste au moins un mois ; l'échéance annuelle consomme 12 mois de la durée.
 * - Le mois offert du parrainage reste prioritaire : une échéance couverte par un mois offert n'est pas remisée
 *   (jamais de cumul sur la même échéance) et ne consomme aucun mois de l'offre.
 */

export const OFFER_CODE_RE = /^[A-Z0-9-]{3,24}$/;
export const OFFER_NAME_MAX = 80;
export const OFFER_BANNER_MAX = 140;
/** Durée maximale d'une remise limitée (mois). */
export const OFFER_MAX_DURATION_MONTHS = 36;

/** Code saisi (« printemps 26 », « Printemps-26 ») ramené à sa forme canonique, ou null s'il ne peut pas être un code d'offre. */
export function normalizeOfferCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  return OFFER_CODE_RE.test(code) ? code : null;
}

const offerCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(OFFER_CODE_RE, "Code promo : 3 à 24 caractères, lettres, chiffres et tirets"));

const offerBase = z.object({
  name: z.string().trim().min(2, "Nom : 2 caractères au moins").max(OFFER_NAME_MAX, `Nom : ${OFFER_NAME_MAX} caractères au plus`),
  code: offerCode.nullable().default(null),
  discountPercent: z.number().int().min(1, "Remise : 1 % au moins").max(100, "Remise : 100 % au plus").nullable().default(null),
  discountCents: z.number().int().min(1, "Remise : 1 centime au moins").max(1_000_000, "Remise trop élevée").nullable().default(null),
  plans: z.array(paidPlan).max(PAID_PLANS.length).default([]),
  durationMonths: z.number().int().min(1, "Durée : 1 mois au moins").max(OFFER_MAX_DURATION_MONTHS, `Durée : ${OFFER_MAX_DURATION_MONTHS} mois au plus`).nullable().default(null),
  startsAt: isoDate.nullable().default(null),
  endsAt: isoDate.nullable().default(null),
  maxRedemptions: z.number().int().min(1, "Maximum : 1 utilisation au moins").max(1_000_000).nullable().default(null),
  bannerEnabled: z.boolean().default(false),
  bannerText: z.string().trim().max(OFFER_BANNER_MAX, `Bandeau : ${OFFER_BANNER_MAX} caractères au plus`).nullable().default(null),
  active: z.boolean().default(true),
});

/** Règles croisées d'une offre complète (création, ou offre modifiée relue en entier). */
export function offerRuleIssues(o: Pick<OfferInput, "discountPercent" | "discountCents" | "startsAt" | "endsAt">): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if ((o.discountPercent === null) === (o.discountCents === null)) issues.push({ path: "discountPercent", message: "Choisissez une remise : un pourcentage OU un montant fixe (exactement l'un des deux)." });
  if (o.startsAt && o.endsAt && new Date(o.endsAt) <= new Date(o.startsAt)) issues.push({ path: "endsAt", message: "La fin doit être après le début." });
  return issues;
}

/** POST /api/admin/offers */
export const offerInput = offerBase.superRefine((o, ctx) => {
  for (const i of offerRuleIssues(o)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i.path], message: i.message });
});
export type OfferInput = z.infer<typeof offerBase>;

/** PATCH /api/admin/offers/:id : champs modifiés seulement ; les règles croisées sont vérifiées sur l'offre complète. */
export const offerUpdate = z.object({
  name: offerBase.shape.name.optional(),
  code: offerCode.nullable().optional(),
  discountPercent: offerBase.shape.discountPercent.removeDefault().optional(),
  discountCents: offerBase.shape.discountCents.removeDefault().optional(),
  plans: z.array(paidPlan).max(PAID_PLANS.length).optional(),
  durationMonths: offerBase.shape.durationMonths.removeDefault().optional(),
  startsAt: isoDate.nullable().optional(),
  endsAt: isoDate.nullable().optional(),
  maxRedemptions: offerBase.shape.maxRedemptions.removeDefault().optional(),
  bannerEnabled: z.boolean().optional(),
  bannerText: offerBase.shape.bannerText.removeDefault().optional(),
  active: z.boolean().optional(),
  /** Offre « beta » seulement : durée de l'accès bêta (jours). */
  betaDays: z.number().int().min(1, "Accès bêta : 1 jour au moins").max(90, "Accès bêta : 90 jours au plus").optional(),
});
export type OfferUpdate = z.infer<typeof offerUpdate>;

/** Remise d'une offre (ou de son instantané chez une organisation). */
export interface OfferDiscount {
  discountPercent: number | null;
  discountCents: number | null;
}

/**
 * Sorte d'offre : « discount » (remise sur les échéances, offre_redemptions) ou « beta » (code de la bêta : accès
 * de `betaDays` jours au forfait de l'essai, sans carte, facture à 0 € ; voir beta.ts). Une offre bêta n'est
 * jamais une remise sur les paiements suivants et n'apparaît jamais dans le bandeau public.
 */
export const OFFER_KINDS = ["discount", "beta"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** Offre vue par l'équipe Selio (administration) : tout, avec le nombre d'utilisations. */
export interface CommercialOffer extends OfferDiscount {
  id: string;
  /** Absent : « discount » (anciennes réponses, démonstration). */
  kind?: OfferKind;
  /** Offre « beta » : durée de l'accès en jours (1 à 90) ; null pour une remise. */
  betaDays?: number | null;
  name: string;
  code: string | null;
  plans: PaidPlan[];
  durationMonths: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  /** Organisations qui ont appliqué l'offre. */
  redemptions: number;
  bannerEnabled: boolean;
  bannerText: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * Offre publique (GET /api/offers/banner, sans session) : nom, texte du bandeau, code, remise, forfaits, durée
 * et fin seulement. Jamais l'auteur ni les compteurs.
 */
export interface PublicOffer extends OfferDiscount {
  id: string;
  name: string;
  /** Texte du bandeau tel qu'il s'affiche (saisi, ou construit : « -20 % sur Pro avec le code PRINTEMPS »). */
  bannerText: string;
  code: string | null;
  plans: PaidPlan[];
  durationMonths: number | null;
  endsAt: string | null;
}

/** Offre appliquée à une organisation (instantané de la remise au moment où le code a été appliqué). */
export interface OfferRedemption extends OfferDiscount {
  id: string;
  orgId: string;
  offerId: string;
  /** Nom de l'offre au moment de l'application (affiché sur la facture). */
  name: string;
  code: string | null;
  plans: PaidPlan[];
  durationMonths: number | null;
  /** Échéances mensuelles encore remisées ; null = tant que l'abonnement dure. */
  monthsRemaining: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Raisons d'un code refusé (message clair à l'écran). */
export const OFFER_REFUSAL_REASONS = ["invalid_code", "unknown_code", "inactive", "not_started", "expired", "exhausted", "plan_not_covered", "already_applied", "beta_signup_only", "beta_already_used"] as const;
export type OfferRefusalReason = (typeof OFFER_REFUSAL_REASONS)[number];

/** Réponse de la vérification d'un code (POST /api/offers/check) ou de son application. */
export interface PromoCheckResult {
  valid: boolean;
  reason?: OfferRefusalReason;
  message: string;
  offer?: PublicOffer;
  /** Prix remisés par forfait concerné (centimes, première échéance), pour le cycle demandé. */
  prices?: { plan: PaidPlan; cycle: BillingCycle; priceCents: number; discountedCents: number }[];
  /** Code de la bêta : accès de `days` jours au forfait `plan`, sans carte (jamais une remise). */
  beta?: { days: number; plan: PaidPlan; endsAt?: string };
}

/** POST /api/offers/check et POST /api/billing/offer */
export const promoCodeInput = z.object({ code: z.string().trim().min(1, "Saisissez un code promo").max(40), plan: paidPlan.optional(), cycle: z.enum(["monthly", "yearly"]).optional() });
export type PromoCodeInput = z.infer<typeof promoCodeInput>;

// ---------------------------------------------------------------- calculs (fonctions pures)

/** Montant de la remise sur une échéance (centimes), jamais au-delà du prix (une échéance n'est jamais négative). */
export function offerDiscountCents(priceCents: number, d: OfferDiscount): number {
  const price = Math.max(0, Math.round(priceCents));
  if (d.discountPercent !== null && d.discountPercent > 0) return Math.min(price, Math.round((price * Math.min(100, d.discountPercent)) / 100));
  if (d.discountCents !== null && d.discountCents > 0) return Math.min(price, Math.round(d.discountCents));
  return 0;
}

/** Prix après remise (centimes), jamais négatif. */
export function discountedPriceCents(priceCents: number, d: OfferDiscount): number {
  return Math.max(0, Math.round(priceCents) - offerDiscountCents(priceCents, d));
}

/** L'offre concerne-t-elle ce forfait ? (aucun forfait choisi = tous) */
export function offerCoversPlan(plans: readonly PaidPlan[], plan: string): boolean {
  return plans.length === 0 || (plans as readonly string[]).includes(plan);
}

/** Mois d'offre consommés par une échéance : 1 au mois, 12 à l'année. */
export const offerMonthsPerInstallment = (cycle: BillingCycle): number => (cycle === "yearly" ? 12 : 1);

/**
 * Remise applicable à une échéance d'une organisation (instantané), ou null : aucun mois restant, forfait
 * non concerné. `monthsRemainingAfter` : ce qu'il restera une fois l'échéance payée ou facturée à 0 €.
 */
export function redemptionDiscountFor(r: Pick<OfferRedemption, "discountPercent" | "discountCents" | "plans" | "monthsRemaining">, plan: string, cycle: BillingCycle, priceCents: number): { discountCents: number; monthsRemainingAfter: number | null } | null {
  if (r.monthsRemaining !== null && r.monthsRemaining <= 0) return null;
  if (!offerCoversPlan(r.plans, plan)) return null;
  const discount = offerDiscountCents(priceCents, r);
  if (discount <= 0) return null;
  return { discountCents: discount, monthsRemainingAfter: r.monthsRemaining === null ? null : Math.max(0, r.monthsRemaining - offerMonthsPerInstallment(cycle)) };
}

const euros = (cents: number): string => {
  const v = Math.max(0, Math.round(cents)) / 100;
  return `${Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")} €`;
};

/** « -20 % », « -5 € », « -2,50 € ». */
export function offerDiscountLabel(d: OfferDiscount): string {
  if (d.discountPercent !== null) return `-${d.discountPercent} %`;
  if (d.discountCents !== null) return `-${euros(d.discountCents)}`;
  return "";
}

/** « Pro », « Starter et Pro », « tous les forfaits ». */
export function offerPlansLabel(plans: readonly PaidPlan[]): string {
  const list = PAID_PLANS.filter((p) => plans.includes(p));
  if (list.length === 0 || list.length === PAID_PLANS.length) return "tous les forfaits";
  const names = list.map((p) => PLAN_LABELS[p]);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/** « pendant 3 mois », « pendant 1 mois », « » (tant que l'abonnement dure). */
export function offerDurationLabel(months: number | null): string {
  if (months === null) return "";
  return `pendant ${months} mois`;
}

/** Texte du bandeau : celui saisi, sinon construit (« -20 % sur Pro avec le code PRINTEMPS »). */
export function offerBannerText(o: Pick<CommercialOffer, "bannerText" | "code" | "plans" | "durationMonths"> & OfferDiscount): string {
  const typed = (o.bannerText ?? "").trim();
  if (typed) return typed.slice(0, OFFER_BANNER_MAX);
  const plans = offerPlansLabel(o.plans);
  const parts = [`${offerDiscountLabel(o)} sur ${plans}`];
  const duration = offerDurationLabel(o.durationMonths);
  if (duration) parts.push(duration);
  if (o.code) parts.push(`avec le code ${o.code}`);
  return parts.join(" ").slice(0, OFFER_BANNER_MAX);
}

/** Libellé de la ligne de facture : « Remise : Printemps (PRINTEMPS) ». */
export function offerInvoiceLineLabel(name: string, code: string | null): string {
  return `Remise : ${name}${code ? ` (${code})` : ""}`.slice(0, 200);
}

/**
 * Une offre peut-elle être appliquée maintenant (nouvelle utilisation) ? Active, non archivée, dans sa période,
 * sous son maximum et, si un forfait est donné, le concernant. Les messages sont affichables tels quels.
 */
export function offerAvailability(o: Pick<CommercialOffer, "active" | "archivedAt" | "startsAt" | "endsAt" | "maxRedemptions" | "redemptions" | "plans" | "name">, opts: { now: Date; plan?: string | null }): { ok: true } | { ok: false; reason: OfferRefusalReason; message: string } {
  if (!o.active || o.archivedAt) return { ok: false, reason: "inactive", message: "Ce code promo n'est plus valable." };
  if (o.startsAt && new Date(o.startsAt) > opts.now) return { ok: false, reason: "not_started", message: "Ce code promo n'est pas encore valable." };
  if (o.endsAt && new Date(o.endsAt) <= opts.now) return { ok: false, reason: "expired", message: "Ce code promo a expiré." };
  if (o.maxRedemptions !== null && o.redemptions >= o.maxRedemptions) return { ok: false, reason: "exhausted", message: "Ce code promo a atteint son nombre maximum d'utilisations." };
  if (opts.plan && !offerCoversPlan(o.plans, opts.plan)) return { ok: false, reason: "plan_not_covered", message: `Ce code promo est valable sur ${offerPlansLabel(o.plans)} seulement.` };
  return { ok: true };
}

/** Vue publique d'une offre (bandeau, vérification d'un code) : jamais l'auteur ni les compteurs. */
export function toPublicOffer(o: CommercialOffer): PublicOffer {
  return { id: o.id, name: o.name, bannerText: offerBannerText(o), code: o.code, discountPercent: o.discountPercent, discountCents: o.discountCents, plans: [...o.plans], durationMonths: o.durationMonths, endsAt: o.endsAt };
}

export const commercialOfferRow = z.object({
  id,
  kind: z.enum(OFFER_KINDS).default("discount"),
  betaDays: z.number().int().nullable().default(null),
  name: z.string(),
  code: z.string().nullable(),
  discountPercent: z.number().int().nullable(),
  discountCents: z.number().int().nullable(),
  plans: z.array(paidPlan),
  durationMonths: z.number().int().nullable(),
  startsAt: isoDate.nullable(),
  endsAt: isoDate.nullable(),
  maxRedemptions: z.number().int().nullable(),
  redemptions: z.number().int().min(0),
  bannerEnabled: z.boolean(),
  bannerText: z.string().nullable(),
  active: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  archivedAt: isoDate.nullable(),
});

export const offerRedemptionRow = z.object({
  id,
  orgId: id,
  offerId: id,
  name: z.string(),
  code: z.string().nullable(),
  discountPercent: z.number().int().nullable(),
  discountCents: z.number().int().nullable(),
  plans: z.array(paidPlan),
  durationMonths: z.number().int().nullable(),
  monthsRemaining: z.number().int().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
