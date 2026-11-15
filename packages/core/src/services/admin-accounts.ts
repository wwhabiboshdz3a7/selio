import type { z } from "zod";
import {
  ACCOUNT_BLOCKED_MESSAGE, GRANT_NO_END, ORG_QUALIFICATIONS, PAID_PLANS, PLANS, PLAN_LABELS, TRIAL_PLAN,
  adminAccountsQuery, adminExtendTrialInput, adminGrantInput, adminNoteInput, adminQualificationInput, isGrantWithoutEnd, isPlan, quotasForPlan,
  type AdminAccountDetail, type AdminAccountEvent, type AdminAccountRow, type AdminGrowth, type OperatorRole, type OrgQualification, type PaidPlan, type Plan,
  type Subscription, type SubscriptionStatus,
} from "@selio/contracts";
import { repos } from "@selio/db";
import { resolveOperatorRole } from "@selio/domain";
import { AppError, requireOperatorCapability, type OrgContext, type Services } from "../context";
import { planPriceCents } from "./billing";

/**
 * Selio Admin : comptes (organisations) vus et qualifiés par les opérateurs Selio.
 *
 * - Qualification (client, bêta, partenaire, équipe, test, bloqué) et note interne : jamais montrées au client.
 * - Accès offert : un plan payant actif sans débit jusqu'à une date (ou sans fin pour l'équipe Selio) ; le
 *   worker le ramène à l'accès de base à l'échéance (`billing.processSubscriptionRenewal`).
 * - Prolongation d'essai de 1 à 90 jours.
 * - Chaque action écrit dans le journal d'audit du compte (`admin.*`, acteur, avant/après) ; ces entrées
 *   internes sont retirées du journal vu par le client (`isInternalAdminAuditAction`).
 *
 * Droits : opérateurs « business » et « tech » (matrice `operatorCan` de @selio/domain).
 */

/** Actions internes de Selio Admin, absentes du journal d'audit montré aux membres du compte. */
const INTERNAL_ADMIN_PREFIXES = ["admin.account_", "admin.access_", "admin.trial_"] as const;
export function isInternalAdminAuditAction(action: string): boolean {
  return INTERNAL_ADMIN_PREFIXES.some((p) => action.startsWith(p));
}

/** Actions montrées dans l'historique d'une fiche compte. */
const HISTORY_PREFIXES = ["admin.", "billing.", "referral.", "auth.register", "member."] as const;

const isQualification = (v: string): v is OrgQualification => (ORG_QUALIFICATIONS as readonly string[]).includes(v);
const isPaidPlan = (v: unknown): v is PaidPlan => typeof v === "string" && (PAID_PLANS as readonly string[]).includes(v);

// ---------------------------------------------------------------- accès d'une session

export interface SessionAccess {
  operatorRole: OperatorRole | null;
  /** Compte qualifié « bloqué » et membre non opérateur : la session est refusée. */
  blocked: boolean;
}

/**
 * Rôle d'opérateur (recalculé depuis la configuration) et blocage du compte, en une requête. Appelé par
 * l'API à chaque requête authentifiée : un compte existant devient opérateur sans réinscription.
 */
export async function sessionAccess(services: Services, userId: string, orgId: string): Promise<SessionAccess> {
  const info = await services.db.withGlobal((tx) => repos.adminAccounts.accessInfo(tx, userId, orgId));
  if (!info) return { operatorRole: null, blocked: false };
  const operatorRole = resolveOperatorRole(services.operators, info);
  return { operatorRole, blocked: info.qualification === "bloque" && operatorRole === null };
}

/** Refus d'une session d'un compte bloqué : 403 avec un message clair. */
export function accountBlockedError(): AppError {
  return new AppError("account_blocked", ACCOUNT_BLOCKED_MESSAGE, 403);
}

// ---------------------------------------------------------------- lecture

function rowOf(r: repos.AdminAccountRecord): AdminAccountRow {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    qualification: isQualification(r.qualification) ? r.qualification : "client",
    plan: isPlan(r.plan) ? r.plan : "free",
    status: r.status as SubscriptionStatus,
    provider: r.provider,
    currentPeriodEnd: r.currentPeriodEnd,
    grantedUntil: r.grantedUntil,
    cardOnFile: r.cardOnFile,
    members: r.members,
    ownerEmail: r.ownerEmail,
  };
}

/** Abonnement payé par carte (Revolut), actif ou en relance, hors accès offert. */
function isPaying(r: Pick<AdminAccountRow, "provider" | "status" | "grantedUntil" | "plan">): boolean {
  return r.grantedUntil === null && r.provider === "revolut" && (r.status === "active" || r.status === "past_due") && isPaidPlan(r.plan);
}

