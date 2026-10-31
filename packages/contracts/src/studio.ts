import { z } from "zod";
import { id, nonNegCents } from "./common";
import { itemCategory, itemCondition } from "./inventory";

/**
 * Générateur d'annonces : l'utilisateur ajoute ses photos, l'IA rédige
 * l'annonce (titre, description, attributs). Le prix n'est jamais inventé
 * par le modèle : il est proposé à partir des ventes comparables.
 */

/** Photo envoyée au générateur : data URL compressée côté navigateur. */
export const generatorPhoto = z.object({
  id,
  url: z.string().max(3_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo JPEG, PNG ou WebP attendue"),
  alt: z.string().max(200).default(""),
});
export type GeneratorPhoto = z.infer<typeof generatorPhoto>;

export const listingGenerationInput = z.object({
  photos: z.array(generatorPhoto).min(1, "Ajoutez au moins une photo").max(12),
  /** Compte de vente visé (connexion Vinted) : plusieurs comptes peuvent être gérés. */
  connectionId: id.nullable().default(null),
  hints: z
    .object({
      brand: z.string().trim().max(80).optional(),
      size: z.string().trim().max(40).optional(),
      notes: z.string().trim().max(500).optional(),
      purchasePriceCents: nonNegCents.optional(),
    })
    .default({}),
});
export type ListingGenerationInput = z.input<typeof listingGenerationInput>;

/** Sortie structurée demandée au modèle (aucun prix). */
export const listingGenerationOutput = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(20).max(2000),
  brand: z.string().trim().max(80).nullable().default(null),
  category: itemCategory,
  size: z.string().trim().max(40).nullable().default(null),
  condition: itemCondition,
  colors: z.array(z.string().trim().min(1).max(30)).max(3).default([]),
  material: z.string().trim().max(60).nullable().default(null),
  hashtags: z.array(z.string().trim().max(30)).max(8).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type ListingGenerationOutput = z.infer<typeof listingGenerationOutput>;

export interface ListingDraft extends ListingGenerationOutput {
  /** Prix conseillé (médiane des ventes comparables, ajustée à l'état). */
  suggestedPriceCents: number;
  priceLowCents: number;
  priceHighCents: number;
  priceMethod: string;
  comparableCount: number;
  /** Origine du texte : modèle IA ou gabarit déterministe (IA indisponible / démonstration). */
  source: "ai" | "fallback";
  provider: string;
  model: string;
  latencyMs: number;
  /** Vrai en démonstration : le simulateur ne voit pas réellement les photos. */
  simulated: boolean;
  warnings: string[];
}

/** Annonce observée sur le marché (radar, extension ou simulateur) : base de l'analyse des revendeurs. */
export const marketObservation = z.object({
  id,
  sellerHandle: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(80).nullable().default(null),
  category: itemCategory.default("other"),
  priceCents: nonNegCents,
  status: z.enum(["listed", "sold"]),
  seenAt: z.string(),
  soldAt: z.string().nullable().default(null),
  favorites: z.number().int().min(0).default(0),
  source: z.enum(["demo_simulator", "extension_capture", "radar"]),
});
export type MarketObservation = z.infer<typeof marketObservation>;
