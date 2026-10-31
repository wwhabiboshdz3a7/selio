import { z } from "zod";
import { cents, id, isoDate, longText, nonNegCents, shortText, tags } from "./common";

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

/** Les champs munis d'une valeur par défaut sont optionnels à la saisie (pas de `.partial()`, qui annulerait les défauts). */
export const inventoryItemCreate = inventoryItem.omit({
  id: true, orgId: true, createdAt: true, updatedAt: true, soldAt: true, archivedAt: true, listedAt: true,
});
export type InventoryItemCreate = z.input<typeof inventoryItemCreate>;

export const inventoryItemUpdate = inventoryItemCreate.partial();
export type InventoryItemUpdate = z.input<typeof inventoryItemUpdate>;

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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type InventoryQuery = z.infer<typeof inventoryQuery>;

export const bulkItemAction = z.object({
  ids: z.array(id).min(1).max(500),
  action: z.enum(["archive", "restore", "set_status", "set_floor_margin", "add_tag", "delete"]),
  status: itemStatus.optional(),
  floorMarginCents: cents.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
});
export type BulkItemAction = z.infer<typeof bulkItemAction>;
