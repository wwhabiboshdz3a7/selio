import { APP_PATH_PATTERN, HUB_PATH } from "../app/spaces/paths";

/**
 * Page d'arrivée après connexion sur le site public : la page demandée si c'est une page de l'application,
 * sinon l'accueil des espaces. Opérateurs compris : Selio Admin vit sur un site séparé (build « admin »),
 * le site public n'y mène jamais.
 */
export function appLandingPath(from?: string | null): string {
  const back = splitReturnPath(from);
  return back && APP_PATH_PATTERN.test(back.path) ? back.path + back.rest : HUB_PATH;
}

/**
 * Adresse de retour après connexion : le chemin (contrôlé par l'appelant avec ses motifs : jamais une adresse
 * externe) et ses paramètres et ancre (`?onglet=…#section`), gardés s'ils ne contiennent ni espace, ni barre
 * oblique inverse, ni caractère de contrôle.
 */
export function splitReturnPath(from: string | null | undefined): { path: string; rest: string } | null {
  if (!from || from.length > 2000) return null;
  const cut = from.search(/[?#]/);
  const path = cut === -1 ? from : from.slice(0, cut);
  const rest = cut === -1 ? "" : from.slice(cut);
  // eslint-disable-next-line no-control-regex
  if (rest && /[\s\\\u0000-\u001F\u007F]/.test(rest)) return { path, rest: "" };
  return { path, rest };
}
