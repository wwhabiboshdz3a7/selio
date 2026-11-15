import { apiBaseUrl } from "../lib/env";

/**
 * Accès à la démonstration (/demo). La vitrine n'y renvoie jamais : ses boutons mènent à
 * l'inscription (essai de 14 jours) et à la connexion. En production (VITE_API_BASE_URL
 * renseignée), l'adresse /demo elle-même redirige vers l'inscription ; en développement
 * sans API, elle reste ouverte pour les tests et les vidéos.
 */
export function demoEntryAllowed(base: string = apiBaseUrl): boolean {
  return base === "";
}
