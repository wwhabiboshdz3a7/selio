/**
 * Une page par filiale sur la vitrine (/produits/<slug>) : même structure pour
 * toutes (promesse honnête, ce que fait le module, ce qu'il ne fait pas,
 * capture, prix « voir tarifs », mention d'indépendance). Les noms suivent
 * app/spaces/spaces.tsx ; Radar vit dans Selio (Manager) mais a sa page, comme
 * dans le compte rendu de réunion. Les états sont ceux de docs/BUILD_STATUS.md :
 * rien n'est présenté comme disponible s'il ne l'est pas.
 */
import type { SpaceId } from "../app/spaces/spaces";

export type ProductSlug = "manager" | "studio" | "track" | "radar" | "cloud" | "comptes";
export type ProductStateValue = "available" | "demo" | "experimental" | "planned";

export interface ProductFeature {
  title: string;
  text: string;
}

export interface ProductDef {
  slug: ProductSlug;
  path: `/produits/${ProductSlug}`;
  /** Nom complet affiché (« Selio Studio »). */
  name: string;
  /** Espace correspondant dans l'application (aucun pour Radar, qui vit dans Selio). */
  spaceId: SpaceId | null;
  /** Promesse honnête : le titre de la page. */
  promise: string;
  lead: string;
  state: { value: ProductStateValue; label: string; note: string };
  does: ProductFeature[];
  doesNot: string[];
  /** Où le voir dans la démonstration (données fictives). */
  demoPath: string;
  /** Ancre de la page Tarifs où le module est chiffré. */
  pricingHref: string;
  pricingNote: string;
  /** Capture de la démonstration (clé de ../productShots) et sa description. */
  shot: { key: ProductSlug; alt: string; caption: string };
}

