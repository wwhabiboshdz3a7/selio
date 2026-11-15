import { z } from "zod";
import { id, isoDate, nonNegCents } from "./common";

/**
 * Journal d'activité de Selio Manager : ce que Selio, Studio, Selio Bot et l'équipe ont fait, en phrases
 * simples (« Selio a fait une contre-offre à Léa : 35,00 € »). Il n'a pas de table à lui : il est lu dans
 * les traces qui existent déjà (historique des articles, préparations Studio, messages envoyés, tâches des
 * automatisations, commandes et bordereaux, achats, journal d'audit). Les actions qui n'ont pas de trace
 * propre (Selio Bot, plus tard d'autres modules) s'y ajoutent par `recordActivity` (@selio/core), rangées
 * dans le journal d'audit sous l'action « activity.<verbe> ».
 */

/** Familles d'actions (filtre « type » du journal). */
export const ACTIVITY_CATEGORIES = ["stock", "studio", "photos", "pricing", "messages", "negotiation", "orders", "purchases", "automation", "bot"] as const;
export const activityCategory = z.enum(ACTIVITY_CATEGORIES);
export type ActivityCategory = z.infer<typeof activityCategory>;

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  stock: "Stock",
  studio: "Studio",
  photos: "Photos",
  pricing: "Prix",
  messages: "Messages",
  negotiation: "Négociation",
  orders: "Commandes",
  purchases: "Achats",
  automation: "Automatisations",
  bot: "Selio Bot",
};

/** Qui a agi : un membre de l'équipe, Selio (automatisations, synchronisation), Studio ou Selio Bot. */
export const ACTIVITY_ACTOR_KINDS = ["member", "selio", "studio", "bot"] as const;
export const activityActorKind = z.enum(ACTIVITY_ACTOR_KINDS);
export type ActivityActorKind = z.infer<typeof activityActorKind>;

/** Nom affiché d'un acteur qui n'est pas un membre. */
export const ACTIVITY_ACTOR_NAMES: Record<Exclude<ActivityActorKind, "member">, string> = {
  selio: "Selio",
  studio: "Studio",
  bot: "Selio Bot",
};

/** Verbes connus du journal. Chaque verbe appartient à une famille (`ACTIVITY_VERB_CATEGORY`). */
export const ACTIVITY_VERBS = [
  "item.created", "item.imported", "item.captured", "item.studio_draft", "item.radar_bought", "item.status_changed", "item.price_changed",
  "item.updated", "item.photos_added", "item.republished", "item.deleted", "item.bulk",
  "studio.prepared", "studio.listing_written",
  "message.sent",
  "negotiation.accepted", "negotiation.countered", "negotiation.refused",
  "followup.sent",
  "automation.reply_sent", "automation.handoff", "automation.action", "automation.rule_run", "automation.approved", "automation.paused", "automation.resumed",
  "order.created", "order.shipped", "order.delivered", "shipment.label_ready",
  "purchase.validated", "purchase.done",
  // Selio Bot (achat auto, offres et messages envoyés par le bot) : écrits par `recordActivity`.
  "bot.message_sent", "bot.offer_sent", "bot.offer_answered", "bot.purchase", "bot.favorite", "bot.action",
] as const;
export const activityVerb = z.enum(ACTIVITY_VERBS);
export type ActivityVerb = z.infer<typeof activityVerb>;

export const ACTIVITY_VERB_CATEGORY: Record<ActivityVerb, ActivityCategory> = {
  "item.created": "stock", "item.imported": "stock", "item.captured": "stock", "item.studio_draft": "studio", "item.radar_bought": "purchases",
  "item.status_changed": "stock", "item.price_changed": "pricing", "item.updated": "stock", "item.photos_added": "photos", "item.republished": "stock",
  "item.deleted": "stock", "item.bulk": "stock",
  "studio.prepared": "studio", "studio.listing_written": "studio",
  "message.sent": "messages",
  "negotiation.accepted": "negotiation", "negotiation.countered": "negotiation", "negotiation.refused": "negotiation",
  "followup.sent": "messages",
  "automation.reply_sent": "automation", "automation.handoff": "automation", "automation.action": "automation", "automation.rule_run": "automation",
  "automation.approved": "automation", "automation.paused": "automation", "automation.resumed": "automation",
  "order.created": "orders", "order.shipped": "orders", "order.delivered": "orders", "shipment.label_ready": "orders",
  "purchase.validated": "purchases", "purchase.done": "purchases",
  "bot.message_sent": "bot", "bot.offer_sent": "bot", "bot.offer_answered": "bot", "bot.purchase": "bot", "bot.favorite": "bot", "bot.action": "bot",
};

/** Verbes d'une famille (filtre côté base). */
export function activityVerbsOf(category: ActivityCategory): ActivityVerb[] {
  return ACTIVITY_VERBS.filter((v) => ACTIVITY_VERB_CATEGORY[v] === category);
}

