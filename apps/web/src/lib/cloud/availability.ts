import { CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, CLOUD_MAX_BROWSERS_DEFAULT, PLAN_LABELS, isPlan, type CloudAvailability, type PlanQuotas } from "@selio/contracts";

/**
 * Réglages du Cloud côté serveur (CLOUD_HEAVY_ACTIONS, CLOUD_MAX_ACCOUNTS_PER_ORG, CLOUD_MAX_BROWSERS,
 * CLOUD_PRO_OPTION). La démonstration reprend les valeurs par défaut du serveur : tout ce qui ouvre
 * davantage est faux.
 */
export interface CloudServerSettings {
  heavyActions: boolean;
  maxAccountsPerOrg: number;
  maxBrowsers: number;
  proOption: boolean;
}

export const DEFAULT_CLOUD_SETTINGS: CloudServerSettings = {
  heavyActions: false,
  maxAccountsPerOrg: CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT,
  maxBrowsers: CLOUD_MAX_BROWSERS_DEFAULT,
  proOption: false,
};

/**
 * Le Cloud selon l'offre — même règle que `cloudAvailabilityFor` (packages/core/src/services/cloud.ts),
 * reprise ici pour la démonstration : compris dans Agence, « en option, prix à décider » pour Pro
 * (activable seulement si CLOUD_PRO_OPTION l'ouvre, rien n'est facturé), indisponible en accès de base
 * et Starter.
 */
export function cloudAvailabilityFor(plan: string, quotas: PlanQuotas, settings: CloudServerSettings = DEFAULT_CLOUD_SETTINGS): CloudAvailability {
  const planKey = isPlan(plan) ? plan : "free";
  const included = quotas.cloudIncluded;
  const optional = !included && planKey === "pro";
  const available = included || (optional && settings.proOption);
  const reason = included
    ? planKey === "agence" ? "Selio Cloud est compris dans votre offre Agence." : "Selio Cloud est compris dans votre offre."
    : optional
      ? settings.proOption
        ? "Selio Cloud en option avec l'offre Pro : prix à décider, rien n'est facturé pour l'instant."
        : "Selio Cloud sera proposé en option avec l'offre Pro (prix à décider) : pas encore activable. Il est compris dans l'offre Agence."
      : `Selio Cloud n'est pas disponible avec l'offre ${PLAN_LABELS[planKey]}. Il est compris dans l'offre Agence (option à venir avec Pro, prix à décider).`;
  return {
    plan: planKey,
    included,
    optional,
    available,
    reason,
    actionsPerDay: quotas.automationActionsPerDay,
    maxAccounts: available ? Math.min(settings.maxAccountsPerOrg, quotas.connections) : 0,
    heavyActionsEnabled: settings.heavyActions,
    maxBrowsers: settings.maxBrowsers,
    capacityNote: `Capacité visée : 50 navigateurs ouverts en même temps sur notre machine. C'est une hypothèse à mesurer, aucun chiffre n'est mesuré à ce jour ; limite prudente actuelle : ${settings.maxBrowsers} navigateurs.`,
  };
}

/** Formule de l'offre pour l'écran : « compris », « en option, prix à décider » ou « à partir de Pro ». */
export type CloudOfferKind = "included" | "option_open" | "option_pending" | "unavailable";

export function cloudOfferKind(av: Pick<CloudAvailability, "included" | "optional" | "available">): CloudOfferKind {
  if (av.included) return "included";
  if (av.optional) return av.available ? "option_open" : "option_pending";
  return "unavailable";
}
