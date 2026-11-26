import { PLAN_LABELS, PLAN_QUOTAS, TRIAL_PLAN } from "@selio/contracts";
import { PRICING } from "@selio/demo-data";
import { PRODUCT_PAGES, type ProductDef, type ProductSlug } from "./products";
import { objection, type Objection } from "./objections";
import { SHOW_INDICATIVE_PRICING } from "./seo";

/**
 * Pages d'atterrissage pour la publicité (Google Ads) : une page par intention de recherche,
 * un seul message, rapide (pas de constellation). Titre = le mot-clé, sous-titre = le bénéfice,
 * trois preuves qui sont des fonctions réelles de la filiale (titres repris tels quels de
 * `products.ts`, vérifié par les tests), une capture, l'appel à l'essai, une FAQ courte.
 *
 * L'état réel de la filiale (Disponible, Aperçu, En développement) et sa note sont affichés en
 * haut de page : une publicité ne doit jamais faire croire qu'une fonction simulée est en service.
 * Titre, description et indexation : `SEO_PAGES` (seo.ts) ; les pages qui doublonnent une page
 * produit sont en « noindex, follow ».
 */
export interface LandingDef {
  path: `/${string}`;
  /** Filiale présentée (sa capture, son état, ses fonctions). */
  product: ProductSlug;
  /** Titre de la page : le mot-clé visé, en phrase. */
  title: string;
  /** Sous-titre : le bénéfice. */
  lead: string;
  /** Trois preuves : titres exacts de fonctions de la filiale (`does` dans products.ts). */
  proofs: [string, string, string];
  /** Limites assumées, reprises mot pour mot de `doesNot`. */
  limits: string[];
  /** Questions propres à l'intention ; les objections communes sont ajoutées après. */
  faq: Objection[];
  /** Les objections communes à ajouter (identifiants de objections.ts). */
  sharedFaq: string[];
  /** Prix de l'abonnement dans les données structurées (pages de Selio Manager). */
  offers: boolean;
  /** Phrase sous l'appel à l'action (ce que l'essai comprend, quand ce n'est pas évident). */
  ctaNote?: string;
}

const P = PLAN_LABELS;
const Q = PLAN_QUOTAS;

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: PRICING.currency });
const botPrice = SHOW_INDICATIVE_PRICING ? `${euros.format(PRICING.subsidiaries.bot / 100)} par mois (montant indicatif)` : "son propre prix au mois";

