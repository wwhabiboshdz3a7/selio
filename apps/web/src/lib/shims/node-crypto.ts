/**
 * Remplaçant de `node:crypto` pour le bundle navigateur (alias dans vite.config.ts).
 *
 * `@selio/connectors` réexporte le client Revolut (serveur : signature des webhooks avec
 * HMAC-SHA256) depuis son index, que le navigateur importe pour le simulateur de démonstration.
 * Rollup refuse un import nommé depuis un module Node externalisé, même jamais appelé : ce shim
 * fournit les deux noms, élagués du bundle final, et lève une erreur claire si du code serveur
 * se retrouvait un jour exécuté dans le navigateur. Aucune cryptographie n'est faite ici.
 */

const BROWSER_ERROR = "node:crypto n'est pas disponible dans le navigateur : la vérification des webhooks de paiement se fait côté serveur (API).";

export function createHmac(): never {
  throw new Error(BROWSER_ERROR);
}

export function timingSafeEqual(): never {
  throw new Error(BROWSER_ERROR);
}

export default { createHmac, timingSafeEqual };
