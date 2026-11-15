/**
 * La gamme Selio sur la vitrine, une page par produit (/produits/<slug>), dans
 * l'ordre du parcours : Manager, Studio, Track, Radar, Bot, Cloud, Agents,
 * Selio Comptes. Même structure pour toutes (promesse honnête, ce que fait le
 * produit, ce qu'il ne fait pas, capture, prix « voir tarifs », mention
 * d'indépendance). Les noms suivent app/spaces/spaces.tsx ; Radar vit dans
 * Selio Manager mais a sa page. Les états sont ceux de docs/BUILD_STATUS.md :
 * rien n'est présenté comme disponible s'il ne l'est pas. La vitrine ne renvoie
 * jamais vers la démonstration : les captures montrent des données d'exemple.
 */
import type { SpaceId } from "../app/spaces/spaces";

export type ProductSlug = "manager" | "studio" | "track" | "radar" | "bot" | "cloud" | "agents" | "comptes";
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
  /** Espace correspondant dans l'application (aucun pour Radar, qui vit dans Selio Manager). */
  spaceId: SpaceId | null;
  /** Résumé d'une ligne (cartes de la gamme sur l'accueil et la plateforme). */
  tagline: string;
  /** Promesse honnête : le titre de la page. */
  promise: string;
  lead: string;
  state: { value: ProductStateValue; label: string; note: string };
  does: ProductFeature[];
  doesNot: string[];
  /** Ancre de la page Tarifs où le module est chiffré. */
  pricingHref: string;
  pricingNote: string;
  /** Capture d'écran sur données d'exemple (clé de ../productShots) et sa description. */
  shot: { key: ProductSlug; alt: string; caption: string };
}

