import { z } from "zod";

export const CATEGORIES = [
  "femmes",
  "hommes",
  "enfants",
  "chaussures",
  "sacs",
  "accessoires",
  "maison",
  "autre",
] as const;

export const CONDITIONS = [
  "neuf_avec_etiquette",
  "neuf_sans_etiquette",
  "tres_bon_etat",
  "bon_etat",
  "satisfaisant",
] as const;

export const SORTS = ["pertinence", "recent", "prix_asc", "prix_desc"] as const;

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/, "Lettres minuscules, chiffres et underscore uniquement"),
  displayName: z.string().trim().min(1).max(60),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
});

export const listingCreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4000),
  priceCents: z.number().int().min(0).max(100_000_000),
  category: z.enum(CATEGORIES),
  size: z.string().trim().max(40).optional().nullable(),
  condition: z.enum(CONDITIONS),
  imageKeys: z.array(z.string().min(1)).min(1).max(8),
});

export const listingUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(4000).optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  category: z.enum(CATEGORIES).optional(),
  size: z.string().trim().max(40).optional().nullable(),
  condition: z.enum(CONDITIONS).optional(),
  status: z.enum(["active", "sold", "archived"]).optional(),
});

export const favoriteToggleSchema = z.object({
  listingId: z.string().min(1),
});

export const conversationStartSchema = z.object({
  listingId: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
});

export const messageSendSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
