/**
 * L'organisation officielle de Selio sur la vitrine : CINQ filiales, toujours dans cet ordre
 * (Selio Manager, Selio Studio, Selio Track, Selio Bot, Selio Compte), une page par filiale
 * (/produits/<slug>). Selio Cloud et Selio Agent ne sont PAS des filiales : ce sont deux
 * fonctionnalités intégrées à Selio Manager, chacune avec sa page « fonctionnalité de Selio
 * Manager » (fil d'Ariane « Selio Manager › Selio Cloud »), jamais présentées comme des produits.
 * « Selio Radar » n'existe plus : son contenu est dans Selio Bot (/produits/radar redirige).
 *
 * Même structure pour toutes les pages (promesse honnête, ce que fait le produit, ce qu'il ne
 * fait pas, capture, prix « voir tarifs », mention d'indépendance). Les états sont ceux de
 * docs/BUILD_STATUS.md : rien n'est présenté comme disponible s'il ne l'est pas. La vitrine ne
 * renvoie jamais vers la démonstration : les captures montrent des données d'exemple.
 */

/** Les cinq filiales, dans l'ordre officiel. */
export type SubsidiarySlug = "manager" | "studio" | "track" | "bot" | "compte";
/** Les fonctionnalités intégrées à Selio Manager (pas des filiales). */
export type ManagerFeatureSlug = "cloud" | "agent";
export type ProductSlug = SubsidiarySlug | ManagerFeatureSlug;
export type ProductStateValue = "available" | "demo" | "experimental" | "planned";

export interface ProductFeature {
  title: string;
  text: string;
}

export interface ProductDef {
  slug: ProductSlug;
  path: `/produits/${ProductSlug}`;
  /** « subsidiary » : une des cinq filiales ; « feature » : fonctionnalité intégrée à Selio Manager. */
  kind: "subsidiary" | "feature";
  /** Nom complet affiché (« Selio Studio »). */
  name: string;
  /** Positionnement en une phrase (cartes de la gamme, pied de page, plateforme). */
  tagline: string;
  /** Promesse honnête : le titre de la page. */
  promise: string;
  lead: string;
  /** Phrase de distinction affichée en encadré sous le titre (Manager et Bot). */
  distinction?: string;
  state: { value: ProductStateValue; label: string; note: string };
  does: ProductFeature[];
  doesNot: string[];
  /** Ancre de la page Tarifs où le module est chiffré. */
  pricingHref: string;
  pricingNote: string;
  /** Capture d'écran sur données d'exemple (clé de ../productShots) et sa description. */
  shot: { alt: string; caption: string };
}

/** Message clé de Selio Manager (décision des fondateurs), repris mot pour mot. */
export const MANAGER_KEY_MESSAGE = "Selio Manager centralise la gestion et l'automatisation de l'activité Vinted. Selio Cloud et Selio Agent viennent compléter ses possibilités.";

/** La distinction essentielle entre Selio Manager et Selio Bot, mot pour mot sur les deux pages. */
export const MANAGER_BOT_DISTINCTION = "Selio Manager gère et automatise votre compte (republication, messages, négociation, relances, marges) ; Selio Bot recherche, détecte et achète.";

