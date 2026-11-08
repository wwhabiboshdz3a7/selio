/**
 * Captures des filiales, prises dans la démonstration (données fictives, vraies
 * photos d'annonces) en clair et en sombre, 1600 × 1000, WebP. Procédure pour les
 * refaire : docs/VITRINE.md, « Captures ».
 */
import type { ProductSlug } from "./products";
import apercuClair from "./assets/apercu-clair.webp";
import apercuSombre from "./assets/apercu-sombre.webp";
import studioClair from "./assets/produit-studio-clair.webp";
import studioSombre from "./assets/produit-studio-sombre.webp";
import trackClair from "./assets/produit-track-clair.webp";
import trackSombre from "./assets/produit-track-sombre.webp";
import radarClair from "./assets/produit-radar-clair.webp";
import radarSombre from "./assets/produit-radar-sombre.webp";
import cloudClair from "./assets/produit-cloud-clair.webp";
import cloudSombre from "./assets/produit-cloud-sombre.webp";
import comptesClair from "./assets/produit-comptes-clair.webp";
import comptesSombre from "./assets/produit-comptes-sombre.webp";

export interface ProductShot {
  light: string;
  dark: string;
}

export const PRODUCT_SHOTS: Record<ProductSlug, ProductShot | null> = {
  manager: { light: apercuClair, dark: apercuSombre },
  studio: { light: studioClair, dark: studioSombre },
  track: { light: trackClair, dark: trackSombre },
  radar: { light: radarClair, dark: radarSombre },
  cloud: { light: cloudClair, dark: cloudSombre },
  comptes: { light: comptesClair, dark: comptesSombre },
};
