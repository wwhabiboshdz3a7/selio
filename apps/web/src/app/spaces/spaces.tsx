import type { ReactNode } from "react";
import { Building2, Calculator, FileStack, Gauge, Globe2, HandCoins, LayoutGrid, Lightbulb, Palette, Ruler, Settings, Shirt, Sparkles, Store, Users } from "lucide-react";
import type { NavGroup } from "../layout";

/**
 * Les quatre espaces Selio. Selio est l'outil de gestion (l'application
 * historique, /app) ; Studio, Agence et Global s'appuient sur ses données.
 * Chaque espace a son menu et une teinte d'identité discrète (styles.css,
 * [data-space]) ; l'accueil central (/app/espaces) les présente tous.
 */
export type SpaceId = "selio" | "studio" | "agence" | "global";
/** Zone affichée : un espace, ou l'accueil central. */
export type SpaceArea = SpaceId | "hub";
export type SpaceState = "available" | "preview" | "planned";

export const SPACE_STATE_LABEL: Record<SpaceState, string> = {
  available: "Disponible",
  preview: "Aperçu",
  planned: "En préparation",
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

export { APP_PATH_PATTERN, HUB_PATH } from "./paths";
import { HUB_PATH } from "./paths";

export const SPACES: readonly SpaceDef[] = [
  {
    id: "selio", name: "Selio", short: "Gestion", tagline: "L'outil de gestion du revendeur",
    description: "Votre activité au quotidien : stock, messages, négociation, commandes, achats et marges, sur tous vos comptes Vinted.",
    forWhom: "Pour chaque revendeur, chaque jour",
    home: "/app", icon: <Gauge />, state: "available",
    does: ["Stock, dressing et republications", "Messagerie et négociation selon vos règles", "Bonnes affaires, commandes et marges"],
  },
  {
    id: "studio", name: "Selio Studio", short: "Studio", tagline: "Des annonces qui performent, écrites pour vous",
    description: "Vos photos deviennent des annonces complètes, à la suite. Studio vous montre ce qui fait vendre dans vos propres annonces.",
    forWhom: "Pour publier plus vite et mieux",
    home: "/studio", icon: <Sparkles />, state: "available",
    does: ["Annonces rédigées à partir des photos, à la suite", "Historique des annonces générées et leur note", "Ce qui performe : titres, photos, prix"],
  },
  {
    id: "agence", name: "Selio Agence", short: "Agence", tagline: "L'outil Selio à vos couleurs",
    description: "Pour les agences de revente, dépôts-vente et équipes : suivre plusieurs boutiques clientes, avec votre marque.",
    forWhom: "Pour les professionnels qui gèrent d'autres boutiques",
    home: "/agence", icon: <Building2 />, state: "preview",
    does: ["Boutiques clientes et leurs chiffres", "Marque blanche : nom, logo texte, couleur", "Équipe, accès et facturation des clients"],
  },
  {
    id: "global", name: "Selio Global", short: "Global", tagline: "Une application par pays",
    description: "Chaque marché a ses codes, ses marques, ses tailles et sa langue : l'Europe d'abord, puis les États-Unis et l'Australie, et d'autres places de marché.",
    forWhom: "Pour vendre au-delà de la France",
    home: "/global", icon: <Globe2 />, state: "planned",
    does: ["Marchés : langue, devise, tailles, marques", "Convertisseur de tailles, utilisable dès maintenant", "Places de marché prévues après Vinted"],
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
    { title: "Espaces", items: SPACES.map((s) => ({ to: s.home, label: s.name, icon: s.icon, end: s.id === "selio", hint: s.tagline })) },
    SETTINGS,
  ],
  studio: [
    { items: [
      { to: "/studio", label: "Créer", icon: <Sparkles />, end: true, hint: "Vos photos → annonce, article après article" },
      { to: "/studio/annonces", label: "Annonces générées", icon: <FileStack />, hint: "Historique et note du dressing" },
      { to: "/studio/performances", label: "Ce qui performe", icon: <Lightbulb />, hint: "Ce que vos ventes apprennent" },
    ] },
    { title: "Dans Selio", items: [
      { to: "/app/dressing", label: "Dressing intelligent", icon: <Shirt /> },
      { to: "/app/selling-rules", label: "Négociation et marges", icon: <HandCoins /> },
    ] },
    SETTINGS,
  ],
  agence: [
    { items: [
      { to: "/agence", label: "Clients", icon: <Store />, end: true, hint: "Boutiques clientes (exemples fictifs)" },
      { to: "/agence/marque-blanche", label: "Marque blanche", icon: <Palette />, hint: "Nom, logo texte et couleur" },
      { to: "/agence/equipe", label: "Équipe et accès", icon: <Users /> },
      { to: "/agence/facturation", label: "Facturation des clients", icon: <Calculator />, hint: "Aperçu : rien n'est encaissé" },
    ] },
    SETTINGS,
  ],
  global: [
    { items: [
      { to: "/global", label: "Marchés", icon: <Globe2 />, end: true, hint: "Pays : langue, devise, tailles, marques" },
      { to: "/global/tailles", label: "Convertisseur de tailles", icon: <Ruler />, hint: "FR, UK, US, IT, DE" },
      { to: "/global/places-de-marche", label: "Places de marché", icon: <Store />, hint: "Vinted, puis Leboncoin, eBay, Etsy, Shopify" },
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
  for (const id of ["studio", "agence", "global"] as const) {
    if (pathname === `/${id}` || pathname.startsWith(`/${id}/`)) return id;
  }
  return "selio";
}

const LAST_SPACE_KEY = "selio.space";

export function readLastSpace(): SpaceArea {
  try {
    const v = sessionStorage.getItem(LAST_SPACE_KEY);
    return v === "hub" || v === "selio" || v === "studio" || v === "agence" || v === "global" ? v : "selio";
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
