import {
  GRANT_NO_END, ORG_QUALIFICATIONS, PAID_PLANS, PLANS, PLAN_LABELS, TRIAL_PLAN, TRIAL_EXTENSION_MAX_DAYS,
  adminExtendTrialInput, adminGrantInput, adminNoteInput, adminQualificationInput, isGrantWithoutEnd,
  type AdminAccountDetail, type AdminAccountEvent, type AdminAccountMember, type AdminAccountRow, type AdminAccountsQuery, type AdminGrowth,
  type OrgQualification, type PaidPlan, type Plan, type SubscriptionStatus,
} from "@selio/contracts";
import { newId } from "@selio/domain";
import { DataError } from "../data/types";
import { planPriceCents } from "../billing";

/**
 * Selio Admin en démonstration : comptes d'exemple (signalés « exemple », fictifs) à côté de celui de la démo,
 * mêmes règles que le serveur (packages/core/src/services/admin-accounts.ts) pour la qualification, l'accès
 * offert et la prolongation d'essai. Rien ne quitte le navigateur.
 */

/** Compte tel que la démonstration le garde : organisation, abonnement, membres et historique. */
export interface DemoAccountRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  qualification: OrgQualification;
  qualificationNote: string | null;
  qualifiedBy: string | null;
  qualifiedAt: string | null;
  plan: Plan;
  status: SubscriptionStatus;
  provider: string;
  cycle: string;
  currentPeriodEnd: string | null;
  cardOnFile: boolean;
  cancelAtPeriodEnd: boolean;
  grantedUntil: string | null;
  grantedBy: string | null;
  team: AdminAccountMember[];
  history: AdminAccountEvent[];
}

/** Qualification du compte de la démo (son abonnement reste celui de la démonstration). */
export interface DemoOwnQualification {
  qualification: OrgQualification;
  qualificationNote: string | null;
  qualifiedBy: string | null;
  qualifiedAt: string | null;
  grantedBy: string | null;
}

export interface DemoAdminState {
  own: DemoOwnQualification;
  accounts: DemoAccountRecord[];
}

const DAY = 86_400_000;

/** Comptes d'exemple, dates relatives à l'horloge de la démo. Les trois premiers sont ceux de « Utilisation par client ». */
export function seedDemoAdmin(now: Date, operatorId: string): DemoAdminState {
  const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
  const member = (email: string, displayName: string): AdminAccountMember => ({ userId: `u-${email}`, email, displayName, role: "owner", operatorRole: null });
  const base = (id: string, name: string, createdDaysAgo: number, owner: AdminAccountMember): DemoAccountRecord => ({
    id, name, slug: id, createdAt: at(-createdDaysAgo), qualification: "client", qualificationNote: null, qualifiedBy: null, qualifiedAt: null,
    plan: "free", status: "canceled", provider: "none", cycle: "monthly", currentPeriodEnd: null, cardOnFile: false, cancelAtPeriodEnd: false, grantedUntil: null, grantedBy: null,
    team: [owner],
    history: [{ id: newId(), action: "auth.register", actorUserId: owner.userId, actorEmail: owner.email, meta: { trialDays: 14 }, createdAt: at(-createdDaysAgo) }],
  });
  const accounts: DemoAccountRecord[] = [
    { ...base("org-exemple-starter", "Friperie du Cours (exemple)", 64, member("lea@friperie-du-cours.exemple", "Léa")), plan: "starter", status: "active", provider: "revolut", currentPeriodEnd: at(12), cardOnFile: true },
    { ...base("org-exemple-pro", "Atelier Lune (exemple)", 120, member("hugo@atelier-lune.exemple", "Hugo")), qualification: "beta", qualifiedBy: operatorId, qualifiedAt: at(-90), qualificationNote: "Bêta-testeur depuis le début : retours sur Studio.", plan: "pro", status: "past_due", provider: "revolut", currentPeriodEnd: at(-2), cardOnFile: true },
    { ...base("org-exemple-agence", "Dressing Nomade (exemple)", 31, member("sarah@dressing-nomade.exemple", "Sarah")), qualification: "partenaire", qualifiedBy: operatorId, qualifiedAt: at(-30), qualificationNote: "Partenariat de contenu (exemple fictif).", plan: "agence", status: "active", provider: "none", currentPeriodEnd: at(60), grantedUntil: at(60), grantedBy: operatorId },
    { ...base("org-exemple-essai", "Vintage Sœurs (exemple)", 9, member("ines@vintage-soeurs.exemple", "Inès")), plan: TRIAL_PLAN, status: "trialing", currentPeriodEnd: at(5) },
    { ...base("org-exemple-test", "Boutique de test (exemple)", 3, member("qa@selio-test.exemple", "Recette")), qualification: "test", qualifiedBy: operatorId, qualifiedAt: at(-3) },
    { ...base("org-exemple-bloque", "Revente Express (exemple)", 45, member("contact@revente-express.exemple", "Revente Express")), qualification: "bloque", qualifiedBy: operatorId, qualifiedAt: at(-10), qualificationNote: "Signalements répétés (exemple fictif)." },
  ];
  return { own: { qualification: "client", qualificationNote: null, qualifiedBy: null, qualifiedAt: null, grantedBy: null }, accounts };
}

