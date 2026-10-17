import type { Role } from "@selio/contracts";

export type Action =
  | "org.read" | "org.update" | "org.delete" | "members.manage" | "billing.manage"
  | "items.read" | "items.write" | "items.delete"
  | "customers.read" | "customers.write"
  | "conversations.read" | "messages.draft" | "messages.send"
  | "orders.read" | "orders.write"
  | "analytics.read" | "analytics.export"
  | "automations.read" | "automations.write"
  | "radar.read" | "radar.write" | "purchase.simulate" | "purchase.execute"
  | "connections.read" | "connections.manage"
  | "ai.use" | "ai.configure"
  | "tokens.manage" | "data.export" | "data.delete";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

const MIN_ROLE: Record<Action, Role> = {
  "org.read": "viewer", "org.update": "admin", "org.delete": "owner", "members.manage": "admin", "billing.manage": "owner",
  "items.read": "viewer", "items.write": "operator", "items.delete": "admin",
  "customers.read": "viewer", "customers.write": "operator",
  "conversations.read": "viewer", "messages.draft": "operator", "messages.send": "operator",
  "orders.read": "viewer", "orders.write": "operator",
  "analytics.read": "viewer", "analytics.export": "operator",
  "automations.read": "viewer", "automations.write": "admin",
  "radar.read": "viewer", "radar.write": "operator", "purchase.simulate": "operator", "purchase.execute": "owner",
  "connections.read": "viewer", "connections.manage": "admin",
  "ai.use": "operator", "ai.configure": "admin",
  "tokens.manage": "operator", "data.export": "admin", "data.delete": "owner",
};

export function can(role: Role, action: Action): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[action]];
}

export function minimumRole(action: Action): Role {
  return MIN_ROLE[action];
}

/** Toutes les actions contrôlées, dans l'ordre de la table ci-dessus. */
export const ACTIONS = Object.keys(MIN_ROLE) as Action[];

/** Rôles du plus large au plus restreint (ordre d'affichage). */
export const ROLES_BY_RANK: Role[] = (Object.keys(ROLE_RANK) as Role[]).sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);

/**
 * Libellés français des actions (matrice « qui peut faire quoi » de Paramètres › Comptes et accès).
 * Partiel à dessein : une action ajoutée sans libellé reste affichée (sous son code) et un test le signale.
 */
export const ACTION_LABELS: Partial<Record<Action, string>> = {
  "org.read": "Consulter l'organisation et ses réglages",
  "org.update": "Modifier les réglages (organisation, négociation et marges, achat auto)",
  "org.delete": "Supprimer l'organisation",
  "members.manage": "Inviter, retirer et changer le rôle des membres",
  "billing.manage": "Gérer l'abonnement et le paiement",
  "items.read": "Voir les articles et le stock",
  "items.write": "Créer, modifier et importer des articles",
  "items.delete": "Supprimer des articles",
  "customers.read": "Voir les fiches clients",
  "customers.write": "Modifier et fusionner des fiches clients",
  "conversations.read": "Lire les conversations",
  "messages.draft": "Rédiger des brouillons de réponse",
  "messages.send": "Envoyer des messages aux acheteurs",
  "orders.read": "Voir les commandes",
  "orders.write": "Créer des commandes, suivre les expéditions",
  "analytics.read": "Consulter les analyses",
  "analytics.export": "Exporter les analyses en CSV",
  "automations.read": "Voir les automatisations et leurs tâches",
  "automations.write": "Créer, modifier et mettre en pause les automatisations",
  "radar.read": "Voir les bonnes affaires du radar",
  "radar.write": "Créer des recherches et trier les affaires",
  "purchase.simulate": "Préparer et simuler un achat",
  "purchase.execute": "Confirmer un achat réel",
  "connections.read": "Voir les comptes connectés",
  "connections.manage": "Connecter, tester et retirer des comptes",
  "ai.use": "Utiliser l'IA (réponses, générateur d'annonces)",
  "ai.configure": "Régler l'assistant IA (ton, quota, validation)",
  "tokens.manage": "Créer et révoquer des jetons d'extension",
  "data.export": "Exporter toutes les données",
  "data.delete": "Supprimer définitivement des données",
};

/** Regroupement des actions pour l'affichage. Une action absente tombe dans « Autres actions ». */
export const PERMISSION_GROUPS: { title: string; actions: Action[] }[] = [
  { title: "Vendre", actions: ["items.read", "items.write", "items.delete", "conversations.read", "messages.draft", "messages.send", "orders.read", "orders.write", "customers.read", "customers.write"] },
  { title: "Acheter", actions: ["radar.read", "radar.write", "purchase.simulate", "purchase.execute"] },
  { title: "Piloter", actions: ["analytics.read", "analytics.export", "automations.read", "automations.write", "ai.use", "ai.configure"] },
  { title: "Comptes et extension", actions: ["connections.read", "connections.manage", "tokens.manage"] },
  { title: "Organisation et données", actions: ["org.read", "org.update", "members.manage", "billing.manage", "data.export", "data.delete", "org.delete"] },
];

/** Actions débloquées exactement à ce rôle (celles que le rôle juste en dessous n'a pas). */
export function actionsUnlockedAt(role: Role): Action[] {
  return ACTIONS.filter((a) => MIN_ROLE[a] === role);
}
