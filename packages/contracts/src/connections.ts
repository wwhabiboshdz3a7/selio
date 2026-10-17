import { z } from "zod";
import { id, isoDate, provider } from "./common";

export const CONNECTOR_STATUSES = [
  "not_configured",
  "ready",
  "connected",
  "degraded",
  "expired",
  "disconnected",
  "unsupported",
] as const;
export const connectorStatus = z.enum(CONNECTOR_STATUSES);
export type ConnectorStatus = z.infer<typeof connectorStatus>;

export const CAPABILITIES = [
  "read_items",
  "read_conversations",
  "sync_orders",
  "prepare_message",
  "send_message",
  "shipping_document",
] as const;
export const capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof capability>;

export const capabilityState = z.object({
  capability,
  /** available = testée ; experimental = construite mais non vérifiée en réel ; unavailable = impossible. */
  state: z.enum(["available", "experimental", "unavailable"]),
  note: z.string().max(300).default(""),
});

/**
 * Catégorie d'un compte connecté (plusieurs comptes Vinted par organisation) :
 * sale = annonces publiées et négociées par Selio ; purchase = compte qui achète
 * les bonnes affaires ; personal = compte personnel, jamais utilisé par les
 * automatisations ni par l'achat automatique.
 */
export const CONNECTION_USAGES = ["sale", "purchase", "personal"] as const;
export const connectionUsage = z.enum(CONNECTION_USAGES);
export type ConnectionUsage = z.infer<typeof connectionUsage>;

/** Pseudo Vinted affiché (jamais un identifiant de connexion) : sans espace, « @ » initial retiré. */
export const displayHandle = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ""))
  .pipe(z.string().max(60).regex(/^[^\s<>"'`]*$/, "Pseudo sans espace ni caractère spécial"));

export const marketplaceConnection = z.object({
  id,
  orgId: id,
  provider,
  label: z.string().trim().min(1).max(80),
  usage: connectionUsage.default("sale"),
  status: connectorStatus.default("not_configured"),
  capabilities: z.array(capabilityState).default([]),
  /** Configuration non secrète (identifiant d'affichage, options). Les secrets vont au coffre serveur. */
  config: z.record(z.unknown()).default({}),
  hasSecret: z.boolean().default(false),
  lastSyncAt: isoDate.nullable().default(null),
  lastTestAt: isoDate.nullable().default(null),
  lastError: z.string().max(500).nullable().default(null),
  /** Transport : extension navigateur (session de l'utilisateur) ou serveur. */
  transport: z.enum(["extension", "server", "simulator"]).default("extension"),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type MarketplaceConnection = z.infer<typeof marketplaceConnection>;

export const connectionCreate = z.object({
  provider,
  label: z.string().trim().min(1).max(80),
  /** Vente par défaut. */
  usage: connectionUsage.optional(),
  config: z.object({ displayHandle: displayHandle.optional() }).passthrough().optional(),
  secret: z.string().max(4000).optional(),
});
export type ConnectionCreate = z.infer<typeof connectionCreate>;

/** Modification d'un compte : nom interne, catégorie, pseudo Vinted affiché. */
export const connectionUpdate = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    usage: connectionUsage.optional(),
    displayHandle: displayHandle.optional(),
  })
  .strict()
  .refine((v) => v.label !== undefined || v.usage !== undefined || v.displayHandle !== undefined, "Aucune modification");
export type ConnectionUpdate = z.input<typeof connectionUpdate>;

export const connectionTestResult = z.object({
  ok: z.boolean(),
  status: connectorStatus,
  message: z.string().max(500),
  capabilities: z.array(capabilityState),
  testedAt: isoDate,
  simulated: z.boolean().default(false),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResult>;

export const extensionToken = z.object({
  id,
  orgId: id,
  userId: id,
  label: z.string().trim().min(1).max(80),
  /** Préfixe public du jeton (jamais le secret). */
  prefix: z.string().min(4).max(12),
  scopes: z.array(z.enum(["capture:items", "read:rules", "draft:messages", "sync:conversations"])).default([]),
  expiresAt: isoDate,
  lastUsedAt: isoDate.nullable().default(null),
  revokedAt: isoDate.nullable().default(null),
  createdAt: isoDate,
});
export type ExtensionToken = z.infer<typeof extensionToken>;

/** Jeton émis une seule fois à la création (secret affiché une fois). */
export const extensionTokenIssued = z.object({
  token: extensionToken,
  secret: z.string().min(20),
});
