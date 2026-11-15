import {
  PAID_PLANS, normalizeOfferCode, offerDurationLabel, offerPlansLabel, offerAvailability, offerDiscountLabel, offerInput, offerInvoiceLineLabel, offerMonthsPerInstallment, offerRuleIssues, offerUpdate, redemptionDiscountFor, toPublicOffer, discountedPriceCents, offerCoversPlan,
  type BillingCycle, type CommercialOffer, type InvoiceExtraLine, type OfferInput, type OfferRedemption, type PaidPlan, type PromoCheckResult, type PublicOffer,
} from "@selio/contracts";
import { PRICING } from "@selio/demo-data";
import { DbError, repos, type Tx } from "@selio/db";
import { AppError, requireAction, requireOperatorCapability, withOrg, type OrgContext, type Services } from "../context";

/**
 * Offres commerciales (promotions sur Starter, Pro et Agence), voir @selio/contracts (offers.ts).
 *
 * - Administration (opérateurs « tech » et « business ») : lister, créer, modifier, activer ou désactiver,
 *   supprimer (réellement si l'offre n'a jamais servi, sinon archivage). Audit `admin.offer_*`.
 * - Public : `publicBanners` (bandeau, sans session) et `checkCode` (vérification d'un code, sans rien écrire).
 * - Client : `applyCodeAtSignup` (jamais bloquant), `applyCodeForOrg` (page Abonnement), `getOrgOffer`.
 * - Facturation : `discountLineFor` (ligne « Remise : … » d'une échéance) et `consumeForInvoice` (mois restants
 *   décrémentés quand l'échéance est réellement payée ou facturée à 0 €), appelés par billing.ts.
 */

/** Prix d'une échéance (même règle que billing.planPriceCents, sans dépendance circulaire). */
const priceOf = (plan: PaidPlan, cycle: BillingCycle): number => PRICING.monthlyCents[plan] * (cycle === "yearly" ? PRICING.annualMonthsCharged : 1);

function requireOffersOperator(ctx: OrgContext): void {
  requireOperatorCapability(ctx, "admin.offers");
}

/** Pose le contexte d'organisation (RLS) dans une transaction globale avant d'écrire pour elle. */
async function asOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.query("select set_config('app.org_id', $1, true)", [orgId]);
}

function validationError(issues: { path: string; message: string }[]): AppError {
  return new AppError("validation", issues[0]?.message ?? "Offre invalide.", 400, { issues });
}

function parseOrThrow<T>(r: { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } }): T {
  if (r.success) return r.data;
  throw validationError(r.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message })));
}

const isUniqueViolation = (err: unknown): boolean => err instanceof DbError && err.code === "conflict";
const CODE_TAKEN = (code: string) => new AppError("conflict", `Le code ${code} est déjà utilisé par une autre offre.`, 409);

// ---------------------------------------------------------------- administration

export async function adminListOffers(ctx: OrgContext): Promise<CommercialOffer[]> {
  requireOffersOperator(ctx);
  return ctx.services.db.withGlobal((tx) => repos.offers.list(tx));
}

export async function adminCreateOffer(ctx: OrgContext, raw: unknown): Promise<CommercialOffer> {
  requireOffersOperator(ctx);
  const input = parseOrThrow(offerInput.safeParse(raw ?? {}));
  let created: CommercialOffer;
  try {
    created = await ctx.services.db.withGlobal(async (tx) => {
      if (input.code && (await repos.offers.byCode(tx, input.code))) throw CODE_TAKEN(input.code);
      return repos.offers.create(tx, { ...input, createdBy: ctx.userId });
    });
  } catch (err) {
    if (isUniqueViolation(err) && input.code) throw CODE_TAKEN(input.code);
    throw err;
  }
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "admin.offer_created", targetType: "commercial_offer", targetId: created.id, meta: auditMeta(created), ip: ctx.ip }));
  return created;
}