/** Les cinq filiales, dans l'ordre officiel. */
export const PRODUCTS: readonly ProductDef[] = [
  {
    slug: "manager",
    path: "/produits/manager",
    kind: "subsidiary",
    name: "Selio Manager",
    tagline: "La gestion complète et l'automatisation de votre activité Vinted, avec Selio Cloud et Selio Agent intégrés.",
    promise: "La gestion et l'automatisation de votre activité Vinted, au même endroit",
    lead: `${MANAGER_KEY_MESSAGE} Stock, dressing, messages, négociation, relances, commandes et marges de tous vos comptes Vinted : vos règles décident des prix, l'IA rédige, vous validez.`,
    distinction: MANAGER_BOT_DISTINCTION,
    state: { value: "available", label: "Disponible", note: "Disponible avec un compte. La lecture des pages Vinted passe par l'extension, encore expérimentale ; Selio Cloud et la relance automatique sont en développement." },
    does: [
      { title: "Gestion du stock centralisée", text: "Prix d'achat, frais, prix affiché et prix plancher, statuts contrôlés, import et export CSV avec aperçu des erreurs, pour tous vos comptes." },
      { title: "Dressing intelligent", text: "Chaque annonce notée sur 100 avec ce qu'il faut améliorer, et un tri « en ligne depuis 7 jours et plus »." },
      { title: "Remise en ligne", text: "Les annonces qui stagnent repérées, dix variantes de republication prêtes et leur rendement suivi. La remise en ligne automatique reste désactivée tant qu'elle n'est pas validée." },
      { title: "Messagerie automatisée", text: "Messages aux favoris, réponses et après-vente selon vos règles et vos horaires, avec un brouillon que vous validez par défaut." },
      { title: "Négociation par IA", text: "Accepter, refuser ou contre-offrir selon votre prix plancher et vos paliers de marge : vos règles décident, l'IA rédige." },
      { title: "Relances automatiques", text: "Une relance après 24 h sans réponse : proposée en Pro, automatique en Agence avec Selio Cloud (en développement)." },
      { title: "Suivi des commandes et des ventes", text: "Une commande par vente, sans doublon, bordereau commandé dès la vente, jamais de faux bordereau." },
      { title: "Gestion des marges", text: "Marge figée du prix d'achat à la revente, analyses du chiffre d'affaires, de la marge et de la rotation." },
      { title: "Automatisations", text: "Des règles explicites : horaires, plafonds par jour, pause par règle, arrêt global et journal des actions." },
      { title: "Multi-comptes", text: "Vos comptes Vinted (vente, achat, perso) au même endroit : 1, 3 ou 10 selon l'offre." },
    ],
    doesNot: [
      "Ne demande ni ne stocke votre mot de passe Vinted.",
      "Ne contourne aucun CAPTCHA ni aucune protection anti-robot ; s'arrête au premier signal.",
      "N'envoie aucun message sans règle explicite ni validation de votre part.",
      "Ne présente pas la marge brute comme un bénéfice net comptable, et ne donne aucun conseil fiscal.",
      "Ne cherche ni n'achète d'articles : c'est le rôle de Selio Bot.",
    ],
    pricingHref: "/tarifs#comparer",
    pricingNote: "Compris dans toutes les offres (Starter, Pro, Agence), selon le nombre de comptes Vinted ; Selio Cloud inclus dans Agence, en option pour Starter et Pro.",
    shot: { alt: "Dressing intelligent de Selio Manager : annonces notées sur 100, ancienneté en ligne et republications conseillées (statistiques d'exemple).", caption: "Capture d'écran : vraies photos d'annonces, statistiques d'exemple." },
  },
  {
    slug: "studio",
    path: "/produits/studio",
    kind: "subsidiary",
    name: "Selio Studio",
    tagline: "La création et l'optimisation de vos annonces par l'IA : titres, descriptions, présentation.",
    promise: "Des annonces créées et optimisées par l'IA, sans valeur inventée",
    lead: "Ajoutez les photos d'un ou plusieurs articles : Studio les trie, lit l'étiquette et le mètre ruban, vous pose les questions qui manquent, puis rédige des titres optimisés et des descriptions détaillées. Du temps gagné à chaque annonce.",
    state: { value: "demo", label: "Aperçu", note: "Tant que le modèle d'IA n'est pas raccordé, un simulateur rédige les annonces, et c'est signalé à l'écran. La précision sur nos propres photos est à mesurer avant toute annonce chiffrée." },
    does: [
      { title: "Titres optimisés", text: "Marque, type d'article, taille et détails qui comptent, dans l'ordre où un acheteur les cherche." },
      { title: "Descriptions détaillées", text: "État, matière, mesures et défauts éventuels, rédigés à partir de la préparation que vous avez validée." },
      { title: "Une meilleure présentation", text: "Photos regroupées article par article, attributs lus sur l'étiquette avec leur provenance (photo lue ou saisie)." },
      { title: "Du temps gagné", text: "Une série de photos devient une suite d'annonces : vous relisez au lieu de tout taper." },
      { title: "Questions plutôt que suppositions", text: "Ce qui ne se lit pas sur les photos vous est demandé : le champ reste vide plutôt que deviné." },
      { title: "Prix tiré des ventes comparables", text: "Fourchette et délai estimés à partir de ventes proches ; l'IA explique le prix, elle ne le choisit jamais." },
    ],
    doesNot: [
      "N'invente ni mesure, ni marque, ni taille : sans provenance, le champ reste vide.",
      "Ne publie rien sur Vinted sans votre validation.",
      "Ne garantit aucune vente ni aucun délai : l'estimation reste une estimation.",
      "Les photos portées ne sont pas encore proposées : aucun fournisseur n'est choisi.",
    ],
    pricingHref: "/tarifs#filiales",
    pricingNote: "Inclus dans Pro et Agence avec un quota d'annonces, ou seul, payé à la photo.",
    shot: { alt: "Selio Studio : photos d'un article, champs lus avec leur provenance et annonce rédigée.", caption: "Capture d'écran : données d'exemple, IA simulée et signalée à l'écran." },
  },
  {
    slug: "track",
    path: "/produits/track",
    kind: "subsidiary",
    name: "Selio Track",
    tagline: "L'analyse du marché et la recherche d'opportunités, pour décider avant d'acheter ou de vendre.",
    promise: "Analyser le marché Vinted et repérer les opportunités, avant d'acheter ou de vendre",
    lead: "Suivez le marché, analysez une niche, retrouvez les produits similaires et estimez un prix de revente : Track vous aide à décider. Track analyse et identifie ; il n'achète pas.",
    state: { value: "planned", label: "En développement", note: "Fonctionne sur un marché simulé, signalé à l'écran. La lecture réelle reste fermée tant que l'avis juridique n'est pas rendu." },
    does: [
      { title: "Analyse des niches", text: "Une marque dans une catégorie, notée sur 100 : demande, concurrence, prix et rotation." },
      { title: "Suivi du marché", text: "Des filtres suivis : prix médian, annonces actives et ventes estimées, relus toutes les 2 heures, avec la tendance sur 30 jours." },
      { title: "Produits similaires", text: "À partir d'une photo, les annonces et ventes proches qui servent de comparaison." },
      { title: "Estimation des prix de revente", text: "Une fourchette (bas, médian, haut), trois stratégies de prix et un délai de vente estimé." },
      { title: "Opportunités identifiées", text: "Les niches à forte demande et peu concurrencées ressortent ; les ventes estimées par marque et catégorie pour l'offre Agence." },
      { title: "Aide à la décision", text: "Avant d'acheter ou de vendre : à quel prix, en combien de temps, avec quelle marge possible." },
    ],
    doesNot: [
      "N'achète rien : Track analyse et identifie ; la recherche et l'achat, c'est Selio Bot.",
      "Ne republie aucune annonce : Track n'en tire que des statistiques.",
      "Ne garde ni pseudo, ni profil, ni photo de vendeur.",
      "Ne présente jamais une annonce disparue comme une vente certaine : on parle de ventes estimées.",
      "Ne lit pas encore le site réel : simulateur par défaut, en attendant l'avis de l'avocat.",
    ],
    pricingHref: "/tarifs#comparer",
    pricingNote: "Compris à partir de l'offre Pro, avec des quotas de scans et de recherches par photo.",
    shot: { alt: "Selio Track : filtres suivis, prix médian et ventes estimées sur un marché simulé.", caption: "Capture d'écran : marché simulé, signalé à l'écran." },
  },
  {
    slug: "bot",
    path: "/produits/bot",
    kind: "subsidiary",
    name: "Selio Bot",
    tagline: "La recherche et l'achat d'articles : bonnes affaires notées sur 100, alertes, achat rapide ou automatisé.",
    promise: "Rechercher, repérer et acheter les bonnes affaires, selon vos critères",
    lead: "Selio Bot surveille les annonces selon vos critères, note chaque bonne affaire sur 100 avec son prix de revente estimé et son potentiel de marge, vous alerte, puis achète en un clic ou automatiquement, dans vos limites de dépenses.",
    distinction: MANAGER_BOT_DISTINCTION,
    state: { value: "demo", label: "Aperçu", note: "La lecture en direct est encore simulée, et c'est signalé à l'écran. L'achat réel est désactivé : chaque achat est simulé, et l'achat automatique n'est pas proposé aux clients aujourd'hui." },
    does: [
      { title: "Recherche selon vos critères", text: "Marques, tailles, catégories, prix maximal et marge cible : vos recherches tournent pour vous." },
      { title: "Surveillance des annonces", text: "Les nouvelles annonces de vos recherches relues régulièrement, avec un ralentissement automatique au premier blocage et un arrêt au premier CAPTCHA." },
      { title: "Alertes", text: "Une notification sur le téléphone quand une affaire passe votre seuil, avec une page « 1 clic » pour décider." },
      { title: "Bonnes affaires notées sur 100", text: "Marge, état et photos, marque et demande, vendeur, port : chaque critère du score d'intérêt est affiché, pas seulement le total." },
      { title: "Prix de revente et potentiel de marge", text: "Coût réel (prix, port, protection acheteurs) face à une revente estimée par des ventes proches : bénéfice et taux de marge." },
      { title: "Limites de dépenses", text: "Prix maximal par article, plafond par jour et délai d'annulation : rien ne dépasse vos limites." },
      { title: "Historique des achats", text: "Chaque achat gardé avec sa photo et son mode (rapide ou automatique) ; « Je l'ai achetée » reporte le prix d'achat dans Selio Manager." },
      { title: "Achat rapide ou automatisé", text: "En un clic après validation, ou automatiquement au-dessus de votre note minimale (option, désactivée par défaut)." },
    ],
    doesNot: [
      "Ne gère pas votre compte vendeur : republication, messages, négociation et relances, c'est Selio Manager.",
      "N'achète rien réellement aujourd'hui : l'achat réel est désactivé et chaque achat est simulé.",
      "Ne saisit jamais de code 3-D Secure ni de moyen de paiement.",
      "Ne garde le pseudo et la note d'un vendeur que le temps de l'affaire (effacés après 30 jours), jamais dans une notification.",
      "Ne contourne aucune protection et ne masque aucune adresse IP.",
    ],
    pricingHref: "/tarifs#filiales",
    pricingNote: "Son propre prix au mois, sur la page Tarifs ; l'option d'achat automatique est à part et reste désactivée.",
    shot: { alt: "Selio Bot : bonnes affaires notées sur 100, coût réel et bénéfice estimé.", caption: "Capture d'écran prise avant le renommage (la page y porte encore le nom « Radar ») : données d'exemple, lecture en direct simulée." },
  },
  {
    slug: "compte",
    path: "/produits/compte",
    kind: "subsidiary",
    name: "Selio Compte",
    tagline: "Les services autour de vos comptes Vinted : création, configuration de Selio Manager et accompagnement.",
    promise: "Vos comptes Vinted et votre configuration Selio, avec un accompagnement",
    lead: "Des services ponctuels, payés une fois ou sur devis : création de comptes Vinted, configuration personnalisée de Selio Manager, optimisation des messages et de la négociation, accompagnement pendant 30 jours, et aide en cas de restriction.",
    state: { value: "available", label: "Sur devis", note: "Prestations commandées depuis la page Contact ; le paiement en ligne n'est pas encore ouvert." },
    does: [
      { title: "Création de comptes Vinted", text: "Avec différentes options selon les offres, précisées dans le devis." },
      { title: "Comptes préparés ou non préparés", text: "Selon votre besoin, à préciser lors de la demande de devis." },
      { title: "Commandes en volume", text: "Plusieurs comptes d'un coup : sur devis." },
      { title: "Configuration personnalisée de Selio Manager", text: "Une étude de vos besoins, puis les paramètres recommandés : règles de prix, messages, automatisations." },
      { title: "Messages et négociation optimisés", text: "Les messages aux favoris et la négociation par IA ajustés à vos articles et à vos marges." },
      { title: "Accompagnement pendant 30 jours", text: "Le suivi de votre activité et de vos ventes pendant 30 jours." },
      { title: "Accompagnement en cas de restriction", text: "Un diagnostic et un accompagnement sur devis, sans promesse de déblocage garanti." },
    ],
    doesNot: [
      "Ne garantit aucun déblocage d'un compte restreint.",
      "Ne promet aucun chiffre de vente.",
      "Ne contourne aucun CAPTCHA ni aucune protection anti-robot.",
      "N'encaisse rien en ligne pour l'instant : la demande passe par la page Contact.",
    ],
    pricingHref: "/tarifs#compte",
    pricingNote: "Configuration, optimisation et accompagnement payés une fois ; création de comptes, comptes préparés, commandes en volume et restriction sur devis.",
    shot: { alt: "Selio Compte : illustration.", caption: "Capture d'écran à venir." },
  },
];

