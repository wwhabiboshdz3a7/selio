import { DEFAULT_TRIAL_DAYS, PLAN_QUOTAS, TRIAL_PLAN, type Plan, type TrialDays } from "@selio/contracts";
export { PLAN_QUOTAS } from "@selio/contracts";

/**
 * Offres de Selio, décrites par profil et par ce qu'elles permettent (vitrine › Tarifs,
 * Paramètres › Abonnement). Les limites techniques restent celles de PLAN_QUOTAS, appliquées
 * par le serveur ; elles ne sont pas présentées comme des listes « X par mois ».
 * Les montants sont indicatifs et masquables (VITE_SHOW_INDICATIVE_PRICING) : aucun paiement
 * n'est encaissé à ce stade.
 */

export type PaidPlan = Exclude<Plan, "free">;
export type OfferKey = "trial" | PaidPlan;

const q = PLAN_QUOTAS;
/** Espaces insécables : « Jusqu'à 5 000 » ne se coupe jamais en fin de ligne. */
const NBSP = " ";
const thousands = (n: number) => (n >= 1000 ? `${Math.floor(n / 1000)}${NBSP}${String(n % 1000).padStart(3, "0")}` : String(n));

/** Durées d'essai proposées : 1 semaine par défaut, ou 1 mois. */
export const TRIAL_DURATIONS: readonly { days: TrialDays; label: string; long: string; phrase: string }[] = [
  { days: 7, label: "1 semaine", long: "7 jours", phrase: "d'une semaine" },
  { days: 30, label: "1 mois", long: "30 jours", phrase: "d'un mois" },
];

export const TRIAL_OFFER = {
  key: "trial" as const,
  name: "Découverte",
  /** Plan dont l'essai donne toutes les fonctions et limites. */
  plan: TRIAL_PLAN,
  defaultDays: DEFAULT_TRIAL_DAYS,
  tagline: "Essai gratuit, sans carte bancaire",
  profile: "Pour essayer Selio sur votre propre activité avant de choisir.",
  highlights: ["Toutes les fonctions du plan Pro", "Sans carte bancaire ni engagement", "Ensuite, Essentiel ou Pro au choix"],
};

export interface PlanOffer {
  key: PaidPlan;
  name: string;
  /** Le profil en quelques mots. */
  profile: string;
  /** À qui s'adresse le plan, en une phrase. */
  forWhom: string;
  /** Montant mensuel indicatif en centimes. */
  indicativeMonthlyCents: number;
  highlights: string[];
}

export const PLAN_OFFERS: readonly PlanOffer[] = [
  {
    key: "starter",
    name: "Essentiel",
    profile: "Le revendeur régulier",
    forWhom: "Vous vendez seul ou à deux, sur un ou deux comptes Vinted.",
    indicativeMonthlyCents: 1900,
    highlights: [`Jusqu'à ${q.starter.connections} comptes Vinted`, `Jusqu'à ${q.starter.members} personnes`, "Tous les modules inclus"],
  },
  {
    key: "pro",
    name: "Pro",
    profile: "L'équipe et les comptes multiples",
    forWhom: "Vous travaillez en équipe ou séparez vos comptes de vente et d'achat.",
    indicativeMonthlyCents: 4900,
    highlights: [`Jusqu'à ${q.pro.connections} comptes Vinted`, `Jusqu'à ${q.pro.members} personnes`, "Capacité étendue : stock, IA, automatisations"],
  },
];

export type ComparisonValue = { kind: "text"; text: string } | { kind: "check" } | { kind: "planned" };
export interface ComparisonRow {
  label: string;
  hint?: string;
  values: Record<OfferKey, ComparisonValue>;
}
export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

const text = (t: string): ComparisonValue => ({ kind: "text", text: t });
const check: ComparisonValue = { kind: "check" };
const planned: ComparisonValue = { kind: "planned" };
const all = (v: ComparisonValue): Record<OfferKey, ComparisonValue> => ({ trial: v, starter: v, pro: v });
const upTo = (n: number) => text(`Jusqu'à${NBSP}${thousands(n)}`);
/** L'essai donne les limites du plan dont il fait découvrir les fonctions. */
const trialQuotas = q[TRIAL_PLAN];
const monthly = text(`Au mois, sans${NBSP}engagement`);

/** Tableau comparatif : ce que chaque offre permet, sans liste de quotas mensuels. */
export const PLAN_COMPARISON: readonly ComparisonGroup[] = [
  {
    title: "Formule",
    rows: [
      { label: "Durée", hint: "La durée de l'essai se choisit à l'inscription.", values: { trial: text(`${TRIAL_DURATIONS.map((d) => d.label.replace(" ", NBSP)).join(" ou ")}, au choix`), starter: monthly, pro: monthly } },
      { label: "Carte bancaire", values: { trial: text("Non demandée"), starter: text("À l'ouverture des abonnements"), pro: text("À l'ouverture des abonnements") } },
    ],
  },
  {
    title: "Comptes et équipe",
    rows: [
      { label: "Comptes Vinted connectés", hint: "Vente, achat ou perso, au choix. Le simulateur de démonstration n'est pas compté.", values: { trial: upTo(trialQuotas.connections), starter: upTo(q.starter.connections), pro: upTo(q.pro.connections) } },
      { label: "Personnes dans l'équipe", hint: "Chacune avec son identifiant.", values: { trial: upTo(trialQuotas.members), starter: upTo(q.starter.members), pro: upTo(q.pro.members) } },
      { label: "Rôles et journal d'audit", hint: "Propriétaire, administrateur, opérateur, lecture seule.", values: all(check) },
      { label: "Articles actifs en stock", values: { trial: upTo(trialQuotas.items), starter: upTo(q.starter.items), pro: upTo(q.pro.items) } },
    ],
  },
  {
    title: "Modules inclus",
    rows: [
      { label: "Générateur d'annonces par l'IA", hint: "Prix conseillé par les ventes comparables.", values: all(check) },
      { label: "Dressing intelligent et republications", values: all(check) },
      { label: "Messagerie, négociation et marges", values: all(check) },
      { label: "Bonnes affaires et « À valider »", hint: "Annonces du radar simulées pour l'instant.", values: all(check) },
      { label: "Achat auto", hint: "Simulé : aucun achat réel.", values: all(check) },
      { label: "Stock, commandes, clients et analyses", values: all(check) },
      { label: "Automatisations", values: all(check) },
      { label: "Extension navigateur", hint: "Expérimentale.", values: all(check) },
    ],
  },
  {
    title: "Assistant IA",
    rows: [
      { label: "Capacité de l'IA et des automatisations", hint: "Une limite mensuelle de sécurité, visible en pourcentage dans l'application. Aucun dépassement facturé.", values: { trial: text("Étendue"), starter: text("Régulière"), pro: text("Étendue") } },
    ],
  },
  {
    title: "Assistance",
    rows: [
      { label: "Aide intégrée, FAQ et assistant d'aide", values: all(check) },
      { label: "Assistance par email", values: all(planned) },
    ],
  },
];