/** Modification (y compris activer / désactiver et le bandeau). Les règles croisées sont vérifiées sur l'offre complète. */
export async function adminUpdateOffer(ctx: OrgContext, id: string, raw: unknown): Promise<CommercialOffer> {
  requireOffersOperator(ctx);
  const patch = parseOrThrow(offerUpdate.safeParse(raw ?? {}));
  // Changer de type de remise : la valeur de l'autre type est effacée (exactement l'une des deux).
  if (patch.discountPercent != null && patch.discountCents === undefined) patch.discountCents = null;
  if (patch.discountCents != null && patch.discountPercent === undefined) patch.discountPercent = null;
  const now = ctx.services.now().toISOString();
  let before: CommercialOffer | null = null;
  let updated: CommercialOffer;
  try {
    updated = await ctx.services.db.withGlobal(async (tx) => {
      before = await repos.offers.byId(tx, id);
      if (!before) throw new AppError("not_found", "Offre introuvable.", 404);
      if (before.archivedAt) throw new AppError("conflict", "Offre archivée : elle a déjà servi et ne peut plus être modifiée. Créez-en une nouvelle.", 409);
      const merged: OfferInput = { ...pickInput(before), ...stripUndefined(patch) };
      const issues = offerRuleIssues(merged);
      if (issues.length) throw validationError(issues);
      if (patch.code && patch.code !== before.code) {
        const other = await repos.offers.byCode(tx, patch.code);
        if (other && other.id !== id) throw CODE_TAKEN(patch.code);
      }
      const row = await repos.offers.update(tx, id, stripUndefined(patch), now);
      if (!row) throw new AppError("not_found", "Offre introuvable.", 404);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err) && patch.code) throw CODE_TAKEN(patch.code);
    throw err;
  }
  const prev = before as CommercialOffer | null;
  const action = prev && prev.active !== updated.active && Object.keys(stripUndefined(patch)).length === 1 ? (updated.active ? "admin.offer_activated" : "admin.offer_deactivated") : "admin.offer_updated";
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action, targetType: "commercial_offer", targetId: id, meta: { ...auditMeta(updated), changed: Object.keys(stripUndefined(patch)) }, ip: ctx.ip }));
  return updated;
}

/**
 * Suppression : réelle si l'offre n'a jamais servi ; sinon archivage (inactive, sans bandeau, conservée pour
 * les organisations qui l'ont appliquée et pour l'historique des factures).
 */
export async function adminDeleteOffer(ctx: OrgContext, id: string): Promise<{ deleted: boolean; archived: boolean; offer: CommercialOffer | null }> {
  requireOffersOperator(ctx);
  const now = ctx.services.now().toISOString();
  const outcome = await ctx.services.db.withGlobal(async (tx) => {
    const offer = await repos.offers.byId(tx, id);
    if (!offer) throw new AppError("not_found", "Offre introuvable.", 404);
    if (offer.redemptions === 0) {
      try {
        if (await repos.offers.deleteUnused(tx, id)) return { deleted: true, archived: false, offer: null, before: offer };
      } catch (err) {
        // Une organisation l'a appliquée entre-temps (référence) : archivage.
        if (!(err instanceof DbError)) throw err;
      }
    }
    return { deleted: false, archived: true, offer: await repos.offers.archive(tx, id, now), before: offer };
  });
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: outcome.deleted ? "admin.offer_deleted" : "admin.offer_archived", targetType: "commercial_offer", targetId: id, meta: auditMeta(outcome.before), ip: ctx.ip }));
  return { deleted: outcome.deleted, archived: outcome.archived, offer: outcome.offer };
}

function auditMeta(o: CommercialOffer): Record<string, unknown> {
  return { name: o.name, code: o.code, discount: offerDiscountLabel(o), plans: o.plans, durationMonths: o.durationMonths, active: o.active, bannerEnabled: o.bannerEnabled, maxRedemptions: o.maxRedemptions, redemptions: o.redemptions };
}

function pickInput(o: CommercialOffer): OfferInput {
  return { name: o.name, code: o.code, discountPercent: o.discountPercent, discountCents: o.discountCents, plans: o.plans, durationMonths: o.durationMonths, startsAt: o.startsAt, endsAt: o.endsAt, maxRedemptions: o.maxRedemptions, bannerEnabled: o.bannerEnabled, bannerText: o.bannerText, active: o.active };
}

function stripUndefined<T extends object>(o: T): Partial<OfferInput> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<OfferInput>;
}

// ---------------------------------------------------------------- public : bandeau et vérification

/** Offres affichées dans le bandeau (sans session) : actives, dans leur période, sous leur maximum, avec bandeau. */
export function publicBanners(services: Services): Promise<PublicOffer[]> {
  return services.db.withGlobal((tx) => repos.offers.publicBanners(tx, services.now().toISOString()));
}

/** « -20 % sur Pro pendant 3 mois », « -5 € sur tous les forfaits tant que l'abonnement dure ». */
function offerSummary(o: CommercialOffer): string {
  return `${offerDiscountLabel(o)} sur ${offerPlansLabel(o.plans)} ${o.durationMonths === null ? "tant que l'abonnement dure" : offerDurationLabel(o.durationMonths)}`;
}

