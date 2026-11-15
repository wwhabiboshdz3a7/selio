import type { ServerCapabilities } from "@selio/contracts";
import { repos } from "@selio/db";
import type { Services } from "../context";

/**
 * Capacités du serveur (GET /api/capabilities) : ce qui est réellement branché, pour que l'application montre un
 * état « En cours d'activation » plutôt que des chiffres simulés. Booléens seulement : aucun secret, aucune
 * adresse, aucun nom de fournisseur.
 *
 * - Track en direct : TRACK_LIVE_ENABLED (sinon la source est le simulateur) ;
 * - Cloud : CLOUD_ENABLED ; Radar en direct passe par le Cloud ;
 * - vision : un modèle qui voit les images, hors simulateur ;
 * - estimation des prix : modèle actif entraîné sur de vraies ventes (pas un modèle de démonstration) ;
 * - paiement : Revolut ou simulé (`billing.paymentMode`) ; email : un fournisseur qui envoie réellement.
 */
export async function serverCapabilities(services: Services, flags: { trackLive: boolean; cloud: boolean }): Promise<ServerCapabilities> {
  const provider = services.ai.provider;
  const vision = provider.canSeeImages === true && provider.name !== "mock";
  let pricingModel = false;
  try {
    const active = await services.db.withGlobal((tx) => repos.priceModels.active(tx));
    pricingModel = active !== null && active.synthetic !== true;
  } catch {
    pricingModel = false;
  }
  const payment = services.billing?.paymentMode ?? (services.payments ? "revolut" : "simulated");
  return {
    demo: false,
    version: services.version,
    trackLive: flags.trackLive,
    cloud: flags.cloud,
    radarLive: flags.cloud,
    vision,
    pricingModel,
    payment,
    paymentSandbox: payment === "revolut" && services.payments ? services.payments.testMode : null,
    email: !!services.email && services.email.delivers !== false,
  };
}
