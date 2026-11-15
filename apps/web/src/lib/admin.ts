import { isGrantWithoutEnd, type OperatorRole, type OrgQualification } from "@selio/contracts";
import { operatorCan, type OperatorCapability } from "@selio/domain";
import type { Session } from "./data/types";
import { APP_PATH_PATTERN, HUB_PATH } from "../app/spaces/paths";

/**
 * Selio Admin côté web : sections de la barre latérale selon le rôle d'opérateur (même matrice que l'API,
 * `operatorCan` de @selio/domain), page d'arrivée après connexion, libellés.
 */

export const ADMIN_HOME = "/admin";

export interface AdminSection {
  to: string;
  label: string;
  /** Droit de la matrice nécessaire pour voir la section. */
  capability: OperatorCapability;
  end?: boolean;
  /** Groupe de la barre latérale. */
  group: "pilotage" | "technique";
}

/** Sections de Selio Admin, dans l'ordre de la barre latérale. */
export const ADMIN_SECTIONS: AdminSection[] = [
  { to: "/admin", label: "Tableau de bord", capability: "admin.growth", end: true, group: "pilotage" },
  { to: "/admin/comptes", label: "Comptes", capability: "admin.accounts.read", group: "pilotage" },
  { to: "/admin/offres", label: "Offres", capability: "admin.offers", group: "pilotage" },
  { to: "/admin/track", label: "Track", capability: "admin.track.read", group: "pilotage" },
  { to: "/admin/acces", label: "Accès de l'équipe", capability: "admin.accounts.read", group: "pilotage" },
  { to: "/admin/sante", label: "Santé et plans", capability: "admin.health", group: "technique" },
  { to: "/admin/supervision", label: "Supervision", capability: "admin.supervision", group: "technique" },
];

/** Rôle d'opérateur de la session : `operatorRole`, sinon « tech » pour un ancien `isOperator`. */
export function operatorRoleOfSession(session: Pick<Session, "user"> | null | undefined): OperatorRole | null {
  if (!session) return null;
  if (session.user.operatorRole !== undefined) return session.user.operatorRole;
  return session.user.isOperator ? "tech" : null;
}

export function adminSectionsFor(role: OperatorRole | null): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => operatorCan(role, s.capability));
}

/** Adresses de l'administration autorisées comme retour après connexion. */
export const ADMIN_PATH_PATTERN = /^\/admin(\/[a-z0-9-]+)*$/;

/**
 * Page d'arrivée après connexion : la page demandée si elle est autorisée ; sinon Selio Admin pour un opérateur
 * en mode connecté, l'accueil des espaces pour un client (et pour la démonstration, vitrine de l'espace client).
 */
export function landingPath(session: Pick<Session, "user" | "mode">, from?: string | null): string {
  const operator = operatorRoleOfSession(session) !== null;
  if (from && (APP_PATH_PATTERN.test(from) || (operator && ADMIN_PATH_PATTERN.test(from)))) return from;
  return operator && session.mode === "connected" ? ADMIN_HOME : HUB_PATH;
}

export const QUALIFICATION_TONES: Record<OrgQualification, "neutral" | "success" | "warning" | "danger" | "accent" | "ink" | "muted"> = {
  client: "neutral",
  beta: "accent",
  partenaire: "success",
  equipe: "ink",
  test: "muted",
  bloque: "danger",
};

/** Libellés de l'historique d'une fiche compte (le code brut reste en info-bulle). */
export const ADMIN_ACTION_LABELS: Record<string, string> = {
  "admin.account_qualified": "Qualification modifiée",
  "admin.account_note_updated": "Note interne modifiée",
  "admin.access_granted": "Accès offert",
  "admin.access_revoked": "Accès offert retiré",
  "admin.trial_extended": "Essai prolongé",
  "admin.plan_changed": "Plan changé par l'équipe",
  "billing.grant_ended": "Fin de l'accès offert",
  "billing.trial_ended": "Fin de l'essai",
  "billing.payment_completed": "Paiement encaissé",
  "billing.payment_failed": "Paiement refusé",
  "billing.subscription_ended": "Abonnement terminé",
  "billing.cancel_requested": "Résiliation demandée",
  "auth.register": "Inscription",
};

export function adminActionLabel(action: string): string {
  return ADMIN_ACTION_LABELS[action] ?? action;
}

/** « sans fin » pour un accès offert à l'équipe ; sinon la date. */
export function grantEndLabel(until: string | null, format: (iso: string) => string): string {
  if (!until) return "—";
  return isGrantWithoutEnd(until) ? "sans fin" : format(until);
}