function pricesFor(offer: CommercialOffer, cycle: BillingCycle): NonNullable<PromoCheckResult["prices"]> {
  return PAID_PLANS.filter((p) => offerCoversPlan(offer.plans, p)).map((plan) => ({ plan, cycle, priceCents: priceOf(plan, cycle), discountedCents: discountedPriceCents(priceOf(plan, cycle), offer) }));
}

/** Offre d'un code saisi, avec la raison d'un refus (messages affichables). */
async function resolveCode(tx: Tx, rawCode: unknown, now: Date, plan: string | null): Promise<{ offer: CommercialOffer } | { refusal: PromoCheckResult }> {
  const code = normalizeOfferCode(rawCode);
  if (!code) return { refusal: { valid: false, reason: "invalid_code", message: "Ce code promo n'a pas le bon format (3 à 24 lettres, chiffres ou tirets)." } };
  const offer = await repos.offers.byCode(tx, code);
  if (!offer) return { refusal: { valid: false, reason: "unknown_code", message: "Code promo inconnu." } };
  const ok = offerAvailability(offer, { now, plan });
  if (!ok.ok) return { refusal: { valid: false, reason: ok.reason, message: ok.message } };
  return { offer };
}

/** Vérifie un code sans rien écrire : offre active, dans sa période, sous son maximum et, si demandé, forfait concerné. */
export async function checkCode(services: Services, rawCode: unknown, opts: { plan?: PaidPlan | null; cycle?: BillingCycle } = {}): Promise<PromoCheckResult> {
  const cycle: BillingCycle = opts.cycle === "yearly" ? "yearly" : "monthly";
  const found = await services.db.withGlobal((tx) => resolveCode(tx, rawCode, services.now(), opts.plan ?? null));
  if ("refusal" in found) return found.refusal;
  const pub = toPublicOffer(found.offer);
  return { valid: true, message: `Code ${pub.code} valable : ${offerSummary(found.offer)}.`, offer: pub, prices: pricesFor(found.offer, cycle) };
}

// ---------------------------------------------------------------- client : appliquer un code

export interface ApplyOutcome extends PromoCheckResult {
  applied: boolean;
  redemption?: OfferRedemption;
}

/**
 * Applique un code à une organisation : vérification, puis dans UNE transaction l'utilisation est comptée sous
 * le maximum (atomique) et l'instantané de la remise est enregistré (une seule offre par organisation : une
 * offre déjà appliquée n'est jamais remplacée ici). Ne lève que sur une panne : un refus est rendu avec son message.
 */
async function applyCode(services: Services, orgId: string, rawCode: unknown, opts: { plan: string | null; actorUserId: string | null; ip: string | null; source: "signup" | "billing" }): Promise<ApplyOutcome> {
  const now = services.now();
  const at = now.toISOString();
  return services.db.withGlobal(async (tx) => {
    await asOrg(tx, orgId);
    const existing = await repos.offerRedemptions.get(tx, orgId);
    if (existing) return { applied: false, valid: false, reason: "already_applied" as const, message: `Une offre est déjà appliquée à votre abonnement (« ${existing.name} ») : une seule offre à la fois. Écrivez-nous pour la changer.`, redemption: existing };
    const found = await resolveCode(tx, rawCode, now, opts.plan);
    if ("refusal" in found) return { applied: false, ...found.refusal };
    const claimed = await repos.offers.claim(tx, found.offer.id, at);
    if (!claimed) return { applied: false, valid: false, reason: "exhausted" as const, message: "Ce code promo a atteint son nombre maximum d'utilisations." };
    await asOrg(tx, orgId);
    const redemption = await repos.offerRedemptions.create(tx, { orgId, offerId: claimed.id, name: claimed.name, code: claimed.code, discountPercent: claimed.discountPercent, discountCents: claimed.discountCents, plans: claimed.plans, durationMonths: claimed.durationMonths, monthsRemaining: claimed.durationMonths });
    // Course avec une autre application pour la même organisation : on annule tout (le compteur ne bouge pas).
    if (!redemption) throw new AppError("conflict", "Une offre vient d'être appliquée à votre abonnement.", 409);
    await repos.audit.add(tx, { orgId, actorUserId: opts.actorUserId, action: "offer.applied", targetType: "offer_redemption", targetId: redemption.id, meta: { offerId: claimed.id, code: claimed.code, name: claimed.name, discount: offerDiscountLabel(claimed), plans: claimed.plans, durationMonths: claimed.durationMonths, source: opts.source }, ip: opts.ip });
    return { applied: true, valid: true, message: `Code ${claimed.code} enregistré : ${offerSummary(claimed)}, appliqué à vos prochains paiements.`, offer: toPublicOffer(claimed), prices: pricesFor(claimed, "monthly"), redemption };
  });
}

