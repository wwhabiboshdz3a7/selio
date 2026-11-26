import { z } from "zod";
import { cents, id, isoDate, longText, nameText, nonNegCents, shortText, tags } from "./common";

export const ITEM_STATUSES = ["in_stock", "listed", "reserved", "sold", "archived"] as const;
export const itemStatus = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof itemStatus>;

export const ITEM_CONDITIONS = ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] as const;
export const itemCondition = z.enum(ITEM_CONDITIONS);
export type ItemCondition = z.infer<typeof itemCondition>;

export const ITEM_CATEGORIES = [
  "women",
  "men",
  "kids",
  "shoes",
  "bags",
  "accessories",
  "home",
  "electronics",
  "other",
] as const;
export const itemCategory = z.enum(ITEM_CATEGORIES);
export type ItemCategory = z.infer<typeof itemCategory>;

export const photo = z.object({
  id: id,
  /** URL d'affichage : data URL (démo) ou URL signée (connecté). */
  url: z.string().max(4_000_000),
  alt: z.string().max(200).default(""),
  position: z.number().int().min(0).default(0),
});
export type Photo = z.infer<typeof photo>;

/**
 * Statistiques de l'annonce telles que la plateforme les affiche au vendeur
 * (vues, favoris, offres reçues). Relevées par l'extension en mode connecté,
 * simulées en démonstration. `updatedAt` null = jamais relevées.
 */
export const listingStats = z.object({
  views: z.number().int().min(0).default(0),
  favorites: z.number().int().min(0).default(0),
  offers: z.number().int().min(0).default(0),
  updatedAt: isoDate.nullable().default(null),
});
export type ListingStats = z.infer<typeof listingStats>;

export const REPUBLICATION_MODES = ["manual", "auto"] as const;

/** Une republication déjà effectuée : variante utilisée et rendement mesuré. */
export const republication = z.object({
  id,
  variantId: z.string().trim().min(1).max(20),
  at: isoDate,
  mode: z.enum(REPUBLICATION_MODES).default("manual"),
  /** Statistiques de l'annonce juste avant la republication. */
  before: z.object({ views: z.number().int().min(0), favorites: z.number().int().min(0) }).default({ views: 0, favorites: 0 }),
  /** Statistiques relevées 48 h après (null tant qu'elles ne sont pas connues). */
  after: z.object({ views: z.number().int().min(0), favorites: z.number().int().min(0) }).nullable().default(null),
});
export type Republication = z.infer<typeof republication>;

/** Attributs complémentaires d'une annonce (remplis par le générateur ou à la main). */
export const itemAttributes = z.object({
  colors: z.array(z.string().trim().min(1).max(30)).max(3).default([]),
  material: z.string().trim().max(60).nullable().default(null),
  /** Origine du texte de l'annonce : IA, gabarit de repli ou saisie manuelle. */
  generatedBy: z.enum(["ai", "fallback", "manual"]).nullable().default(null),
});
export type ItemAttributes = z.infer<typeof itemAttributes>;

