import type { Role } from "@selio/contracts";
import { can } from "@selio/domain";

/**
 * Rôles d'équipe côté interface (§5.15). Les droits viennent de @selio/domain (la même matrice que le
 * serveur) : ce module ne fait que traduire ces droits en écrans.
 *
 * - L'exécuteur (operator) publie et répond, mais ne voit pas les finances : l'interface masque chiffre
 *   d'affaires, marges, prix d'achat et facturation (le serveur les masque aussi, `redactForRole`).
 * - Le contributeur photos (photographer) n'a que trois droits : voir les articles, leur ajouter des photos
 *   et lancer le générateur. Il arrive sur une vue réduite (Articles → photos, Studio) avec un menu restreint.
 */

/** Vrai si le rôle voit les montants financiers (chiffre d'affaires, marges, prix d'achat, factures). */
export function seesFinances(role: Role): boolean {
  return can(role, "finances.read");
}

/** Vue réduite du contributeur photos : déterminée par ses droits, pas par son nom. */
export function hasReducedView(role: Role): boolean {
  return !can(role, "org.read") && can(role, "items.photos.write");
}

/** Page d'arrivée de la vue réduite : la liste des articles à photographier. */
export const PHOTOS_HOME = "/app/items/photos";

/** Adresses ouvertes à la vue réduite (le reste affiche « réservé à d'autres rôles »). */
const REDUCED_VIEW_PATHS: RegExp[] = [
  /^\/app\/items\/photos$/,
  /^\/app\/items\/[^/]+\/photos$/,
  /^\/studio(\/.*)?$/,
  /^\/app\/settings$/,
  /^\/app\/settings\/(apparence|security)$/,
  /^\/app\/help$/,
];

/** Vrai si la vue réduite peut ouvrir cette adresse. */
export function reducedViewAllows(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return REDUCED_VIEW_PATHS.some((re) => re.test(path));
}

/**
 * Où mène une adresse pour la vue réduite : elle-même si elle est ouverte, la page d'arrivée pour les
 * accueils (vue d'ensemble, accueil des espaces), null sinon (page « réservée »).
 */
export function reducedViewTarget(pathname: string): string | null {
  if (reducedViewAllows(pathname)) return pathname;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app" || path === "/app/espaces" || path === "/app/items") return PHOTOS_HOME;
  return null;
}
