import { CONNECTION_USAGE_LABELS, PLAN_LABELS, PLAN_QUOTAS, RULE_KIND_LABELS, TRIAL_DAYS, autoBuySettings, buyerFees, orgSettings, ruleLimits, schedule } from "@selio/contracts";
import { REVIEW_THRESHOLD, SCORE_BANDS } from "./buying";
import { helpTokens, normalizeHelpText } from "./help-text";
import { DEFAULT_REPUBLISH_AFTER_DAYS } from "./online";
import { MIN_REPUBLISH_VARIANTS } from "./republish";

export { helpStem, helpTokens, normalizeHelpText } from "./help-text";

/**
 * Aide et FAQ de Selio : contenu unique partagé par la vitrine (/faq), l'application
 * (/app/help) et le serveur (POST /api/help/ask, passages transmis à l'IA).
 * Importé par « @selio/domain/help » (et non par l'index du paquet) pour que le contenu
 * n'alourdisse que les pages qui l'affichent.
 *
 * Règles de rédaction : réponses exactes par rapport au code actuel, aucune promesse ;
 * ce qui n'existe pas encore est dit « en préparation ». Les valeurs chiffrées viennent
 * des constantes du code (quotas, seuils, réglages par défaut) pour ne jamais diverger.
 * Aucun lien externe : seulement des chemins internes de l'application ou de la vitrine.
 */

export type HelpCategoryId =
  | "demarrer"
  | "comptes"
  | "generateur"
  | "dressing"
  | "achats"
  | "messagerie"
  | "automatisation"
  | "gestion"
  | "equipe"
  | "tarifs"
  | "donnees"
  | "filiales";

export interface HelpCategory {
  id: HelpCategoryId;
  title: string;
  summary: string;
}

export interface HelpEntry {
  /** Identifiant stable, sert d'ancre partageable (/faq#id). */
  id: string;
  categoryId: HelpCategoryId;
  question: string;
  /** Texte brut ; paragraphes séparés par une ligne vide. */
  answer: string;
  /** Mots que l'on tape pour chercher cette réponse (aident la recherche). */
  keywords: string[];
  /** Page de l'application ou de la vitrine où agir (chemin interne). */
  link?: { label: string; href: string };
  /** « planned » : en préparation, rien n'est commercialisé ni disponible. */
  status?: "planned";
}

// ---------------------------------------------------------------------------
// Valeurs issues du code
// ---------------------------------------------------------------------------

function eur(cents: number): string {
  return cents % 100 === 0 ? `${cents / 100} €` : `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}
function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10} %`.replace(".", ",");
}
function num(n: number): string {
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")}` : String(n);
}
const band = (key: (typeof SCORE_BANDS)[number]["key"]) => SCORE_BANDS.find((b) => b.key === key)!;

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  { id: "demarrer", title: "Démarrer", summary: "Ce qu'est Selio, la démonstration, les premiers pas et l'aide." },
  { id: "comptes", title: "Comptes Vinted et extension", summary: "Plusieurs comptes vente, achat et perso, l'extension navigateur et ses jetons." },
  { id: "generateur", title: "Générateur d'annonces et IA", summary: "Des photos à l'annonce, le prix conseillé, le rôle exact de l'IA." },
  { id: "dressing", title: "Dressing et republication", summary: "La note de chaque annonce et les republications pré-faites." },
  { id: "achats", title: "Bonnes affaires, À valider, Achat auto", summary: "Le radar, la note sur 100, la validation et l'achat automatique simulé." },
  { id: "messagerie", title: "Messagerie et marges", summary: "Les réponses aux acheteurs, la décision sur une offre, le calcul de la marge." },
  { id: "automatisation", title: "Automatisation", summary: "Messages aux favoris, réponse et négociation automatiques, après-vente, bordereaux et stock automatique." },
  { id: "gestion", title: "Stock, commandes et analyses", summary: "Articles, import CSV, commandes, expédition, clients et indicateurs." },
  { id: "equipe", title: "Équipe, comptes et accès", summary: "Propriétaire, administrateur, opérateur, lecture seule ; inviter et retirer." },
  { id: "tarifs", title: "Tarifs et abonnement", summary: "L'essai de 14 jours, les offres Starter, Pro et Agence, les quotas par filiale et le paiement." },
  { id: "donnees", title: "Données, sécurité et confidentialité", summary: "Où sont vos données, export, suppression, protection du compte, IA." },
  { id: "filiales", title: "Les filiales Selio", summary: "Selio Studio, Selio Agents, Selio Track, Selio Cloud et le générateur de compte Vinted." },
];

let ENTRIES: readonly HelpEntry[] | null = null;

/**
 * Les questions et réponses, construites à la première lecture (le contenu ne pèse pas sur
 * les pages qui ne l'affichent pas : il n'entre que dans les morceaux qui l'utilisent).
 */
export function helpEntries(): readonly HelpEntry[] {
  ENTRIES ??= buildHelpEntries();
  return ENTRIES;
}