export const LANDINGS: readonly LandingDef[] = [
  {
    path: "/logiciel-vinted",
    product: "manager",
    title: "Le logiciel Vinted pour gérer tous vos comptes au même endroit",
    lead: "Vos comptes Vinted (vente, achat, perso), votre stock, vos conversations, vos commandes et vos marges dans un seul outil : moins de temps à jongler entre les onglets, plus de temps pour vendre.",
    proofs: ["Multi-comptes", "Gestion du stock centralisée", "Gestion des marges"],
    limits: ["Ne demande ni ne stocke votre mot de passe Vinted.", "Ne contourne aucun CAPTCHA ni aucune protection anti-robot ; s'arrête au premier signal."],
    faq: [
      objection("comptes-inclus"),
      { id: "import-stock", question: "Puis-je reprendre mon stock existant ?", answer: "Oui, par import CSV : un aperçu montre les erreurs avant d'enregistrer. L'export CSV est disponible à tout moment." },
      { id: "equipe", question: "Puis-je travailler à plusieurs ?", answer: `Oui : ${Q.pro.members} personnes avec ${P.pro} (et pendant l'essai), jusqu'à ${Q.agence.members} avec ${P.agence}, chacune avec son identifiant ; aucun mot de passe n'est partagé.` },
    ],
    sharedFaq: ["mot-de-passe", "carte-essai", "resiliation"],
    offers: true,
  },
  {
    path: "/negociation-automatique-vinted",
    product: "manager",
    title: "La négociation automatique sur Vinted, selon vos règles de prix",
    lead: "Chaque offre reçue est comparée à votre prix plancher et à vos paliers de marge : Selio accepte, refuse ou prépare une contre-offre, l'IA rédige le message, et vous gardez la main.",
    proofs: ["Négociation par IA", "Messagerie automatisée", "Automatisations"],
    limits: ["N'envoie aucun message sans règle explicite ni validation de votre part.", "Ne contourne aucun CAPTCHA ni aucune protection anti-robot ; s'arrête au premier signal."],
    faq: [
      { id: "sous-le-prix", question: "L'IA peut-elle vendre sous mon prix plancher ?", answer: "Non. Le prix plancher et les paliers de marge sont des règles fixes, appliquées avant l'IA : elle rédige le message, elle ne décide jamais du prix." },
      { id: "envoi-sans-moi", question: "Les messages partent-ils sans moi ?", answer: "Par défaut, un brouillon vous est proposé et vous validez. L'envoi automatique ne s'active que par une règle explicite, avec vos horaires et un plafond par jour, et s'arrête en un clic." },
      { id: "ordinateur-allume", question: "Faut-il laisser l'ordinateur allumé ?", answer: "Aujourd'hui, les automatisations tournent tant que votre navigateur est ouvert. Selio Cloud, fonctionnalité de Selio Manager encore en développement, les fera continuer ordinateur éteint." },
    ],
    sharedFaq: ["risque-compte", "carte-essai"],
    offers: true,
  },
  {
    path: "/annonce-vinted-ia",
    product: "studio",
    title: "Vos annonces Vinted rédigées par l'IA, à partir de vos photos",
    lead: "Ajoutez les photos : Selio Studio lit l'étiquette, vous demande ce qui manque, puis rédige un titre optimisé et une description détaillée. Vous relisez au lieu de tout taper.",
    proofs: ["Titres optimisés", "Descriptions détaillées", "Questions plutôt que suppositions"],
    limits: ["N'invente ni mesure, ni marque, ni taille : sans provenance, le champ reste vide.", "Ne publie rien sur Vinted sans votre validation."],
    faq: [
      { id: "ia-invente", question: "L'IA invente-t-elle des informations ?", answer: "Non : ce qui ne se lit pas sur les photos vous est demandé. Sans provenance (photo lue ou saisie par vous), le champ reste vide plutôt que deviné." },
      { id: "publication-auto", question: "L'annonce est-elle publiée toute seule ?", answer: "Non, rien n'est publié sur Vinted sans votre validation : Studio prépare l'annonce, vous la relisez." },
      { id: "quota-studio", question: "Combien d'annonces sont comprises ?", answer: `${Q.pro.studioListingsPerMonth} annonces par mois avec ${P.pro} (et pendant l'essai, qui donne les limites de l'offre ${P[TRIAL_PLAN]}), ${Q.agence.studioListingsPerMonth} avec ${P.agence}. Selio Studio existe aussi seul, payé à la photo, sans abonnement.` },
    ],
    sharedFaq: ["carte-essai"],
    offers: false,
  },
  {
    path: "/prix-revente-vinted",
    product: "track",
    title: "Estimer le prix de revente sur Vinted, avant d'acheter ou de vendre",
    lead: "Selio Track compare les annonces et les ventes proches pour donner une fourchette de prix, trois stratégies et un délai de vente estimé. Il analyse ; il n'achète pas.",
    proofs: ["Estimation des prix de revente", "Produits similaires", "Analyse des niches"],
    limits: ["Ne présente jamais une annonce disparue comme une vente certaine : on parle de ventes estimées.", "Ne lit pas encore le site réel : simulateur par défaut, en attendant l'avis de l'avocat."],
    faq: [
      { id: "source-prix", question: "D'où viennent les prix ?", answer: "D'annonces et de ventes comparables. Une annonce disparue compte comme une vente estimée, jamais comme une vente certaine. Aujourd'hui, Selio Track fonctionne sur un marché simulé, signalé à l'écran." },
      { id: "track-achete", question: "Selio Track achète-t-il des articles ?", answer: "Non. Track analyse et identifie ; la recherche et l'achat, c'est Selio Bot." },
      { id: "track-offre", question: "Dans quelle offre ?", answer: `Compris à partir de l'offre ${P.pro} (et pendant l'essai), avec des quotas de scans de niche et de recherches par photo.` },
    ],
    sharedFaq: ["carte-essai"],
    offers: false,
  },
  {
    path: "/bot-achat-vinted",
    product: "bot",
    title: "Un bot d'achat Vinted qui repère les bonnes affaires selon vos critères",
    lead: "Selio Bot surveille les nouvelles annonces, note chaque affaire sur 100 avec son prix de revente et sa marge estimés, et vous alerte. Vous décidez, dans vos limites de dépenses.",
    proofs: ["Bonnes affaires notées sur 100", "Alertes", "Limites de dépenses"],
    limits: ["N'achète rien réellement aujourd'hui : l'achat réel est désactivé et chaque achat est simulé.", "Ne saisit jamais de code 3-D Secure ni de moyen de paiement."],
    faq: [
      { id: "bot-achete", question: "Selio Bot achète-t-il à ma place ?", answer: "Pas aujourd'hui : l'achat réel est désactivé et chaque achat est simulé, ce qui est signalé à l'écran. L'achat automatique sera une option désactivée par défaut, toujours dans vos limites de dépenses." },
      { id: "note-100", question: "Comment la note sur 100 est-elle calculée ?", answer: "Marge, état et photos, marque et demande, vendeur, port : chaque critère est affiché à côté du total, pour comprendre la note et pas seulement la lire." },
      { id: "prix-bot", question: "Combien coûte Selio Bot ?", answer: `Selio Bot est une option : ${botPrice}, en plus de votre offre. L'option d'achat automatique est à part et reste désactivée.` },
    ],
    sharedFaq: ["risque-compte"],
    offers: false,
    ctaNote: "Selio Bot est une option au mois, en plus de votre offre : voir les tarifs.",
  },
];

export function landingByPath(path: string): LandingDef | undefined {
  return LANDINGS.find((l) => l.path === path);
}

export function landingProduct(landing: LandingDef): ProductDef {
  const p = PRODUCT_PAGES.find((x) => x.slug === landing.product);
  if (!p) throw new Error(`Filiale inconnue : ${landing.product}`);
  return p;
}

/** Questions affichées (et décrites en FAQPage) : les questions propres, puis les objections communes. */
export function landingFaq(landing: LandingDef): Objection[] {
  return [...landing.faq, ...landing.sharedFaq.map(objection)];
}
