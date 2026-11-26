import {
  BETA_DAYS, BETA_ENDED_ERROR, BETA_ENDED_MESSAGE, BETA_INVOICE_LINE_LABEL, BETA_PLAN, DEFAULT_VAT_RATE, PLAN_LABELS, VAT_FRANCHISE_NOTICE,
  betaDateLabel, betaDaysLeft, betaEndDate, betaReminderFor, isGrantWithoutEnd, offerAvailability, quotasForPlan,
  type BetaStatus, type CommercialOffer, type InvoiceExtraLine, type PaidPlan, type PromoCheckResult, type Subscription,
} from "@selio/contracts";
import { PRICING } from "@selio/demo-data";
import { repos, type Tx } from "@selio/db";

type BetaAccessRecord = repos.BetaAccessRecord;
import { alertEmail } from "@selio/email";
import { AppError, sendEmail, webLink, withOrg, type OrgContext, type Services } from "../context";

/**
 * Bêta Selio (voir @selio/contracts, beta.ts) : le code BETA2026SELIO ouvre un mois de Selio Pro sans carte.
 *
 * - Ouverture (`startBetaAccess`, appelée par offers.applyCode à l'inscription) : dans UNE transaction, utilisation
 *   comptée sous le maximum de l'offre, accès bêta enregistré (une fois par compte), essai Pro de 30 jours, facture
 *   à 0,00 € « Selio — accès bêta, 1 mois offert » numérotée comme les autres (aucun prestataire appelé), compte
 *   qualifié « Bêta ».
 * - Fin du mois (worker, `endBetaIfUnpaid`) sans moyen de paiement : abonnement en attente du paiement et accès
 *   bêta terminé : écran de blocage et 402 `beta_ended` sur les actions métier (`betaBlockedSince`). Données
 *   conservées. Avec un moyen de paiement (carte, ou forfait retenu en paiement simulé), la suite habituelle.
 * - Rappels J-7 et J-1 par email (`sendBetaReminders`) seulement si l'envoi d'emails est réellement configuré.
 * - Déblocage : prolongation d'essai ou accès offert (Selio Admin), paiement, ou forfait retenu sur la page de
 *   paiement en paiement simulé (`billing.startCheckout`).
 */

const ACTIVE_STATUSES: readonly Subscription["status"][] = ["trialing", "active", "past_due"];

/** Vrai si un fournisseur d'email envoie réellement (sinon les rappels ne partent pas, rien n'est simulé). */
export function emailDeliverable(services: Pick<Services, "email">): boolean {
  return !!services.email && services.email.delivers !== false;
}

function vatFor(services: Services): { vatRate: number; vatNotice: string | null } {
  return services.billing?.franchiseTva ? { vatRate: 0, vatNotice: VAT_FRANCHISE_NOTICE } : { vatRate: DEFAULT_VAT_RATE, vatNotice: null };
}

async function ownerEmails(services: Services, orgId: string): Promise<string[]> {
  const members = await services.db.withGlobal((tx) => repos.memberships.listOrg(tx, orgId));
  const owners = members.filter((m) => m.role === "owner").map((m) => m.user.email);
  return owners.length ? owners : members.slice(0, 1).map((m) => m.user.email);
}

const isPaid = (p: unknown): p is PaidPlan => p === "starter" || p === "pro" || p === "agence";

/**
 * État de l'accès bêta (fonction pure : session, GET /api/beta, tests). Bloqué = mois terminé (`endedAt`) ET
 * abonnement toujours en attente d'un paiement (ni essai, ni actif, ni en relance) : même règle que l'API.
 */
export function computeBetaStatus(b: BetaAccessRecord, sub: Subscription | null, now: Date, opts: { simulated: boolean; invoiceNumber?: string | null }): BetaStatus {
  const grantedRunning = !!sub?.grantedUntil && new Date(sub.grantedUntil) > now;
  const trialing = sub?.status === "trialing";
  const running = trialing || grantedRunning;
  const blocked = !!b.endedAt && !!sub?.awaitingPaymentSince && !ACTIVE_STATUSES.includes(sub.status);
  const endsAt = grantedRunning ? (isGrantWithoutEnd(sub!.grantedUntil) ? null : sub!.grantedUntil!) : trialing ? sub!.currentPeriodEnd : null;
  const daysLeft = running && endsAt ? betaDaysLeft(endsAt, now) : null;
  const paymentReady = !!sub && (sub.cardOnFile || grantedRunning || (opts.simulated && !!sub.simulatedCheckoutAt));
  return {
    code: b.code,
    plan: isPaid(b.plan) ? b.plan : BETA_PLAN,
    startedAt: b.startedAt,
    endsAt,
    state: blocked ? "ended" : running ? "running" : "converted",
    blocked,
    blockedSince: blocked ? b.endedAt : null,
    daysLeft,
    reminder: running && !paymentReady ? betaReminderFor(daysLeft) : null,
    paymentReady,
    welcomeSeen: !!b.welcomeSeenAt,
    invoiceNumber: opts.invoiceNumber ?? null,
  };
}