export function accountRow(r: DemoAccountRecord): AdminAccountRow {
  return {
    id: r.id, name: r.name, createdAt: r.createdAt, qualification: r.qualification, plan: r.plan, status: r.status, provider: r.provider,
    currentPeriodEnd: r.currentPeriodEnd, grantedUntil: r.grantedUntil, cardOnFile: r.cardOnFile, members: r.team.length,
    ownerEmail: r.team.find((m) => m.role === "owner")?.email ?? null,
  };
}

export function accountDetail(r: DemoAccountRecord, emailOf: (id: string | null) => string | null): AdminAccountDetail {
  return {
    ...accountRow(r), slug: r.slug, qualificationNote: r.qualificationNote, qualifiedBy: r.qualifiedBy, qualifiedByEmail: emailOf(r.qualifiedBy), qualifiedAt: r.qualifiedAt,
    grantedBy: r.grantedBy, grantedByEmail: emailOf(r.grantedBy), cycle: r.cycle, cancelAtPeriodEnd: r.cancelAtPeriodEnd, team: r.team, history: r.history,
  };
}

/** Même filtre que le serveur : qualification, plan, statut (« granted » : accès offerts), recherche nom / email / identifiant. */
export function filterAccounts(rows: AdminAccountRow[], query: AdminAccountsQuery = {}): AdminAccountRow[] {
  const needle = query.q?.trim().toLowerCase() ?? "";
  return rows.filter((r) => {
    if (query.qualification && r.qualification !== query.qualification) return false;
    if (query.plan && r.plan !== query.plan) return false;
    if (query.status === "granted" ? r.grantedUntil === null : query.status && (r.status !== query.status || r.grantedUntil !== null)) return false;
    if (needle && ![r.name, r.ownerEmail ?? "", r.id].some((v) => v.toLowerCase().includes(needle))) return false;
    return true;
  });
}

/** Tableau de croissance calculé comme le serveur (revenu mensuel : abonnements payés par carte, annuel ramené au mois). */
export function growthOf(records: DemoAccountRecord[], now: Date, referrals: AdminGrowth["referrals"]): AdminGrowth {
  const byQualification = Object.fromEntries(ORG_QUALIFICATIONS.map((q) => [q, 0])) as Record<OrgQualification, number>;
  const byPlan = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<Plan, number>;
  const payingByPlan = Object.fromEntries(PAID_PLANS.map((p) => [p, 0])) as Record<PaidPlan, number>;
  const accounts = { total: records.length, trialing: 0, paying: 0, granted: 0, free: 0, blocked: 0 };
  let mrrCents = 0, last7Days = 0, last30Days = 0;
  for (const r of records) {
    byQualification[r.qualification]++;
    byPlan[r.plan]++;
    if (r.qualification === "bloque") accounts.blocked++;
    if (r.grantedUntil !== null) accounts.granted++;
    else if (r.status === "trialing") accounts.trialing++;
    else if (r.provider === "revolut" && (r.status === "active" || r.status === "past_due") && (PAID_PLANS as readonly string[]).includes(r.plan)) {
      accounts.paying++;
      const plan = r.plan as PaidPlan;
      payingByPlan[plan]++;
      mrrCents += r.cycle === "yearly" ? Math.round(planPriceCents(plan, "yearly") / 12) : planPriceCents(plan, "monthly");
    } else if (r.plan === "free" || r.status === "canceled" || r.status === "none") accounts.free++;
    const age = now.getTime() - new Date(r.createdAt).getTime();
    if (age <= 7 * DAY) last7Days++;
    if (age <= 30 * DAY) last30Days++;
  }
  return { generatedAt: now.toISOString(), accounts, byQualification, byPlan, signups: { last7Days, last30Days }, mrrCents, payingByPlan, referrals };
}

// ---------------------------------------------------------------- actions (mêmes règles que le serveur)

export interface DemoAdminAction {
  action: string;
  meta: Record<string, unknown>;
}

