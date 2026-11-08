import { randomInt } from "node:crypto";
import {
  REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH, REFERRAL_CREDIT_MONTHS, REFERRAL_MAX_CREDITS_PER_REFERRER, canonicalEmail, normalizeReferralCode,
  type ReferralApplyOutcome, type ReferralOverview, type ReferralQualifyOutcome, type ReferralRefusalReason, type SubscriptionCredit,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { AppError, requireAction, webLink, withOrg, type OrgContext, type Services, type ServicesConfig } from "../context";

/**
 * Parrainage (§5.15) : « un mois offert aux deux ».
 *
 * - `getOrCreateCode` : code unique de l'organisation (6 caractères lisibles), créé à la première demande.
 * - `applyCodeAtSignup` : à l'inscription, lien « en attente » vers la marraine. Jamais bloquant : un code
 *   vide, mal formé, inconnu, le sien (même organisation ou même titulaire) ou une organisation déjà
 *   parrainée est ignoré avec un message.
 * - `qualify` : appelé par la facturation après un paiement encaissé (hors essai : l'autorisation de
 *   vérification ne passe pas par là). Le contrôle d'auto-parrainage est REFAIT à ce moment-là (à
 *   l'inscription, l'organisation est toute neuve et n'a qu'un membre : le contrôle y est presque toujours
 *   vide) : aucun membre commun, aucun email canonique commun (sans +alias, sans points pour Gmail), ni client
 *   ni moyen de paiement Revolut commun, et plafond de REFERRAL_MAX_CREDITS_PER_REFERRER mois offerts par
 *   marraine sur 12 mois. Échec : lien « refused », audit des deux côtés, aucun crédit. Sinon le premier
 *   paiement qualifie le lien et accorde un crédit d'un mois à chacune des deux organisations, une seule
 *   fois (transition conditionnelle + index unique).
 * - La consommation d'un crédit est faite par `billing.processSubscriptionRenewal` (facture à 0 €).
 *
 * Tout est désactivé tant que REFERRAL_ENABLED n'est pas vrai (`services.config.referralEnabled`).
 */

export function referralConfigFromEnv(env: Record<string, string | undefined> = process.env): Pick<ServicesConfig, "referralEnabled"> {
  return { referralEnabled: (env.REFERRAL_ENABLED ?? "").trim().toLowerCase() === "true" };
}

export function referralEnabled(services: Pick<Services, "config">): boolean {
  return services.config?.referralEnabled === true;
}

const DISABLED_MESSAGE = "Le parrainage n'est pas ouvert pour le moment.";

/** Code aléatoire dans l'alphabet lisible (tirage cryptographique, sans biais). */
export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

/** Pose le contexte d'organisation (RLS) dans une transaction globale avant d'écrire pour elle. */
async function asOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.query("select set_config('app.org_id', $1, true)", [orgId]);
}

/** Code de l'organisation, créé au besoin (collision : nouveau tirage ; création concurrente : relu). */
export async function getOrCreateCode(ctx: OrgContext): Promise<string> {
  requireAction(ctx, "org.update");
  if (!referralEnabled(ctx.services)) throw new AppError("referral_disabled", DISABLED_MESSAGE, 404);
  return ctx.services.db.withGlobal(async (tx) => {
    const existing = await repos.referralCodes.byOrg(tx, ctx.orgId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 10; attempt++) {
      const created = await repos.referralCodes.create(tx, ctx.orgId, generateReferralCode());
      if (created) {
        await asOrg(tx, ctx.orgId);
        await repos.audit.add(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "referral.code_created", targetType: "organization", targetId: ctx.orgId, meta: {}, ip: ctx.ip });
        return created;
      }
      const raced = await repos.referralCodes.byOrg(tx, ctx.orgId);
      if (raced) return raced;
    }
    throw new AppError("conflict", "Impossible de créer un code de parrainage pour le moment ; réessayez.", 409);
  });
}

