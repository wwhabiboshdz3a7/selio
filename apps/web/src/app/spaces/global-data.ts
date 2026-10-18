/**
 * Selio Global (en préparation) : repères par marché et tables de tailles.
 * Ce sont des informations générales, pas des mesures Selio : aucun marché
 * hors de France n'est ouvert et aucune autre place de marché n'est reliée.
 */
export type MarketState = "available" | "preparing" | "later";

export const MARKET_STATE_LABEL: Record<MarketState, string> = {
  available: "Disponible",
  preparing: "En préparation",
  later: "Ensuite",
};

export interface Market {
  code: string;
  name: string;
  region: "Europe" | "Amérique du Nord" | "Océanie";
  state: MarketState;
  language: string;
  currency: string;
  /** Domaine Vinted du pays (null : présence de Vinted à confirmer). */
  vintedDomain: string | null;
  clothingSizes: string;
  shoeSizes: string;
  /** Marques souvent recherchées : repère indicatif, à confirmer par vos propres données. */
  brands: string[];
}

export const MARKETS: readonly Market[] = [
  { code: "FR", name: "France", region: "Europe", state: "available", language: "Français", currency: "Euro (EUR)", vintedDomain: "vinted.fr", clothingSizes: "FR (34, 36, 38…)", shoeSizes: "EU (36 à 46)", brands: ["Zara", "Sézane", "Ralph Lauren", "Levi's", "Nike"] },
  { code: "BE", name: "Belgique", region: "Europe", state: "preparing", language: "Français, néerlandais", currency: "Euro (EUR)", vintedDomain: "vinted.be", clothingSizes: "FR (comme en France)", shoeSizes: "EU", brands: ["Zara", "Mango", "JBC", "Nike", "Levi's"] },
  { code: "ES", name: "Espagne", region: "Europe", state: "preparing", language: "Espagnol", currency: "Euro (EUR)", vintedDomain: "vinted.es", clothingSizes: "ES (comme en France)", shoeSizes: "EU", brands: ["Zara", "Mango", "Bershka", "Pull&Bear", "Desigual"] },
  { code: "IT", name: "Italie", region: "Europe", state: "preparing", language: "Italien", currency: "Euro (EUR)", vintedDomain: "vinted.it", clothingSizes: "IT (FR + 4 : un 38 devient 42)", shoeSizes: "EU", brands: ["Zara", "Liu Jo", "Benetton", "Guess", "Nike"] },
  { code: "DE", name: "Allemagne", region: "Europe", state: "preparing", language: "Allemand", currency: "Euro (EUR)", vintedDomain: "vinted.de", clothingSizes: "DE (FR − 2 : un 38 devient 36)", shoeSizes: "EU", brands: ["Adidas", "H&M", "Zara", "Esprit", "s.Oliver"] },
  { code: "NL", name: "Pays-Bas", region: "Europe", state: "preparing", language: "Néerlandais", currency: "Euro (EUR)", vintedDomain: "vinted.nl", clothingSizes: "EU (comme en Allemagne)", shoeSizes: "EU", brands: ["Scotch & Soda", "Zara", "Nike", "H&M", "Vero Moda"] },
  { code: "PT", name: "Portugal", region: "Europe", state: "preparing", language: "Portugais", currency: "Euro (EUR)", vintedDomain: "vinted.pt", clothingSizes: "EU (comme en France)", shoeSizes: "EU", brands: ["Zara", "Mango", "Salsa", "Bershka", "Pull&Bear"] },
  { code: "UK", name: "Royaume-Uni", region: "Europe", state: "preparing", language: "Anglais", currency: "Livre sterling (GBP)", vintedDomain: "vinted.co.uk", clothingSizes: "UK (6, 8, 10…)", shoeSizes: "UK", brands: ["Nike", "Zara", "Ralph Lauren", "Next", "River Island"] },
  { code: "US", name: "États-Unis", region: "Amérique du Nord", state: "later", language: "Anglais (américain)", currency: "Dollar américain (USD)", vintedDomain: "vinted.com", clothingSizes: "US (2, 4, 6…)", shoeSizes: "US", brands: ["Nike", "Levi's", "Ralph Lauren", "Lululemon", "Coach"] },
  { code: "AU", name: "Australie", region: "Océanie", state: "later", language: "Anglais (australien)", currency: "Dollar australien (AUD)", vintedDomain: null, clothingSizes: "AU (proche des tailles UK)", shoeSizes: "UK et US selon les marques", brands: ["Country Road", "Nike", "Zara", "Lululemon", "UGG"] },
];

export type MarketplaceState = "active" | "planned";

export interface Marketplace {
  id: string;
  name: string;
  kind: string;
  state: MarketplaceState;
  /** Ce que Selio y apporterait (ou y apporte, pour Vinted). */
  value: string;
  note: string;
}