const isSimulated = (services: Pick<Services, "billing">): boolean => services.billing?.paymentMode === "simulated";

/** Accès bêta de l'organisation, ou null (compte sans bêta). */
export async function betaStatusFor(services: Services, orgId: string): Promise<BetaStatus | null> {
  return services.db.withOrg(orgId, async (tx) => {
    const b = await repos.betaAccesses.get(tx, orgId);
    if (!b) return null;
    const sub = await repos.subscriptions.get(tx);
    const invoice = b.invoiceId ? await repos.invoices.byId(tx, b.invoiceId) : null;
    return computeBetaStatus(b, sub, services.now(), { simulated: isSimulated(services), invoiceNumber: invoice?.number ?? null });
  });
}

export function getBetaStatus(ctx: OrgContext): Promise<BetaStatus | null> {
  return betaStatusFor(ctx.services, ctx.orgId);
}

/** « Bienvenue dans la bêta » vu : l'écran ne revient plus (pour toute l'organisation). */
export async function markWelcomeSeen(ctx: OrgContext): Promise<BetaStatus | null> {
  const at = ctx.services.now().toISOString();
  await withOrg(ctx, async (tx) => {
    const b = await repos.betaAccesses.get(tx, ctx.orgId);
    if (!b) throw new AppError("not_found", "Ce compte n'a pas d'accès bêta.", 404);
    if (!b.welcomeSeenAt) await repos.betaAccesses.update(tx, ctx.orgId, { welcomeSeenAt: at });
  });
  return getBetaStatus(ctx);
}

/** Bloqué depuis (fin du mois de bêta sans moyen de paiement), ou null. Une requête légère : appelée par l'API avant chaque action. */
export function betaBlockedSince(services: Services, orgId: string): Promise<string | null> {
  return services.db.withOrg(orgId, (tx) => repos.betaAccesses.blockedSince(tx, orgId));
}

/** Refus d'une action métier après la fin du mois de bêta : 402 `beta_ended`, message clair. */
export function betaEndedError(since: string | null = null): AppError {
  return new AppError(BETA_ENDED_ERROR, BETA_ENDED_MESSAGE, 402, { blockedSince: since, payment: "/app/paiement" });
}

// ---------------------------------------------------------------- ouverture (inscription)

export interface BetaApplyOutcome extends PromoCheckResult {
  applied: boolean;
}

/** Message d'un code bêta refusé (offre désactivée, expirée, pleine…), suivi de la suite de l'inscription. */
function refusal(reason: NonNullable<PromoCheckResult["reason"]>, message: string): BetaApplyOutcome {
  return { applied: false, valid: false, reason, message };
}

/** Vérification sans rien écrire (page d'inscription) : le code bêta est-il ouvert ? */
export function checkBetaOffer(offer: CommercialOffer, now: Date): PromoCheckResult {
  const ok = offerAvailability(offer, { now });
  if (!ok.ok) return { valid: false, reason: ok.reason, message: ok.reason === "exhausted" ? "Les places de la bêta sont toutes prises pour le moment." : ok.reason === "expired" ? "La bêta n'accepte plus de nouvelles inscriptions avec ce code." : "Ce code bêta n'est pas valable en ce moment." };
  const days = offer.betaDays ?? BETA_DAYS;
  return { valid: true, message: `Code bêta valable : Selio ${PLAN_LABELS[BETA_PLAN]} offert pendant ${days} jours, sans carte bancaire.`, beta: { days, plan: BETA_PLAN } };
}

/**
 * Ouvre l'accès bêta d'une organisation (à l'inscription). Atomique : si une étape échoue, rien n'est gardé (ni
 * utilisation comptée, ni facture). Ne lève que sur une panne ; un refus est rendu avec son message.
 */
