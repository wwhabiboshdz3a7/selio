import { z } from "zod";

export const id = z.string().min(1).max(64);
export const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/));
export const cents = z.number().int().min(-1_000_000_000).max(1_000_000_000);
export const nonNegCents = z.number().int().min(0).max(1_000_000_000);
export const rate = z.number().min(0).max(1);
export const shortText = z.string().trim().min(1).max(200);
export const longText = z.string().trim().max(8000);
export const tags = z.array(z.string().trim().min(1).max(40)).max(30).default([]);
export const email = z.string().trim().toLowerCase().email().max(255);
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lettres minuscules, chiffres et tirets");

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export const MODES = ["demo", "connected"] as const;
export type Mode = (typeof MODES)[number];

export const ROLES = ["owner", "admin", "operator", "viewer"] as const;
export const role = z.enum(ROLES);
export type Role = z.infer<typeof role>;

export const PROVIDERS = ["vinted", "demo"] as const;
export const provider = z.enum(PROVIDERS);
export type Provider = z.infer<typeof provider>;

export const CURRENCIES = ["EUR"] as const;
export const currency = z.enum(CURRENCIES);