/** État d'une action : faite, proposée (à valider) ou en échec. */
export const ACTIVITY_STATUSES = ["done", "pending", "failed"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_TARGET_TYPES = ["item", "conversation", "order", "rule", "purchase", "studio_prep", "job"] as const;
export type ActivityTargetType = (typeof ACTIVITY_TARGET_TYPES)[number];

/**
 * Ligne brute du journal, normalisée depuis une source (base ou démonstration). `data` porte les détails propres
 * au verbe (changements, nombre de photos, nom de l'automatisation…), jamais un message complet d'acheteur.
 */
export interface ActivityRow {
  id: string;
  at: string;
  verb: ActivityVerb;
  actorKind: ActivityActorKind;
  actorUserId: string | null;
  targetType: ActivityTargetType | null;
  targetId: string | null;
  itemId: string | null;
  itemTitle: string | null;
  /** Prénom ou pseudo de l'acheteur, tel que la messagerie l'affiche. */
  counterpart: string | null;
  /** Prix côté vente (prix affiché, offre, contre-offre, prix de vente) : visible de tous les rôles. */
  priceCents: number | null;
  /** Prix d'achat (finances) : masqué pour un rôle sans « finances.read ». */
  purchaseCents: number | null;
  status: ActivityStatus;
  data: Record<string, unknown>;
}

/** Ligne du journal telle que l'écran la reçoit. */
export interface ActivityEntry {
  id: string;
  at: string;
  category: ActivityCategory;
  verb: ActivityVerb;
  actor: { kind: ActivityActorKind; userId: string | null; name: string };
  /** Vrai si l'action a été faite sans clic d'un membre (Selio, Studio, Selio Bot). */
  automatic: boolean;
  status: ActivityStatus;
  /** Phrase sans le sujet : « a fait une contre-offre à Léa : 35,00 € ». */
  summary: string;
  /** Lien vers l'objet (article, conversation, commande…), ou null. */
  link: string | null;
  itemId: string | null;
  itemTitle: string | null;
  counterpart: string | null;
  priceCents: number | null;
  purchaseCents: number | null;
}

export const ACTIVITY_PAGE_MAX = 100;

export const activityQuery = z.object({
  category: activityCategory.optional(),
  /** Qui : « selio », « studio », « bot », « members » (tous les membres) ou l'identifiant d'un membre. */
  actor: z.string().trim().min(1).max(64).optional(),
  /** Automatique (Selio, Studio, Selio Bot) ou manuel (un membre). */
  mode: z.enum(["auto", "manual"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Curseur de la page suivante (`nextCursor` de la page précédente). */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).default(30),
});
export type ActivityQuery = z.input<typeof activityQuery>;

export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

/** Curseur : date et identifiant de la dernière ligne lue. */
export function activityCursor(row: { at: string; id: string }): string {
  return `${row.at}~${row.id}`;
}
export function parseActivityCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.lastIndexOf("~");
  if (i <= 0) return null;
  const at = cursor.slice(0, i);
  const rowId = cursor.slice(i + 1);
  if (!rowId || Number.isNaN(Date.parse(at))) return null;
  return { at, id: rowId };
}

/**
 * Action enregistrée par un module qui n'a pas de trace propre (Selio Bot) : voir `recordActivity` dans
 * @selio/core. `summary` est la phrase affichée sans le sujet ; elle ne doit contenir ni prix d'achat ni marge
 * (passer le prix d'achat dans `purchaseCents`, masqué pour l'exécuteur) ni message complet d'acheteur.
 */
export const activityRecordInput = z.object({
  verb: activityVerb,
  actor: activityActorKind.default("bot"),
  actorUserId: id.nullable().default(null),
  summary: z.string().trim().min(3).max(200).optional(),
  status: z.enum(ACTIVITY_STATUSES).default("done"),
  targetType: z.enum(ACTIVITY_TARGET_TYPES).nullable().default(null),
  targetId: id.nullable().default(null),
  itemId: id.nullable().default(null),
  itemTitle: z.string().trim().max(200).nullable().default(null),
  counterpart: z.string().trim().max(60).nullable().default(null),
  priceCents: nonNegCents.nullable().default(null),
  purchaseCents: nonNegCents.nullable().default(null),
});
export type ActivityRecordInput = z.input<typeof activityRecordInput>;

// ---------------------------------------------------------------- raccourcis personnalisés

/**
 * Raccourcis de Selio Manager : pages et actions que l'utilisateur garde sous la main (vue d'ensemble et dock
 * mobile). Rangés par utilisateur côté serveur (users.preferences), pour les retrouver sur chaque appareil.
 */
export const SHORTCUT_IDS = [
  "items", "new_item", "import_items", "studio", "messages", "orders_to_ship", "radar", "track",
  "dressing", "purchase", "customers", "analytics", "automations", "journal", "bundles", "accounts",
] as const;
export const shortcutId = z.enum(SHORTCUT_IDS);
export type ShortcutId = z.infer<typeof shortcutId>;

/** Raccourcis par défaut : les trois premiers (hors Studio) forment le dock mobile, autour de « Générer ». */
export const DEFAULT_SHORTCUTS: readonly ShortcutId[] = ["items", "messages", "radar", "new_item", "import_items", "studio", "orders_to_ship", "track"];
export const MAX_SHORTCUTS = 12;

export const userPreferences = z.object({
  /** null : raccourcis par défaut. */
  shortcuts: z.array(shortcutId).max(MAX_SHORTCUTS).refine((l) => new Set(l).size === l.length, "Raccourci en double").nullable().default(null),
});
export type UserPreferences = z.infer<typeof userPreferences>;
export const userPreferencesUpdate = userPreferences.partial();
export type UserPreferencesUpdate = z.input<typeof userPreferencesUpdate>;
