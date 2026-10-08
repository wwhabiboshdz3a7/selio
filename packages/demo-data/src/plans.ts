import type { Plan } from "@selio/contracts";
export { PLAN_QUOTAS } from "@selio/contracts";

/** Les montants de la vitrine sont indicatifs et configurables (VITE_SHOW_INDICATIVE_PRICING). */

export interface PlanCard {
  plan: Plan;
  name: string;
  /** Montant mensuel indicatif en centimes, null = « sur devis / à définir ». */
  indicativeMonthlyCents: number | null;
  tagline: string;
  features: string[];
}

export const PLAN_CARDS: PlanCard[] = [
  { plan: "free", name: "Découverte", indicativeMonthlyCents: 0, tagline: "Pour tester le parcours complet en démonstration.", features: ["50 articles", "50 suggestions IA / mois", "10 actions automatiques / jour", "1 connexion", "1 utilisateur"] },
  { plan: "starter", name: "Essentiel", indicativeMonthlyCents: 1900, tagline: "Pour un revendeur régulier.", features: ["500 articles", "500 suggestions IA / mois", "100 actions automatiques / jour", "2 connexions", "3 utilisateurs", "Export CSV"] },
  { plan: "pro", name: "Pro", indicativeMonthlyCents: 4900, tagline: "Pour une équipe et plusieurs comptes.", features: ["5 000 articles", "3 000 suggestions IA / mois", "500 actions automatiques / jour", "5 connexions", "10 utilisateurs", "Rôles et audit"] },
];