export const PRODUCTS: readonly ProductDef[] = [
  {
    slug: "manager",
    path: "/produits/manager",
    name: "Selio Manager",
    spaceId: "selio",
    promise: "La gestion de vos comptes Vinted, au même endroit",
    lead: "Stock, dressing, messagerie, négociation, commandes et marges de tous vos comptes Vinted. Vos règles décident des prix, mon IA perso rédige, vous validez.",
    state: { value: "available", label: "Disponible", note: "Disponible en démonstration et en mode connecté. La lecture des pages Vinted passe par l'extension, encore expérimentale." },
    does: [
      { title: "Stock pensé pour la revente", text: "Prix d'achat, frais, prix affiché et prix plancher, statuts contrôlés, import et export CSV avec aperçu des erreurs." },
      { title: "Dressing noté sur 100", text: "Chaque annonce notée avec ce qu'il faut améliorer, un tri « en ligne depuis 7 jours et plus » et des republications prêtes." },
      { title: "Messagerie et négociation", text: "Chaque conversation connaît l'article, son plancher et votre marge. La politique de prix décide, l'IA ne fait que rédiger." },
      { title: "Commandes et marges", text: "Une commande par vente, sans doublon, marge figée au moment de la vente, du prix d'achat à la revente." },
      { title: "Automatisations bornées", text: "Messages aux favoris, réponses, négociation, après-vente : horaires, plafonds par jour, pause et arrêt global." },
      { title: "Équipe et rôles", text: "Titulaire, administrateur, exécuteur (sans les finances), contributeur photos et lecture seule pour le comptable." },
    ],
    doesNot: [
      "Ne demande ni ne stocke votre mot de passe Vinted.",
      "Ne contourne aucun CAPTCHA ni aucune protection anti-robot ; s'arrête au premier signal.",
      "N'envoie aucun message sans règle explicite ni validation de votre part.",
      "Ne présente pas la marge brute comme un bénéfice net comptable, et ne donne aucun conseil fiscal.",
      "Ne se connecte jamais à un autre outil à votre place : la migration part d'un texte collé, de captures ou d'un fichier que vous fournissez.",
    ],
    demoPath: "/app",
    pricingHref: "/tarifs#comparer",
    pricingNote: "Compris dans toutes les offres (Starter, Pro, Agence), selon le nombre de comptes Vinted.",
    shot: { key: "manager", alt: "Dressing intelligent de la démonstration Selio : annonces notées sur 100, ancienneté en ligne et republications conseillées (statistiques fictives).", caption: "Capture de la démonstration : vraies photos d'annonces, statistiques fictives." },
  },
  {
    slug: "studio",
    path: "/produits/studio",
    name: "Selio Studio",
    spaceId: "studio",
    promise: "Vos photos deviennent des annonces, sans valeur inventée",
    lead: "Ajoutez les photos d'un ou plusieurs articles : Studio les trie, lit l'étiquette et le mètre ruban, vous pose les questions qui manquent, puis rédige l'annonce.",
    state: { value: "demo", label: "En démonstration", note: "La démonstration utilise un simulateur, signalé à l'écran. La précision sur nos propres photos est à mesurer avant toute annonce chiffrée." },
    does: [
      { title: "Photos triées par article", text: "Déposez une série de photos : elles sont regroupées article par article, que vous corrigez si besoin." },
      { title: "Étiquette et mesures lues", text: "Marque, taille, composition et mesures au mètre ruban, chacune avec sa provenance (photo lue ou saisie)." },
      { title: "Questions au vendeur", text: "Ce qui ne se lit pas sur les photos vous est demandé : le champ reste vide plutôt que deviné." },
      { title: "Annonce rédigée", text: "Titre, description et attributs rédigés à partir de la préparation que vous avez validée." },
      { title: "Prix tiré des ventes comparables", text: "Fourchette et délai estimés à partir de ventes proches ; l'IA explique le prix, elle ne le choisit jamais." },
      { title: "Ce qui performe", text: "Historique des annonces générées, leur note du dressing et ce que vos ventes apprennent." },
    ],
    doesNot: [
      "N'invente ni mesure, ni marque, ni taille : sans provenance, le champ reste vide.",
      "Ne publie rien sur Vinted sans votre validation.",
      "Ne garantit aucune vente ni aucun délai : l'estimation reste une estimation.",
      "Les photos portées ne sont pas encore proposées : aucun fournisseur n'est choisi.",
    ],
    demoPath: "/studio",
    pricingHref: "/tarifs#filiales",
    pricingNote: "Inclus dans Pro et Agence avec un quota d'annonces, ou seul, payé à la photo.",
    shot: { key: "studio", alt: "Selio Studio dans la démonstration : photos d'un article, champs lus avec leur provenance et annonce rédigée.", caption: "Capture de la démonstration : IA simulée, signalée à l'écran." },
  },
  {
    slug: "track",
    path: "/produits/track",
    name: "Selio Track",
    spaceId: "track",
    promise: "Les statistiques du marché Vinted, pour sourcer au bon endroit",
    lead: "Suivez des filtres Vinted et voyez leur prix médian, leurs annonces actives et leurs ventes estimées ; notez une niche sur 100 ; estimez un prix à partir d'une photo.",
    state: { value: "planned", label: "En développement", note: "Fonctionne sur un marché simulé, signalé « données de démonstration ». La lecture réelle reste fermée tant que l'avis juridique n'est pas rendu." },
    does: [
      { title: "Filtres suivis", text: "Prix médian, annonces actives et ventes estimées, relus toutes les 2 heures, avec la tendance sur 30 jours." },
      { title: "Scans de niche", text: "Une marque dans une catégorie, notée sur 100 : demande, concurrence, prix et rotation." },
      { title: "Recherche par photo", text: "Une fourchette de prix (bas, médian, haut), trois stratégies et un délai de vente estimé." },
      { title: "Flux des ventes", text: "Pour l'offre Agence : les ventes estimées par marque et par catégorie." },
    ],
    doesNot: [
      "Ne republie aucune annonce : Track n'en tire que des statistiques.",
      "Ne garde ni pseudo, ni profil, ni photo de vendeur.",
      "Ne présente jamais une annonce disparue comme une vente certaine : on parle de ventes estimées.",
      "Ne lit pas encore le site réel : simulateur par défaut, en attendant l'avis de l'avocat.",
    ],
    demoPath: "/track",
    pricingHref: "/tarifs#comparer",
    pricingNote: "Compris à partir de l'offre Pro, avec des quotas de scans et de recherches par photo.",
    shot: { key: "track", alt: "Selio Track dans la démonstration : filtres suivis, prix médian et ventes estimées sur un marché simulé.", caption: "Capture de la démonstration : marché simulé, signalé « données de démonstration »." },
  },
  {
    slug: "radar",
    path: "/produits/radar",
    name: "Selio Radar",
    spaceId: null,
    promise: "Les bonnes affaires de vos recherches, notées sur 100",
    lead: "Radar lit vos recherches depuis votre compte Achat, calcule le coût réel et la revente estimée, note chaque affaire sur 100 et vous prévient sur le téléphone. C'est vous qui achetez.",
    state: { value: "demo", label: "En démonstration", note: "La lecture en direct est simulée et signalée dans la démonstration. L'achat automatique (Radar Auto) est désactivé pour les clients." },
    does: [
      { title: "Note sur 100 expliquée", text: "Marge, état et photos, marque et demande, port : chaque critère est affiché, pas seulement le total." },
      { title: "Coût réel", text: "Prix, port et protection acheteurs additionnés, face à une revente estimée par des ventes proches." },
      { title: "Alerte sur le téléphone", text: "Une notification quand une affaire passe votre seuil, avec une page « 1 clic » pour décider." },
      { title: "Marge de bout en bout", text: "« Je l'ai achetée » reporte le prix d'achat dans Selio : la marge suit l'article jusqu'à la revente." },
      { title: "Rythme prudent", text: "Ralentissement automatique au-delà d'un blocage pour 1 000 pages lues, et arrêt au premier CAPTCHA." },
    ],
    doesNot: [
      "N'achète rien à votre place : Radar Auto est désactivé et n'est pas proposé aux clients aujourd'hui.",
      "Ne saisit jamais de code 3-D Secure ni de moyen de paiement.",
      "Ne garde le pseudo et la note d'un vendeur que le temps de l'affaire (effacés après 30 jours), jamais dans une notification.",
      "Ne contourne aucune protection et ne masque aucune adresse IP.",
    ],
    demoPath: "/app/radar",
    pricingHref: "/tarifs#filiales",
    pricingNote: "Son propre prix, sur la page Tarifs ; Radar Auto est à part et reste désactivé.",
    shot: { key: "radar", alt: "Selio Radar dans la démonstration : affaires notées sur 100, coût réel et bénéfice estimé.", caption: "Capture de la démonstration : lecture en direct simulée." },
  },
  {
    slug: "cloud",
    path: "/produits/cloud",
    name: "Selio Cloud",
    spaceId: "cloud",
    promise: "Vos réponses et relances continuent, ordinateur éteint",
    lead: "Un navigateur isolé par compte Vinted sur notre machine en France. Vous vous y connectez vous-même ; Selio répond et relance au rythme humain, avec votre accord, compte par compte.",
    state: { value: "planned", label: "En développement", note: "Construit et testé sur des pages locales ; jamais exécuté contre Vinted. L'accord est à lire avant toute activation." },
    does: [
      { title: "Répondre et relancer", text: "Réponses aux messages et relance après 24 h sans réponse, selon vos règles et vos horaires." },
      { title: "Connexion par vous", text: "Une fenêtre sécurisée où vous vous connectez vous-même : Selio ne voit jamais votre mot de passe." },
      { title: "Une session par compte", text: "Chiffrée, isolée, jamais partagée, supprimée dès que vous vous déconnectez ou résiliez." },
      { title: "Pause au premier signal", text: "Au premier avertissement ou CAPTCHA, le compte s'arrête, vous êtes prévenu, rien n'est retenté." },
      { title: "Journal des actions", text: "Chaque action gardée 90 jours, exportable en CSV, avec une pause et un arrêt en un clic." },
    ],
    doesNot: [
      "Ne stocke aucun mot de passe Vinted.",
      "Ne masque aucune adresse IP et n'utilise aucun proxy par compte : tous les comptes passent par la même adresse, c'est expliqué avant l'activation.",
      "Ne republie pas et ne modifie pas en masse : ces actions lourdes restent désactivées.",
      "Ne reprend jamais seul après un avertissement : la reprise vous appartient.",
    ],
    demoPath: "/cloud",
    pricingHref: "/tarifs#filiales",
    pricingNote: "Compris dans l'offre Agence ; option pour Pro à décider.",
    shot: { key: "cloud", alt: "Selio Cloud dans la démonstration : comptes Cloud, état de la connexion et journal des actions.", caption: "Capture de la démonstration : connexion simulée, aucune action réelle." },
  },
  {
    slug: "comptes",
    path: "/produits/comptes",
    name: "Selio Comptes",
    spaceId: "generateur",
    promise: "Ouvrir sa boutique Vinted, étape par étape",
    lead: "Une checklist à suivre vous-même dans Vinted pour ouvrir et préparer un compte vendeur, et les textes prêts à copier : présentation, règles d'envoi, réponses types.",
    state: { value: "available", label: "Disponible", note: "Disponible en démonstration et en mode connecté. Tout se fait par vous, dans Vinted." },
    does: [
      { title: "Checklist à cocher", text: "De l'inscription aux premières annonces, dans l'ordre, avec ce qu'il faut préparer à chaque étape." },
      { title: "Présentation et règles d'envoi", text: "Rédigées à partir de vos réponses, à relire puis à copier dans Vinted." },
      { title: "Réponses types", text: "Les messages qui reviennent (disponibilité, envoi, lot), prêts à copier." },
    ],
    doesNot: [
      "Ne crée aucun compte Vinted à votre place.",
      "Ne se connecte pas à Vinted et n'y agit pas : vous copiez, vous publiez.",
      "Ne demande ni ne garde aucun identifiant Vinted.",
    ],
    demoPath: "/comptes",
    pricingHref: "/tarifs#filiales",
    pricingNote: "Son propre prix, sur la page Tarifs.",
    shot: { key: "comptes", alt: "Selio Comptes dans la démonstration : checklist d'ouverture de boutique et textes à copier.", caption: "Capture de la démonstration." },
  },
];

export function productBySlug(slug: string | undefined): ProductDef | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

/** Page produit d'un espace de l'application (aucune pour Selio Agents). */
export function productForSpace(spaceId: SpaceId): ProductDef | undefined {
  return PRODUCTS.find((p) => p.spaceId === spaceId);
}
