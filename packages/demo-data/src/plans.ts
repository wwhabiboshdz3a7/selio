import { DEFAULT_TRIAL_DAYS, PLAN_QUOTAS, TRIAL_DAYS, TRIAL_PLAN, type PaidPlan, type Plan, type TrialDays } from "@selio/contracts";
export { PLAN_QUOTAS, quotasForPlan } from "@selio/contracts";
export type { PaidPlan } from "@selio/contracts";

/**
 * Offres de Selio (vitrine › Tarifs, Paramètres › Abonnement, aide). Les limites techniques
 * restent celles de PLAN_QUOTAS, appliquées par le serveur.
 *
 * MONTANTS NON DÉFINITIFS : les prix ci-dessous (compte rendu de réunion 2) vivent dans cette
 * configuration, jamais en dur dans un composant, et peuvent changer avant l'ouverture des
 * abonnements. Chaque bloc porte `indicative: true` ; l'affichage reste masquable
 * (VITE_SHOW_INDICATIVE_PRICING). Aucun paiement n'est encaissé à ce stade.
 */

export type OfferKey = "trial" | PaidPlan;

const q = PLAN_QUOTAS;
/** Espaces insécables : « Jusqu'à 5 000 » ne se coupe jamais en fin de ligne. */
const NBSP = " ";
const thousands = (n: number) => (n >= 1000 ? `${Math.floor(n / 1000)}${NBSP}${String(n % 1000).padStart(3, "0")}` : String(n));

/** Pack de photos Studio acheté à l'unité (Studio seul, sans abonnement). */
export interface StudioPack {
  photos: number;
  cents: number;
}

/**
 * Configuration tarifaire unique, en centimes. Indicative : à confirmer par Ibrahim.
 * - Abonnements au mois ; l'annuel coûte 10 mois (2 mois offerts).
 * - Offre fondateurs (50 premiers) : −30 % pendant 6 mois sur Pro et Agence, 1 mois offert sur Starter.
 * - Aucun compte Vinted supplémentaire à la carte : au-delà de 10 comptes, sur devis.
 */
export const PRICING = {
  /** Les montants ne sont pas définitifs. */
  indicative: true as const,
  currency: "EUR" as const,
  monthlyCents: { starter: 699, pro: 2499, agence: 4999 } satisfies Record<PaidPlan, number>,
  /** Annuel = 10 mois payés sur 12. */
  annualMonthsCharged: 10,
  founders: {
    /** Nombre de clients concernés. */
    firstCustomers: 50,
    /** Remise sur Pro et Agence. */
    discountRate: 0.3,
    discountMonths: 6,
    discountPlans: ["pro", "agence"] as readonly PaidPlan[],
    /** Starter : un mois offert à la place de la remise. */
    freeMonthsStarter: 1,
  },
  subsidiaries: {
    /** Studio seul : curseur par nombre de photos ; plancher par photo et minimum par achat. */
    studio: {
      freeListings: 40,
      packs: [
        { photos: 80, cents: 499 },
        { photos: 200, cents: 999 },
        { photos: 1200, cents: 2999 },
      ] as readonly StudioPack[],
      floorCentsPerPhoto: 2,
      minPurchaseCents: 499,
    },
    /** Selio Radar, par mois : alertes et achat en un clic. */
    radar: 1499,
    /** Radar Auto, par mois : achat automatique, derrière un réglage désactivé par défaut. */
    radarAuto: 2999,
    /** Selio Cloud en option, par mois, pour Starter et Pro (inclus dans Agence). */
    cloudOption: 999,
    /** Selio Comptes, payés une fois. */
    comptesAudit: 999,
    comptesAccompagnement: 1499,
    /** Aucun compte à la carte : au-delà de 10 comptes, sur devis. */
    extraAccounts: "none" as const,
  },
} as const;

/** Montant mensuel indicatif d'un plan payant (centimes). */
export const monthlyPriceCents = (plan: PaidPlan): number => PRICING.monthlyCents[plan];
/** Montant annuel indicatif (10 mois payés). */
export const annualPriceCents = (plan: PaidPlan): number => PRICING.monthlyCents[plan] * PRICING.annualMonthsCharged;
/** Mensualité fondateurs pendant les 6 premiers mois (Pro et Agence) ; Starter garde son prix, avec 1 mois offert. */
export const foundersMonthlyCents = (plan: PaidPlan): number =>
  PRICING.founders.discountPlans.includes(plan) ? Math.round(PRICING.monthlyCents[plan] * (1 - PRICING.founders.discountRate)) : PRICING.monthlyCents[plan];