export async function startBetaAccess(services: Services, orgId: string, offer: CommercialOffer, opts: { actorUserId: string | null; ip: string | null }): Promise<BetaApplyOutcome> {
  const now = services.now();
  const at = now.toISOString();
  const { vatRate, vatNotice } = vatFor(services);
  return services.db.withOrg(orgId, async (tx) => {
    if (await repos.betaAccesses.get(tx, orgId)) return refusal("beta_already_used", "Votre accès bêta a déjà été activé : le code bêta ne s'utilise qu'une fois par compte.");
    const check = checkBetaOffer(offer, now);
    if (!check.valid) return { applied: false, ...check };
    const claimed = await repos.offers.claim(tx, offer.id, at);
    if (!claimed) return refusal("exhausted", "Les places de la bêta sont toutes prises pour le moment.");
    const days = claimed.betaDays ?? BETA_DAYS;
    const plan = BETA_PLAN;
    const end = betaEndDate(now, days);
    const access = await repos.betaAccesses.create(tx, { orgId, offerId: claimed.id, code: claimed.code, plan, days, startedAt: at });
    // Deux ouvertures simultanées pour la même organisation : tout est annulé (le compteur ne bouge pas).
    if (!access) throw new AppError("conflict", "Votre accès bêta vient d'être activé.", 409);
    await repos.subscriptions.upsert(tx, {
      plan, quotas: quotasForPlan(plan), status: "trialing", provider: "none", currentPeriodEnd: end.toISOString(), cardOnFile: false, cancelAtPeriodEnd: false,
      pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, dataRetentionUntil: null, awaitingPaymentSince: null,
    });
    // « Paiement » de 0 € : une vraie ligne de facturation (prix du mois, remise du même montant), sans prestataire.
    const price = PRICING.monthlyCents[plan];
    const line: InvoiceExtraLine = { kind: "discount", product: "beta_access", label: BETA_INVOICE_LINE_LABEL, quantity: 1, unitCents: price, amountCents: price };
    const invoice = await repos.invoices.create(tx, { plan, cycle: "monthly", amountCents: 0, vatRate, vatNotice, periodStart: at, periodEnd: end.toISOString(), orderId: null, issuedAt: at, extraLines: [line] });
    await repos.betaAccesses.update(tx, orgId, { invoiceId: invoice.id });
    // Qualification « Bêta » (Selio Admin) : seulement un compte encore « client » (jamais une qualification choisie par l'équipe).
    await tx.query(
      "update organizations set qualification = 'beta', qualified_at = $2, qualification_note = coalesce(qualification_note, $3), updated_at = now() where id = $1 and qualification = 'client'",
      [orgId, at, `Inscription avec le code bêta ${claimed.code ?? ""}`.trim()],
    );
    await repos.audit.add(tx, { orgId, actorUserId: opts.actorUserId, action: "billing.beta_started", targetType: "invoice", targetId: invoice.id, meta: { offerId: claimed.id, code: claimed.code, plan, days, endsAt: end.toISOString(), invoiceNumber: invoice.number, amountCents: 0 }, ip: opts.ip });
    return {
      applied: true,
      valid: true,
      message: `Bienvenue dans la bêta : Selio ${PLAN_LABELS[plan]} offert jusqu'au ${betaDateLabel(end)}, sans carte bancaire (facture ${invoice.number} à 0,00 €).`,
      beta: { days, plan, endsAt: end.toISOString() },
    };
  });
}

/** Code bêta saisi sur la page Abonnement d'un compte existant : jamais appliqué ici (une fois, à l'inscription). */
export async function betaRefusalForExistingAccount(services: Services, orgId: string): Promise<BetaApplyOutcome> {
  const used = await services.db.withOrg(orgId, (tx) => repos.betaAccesses.get(tx, orgId));
  return used
    ? refusal("beta_already_used", "Votre accès bêta a déjà été activé : le code bêta ne s'utilise qu'une fois par compte.")
    : refusal("beta_signup_only", "Le code bêta s'active à l'inscription d'un nouveau compte. Votre compte existe déjà : écrivez-nous pour rejoindre la bêta.");
}

// ---------------------------------------------------------------- fin du mois et rappels (worker)

/**
 * Fin du mois de bêta (essai échu) : sans moyen de paiement, l'accès bêta est terminé (compte bloqué, données
 * conservées, email aux titulaires). Rend vrai si c'est le cas ; faux pour un compte sans bêta ou dont le moyen de
 * paiement est prêt (carte enregistrée, ou forfait retenu en paiement simulé) : la suite habituelle s'applique.
 */