/**
 * Tableau de croissance : chiffres réels de la base (aucune estimation hors du revenu mensuel). Le revenu
 * mensuel estimé additionne, pour chaque abonnement payant actif ou en relance (hors accès offert), le prix
 * de son plan (`planPriceCents`, PRICING) ; l'annuel est ramené au mois (prix annuel / 12).
 */
export async function adminGrowth(ctx: OrgContext): Promise<AdminGrowth> {
  requireOperatorCapability(ctx, "admin.growth");
  const now = ctx.services.now();
  const { records, referrals } = await ctx.services.db.withGlobal(async (tx) => ({ records: await repos.adminAccounts.list(tx), referrals: await repos.adminAccounts.referralCounts(tx) }));
  const byQualification = Object.fromEntries(ORG_QUALIFICATIONS.map((q) => [q, 0])) as Record<OrgQualification, number>;
  const byPlan = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<Plan, number>;
  const payingByPlan = Object.fromEntries(PAID_PLANS.map((p) => [p, 0])) as Record<PaidPlan, number>;
  const accounts = { total: records.length, trialing: 0, paying: 0, granted: 0, free: 0, blocked: 0 };
  let mrrCents = 0, last7Days = 0, last30Days = 0;
  for (const rec of records) {
    const r = rowOf(rec);
    byQualification[r.qualification]++;
    byPlan[r.plan]++;
    if (r.qualification === "bloque") accounts.blocked++;
    if (r.grantedUntil !== null) accounts.granted++;
    else if (r.status === "trialing") accounts.trialing++;
    else if (isPaying(r)) {
      accounts.paying++;
      const plan = r.plan as PaidPlan;
      payingByPlan[plan]++;
      mrrCents += rec.cycle === "yearly" ? Math.round(planPriceCents(plan, "yearly") / 12) : planPriceCents(plan, "monthly");
    } else if (r.plan === "free" || r.status === "canceled" || r.status === "none") accounts.free++;
    const age = now.getTime() - new Date(r.createdAt).getTime();
    if (age <= 7 * 86_400_000) last7Days++;
    if (age <= 30 * 86_400_000) last30Days++;
  }
  return {
    generatedAt: now.toISOString(),
    accounts,
    byQualification,
    byPlan,
    signups: { last7Days, last30Days },
    mrrCents,
    payingByPlan,
    referrals: { pending: referrals.pending ?? 0, qualified: referrals.qualified ?? 0, credited: referrals.credited ?? 0, refused: referrals.refused ?? 0 },
  };
}

/** Liste des comptes : recherche (nom, email du titulaire, identifiant) et filtres (qualification, plan, statut). */
export async function listAccounts(ctx: OrgContext, rawQuery: unknown = {}): Promise<AdminAccountRow[]> {
  requireOperatorCapability(ctx, "admin.accounts.read");
  const parsed = adminAccountsQuery.safeParse(rawQuery ?? {});
  if (!parsed.success) throw new AppError("validation", "Filtres invalides", 400, parsed.error.flatten());
  const q = parsed.data;
  const needle = q.q?.toLowerCase() ?? "";
  const rows = (await ctx.services.db.withGlobal((tx) => repos.adminAccounts.list(tx))).map(rowOf);
  return rows.filter((r) => {
    if (q.qualification && r.qualification !== q.qualification) return false;
    if (q.plan && r.plan !== q.plan) return false;
    if (q.status === "granted" ? r.grantedUntil === null : q.status && (r.status !== q.status || r.grantedUntil !== null)) return false;
    if (needle && ![r.name, r.ownerEmail ?? "", r.id].some((v) => v.toLowerCase().includes(needle))) return false;
    return true;
  });
}

/** Fiche d'un compte : membres, abonnement, qualification et note, accès offert, historique d'audit. */
export async function getAccount(ctx: OrgContext, orgId: string): Promise<AdminAccountDetail> {
  requireOperatorCapability(ctx, "admin.accounts.read");
  const services = ctx.services;
  const record = (await services.db.withGlobal((tx) => repos.adminAccounts.list(tx))).find((r) => r.id === orgId);
  if (!record) throw new AppError("not_found", "Compte introuvable.", 404);
  const team = await services.db.withGlobal((tx) => repos.memberships.listOrg(tx, orgId));
  const audit = await services.db.withOrg(orgId, (tx) => repos.audit.list(tx, 300));
  const events = audit.filter((a) => HISTORY_PREFIXES.some((p) => a.action.startsWith(p))).slice(0, 100);
  const emails = await services.db.withGlobal((tx) => repos.adminAccounts.userEmails(tx, [...events.map((e) => e.actorUserId ?? ""), record.qualifiedBy ?? "", record.grantedBy ?? ""]));
  const history: AdminAccountEvent[] = events.map((e) => ({ id: e.id, action: e.action, actorUserId: e.actorUserId, actorEmail: e.actorUserId ? emails.get(e.actorUserId) ?? null : null, meta: e.meta, createdAt: e.createdAt }));
  return {
    ...rowOf(record),
    slug: record.slug,
    qualificationNote: record.qualificationNote,
    qualifiedBy: record.qualifiedBy,
    qualifiedByEmail: record.qualifiedBy ? emails.get(record.qualifiedBy) ?? null : null,
    qualifiedAt: record.qualifiedAt,
    grantedBy: record.grantedBy,
    grantedByEmail: record.grantedBy ? emails.get(record.grantedBy) ?? null : null,
    cycle: record.cycle,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
    team: team.map((m) => ({ userId: m.userId, email: m.user.email, displayName: m.user.displayName, role: m.role, operatorRole: resolveOperatorRole(services.operators, m.user) })),
    history,
  };
}

