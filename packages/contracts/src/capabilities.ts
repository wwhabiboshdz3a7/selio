import type { BillingPaymentMode } from "./billing";

/**
 * Capacités du serveur (GET /api/capabilities, public, sans secret) : ce qui est réellement branché sur
 * cette installation. L'application les lit pour choisir, fonction par fonction, entre l'écran réel et un
 * état « En cours d'activation » : on ne montre JAMAIS des chiffres simulés comme s'ils étaient réels.
 * En mode démonstration (sans API), le client de démonstration répond `demo: true` et tout reste visible.
 */
export interface ServerCapabilities {
  /** Réponse du client de démonstration (aucune API) : rien n'est masqué. */
  demo: boolean;
  /** Version de l'API (permet d'afficher « le serveur n'est pas à jour »). */
  version: string;
  /** Selio Track lit les pages publiques en direct (TRACK_LIVE_ENABLED) ; faux : simulateur, rien à montrer. */
  trackLive: boolean;
  /** Selio Cloud ouvert sur ce serveur (CLOUD_ENABLED). */
  cloud: boolean;
  /** Radar lit Vinted en direct (passe par Selio Cloud). */
  radarLive: boolean;
  /** Un modèle de vision lit les photos (recherche par photo, lecture des étiquettes). */
  vision: boolean;
  /** Estimation des prix par un modèle entraîné sur de vraies ventes (pas un modèle de démonstration). */
  pricingModel: boolean;
  /** Paiement : Revolut (réel ou bac à sable) ou simulé (aucune carte, aucun débit). */
  payment: BillingPaymentMode;
  /** Revolut en bac à sable (mode test) ; null en paiement simulé. */
  paymentSandbox: boolean | null;
  /** Emails réellement envoyés (SMTP) ; faux : journalisés seulement (« noop »). */
  email: boolean;
}

/** Capacités supposées quand le serveur ne connaît pas encore GET /api/capabilities (serveur pas à jour). */
export const LEGACY_SERVER_CAPABILITIES: ServerCapabilities = {
  demo: false,
  version: "inconnue",
  trackLive: false,
  cloud: false,
  radarLive: false,
  vision: false,
  pricingModel: false,
  payment: "revolut",
  paymentSandbox: null,
  email: false,
};
