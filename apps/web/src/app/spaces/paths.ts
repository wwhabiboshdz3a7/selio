/** Accueil central des espaces : page d'arrivée après connexion. */
export const HUB_PATH = "/app/espaces";

/** Adresse de base de chaque espace (hors Selio Manager, qui occupe /app). */
export const SPACE_PREFIXES = [["/studio", "studio"], ["/track", "track"], ["/bot", "bot"], ["/cloud", "cloud"], ["/agents", "agents"], ["/comptes", "generateur"]] as const;

/** Adresses internes autorisées après connexion (jamais de redirection externe ; /generateur redirige vers /comptes). */
export const APP_PATH_PATTERN = /^\/(app|studio|track|bot|cloud|agents|comptes|generateur)(\/[a-z0-9-]+)*$/;