// ---------------------------------------------------------------- actions (journalisées)

async function requireOrg(ctx: OrgContext, orgId: string): Promise<{ qualification: OrgQualification; qualificationNote: string | null }> {
  const q = await ctx.services.db.withGlobal((tx) => repos.adminAccounts.qualificationOf(tx, orgId));
  if (!q) throw new AppError("not_found", "Compte introuvable.", 404);
  return { qualification: isQualification(q.qualification) ? q.qualification : "client", qualificationNote: q.qualificationNote };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseInput<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Requête invalide", 400, parsed.error.flatten());
  return parsed.data;
}

/** Qualification d'un compte (et note interne si fournie). « bloque » : la session de ses membres est refusée. */
export async function qualifyAccount(ctx: OrgContext, orgId: string, raw: unknown): Promise<AdminAccountDetail> {
  requireOperatorCapability(ctx, "admin.accounts.manage");
  const input = parseInput(adminQualificationInput, raw);
  const before = await requireOrg(ctx, orgId);
  const at = ctx.services.now().toISOString();
  await ctx.services.db.withGlobal((tx) => repos.adminAccounts.setQualification(tx, orgId, { qualification: input.qualification, note: input.note, by: ctx.userId, at }));
  const afterNote = input.note === undefined ? before.qualificationNote : input.note || null;
  await ctx.services.db.withOrg(orgId, (tx) => repos.audit.add(tx, {
    actorUserId: ctx.userId, action: "admin.account_qualified", targetType: "organization", targetId: orgId, ip: ctx.ip,
    meta: { before: { qualification: before.qualification, note: before.qualificationNote }, after: { qualification: input.qualification, note: afterNote } },
  }));
  return getAccount(ctx, orgId);
}

/** Note interne d'un compte (500 caractères au plus, vide : effacée). */
export async function setAccountNote(ctx: OrgContext, orgId: string, raw: unknown): Promise<AdminAccountDetail> {
  requireOperatorCapability(ctx, "admin.accounts.manage");
  const input = parseInput(adminNoteInput, raw);
  const before = await requireOrg(ctx, orgId);
  const at = ctx.services.now().toISOString();
  await ctx.services.db.withGlobal((tx) => repos.adminAccounts.setNote(tx, orgId, { note: input.note, by: ctx.userId, at }));
  await ctx.services.db.withOrg(orgId, (tx) => repos.audit.add(tx, {
    actorUserId: ctx.userId, action: "admin.account_note_updated", targetType: "organization", targetId: orgId, ip: ctx.ip,
    meta: { before: { note: before.qualificationNote }, after: { note: input.note || null } },
  }));
  return getAccount(ctx, orgId);
}

function subscriptionSnapshot(sub: Subscription | null) {
  return sub ? { plan: sub.plan, status: sub.status, provider: sub.provider, currentPeriodEnd: sub.currentPeriodEnd, grantedUntil: sub.grantedUntil ?? null } : null;
}

/** Abonnement payé par carte en cours : un accès offert ne le remplace pas (il serait sinon perdu à l'échéance). */
function isPaidByCard(sub: Subscription | null): boolean {
  return !!sub && !sub.grantedUntil && sub.provider === "revolut" && (sub.status === "active" || sub.status === "past_due");
}

/**
 * Accès offert : plan payant (Starter, Pro, Agence) actif jusqu'à `until`, sans fournisseur de paiement ni débit.
 * Sans fin (`until: null`) seulement pour un compte qualifié « équipe ». Refusé sur un abonnement déjà payé par
 * carte. Le worker ne le débite ni ne le rétrograde jamais avant l'échéance ; à l'échéance, accès de base.
 */
