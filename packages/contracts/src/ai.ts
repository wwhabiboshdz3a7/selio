import { z } from "zod";
import { cents, id, isoDate } from "./common";

export const AI_REQUEST_KINDS = ["reply_suggestion", "negotiation", "listing_description", "summary", "health"] as const;
export const aiRequestKind = z.enum(AI_REQUEST_KINDS);
export type AiRequestKind = z.infer<typeof aiRequestKind>;

export const AI_REQUEST_STATUSES = ["queued", "running", "succeeded", "failed", "rejected", "timeout", "cancelled"] as const;

export const aiRequest = z.object({
  id,
  orgId: id,
  kind: aiRequestKind,
  provider: z.string().max(40),
  model: z.string().max(80),
  status: z.enum(AI_REQUEST_STATUSES),
  conversationId: id.nullable().default(null),
  itemId: id.nullable().default(null),
  promptTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  latencyMs: z.number().int().min(0).default(0),
  /** La sortie a été validée par schéma + politique métier. */
  validated: z.boolean().default(false),
  rejectionReason: z.string().max(300).nullable().default(null),
  error: z.string().max(500).nullable().default(null),
  createdAt: isoDate,
  finishedAt: isoDate.nullable().default(null),
});
export type AiRequest = z.infer<typeof aiRequest>;

/** Sortie structurée attendue d'une suggestion de réponse. */
export const replySuggestion = z.object({
  reply: z.string().min(1).max(1200),
  intent: z.enum(["answer", "accept_offer", "counter_offer", "decline_offer", "ask_question", "escalate"]),
  proposedPriceCents: cents.nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().max(300).default(""),
});
export type ReplySuggestion = z.infer<typeof replySuggestion>;

export const listingDescriptionOutput = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  hashtags: z.array(z.string().max(30)).max(8).default([]),
});

export const AI_STATUS = ["unconfigured", "healthy", "degraded", "unavailable", "circuit_open", "mock"] as const;
export const aiStatus = z.object({
  provider: z.string(),
  model: z.string(),
  status: z.enum(AI_STATUS),
  message: z.string().default(""),
  latencyMs: z.number().int().nullable().default(null),
  checkedAt: isoDate,
  queue: z.object({ pending: z.number().int(), running: z.number().int(), concurrency: z.number().int() }),
  circuit: z.object({ state: z.enum(["closed", "open", "half_open"]), failures: z.number().int(), openedAt: isoDate.nullable() }),
});
export type AiStatus = z.infer<typeof aiStatus>;
