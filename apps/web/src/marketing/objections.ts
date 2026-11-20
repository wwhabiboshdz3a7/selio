import { DATA_RETENTION_DAYS_AFTER_END, PLAN_LABELS, PLAN_QUOTAS, TRIAL_DAYS, TRIAL_PLAN } from "@selio/contracts";
import { INDEPENDENCE_NOTICE } from "./seo";

/**
 * Les questions qui freinent avant l'essai (carte, résiliation, mot de passe Vinted, risque pour
 * le compte, données), avec des réponses vérifiées dans le code :
 * - aucune carte à l'inscription (pages/Register.tsx) ; sans carte à la fin de l'essai, l'espace
 *   repasse à l'accès de base (app/layout.tsx, BillingBanner) ;
 * - offres au mois, résiliation dans Paramètres › Abonnement, données gardées
 *   DATA_RETENTION_DAYS_AFTER_END jours (@selio/contracts) ;
 * - aucun mot de passe Vinted demandé ni stocké (products.ts) ;
 * - base, photos et modèles d'IA sur notre machine en France (docs/STOCKAGE.md).
 * Aucune promesse d'absence de risque : aucun outil ne peut garantir qu'un compte ne sera pas limité.
 */
export interface Objection {
  id: string;
  question: string;
  answer: string;
}

const P = PLAN_LABELS;
const Q = PLAN_QUOTAS;

export const OBJECTIONS: readonly Objection[] = [
  {
    id: "carte-essai",
    question: "Faut-il une carte bancaire pour essayer ?",
    answer: `Non, aucune carte n'est demandée à l'inscription, et rien n'est débité pendant les ${TRIAL_DAYS} jours d'essai. Pour continuer ensuite, vous enregistrez une carte dans le formulaire sécurisé de Revolut (le numéro ne transite jamais par Selio) ; sans carte, votre espace repasse à l'accès de base et vos données restent là.`,
  },
  {
    id: "resiliation",
    question: "Puis-je arrêter quand je veux ?",
    answer: `Oui. Les offres sont au mois, sans engagement, et se résilient en un clic dans Paramètres › Abonnement. L'accès continue jusqu'à la fin de la période payée, sans nouveau débit ; vos données sont conservées ${DATA_RETENTION_DAYS_AFTER_END} jours, le temps de les exporter ou de revenir.`,
  },
  {
    id: "mot-de-passe",
    question: "Selio demande-t-il mon mot de passe Vinted ?",
    answer: "Non, jamais : Selio ne demande ni ne stocke votre mot de passe Vinted. L'extension navigateur lit les pages que vous ouvrez vous-même, et avec Selio Cloud vous vous connectez vous-même dans une fenêtre sécurisée.",
  },
  {
    id: "risque-compte",
    question: "Mon compte Vinted risque-t-il quelque chose ?",
    answer: "Aucun outil ne peut garantir qu'un compte ne sera jamais limité, et nous ne le promettons pas. Selio ne contourne aucune protection, agit au rythme humain avec des plafonds par jour, s'arrête au premier CAPTCHA ou avertissement, et vous fait valider les actions importantes (prix, achat).",
  },
  {
    id: "donnees-france",
    question: "Où sont stockées mes données ?",
    answer: "En France, sur notre propre machine : base de données, photos et modèles d'IA. Vous pouvez exporter ou supprimer vos données à tout moment depuis Paramètres › Données.",
  },
  {
    id: "comptes-inclus",
    question: "Combien de comptes Vinted puis-je gérer ?",
    answer: `${Q.starter.connections} compte avec ${P.starter}, jusqu'à ${Q.pro.connections} avec ${P.pro} (et pendant l'essai, qui donne les limites de l'offre ${P[TRIAL_PLAN]}), jusqu'à ${Q.agence.connections} avec ${P.agence}. Au-delà, sur devis.`,
  },
  {
    id: "lien-vinted",
    question: "Selio est-il lié à Vinted ?",
    answer: `Non. ${INDEPENDENCE_NOTICE}`,
  },
];

export function objection(id: string): Objection {
  const o = OBJECTIONS.find((x) => x.id === id);
  if (!o) throw new Error(`Objection inconnue : ${id}`);
  return o;
}