function buildHelpEntries(): HelpEntry[] {
  const Q = PLAN_QUOTAS;
  const P = PLAN_LABELS;
  const AUTO_BUY = autoBuySettings.parse({});
  const BUYER_FEES = buyerFees.parse({});
  const RETENTION = orgSettings.parse({}).retentionDays;
  const LIMITS = ruleLimits.parse({});
  const SCHEDULE = schedule.parse({});
  const AUTOMATION = orgSettings.parse({}).automation;
  const NEGO = AUTOMATION.negotiation;
  return [
  // ---- Démarrer -----------------------------------------------------------
  {
    id: "selio-c-est-quoi",
    categoryId: "demarrer",
    question: "Qu'est-ce que Selio ?",
    answer: "Selio est un outil de gestion pour les revendeurs Vinted : stock, annonces, conversations, clients, commandes, achats et marges au même endroit. Il réunit un générateur d'annonces par l'IA, un dressing qui note chaque annonce, une messagerie qui applique vos règles de négociation, un radar de bonnes affaires et des analyses calculées sur vos ventes.",
    keywords: ["présentation", "outil", "logiciel", "application", "revendeur", "revente", "gestion", "à quoi sert"],
  },
  {
    id: "affiliation-vinted",
    categoryId: "demarrer",
    question: "Selio est-il affilié à Vinted ?",
    answer: "Non. Selio est un outil indépendant, ni affilié à Vinted ni approuvé par Vinted. Vinted ne propose pas d'API publique pour les vendeurs : Selio ne promet aucune compatibilité officielle et n'utilise pas de faux OAuth. Il passe par une extension qui lit la page Vinted que vous avez ouverte dans votre navigateur.",
    keywords: ["officiel", "partenaire", "approuvé", "affilié", "lien avec vinted", "api", "autorisé", "légal"],
  },
  {
    id: "contenu-demo",
    categoryId: "demarrer",
    question: "Que contient la démonstration ?",
    answer: "Un jeu de données fictif et cohérent : articles (avec des photos de vraies annonces, sans nom de compte), clients, conversations, commandes, règles, recherches et affaires. Les statistiques (vues, ventes, clients) sont inventées. Tout reste dans votre navigateur et toute action externe (envoi de message, publication, achat, paiement) est simulée et signalée comme telle. Aucun compte n'est nécessaire.",
    keywords: ["démo", "démonstration", "essayer", "tester", "fictif", "exemple", "sans compte"],
    link: { label: "Ouvrir la démonstration", href: "/demo" },
  },
  {
    id: "reinitialiser-demo",
    categoryId: "demarrer",
    question: "Comment réinitialiser la démonstration ?",
    answer: "Dans Paramètres › Export et suppression, bouton « Réinitialiser » (un raccourci figure aussi dans le bandeau « Démonstration »). Les données fictives reviennent à leur état de départ ; vos modifications de démonstration sont perdues.",
    keywords: ["remettre à zéro", "réinitialiser", "recommencer", "effacer la démo", "état initial"],
    link: { label: "Paramètres › Export et suppression", href: "/app/settings/data" },
  },
  {
    id: "demo-ou-connecte",
    categoryId: "demarrer",
    question: "Quelle différence entre la démonstration et le mode connecté ?",
    answer: "La démonstration tourne entièrement dans votre navigateur, avec des données fictives : elle montre le parcours et les règles métier, pas les intégrations. Le mode connecté utilise un vrai compte, une base de données serveur isolée par organisation, les rôles de l'équipe, les jetons d'extension et le modèle IA du serveur. Il nécessite une API Selio déployée ; sans elle, l'écran de connexion le signale.",
    keywords: ["mode connecté", "vrai compte", "différence", "démo", "serveur", "production"],
  },
  {
    id: "premiers-pas",
    categoryId: "demarrer",
    question: "Par où commencer ?",
    answer: "La page Démarrage propose six étapes courtes : compte et organisation, préférences, choix du mode, extension navigateur, règles IA et marge, puis une checklist. Ensuite : ajoutez vos comptes Vinted (menu Comptes), générez une première annonce à partir de vos photos et réglez vos marges dans Vendre › Négociation et marges.",
    keywords: ["commencer", "débuter", "configuration", "installation", "onboarding", "démarrage", "premiers pas"],
    link: { label: "Ouvrir le démarrage", href: "/app/onboarding" },
  },
  {
    id: "mobile",
    categoryId: "demarrer",
    question: "Selio fonctionne-t-il sur mobile ?",
    answer: "Oui. L'interface s'adapte aux petits écrans et l'application peut être installée sur l'écran d'accueil (application web installable), en mode clair ou sombre. Le générateur d'annonces accepte les photos prises avec le téléphone. L'extension, elle, ne fonctionne que dans un navigateur d'ordinateur (Chrome, Edge, Brave ou Chromium).",
    keywords: ["téléphone", "smartphone", "iphone", "android", "tablette", "installer l'application", "mode sombre"],
  },
  {
    id: "assistant-aide",
    categoryId: "demarrer",
    question: "Comment fonctionne l'assistant d'aide ?",
    answer: "Il cherche dans cette FAQ les passages les plus pertinents pour votre question, puis affiche une réponse avec ses questions sources, cliquables. Sur le site public et en démonstration, la réponse est tirée directement de la FAQ par une recherche locale. En mode connecté, l'assistant IA rédige la réponse à partir de ces mêmes passages, sans rien ajouter d'autre ; si l'IA est indisponible, la réponse de la FAQ s'affiche.\n\nLes questions posées à l'aide ne sont pas décomptées de la limite IA de votre plan.",
    keywords: ["aide", "assistant", "poser une question", "support", "chercher", "faq", "réponse"],
    link: { label: "Ouvrir l'aide", href: "/app/help" },
  },

  // ---- Comptes Vinted et extension ---------------------------------------
  {
    id: "plusieurs-comptes",
    categoryId: "comptes",
    question: "Puis-je connecter plusieurs comptes Vinted ?",
    answer: `Oui. Dans le menu Comptes › Comptes Vinted, chaque compte reçoit une catégorie : ${CONNECTION_USAGE_LABELS.sale}, ${CONNECTION_USAGE_LABELS.purchase} ou ${CONNECTION_USAGE_LABELS.personal}, modifiable en un clic. Le nombre de comptes dépend de l'offre : ${Q.starter.connections} compte avec ${P.starter}, jusqu'à ${Q.pro.connections} avec ${P.pro} (et pendant l'essai de ${TRIAL_DAYS} jours), jusqu'à ${Q.agence.connections} avec ${P.agence}. Aucun compte supplémentaire à la carte ; au-delà de ${Q.agence.connections} comptes, sur devis. Le simulateur de démonstration n'est pas compté.`,
    keywords: ["multicompte", "multi-comptes", "plusieurs boutiques", "deuxième compte", "ajouter un compte", "connecter"],
    link: { label: "Comptes Vinted", href: "/app/accounts" },
  },
  {
    id: "categories-comptes",
    categoryId: "comptes",
    question: "À quoi servent les catégories Vente, Achat et Perso ?",
    answer: "Vente : les annonces publiées et négociées par Selio (générateur, dressing, messagerie, automatisations). Achat : le compte qui achète les bonnes affaires, utilisé par « À valider » et par l'achat auto. Perso : visible dans Selio, mais jamais utilisé par les automatisations ni par l'achat auto ; le générateur le propose en dernier, signalé comme tel.",
    keywords: ["catégorie", "compte vente", "compte achat", "compte perso", "personnel", "usage du compte"],
    link: { label: "Comptes Vinted", href: "/app/accounts" },
  },
  {
    id: "mot-de-passe-vinted",
    categoryId: "comptes",
    question: "Faut-il donner mon mot de passe Vinted à Selio ?",
    answer: "Non, jamais. Vinted ne propose pas de connexion officielle pour les outils tiers : Selio passe par son extension, dans le navigateur où vous êtes déjà connecté à Vinted. L'extension ne lit ni ne stocke votre mot de passe, vos cookies ou votre session Vinted.",
    keywords: ["mot de passe", "identifiants", "connexion vinted", "cookies", "session", "login"],
  },
  {
    id: "installer-extension",
    categoryId: "comptes",
    question: "Comment installer et relier l'extension ?",
    answer: "L'extension n'est pas encore publiée sur le Chrome Web Store : elle s'installe en mode développeur (« Charger l'extension non empaquetée ») dans Chrome, Edge, Brave ou Chromium. Ensuite, dans Comptes Vinted › « Avancé — relier l'extension Selio », créez un jeton (affiché une seule fois) et collez-le dans les options de l'extension avec l'adresse de l'API, puis ouvrez Vinted : vos comptes passent à « Connecté ». L'association exige le mode connecté.",
    keywords: ["installer", "extension", "chrome", "edge", "brave", "jeton", "relier", "associer", "plugin"],
    link: { label: "Comptes Vinted", href: "/app/accounts" },
  },
  {
    id: "role-extension",
    categoryId: "comptes",
    question: "Que fait l'extension sur Vinted ?",
    answer: "Sur une page article, elle capture l'annonce vers votre stock (statut « En stock »). Sur une conversation, elle affiche vos règles de prix et prépare une réponse que vous relisez ; « Insérer dans le champ de réponse » ne fait qu'insérer le texte : c'est vous qui cliquez sur Envoyer. Elle ne clique jamais à votre place et ne contourne aucune protection.\n\nStatut : expérimental. La lecture des pages a été construite sur des pages d'exemple et doit encore être validée sur vinted.fr.",
    keywords: ["extension", "capturer", "capture", "importer une annonce", "préparer une réponse", "expérimental"],
  },
  {
    id: "statut-compte-extension",
    categoryId: "comptes",
    question: "Pourquoi mon compte Vinted n'est-il pas « Connecté » ?",
    answer: "Le statut d'un compte Vinted suit la dernière activité de l'extension : « Prêt » tant qu'elle n'a jamais été vue, « Connecté » si elle a donné signe de vie depuis moins d'une heure, « Dégradé » entre une heure et 24 heures, « Expiré » au-delà. Ouvrez Vinted dans le navigateur où l'extension est reliée, et vérifiez que son jeton n'est ni révoqué ni expiré.",
    keywords: ["en attente", "pas connecté", "expiré", "dégradé", "statut", "problème", "ne marche pas"],
  },
  {
    id: "revoquer-extension",
    categoryId: "comptes",
    question: "Comment couper l'accès de l'extension ?",
    answer: "Dans Comptes Vinted › Avancé › Jetons, cliquez sur « Révoquer » : l'effet est immédiat, l'extension affiche « Jeton refusé ». Depuis l'extension, Options › « Dissocier » efface son stockage local. Un jeton expire de lui-même au bout de 90 jours.",
    keywords: ["révoquer", "jeton", "dissocier", "couper", "retirer l'accès", "token", "appareil perdu"],
    link: { label: "Comptes Vinted", href: "/app/accounts" },
  },

  // ---- Générateur d'annonces et IA ---------------------------------------
  {
    id: "generateur-annonces",
    categoryId: "generateur",
    question: "Comment fonctionne le générateur d'annonces ?",
    answer: "Ajoutez jusqu'à 12 photos (face, dos, étiquette, défauts) : elles sont compressées dans votre navigateur avant l'envoi. L'IA identifie la pièce et rédige le titre, la description, la marque, la catégorie, la taille, l'état et les couleurs ; vous pouvez ajouter des indications (marque, taille, notes, prix d'achat). Vous relisez et modifiez tout, puis vous enregistrez en brouillon ou mettez en vente sur le compte choisi.",
    keywords: ["générateur", "créer une annonce", "photos", "rédiger", "titre", "description", "studio"],
    link: { label: "Générer une annonce", href: "/app/studio" },
  },
  {
    id: "publication-vinted",
    categoryId: "generateur",
    question: "Le générateur publie-t-il l'annonce sur Vinted à ma place ?",
    answer: "Non. « Publier directement » met l'article « En vente » dans Selio, rattaché au compte Vinted choisi, et il apparaît dans le dressing. La mise en ligne sur Vinted reste un geste manuel : des boutons copient le titre et la description. Rien n'est enregistré ni publié sans votre clic.",
    keywords: ["publier", "mettre en ligne", "poster", "publication automatique", "vinted", "copier"],
  },
  {
    id: "prix-conseille",
    categoryId: "generateur",
    question: "D'où vient le prix conseillé ?",
    answer: "Jamais de l'IA. Il est calculé à partir de ventes comparables : en mode connecté, les ventes réelles de votre organisation ; en démonstration, ces ventes plus un marché simulé. Avec peu de comparables, Selio le signale et propose une estimation prudente. Si vous indiquez le prix d'achat, un prix plancher est calculé avec vos règles de marge.",
    keywords: ["prix", "estimation", "combien vendre", "prix de vente", "comparables", "valeur"],
  },
  {
    id: "role-ia",
    categoryId: "generateur",
    question: "Que fait l'IA, et que ne fait-elle pas ?",
    answer: "Elle rédige : les réponses aux acheteurs, les annonces à partir des photos et les réponses de l'aide. Elle ne décide rien : accepter, contre-proposer, refuser ou confier une offre est décidé par une politique fixe à partir de vos règles. Chaque sortie est vérifiée (forme attendue, aucun lien ni HTML, prix imposé, aucune fuite du plancher ni du prix d'achat) avant de vous être proposée.",
    keywords: ["ia", "intelligence artificielle", "décision", "contrôle", "fiable", "vérification", "chatgpt"],
  },
  {
    id: "modele-ia",
    categoryId: "generateur",
    question: "Quel modèle d'IA utilise Selio ?",
    answer: "Mon modèle perso : un modèle privé (un modèle de texte et, s'il est configuré, un modèle de vision pour lire les photos), appelé uniquement par le serveur Selio, jamais depuis votre navigateur. Sans modèle de vision, le générateur le signale : l'annonce est rédigée sans lire les photos. Son raccordement est en préparation : l'état de l'IA l'indique dans Paramètres › Assistant IA.\n\nEn démonstration, un simulateur déterministe le remplace : il ne voit pas les photos et s'appuie sur la marque, la taille, les notes et le nom des fichiers.",
    keywords: ["modèle", "ollama", "qwen", "vision", "ia personnelle", "serveur ia", "simulateur"],
    link: { label: "Paramètres › Assistant IA", href: "/app/settings/ai" },
  },
  {
    id: "ia-indisponible",
    categoryId: "generateur",
    question: "Que se passe-t-il si l'IA est indisponible ?",
    answer: "Selio le dit, sans faire passer un texte simulé pour une réponse du modèle. Quand le repli est autorisé, un gabarit fixe, signalé comme tel, prend le relais ; sinon, une erreur explicite s'affiche et vous rédigez à la main. Après plusieurs échecs d'affilée, l'IA est mise en pause un court instant. L'état de l'IA, en pourcentages (disponibilité, réponses validées, replis), est dans Paramètres › Assistant IA.",
    keywords: ["panne", "indisponible", "erreur", "lent", "ne répond pas", "gabarit", "état de l'ia"],
    link: { label: "Paramètres › Assistant IA", href: "/app/settings/ai" },
  },
  {
    id: "limite-ia",
    categoryId: "generateur",
    question: "L'usage de l'IA est-il limité ?",
    answer: "Chaque plan fixe une limite mensuelle de sécurité, et l'organisation peut en choisir une plus basse dans Paramètres › Assistant IA (0 = la limite du plan). La consommation s'affiche en pourcentage ; à la limite, la demande est refusée proprement, sans aucune facturation en plus. Les questions posées à l'aide ne sont pas décomptées.",
    keywords: ["quota", "limite", "combien de requêtes", "consommation ia", "plafond", "épuisé"],
    link: { label: "Abonnement et consommation", href: "/app/settings/billing" },
  },
  {
    id: "reglages-ia",
    categoryId: "generateur",
    question: "Peut-on régler le ton et la signature de l'IA ?",
    answer: "Oui, dans Paramètres › Assistant IA : ton (chaleureux et concis, neutre et professionnel, ou très court), signature ajoutée en fin de message, validation humaine avant envoi (activée par défaut) et activation de l'assistant. Ces réglages sont réservés au propriétaire et aux administrateurs.",
    keywords: ["ton", "signature", "style", "réglages ia", "personnaliser", "validation humaine"],
    link: { label: "Paramètres › Assistant IA", href: "/app/settings/ai" },
  },

  // ---- Dressing et republication -----------------------------------------
  {
    id: "note-annonce",
    categoryId: "dressing",
    question: "Comment est calculée la note d'une annonce ?",
    answer: "Sur 100 : visibilité (vues par jour en ligne, 25 points), attractivité (favoris par rapport aux vues et offres reçues, 25), qualité de l'annonce (photos, titre, description et attributs, 30) et prix face au marché (médiane des ventes comparables, 20). 80 et plus : excellente ; de 60 à 79 : bonne ; de 40 à 59 : à améliorer ; en dessous : faible. Chaque note s'accompagne des améliorations concrètes à faire.",
    keywords: ["note", "score", "dressing", "sur 100", "performance", "qualité de l'annonce", "améliorer"],
    link: { label: "Dressing intelligent", href: "/app/dressing" },
  },
  {
    id: "quand-republier",
    categoryId: "dressing",
    question: "Quand faut-il republier une annonce ?",
    answer: `Par défaut, dès ${DEFAULT_REPUBLISH_AFTER_DAYS} jours en ligne ; le délai se règle dans le dressing (de 5 à 30 jours, par le propriétaire ou un administrateur). Le filtre « À republier » liste les annonces concernées et leur nombre s'affiche dans le menu.`,
    keywords: ["republier", "quand", "délai", "7 jours", "une semaine", "annonce ancienne", "remonter"],
    link: { label: "Dressing intelligent", href: "/app/dressing" },
  },
  {
    id: "variantes-republication",
    categoryId: "dressing",
    question: "Que sont les republications pré-faites ?",
    answer: `Pour chaque annonce, 10 variantes sont prêtes (au moins ${MIN_REPUBLISH_VARIANTS}) : titre, description, prix, photo de couverture et créneau conseillé, par exemple « Classique optimisé », « Marque en premier », « Mots-clés de recherche » ou « Dernier prix ». Aucune ne descend sous votre prix plancher. Selio alterne pour ne pas republier deux fois la même et, quand toutes ont servi, repart de la plus performante.`,
    keywords: ["variantes", "republication", "pré-faites", "modèles", "titres", "créneau"],
  },
  {
    id: "comment-republier",
    categoryId: "dressing",
    question: "Comment republier une annonce avec Selio ?",
    answer: "Ouvrez « Republier » sur l'annonce, copiez la variante conseillée et remettez l'annonce en ligne sur Vinted, puis cliquez « J'ai republié » : la variante est marquée utilisée et son rendement (vues et favoris 48 h après) est suivi. La republication sur Vinted reste un geste manuel : Selio ne publie rien à votre place.",
    keywords: ["republier", "j'ai republié", "remettre en ligne", "rendement", "48 h", "suivi"],
  },
  {
    id: "statistiques-annonces",
    categoryId: "dressing",
    question: "D'où viennent les vues et les favoris de mes annonces ?",
    answer: "En démonstration, ils sont simulés. En mode connecté, ce sont les chiffres enregistrés sur chaque article ; leur relevé automatique sur Vinted par l'extension est en préparation. La note d'une annonce en dépend : sans chiffres, la visibilité et l'attractivité restent basses.",
    keywords: ["vues", "favoris", "statistiques", "chiffres", "audience", "relevé"],
  },

  // ---- Bonnes affaires, À valider, Achat auto ----------------------------
  {
    id: "note-affaire",
    categoryId: "achats",
    question: "Comment le radar note-t-il une bonne affaire ?",
    answer: "Sur 100 : marge estimée face à votre marge cible, port et protection acheteurs inclus (40 points), taux de marge (15), état et photos (15), marque et demande prouvée par des ventes comparables (15), fiabilité du vendeur (10), port et fraîcheur de l'annonce (5). Hors budget, la note est plafonnée à 59 ; avec une marge nulle ou négative, à 10. Le détail de chaque critère est affiché.",
    keywords: ["note", "score", "radar", "bonne affaire", "calcul", "sur 100", "critères"],
    link: { label: "Bonnes affaires", href: "/app/radar" },
  },
  {
    id: "seuils-affaires",
    categoryId: "achats",
    question: `Que signifient les seuils ${REVIEW_THRESHOLD} et ${band("great").min} ?`,
    answer: `À partir de ${REVIEW_THRESHOLD}/100, une affaire apparaît dans « À valider ». La grille complète : en dessous de ${band("fair").min}, ${band("weak").label.toLowerCase()} ; de ${band("fair").min} à ${band("fair").max}, ${band("fair").label.toLowerCase()} ; de ${band("good").min} à ${band("good").max}, ${band("good").label.toLowerCase()}, à valider à la main ; de ${band("great").min} à ${band("great").max}, ${band("great").label.toLowerCase()}, seuil conseillé pour l'achat auto ; ${band("exceptional").min} et plus, ${band("exceptional").label.toLowerCase()}.`,
    keywords: ["seuil", "75", "85", "à valider", "grille", "exceptionnelle", "faible"],
  },
  {
    id: "source-radar",
    categoryId: "achats",
    question: "D'où viennent les annonces du radar ?",
    answer: "Aujourd'hui, d'un simulateur déterministe, en démonstration comme en mode connecté : aucune source réelle n'est consultée, faute d'accès autorisé aux annonces Vinted. Vos recherches (marques, tailles, prix maximal, marge cible) et la notation fonctionnent réellement ; les annonces analysées, elles, sont fictives.",
    keywords: ["radar", "source", "annonces", "recherche", "vraies annonces", "simulateur", "d'où"],
  },
  {
    id: "cout-reel-achat",
    categoryId: "achats",
    question: "Comment est calculé le coût réel d'un achat ?",
    answer: `Prix de l'article + port + protection acheteurs, réglée par défaut à ${eur(BUYER_FEES.fixedCents)} + ${pct(BUYER_FEES.rate)} du prix (valeurs modifiables dans les réglages de l'achat auto). Ce total sert au calcul de la marge, du bénéfice estimé et des plafonds.`,
    keywords: ["coût", "protection acheteurs", "frais", "port", "total", "prix réel"],
  },
  {
    id: "valider-achat",
    categoryId: "achats",
    question: "Que se passe-t-il quand je valide une affaire ?",
    answer: "Les contrôles s'exécutent : prix maximal, budget, plafond du jour, doublon et marge positive. L'achat réel étant désactivé, le résultat est une simulation : aucun paiement, aucune commande chez un vendeur. L'achat est rattaché à votre compte Achat et apparaît dans l'historique de « À valider ».",
    keywords: ["valider", "à valider", "acheter", "un clic", "contrôles", "historique"],
    link: { label: "À valider", href: "/app/purchase" },
  },
  {
    id: "achat-auto",
    categoryId: "achats",
    question: "Comment fonctionne l'achat auto ?",
    answer: `Il est désactivé par défaut. Une fois activé, chaque analyse du radar peut acheter seule les affaires au-dessus de votre seuil (par défaut ${AUTO_BUY.threshold}/100), dans la limite d'un plafond par jour (${eur(AUTO_BUY.dailyCapCents)}) et d'un prix maximal par article (${eur(AUTO_BUY.maxItemCents)}), port et frais inclus, avec une marge positive et sans doublon. Vous pouvez annuler pendant un délai (${AUTO_BUY.cancelWindowMinutes} minutes par défaut). Seul un compte Achat est utilisé, jamais un compte Vente ou Perso.`,
    keywords: ["achat auto", "automatique", "acheter seul", "seuil", "plafond", "annuler"],
    link: { label: "Achat auto", href: "/app/auto-buy" },
  },
  {
    id: "achat-reel",
    categoryId: "achats",
    question: "Selio achète-t-il réellement sur Vinted ?",
    answer: "Non, pas aujourd'hui. Il n'existe pas d'API acheteur officielle : chaque achat, validé à la main ou automatique, est simulé de bout en bout et marqué comme tel. L'achat réel est désactivé par conception et ne peut pas être activé depuis l'interface. Rien n'est jamais payé à votre insu.",
    keywords: ["achat réel", "payer", "paiement", "vraiment acheter", "simulé", "argent"],
  },
  {
    id: "analyse-revendeurs",
    categoryId: "achats",
    question: "À quoi sert Selio Track (l'analyse des revendeurs) ?",
    answer: "Elle montre qui vend le plus, dans quelles niches, à quel prix et à quel rythme, et fait ressortir les niches à forte demande et peu concurrencées, sur lesquelles lancer une recherche « Bonnes affaires ». En démonstration, le marché est simulé ; en mode connecté, l'analyse ne retient que des annonces réellement observées et reste vide tant qu'il n'y en a pas. Les chiffres d'affaires sont des estimations ; aucune donnée privée des vendeurs n'est consultée.",
    keywords: ["revendeurs", "concurrents", "niches", "marché", "top vendeurs", "tendances", "track", "sourcing", "resell track"],
    link: { label: "Selio Track", href: "/track" },
  },

  // ---- Messagerie, négociation et marges ---------------------------------
  {
    id: "envoi-messages",
    categoryId: "messagerie",
    question: "Les messages partent-ils automatiquement ?",
    answer: "Par défaut, non : chaque brouillon est relu, puis envoyé par vous. Avec un compte Vinted, aucun envoi automatique n'existe : Selio prépare le texte, l'extension l'insère dans le champ de réponse et vous cliquez sur Envoyer. Un message n'est jamais affiché « envoyé » avant la confirmation du connecteur.",
    keywords: ["envoyer", "envoyés", "tout seuls", "automatique", "message", "brouillon", "réponse", "envoi", "partent seuls"],
    link: { label: "Messagerie", href: "/app/messages" },
  },
  {
    id: "decision-offre",
    categoryId: "messagerie",
    question: "Comment Selio décide-t-il de la réponse à une offre ?",
    answer: "Une politique fixe décide, l'IA ne fait que rédiger. Une offre au-dessus du prix plancher et dans la remise maximale est acceptée ; sinon, Selio contre-propose en descendant d'un pas depuis le prix affiché, sans passer sous le plancher ni sous la remise maximale. Au-delà du nombre de contre-propositions autorisé, l'offre vous est confiée. Hors des horaires autorisés, la réponse attend la prochaine plage.",
    keywords: ["offre", "contre-proposition", "accepter", "refuser", "négociation", "décision", "acheteur"],
  },
  {
    id: "regles-marge",
    categoryId: "automatisation",
    question: "Où régler mes marges et ma négociation ?",
    answer: `Dans Automatisation › Négociation automatique, un parcours en ${10} étapes, de la plus simple à la plus avancée. D'abord la marge de négociation par tranche de prix (par défaut ${NEGO.bands.map((b) => pct(b.marginRate)).join(", ")} selon le prix), puis les paliers de réduction : chaque contre-offre accorde une part de cette marge (${NEGO.steps.map((x) => pct(x)).join(", puis ")} : la dernière est l'offre finale). Ensuite les lots, les baisses de prix, les messages (contre-offre, offre finale, acceptation, repli) et les délais d'envoi. Chaque étape montre, à droite, une conversation d'exemple qui suit vos réglages. Il n'y a plus de profil tout fait : vous réglez, l'IA rédige les messages, et votre marge minimale reste un garde-fou. Seuls le propriétaire et les administrateurs peuvent modifier ces règles.`,
    keywords: ["marge", "négociation", "règles", "remise", "paliers", "tranche de prix", "contre-offre", "offre finale", "réglages vente"],
    link: { label: "Négociation automatique", href: "/app/automatisation/negociation" },
  },
  {
    id: "calcul-marge",
    categoryId: "messagerie",
    question: "Comment la marge est-elle calculée ?",
    answer: "Marge brute = prix de vente − frais plateforme vendeur − port à charge du vendeur − autres coûts − (prix d'achat + frais d'acquisition). Les montants sont calculés en centimes entiers. Ce n'est pas un bénéfice net : ni impôts, ni cotisations, ni frais fixes n'y sont déduits.",
    keywords: ["marge", "bénéfice", "calcul", "rentabilité", "gain", "formule"],
  },
  {
    id: "prix-plancher",
    categoryId: "messagerie",
    question: "Qu'est-ce que le prix plancher ?",
    answer: "Le prix en dessous duquel Selio n'accepte jamais une offre. Il est suggéré à partir du coût d'acquisition, du port à votre charge et de vos marges minimales : le plus élevé entre « coût + marge minimale en euros » et « coût ÷ (1 − taux de marge minimal − frais vendeur) ». Un plancher saisi à la main sur un article reste prioritaire. Il n'est jamais révélé à l'acheteur.",
    keywords: ["plancher", "prix minimum", "prix mini", "plus bas", "seuil de prix"],
  },
  {
    id: "automatisations",
    categoryId: "automatisation",
    question: "Que contient l'onglet Automatisation ?",
    answer: `Quatre blocs (messages aux favoris, réponse automatique, négociation automatique, messages après-vente), plus l'après-vente sans action manuelle (bordereaux commandés et imprimés, relance du colis) et le stock automatique. Le journal des tâches garde en plus six types de règles : ${Object.values(RULE_KIND_LABELS).map((l) => l.charAt(0).toLowerCase() + l.slice(1)).join(", ")}. Chacune a des horaires (par défaut de ${SCHEDULE.startHour} h à ${SCHEDULE.endHour} h), des limites (${LIMITS.maxPerDay} actions par jour, ${LIMITS.maxPerCustomerPerDay} par acheteur, ${LIMITS.minMinutesBetweenActions} minutes entre deux actions par défaut) et une validation humaine activée par défaut ; un bouton met tout en pause. Les comptes Perso ne sont jamais concernés, et les actions sur Vinted exigent un navigateur ouvert avec l'extension.`,
    keywords: ["automatisation", "règle", "relance", "automatique", "pause", "baisse de prix", "programmer"],
    link: { label: "Automatisation", href: "/app/automatisation" },
  },
  {
    id: "apres-vente",
    categoryId: "automatisation",
    question: "Que fait l'après-vente automatique ?",
    answer: `Dès qu'un article se vend, Selio commande le bordereau d'envoi (il est prêt à l'avance) et peut l'imprimer seul si vous cochez « Impression automatique ». Il envoie un message de remerciement après la vente, un autre quand la commande est finalisée (argent reçu), et relance l'acheteur ${AUTOMATION.afterSale.pickupReminder.afterHours} h après le dépôt du colis au point relais pour qu'il pense à le récupérer. Chaque message se modifie dans Automatisation › Après-vente. En démonstration, tout est simulé ; avec Vinted, ces actions passent par l'extension, navigateur ouvert.`,
    keywords: ["après-vente", "bordereau", "étiquette", "imprimer", "impression", "relance", "colis", "point relais", "remerciement", "merci"],
    link: { label: "Après-vente", href: "/app/automatisation/apres-vente" },
  },
  {
    id: "stock-automatique",
    categoryId: "automatisation",
    question: "Qu'est-ce que le stock automatique ?",
    answer: "Une fois activé, quand un article d'un dressing suivi se vend, Selio le remet en ligne automatiquement (nouvelle annonce identique) tant qu'il vous en reste en stock. Vous choisissez les comptes concernés et le délai avant la remise en ligne. Il est désactivé par défaut ; les comptes Perso ne sont jamais concernés.",
    keywords: ["stock automatique", "remise en ligne", "remettre en ligne", "relister", "republier", "quantité", "vendu"],
    link: { label: "Stock automatique", href: "/app/automatisation/stock" },
  },
  {
    id: "messages-favoris",
    categoryId: "automatisation",
    question: "À quoi servent les messages aux favoris ?",
    answer: `Quand un acheteur ajoute un de vos articles en favori, Selio peut lui écrire après un délai (par défaut ${AUTOMATION.favorites.delayMinutes} minutes), avec une petite remise s'il le faut (par défaut ${pct(AUTOMATION.favorites.offerRate)}), une seule fois par acheteur. La réponse automatique, elle, répond aux questions courantes (disponibilité, taille, état, envoi, lot) à partir de la fiche de l'article ; par défaut, ses réponses restent des brouillons à valider.`,
    keywords: ["favori", "favoris", "like", "coeur", "relance", "réponse automatique", "question", "répondre"],
    link: { label: "Messages aux favoris", href: "/app/automatisation/favoris" },
  },

  // ---- Stock, commandes et analyses --------------------------------------
  {
    id: "import-stock",
    categoryId: "gestion",
    question: "Puis-je importer mon stock ?",
    answer: "Oui, par fichier CSV (séparateur point-virgule ou virgule, en-têtes en français ou en anglais) depuis Articles et stock › Importer. Un modèle est téléchargeable ; chaque ligne est vérifiée et rien n'est enregistré avant votre confirmation. L'export CSV du stock est aussi disponible.",
    keywords: ["importer", "csv", "excel", "fichier", "stock", "inventaire", "migration"],
    link: { label: "Importer des articles", href: "/app/items/import" },
  },
  {
    id: "statuts-articles",
    categoryId: "gestion",
    question: "Quels sont les statuts d'un article ?",
    answer: "En stock, En vente, Réservé, Vendu et Archivé. Les changements suivent des transitions contrôlées (par exemple, un article vendu revient en stock ou part aux archives, pas directement en vente) et l'historique de chaque article est conservé. Un article lié à une commande ne peut pas être supprimé : archivez-le.",
    keywords: ["statut", "en stock", "en vente", "réservé", "vendu", "archivé", "supprimer un article"],
    link: { label: "Articles et stock", href: "/app/items" },
  },
  {
    id: "commande-automatique",
    categoryId: "gestion",
    question: "Une vente crée-t-elle une commande automatiquement ?",
    answer: "Non : une commande n'est jamais créée à l'envoi d'un message. Vous confirmez la vente depuis la conversation ou la page Commandes. Si une commande existe déjà pour cet article et ce client le même jour, elle est réutilisée (aucun doublon). La commande fige le coût d'acquisition et calcule la marge brute.",
    keywords: ["commande", "vente", "doublon", "créer une commande", "vendu"],
    link: { label: "Commandes", href: "/app/orders" },
  },
  {
    id: "bordereau-expedition",
    categoryId: "gestion",
    question: "Selio génère-t-il le bordereau d'expédition ?",
    answer: "Non : le bordereau reste fourni par Vinted. Selio suit l'expédition (transporteur, numéro de suivi, statut). En démonstration, un document marqué « Démonstration » illustre le parcours.",
    keywords: ["bordereau", "expédition", "étiquette", "colis", "livraison", "suivi", "transporteur"],
  },
  {
    id: "calcul-analyses",
    categoryId: "gestion",
    question: "Comment sont calculées les analyses ?",
    answer: "Depuis vos commandes et votre stock, sans aucun chiffre aléatoire. Chiffre d'affaires = prix de vente des commandes payées, expédiées, livrées ou terminées ; taux de marge = marge brute ÷ chiffre d'affaires ; panier moyen = chiffre d'affaires ÷ nombre de ventes ; rotation = jours moyens entre l'achat et la vente. Les conventions sont rappelées en bas de la page Analyses, exportable en CSV.",
    keywords: ["analyses", "chiffre d'affaires", "statistiques", "rotation", "panier moyen", "indicateurs", "kpi"],
    link: { label: "Analyses", href: "/app/analytics" },
  },
  {
    id: "fiches-clients",
    categoryId: "gestion",
    question: "Quelles informations Selio garde-t-il sur mes clients ?",
    answer: "Des fiches minimales : pseudo, ville facultative, notes et tags, avec l'historique des conversations et des commandes. Deux fiches en double peuvent être fusionnées. Aucune donnée superflue n'est demandée.",
    keywords: ["clients", "acheteurs", "fiche client", "crm", "fusionner", "historique"],
    link: { label: "Clients", href: "/app/customers" },
  },

  // ---- Équipe, comptes et accès ------------------------------------------
  {
    id: "roles-equipe",
    categoryId: "equipe",
    question: "Quels sont les rôles et que permettent-ils ?",
    answer: "Quatre rôles. Propriétaire : tout, y compris l'abonnement, l'achat réel et la suppression définitive. Administrateur : les réglages, les membres, les comptes connectés, les automatisations et les exports. Opérateur : le travail du quotidien (articles, messages, commandes, IA, radar) sans toucher aux réglages ni aux membres. Lecture seule : consulte articles, ventes et analyses sans rien modifier ni envoyer. La matrice complète « qui peut faire quoi » est dans Paramètres › Comptes et accès.",
    keywords: ["rôles", "propriétaire", "administrateur", "opérateur", "lecture seule", "droits", "permissions"],
    link: { label: "Comptes et accès", href: "/app/settings/access" },
  },
  {
    id: "inviter-membre",
    categoryId: "equipe",
    question: "Comment inviter quelqu'un dans mon équipe ?",
    answer: `Dans Paramètres › Comptes et accès, saisissez son email et choisissez son rôle ; le propriétaire et les administrateurs peuvent inviter. Le nombre de personnes dépend de l'offre : ${Q.starter.members} personne avec ${P.starter}, jusqu'à ${Q.pro.members} avec ${P.pro} (et pendant l'essai), jusqu'à ${Q.agence.members} avec ${P.agence}, qui ajoute les rôles d'équipe.\n\nLa personne reçoit un email avec un lien valable 7 jours, à usage unique, pour choisir son nom et son mot de passe ; elle est connectée directement dans l'organisation. Quelqu'un qui a déjà un compte Selio garde son mot de passe et retrouve l'organisation en se connectant. Si l'email ne peut pas partir, l'invitation est annulée et peut être refaite.`,
    keywords: ["inviter", "ajouter un membre", "collaborateur", "équipe", "employé", "invitation"],
    link: { label: "Comptes et accès", href: "/app/settings/access" },
  },
  {
    id: "transfert-proprietaire",
    categoryId: "equipe",
    question: "Peut-on changer de propriétaire ou retirer un membre ?",
    answer: "Oui. Le rôle propriétaire ne s'attribue pas par invitation : invitez la personne, puis nommez-la propriétaire. Seul un propriétaire peut nommer, changer ou retirer un propriétaire, et personne ne peut retirer son propre accès ni abaisser son propre rôle. Un membre retiré perd l'accès immédiatement : ses sessions ouvertes sont fermées.",
    keywords: ["propriétaire", "transférer", "retirer", "supprimer un membre", "départ", "changer de rôle"],
  },
  {
    id: "journal-audit",
    categoryId: "equipe",
    question: "Peut-on savoir qui a fait quoi ?",
    answer: "Oui. Les actions sensibles (connexion, membres, règles, jetons, comptes connectés, exports, suppression) sont inscrites dans le journal d'audit, consultable dans Paramètres › Sécurité, sans contenu de message ni secret.",
    keywords: ["journal", "audit", "historique", "traçabilité", "qui a fait", "activité"],
    link: { label: "Paramètres › Sécurité", href: "/app/settings/security" },
  },
  {
    id: "acces-ou-comptes-vinted",
    categoryId: "equipe",
    question: "Quelle différence entre les accès Selio et les comptes Vinted ?",
    answer: "Les accès concernent l'application : chaque personne a son propre identifiant Selio et un rôle dans l'organisation. Les comptes Vinted sont les boutiques reliées à Selio (Vente, Achat, Perso), gérées dans le menu Comptes. Un membre travaille sur tous les comptes Vinted de l'organisation, dans les limites de son rôle.",
    keywords: ["accès", "comptes vinted", "différence", "identifiant", "boutique", "utilisateur"],
  },

  // ---- Tarifs et abonnement ----------------------------------------------
  {
    // Identifiant conservé (ancre /faq#essai-decouverte partagée) : l'essai de 14 jours remplace l'offre Découverte.
    id: "essai-decouverte",
    categoryId: "tarifs",
    question: `Comment fonctionne l'essai gratuit de ${TRIAL_DAYS} jours ?`,
    answer: `C'est un essai gratuit de ${TRIAL_DAYS} jours, un seul choix de durée, avec toutes les fonctions et les limites de l'offre ${P.pro}. La carte bancaire est enregistrée dès l'inscription et rien n'est débité avant la fin de l'essai. À la fin, vous choisissez ${P.starter}, ${P.pro} ou ${P.agence}, ou vous arrêtez sans frais. Tant que le paiement n'est pas branché (en préparation), l'enregistrement de la carte et la fin d'essai ne sont pas appliqués.`,
    keywords: ["essai", "gratuit", "14 jours", "deux semaines", "tester", "carte bancaire", "période d'essai", "découverte"],
    link: { label: "Voir les tarifs", href: "/tarifs" },
  },
  {
    id: "starter-pro-ou-agence",
    categoryId: "tarifs",
    question: `Quelle différence entre ${P.starter}, ${P.pro} et ${P.agence} ?`,
    answer: `${P.starter} : ${Q.starter.connections} compte Vinted, ${num(Q.starter.aiRequestsPerMonth)} réponses de mon IA perso par mois, tous les modules de gestion (stock, dressing, messagerie, commandes, marges). ${P.pro} : jusqu'à ${Q.pro.connections} comptes et ${Q.pro.members} personnes, Track essentiel, relance après 24 h proposée, ${Q.pro.studioListingsPerMonth} annonces Studio et ${Q.pro.wornPhotosPerMonth} photos portées par mois, ${num(Q.pro.aiRequestsPerMonth)} réponses. ${P.agence} : jusqu'à ${Q.agence.connections} comptes et ${Q.agence.members} personnes, Track complet, relance automatique, Cloud inclus, rôles d'équipe, ${Q.agence.studioListingsPerMonth} annonces Studio et ${Q.agence.wornPhotosPerMonth} photos portées par mois, ${num(Q.agence.aiRequestsPerMonth)} réponses, migration assistée et support prioritaire. Plus de ${Q.agence.connections} comptes : sur devis.`,
    keywords: ["différence", "starter", "pro", "agence", "choisir une offre", "comparer", "formule", "plan"],
    link: { label: "Comparer les offres", href: "/tarifs" },
  },
  {
    id: "quotas-filiales",
    categoryId: "tarifs",
    question: "Quels sont les quotas de Studio, Track et Cloud selon l'offre ?",
    answer: `Chaque filiale a son compteur, remis à zéro le 1er du mois. Studio : ${Q.pro.studioListingsPerMonth} annonces et ${Q.pro.wornPhotosPerMonth} photos portées par mois avec ${P.pro}, ${Q.agence.studioListingsPerMonth} annonces et ${Q.agence.wornPhotosPerMonth} photos portées avec ${P.agence} ; Studio n'est pas inclus dans ${P.starter}. Track : ${Q.pro.trackFiltersFollowed} filtres suivis, ${Q.pro.trackScansPerMonth} scans de niche et ${Q.pro.trackPhotoSearchesPerMonth} recherches par photo par mois, ${Q.pro.trackHistoryMonths} mois d'historique avec ${P.pro} ; ${Q.agence.trackFiltersFollowed} filtres, ${Q.agence.trackScansPerMonth} scans, ${Q.agence.trackPhotoSearchesPerMonth} recherches et ${Q.agence.trackHistoryMonths} mois avec ${P.agence}. Cloud : inclus dans ${P.agence}, en option pour ${P.starter} et ${P.pro}. La page Mon utilisation affiche une barre par filiale et prévient à 80 %.`,
    keywords: ["quota", "quotas", "studio", "track", "cloud", "annonces par mois", "photos portées", "scans", "recherches par photo", "compteur", "80 %"],
    link: { label: "Mon utilisation", href: "/app/settings/billing" },
  },
  {
    id: "compte-supplementaire",
    categoryId: "tarifs",
    question: "Puis-je acheter un compte Vinted supplémentaire à la carte ?",
    answer: `Non. Le nombre de comptes Vinted est fixé par l'offre : ${Q.starter.connections} avec ${P.starter}, ${Q.pro.connections} avec ${P.pro}, ${Q.agence.connections} avec ${P.agence}. Pour en ajouter, on change d'offre. Au-delà de ${Q.agence.connections} comptes, Selio établit un devis.`,
    keywords: ["compte supplémentaire", "à la carte", "ajouter un compte", "plus de comptes", "devis", "onzième compte"],
    link: { label: "Voir les tarifs", href: "/tarifs" },
  },
  {
    id: "prix-indicatifs",
    categoryId: "tarifs",
    question: "Les prix affichés sont-ils définitifs ?",
    answer: "Non. Les montants de la page Tarifs sont indicatifs et peuvent évoluer avant l'ouverture des abonnements ; ils vivent dans une configuration, pas dans les écrans. Aucun paiement n'est encaissé à ce stade.",
    keywords: ["prix", "tarif", "combien ça coûte", "coût", "définitif", "indicatif", "mensuel", "par mois", "montant"],
    link: { label: "Voir les tarifs", href: "/tarifs" },
  },
  {
    id: "engagement",
    categoryId: "tarifs",
    question: "Y a-t-il un engagement ?",
    answer: "Les offres sont mensuelles, sans engagement, résiliables à tout moment : l'abonnement s'arrête à la fin de la période en cours. L'annuel coûte 10 mois (2 mois offerts). Les conditions définitives seront publiées à l'ouverture des abonnements.",
    keywords: ["engagement", "résilier", "résiliation", "durée", "sans engagement", "contrat", "mensuel", "annuel", "deux mois offerts"],
  },
  {
    id: "offre-fondateurs",
    categoryId: "tarifs",
    question: "Qu'est-ce que l'offre fondateurs ?",
    answer: `Pour les 50 premiers clients : −30 % pendant 6 mois sur ${P.pro} et ${P.agence}, et un mois offert sur ${P.starter}. Les montants restent indicatifs tant que les abonnements ne sont pas ouverts.`,
    keywords: ["fondateurs", "premiers clients", "réduction", "remise", "promotion", "lancement", "-30 %"],
    link: { label: "Voir les tarifs", href: "/tarifs" },
  },
  {
    id: "limite-plan",
    categoryId: "tarifs",
    question: "Que se passe-t-il si j'atteins une limite de mon offre ?",
    answer: "La page Mon utilisation (Paramètres › Abonnement et consommation) affiche chaque compteur en pourcentage, avec une alerte à 80 %. À la limite, l'action concernée (ajouter un compte Vinted, inviter une personne, créer un article, demander une réponse à mon IA perso, générer une annonce Studio) est bloquée proprement, avec un message qui explique la limite. Aucune facturation surprise.",
    keywords: ["limite", "quota", "dépassement", "bloqué", "plafond", "consommation", "alerte", "80 %"],
    link: { label: "Mon utilisation", href: "/app/settings/billing" },
  },
  {
    id: "paiement",
    categoryId: "tarifs",
    question: "Comment se passe le paiement ?",
    answer: "Le paiement par carte (avec Apple Pay et Google Pay) est en préparation : la carte sera enregistrée dès l'essai et débitée chaque mois seulement à partir de la fin de l'essai. En attendant, seul un adaptateur de test est présent : aucun abonnement réel n'est créé sans configuration et validation volontaires, et en démonstration aucun paiement n'est déclenché. Seul le propriétaire gère l'abonnement.",
    keywords: ["paiement", "payer", "carte bancaire", "apple pay", "google pay", "facture", "abonnement", "prélèvement"],
  },

  // ---- Données, sécurité et confidentialité ------------------------------
  {
    id: "stockage-donnees",
    categoryId: "donnees",
    question: "Où sont stockées mes données ?",
    answer: "En démonstration, uniquement dans votre navigateur (stockage local), effacées par la réinitialisation. En mode connecté, dans une base PostgreSQL où chaque organisation est isolée : contrôle d'accès côté serveur et politiques de sécurité par ligne. Les secrets de connexion sont chiffrés (AES-256-GCM) avec une clé conservée hors de la base.",
    keywords: ["données", "stockage", "hébergement", "base de données", "où", "rgpd", "isolation"],
  },
  {
    id: "export-donnees",
    categoryId: "donnees",
    question: "Puis-je exporter mes données ?",
    answer: "Oui, à tout moment et quel que soit le plan : export CSV des articles et des analyses, et export complet au format JSON (articles, clients, conversations et messages, commandes, automatisations et tâches, recherches et affaires, comptes connectés, journal d'audit) dans Paramètres › Export et suppression. Les secrets ne sont jamais exportés. L'export complet est réservé au propriétaire et aux administrateurs.",
    keywords: ["exporter", "export", "télécharger", "sauvegarde", "json", "csv", "récupérer mes données"],
    link: { label: "Export et suppression", href: "/app/settings/data" },
  },
  {
    id: "supprimer-organisation",
    categoryId: "donnees",
    question: "Comment supprimer mon compte et mes données ?",
    answer: "Dans Paramètres › Export et suppression : seul le propriétaire peut supprimer l'organisation, en confirmant son nom. La suppression est définitive ; exportez vos données avant si vous souhaitez les garder.",
    keywords: ["supprimer", "suppression", "effacer", "fermer mon compte", "désinscription", "droit à l'oubli"],
    link: { label: "Export et suppression", href: "/app/settings/data" },
  },
  {
    id: "securite-compte",
    categoryId: "donnees",
    question: "Comment mon compte est-il protégé ?",
    answer: "Mot de passe haché (scrypt, 10 caractères minimum), session par cookie HttpOnly avec expiration glissante de 30 jours, limitation des tentatives de connexion et isolation des organisations en base. Mot de passe oublié : depuis la page de connexion, un lien valable une heure, à usage unique, permet d'en choisir un nouveau et ferme vos autres sessions ; connecté, le mot de passe se change dans Paramètres › Sécurité. L'authentification à deux facteurs n'est pas encore disponible.",
    keywords: ["sécurité", "mot de passe", "piratage", "deux facteurs", "2fa", "protéger", "mot de passe oublié"],
    link: { label: "Paramètres › Sécurité", href: "/app/settings/security" },
  },
  {
    id: "ia-confidentialite",
    categoryId: "donnees",
    question: "Mes messages et mes photos sont-ils envoyés à un service d'IA tiers ?",
    answer: "Aucun fournisseur d'IA tiers n'est intégré. Les photos et les messages passent par le serveur Selio, qui les transmet à mon modèle perso, un modèle privé, par un réseau privé ou une passerelle authentifiée ; votre navigateur ne l'appelle jamais. Les messages des acheteurs sont traités comme des données non fiables : nettoyés, balisés, et toute consigne cachée y est ignorée.",
    keywords: ["confidentialité", "ia", "tiers", "openai", "photos", "messages", "vie privée"],
  },
  {
    id: "duree-conservation",
    categoryId: "donnees",
    question: "Combien de temps les données sont-elles conservées ?",
    answer: `Les durées se règlent par organisation dans Paramètres › Organisation : par défaut ${RETENTION.messages} jours pour les messages, ${RETENTION.auditLogs} jours pour le journal d'audit et ${RETENTION.aiRequests} jours pour l'historique des requêtes IA. En mode connecté, un nettoyage quotidien les applique.`,
    keywords: ["conservation", "durée", "rétention", "combien de temps", "archivage", "purge"],
    link: { label: "Paramètres › Organisation", href: "/app/settings/organisation" },
  },

  // ---- Les filiales Selio -------------------------------------------------
  {
    id: "filiales-selio",
    categoryId: "filiales",
    question: "Quelles sont les filiales Selio ?",
    answer: "Selio est l'outil de gestion du revendeur. Autour de lui : Selio Studio (disponible) écrit vos annonces à partir de vos photos ; Selio Agents (en aperçu) gère l'administrateur, les équipes et les accès ; Selio Track, Selio Cloud et le générateur de compte Vinted sont en développement. On passe de l'un à l'autre depuis le bloc en haut du menu.",
    keywords: ["filiales", "studio", "agents", "track", "cloud", "générateur de compte", "nouveaux produits", "à venir", "feuille de route"],
    status: "planned",
  },
  {
    id: "studio-ou-generateur",
    categoryId: "filiales",
    question: "Selio Studio remplace-t-il le générateur d'annonces ?",
    answer: "Selio Studio, c'est le générateur d'annonces : vos photos deviennent une annonce complète (titre, description, attributs, prix), article après article, avec l'historique des annonces générées et ce qui performe. Le bouton « Générer une annonce » du menu y mène directement.",
    keywords: ["studio", "générateur", "remplacer", "différence", "annonces optimisées"],
  },
  {
    id: "selio-track",
    categoryId: "filiales",
    question: "Qu'est-ce que Selio Track ?",
    answer: `Selio Track, c'est l'analyse du marché : filtres suivis, scans de niche (score par marque et catégorie), recherches par photo et tendances, pour savoir quoi acheter. Statistiques seulement : aucune annonce republiée, aucun pseudo gardé. Réservé aux offres ${P.pro} (${Q.pro.trackFiltersFollowed} filtres, ${Q.pro.trackScansPerMonth} scans et ${Q.pro.trackPhotoSearchesPerMonth} recherches par photo par mois, ${Q.pro.trackHistoryMonths} mois d'historique) et ${P.agence} (${Q.agence.trackFiltersFollowed} filtres, ${Q.agence.trackScansPerMonth} scans, ${Q.agence.trackPhotoSearchesPerMonth} recherches, ${Q.agence.trackHistoryMonths} mois). Il est en développement ; une première version est déjà dans la démonstration.`,
    keywords: ["track", "resell track", "sourcing", "suivre", "revendeurs", "concurrents", "comptes suivis"],
    status: "planned",
  },
  {
    id: "selio-cloud",
    categoryId: "filiales",
    question: "Qu'est-ce que Selio Cloud ?",
    answer: `Selio Cloud est en développement : vos automatisations (messages, négociation, après-vente, stock automatique, relance après 24 h) tourneront sur notre machine, sans laisser votre ordinateur allumé avec l'extension. Il est inclus dans l'offre ${P.agence} et proposé en option avec ${P.starter} et ${P.pro}. Aujourd'hui, les actions sur Vinted passent encore par l'extension, navigateur ouvert.`,
    keywords: ["cloud", "serveur", "ordinateur éteint", "24h/24", "en continu", "sans extension"],
    status: "planned",
  },
  {
    id: "generateur-compte",
    categoryId: "filiales",
    question: "Qu'est-ce que le générateur de compte Vinted ?",
    answer: "Un assistant en développement pour préparer un nouveau compte vendeur : pseudo, présentation, photo de profil, réglages d'envoi et premières annonces. Le compte est créé par vous, à votre nom, dans le respect des règles de Vinted ; Selio ne crée aucun compte à votre place.",
    keywords: ["générateur de compte", "nouveau compte", "créer un compte", "ouvrir un compte", "profil vinted"],
    status: "planned",
  },
  {
    id: "agence-marque-blanche",
    categoryId: "filiales",
    question: "Je travaille en équipe ou en agence : où gérer les accès ?",
    answer: `Dans Selio Agents : l'administrateur, les équipes et les accès (propriétaire, administrateur, opérateur, lecture seule), avec le journal d'audit ; l'offre ${P.agence} accepte jusqu'à ${Q.agence.members} personnes et ${Q.agence.connections} comptes Vinted, avec les rôles d'équipe (${P.pro} : ${Q.pro.members} personnes). Les boutiques clientes et la marque blanche y sont en aperçu, en développement pour les agences et dépôts-vente. Les mêmes accès restent dans Paramètres › Comptes et accès.`,
    keywords: ["agence", "agents", "équipe", "accès", "administrateur", "dépôt-vente", "marque blanche", "professionnel", "clients"],
    status: "planned",
  },
  {
    id: "global-pays",
    categoryId: "filiales",
    question: "Selio sera-t-il disponible dans d'autres pays et sur d'autres plateformes ?",
    answer: "C'est en développement, sans date : d'autres pays d'Europe, puis d'autres plateformes comme Leboncoin, eBay ou Etsy. Aujourd'hui, Selio est en français et ne relie que Vinted, par l'extension, à titre expérimental.",
    keywords: ["pays", "international", "langue", "anglais", "leboncoin", "ebay", "etsy", "shopify"],
    status: "planned",
  },
  ];
}

