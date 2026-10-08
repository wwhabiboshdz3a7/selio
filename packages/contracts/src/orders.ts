import { z } from "zod";
import { id, isoDate, nonNegCents, provider } from "./common";

export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "completed", "cancelled", "refunded"] as const;
export const orderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatus>;

export const order = z.object({
  id,
  orgId: id,
  itemId: id,
  customerId: id,
  conversationId: id.nullable().default(null),
  connectionId: id.nullable().default(null),
  provider: provider.default("demo"),
  externalRef: z.string().max(120).nullable().default(null),
  /** Clé d'idempotence : `${provider}:${externalRef}` ou `${itemId}:${customerId}:${date}`. */
  dedupeKey: z.string().min(1).max(200),
  status: orderStatus.default("pending"),
  salePriceCents: nonNegCents,
  /** Frais prélevés au vendeur par la plateforme (0 sur Vinted pour le vendeur, configurable). */
  platformFeeCents: nonNegCents.default(0),
  /** Frais d'expédition à la charge du vendeur (0 si payés par l'acheteur). */
  shippingCostCents: nonNegCents.default(0),
  otherCostsCents: nonNegCents.default(0),
  /** Copie figée du coût d'acquisition au moment de la vente. */
  purchasePriceCents: nonNegCents.default(0),
  purchaseFeesCents: nonNegCents.default(0),
  statusHistory: z
    .array(z.object({ status: orderStatus, at: isoDate, note: z.string().max(300).nullable().default(null) }))
    .default([]),
  simulated: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Order = z.infer<typeof order>;

export const orderCreate = z.object({
  itemId: id,
  customerId: id,
  conversationId: id.nullable().optional(),
  salePriceCents: nonNegCents,
  platformFeeCents: nonNegCents.optional(),
  shippingCostCents: nonNegCents.optional(),
  otherCostsCents: nonNegCents.optional(),
  externalRef: z.string().max(120).nullable().optional(),
  status: orderStatus.optional(),
});
export type OrderCreate = z.infer<typeof orderCreate>;

export const orderUpdate = z.object({
  salePriceCents: nonNegCents.optional(),
  platformFeeCents: nonNegCents.optional(),
  shippingCostCents: nonNegCents.optional(),
  otherCostsCents: nonNegCents.optional(),
});

export const orderTransition = z.object({ status: orderStatus, note: z.string().max(300).optional() });

export const SHIPMENT_STATUSES = ["pending", "label_ready", "in_transit", "delivered", "issue"] as const;
export const shipmentStatus = z.enum(SHIPMENT_STATUSES);

export const shipment = z.object({
  id,
  orgId: id,
  orderId: id,
  carrier: z.string().max(60).nullable().default(null),
  trackingNumber: z.string().max(80).nullable().default(null),
  status: shipmentStatus.default("pending"),
  /** Document d'expédition : jamais un faux bordereau présenté comme réel. */
  document: z
    .object({
      kind: z.enum(["demo", "connector"]),
      url: z.string().max(2000).nullable().default(null),
      note: z.string().max(300).default(""),
    })
    .nullable()
    .default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Shipment = z.infer<typeof shipment>;

export const orderQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: orderStatus.optional(),
  customerId: id.optional(),
  itemId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type OrderQuery = z.infer<typeof orderQuery>;