export const inventoryItem = z.object({
  id,
  orgId: id,
  sku: z.string().trim().max(40).nullable().default(null),
  title: shortText,
  description: longText.default(""),
  brand: z.string().trim().max(80).nullable().default(null),
  size: z.string().trim().max(40).nullable().default(null),
  category: itemCategory.default("other"),
  condition: itemCondition.default("good"),
  photos: z.array(photo).max(12).default([]),
  purchasePriceCents: nonNegCents.default(0),
  /** Frais d'acquisition (port entrant, nettoyage, retouche…). */
  purchaseFeesCents: nonNegCents.default(0),
  listedPriceCents: nonNegCents.nullable().default(null),
  floorPriceCents: nonNegCents.nullable().default(null),
  status: itemStatus.default("in_stock"),
  connectionId: id.nullable().default(null),
  externalRef: z.string().max(120).nullable().default(null),
  externalUrl: z.string().url().max(500).nullable().default(null),
  tags,
  listingStats: listingStats.default({}),
  republications: z.array(republication).max(200).default([]),
  attributes: itemAttributes.default({}),
  purchasedAt: isoDate.nullable().default(null),
  listedAt: isoDate.nullable().default(null),
  soldAt: isoDate.nullable().default(null),
  archivedAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type InventoryItem = z.infer<typeof inventoryItem>;

/**
 * Bornes de saisie d'un article (création, modification, import) : un prix affiché de 1 € au moins (minimum de
 * Vinted) et de 100 000 € au plus, des montants d'achat sans valeur absurde, une date d'achat ni dans le futur
 * ni avant 1950. Appliquées à la SAISIE seulement : une ligne déjà en base reste lisible telle quelle.
 */
export const ITEM_MIN_LISTED_PRICE_CENTS = 100;
export const ITEM_MAX_PRICE_CENTS = 10_000_000;
export const ITEM_TITLE_MAX = 200;
/** Tolérance sur « date d'achat dans le futur » (fuseaux horaires : la journée de demain ailleurs dans le monde). */
const PURCHASE_DATE_TOLERANCE_MS = 36 * 3_600_000;
const PURCHASE_DATE_MIN = Date.UTC(1950, 0, 1);

const maxPriceMessage = "Montant trop élevé : 100 000 € au plus.";
const itemAmount = nonNegCents.refine((v) => v <= ITEM_MAX_PRICE_CENTS, maxPriceMessage);
const itemListedPrice = z.number().int().refine((v) => v >= ITEM_MIN_LISTED_PRICE_CENTS, "Le prix affiché doit être d'au moins 1 €.").refine((v) => v <= ITEM_MAX_PRICE_CENTS, maxPriceMessage);
const itemFloorPrice = nonNegCents.refine((v) => v <= ITEM_MAX_PRICE_CENTS, maxPriceMessage);
export const purchaseDate = isoDate
  .refine((s) => Date.parse(s) <= Date.now() + PURCHASE_DATE_TOLERANCE_MS, "La date d'achat ne peut pas être dans le futur.")
  .refine((s) => Date.parse(s) >= PURCHASE_DATE_MIN, "Date d'achat improbable : 1950 au plus tôt.");

/** Les champs munis d'une valeur par défaut sont optionnels à la saisie (pas de `.partial()`, qui annulerait les défauts). */
export const inventoryItemCreate = inventoryItem.omit({
  id: true, orgId: true, createdAt: true, updatedAt: true, soldAt: true, archivedAt: true, listedAt: true,
}).extend({
  title: nameText(ITEM_TITLE_MAX),
  purchasePriceCents: itemAmount.default(0),
  purchaseFeesCents: itemAmount.default(0),
  listedPriceCents: itemListedPrice.nullable().default(null),
  floorPriceCents: itemFloorPrice.nullable().default(null),
  purchasedAt: purchaseDate.nullable().default(null),
});
export type InventoryItemCreate = z.input<typeof inventoryItemCreate>;

/**
 * Modification : champs facultatifs, plus `expectedUpdatedAt` (date de mise à jour de l'article tel qu'il a été
 * ouvert) : si l'article a changé depuis (autre onglet, autre membre de l'équipe), le serveur refuse (409) au lieu
 * d'écraser en silence les modifications de l'autre.
 */
export const inventoryItemUpdate = inventoryItemCreate.partial().extend({ expectedUpdatedAt: isoDate.optional() });
export type InventoryItemUpdate = z.input<typeof inventoryItemUpdate>;

/** Le prix plancher ne dépasse jamais le prix affiché (contrôle commun au formulaire et au serveur). */
export function floorAboveListed(p: { listedPriceCents?: number | null; floorPriceCents?: number | null }): boolean {
  return p.floorPriceCents != null && p.listedPriceCents != null && p.floorPriceCents > p.listedPriceCents;
}
export const FLOOR_ABOVE_LISTED_MESSAGE = "Le plancher ne peut pas dépasser le prix affiché.";

export const inventoryEvent = z.object({
  id,
  orgId: id,
  itemId: id,
  actorUserId: id.nullable().default(null),
  kind: z.enum(["created", "updated", "status_changed", "price_changed", "imported", "archived", "restored", "captured"]),
  changes: z.record(z.object({ from: z.unknown(), to: z.unknown() })).default({}),
  note: z.string().max(500).nullable().default(null),
  createdAt: isoDate,
});
export type InventoryEvent = z.infer<typeof inventoryEvent>;

export const inventoryQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: itemStatus.optional(),
  category: itemCategory.optional(),
  brand: z.string().trim().max(80).optional(),
  sort: z.enum(["updated_desc", "created_desc", "title_asc", "price_asc", "price_desc", "margin_desc", "online_desc"]).default("updated_desc"),
  /** Articles en ligne depuis au moins N jours (tri « à republier »). */
  minDaysOnline: z.coerce.number().int().min(0).max(3650).optional(),
  /** Compte Vinted de l'annonce. */
  connectionId: z.string().trim().min(1).max(64).optional(),
  /** « none » : articles sans photo. */
  photos: z.enum(["none"]).optional(),
  /**
   * Marge projetée au prix affiché (finances : ignoré pour un rôle sans « finances.read ») : « negative »
   * (sous le coût), « low » (moins de 30 % du prix affiché), « good » (30 % ou plus).
   */
  margin: z.enum(["negative", "low", "good"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type InventoryQuery = z.infer<typeof inventoryQuery>;

export const bulkItemAction = z.object({
  ids: z.array(id).min(1).max(500),
  /**
   * « set_price » : prix affiché fixé (`listedPriceCents`) ; « adjust_price » : prix affiché multiplié par
   * 1 + `priceRate` (−50 % à +50 %, arrondi à 10 centimes, jamais sous le plancher) ; « republish » : annonces
   * en ligne republiées avec la prochaine variante conseillée.
   */
  action: z.enum(["archive", "restore", "set_status", "set_floor_margin", "add_tag", "delete", "set_price", "adjust_price", "republish"]),
  status: itemStatus.optional(),
  floorMarginCents: cents.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  listedPriceCents: nonNegCents.optional(),
  priceRate: z.number().min(-0.5).max(0.5).optional(),
});
export type BulkItemAction = z.infer<typeof bulkItemAction>;

/**
 * Prix après ajustement en lot : arrondi à 10 centimes, jamais sous le plancher ni sous 0. Null si l'article
 * n'a pas de prix affiché.
 */
export function adjustedPrice(listedPriceCents: number | null, floorPriceCents: number | null, rate: number): number | null {
  if (listedPriceCents === null) return null;
  const raw = Math.round((listedPriceCents * (1 + rate)) / 10) * 10;
  return Math.max(floorPriceCents ?? 0, raw, 0);
}

/** Compteurs en tête de « Articles et stock ». `stockValueCents` (au prix d'achat) relève des finances. */
export interface ItemSummary {
  /** Articles actifs (hors archivés). */
  active: number;
  inStock: number;
  listed: number;
  reserved: number;
  /** Vendus depuis le 1er du mois (fuseau de l'organisation non appliqué : UTC). */
  soldThisMonth: number;
  /** Valeur d'achat du stock actif non vendu (prix d'achat + frais) : null pour un rôle sans finances. */
  stockValueCents: number | null;
  /** Valeur au prix affiché des annonces en ligne (visible de tous). */
  listedValueCents: number;
  withoutPhoto: number;
  /** Annonces en ligne depuis au moins `republishAfterDays` jours. */
  toRepublish: number;
  republishAfterDays: number;
}