// ---------------------------------------------------------------------------
// Recherche (sans dépendance) : normalisation, racines, synonymes, score
// ---------------------------------------------------------------------------

/** Groupes de mots équivalents (une question peut employer l'un pour l'autre). */
const SYNONYM_GROUPS: string[][] = [
  ["prix", "tarif", "tarifs", "cout", "coute", "payant", "abonnement", "formule", "plan", "offre", "offres", "facture", "facturation", "mensuel"],
  ["gratuit", "essai", "decouverte", "tester", "essayer"],
  ["fondateurs", "fondateur", "lancement", "promotion", "remise", "reduction"],
  ["ia", "intelligence", "artificielle", "assistant", "ollama", "modele", "robot", "chatgpt", "gpt"],
  ["annonce", "annonces", "listing", "publication", "publier", "poster"],
  ["republier", "republication", "remonter", "relancer", "booster"],
  ["acheter", "achat", "achats", "acquisition"],
  ["affaire", "affaires", "radar", "opportunite", "deal", "pepite"],
  ["supprimer", "suppression", "effacer", "fermer", "desinscrire", "desinscription"],
  ["donnees", "rgpd", "confidentialite", "privee"],
  ["securite", "proteger", "protection", "piratage", "pirate", "2fa"],
  ["message", "messages", "messagerie", "conversation", "discussion", "repondre", "chat"],
  ["equipe", "membre", "membres", "collaborateur", "collegue", "employe", "salarie", "inviter", "invitation"],
  ["role", "roles", "droit", "droits", "permission", "permissions", "acces"],
  ["marge", "benefice", "rentabilite", "gain", "profit"],
  ["negociation", "negocier", "contre", "marchander", "offre"],
  ["extension", "plugin", "chrome", "navigateur", "addon"],
  ["telephone", "mobile", "smartphone", "iphone", "android", "tablette"],
  ["exporter", "export", "telecharger", "sauvegarde", "sauvegarder"],
  ["stock", "inventaire", "article", "articles", "produit", "produits"],
  ["commande", "commandes", "expedition", "colis", "bordereau", "livraison", "etiquette"],
  ["photo", "photos", "image", "images"],
  ["automatique", "automatisation", "automatisations", "automatiser", "auto"],
  ["limite", "limites", "quota", "quotas", "plafond", "maximum", "depasser", "depassement"],
  ["filiale", "filiales", "studio", "agents", "agence", "track", "cloud", "international", "pays"],
  ["affilie", "officiel", "partenaire", "approuve"],
  ["demo", "demonstration", "fictif", "exemple"],
  ["vendre", "vente", "vendeur", "vendu"],
  ["compte", "comptes", "boutique", "profil"],
  ["duree", "durer", "longtemps", "periode", "jours"],
  ["garder", "conserver", "conservation", "retention"],
];