export async function endBetaIfUnpaid(services: Services, orgId: string, sub: Subscription): Promise<boolean> {
  const simulated = isSimulated(services);
  const ready = simulated ? !!sub.simulatedCheckoutAt : sub.cardOnFile && !!sub.paymentMethodId && !sub.cancelAtPeriodEnd;
  if (ready) return false;
  const now = services.now();
  const ended = await services.db.withOrg(orgId, async (tx) => {
    const b = await repos.betaAccesses.get(tx, orgId);
    if (!b) return null;
    const fresh = await repos.subscriptions.get(tx);
    // Prolongé ou payé entre-temps (opérateur, webhook) : rien à fermer.
    if (!fresh || fresh.status !== "trialing" || !fresh.currentPeriodEnd || new Date(fresh.currentPeriodEnd) > now) return null;
    await repos.subscriptions.upsert(tx, { plan: "free", quotas: quotasForPlan("free"), status: "canceled", chargeAttempts: 0, nextChargeAt: null, cancelAtPeriodEnd: false, dataRetentionUntil: null, awaitingPaymentSince: now.toISOString() });
    await repos.betaAccesses.update(tx, orgId, { endedAt: now.toISOString() });
    await repos.audit.add(tx, { actorUserId: null, action: "billing.beta_ended", targetType: "subscription", meta: { reason: "beta_ended_without_payment", previousPlan: fresh.plan, pendingPlan: fresh.pendingPlan, cardOnFile: fresh.cardOnFile, simulated, code: b.code } });
    return b;
  });
  if (!ended) return false;
  const org = await services.db.withGlobal((tx) => repos.orgs.byId(tx, orgId));
  const rendered = alertEmail({
    title: `Votre mois de bêta Selio est terminé (« ${org.name} »)`,
    body: `Merci d'avoir testé Selio pendant la bêta. Votre mois offert est terminé : ajoutez un moyen de paiement pour continuer à utiliser Selio.\n\nVos données sont conservées. En attendant, l'abonnement, les factures et l'export de vos données restent accessibles.`,
    link: webLink(services, "/app/paiement"),
    linkLabel: "Ajouter un moyen de paiement",
  });
  for (const to of await ownerEmails(services, orgId)) await sendEmail(services, { to, ...rendered });
  return true;
}

/**
 * Rappels avant la fin du mois de bêta (J-7 puis J-1), une fois chacun pour une date de fin donnée (une
 * prolongation les relance), seulement sans moyen de paiement et seulement si l'envoi d'emails est configuré.
 * Rend le nombre d'emails envoyés.
 */
export async function sendBetaReminders(services: Services, orgId: string, sub: Subscription): Promise<number> {
  if (!emailDeliverable(services) || sub.status !== "trialing" || !sub.currentPeriodEnd) return 0;
  const now = services.now();
  const b = await services.db.withOrg(orgId, (tx) => repos.betaAccesses.get(tx, orgId));
  if (!b) return 0;
  const status = computeBetaStatus(b, sub, now, { simulated: isSimulated(services) });
  const which = status.reminder;
  if (which === null) return 0;
  const endKey = new Date(sub.currentPeriodEnd).toISOString();
  if ((which === 7 && (b.reminder7For === endKey || b.reminder1For === endKey)) || (which === 1 && b.reminder1For === endKey)) return 0;
  const org = await services.db.withGlobal((tx) => repos.orgs.byId(tx, orgId));
  const when = which === 1 ? "demain" : `dans ${status.daysLeft} jours`;
  const rendered = alertEmail({
    title: `Votre mois de bêta Selio se termine ${when}`,
    body: `Votre accès bêta à Selio ${PLAN_LABELS[status.plan]} (« ${org.name} ») se termine le ${betaDateLabel(sub.currentPeriodEnd)}.\n\nPour continuer sans interruption, ajoutez un moyen de paiement. Sans moyen de paiement, l'accès sera suspendu à cette date ; vos données seront conservées.`,
    link: webLink(services, "/app/paiement"),
    linkLabel: "Ajouter un moyen de paiement",
  });
  let sent = 0;
  for (const to of await ownerEmails(services, orgId)) if ((await sendEmail(services, { to, ...rendered })).sent) sent++;
  if (sent > 0) {
    await services.db.withOrg(orgId, async (tx) => {
      await repos.betaAccesses.update(tx, orgId, which === 1 ? { reminder1For: endKey, reminder7For: endKey } : { reminder7For: endKey });
      await repos.audit.add(tx, { actorUserId: null, action: "billing.beta_reminder_sent", targetType: "subscription", meta: { reminder: `J-${which}`, endsAt: endKey, recipients: sent } });
    });
  }
  return sent;
}

/**
 * Forfait retenu sur la page de paiement après la fin du mois de bêta (paiement simulé) : le moyen de paiement est
 * « enregistré » (rien n'est débité), l'accès bêta n'est plus bloquant ; le compte reste en attente du paiement
 * (accès de base) jusqu'à l'ouverture du paiement en ligne ou une décision de l'équipe Selio.
 */
export async function clearBetaBlock(tx: Tx, orgId: string): Promise<void> {
  await repos.betaAccesses.update(tx, orgId, { endedAt: null });
}