/** Page Parrainage : visible seulement si activé (sinon `enabled: false`, rien n'est créé). */
export async function getOverview(ctx: OrgContext): Promise<ReferralOverview> {
  requireAction(ctx, "org.update");
  const empty: ReferralOverview = { enabled: false, code: null, shareUrl: null, referred: { pending: 0, qualified: 0, credited: 0, refused: 0 }, creditsAvailable: 0, creditsConsumed: 0, referredBy: null };
  if (!referralEnabled(ctx.services)) return empty;
  const code = await getOrCreateCode(ctx);
  const { referred, referredBy } = await ctx.services.db.withGlobal(async (tx) => ({
    referred: await repos.referrals.countByStatus(tx, ctx.orgId),
    referredBy: await repos.referrals.byReferred(tx, ctx.orgId),
  }));
  const credits = await withOrg(ctx, (tx) => repos.subscriptionCredits.list(tx, ctx.orgId));
  return {
    enabled: true,
    code,
    shareUrl: webLink(ctx.services, "/inscription", { parrain: code }),
    referred,
    creditsAvailable: credits.filter((c) => c.consumedAt === null).length,
    creditsConsumed: credits.filter((c) => c.consumedAt !== null).length,
    referredBy: referredBy ? { status: referredBy.status } : null,
  };
}

/**
 * À l'inscription (organisation tout juste créée) : rattache la filleule à la marraine du code.
 * Auto-parrainage refusé : même organisation, ou un membre de la marraine est membre de la filleule (le
 * titulaire qui ouvre un second espace avec son propre code).
 */
export async function applyCodeAtSignup(services: Services, orgId: string, rawCode: unknown): Promise<ReferralApplyOutcome> {
  if (typeof rawCode !== "string" || rawCode.trim() === "") return { applied: false, reason: "empty", message: "Aucun code de parrainage saisi." };
  if (!referralEnabled(services)) return { applied: false, reason: "disabled", message: `${DISABLED_MESSAGE} Le code n'a pas été pris en compte ; votre inscription continue.` };
  const code = normalizeReferralCode(rawCode);
  if (!code) return { applied: false, reason: "invalid_code", message: "Ce code de parrainage n'a pas le bon format (6 lettres et chiffres) : il est ignoré, votre inscription continue." };
  return services.db.withGlobal(async (tx) => {
    const owner = await repos.referralCodes.byCode(tx, code);
    if (!owner) return { applied: false, reason: "unknown_code" as const, message: "Code de parrainage inconnu : il est ignoré, votre inscription continue." };
    const shared = await tx.count("select count(*) from memberships a join memberships b on a.user_id = b.user_id where a.org_id = $1 and b.org_id = $2", [owner.orgId, orgId]);
    if (owner.orgId === orgId || shared > 0) {
      await asOrg(tx, orgId);
      await repos.audit.add(tx, { orgId, actorUserId: null, action: "referral.self_referral_refused", targetType: "organization", targetId: orgId, meta: { code } });
      return { applied: false, reason: "self_referral" as const, message: "Vous ne pouvez pas utiliser votre propre code de parrainage." };
    }
    const link = await repos.referrals.create(tx, { code, referrerOrgId: owner.orgId, referredOrgId: orgId });
    if (!link) return { applied: false, reason: "already_referred" as const, message: "Cette organisation est déjà parrainée." };
    // Une entrée de chaque côté, sans donnée sur l'autre organisation (ni nom, ni adresse).
    await asOrg(tx, orgId);
    await repos.audit.add(tx, { orgId, actorUserId: null, action: "referral.linked", targetType: "referral", targetId: link.id, meta: { code } });
    await asOrg(tx, owner.orgId);
    await repos.audit.add(tx, { orgId: owner.orgId, actorUserId: null, action: "referral.signup", targetType: "referral", targetId: link.id, meta: {} });
    return { applied: true, referral: link, message: "Code de parrainage enregistré : un mois vous sera offert, ainsi qu'à l'organisation qui vous parraine, après votre premier paiement." };
  });
}

/**
 * Premier paiement réussi de la filleule : lien « qualified » et un crédit d'un mois pour chacune.
 * Idempotent : un lien déjà qualifié ne rend rien de plus (appelé après chaque paiement encaissé).
 */
