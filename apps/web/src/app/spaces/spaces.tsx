import type { ReactNode } from "react";
import { Bot, Calculator, Camera, CircleUser, Cloud, FileCheck, Filter, Gauge, LineChart, Scale, HandCoins, LayoutGrid, Lightbulb, FileStack, ListChecks, Palette, Radar, Settings, ShieldCheck, Shirt, SlidersHorizontal, Sparkles, Store, TrendingUp, UserPlus, Users, Workflow } from "lucide-react";
import type { NavGroup } from "../layout";

/**
 * Selio et ses filiales. Selio est l'outil de gestion (l'application
 * historique, /app) ; Studio, Agents, Track, Cloud et le générateur de compte
 * s'appuient sur ses données. Chaque espace a son menu et une teinte
 * d'identité discrète (styles.css, [data-space]) ; l'accueil central
 * (/app/espaces) les présente tous. « Selio Global » est le nom de
 * l'entreprise, pas un produit : il n'a pas d'espace.
 */
export type SpaceId = "selio" | "studio" | "agents" | "track" | "cloud" | "generateur";
/** Zone affichée : un espace, ou l'accueil central. */
export type SpaceArea = SpaceId | "hub";
export type SpaceState = "available" | "preview" | "development";

export const SPACE_STATE_LABEL: Record<SpaceState, string> = {
  available: "Disponible",
  preview: "Aperçu",
  development: "En développement",
};

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

export { APP_PATH_PATTERN, HUB_PATH, SPACE_PREFIXES } from "./paths";
import { HUB_PATH, SPACE_PREFIXES } from "./paths";

export const SPACES: readonly SpaceDef[] = [
  {
    id: "selio", name: "Selio", short: "Gestion", tagline: "L'outil de gestion du revendeur",
    description: "Votre activité au quotidien, sur tous vos comptes Vinted : sourcing, achat, vente, bordereaux, après-vente et remise en ligne.",
    forWhom: "Pour chaque revendeur, chaque jour",
    home: "/app", icon: <Gauge />, state: "available",
    does: ["Stock, dressing, messagerie et commandes", "Automatisation : favoris, réponses, négociation, après-vente", "Bonnes affaires, achat assisté et marges"],
  },
  {
    id: "studio", name: "Selio Studio", short: "Studio", tagline: "Vos photos deviennent des annonces",
    description: "Le générateur d'annonces : l'IA rédige titre, description, attributs et prix à partir de vos photos, article après article, et montre ce qui fait vendre.",
    forWhom: "Pour publier plus vite et mieux",
    home: "/studio", icon: <Sparkles />, state: "available",
    does: ["Annonces rédigées à partir des photos, à la suite", "Historique des annonces générées et leur note", "Ce qui performe : titres, photos, prix"],
  },
  {
    id: "agents", name: "Selio Agents", short: "Agents", tagline: "Administrateur, équipes et accès",
    description: "Qui fait quoi sur vos comptes : l'administrateur, les membres de l'équipe et leurs accès. Les agences et dépôts-vente y suivent aussi leurs boutiques clientes.",
    forWhom: "Pour travailler à plusieurs",
    home: "/agents", icon: <Users />, state: "preview",
    does: ["Administrateur, équipes et rôles", "Accès et journal d'audit", "Boutiques clientes et marque blanche (aperçu)"],
  },
  {
    id: "track", name: "Selio Track", short: "Track", tagline: "Les statistiques du marché Vinted, pour sourcer au bon endroit",
    description: "Suivez des filtres Vinted (prix médian, annonces actives, ventes estimées), notez une niche sur 100 et estimez un prix à partir d'une photo. Statistiques seulement : aucune annonce, aucun pseudo.",
    forWhom: "Pour sourcer et fixer ses prix (Pro et Agence)",
    home: "/track", icon: <TrendingUp />, state: "development",
    does: ["Filtres suivis, tendances sur 30 jours", "Scans de niche notés sur 100", "Recherche par photo : fourchette et délai"],
  },
  {
    id: "cloud", name: "Selio Cloud", short: "Cloud", tagline: "Vos automatisations, même ordinateur éteint",
    description: "Vos réponses et vos relances continuent quand votre ordinateur est éteint : un navigateur isolé par compte Vinted sur notre machine, où vous vous connectez vous-même, au rythme humain et avec votre accord.",
    forWhom: "Pour vendre même ordinateur éteint",
    home: "/cloud", icon: <Cloud />, state: "preview",
    does: ["Répondre aux messages, relancer après 24 h", "Jusqu'à 10 comptes Vinted, pause en un clic", "Journal des actions gardé 90 jours"],
  },
  {
    id: "generateur", name: "Générateur de compte Vinted", short: "Générateur", tagline: "Un nouveau compte vendeur prêt en quelques minutes",
    description: "Un assistant pour préparer un nouveau compte vendeur : pseudo, présentation, photo de profil, réglages d'envoi et premières annonces. Le compte est créé par vous, à votre nom.",
    forWhom: "Pour ouvrir une nouvelle boutique",
    home: "/generateur", icon: <UserPlus />, state: "development",
    does: ["Pseudo et présentation rédigés par l'IA", "Photo de profil et réglages d'envoi", "Premières annonces depuis votre stock"],
  },
];

