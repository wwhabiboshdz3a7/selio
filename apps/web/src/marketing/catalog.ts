/**
 * Source unique des modules présentés sur la vitrine : la constellation de
 * l'accueil et la page « Fonctionnalités » lisent cette même liste (mêmes
 * quatorze modules, mêmes titres, même état, même libellé d'état).
 */
export type Availability = "available" | "demo" | "experimental" | "planned";
export type ModuleTone = "violet" | "gold";

/** Une seule formulation de l'état, partout sur la vitrine. */
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Disponible",
  demo: "En démonstration",
  experimental: "Expérimental",
  planned: "En préparation",
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
}

/** Les quatorze modules, dans l'ordre de la visite. L'or reste un rehaut (trois modules). */
export const MODULES: readonly CatalogModule[] = [
  { id: "generateur", title: "Générateur d'annonces IA", summary: "Vos photos, et l'IA rédige titre, description, marque, taille et état. Le prix conseillé vient de ventes comparables.", href: "/fonctionnalites#generateur", tone: "gold", status: "demo" },
  { id: "dressing", title: "Dressing intelligent", summary: "Chaque annonce notée sur 100 avec ce qu'il faut améliorer, et un tri « en ligne depuis 7 jours et plus ».", href: "/fonctionnalites#dressing", tone: "violet", status: "demo" },
  { id: "republications", title: "Republications pré-faites", summary: "10 variantes prêtes par annonce, le suivi de celles déjà utilisées et de leur rendement à 48 h.", href: "/fonctionnalites#republications", tone: "violet", status: "demo" },
  { id: "revendeurs", title: "Analyse des revendeurs", summary: "Les grands vendeurs, leur niche, leurs marques et leur rotation : les niches porteuses ressortent.", href: "/fonctionnalites#revendeurs", tone: "violet", status: "demo" },
  { id: "bonnes-affaires", title: "Bonnes affaires", summary: "Le radar note chaque affaire sur 100 : coût réel (prix, port, protection), revente et bénéfice.", href: "/fonctionnalites#bonnes-affaires", tone: "gold", status: "demo" },
  { id: "a-valider", title: "À valider", summary: "Les meilleures affaires repérées par le radar, validées en un clic, avec les contrôles de budget.", href: "/fonctionnalites#a-valider", tone: "violet", status: "demo" },
  { id: "achat-auto", title: "Achat auto", summary: "Au-dessus de votre seuil, avec plafond par jour et délai d'annulation. Simulé tant qu'aucun connecteur d'achat n'est autorisé.", href: "/fonctionnalites#achat-auto", tone: "violet", status: "demo" },
  { id: "messagerie", title: "Messagerie et négociation", summary: "Chaque conversation connaît l'article, son prix plancher et votre marge.", href: "/fonctionnalites#messagerie", tone: "violet", status: "demo" },
  { id: "stock", title: "Articles et stock", summary: "Prix d'achat, plancher, statuts et import CSV, pensés pour la revente.", href: "/fonctionnalites#stock", tone: "violet", status: "available" },
  { id: "commandes", title: "Commandes et expédition", summary: "Une commande par vente, sans doublon, avec une marge figée au moment de la vente.", href: "/fonctionnalites#commandes", tone: "violet", status: "available" },
  { id: "analyses", title: "Analyses", summary: "Une galerie de graphiques : chiffre d'affaires, marge, rotation et objectif du mois.", href: "/fonctionnalites#analyses", tone: "violet", status: "available" },
  { id: "automatisations", title: "Automatisations", summary: "Des règles explicites, une validation humaine et un bouton d'arrêt.", href: "/fonctionnalites#automatisations", tone: "violet", status: "demo" },
  { id: "extension", title: "Extension navigateur", summary: "Capture d'un article et aide à la rédaction depuis la page Vinted ouverte.", href: "/fonctionnalites#extension", tone: "violet", status: "experimental" },
  { id: "ia-perso", title: "Votre IA personnelle", summary: "Un modèle privé (Ollama) appelé par le serveur Selio, jamais depuis le navigateur.", href: "/fonctionnalites#ia-perso", tone: "gold", status: "planned" },
];

export type ModuleId = (typeof MODULES)[number]["id"];
