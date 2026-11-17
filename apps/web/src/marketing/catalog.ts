/**
 * Source unique des modules présentés sur la vitrine : la constellation de
 * l'accueil et la page « Fonctionnalités » lisent cette même liste (mêmes
 * quatorze modules, mêmes titres, même état, même libellé d'état, même filiale).
 */
export type Availability = "available" | "demo" | "experimental" | "planned";
export type ModuleTone = "violet" | "gold";

/** Une seule formulation de l'état, partout sur la vitrine. */
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Disponible",
  demo: "Aperçu",
  experimental: "Expérimental",
  planned: "En préparation",
};

/** Filiale qui porte le module (ordre officiel) ; « gamme » : commun à toutes les filiales. */
export type ModuleProduct = "manager" | "studio" | "track" | "bot" | "gamme";

/** Nom affiché de la filiale d'un module (Selio Cloud et Selio Agent ne sont pas des filiales). */
export const MODULE_PRODUCT_LABEL: Record<ModuleProduct, string> = {
  manager: "Selio Manager",
  studio: "Selio Studio",
  track: "Selio Track",
  bot: "Selio Bot",
  gamme: "Toute la gamme",
};

export interface CatalogModule {
  id: string;
  title: string;
  /** Résumé court (carte de la constellation, infobulle d'étoile). */
  summary: string;
  /** Page de détail : l'ancre du module, ou sa page dédiée quand elle existe. */
  href: string;
  tone: ModuleTone;
  status: Availability;
  product: ModuleProduct;
}

/**
 * Les quatorze modules, rangés par filiale dans l'ordre officiel (Manager, Studio, Track, Bot),
 * puis l'IA commune à toute la gamme. Selio Compte est un service, sans module. L'or reste un
 * rehaut (trois modules).
 */
export const MODULES: readonly CatalogModule[] = [
  { id: "stock", title: "Articles et stock", summary: "Prix d'achat, plancher, statuts et import CSV, pensés pour la revente.", href: "/fonctionnalites#stock", tone: "violet", status: "available", product: "manager" },
  { id: "dressing", title: "Dressing intelligent", summary: "Chaque annonce notée sur 100 avec ce qu'il faut améliorer, et un tri « en ligne depuis 7 jours et plus ».", href: "/fonctionnalites#dressing", tone: "violet", status: "demo", product: "manager" },
  { id: "republications", title: "Republications pré-faites", summary: "10 variantes prêtes par annonce, le suivi de celles déjà utilisées et de leur rendement à 48 h.", href: "/fonctionnalites#republications", tone: "violet", status: "demo", product: "manager" },
  { id: "messagerie", title: "Messagerie et négociation", summary: "Chaque conversation connaît l'article, son prix plancher et votre marge.", href: "/fonctionnalites#messagerie", tone: "violet", status: "demo", product: "manager" },
  { id: "automatisations", title: "Automatisations", summary: "Des règles explicites, une validation humaine et un bouton d'arrêt.", href: "/fonctionnalites#automatisations", tone: "violet", status: "demo", product: "manager" },
  { id: "commandes", title: "Commandes et expédition", summary: "Une commande par vente, sans doublon, avec une marge figée au moment de la vente.", href: "/fonctionnalites#commandes", tone: "violet", status: "available", product: "manager" },
  { id: "analyses", title: "Analyses", summary: "Une galerie de graphiques : chiffre d'affaires, marge, rotation et objectif du mois.", href: "/fonctionnalites#analyses", tone: "violet", status: "available", product: "manager" },
  { id: "extension", title: "Extension navigateur", summary: "Capture d'un article et aide à la rédaction depuis la page Vinted ouverte.", href: "/fonctionnalites#extension", tone: "violet", status: "experimental", product: "manager" },
  { id: "generateur", title: "Générateur d'annonces IA", summary: "Vos photos, et l'IA rédige titre, description, marque, taille et état. Le prix conseillé vient de ventes comparables.", href: "/fonctionnalites#generateur", tone: "gold", status: "demo", product: "studio" },
  { id: "revendeurs", title: "Analyse du marché", summary: "Niches, grands vendeurs, marques et rotation : les opportunités ressortent, avant d'acheter ou de vendre.", href: "/fonctionnalites#revendeurs", tone: "violet", status: "demo", product: "track" },
  { id: "bonnes-affaires", title: "Bonnes affaires", summary: "Selio Bot note chaque affaire sur 100 : coût réel (prix, port, protection), revente et bénéfice.", href: "/fonctionnalites#bonnes-affaires", tone: "gold", status: "demo", product: "bot" },
  { id: "a-valider", title: "À valider", summary: "Les meilleures affaires repérées par Selio Bot, validées en un clic, avec les contrôles de budget.", href: "/fonctionnalites#a-valider", tone: "violet", status: "demo", product: "bot" },
  { id: "achat-auto", title: "Achat auto", summary: "Au-dessus de votre seuil, avec plafond par jour et délai d'annulation. Simulé tant qu'aucun connecteur d'achat n'est autorisé.", href: "/fonctionnalites#achat-auto", tone: "violet", status: "demo", product: "bot" },
  { id: "ia-perso", title: "Votre IA personnelle", summary: "Mon modèle perso, un modèle privé appelé par le serveur Selio, jamais depuis le navigateur.", href: "/fonctionnalites#ia-perso", tone: "gold", status: "planned", product: "gamme" },
];

export type ModuleId = (typeof MODULES)[number]["id"];