/** Selio Cloud et Selio Agent : fonctionnalités intégrées à Selio Manager, jamais des filiales. */
export const MANAGER_FEATURES: readonly ProductDef[] = [
  {
    slug: "cloud",
    path: "/produits/cloud",
    kind: "feature",
    name: "Selio Cloud",
    tagline: "Certaines automatisations de Selio Manager à distance, sans laisser votre ordinateur allumé.",
    promise: "Certaines automatisations de Selio Manager, ordinateur éteint",
    lead: "Selio Cloud est une fonctionnalité de Selio Manager : l'infrastructure qui fait tourner certaines automatisations à distance, sans ordinateur allumé. Un navigateur isolé par compte Vinted sur notre machine en France, où vous vous connectez vous-même ; Selio répond et relance au rythme humain, avec votre accord, compte par compte.",
    state: { value: "planned", label: "En développement", note: "Construit et testé sur des pages locales ; jamais exécuté contre Vinted. L'accord est à lire avant toute activation." },
    does: [
      { title: "Automatisations à distance", text: "Les réponses et relances de Selio Manager continuent quand votre ordinateur est éteint." },
      { title: "Répondre et relancer", text: "Réponses aux messages et relance après 24 h sans réponse, selon vos règles et vos horaires." },
      { title: "Connexion par vous", text: "Une fenêtre sécurisée où vous vous connectez vous-même : Selio ne voit jamais votre mot de passe." },
      { title: "Une session par compte", text: "Chiffrée, isolée, jamais partagée, supprimée dès que vous vous déconnectez ou résiliez." },
      { title: "Pause au premier signal", text: "Au premier avertissement ou CAPTCHA, le compte s'arrête, vous êtes prévenu, rien n'est retenté." },
      { title: "Journal des actions", text: "Chaque action gardée 90 jours, exportable en CSV, avec une pause et un arrêt en un clic." },
    ],
    doesNot: [
      "N'est pas un produit séparé : Selio Cloud fait partie de Selio Manager.",
      "Ne stocke aucun mot de passe Vinted.",
      "Ne masque aucune adresse IP et n'utilise aucun proxy par compte : tous les comptes passent par la même adresse, c'est expliqué avant l'activation.",
      "Ne republie pas et ne modifie pas en masse : ces actions lourdes restent désactivées.",
      "Ne reprend jamais seul après un avertissement : la reprise vous appartient.",
    ],
    pricingHref: "/tarifs#filiales",
    pricingNote: "Inclus dans l'offre Agence ; en option pour Starter et Pro.",
    shot: { alt: "Selio Cloud dans Selio Manager : comptes Cloud, état de la connexion et journal des actions.", caption: "Capture d'écran : données d'exemple, connexion simulée, aucune action réelle." },
  },
  {
    slug: "agent",
    path: "/produits/agent",
    kind: "feature",
    name: "Selio Agent",
    tagline: "La délégation de tâches et d'accès à vos collaborateurs et prestataires, pour travailler en équipe.",
    promise: "Déléguer des tâches et des accès, chacun avec les bons droits",
    lead: "Selio Agent est une fonctionnalité de Selio Manager : vous confiez des tâches et des accès à vos collaborateurs ou à un prestataire, chacun avec son identifiant et son rôle. Les agences et dépôts-vente y suivent aussi leurs boutiques clientes (aperçu).",
    state: { value: "demo", label: "Aperçu", note: "L'équipe, les rôles et le journal d'audit sont réels. Les boutiques clientes, la marque blanche et la facturation des clients sont en aperçu, sur des exemples fictifs." },
    does: [
      { title: "Équipe et invitations", text: "Chaque personne avec son identifiant, invitée par email, retirée en un clic." },
      { title: "Délégation de tâches", text: "Un exécuteur traite le stock, les annonces, les messages et les commandes sans voir les finances ; un contributeur photos ajoute les photos, rien d'autre." },
      { title: "Accès d'un prestataire", text: "Un collaborateur extérieur ou un comptable en lecture seule, sans jamais partager de mot de passe." },
      { title: "Journal d'audit", text: "Les actions sensibles gardent qui a fait quoi, et quand." },
      { title: "Boutiques clientes (aperçu)", text: "Pour les agences et dépôts-vente : les boutiques suivies, leur marque blanche et leur facturation." },
    ],
    doesNot: [
      "N'est pas un produit séparé : Selio Agent fait partie de Selio Manager.",
      "Ne partage aucun mot de passe Vinted entre membres : chacun a son identifiant Selio.",
      "Ne montre pas les finances à un exécuteur ni à un contributeur photos.",
      "N'encaisse rien pour le compte des agences : la facturation des clients est un aperçu.",
    ],
    pricingHref: "/tarifs#comparer",
    pricingNote: "Rôles d'équipe et journal d'audit dans l'offre Agence (jusqu'à 10 personnes) ; 3 personnes en Pro.",
    shot: { alt: "Selio Agent dans Selio Manager : membres de l'équipe, rôles et accès.", caption: "Capture d'écran prise avant le renommage (la page y porte encore le nom « Selio Agents ») : données d'exemple." },
  },
];

/** Toutes les pages sous /produits : les cinq filiales, puis les deux fonctionnalités de Selio Manager. */
export const PRODUCT_PAGES: readonly ProductDef[] = [...PRODUCTS, ...MANAGER_FEATURES];

/** Anciennes adresses : Radar est fusionné dans Selio Bot, « Comptes » et « Agents » passent au singulier. */
export const LEGACY_PRODUCT_SLUGS: Readonly<Record<string, ProductSlug>> = { radar: "bot", comptes: "compte", agents: "agent" };

export function productBySlug(slug: string | undefined): ProductDef | undefined {
  return PRODUCT_PAGES.find((p) => p.slug === slug);
}