/**
 * Mots qui disent la FORME de la question plutôt que son sujet (« combien de temps »,
 * « comment ça marche ») : comptés, mais avec un poids réduit, pour que le sujet l'emporte.
 */
const WEAK_WORDS = ["combien", "temps", "fonctionne", "fonctionnement", "marche", "vraiment", "exactement", "possible", "existe"];
const WEAK_FACTOR = 0.35;
let WEAK: Set<string> | null = null;
function weakTerms(): Set<string> {
  WEAK ??= new Set(WEAK_WORDS.flatMap((w) => helpTokens(w)));
  return WEAK;
}

let SYNONYMS: Map<string, Set<string>> | null = null;
function synonyms(): Map<string, Set<string>> {
  if (SYNONYMS) return SYNONYMS;
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const stems = [...new Set(group.flatMap((w) => helpTokens(w)))];
    for (const s of stems) {
      const set = map.get(s) ?? new Set<string>();
      for (const o of stems) if (o !== s) set.add(o);
      map.set(s, set);
    }
  }
  SYNONYMS = map;
  return map;
}

interface IndexedEntry {
  entry: HelpEntry;
  question: string[];
  keywords: string[];
  answer: string[];
  category: string[];
  normalizedQuestion: string;
  all: Set<string>;
}

const FIELD_WEIGHT = { question: 3, keywords: 2.5, category: 1, answer: 1 } as const;