/** Dans l'ordre du document : Vinted aujourd'hui, puis Leboncoin, eBay, Etsy et Shopify. */
export const MARKETPLACES: readonly Marketplace[] = [
  { id: "vinted", name: "Vinted", kind: "Mode de seconde main entre particuliers", state: "active", value: "Stock, dressing, messagerie, négociation, commandes et bonnes affaires, sur plusieurs comptes.", note: "Via l'extension Selio, sur les pages que vous ouvrez : Vinted ne propose pas d'API publique aux vendeurs. Selio n'est ni affilié à Vinted ni approuvé par Vinted." },
  { id: "leboncoin", name: "Leboncoin", kind: "Petites annonces généralistes, en France", state: "planned", value: "Diffuser les mêmes articles depuis votre stock Selio et retrouver leurs messages au même endroit.", note: "Aucun connecteur aujourd'hui, aucune date annoncée." },
  { id: "ebay", name: "eBay", kind: "Enchères et prix fixe, à l'international", state: "planned", value: "Vendre au-delà de la France les pièces qui s'y vendent mieux, avec le même stock.", note: "Aucun connecteur aujourd'hui, aucune date annoncée." },
  { id: "etsy", name: "Etsy", kind: "Vintage et créations", state: "planned", value: "Mettre en valeur les pièces vintage et les créations, avec les annonces de Studio.", note: "Aucun connecteur aujourd'hui, aucune date annoncée." },
  { id: "shopify", name: "Shopify", kind: "Votre propre boutique en ligne", state: "planned", value: "Ouvrir votre boutique à votre nom, alimentée par le même stock.", note: "Aucun connecteur aujourd'hui, aucune date annoncée." },
];

// ---------- Tailles ----------

export type SizeChartId = "women" | "men" | "women_shoes" | "men_shoes";

export interface SizeChart {
  id: SizeChartId;
  label: string;
  /** Systèmes de tailles (colonnes), le premier sert de référence. */
  systems: { key: string; label: string }[];
  rows: Record<string, string>[];
  note: string;
}

export const SIZE_CHARTS: readonly SizeChart[] = [
  {
    id: "women", label: "Vêtements femme",
    systems: [{ key: "FR", label: "FR" }, { key: "UK", label: "UK" }, { key: "US", label: "US" }, { key: "IT", label: "IT" }, { key: "DE", label: "DE / NL" }, { key: "INT", label: "Lettres" }],
    rows: [
      { FR: "34", UK: "6", US: "2", IT: "38", DE: "32", INT: "XS" },
      { FR: "36", UK: "8", US: "4", IT: "40", DE: "34", INT: "S" },
      { FR: "38", UK: "10", US: "6", IT: "42", DE: "36", INT: "M" },
      { FR: "40", UK: "12", US: "8", IT: "44", DE: "38", INT: "L" },
      { FR: "42", UK: "14", US: "10", IT: "46", DE: "40", INT: "XL" },
      { FR: "44", UK: "16", US: "12", IT: "48", DE: "42", INT: "XXL" },
      { FR: "46", UK: "18", US: "14", IT: "50", DE: "44", INT: "3XL" },
      { FR: "48", UK: "20", US: "16", IT: "52", DE: "46", INT: "4XL" },
    ],
    note: "Hauts, robes, pantalons. Belgique, Espagne et Portugal utilisent les tailles françaises.",
  },
  {
    id: "men", label: "Vestes et costumes homme",
    systems: [{ key: "FR", label: "FR / IT / DE" }, { key: "UK", label: "UK / US" }, { key: "INT", label: "Lettres" }],
    rows: [
      { FR: "44", UK: "34", INT: "XS" },
      { FR: "46", UK: "36", INT: "S" },
      { FR: "48", UK: "38", INT: "M" },
      { FR: "50", UK: "40", INT: "L" },
      { FR: "52", UK: "42", INT: "XL" },
      { FR: "54", UK: "44", INT: "XXL" },
      { FR: "56", UK: "46", INT: "3XL" },
    ],
    note: "Tour de poitrine en pouces pour UK et US. Les t-shirts et pulls suivent surtout les lettres.",
  },
  {
    id: "women_shoes", label: "Chaussures femme",
    systems: [{ key: "EU", label: "EU" }, { key: "UK", label: "UK" }, { key: "US", label: "US" }],
    rows: [
      { EU: "35", UK: "2,5", US: "5" },
      { EU: "36", UK: "3,5", US: "6" },
      { EU: "37", UK: "4", US: "6,5" },
      { EU: "38", UK: "5", US: "7,5" },
      { EU: "39", UK: "6", US: "8,5" },
      { EU: "40", UK: "6,5", US: "9" },
      { EU: "41", UK: "7,5", US: "10" },
      { EU: "42", UK: "8", US: "10,5" },
    ],
    note: "En Australie, les chaussures femme suivent le plus souvent les tailles US.",
  },
  {
    id: "men_shoes", label: "Chaussures homme",
    systems: [{ key: "EU", label: "EU" }, { key: "UK", label: "UK" }, { key: "US", label: "US" }],
    rows: [
      { EU: "39", UK: "5,5", US: "6,5" },
      { EU: "40", UK: "6,5", US: "7,5" },
      { EU: "41", UK: "7", US: "8" },
      { EU: "42", UK: "8", US: "9" },
      { EU: "43", UK: "9", US: "10" },
      { EU: "44", UK: "9,5", US: "10,5" },
      { EU: "45", UK: "10,5", US: "11,5" },
      { EU: "46", UK: "11", US: "12" },
    ],
    note: "En Australie, les chaussures homme suivent le plus souvent les tailles UK.",
  },
];

/** Ligne de la table correspondant à une taille donnée dans un système (null si inconnue). */
export function convertSize(chart: SizeChart, system: string, value: string): Record<string, string> | null {
  return chart.rows.find((r) => r[system] === value) ?? null;
}