export function spaceById(id: SpaceId): SpaceDef {
  return SPACES.find((s) => s.id === id)!;
}

const SETTINGS: NavGroup = { items: [{ to: "/app/settings", label: "Paramètres", icon: <Settings /> }] };

/** Menus propres aux espaces (celui de Selio reste dans layout.tsx). */
export const SPACE_GROUPS: Record<Exclude<SpaceArea, "selio">, NavGroup[]> = {
  hub: [
    { items: [{ to: HUB_PATH, label: "Vos espaces", icon: <LayoutGrid />, end: true }] },
    { title: "Disponibles", items: SPACES.filter((s) => s.state !== "development").map((s) => ({ to: s.home, label: s.name, icon: s.icon, end: s.id === "selio", hint: s.tagline })) },
    { title: "En développement", items: SPACES.filter((s) => s.state === "development").map((s) => ({ to: s.home, label: s.name, icon: s.icon, hint: s.tagline })) },
    SETTINGS,
  ],
  studio: [
    { title: "Selio Studio", items: [
      { to: "/studio", label: "Créer", icon: <Sparkles />, end: true, hint: "Vos photos → annonce, article après article" },
      { to: "/studio/annonces", label: "Annonces générées", icon: <FileStack />, hint: "Historique et note du dressing" },
      { to: "/studio/performances", label: "Ce qui performe", icon: <Lightbulb />, hint: "Ce que vos ventes apprennent" },
    ] },
    { title: "Dans Selio", items: [
      { to: "/app/dressing", label: "Dressing intelligent", icon: <Shirt /> },
      { to: "/app/automatisation/negociation", label: "Négociation automatique", icon: <HandCoins /> },
    ] },
    SETTINGS,
  ],
  agents: [
    { title: "Selio Agents", items: [
      { to: "/agents", label: "Équipe et accès", icon: <Users />, end: true, hint: "Membres, rôles et invitations" },
      { to: "/app/settings/access", label: "Comptes et accès", icon: <ShieldCheck />, hint: "Qui peut faire quoi : la matrice des rôles" },
    ] },
    { title: "Agences (aperçu)", items: [
      { to: "/agents/clients", label: "Boutiques clientes", icon: <Store />, hint: "Exemples fictifs" },
      { to: "/agents/marque-blanche", label: "Marque blanche", icon: <Palette />, hint: "Nom, logo texte et couleur" },
      { to: "/agents/facturation", label: "Facturation des clients", icon: <Calculator />, hint: "Aperçu : rien n'est encaissé" },
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
    { title: "Dans Selio", items: [
      { to: "/app/radar", label: "Bonnes affaires", icon: <Radar /> },
      { to: "/app/auto-buy", label: "Achat auto", icon: <Bot /> },
    ] },
    SETTINGS,
  ],
  cloud: [
    { title: "Selio Cloud", items: [
      { to: "/cloud", label: "Tableau de bord", icon: <Cloud />, end: true, hint: "État du Cloud, comptes, dernières actions" },
      { to: "/cloud/comptes", label: "Comptes Cloud", icon: <CircleUser />, hint: "Relier, se connecter, pause, arrêt" },
      { to: "/cloud/journal", label: "Journal des actions", icon: <ListChecks />, hint: "Gardé 90 jours, export CSV" },
      { to: "/cloud/accord", label: "Accord et risques", icon: <FileCheck />, hint: "À lire avant toute activation" },
      { to: "/cloud/reglages", label: "Réglages", icon: <SlidersHorizontal />, hint: "Heures, rythme, plafonds" },
    ] },
    { title: "Dans Selio", items: [
      { to: "/app/automatisation", label: "Automatisation", icon: <Workflow /> },
      { to: "/app/accounts", label: "Comptes Vinted", icon: <Users /> },
    ] },
    SETTINGS,
  ],
  generateur: [
    { title: "Générateur de compte", items: [{ to: "/generateur", label: "Présentation", icon: <UserPlus />, end: true }] },
    { title: "Dans Selio", items: [{ to: "/app/accounts", label: "Comptes Vinted", icon: <Users /> }] },
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