export async function grantAccess(ctx: OrgContext, orgId: string, raw: unknown): Promise<AdminAccountDetail> {
  requireOperatorCapability(ctx, "admin.accounts.manage");
  const input = parseInput(adminGrantInput, raw);
  const org = await requireOrg(ctx, orgId);
  const now = ctx.services.now();
  if (input.until === null && org.qualification !== "equipe") throw new AppError("validation", "Un accès offert sans fin est réservé aux comptes qualifiés « Équipe Selio ». Choisissez une date de fin.", 400);
  const until = input.until === null ? GRANT_NO_END : new Date(input.until).toISOString();
  if (input.until !== null && new Date(until).getTime() <= now.getTime()) throw new AppError("validation", "La date de fin de l'accès offert doit être dans le futur.", 400);
  await ctx.services.db.withOrg(orgId, async (tx) => {
    const sub = await repos.subscriptions.get(tx);
    if (isPaidByCard(sub)) throw new AppError("conflict", "Ce compte paie déjà son abonnement par carte : un accès offert ne peut pas le remplacer.", 409);
    await repos.subscriptions.upsert(tx, {
      plan: input.plan, quotas: quotasForPlan(input.plan), status: "active", provider: "none", currentPeriodEnd: until,
      grantedUntil: until, grantedBy: ctx.userId, pendingPlan: null, cancelAtPeriodEnd: false, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, dataRetentionUntil: null,
    });
    await repos.audit.add(tx, {
      actorUserId: ctx.userId, action: "admin.access_granted", targetType: "subscription", targetId: orgId, ip: ctx.ip,
      meta: { before: subscriptionSnapshot(sub), after: { plan: input.plan, status: "active", grantedUntil: until, withoutEnd: isGrantWithoutEnd(until) }, planLabel: PLAN_LABELS[input.plan] },
    });
  });
  return getAccount(ctx, orgId);
}

/** Retire un accès offert tout de suite : retour à l'accès de base, comme une fin d'abonnement. */
export async function revokeAccess(ctx: OrgContext, orgId: string): Promise<AdminAccountDetail> {
  requireOperatorCapability(ctx, "admin.accounts.manage");
  await requireOrg(ctx, orgId);
  await ctx.services.db.withOrg(orgId, async (tx) => {
    const sub = await repos.subscriptions.get(tx);
    if (!sub?.grantedUntil) throw new AppError("conflict", "Ce compte n'a aucun accès offert en cours.", 409);
    await repos.subscriptions.upsert(tx, { plan: "free", quotas: quotasForPlan("free"), status: "canceled", currentPeriodEnd: ctx.services.now().toISOString(), grantedUntil: null, grantedBy: null, pendingPlan: null, cancelAtPeriodEnd: false });
    await repos.audit.add(tx, {
      actorUserId: ctx.userId, action: "admin.access_revoked", targetType: "subscription", targetId: orgId, ip: ctx.ip,
      meta: { before: subscriptionSnapshot(sub), after: { plan: "free", status: "canceled", grantedUntil: null } },
    });
  });
  return getAccount(ctx, orgId);
}

/**
 * Prolonge l'essai de N jours (1 à 90) : essai en cours → à partir de sa fin ; essai terminé (accès de base) →
 * nouvel essai à partir d'aujourd'hui. Refusé sur un abonnement payé par carte ou un accès offert.
 */
export async function extendTrial(ctx: OrgContext, orgId: string, raw: unknown): Promise<AdminAccountDetail> {
  requireOperatorCapability(ctx, "admin.accounts.manage");
  const { days } = parseInput(adminExtendTrialInput, raw);
  await requireOrg(ctx, orgId);
  const now = ctx.services.now();
  await ctx.services.db.withOrg(orgId, async (tx) => {
    const sub = await repos.subscriptions.get(tx);
    if (sub?.grantedUntil) throw new AppError("conflict", "Ce compte a un accès offert : modifiez plutôt sa date de fin.", 409);
    if (isPaidByCard(sub)) throw new AppError("conflict", "Ce compte paie déjà son abonnement : il n'y a pas d'essai à prolonger.", 409);
    const running = sub?.status === "trialing";
    const from = running && sub?.currentPeriodEnd ? new Date(Math.max(new Date(sub.currentPeriodEnd).getTime(), now.getTime())) : now;
    const end = new Date(from.getTime() + days * 86_400_000).toISOString();
    const plan = running && sub ? sub.plan : TRIAL_PLAN;
    await repos.subscriptions.upsert(tx, { plan, quotas: quotasForPlan(plan), status: "trialing", currentPeriodEnd: end, cancelAtPeriodEnd: false, dataRetentionUntil: null, chargeAttempts: 0, nextChargeAt: null });
    await repos.audit.add(tx, {
      actorUserId: ctx.userId, action: "admin.trial_extended", targetType: "subscription", targetId: orgId, ip: ctx.ip,
      meta: { days, restarted: !running, before: subscriptionSnapshot(sub), after: { plan, status: "trialing", currentPeriodEnd: end } },
    });
  });
  return getAccount(ctx, orgId);
}

