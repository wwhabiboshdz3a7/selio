import type { ReactNode } from "react";
import { Bot, Calculator, CircleUser, Cloud, FileCheck, Filter, Gauge, LineChart, Scale, HandCoins, LayoutGrid, Lightbulb, FileStack, ListChecks, MoonStar, Palette, Radar, Search, Settings, ShieldCheck, Shirt, ShoppingCart, SlidersHorizontal, Sparkles, Store, TrendingUp, UserPlus, Users, Workflow, Camera } from "lucide-react";
import type { NavGroup, NavItem } from "../layout";

/**
 * L'écosystème Selio : cinq filiales, dans cet ordre (décision des fondateurs).
 * 1. Selio Manager — gestion et automatisation de l'activité Vinted (l'application historique, /app,
 *    identifiant d'espace « selio » gardé) ;
 * 2. Selio Studio — création et optimisation des annonces ;
 * 3. Selio Track — analyse du marché et des opportunités ;
 * 4. Selio Bot — recherche et achat d'articles (les anciens écrans du radar) ;
 * 5. Selio Compte — services liés aux comptes et accompagnement (identifiant historique « generateur »).
 * Selio Cloud et Selio Agent ne sont PAS des filiales : ce sont deux fonctionnalités intégrées à Selio
 * Manager (MANAGER_FEATURES), avec leurs pages (/cloud, /agents) dans le menu du Manager. Chaque filiale a
 * son menu et une teinte d'identité discrète (styles.css, [data-space]) ; l'accueil central (/app/espaces)
 * les présente toutes. « Selio Global » est le nom de l'entreprise, pas un produit : il n'a pas d'espace.
 */
export type SpaceId = "selio" | "studio" | "track" | "bot" | "generateur";
/** Zone affichée : un espace, ou l'accueil central. */
export type SpaceArea = SpaceId | "hub";
/** Fonctionnalités intégrées à Selio Manager (pas des filiales). */
export type FeatureId = "cloud" | "agents";
export type SpaceState = "available" | "preview" | "development";

export const SPACE_STATE_LABEL: Record<SpaceState, string> = {
  available: "Disponible",
  preview: "Aperçu",
  development: "En développement",
};

/**
 * Libellé de l'état d'un espace selon le mode : la démonstration garde « Aperçu » et « En développement » ; le mode
 * connecté n'affiche jamais ces étiquettes, mais « En cours d'activation » ou « Disponible prochainement ».
 */
export function spaceStateLabel(state: SpaceState, mode: "demo" | "connected"): string {
  if (mode === "demo") return SPACE_STATE_LABEL[state];
  return state === "available" ? "Disponible" : state === "preview" ? "En cours d'activation" : "Disponible prochainement";
}
/** Titre de la rubrique des espaces pas encore ouverts. */
export const upcomingSectionTitle = (mode: "demo" | "connected") => (mode === "demo" ? "En développement" : "Bientôt disponibles");

export interface SpaceDef {
  id: SpaceId;
  /** Nom complet (« Selio Studio »). */
  name: string;
  /** Nom court du sélecteur (« Studio »). */
  short: string;
  tagline: string;
  description: string;
  forWhom: string;
  home: string;
  icon: ReactNode;
  state: SpaceState;
  /** Ce que l'on y fait, en trois points. */
  does: string[];
}

/** Fonctionnalité intégrée à Selio Manager : ses pages apparaissent en sous-menu du Manager. */
export interface FeatureDef extends Omit<SpaceDef, "id"> {
  id: FeatureId;
  /** Sous-menu affiché sous l'entrée de la fonctionnalité, quand on est dans ses pages. */
  nav: NavItem[];
}

export { APP_PATH_PATTERN, FEATURE_PREFIXES, HUB_PATH, SPACE_PREFIXES } from "./paths";
import { FEATURE_PREFIXES, HUB_PATH, SPACE_PREFIXES } from "./paths";