/** À l'inscription : jamais bloquant (code vide, mal formé, inconnu, expiré : ignoré avec un message ; incident : idem). */
export async function applyCodeAtSignup(services: Services, orgId: string, rawCode: unknown, opts: { actorUserId: string | null; ip: string | null }): Promise<Pick<ApplyOutcome, "applied" | "reason" | "message"> | null> {
  if (typeof rawCode !== "string" || rawCode.trim() === "") return null;
  try {
    const r = await applyCode(services, orgId, rawCode, { plan: null, actorUserId: opts.actorUserId, ip: opts.ip, source: "signup" });
    return { applied: r.applied, ...(r.reason ? { reason: r.reason } : {}), message: r.applied ? r.message : `${r.message} Votre inscription continue.` };
  } catch {
    return { applied: false, message: "Le code promo n'a pas pu être pris en compte pour le moment ; votre inscription continue." };
  }
}

/** Forfait visé par l'abonnement (offre retenue ou en cours), ou null : le forfait sera vérifié au paiement. */
async function targetPlan(ctx: OrgContext): Promise<PaidPlan | null> {
  const sub = await withOrg(ctx, (tx) => repos.subscriptions.get(tx));
  if (!sub) return null;
  const isPaid = (p: unknown): p is PaidPlan => (PAID_PLANS as readonly string[]).includes(String(p));
  if (isPaid(sub.pendingPlan)) return sub.pendingPlan;
  if ((sub.status === "active" || sub.status === "past_due") && isPaid(sub.plan)) return sub.plan;
  return null;
}

/** Page Abonnement › « Ajouter un code promo » (titulaire : « billing.manage »). */
export async function applyCodeForOrg(ctx: OrgContext, rawCode: unknown, opts: { plan?: PaidPlan | null } = {}): Promise<ApplyOutcome> {
  requireAction(ctx, "billing.manage");
  const plan = opts.plan ?? (await targetPlan(ctx));
  return applyCode(ctx.services, ctx.orgId, rawCode, { plan, actorUserId: ctx.userId, ip: ctx.ip, source: "billing" });
}

/** Offre appliquée à l'organisation (finances), ou null. */
export async function getOrgOffer(ctx: OrgContext): Promise<OfferRedemption | null> {
  requireAction(ctx, "finances.read");
  return withOrg(ctx, (tx) => repos.offerRedemptions.get(tx, ctx.orgId));
}

// ---------------------------------------------------------------- facturation

export interface InstallmentDiscount {
  line: InvoiceExtraLine;
  redemptionId: string;
  monthsRemainingAfter: number | null;
}

/**
 * Remise d'une échéance (dans une transaction de l'organisation) : ligne « Remise : <nom> (CODE) » au montant
 * de la remise, ou null (aucune offre, plus de mois, forfait non concerné).
 */
export async function discountLineFor(tx: Tx, orgId: string, plan: PaidPlan, cycle: BillingCycle, priceCents: number): Promise<InstallmentDiscount | null> {
  const r = await repos.offerRedemptions.get(tx, orgId);
  if (!r) return null;
  const d = redemptionDiscountFor(r, plan, cycle, priceCents);
  if (!d) return null;
  return { line: { kind: "discount", product: "offer_discount", label: offerInvoiceLineLabel(r.name, r.code), quantity: 1, unitCents: d.discountCents, amountCents: d.discountCents }, redemptionId: r.id, monthsRemainingAfter: d.monthsRemainingAfter };
}

/**
 * Échéance réellement payée ou facturée à 0 € avec une remise : mois restants décrémentés (1 au mois, 12 à
 * l'année), dans la transaction qui émet la facture. Sans ligne de remise : rien.
 */
export async function consumeForInvoice(tx: Tx, orgId: string, lines: readonly InvoiceExtraLine[], cycle: BillingCycle, at: string): Promise<void> {
  if (!lines.some((l) => l.kind === "discount" && l.product === "offer_discount")) return;
  const r = await repos.offerRedemptions.get(tx, orgId);
  if (!r || r.monthsRemaining === null) return;
  await repos.offerRedemptions.consume(tx, r.id, Math.max(0, r.monthsRemaining - offerMonthsPerInstallment(cycle)), at);
}