export async function qualify(services: Services, referredOrgId: string): Promise<ReferralQualifyOutcome> {
  if (!referralEnabled(services)) return { qualified: false, reason: "disabled" };
  const now = services.now().toISOString();
  return services.db.withGlobal(async (tx) => {
    const link = await repos.referrals.byReferred(tx, referredOrgId);
    if (!link) return { qualified: false, reason: "no_referral" as const };
    if (link.status !== "pending") return { qualified: false, reason: link.status === "refused" ? "refused" as const : "already_qualified" as const, referral: link };
    const refusal = await selfReferralCheck(tx, link.referrerOrgId, link.referredOrgId, services.now());
    if (refusal) {
      const refused = await repos.referrals.markRefused(tx, link.id, now, refusal);
      if (!refused) return { qualified: false, reason: "already_qualified" as const, referral: link };
      for (const orgId of [refused.referredOrgId, refused.referrerOrgId]) {
        await asOrg(tx, orgId);
        await repos.audit.add(tx, { orgId, actorUserId: null, action: "referral.refused", targetType: "referral", targetId: refused.id, meta: { reason: refusal } });
      }
      return { qualified: false, reason: "refused" as const, refusal, referral: refused };
    }
    const qualified = await repos.referrals.markQualified(tx, link.id, now);
    if (!qualified) return { qualified: false, reason: "already_qualified" as const, referral: link };
    const credits: SubscriptionCredit[] = [];
    for (const [orgId, side] of [[qualified.referredOrgId, "referred"], [qualified.referrerOrgId, "referrer"]] as const) {
      await asOrg(tx, orgId);
      const credit = await repos.subscriptionCredits.grant(tx, { orgId, kind: "referral", months: REFERRAL_CREDIT_MONTHS, sourceReferralId: qualified.id });
      if (credit) credits.push(credit);
      await repos.audit.add(tx, { orgId, actorUserId: null, action: "referral.credit_granted", targetType: "subscription_credit", targetId: credit?.id ?? null, meta: { referralId: qualified.id, side, months: REFERRAL_CREDIT_MONTHS } });
    }
    return { qualified: true, referral: qualified, credits };
  });
}

/**
 * Contrôle d'auto-parrainage au moment de qualifier (null : rien à redire). Ne lit que des identifiants et
 * des emails des deux organisations ; rien n'est rendu ni journalisé au-delà du code de la raison.
 * Le numéro de carte n'est jamais connu de Selio : la comparaison porte sur l'identifiant du client et du
 * moyen de paiement enregistré chez Revolut (une même carte enregistrée deux fois chez Revolut sous deux
 * clients différents n'est pas détectée ; une empreinte de carte demanderait l'API Revolut).
 */
async function selfReferralCheck(tx: Tx, referrerOrgId: string, referredOrgId: string, now: Date): Promise<ReferralRefusalReason | null> {
  if (referrerOrgId === referredOrgId) return "shared_member";
  const shared = await tx.count("select count(*) from memberships a join memberships b on a.user_id = b.user_id where a.org_id = $1 and b.org_id = $2", [referrerOrgId, referredOrgId]);
  if (shared > 0) return "shared_member";
  const emailsOf = async (orgId: string) => new Set((await tx.query<{ email: string }>("select u.email from memberships m join users u on u.id = m.user_id where m.org_id = $1", [orgId])).map((r) => canonicalEmail(r.email)));
  const a = await emailsOf(referrerOrgId);
  for (const e of await emailsOf(referredOrgId)) if (a.has(e)) return "same_email";
  const paymentOf = async (orgId: string) => {
    await asOrg(tx, orgId);
    return tx.maybeOne<{ revolutCustomerId: string | null; paymentMethodId: string | null }>("select revolut_customer_id, payment_method_id from subscriptions where org_id = $1", [orgId]);
  };
  const pa = await paymentOf(referrerOrgId);
  const pb = await paymentOf(referredOrgId);
  if (pa && pb && ((pa.revolutCustomerId && pa.revolutCustomerId === pb.revolutCustomerId) || (pa.paymentMethodId && pa.paymentMethodId === pb.paymentMethodId))) return "same_payment";
  const since = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  if ((await repos.referrals.countQualifiedSince(tx, referrerOrgId, since)) >= REFERRAL_MAX_CREDITS_PER_REFERRER) return "cap_reached";
  return null;
}

/** Mois offerts de l'organisation (disponibles d'abord). */
export async function listCredits(ctx: OrgContext): Promise<SubscriptionCredit[]> {
  requireAction(ctx, "finances.read");
  const list = await withOrg(ctx, (tx) => repos.subscriptionCredits.list(tx, ctx.orgId));
  return [...list].sort((a, b) => Number(a.consumedAt !== null) - Number(b.consumedAt !== null));
}