export const SPACES: readonly SpaceDef[] = [
  {
    id: "selio", name: "Selio Manager", short: "Manager", tagline: "Gestion et automatisation de votre activité Vinted",
    description: "Votre activité au quotidien, sur tous vos comptes Vinted : stock et dressing, messagerie, commandes et ventes, marges, et les automatisations de compte (négociation par IA, relances, remise en ligne, réponses, après-vente).",
    forWhom: "Pour chaque revendeur, chaque jour",
    home: "/app", icon: <Gauge />, state: "available",
    does: ["Stock, dressing, messagerie, commandes et marges", "Négociation par IA, relances, remise en ligne automatique", "Multi-comptes, avec Selio Cloud et Selio Agent intégrés"],
  },
  {
    id: "studio", name: "Selio Studio", short: "Studio", tagline: "Création et optimisation de vos annonces",
    description: "Le générateur d'annonces : l'IA rédige titre, description, attributs et prix à partir de vos photos, article après article, et montre ce qui fait vendre.",
    forWhom: "Pour publier plus vite et mieux",
    home: "/studio", icon: <Sparkles />, state: "available",
    does: ["Annonces rédigées à partir des photos, à la suite", "Historique des annonces générées et leur note", "Ce qui performe : titres, photos, prix"],
  },
  {
    id: "track", name: "Selio Track", short: "Track", tagline: "Analyse du marché et des opportunités",
    description: "Suivez des filtres Vinted (prix médian, annonces actives, ventes estimées), notez une niche sur 100 et estimez un prix à partir d'une photo. Track analyse et identifie ; Selio Bot achète. Statistiques seulement : aucune annonce, aucun pseudo.",
    forWhom: "Pour sourcer et fixer ses prix (Pro et Agence)",
    home: "/track", icon: <TrendingUp />, state: "development",
    does: ["Filtres suivis, tendances sur 30 jours", "Scans de niche notés sur 100", "Recherche par photo : fourchette et délai"],
  },
  {
    id: "bot", name: "Selio Bot", short: "Bot", tagline: "Recherche et achat d'articles",
    description: "Recherches automatisées selon vos critères, surveillance des annonces et alertes : chaque bonne affaire est notée sur 100, avec sa revente estimée et sa marge potentielle. Vous achetez en 1 clic, ou plus tard automatiquement, dans vos limites de dépenses. Sans prix séparé : inclus selon votre forfait.",
    forWhom: "Pour acheter au bon prix, avant les autres",
    home: "/bot", icon: <Bot />, state: "available",
    does: ["Recherches surveillées, alertes et bonnes affaires notées sur 100", "Revente estimée, marge potentielle et limites de dépenses", "Achat rapide validé en 1 clic ; achat automatique fermé par défaut"],
  },
  {
    // Identifiant historique « generateur » gardé (teinte, vitrine) ; la filiale s'appelle Selio Compte (§5.15).
    id: "generateur", name: "Selio Compte", short: "Compte", tagline: "Services liés aux comptes et accompagnement",
    description: "Des services sur devis autour de vos comptes Vinted : création et préparation de comptes, configuration de Selio Manager, accompagnement de 30 jours ou en cas de restriction. Dans l'application, la checklist à suivre vous-même dans Vinted et les textes prêts à copier.",
    forWhom: "Pour ouvrir, préparer ou remettre à plat un compte",
    home: "/comptes", icon: <UserPlus />, state: "available",
    does: ["Création et préparation de comptes, commandes en volume sur devis", "Configuration de Selio Manager et accompagnement de 30 jours", "Checklist à cocher et textes prêts à copier dans Vinted"],
  },
];