function buildIndex(entries: readonly HelpEntry[]): { items: IndexedEntry[]; idf: (t: string) => number } {
  const titles = new Map(HELP_CATEGORIES.map((c) => [c.id, c.title]));
  const items = entries.map((entry) => {
    const question = helpTokens(entry.question);
    const keywords = entry.keywords.flatMap(helpTokens);
    const answer = helpTokens(entry.answer);
    const category = helpTokens(titles.get(entry.categoryId) ?? "");
    return { entry, question, keywords, answer, category, normalizedQuestion: normalizeHelpText(entry.question), all: new Set([...question, ...keywords, ...answer, ...category]) };
  });
  const df = new Map<string, number>();
  for (const it of items) for (const t of it.all) df.set(t, (df.get(t) ?? 0) + 1);
  const n = items.length;
  return { items, idf: (t) => Math.log(1 + n / (1 + (df.get(t) ?? 0))) };
}

let INDEX: ReturnType<typeof buildIndex> | null = null;
function index() {
  INDEX ??= buildIndex(helpEntries());
  return INDEX;
}

/** 1 = mot identique ; 0,75 = début de mot (au moins 4 lettres) ; 0 = absent. */
function matchIn(field: string[], term: string): number {
  let best = 0;
  for (const t of field) {
    if (t === term) return 1;
    if (term.length >= 4 && t.length > term.length && t.startsWith(term)) best = Math.max(best, 0.75);
    else if (t.length >= 4 && term.length > t.length && term.startsWith(t) && term.length - t.length <= 2) best = Math.max(best, 0.6);
  }
  return best;
}

