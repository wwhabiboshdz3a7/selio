import type { OperatorRole } from "@selio/contracts";

/**
 * Matrice des droits des opérateurs Selio (Selio Admin). Deux rôles, définis par la configuration du
 * serveur : « tech » (Ibrahim) peut tout ; « business » (Elias) pilote la croissance, les comptes,
 * les offres commerciales et lit l'usage de Track par client. Appliquée par l'API (refus 403) et par
 * l'application web (menus et pages masqués).
 */
export const OPERATOR_CAPABILITIES = [
  // Business et technique
  "admin.growth",
  "admin.accounts.read",
  "admin.accounts.manage",
  "admin.offers",
  "admin.usage.read",
  "admin.track.read",
  // Technique seulement
  "admin.health",
  "admin.supervision",
  "admin.ai",
  "admin.pricing",
  "admin.size_references",
  "admin.switches",
  "admin.plans",
  "admin.radar",
  "admin.audit",
] as const;
export type OperatorCapability = (typeof OPERATOR_CAPABILITIES)[number];

const BUSINESS: ReadonlySet<OperatorCapability> = new Set<OperatorCapability>([
  "admin.growth",
  "admin.accounts.read",
  "admin.accounts.manage",
  "admin.offers",
  "admin.usage.read",
  "admin.track.read",
]);

/** Vrai si le rôle d'opérateur a ce droit. Un non-opérateur (null) n'en a aucun. */
export function operatorCan(role: OperatorRole | null | undefined, capability: OperatorCapability): boolean {
  if (role === "tech") return true;
  if (role === "business") return BUSINESS.has(capability);
  return false;
}

/** Rôle minimal attendu par une route : « business » (tout opérateur) ou « tech » (technique seulement). */
export function operatorHasLevel(role: OperatorRole | null | undefined, level: OperatorRole): boolean {
  if (!role) return false;
  return level === "business" ? true : role === "tech";
}

/**
 * Rôle d'opérateur d'un utilisateur selon la configuration, recalculé à chaque requête : OPERATOR_EMAILS →
 * « tech », OPERATOR_BUSINESS_EMAILS → « business » ; l'ancien drapeau `users.is_operator` vaut « tech »
 * (comptes créés avant les deux rôles). Une adresse présente dans les deux listes est « tech ».
 */
export function resolveOperatorRole(config: { tech?: readonly string[]; business?: readonly string[] } | undefined, user: { email: string; isOperator?: boolean }): OperatorRole | null {
  const mail = user.email.trim().toLowerCase();
  if (config?.tech?.includes(mail)) return "tech";
  if (user.isOperator) return "tech";
  if (config?.business?.includes(mail)) return "business";
  return null;
}

/** Liste d'emails d'une variable d'environnement (séparés par des virgules), en minuscules, sans doublon. */
export function parseEmailList(raw: string | undefined | null): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