export const PRODUCTS: readonly ProductDef[] = [
  {
    slug: "manager",
    path: "/produits/manager",
    name: "Selio Manager",
    spaceId: "selio",
    tagline: "La gestion quotidienne de vos comptes Vinted : stock, messages, commandes, étiquettes et marges.",
    promise: "La gestion de vos comptes Vinted, au même endroit",
    lead: "Stock, dressing, messagerie, négociation, commandes, bordereaux et marges de tous vos comptes Vinted. Vos règles décident des prix, mon IA perso rédige, vous validez.",
    state: { value: "available", label: "Disponible", note: "Disponible avec un compte. La lecture des pages Vinted passe par l'extension, encore expérimentale." },
    does: [
      { title: "Stock pensé pour la revente", text: "Prix d'achat, frais, prix affiché et prix plancher, statuts contrôlés, import et export CSV avec aperçu des erreurs." },
      { title: "Dressing noté sur 100", text: "Chaque annonce notée avec ce qu'il faut améliorer, un tri « en ligne depuis 7 jours et plus » et des republications prêtes." },
      { title: "Messagerie et négociation", text: "Chaque conversation connaît l'article, son plancher et votre marge. La politique de prix décide, l'IA ne fait que rédiger." },
      { title: "Commandes, étiquettes et marges", text: "Une commande par vente, sans doublon, bordereau commandé dès la vente, marge figée du prix d'achat à la revente." },
      { title: "Automatisations bornées", text: "Messages aux favoris, réponses, négociation, après-vente : horaires, plafonds par jour, pause et arrêt global. Selio Cloud les fait tourner ordinateur éteint." },
      { title: "Équipe et rôles", text: "Titulaire, administrateur, exécuteur (sans les finances), contributeur photos et lecture seule pour le comptable." },
    ],
    doesNot: [
      "Ne demande ni ne stocke votre mot de passe Vinted.",
      "Ne contourne aucun CAPTCHA ni aucune protection anti-robot ; s'arrête au premier signal.",
      "N'envoie aucun message sans règle explicite ni validation de votre part.",
      "Ne présente pas la marge brute comme un bénéfice net comptable, et ne donne aucun conseil fiscal.",
      "Ne se connecte jamais à un autre outil à votre place : la migration part d'un texte collé, de captures ou d'un fichier que vous fournissez.",
    ],
    pricingHref: "/tarifs#comparer",
    pricingNote: "Compris dans toutes les offres (Starter, Pro, Agence), selon le nombre de comptes Vinted.",
    shot: { key: "manager", alt: "Dressing intelligent de Selio Manager : annonces notées sur 100, ancienneté en ligne et republications conseillées (statistiques d'exemple).", caption: "Capture d'écran : vraies photos d'annonces, statistiques d'exemple." },
  },
  {
    slug: "studio",
    path: "/produits/studio",
    name: "Selio Studio",
    spaceId: "studio",
    tagline: "Vos photos deviennent des annonces : étiquette lue, questions posées, prix tiré des ventes comparables.",
    promise: "Vos photos deviennent des annonces, sans valeur inventée",
    lead: "Ajoutez les photos d'un ou plusieurs articles : Studio les trie, lit l'étiquette et le mètre ruban, vous pose les questions qui manquent, puis rédige l'annonce.",
    state: { value: "demo", label: "Aperçu", note: "Tant que le modèle d'IA n'est pas raccordé, un simulateur rédige les annonces, et c'est signalé à l'écran. La précision sur nos propres photos est à mesurer avant toute annonce chiffrée." },
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
    pricingHref: "/tarifs#filiales",
    pricingNote: "Inclus dans Pro et Agence avec un quota d'annonces, ou seul, payé à la photo.",
    shot: { key: "studio", alt: "Selio Studio : photos d'un article, champs lus avec leur provenance et annonce rédigée.", caption: "Capture d'écran : données d'exemple, IA simulée et signalée à l'écran." },
  },
  {
    slug: "track",
    path: "/produits/track",
    name: "Selio Track",
    spaceId: "track",
    tagline: "Les statistiques du marché Vinted pour sourcer au bon endroit et fixer vos prix.",
    promise: "Les statistiques du marché Vinted, pour sourcer au bon endroit",
    lead: "Suivez des filtres Vinted et voyez leur prix médian, leurs annonces actives et leurs ventes estimées ; notez une niche sur 100 ; estimez un prix à partir d'une photo.",
    state: { value: "planned", label: "En développement", note: "Fonctionne sur un marché simulé, signalé à l'écran. La lecture réelle reste fermée tant que l'avis juridique n'est pas rendu." },
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
    pricingHref: "/tarifs#comparer",
    pricingNote: "Compris à partir de l'offre Pro, avec des quotas de scans et de recherches par photo.",
    shot: { key: "track", alt: "Selio Track : filtres suivis, prix médian et ventes estimées sur un marché simulé.", caption: "Capture d'écran : marché simulé, signalé à l'écran." },
  },
  {
    slug: "radar",
    path: "/produits/radar",
    name: "Selio Radar",
    spaceId: null,
    tagline: "Les bonnes affaires de vos recherches, notées sur 100 avec leur coût réel et leur revente estimée.",
    promise: "Les bonnes affaires de vos recherches, notées sur 100",
    lead: "Radar lit vos recherches depuis votre compte Achat, calcule le coût réel et la revente estimée, note chaque affaire sur 100 et vous prévient sur le téléphone. C'est vous qui achetez.",
    state: { value: "demo", label: "Aperçu", note: "La lecture en direct est encore simulée, et c'est signalé à l'écran. L'achat automatique (Radar Auto) est désactivé pour les clients." },
    does: [
      { title: "Note sur 100 expliquée", text: "Marge, état et photos, marque et demande, port : chaque critère est affiché, pas seulement le total." },
      { title: "Coût réel", text: "Prix, port et protection acheteurs additionnés, face à une revente estimée par des ventes proches." },
      { title: "Alerte sur le téléphone", text: "Une notification quand une affaire passe votre seuil, avec une page « 1 clic » pour décider." },
      { title: "Marge de bout en bout", text: "« Je l'ai achetée » reporte le prix d'achat dans Selio Manager : la marge suit l'article jusqu'à la revente." },
      { title: "Rythme prudent", text: "Ralentissement automatique au-delà d'un blocage pour 1 000 pages lues, et arrêt au premier CAPTCHA." },
    ],
    doesNot: [
      "N'achète rien à votre place : Radar Auto est désactivé et n'est pas proposé aux clients aujourd'hui.",
      "Ne saisit jamais de code 3-D Secure ni de moyen de paiement.",
      "Ne garde le pseudo et la note d'un vendeur que le temps de l'affaire (effacés après 30 jours), jamais dans une notification.",
      "Ne contourne aucune protection et ne masque aucune adresse IP.",
    ],
    pricingHref: "/tarifs#filiales",
    pricingNote: "Son propre prix, sur la page Tarifs ; Radar Auto est à part et reste désactivé.",
    shot: { key: "radar", alt: "Selio Radar : affaires notées sur 100, coût réel et bénéfice estimé.", caption: "Capture d'écran : données d'exemple, lecture en direct simulée." },
  },
  {
    slug: "bot",
    path: "/produits/bot",
    name: "Selio Bot",
    spaceId: "bot",
    tagline: "Les automatisations qui travaillent pour vous : négociation, relances, republications et achat automatique.",
    promise: "Les automatisations qui travaillent pour vous, selon vos règles",
    lead: "Négociation, relances, republications et achat automatique : Selio Bot applique vos règles de prix, vos horaires et vos plafonds, et s'exécute dans Selio Cloud pour continuer ordinateur éteint.",
    state: { value: "planned", label: "En développement", note: "Les règles de négociation, de relance et d'après-vente existent déjà dans Selio Manager. Leur exécution dans Selio Cloud est construite et testée sur des pages locales, jamais encore contre Vinted." },
    does: [
      { title: "Négociation automatique", text: "Accepter, contre-proposer ou refuser selon votre prix plancher et vos paliers de marge ; l'IA rédige, vos règles décident." },
      { title: "Relances", text: "Une relance après 24 h sans réponse : proposée en Pro, automatique en Agence." },
      { title: "Republications", text: "Les annonces qui stagnent repérées, leur variante de republication prête ; la republication automatique reste désactivée tant qu'elle n'est pas validée." },
      { title: "Achat automatique", text: "Au-dessus de votre note minimale, avec un plafond par jour, un prix maximal et un délai d'annulation. Il s'appuie sur Selio Radar et son option Radar Auto." },
      { title: "Exécuté dans Selio Cloud", text: "Un navigateur isolé par compte Vinted, au rythme humain : le Bot continue quand votre ordinateur est éteint." },
      { title: "Pause et journal", text: "Chaque action est journalisée ; pause par règle, arrêt global en un clic, arrêt automatique au premier avertissement." },
    ],
    doesNot: [
      "N'a pas de prix séparé : il est inclus selon votre forfait (voir ci-dessous).",
      "Ne stocke aucun mot de passe Vinted et ne contourne aucun CAPTCHA.",
      "N'achète rien tant qu'aucun connecteur d'achat n'est autorisé : l'achat automatique reste désactivé par défaut.",
      "Ne reprend jamais seul après un avertissement : la reprise vous appartient.",
    ],
    pricingHref: "/tarifs#comparer",
    pricingNote: "Sans prix séparé. Starter : négociation, réponses et après-vente tant que votre navigateur est ouvert, Selio Cloud en option. Pro : relance après 24 h proposée, Selio Cloud en option. Agence : relance automatique et Selio Cloud inclus, 24 h/24.",
    shot: { key: "bot", alt: "Selio Bot : les automatisations et leur journal.", caption: "Capture d'écran à venir." },
  },
  {
    slug: "cloud",
    path: "/produits/cloud",
    name: "Selio Cloud",
    spaceId: "cloud",
    tagline: "Le moteur qui fait tourner Selio Manager, Selio Bot et vos équipes 24 h/24, ordinateur éteint.",
    promise: "Le moteur qui fait tourner Selio 24 h/24, ordinateur éteint",
    lead: "Selio Cloud fait tourner Selio Manager, Selio Bot et les équipes de Selio Agents sans ordinateur allumé : un navigateur isolé par compte Vinted sur notre machine en France, où vous vous connectez vous-même. Selio répond et relance au rythme humain, avec votre accord, compte par compte.",
    state: { value: "planned", label: "En développement", note: "Construit et testé sur des pages locales ; jamais exécuté contre Vinted. L'accord est à lire avant toute activation." },
    does: [
      { title: "Le moteur de toute la gamme", text: "Les automatisations de Selio Manager et de Selio Bot, et le travail de l'équipe dans Selio Agents, continuent ordinateur éteint." },
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
    pricingHref: "/tarifs#filiales",
    pricingNote: "Inclus dans l'offre Agence ; en option pour Starter et Pro.",
    shot: { key: "cloud", alt: "Selio Cloud : comptes Cloud, état de la connexion et journal des actions.", caption: "Capture d'écran : données d'exemple, connexion simulée, aucune action réelle." },
  },
  {
    slug: "agents",
    path: "/produits/agents",
    name: "Selio Agents",
    spaceId: "agents",
    tagline: "Travailler à plusieurs : équipes, rôles, accès, et les boutiques clientes des agences.",
    promise: "Votre équipe sur vos comptes Vinted, chacun avec les bons accès",
    lead: "L'administrateur, les membres de l'équipe et leurs accès, au même endroit. Les agences et dépôts-vente y suivent aussi leurs boutiques clientes ; avec Selio Cloud, le travail continue ordinateur éteint.",
    state: { value: "demo", label: "Aperçu", note: "L'équipe, les rôles et le journal d'audit sont réels. Les boutiques clientes, la marque blanche et la facturation des clients sont en aperçu, sur des exemples fictifs." },
    does: [
      { title: "Équipe et invitations", text: "Chaque personne avec son identifiant, invitée par email, retirée en un clic." },
      { title: "Rôles", text: "Titulaire, administrateur, exécuteur (sans les finances), contributeur photos et lecture seule pour le comptable." },
      { title: "Journal d'audit", text: "Les actions sensibles gardent qui a fait quoi, et quand." },
      { title: "Boutiques clientes (aperçu)", text: "Pour les agences et dépôts-vente : les boutiques suivies, leur marque blanche et leur facturation." },
      { title: "Avec Selio Cloud", text: "Les automatisations de l'équipe tournent 24 h/24, compte par compte, avec l'accord du titulaire." },
    ],
    doesNot: [
      "Ne partage aucun mot de passe Vinted entre membres : chacun a son identifiant Selio.",
      "Ne montre pas les finances à un exécuteur ni à un contributeur photos.",
      "N'encaisse rien pour le compte des agences : la facturation des clients est un aperçu.",
    ],
    pricingHref: "/tarifs#comparer",
    pricingNote: "Rôles d'équipe et journal d'audit dans l'offre Agence (jusqu'à 10 personnes) ; 3 personnes en Pro.",
    shot: { key: "agents", alt: "Selio Agents : membres de l'équipe, rôles et accès.", caption: "Capture d'écran : données d'exemple." },
  },
  {
    slug: "comptes",
    path: "/produits/comptes",
    name: "Selio Comptes",
    spaceId: "generateur",
    tagline: "À la prestation : audit ou mise en place de votre boutique Vinted, payé une fois.",
    promise: "À la prestation : votre boutique Vinted auditée ou mise en place",
    lead: "Un service ponctuel, payé une fois, en trois niveaux : l'audit de votre boutique, sa mise en place complète, ou un accompagnement de 30 jours. Vous gardez la main sur votre compte : tout se fait par vous, dans Vinted.",
    state: { value: "available", label: "Sur demande", note: "Prestation commandée depuis la page Contact ; le paiement en ligne n'est pas encore ouvert. La checklist et les textes à copier sont disponibles dans l'application." },
    does: [
      { title: "Audit de boutique", text: "Votre boutique relue de l'extérieur : présentation, photos, titres, prix, règles d'envoi. Un rapport et les corrections prioritaires." },
      { title: "Mise en place complète", text: "Présentation, règles d'envoi, réponses types et premières annonces préparées avec vous, à copier dans Vinted." },
      { title: "Accompagnement 30 jours", text: "La mise en place, puis deux points d'étape sur vos premières ventes : prix, republications, réglages de Selio Manager." },
      { title: "Checklist et textes inclus", text: "Dans l'application : la checklist à cocher, de l'inscription aux premières annonces, et les textes prêts à copier." },
    ],
    doesNot: [
      "Ne crée aucun compte Vinted à votre place.",
      "Ne se connecte pas à Vinted et n'y agit pas : vous copiez, vous publiez.",
      "Ne demande ni ne garde aucun identifiant Vinted.",
      "Ne promet aucun chiffre de vente.",
    ],
    pricingHref: "/tarifs#filiales",
    pricingNote: "Trois niveaux, payés une fois : audit, mise en place complète, accompagnement de 30 jours.",
    shot: { key: "comptes", alt: "Selio Comptes : checklist d'ouverture de boutique et textes à copier.", caption: "Capture d'écran : la checklist incluse, données d'exemple." },
  },
];

export function productBySlug(slug: string | undefined): ProductDef | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

/** Page produit d'un espace de l'application. */
export function productForSpace(spaceId: SpaceId): ProductDef | undefined {
  return PRODUCTS.find((p) => p.spaceId === spaceId);
}