export interface HelpMatch {
  entry: HelpEntry;
  score: number;
  /** Mots de la question retrouvés (racines). */
  matched: string[];
  /** Part des mots de la question retrouvés dans l'entrée (0 à 1). */
  coverage: number;
}

/** Score minimal pour qu'une entrée compte comme une réponse pertinente. */
export const HELP_MIN_SCORE = 2;
/** Au-delà, une entrée est retenue même si la question ne la recouvre qu'en partie. */
export const HELP_CONFIDENT_SCORE = 12;

/**
 * Recherche instantanée dans la FAQ : accents et casse ignorés, racines, synonymes simples,
 * pondération par champ (question > mots-clés > catégorie, réponse) et rareté des mots.
 */
export function searchHelp(query: string, opts: { limit?: number; minScore?: number; categoryId?: HelpCategoryId } = {}): HelpMatch[] {
  const limit = opts.limit ?? 8;
  const minScore = opts.minScore ?? HELP_MIN_SCORE;
  const terms = [...new Set(helpTokens(query))].slice(0, 24);
  if (terms.length === 0) return [];
  const { items, idf } = index();
  const normalizedQuery = normalizeHelpText(query);
  const weak = weakTerms();
  const termWeight = (t: string) => (weak.has(t) ? WEAK_FACTOR : 1);
  const totalWeight = terms.reduce((s, t) => s + termWeight(t), 0);
  const out: HelpMatch[] = [];
  for (const it of items) {
    if (opts.categoryId && it.entry.categoryId !== opts.categoryId) continue;
    let score = 0;
    let matchedWeight = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const variants: [string, number][] = [[term, 1], ...[...(synonyms().get(term) ?? [])].map((s): [string, number] => [s, 0.55])];
      let best = 0;
      for (const [variant, factor] of variants) {
        const weight = idf(variant) * factor;
        const fieldScore = Math.max(
          matchIn(it.question, variant) * FIELD_WEIGHT.question,
          matchIn(it.keywords, variant) * FIELD_WEIGHT.keywords,
          matchIn(it.category, variant) * FIELD_WEIGHT.category,
          matchIn(it.answer, variant) * FIELD_WEIGHT.answer,
        );
        best = Math.max(best, fieldScore * weight);
      }
      if (best > 0) {
        score += best * termWeight(term);
        matchedWeight += termWeight(term);
        matched.push(term);
      }
    }
    if (score === 0) continue;
    const coverage = matchedWeight / totalWeight;
    score *= 0.4 + 0.6 * coverage;
    // Une question de la FAQ entièrement couverte par la recherche est plus probablement la bonne
    // (sur les mots de sujet : « combien de temps » ne suffit pas à désigner une question).
    const questionTerms = new Set(it.question.filter((t) => !weak.has(t)));
    const covered = [...questionTerms].filter((t) => terms.includes(t)).length;
    if (questionTerms.size > 0) score *= 1 + 0.5 * (covered / questionTerms.size);
    if (normalizedQuery.length >= 8 && it.normalizedQuestion.includes(normalizedQuery)) score += 4;
    if (score >= minScore) out.push({ entry: it.entry, score: Math.round(score * 100) / 100, matched, coverage: Math.round(coverage * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, limit);
}

export function helpEntryById(id: string): HelpEntry | undefined {
  return helpEntries().find((e) => e.id === id);
}

export function helpCategoryById(id: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.id === id);
}

/** Source citée sous une réponse (identifiant, question, catégorie). */
export function toHelpSource(entry: HelpEntry): { id: string; question: string; categoryId: string; categoryTitle: string } {
  return { id: entry.id, question: entry.question, categoryId: entry.categoryId, categoryTitle: helpCategoryById(entry.categoryId)?.title ?? "" };
}

export const HELP_NOT_FOUND_ANSWER = "Je n'ai pas trouvé de réponse à cette question dans l'aide de Selio. Essayez avec d'autres mots (par exemple « essai gratuit », « extension », « marge » ou « supprimer mes données ») ou parcourez les catégories de la FAQ.";

export interface HelpFaqAnswer {
  found: boolean;
  /** Réponse de la FAQ la plus pertinente, telle quelle. */
  answer: string;
  /** Questions retenues, de la plus pertinente à la moins pertinente (3 au plus). */
  sources: HelpEntry[];
  matches: HelpMatch[];
}

/**
 * Réponse tirée de la FAQ : la réponse de l'entrée la plus pertinente, et jusqu'à trois
 * questions sources (celles dont le score reste proche du meilleur).
 */
export function answerFromHelp(question: string, opts: { maxSources?: number } = {}): HelpFaqAnswer {
  const matches = searchHelp(question, { limit: 6 });
  const top = matches[0];
  // Une correspondance trop partielle (moins de la moitié des mots, score faible) n'est pas une réponse.
  if (!top || (top.coverage < 0.5 && top.score < HELP_CONFIDENT_SCORE)) return { found: false, answer: HELP_NOT_FOUND_ANSWER, sources: [], matches };
  const sources = matches.filter((m) => m.score >= top.score * 0.5).slice(0, opts.maxSources ?? 3).map((m) => m.entry);
  return { found: true, answer: top.entry.answer, sources, matches };
}
