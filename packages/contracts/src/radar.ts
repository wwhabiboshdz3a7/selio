import { z } from "zod";
import { id, isoDate, nonNegCents, rate } from "./common";
import { itemCategory, itemCondition } from "./inventory";

export const radarCriteria = z.object({
  brands: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  categories: z.array(itemCategory).max(10).default([]),
  sizes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  conditions: z.array(itemCondition).max(5).default([]),
  maxPriceCents: nonNegCents.default(5000),
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});

export const radarSearch = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(120),
  criteria: radarCriteria.default({}),
  budgetCents: nonNegCents.default(20000),
  targetMarginRate: rate.default(0.4),
  targetMarginCents: nonNegCents.default(1000),
  enabled: z.boolean().default(true),
  provider: z.enum(["demo", "vinted"]).default("demo"),
  lastRunAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RadarSearch = z.infer<typeof radarSearch>;

export const radarSearchCreate = radarSearch.omit({ id: true, orgId: true, createdAt: true, updatedAt: true, lastRunAt: true });
export type RadarSearchCreate = z.input<typeof radarSearchCreate>;
export const radarSearchUpdate = radarSearchCreate.partial();

export const OPPORTUNITY_STATUSES = ["new", "watching", "purchased", "dismissed"] as const;
export const opportunityStatus = z.enum(OPPORTUNITY_STATUSES);

/** Séparation stricte : ce qui a été observé vs ce qui est estimé. */
export const opportunity = z.object({
  id,
  orgId: id,
  searchId: id,
  title: z.string().trim().min(1).max(200),
  observed: z.object({
    priceCents: nonNegCents,
    shippingCents: nonNegCents.default(0),
    brand: z.string().max(80).nullable().default(null),
    size: z.string().max(40).nullable().default(null),
    condition: itemCondition.nullable().default(null),
    category: itemCategory.nullable().default(null),
    sellerHandle: z.string().max(80).nullable().default(null),
    url: z.string().max(500).nullable().default(null),
    seenAt: isoDate,
    source: z.enum(["demo_simulator", "extension_capture", "connector"]),
  }),
  estimate: z.object({
    resalePriceCents: nonNegCents,
    expectedFeesCents: nonNegCents.default(0),
    marginCents: z.number().int(),
    marginRate: z.number(),
    confidence: z.enum(["low", "medium", "high"]),
    method: z.string().max(200),
    comparableCount: z.number().int().min(0).default(0),
  }),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().max(200)).default([]),
  status: opportunityStatus.default("new"),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Opportunity = z.infer<typeof opportunity>;

export const PURCHASE_STATUSES = ["draft", "awaiting_confirmation", "simulated", "blocked", "executed", "cancelled"] as const;
export const purchaseStatus = z.enum(PURCHASE_STATUSES);

export const purchaseRequest = z.object({
  id,
  orgId: id,
  opportunityId: id,
  dedupeKey: z.string().min(1).max(200),
  maxPriceCents: nonNegCents,
  budgetCents: nonNegCents,
  status: purchaseStatus.default("draft"),
  checks: z
    .array(z.object({ code: z.string().max(60), ok: z.boolean(), label: z.string().max(200) }))
    .default([]),
  /** Achat réel : désactivé par défaut, exige connecteur autorisé + confirmation explicite. */
  realPurchaseEnabled: z.boolean().default(false),
  confirmedAt: isoDate.nullable().default(null),
  executedAt: isoDate.nullable().default(null),
  resultNote: z.string().max(500).nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type PurchaseRequest = z.infer<typeof purchaseRequest>;
