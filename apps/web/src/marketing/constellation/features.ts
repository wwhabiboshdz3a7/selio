/**
 * Les 14 étoiles de la constellation Selio. Chaque étoile porte une
 * fonctionnalité réelle, avec son état honnête (identique à la page
 * « Fonctionnalités ») et un lien vers son détail.
 */
export type StarTone = "violet" | "gold";
export type StarStatus = "available" | "demo" | "experimental" | "planned";

export interface ConstellationFeature {
  id: string;
  title: string;
  text: string;
  href: string;
  tone: StarTone;
  status: StarStatus;
}

export const STATUS_LABEL: Record<StarStatus, string> = {
  available: "Disponible",
  demo: "En démonstration",
  experimental: "À valider",
  planned: "En préparation",
};

export const CONSTELLATION: readonly ConstellationFeature[] = [
  { id: "generateur", title: "Générateur d'annonces IA", text: "Vos photos, et l'IA rédige titre, description, marque, taille et état. Le prix conseillé vient de ventes comparables.", href: "/fonctionnalites#generateur", tone: "gold", status: "demo" },
  { id: "dressing", title: "Dressing intelligent", text: "Chaque annonce notée sur 100 avec ce qu'il faut améliorer, et un tri « en ligne depuis 7 jours et plus ».", href: "/fonctionnalites#dressing", tone: "violet", status: "demo" },
  { id: "republications", title: "Republications pré-faites", text: "10 variantes prêtes par annonce, le suivi de celles déjà utilisées et de leur rendement à 48 h.", href: "/fonctionnalites#dressing", tone: "violet", status: "demo" },
  { id: "revendeurs", title: "Analyse des revendeurs", text: "Les grands vendeurs, leur niche, leurs marques et leur rotation : les niches porteuses ressortent.", href: "/fonctionnalites#revendeurs", tone: "violet", status: "demo" },
  { id: "bonnes-affaires", title: "Bonnes affaires", text: "Le radar note chaque affaire sur 100 : coût réel (prix, port, protection), revente et bénéfice.", href: "/fonctionnalites#bonnes-affaires", tone: "gold", status: "demo" },
  { id: "a-valider", title: "À valider", text: "Les meilleures affaires repérées par le radar, validées en un clic, avec les contrôles de budget.", href: "/fonctionnalites#a-valider", tone: "violet", status: "demo" },
  { id: "achat-auto", title: "Achat auto", text: "Au-dessus de votre seuil, avec plafond par jour et délai d'annulation. Simulé tant qu'aucun connecteur d'achat n'est autorisé.", href: "/fonctionnalites#achat-auto", tone: "violet", status: "demo" },
  { id: "messagerie", title: "Messagerie et négociation", text: "Chaque conversation connaît l'article, son prix plancher et votre marge.", href: "/fonctionnalites#messagerie", tone: "violet", status: "demo" },
  { id: "stock", title: "Stock et articles", text: "Prix d'achat, plancher, statuts et import CSV, pensés pour la revente.", href: "/fonctionnalites#stock", tone: "violet", status: "available" },
  { id: "commandes", title: "Commandes et expédition", text: "Une commande par vente, sans doublon, avec une marge figée au moment de la vente.", href: "/fonctionnalites#commandes", tone: "violet", status: "available" },
  { id: "analyses", title: "Analyses", text: "Une galerie de graphiques : chiffre d'affaires, marge, rotation et objectif du mois.", href: "/fonctionnalites#analyses", tone: "violet", status: "available" },
  { id: "automatisations", title: "Automatisations", text: "Des règles explicites, une validation humaine et un bouton d'arrêt.", href: "/fonctionnalites#automatisations", tone: "violet", status: "demo" },
  { id: "extension", title: "Extension navigateur", text: "Capture d'un article et aide à la rédaction depuis la page Vinted ouverte.", href: "/extension", tone: "violet", status: "experimental" },
  { id: "ia-perso", title: "Votre IA personnelle", text: "Un modèle privé (Ollama) appelé par le serveur Selio, jamais depuis le navigateur.", href: "/assistant-ia", tone: "gold", status: "planned" },
];
