import { z } from "zod";
import { isoDate } from "./common";
import { paidPlan, type OperatorRole, type PaidPlan, type Plan, type SubscriptionStatus } from "./org";
import type { Role } from "./common";

/**
 * Selio Admin (back-office des fondateurs) : qualification des comptes, accès offert, prolongation
 * d'essai et tableau de croissance. Partagé par l'API, le worker et l'application web.
 */

/**
 * Qualification d'un compte (organisation), fixée par un opérateur : client (défaut), bêta-testeur,
 * partenaire, équipe Selio, compte de test, ou bloqué (la session de ses membres est refusée).
 */
export const ORG_QUALIFICATIONS = ["client", "beta", "partenaire", "equipe", "test", "bloque"] as const;
export const orgQualification = z.enum(ORG_QUALIFICATIONS);
export type OrgQualification = z.infer<typeof orgQualification>;

export const ORG_QUALIFICATION_LABELS: Record<OrgQualification, string> = {
  client: "Client",
  beta: "Bêta",
  partenaire: "Partenaire",
  equipe: "Équipe Selio",
  test: "Test",
  bloque: "Bloqué",
};

export const OPERATOR_ROLE_LABELS: Record<OperatorRole, string> = {
  tech: "Technique",
  business: "Business",
};

/** Note interne d'un compte (jamais montrée au client). */
export const QUALIFICATION_NOTE_MAX = 500;
/** Prolongation d'essai : de 1 à 90 jours. */
export const TRIAL_EXTENSION_MAX_DAYS = 90;
/**
 * Fin d'un accès offert « sans fin » (équipe Selio) : une date lointaine plutôt que `infinity`, lisible
 * telle quelle par l'API, le worker et le web.
 */
export const GRANT_NO_END = "9999-12-31T00:00:00.000Z";

/** Vrai si la date de fin d'accès offert vaut « sans fin ». */
export function isGrantWithoutEnd(until: string | null | undefined): boolean {
  return typeof until === "string" && until.startsWith("9999-");
}

/** Message affiché à un membre d'un compte bloqué (sa session est refusée, sauf pour un opérateur). */
export const ACCOUNT_BLOCKED_MESSAGE = "Ce compte Selio est suspendu par l'équipe Selio. Écrivez au support pour en savoir plus.";

const note = z.string().trim().max(QUALIFICATION_NOTE_MAX, `La note fait ${QUALIFICATION_NOTE_MAX} caractères au plus.`);

/** Qualification d'un compte, avec la note interne facultative (absente : inchangée ; vide : effacée). */
export const adminQualificationInput = z.object({
  qualification: orgQualification,
  note: note.optional(),
});
export type AdminQualificationInput = z.infer<typeof adminQualificationInput>;

export const adminNoteInput = z.object({ note });
export type AdminNoteInput = z.infer<typeof adminNoteInput>;

/**
 * Accès offert : un plan payant jusqu'à une date (`until`), ou sans fin (`until: null`) pour un compte
 * qualifié « équipe ». Abonnement actif, aucun débit, retour à l'accès de base à l'échéance.
 */
export const adminGrantInput = z.object({
  plan: paidPlan,
  until: isoDate.nullable(),
});
export type AdminGrantInput = z.infer<typeof adminGrantInput>;

export const adminExtendTrialInput = z.object({
  days: z.number().int().min(1, "Un jour au moins.").max(TRIAL_EXTENSION_MAX_DAYS, `${TRIAL_EXTENSION_MAX_DAYS} jours au plus.`),
});
export type AdminExtendTrialInput = z.infer<typeof adminExtendTrialInput>;

/**
 * Selio Admin › fiche d'un compte : « Ajouter cette personne à mon organisation » (rôle au choix, jamais
 * titulaire). La personne garde son propre compte et sa propre organisation ; elle retrouve la vôtre dans le
 * sélecteur d'organisation, sans nouveau mot de passe.
 */
export const adminAddToMyOrgInput = z.object({
  userId: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "operator", "photographer", "viewer"]),
});
export type AdminAddToMyOrgInput = z.infer<typeof adminAddToMyOrgInput>;

/** Filtres de la liste des comptes. */
export const adminAccountsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  qualification: orgQualification.optional(),
  plan: z.enum(["free", "starter", "pro", "agence"]).optional(),
  status: z.enum(["none", "trialing", "active", "past_due", "canceled", "incomplete", "granted"]).optional(),
});
export type AdminAccountsQuery = z.infer<typeof adminAccountsQuery>;

/** Ligne de la liste des comptes (Selio Admin › Comptes). Aucun secret, aucune donnée métier. */
export interface AdminAccountRow {
  id: string;
  name: string;
  createdAt: string;
  qualification: OrgQualification;
  plan: Plan;
  status: SubscriptionStatus;
  provider: string;
  /** Fin de l'essai ou de la période en cours. */
  currentPeriodEnd: string | null;
  /** Accès offert en cours (null : aucun). */
  grantedUntil: string | null;
  cardOnFile: boolean;
  members: number;
  /** Email du titulaire (premier propriétaire). */
  ownerEmail: string | null;
  /** Essai terminé alors que le paiement n'était pas encore activé (paiement simulé) : depuis cette date. */
  awaitingPaymentSince?: string | null;
}

export interface AdminAccountMember {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  /** Rôle d'opérateur Selio du membre selon la configuration (null : aucun). */
  operatorRole: OperatorRole | null;
}

/** Entrée de l'historique d'une fiche compte (journal d'audit de l'organisation). */
export interface AdminAccountEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAccountDetail extends AdminAccountRow {
  slug: string;
  qualificationNote: string | null;
  qualifiedBy: string | null;
  qualifiedByEmail: string | null;
  qualifiedAt: string | null;
  grantedBy: string | null;
  grantedByEmail: string | null;
  cycle: string;
  cancelAtPeriodEnd: boolean;
  /** Membres du compte (email, rôle dans l'organisation). */
  team: AdminAccountMember[];
  history: AdminAccountEvent[];
}

/** Tableau de croissance (Selio Admin › Tableau de bord) : chiffres réels de la base. */
export interface AdminGrowth {
  generatedAt: string;
  accounts: {
    total: number;
    trialing: number;
    /** Abonnements payants actifs ou en relance (Revolut), hors accès offerts. */
    paying: number;
    granted: number;
    free: number;
    blocked: number;
  };
  byQualification: Record<OrgQualification, number>;
  byPlan: Record<Plan, number>;
  signups: { last7Days: number; last30Days: number };
  /** Revenu mensuel estimé (centimes TTC) : abonnements payants actifs × prix du plan (annuel ramené au mois). */
  mrrCents: number;
  payingByPlan: Record<PaidPlan, number>;
  referrals: { pending: number; qualified: number; credited: number; refused: number };
}
