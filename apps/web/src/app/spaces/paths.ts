/** Accueil central des espaces : page d'arrivée après connexion. */
export const HUB_PATH = "/app/espaces";

/**
 * Adresse de base de chaque filiale (hors Selio Manager, qui occupe /app). Les pages historiques du radar
 * (bonnes affaires, achats à valider, achat automatique) gardent leurs adresses /app/… pour que les liens
 * existants (alertes sur le téléphone, journal, favoris) restent valides, mais appartiennent à Selio Bot.
 * Selio Cloud (/cloud) et Selio Agent (/agents) ne sont pas des filiales : intégrés à Selio Manager, ils
 * n'ont pas d'entrée ici et prennent donc le menu du Manager.
 */
export const SPACE_PREFIXES = [
  ["/app/radar", "bot"], ["/app/purchase", "bot"], ["/app/auto-buy", "bot"],
  ["/studio", "studio"], ["/track", "track"], ["/bot", "bot"], ["/comptes", "generateur"],
] as const;

/** Fonctionnalités intégrées à Selio Manager, avec leurs propres pages (sous-menu dans le menu du Manager). */
export const FEATURE_PREFIXES = [["/cloud", "cloud"], ["/agents", "agents"]] as const;

/** Adresses internes autorisées après connexion (jamais de redirection externe ; /generateur redirige vers /comptes). */
export const APP_PATH_PATTERN = /^\/(app|studio|track|bot|cloud|agents|comptes|generateur)(\/[a-z0-9-]+)*$/;
