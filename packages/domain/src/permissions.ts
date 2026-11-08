import { ROLES, type Role } from "@selio/contracts";

export type Action =
  | "org.read" | "org.update" | "org.delete" | "members.manage" | "billing.manage" | "finances.read"
  | "items.read" | "items.write" | "items.photos.write" | "items.delete"
  | "studio.generate"
  | "customers.read" | "customers.write"
  | "conversations.read" | "messages.draft" | "messages.send"
  | "orders.read" | "orders.write"
  | "analytics.read" | "analytics.export"
  | "automations.read" | "automations.write"
  | "radar.read" | "radar.write" | "purchase.simulate" | "purchase.execute"
  | "connections.read" | "connections.manage"
  | "cloud.read" | "cloud.manage"
  | "ai.use" | "ai.configure"
  | "tokens.manage" | "data.export" | "data.delete";

/**
 * Rang d'affichage et d'attribution (du plus restreint au plus large). Le contributeur photos est placé
 * entre la lecture seule et l'exécuteur, mais c'est un rôle « latéral » : il n'a pas tout ce qu'a la
 * lecture seule (ni messages, ni commandes, ni finances), et l'exécuteur n'a pas les finances que voit la
 * lecture seule. Le rang ne donne donc AUCUN droit : seuls comptent les rôles listés dans ALLOWED.
 */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, photographer: 1, operator: 2, admin: 3, owner: 4 };

const ALL: readonly Role[] = ["owner", "admin", "operator", "photographer", "viewer"];
const OWNER: readonly Role[] = ["owner"];
const ADMIN: readonly Role[] = ["owner", "admin"];
/** Titulaire, administrateur, exécuteur : le travail du quotidien (publier, répondre, expédier). */
const TEAM: readonly Role[] = ["owner", "admin", "operator"];
/** Tout le monde sauf le contributeur photos (lecture des messages, commandes, analyses, radar…). */
const READERS: readonly Role[] = ["owner", "admin", "operator", "viewer"];
/** Finances : titulaire, administrateur et lecture seule (le comptable) ; jamais l'exécuteur ni le contributeur photos. */
const FINANCE: readonly Role[] = ["owner", "admin", "viewer"];
/** Photos et générateur : l'exécuteur et le contributeur photos (et au-dessus). */
const PHOTOS: readonly Role[] = ["owner", "admin", "operator", "photographer"];

/**
 * Matrice explicite « action → rôles autorisés » (§5.15). Une matrice « rôle minimal » ne suffit plus
 * depuis les rôles latéraux (exécuteur sans finances, contributeur photos). Chaque action est testée
 * pour chaque rôle (permissions.test.ts).
 *
 * Les restrictions sont APPLICATIVES : la RLS de PostgreSQL isole les organisations entre elles, pas les
 * rôles à l'intérieur d'une organisation (voir migration 0016). Les champs financiers d'une réponse
 * (prix d'achat, marges, chiffre d'affaires) sont masqués par `redactForRole` (@selio/core) pour qui n'a
 * pas « finances.read ».
 */
const ALLOWED: Record<Action, readonly Role[]> = {
  "org.read": READERS,
  "org.update": ADMIN,
  "org.delete": OWNER,
  "members.manage": ADMIN,
  "billing.manage": OWNER,
  "finances.read": FINANCE,
  "items.read": ALL,
  "items.write": TEAM,
  "items.photos.write": PHOTOS,
  "items.delete": ADMIN,
  "studio.generate": PHOTOS,
  "customers.read": READERS,
  "customers.write": TEAM,
  "conversations.read": READERS,
  "messages.draft": TEAM,
  "messages.send": TEAM,
  "orders.read": READERS,
  "orders.write": TEAM,
  "analytics.read": READERS,
  // L'export (articles avec prix d'achat, analyses) contient des finances : plus l'exécuteur.
  "analytics.export": ADMIN,
  "automations.read": READERS,
  "automations.write": ADMIN,
  "radar.read": READERS,
  "radar.write": TEAM,
  "purchase.simulate": TEAM,
  "purchase.execute": OWNER,
  "connections.read": READERS,
  "connections.manage": ADMIN,
  "cloud.read": READERS,
  "cloud.manage": ADMIN,
  "ai.use": TEAM,
  "ai.configure": ADMIN,
  "tokens.manage": TEAM,
  "data.export": ADMIN,
  "data.delete": OWNER,
};

export function can(role: Role, action: Action): boolean {
  const allowed = ALLOWED[action];
  return allowed !== undefined && allowed.includes(role);
}

/** Rôles autorisés pour une action, du plus large au plus restreint. */
export function rolesAllowed(action: Action): Role[] {
  return ROLES_BY_RANK.filter((r) => can(r, action));
}

/**
 * Rôle le plus restreint (au sens du rang) qui peut faire l'action. Avec les rôles latéraux, ce n'est plus
 * une garantie que tous les rôles au-dessus le peuvent : utiliser `can` ou `rolesAllowed` pour décider.
 */
export function minimumRole(action: Action): Role {
  const allowed = rolesAllowed(action);
  return allowed[allowed.length - 1] ?? "owner";
}

/** Toutes les actions contrôlées, dans l'ordre de la table ci-dessus. */
export const ACTIONS = Object.keys(ALLOWED) as Action[];

