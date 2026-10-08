import { z } from "zod";
import { id, isoDate, longText, provider, shortText, tags } from "./common";

export const customer = z.object({
  id,
  orgId: id,
  displayName: shortText,
  handle: z.string().trim().max(80).nullable().default(null),
  provider: provider.default("demo"),
  externalRef: z.string().max(120).nullable().default(null),
  notes: longText.default(""),
  tags,
  /** Données minimisées : pas d'email ni d'adresse sans besoin métier. */
  city: z.string().trim().max(80).nullable().default(null),
  firstContactAt: isoDate.nullable().default(null),
  lastContactAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Customer = z.infer<typeof customer>;

export const customerCreate = customer.omit({ id: true, orgId: true, createdAt: true, updatedAt: true });
export type CustomerCreate = z.input<typeof customerCreate>;
export const customerUpdate = customerCreate.partial();
export type CustomerUpdate = z.input<typeof customerUpdate>;

export const customerQuery = z.object({
  q: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(["last_contact_desc", "name_asc", "orders_desc"]).default("last_contact_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type CustomerQuery = z.infer<typeof customerQuery>;