/** Selio Cloud et Selio Agent : intégrés à Selio Manager, jamais présentés comme des filiales. */
export const MANAGER_FEATURES: readonly FeatureDef[] = [
  {
    id: "cloud", name: "Selio Cloud", short: "Cloud", tagline: "Vos automatisations tournent à distance, ordinateur éteint",
    description: "L'infrastructure qui fait tourner certaines automatisations de Selio Manager à distance, sans ordinateur allumé : un navigateur isolé par compte Vinted sur notre machine, où vous vous connectez vous-même, au rythme humain et avec votre accord.",
    forWhom: "Pour vendre même ordinateur éteint",
    home: "/cloud", icon: <Cloud />, state: "preview",
    does: ["Répondre aux messages, relancer après 24 h", "Jusqu'à 10 comptes Vinted, pause en un clic", "Journal des actions gardé 90 jours"],
    nav: [
      { to: "/cloud", label: "Tableau de bord", icon: <Cloud />, end: true, hint: "État du Cloud, comptes, dernières actions" },
      { to: "/cloud/comptes", label: "Comptes Cloud", icon: <CircleUser />, hint: "Relier, se connecter, pause, arrêt" },
      { to: "/cloud/journal", label: "Journal des actions", icon: <ListChecks />, hint: "Gardé 90 jours, export CSV" },
      { to: "/cloud/accord", label: "Accord et risques", icon: <FileCheck />, hint: "À lire avant toute activation" },
      { to: "/cloud/reglages", label: "Réglages", icon: <SlidersHorizontal />, hint: "Heures, rythme, plafonds" },
    ],
  },
  {
    id: "agents", name: "Selio Agent", short: "Agent", tagline: "Déléguer tâches et accès, travailler en équipe",
    description: "Déléguez des tâches et des accès à vos collaborateurs et prestataires : l'administrateur, les membres de l'équipe, leurs rôles et leurs accès. Les agences et dépôts-vente y suivent aussi leurs boutiques clientes.",
    forWhom: "Pour travailler à plusieurs",
    home: "/agents", icon: <Users />, state: "preview",
    does: ["Administrateur, équipes et rôles", "Accès délégués et journal d'audit", "Boutiques clientes et marque blanche (aperçu)"],
    nav: [
      { to: "/agents", label: "Équipe et accès", icon: <Users />, end: true, hint: "Membres, rôles et invitations" },
      { to: "/agents/clients", label: "Boutiques clientes", icon: <Store />, hint: "Aperçu : exemples fictifs" },
      { to: "/agents/marque-blanche", label: "Marque blanche", icon: <Palette />, hint: "Nom, logo texte et couleur" },
      { to: "/agents/facturation", label: "Facturation des clients", icon: <Calculator />, hint: "Aperçu : rien n'est encaissé" },
    ],
  },
];

export function spaceById(id: SpaceId): SpaceDef {
  return SPACES.find((s) => s.id === id)!;
}

export function featureById(id: FeatureId): FeatureDef {
  return MANAGER_FEATURES.find((f) => f.id === id)!;
}

/** Fonctionnalité intégrée à Selio Manager dont relève une adresse (null : aucune). */
export function featureForPath(pathname: string): FeatureId | null {
  for (const [prefix, id] of FEATURE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  }
  return null;
}

const SETTINGS: NavGroup = { items: [{ to: "/app/settings", label: "Paramètres", icon: <Settings /> }] };

