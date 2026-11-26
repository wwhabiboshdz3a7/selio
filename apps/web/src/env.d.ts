/** Identifiant de build injecté par Vite (voir vite.config.ts). */
declare const __SELIO_BUILD__: string;
/**
 * Cible du build (VITE_APP_TARGET, voir vite.config.ts) : « public » (vitrine et application des clients)
 * ou « admin » (Selio Admin seul, sur son propre site). Remplacée par une constante au build : le code de
 * l'autre cible n'entre pas dans le bundle.
 */
declare const __SELIO_TARGET__: "public" | "admin";
/** Démonstration disponible : vrai seulement pour un build sans API (VITE_API_BASE_URL vide : développement, tests, vidéos). */
declare const __SELIO_DEMO__: boolean;