function invalid(message: string): DataError {
  return new DataError("validation", message, 400);
}

const snapshot = (r: DemoAccountRecord) => ({ plan: r.plan, status: r.status, provider: r.provider, currentPeriodEnd: r.currentPeriodEnd, grantedUntil: r.grantedUntil });
const paidByCard = (r: DemoAccountRecord) => r.grantedUntil === null && r.provider === "revolut" && (r.status === "active" || r.status === "past_due");

export function qualifyRecord(r: DemoAccountRecord, raw: unknown, actorId: string, now: Date): DemoAdminAction {
  const parsed = adminQualificationInput.safeParse(raw ?? {});
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Qualification invalide");
  const before = { qualification: r.qualification, note: r.qualificationNote };
  r.qualification = parsed.data.qualification;
  if (parsed.data.note !== undefined) r.qualificationNote = parsed.data.note || null;
  r.qualifiedBy = actorId;
  r.qualifiedAt = now.toISOString();
  return { action: "admin.account_qualified", meta: { before, after: { qualification: r.qualification, note: r.qualificationNote } } };
}

export function noteRecord(r: DemoAccountRecord, raw: unknown, actorId: string, now: Date): DemoAdminAction {
  const parsed = adminNoteInput.safeParse(raw ?? {});
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Note invalide");
  const before = { note: r.qualificationNote };
  r.qualificationNote = parsed.data.note || null;
  r.qualifiedBy = actorId;
  r.qualifiedAt = now.toISOString();
  return { action: "admin.account_note_updated", meta: { before, after: { note: r.qualificationNote } } };
}

export function grantRecord(r: DemoAccountRecord, raw: unknown, actorId: string, now: Date): DemoAdminAction {
  const parsed = adminGrantInput.safeParse(raw ?? {});
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Accès offert invalide");
  const input = parsed.data;
  if (input.until === null && r.qualification !== "equipe") throw invalid("Un accès offert sans fin est réservé aux comptes qualifiés « Équipe Selio ». Choisissez une date de fin.");
  const until = input.until === null ? GRANT_NO_END : new Date(input.until).toISOString();
  if (input.until !== null && new Date(until).getTime() <= now.getTime()) throw invalid("La date de fin de l'accès offert doit être dans le futur.");
  if (paidByCard(r)) throw new DataError("conflict", "Ce compte paie déjà son abonnement par carte : un accès offert ne peut pas le remplacer.", 409);
  const before = snapshot(r);
  Object.assign(r, { plan: input.plan, status: "active", provider: "none", currentPeriodEnd: until, grantedUntil: until, grantedBy: actorId, cancelAtPeriodEnd: false });
  return { action: "admin.access_granted", meta: { before, after: { plan: input.plan, status: "active", grantedUntil: until, withoutEnd: isGrantWithoutEnd(until) }, planLabel: PLAN_LABELS[input.plan] } };
}

export function revokeRecord(r: DemoAccountRecord, now: Date): DemoAdminAction {
  if (!r.grantedUntil) throw new DataError("conflict", "Ce compte n'a aucun accès offert en cours.", 409);
  const before = snapshot(r);
  Object.assign(r, { plan: "free", status: "canceled", currentPeriodEnd: now.toISOString(), grantedUntil: null, grantedBy: null, cancelAtPeriodEnd: false });
  return { action: "admin.access_revoked", meta: { before, after: { plan: "free", status: "canceled", grantedUntil: null } } };
}

export function extendTrialRecord(r: DemoAccountRecord, days: number, now: Date): DemoAdminAction {
  const parsed = adminExtendTrialInput.safeParse({ days });
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? `De 1 à ${TRIAL_EXTENSION_MAX_DAYS} jours.`);
  if (r.grantedUntil) throw new DataError("conflict", "Ce compte a un accès offert : modifiez plutôt sa date de fin.", 409);
  if (paidByCard(r)) throw new DataError("conflict", "Ce compte paie déjà son abonnement : il n'y a pas d'essai à prolonger.", 409);
  const before = snapshot(r);
  const running = r.status === "trialing";
  const from = running && r.currentPeriodEnd ? Math.max(new Date(r.currentPeriodEnd).getTime(), now.getTime()) : now.getTime();
  const end = new Date(from + parsed.data.days * DAY).toISOString();
  const plan = running ? r.plan : TRIAL_PLAN;
  Object.assign(r, { plan, status: "trialing", currentPeriodEnd: end, cancelAtPeriodEnd: false });
  return { action: "admin.trial_extended", meta: { days: parsed.data.days, restarted: !running, before, after: { plan, status: "trialing", currentPeriodEnd: end } } };
}