/** Menus propres aux filiales (celui de Selio Manager, avec Cloud et Agent, reste dans layout.tsx). */
export const SPACE_GROUPS: Record<Exclude<SpaceArea, "selio">, NavGroup[]> = {
  hub: [
    { items: [{ to: HUB_PATH, label: "Vos espaces", icon: <LayoutGrid />, end: true }] },
    { title: "Les filiales", items: SPACES.map((s) => ({ to: s.home, label: s.name, icon: s.icon, end: s.id === "selio", hint: s.tagline })) },
    { title: "Intégrés à Selio Manager", items: MANAGER_FEATURES.map((f) => ({ to: f.home, label: f.name, icon: f.icon, hint: f.tagline })) },
    SETTINGS,
  ],
  studio: [
    { title: "Selio Studio", items: [
      { to: "/studio", label: "Créer", icon: <Sparkles />, end: true, hint: "Vos photos → annonce, article après article" },
      { to: "/studio/annonces", label: "Annonces générées", icon: <FileStack />, hint: "Historique et note du dressing" },
      { to: "/studio/performances", label: "Ce qui performe", icon: <Lightbulb />, hint: "Ce que vos ventes apprennent" },
      { to: "/studio/photos-portees", label: "Photos portées", icon: <MoonStar />, hint: "File de nuit et quota du mois" },
    ] },
    { title: "Dans Selio Manager", items: [
      { to: "/app/dressing", label: "Dressing intelligent", icon: <Shirt /> },
      { to: "/app/automatisation/negociation", label: "Négociation par IA", icon: <HandCoins /> },
    ] },
    SETTINGS,
  ],
  track: [
    { title: "Selio Track", items: [
      { to: "/track", label: "Tableau de bord", icon: <TrendingUp />, end: true, hint: "Filtres suivis, quotas, source des données" },
      { to: "/track/filtres", label: "Filtres suivis", icon: <Filter />, hint: "Lus toutes les 2 h, partagés entre clients" },
      { to: "/track/niches", label: "Scans de niche", icon: <Gauge />, hint: "Marque × catégorie notée sur 100" },
      { to: "/track/photo", label: "Recherche par photo", icon: <Camera />, hint: "Fourchette, stratégies et délai" },
    ] },
    { title: "Agence", items: [
      { to: "/track/ventes", label: "Flux des ventes", icon: <LineChart />, hint: "Par marque et catégorie" },
      { to: "/track/vendeurs", label: "Vendeurs concurrents", icon: <Scale />, hint: "À valider juridiquement (RGPD)" },
    ] },
    { title: "Dans Selio Bot", items: [
      { to: "/app/radar", label: "Bonnes affaires", icon: <Radar />, hint: "Track identifie, Selio Bot achète" },
      { to: "/bot/achat-auto", label: "Achat automatique", icon: <Bot /> },
    ] },
    SETTINGS,
  ],
  bot: [
    { title: "Selio Bot", items: [
      { to: "/bot", label: "Vue d'ensemble", icon: <Bot />, end: true, hint: "Recherches, bonnes affaires, limites et achats" },
      { to: "/app/radar", label: "Recherches et affaires", icon: <Search />, hint: "Recherches surveillées, affaires notées sur 100" },
      { to: "/app/purchase", label: "À valider", icon: <ShoppingCart />, badgeKey: "toReview", hint: "Achat rapide : vous validez chaque achat en 1 clic" },
      { to: "/bot/achat-auto", label: "Achat automatique", icon: <Workflow />, hint: "Fermé tant que la validation juridique manque" },
    ] },
    { title: "Dans Selio Manager", items: [
      { to: "/app/accounts", label: "Comptes Vinted", icon: <CircleUser />, hint: "Le compte Achat utilisé par Selio Bot" },
      { to: "/track", label: "Selio Track", icon: <TrendingUp />, hint: "Analyse du marché : où chercher" },
    ] },
    SETTINGS,
  ],
  generateur: [
    { title: "Selio Compte", items: [{ to: "/comptes", label: "Services et checklist", icon: <UserPlus />, end: true, hint: "Services sur devis, checklist à suivre vous-même dans Vinted" }] },
    { title: "Dans Selio Manager", items: [
      { to: "/studio", label: "Selio Studio", icon: <Sparkles />, hint: "Les premières annonces à partir de vos photos" },
      { to: "/app/accounts", label: "Comptes Vinted", icon: <Users /> },
      { to: "/agents", label: "Selio Agent", icon: <ShieldCheck />, hint: "Déléguer des accès à un prestataire" },
    ] },
    SETTINGS,
  ],
};

/** Pages communes à tous les espaces : elles gardent l'espace d'où l'on vient. */
const SHARED_PREFIXES = ["/app/settings", "/admin"];

/** Espace propriétaire d'une adresse (null : page commune, l'espace courant est conservé). */
export function spaceForPath(pathname: string): SpaceArea | null {
  if (SHARED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  if (pathname === HUB_PATH || pathname.startsWith(`${HUB_PATH}/`)) return "hub";
  for (const [prefix, id] of SPACE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  }
  return "selio";
}

const LAST_SPACE_KEY = "selio.space";

export function readLastSpace(): SpaceArea {
  try {
    const v = sessionStorage.getItem(LAST_SPACE_KEY);
    return v === "hub" || SPACES.some((sp) => sp.id === v) ? (v as SpaceArea) : "selio";
  } catch {
    return "selio";
  }
}

export function writeLastSpace(area: SpaceArea): void {
  try {
    sessionStorage.setItem(LAST_SPACE_KEY, area);
  } catch {
    // stockage indisponible : l'espace reste celui de l'adresse
  }
}
