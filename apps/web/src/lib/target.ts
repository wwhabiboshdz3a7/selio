/**
 * Cible du build et disponibilité de la démonstration, fixées au build (vite.config.ts) :
 * - « public » : vitrine et application des clients, sans aucune page de Selio Admin ;
 * - « admin » : Selio Admin seul, sur un site séparé, non indexé.
 * La démonstration n'existe que dans un build sans API (développement, tests, vidéos) :
 * en production, rien n'y mène et son code n'est pas chargé.
 */
export const APP_TARGET: "public" | "admin" = __SELIO_TARGET__;
export const DEMO_BUILD: boolean = __SELIO_DEMO__;