/** Une seule durée d'essai : 14 jours. Gardé sous forme de liste pour les sélecteurs existants. */
export const TRIAL_DURATIONS: readonly { days: TrialDays; label: string; long: string; phrase: string }[] = [
  { days: TRIAL_DAYS, label: "14 jours", long: "14 jours", phrase: "de 14 jours" },
];

export const TRIAL_OFFER = {
  key: "trial" as const,
  name: "Essai 14 jours",
  /** Plan dont l'essai donne toutes les fonctions et limites. */
  plan: TRIAL_PLAN,
  days: TRIAL_DAYS,
  defaultDays: DEFAULT_TRIAL_DAYS,
  /** Carte enregistrée dès le début, rien n'est débité avant la fin de l'essai. */
  cardRequired: true,
  tagline: "14 jours gratuits, carte enregistrée, rien débité avant la fin",
  profile: "Pour essayer Selio sur votre propre activité avant de choisir.",
  highlights: ["Toutes les fonctions du plan Pro pendant 14 jours", "Carte enregistrée à l'inscription, aucun débit avant la fin", "Ensuite, Starter, Pro ou Agence au choix ; résiliable à tout moment"],
};

export interface PlanOffer {
  key: PaidPlan;
  name: string;
  /** Le profil en quelques mots. */
  profile: string;
  /** À qui s'adresse le plan, en une phrase. */
  forWhom: string;
  /** Montant mensuel indicatif en centimes (PRICING). */
  indicativeMonthlyCents: number;
  /** Les montants ne sont pas définitifs. */
  indicative: true;
  highlights: string[];
}

/** Starter, Pro, Agence : points forts (docs/PROMPT-SUITE-DU-DEVELOPPEMENT.md §5.2). */
export const PLAN_OFFERS: readonly PlanOffer[] = [
  {
    key: "starter",
    name: "Starter",
    profile: "Le revendeur qui démarre",
    forWhom: "Vous vendez seul, sur un compte Vinted.",
    indicativeMonthlyCents: PRICING.monthlyCents.starter,
    indicative: true,
    highlights: [`${q.starter.connections} compte Vinted`, `${q.starter.aiRequestsPerMonth} réponses de mon IA perso par mois`, "Stock, dressing, messagerie, commandes et marges", "Cloud en option"],
  },
  {
    key: "pro",
    name: "Pro",
    profile: "Le revendeur régulier",
    forWhom: "Vous gérez plusieurs comptes ou travaillez à deux ou trois.",
    indicativeMonthlyCents: PRICING.monthlyCents.pro,
    indicative: true,
    highlights: [`${q.pro.connections} comptes Vinted`, "Track essentiel", "Relance après 24 h proposée", `${q.pro.studioListingsPerMonth} annonces Studio et ${q.pro.wornPhotosPerMonth} photos portées par mois`, `${thousands(q.pro.aiRequestsPerMonth)} réponses de mon IA perso par mois`, "Cloud en option"],
  },
  {
    key: "agence",
    name: "Agence",
    profile: "L'équipe et les comptes multiples",
    forWhom: "Vous gérez jusqu'à dix comptes, en équipe, avec des rôles. Au-delà : sur devis.",
    indicativeMonthlyCents: PRICING.monthlyCents.agence,
    indicative: true,
    highlights: [`${q.agence.connections} comptes Vinted`, "Track complet", "Relance automatique", "Cloud inclus", "Rôles d'équipe", `${q.agence.studioListingsPerMonth} annonces Studio et ${q.agence.wornPhotosPerMonth} photos portées par mois`, `${thousands(q.agence.aiRequestsPerMonth)} réponses de mon IA perso par mois`, "Migration assistée", "Support prioritaire"],
  },
];

export const planOffer = (plan: Plan): PlanOffer | undefined => PLAN_OFFERS.find((p) => p.key === plan);

export type ComparisonValue = { kind: "text"; text: string } | { kind: "check" } | { kind: "planned" } | { kind: "none" };
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
const none: ComparisonValue = { kind: "none" };
const all = (v: ComparisonValue): Record<OfferKey, ComparisonValue> => ({ trial: v, starter: v, pro: v, agence: v });
const upTo = (n: number) => text(`Jusqu'à${NBSP}${thousands(n)}`);
const perMonth = (n: number) => (n > 0 ? text(`${thousands(n)}${NBSP}par${NBSP}mois`) : none);
/** L'essai donne les limites du plan dont il fait découvrir les fonctions. */
const trialQuotas = q[TRIAL_PLAN];
const monthly = text(`Au mois, sans${NBSP}engagement`);
const FOLLOW_UP_LABELS = { none, suggested: text("Proposée"), auto: text("Automatique (Cloud)") } as const;
const byPlan = (f: (plan: Plan) => ComparisonValue): Record<OfferKey, ComparisonValue> => ({ trial: f(TRIAL_PLAN), starter: f("starter"), pro: f("pro"), agence: f("agence") });