/** Rôles du plus large au plus restreint (ordre d'affichage). */
export const ROLES_BY_RANK: Role[] = [...ROLES].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);

/** Actions permises à un rôle, dans l'ordre de ACTIONS. */
export function actionsOf(role: Role): Action[] {
  return ACTIONS.filter((a) => can(role, a));
}

/** Vrai si `role` peut faire tout ce que fait `other` (et éventuellement plus). */
export function includesRole(role: Role, other: Role): boolean {
  return ACTIONS.every((a) => !can(other, a) || can(role, a));
}

/**
 * Rôle « de base » d'un rôle, pour l'affichage « Tout ce que fait X, et : … » : le rôle de rang inférieur
 * le plus large dont toutes les actions sont comprises. Null quand aucun ne l'est (lecture seule,
 * contributeur photos : rôle latéral qui n'a pas tout ce qu'a la lecture seule).
 * Aujourd'hui : titulaire ← administrateur ← exécuteur ← contributeur photos ; lecture seule à part.
 */
export function baseRoleOf(role: Role): Role | null {
  return ROLES_BY_RANK.find((r) => ROLE_RANK[r] < ROLE_RANK[role] && includesRole(role, r)) ?? null;
}

/**
 * Actions débloquées à ce rôle par rapport à son rôle de base (`baseRoleOf`) : toutes ses actions quand il
 * n'en a pas. La réunion « rôle de base + actions débloquées » redonne exactement `actionsOf(role)`.
 */
export function actionsUnlockedAt(role: Role): Action[] {
  const base = baseRoleOf(role);
  return actionsOf(role).filter((a) => base === null || !can(base, a));
}

/** Actions qu'un rôle n'a pas alors que son rôle de rang inférieur les a (ex. l'exécuteur et les finances). */
export function actionsWithheldFrom(role: Role): Action[] {
  const lower = ROLES_BY_RANK.filter((r) => ROLE_RANK[r] < ROLE_RANK[role]);
  return ACTIONS.filter((a) => !can(role, a) && lower.some((r) => can(r, a)));
}

/**
 * Qui peut attribuer quel rôle (invitation, changement de rôle) : le titulaire attribue tous les rôles ;
 * un administrateur tous sauf titulaire ; les autres aucun (« members.manage »).
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!can(actor, "members.manage")) return false;
  return target !== "owner" || actor === "owner";
}

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
  "finances.read": "Voir les finances : chiffre d'affaires, marges, prix d'achat, factures et abonnement",
  "items.read": "Voir les articles et le stock",
  "items.write": "Créer, modifier, publier et importer des articles",
  "items.photos.write": "Ajouter des photos aux articles",
  "items.delete": "Supprimer des articles",
  "studio.generate": "Lancer le générateur d'annonces et enregistrer un brouillon",
  "customers.read": "Voir les fiches clients",
  "customers.write": "Modifier et fusionner des fiches clients",
  "conversations.read": "Lire les conversations",
  "messages.draft": "Rédiger des brouillons de réponse",
  "messages.send": "Envoyer des messages aux acheteurs",
  "orders.read": "Voir les commandes et les expéditions",
  "orders.write": "Créer des commandes, suivre les expéditions",
  "analytics.read": "Consulter les analyses (hors finances sans le droit « finances »)",
  "analytics.export": "Exporter les analyses et le stock en CSV",
  "automations.read": "Voir les automatisations et leurs tâches",
  "automations.write": "Créer, modifier et mettre en pause les automatisations",
  "radar.read": "Voir les bonnes affaires du radar",
  "radar.write": "Créer des recherches et trier les affaires",
  "purchase.simulate": "Préparer et simuler un achat",
  "purchase.execute": "Confirmer un achat réel",
  "connections.read": "Voir les comptes connectés",
  "connections.manage": "Connecter, tester et retirer des comptes",
  "cloud.read": "Voir les comptes Cloud et leur journal d'actions",
  "cloud.manage": "Activer, mettre en pause et arrêter le Cloud, accepter l'accord, effacer une session",
  "ai.use": "Utiliser l'IA (réponses aux acheteurs, explications de prix, photos portées)",
  "ai.configure": "Régler l'assistant IA (ton, quota, validation)",
  "tokens.manage": "Créer et révoquer des jetons d'extension",
  "data.export": "Exporter toutes les données",
  "data.delete": "Supprimer définitivement des données",
};

/** Regroupement des actions pour l'affichage. Une action absente tombe dans « Autres actions ». */
export const PERMISSION_GROUPS: { title: string; actions: Action[] }[] = [
  { title: "Vendre", actions: ["items.read", "items.write", "items.photos.write", "studio.generate", "items.delete", "conversations.read", "messages.draft", "messages.send", "orders.read", "orders.write", "customers.read", "customers.write"] },
  { title: "Acheter", actions: ["radar.read", "radar.write", "purchase.simulate", "purchase.execute"] },
  { title: "Piloter", actions: ["finances.read", "analytics.read", "analytics.export", "automations.read", "automations.write", "ai.use", "ai.configure"] },
  { title: "Comptes et extension", actions: ["connections.read", "connections.manage", "tokens.manage", "cloud.read", "cloud.manage"] },
  { title: "Organisation et données", actions: ["org.read", "org.update", "members.manage", "billing.manage", "data.export", "data.delete", "org.delete"] },
];
