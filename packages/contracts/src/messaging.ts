import { z } from "zod";
import { cents, id, isoDate, provider } from "./common";

export const CONVERSATION_STATUSES = ["open", "archived"] as const;
export const conversationStatus = z.enum(CONVERSATION_STATUSES);

export const conversation = z.object({
  id,
  orgId: id,
  customerId: id,
  itemId: id.nullable().default(null),
  connectionId: id.nullable().default(null),
  provider: provider.default("demo"),
  externalRef: z.string().max(120).nullable().default(null),
  status: conversationStatus.default("open"),
  unreadCount: z.number().int().min(0).default(0),
  /** Nombre de contre-propositions déjà envoyées à cet acheteur. */
  negotiationRounds: z.number().int().min(0).default(0),
  lastMessageAt: isoDate.nullable().default(null),
  lastMessagePreview: z.string().max(200).default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Conversation = z.infer<typeof conversation>;

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const MESSAGE_STATUSES = ["received", "draft", "pending", "sent", "failed"] as const;
export const messageStatus = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof messageStatus>;
export const MESSAGE_SOURCES = ["buyer", "user", "ai", "automation", "system"] as const;

export const message = z.object({
  id,
  orgId: id,
  conversationId: id,
  direction: z.enum(MESSAGE_DIRECTIONS),
  source: z.enum(MESSAGE_SOURCES),
  status: messageStatus,
  body: z.string().max(4000),
  /** Offre de prix détectée ou proposée (centimes). */
  offerCents: cents.nullable().default(null),
  aiRequestId: id.nullable().default(null),
  ruleId: id.nullable().default(null),
  externalRef: z.string().max(120).nullable().default(null),
  error: z.string().max(500).nullable().default(null),
  /** Marqueur explicite : envoi simulé (mode démo). */
  simulated: z.boolean().default(false),
  createdAt: isoDate,
  sentAt: isoDate.nullable().default(null),
  readAt: isoDate.nullable().default(null),
});
export type Message = z.infer<typeof message>;

export const draftCreate = z.object({
  conversationId: id,
  body: z.string().trim().min(1).max(4000),
  offerCents: cents.nullable().optional(),
  source: z.enum(["user", "ai"]).default("user"),
  aiRequestId: id.nullable().optional(),
});
export type DraftCreate = z.infer<typeof draftCreate>;

export const conversationQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: conversationStatus.optional(),
  unread: z.coerce.boolean().optional(),
  itemId: id.optional(),
  customerId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type ConversationQuery = z.infer<typeof conversationQuery>;