/** Tableau comparatif : ce que chaque offre permet. */
export const PLAN_COMPARISON: readonly ComparisonGroup[] = [
  {
    title: "Formule",
    rows: [
      { label: "Durée", hint: "L'essai dure 14 jours, puis vous choisissez un plan.", values: { trial: text(`${TRIAL_DAYS}${NBSP}jours`), starter: monthly, pro: monthly, agence: monthly } },
      { label: "Carte bancaire", hint: "Rien n'est débité avant la fin de l'essai.", values: { trial: text("Enregistrée à l'inscription"), starter: text("Mensuel ou annuel"), pro: text("Mensuel ou annuel"), agence: text("Mensuel ou annuel") } },
      { label: "Annuel", hint: "2 mois offerts : 10 mois payés sur 12.", values: { trial: none, starter: check, pro: check, agence: check } },
    ],
  },
  {
    title: "Comptes et équipe",
    rows: [
      { label: "Comptes Vinted connectés", hint: "Vente, achat ou perso, au choix. Aucun compte supplémentaire à la carte ; plus de 10 comptes : sur devis.", values: { trial: upTo(trialQuotas.connections), starter: upTo(q.starter.connections), pro: upTo(q.pro.connections), agence: upTo(q.agence.connections) } },
      { label: "Personnes dans l'équipe", hint: "Chacune avec son identifiant.", values: { trial: upTo(trialQuotas.members), starter: upTo(q.starter.members), pro: upTo(q.pro.members), agence: upTo(q.agence.members) } },
      { label: "Rôles d'équipe et journal d'audit", hint: "Propriétaire, administrateur, opérateur, lecture seule.", values: { trial: check, starter: none, pro: none, agence: check } },
      { label: "Articles actifs en stock", values: byPlan((p) => upTo(q[p].items)) },
    ],
  },
  {
    title: "Mon IA perso et automatisations",
    rows: [
      { label: "Réponses de mon IA perso", hint: "Par mois. À la limite, la demande est refusée proprement, sans facturation en plus.", values: byPlan((p) => perMonth(q[p].aiRequestsPerMonth)) },
      { label: "Relance après 24 h sans réponse", values: byPlan((p) => FOLLOW_UP_LABELS[q[p].followUp24h]) },
      { label: "Messagerie, négociation et marges", values: all(check) },
      { label: "Dressing intelligent et republications", values: all(check) },
      { label: "Stock, commandes, clients et analyses", values: all(check) },
    ],
  },
  {
    title: "Selio Studio",
    rows: [
      { label: "Annonces rédigées à partir des photos", hint: "Par mois.", values: byPlan((p) => perMonth(q[p].studioListingsPerMonth)) },
      { label: "Photos portées", hint: "Par mois ; en préparation.", values: byPlan((p) => (q[p].wornPhotosPerMonth > 0 ? planned : none)) },
    ],
  },
  {
    title: "Selio Track",
    rows: [
      { label: "Filtres suivis", hint: "Relus toutes les 2 h ; en préparation.", values: byPlan((p) => (q[p].trackFiltersFollowed > 0 ? upTo(q[p].trackFiltersFollowed) : none)) },
      { label: "Scans de niche", hint: "Par mois.", values: byPlan((p) => perMonth(q[p].trackScansPerMonth)) },
      { label: "Recherches par photo", hint: "Par mois.", values: byPlan((p) => perMonth(q[p].trackPhotoSearchesPerMonth)) },
      { label: "Historique", values: byPlan((p) => (q[p].trackHistoryMonths > 0 ? text(`${q[p].trackHistoryMonths}${NBSP}mois`) : none)) },
    ],
  },
  {
    title: "Selio Cloud",
    rows: [
      { label: "Automatisations ordinateur éteint", hint: "En préparation. En option pour Starter et Pro, inclus dans Agence.", values: byPlan((p) => (q[p].cloudIncluded ? text("Inclus") : text("En option"))) },
    ],
  },
  {
    title: "Assistance",
    rows: [
      { label: "Aide intégrée, FAQ et assistant d'aide", values: all(check) },
      { label: "Migration assistée depuis un autre outil", values: { trial: none, starter: none, pro: none, agence: planned } },
      { label: "Support prioritaire", values: { trial: none, starter: none, pro: none, agence: planned } },
    ],
  },
];
