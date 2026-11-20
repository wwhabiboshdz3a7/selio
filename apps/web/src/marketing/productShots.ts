/**
 * Captures d'écran des pages produit, prises sur des données d'exemple (vraies photos
 * d'annonces) en clair et en sombre, 1600 × 1000. Chaque capture existe en AVIF et en WebP,
 * en 1600 et 800 pixels de large (`<picture>` + `srcset`, voir `ShotPicture` dans
 * components.tsx) : le navigateur prend le plus léger qu'il sait lire, à la bonne taille.
 * Procédure pour les refaire : docs/VITRINE.md, « Captures ». Les fichiers gardent leur ancien
 * nom (produit-radar-* montre les bonnes affaires de Selio Bot, produit-agents-* l'équipe de
 * Selio Agent) ; les légendes le disent. Selio Compte n'a pas encore de capture : celle de
 * l'ancienne checklist (produit-comptes-*) ne montre pas ses services, la page affiche une illustration.
 */
import type { ProductSlug } from "./products";
import apercuClair from "./assets/apercu-clair.webp";
import apercuClair800 from "./assets/apercu-clair-800.webp";
import apercuClairAvif from "./assets/apercu-clair.avif";
import apercuClairAvif800 from "./assets/apercu-clair-800.avif";
import apercuSombre from "./assets/apercu-sombre.webp";
import apercuSombre800 from "./assets/apercu-sombre-800.webp";
import apercuSombreAvif from "./assets/apercu-sombre.avif";
import apercuSombreAvif800 from "./assets/apercu-sombre-800.avif";
import studioClair from "./assets/produit-studio-clair.webp";
import studioClair800 from "./assets/produit-studio-clair-800.webp";
import studioClairAvif from "./assets/produit-studio-clair.avif";
import studioClairAvif800 from "./assets/produit-studio-clair-800.avif";
import studioSombre from "./assets/produit-studio-sombre.webp";
import studioSombre800 from "./assets/produit-studio-sombre-800.webp";
import studioSombreAvif from "./assets/produit-studio-sombre.avif";
import studioSombreAvif800 from "./assets/produit-studio-sombre-800.avif";
import trackClair from "./assets/produit-track-clair.webp";
import trackClair800 from "./assets/produit-track-clair-800.webp";
import trackClairAvif from "./assets/produit-track-clair.avif";
import trackClairAvif800 from "./assets/produit-track-clair-800.avif";
import trackSombre from "./assets/produit-track-sombre.webp";
import trackSombre800 from "./assets/produit-track-sombre-800.webp";
import trackSombreAvif from "./assets/produit-track-sombre.avif";
import trackSombreAvif800 from "./assets/produit-track-sombre-800.avif";
import radarClair from "./assets/produit-radar-clair.webp";
import radarClair800 from "./assets/produit-radar-clair-800.webp";
import radarClairAvif from "./assets/produit-radar-clair.avif";
import radarClairAvif800 from "./assets/produit-radar-clair-800.avif";
import radarSombre from "./assets/produit-radar-sombre.webp";
import radarSombre800 from "./assets/produit-radar-sombre-800.webp";
import radarSombreAvif from "./assets/produit-radar-sombre.avif";
import radarSombreAvif800 from "./assets/produit-radar-sombre-800.avif";
import cloudClair from "./assets/produit-cloud-clair.webp";
import cloudClair800 from "./assets/produit-cloud-clair-800.webp";
import cloudClairAvif from "./assets/produit-cloud-clair.avif";
import cloudClairAvif800 from "./assets/produit-cloud-clair-800.avif";
import cloudSombre from "./assets/produit-cloud-sombre.webp";
import cloudSombre800 from "./assets/produit-cloud-sombre-800.webp";
import cloudSombreAvif from "./assets/produit-cloud-sombre.avif";
import cloudSombreAvif800 from "./assets/produit-cloud-sombre-800.avif";
import agentsClair from "./assets/produit-agents-clair.webp";
import agentsClair800 from "./assets/produit-agents-clair-800.webp";
import agentsClairAvif from "./assets/produit-agents-clair.avif";
import agentsClairAvif800 from "./assets/produit-agents-clair-800.avif";
import agentsSombre from "./assets/produit-agents-sombre.webp";
import agentsSombre800 from "./assets/produit-agents-sombre-800.webp";
import agentsSombreAvif from "./assets/produit-agents-sombre.avif";
import agentsSombreAvif800 from "./assets/produit-agents-sombre-800.avif";

/** Une capture dans un thème : WebP (repli) et AVIF, en 1600 et 800 pixels de large. */
export interface ShotSources {
  webp: string;
  webp800: string;
  avif: string;
  avif800: string;
}

export interface ProductShot {
  light: ShotSources;
  dark: ShotSources;
}

const set = (webp: string, webp800: string, avif: string, avif800: string): ShotSources => ({ webp, webp800, avif, avif800 });

/** Capture du dressing intelligent de Selio Manager (accueil, page Manager, pages d'atterrissage). */
export const MANAGER_SHOT: ProductShot = {
  light: set(apercuClair, apercuClair800, apercuClairAvif, apercuClairAvif800),
  dark: set(apercuSombre, apercuSombre800, apercuSombreAvif, apercuSombreAvif800),
};

export const PRODUCT_SHOTS: Record<ProductSlug, ProductShot | null> = {
  manager: MANAGER_SHOT,
  studio: { light: set(studioClair, studioClair800, studioClairAvif, studioClairAvif800), dark: set(studioSombre, studioSombre800, studioSombreAvif, studioSombreAvif800) },
  track: { light: set(trackClair, trackClair800, trackClairAvif, trackClairAvif800), dark: set(trackSombre, trackSombre800, trackSombreAvif, trackSombreAvif800) },
  bot: { light: set(radarClair, radarClair800, radarClairAvif, radarClairAvif800), dark: set(radarSombre, radarSombre800, radarSombreAvif, radarSombreAvif800) },
  compte: null,
  cloud: { light: set(cloudClair, cloudClair800, cloudClairAvif, cloudClairAvif800), dark: set(cloudSombre, cloudSombre800, cloudSombreAvif, cloudSombreAvif800) },
  agent: { light: set(agentsClair, agentsClair800, agentsClairAvif, agentsClairAvif800), dark: set(agentsSombre, agentsSombre800, agentsSombreAvif, agentsSombreAvif800) },
};
