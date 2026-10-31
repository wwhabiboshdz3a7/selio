/** Accueil central des espaces : page d'arrivée après connexion. */
export const HUB_PATH = "/app/espaces";

/** Adresse de base de chaque espace (hors Selio, qui occupe /app). */
export const SPACE_PREFIXES = [["/studio", "studio"], ["/agents", "agents"], ["/track", "track"], ["/cloud", "cloud"], ["/generateur", "generateur"]] as const;

/** Adresses internes autorisées après connexion (jamais de redirection externe). */
export const APP_PATH_PATTERN = /^\/(app|studio|agents|track|cloud|generateur)(\/[a-z0-9-]+)*$/;
