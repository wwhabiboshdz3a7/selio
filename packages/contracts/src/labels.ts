import type { ConnectorStatus, Capability } from "./connections";
import type { ItemCategory, ItemCondition, ItemStatus } from "./inventory";
import type { MessageStatus } from "./messaging";
import type { OrderStatus } from "./orders";
import type { JobStatus, RuleKind } from "./automation";
import type { Plan } from "./org";
import type { Role } from "./common";

/** Libellés français partagés (web, extension, exports). */
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  in_stock: "En stock",
  listed: "En vente",
  reserved: "Réservé",
  sold: "Vendu",
  archived: "Archivé",
};

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  new_with_tags: "Neuf avec étiquette",
  new_without_tags: "Neuf sans étiquette",
  very_good: "Très bon état",
  good: "Bon état",
  satisfactory: "Satisfaisant",
};

export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  women: "Femmes",
  men: "Hommes",
  kids: "Enfants",
  shoes: "Chaussures",
  bags: "Sacs",
  accessories: "Accessoires",
  home: "Maison",
  electronics: "Électronique",
  other: "Autre",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "En attente",
  paid: "Payée",
  shipped: "Expédiée",
  delivered: "Livrée",
  completed: "Terminée",
  cancelled: "Annulée",
  refunded: "Remboursée",
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  received: "Reçu",
  draft: "Brouillon",
  pending: "En attente",
  sent: "Envoyé",
  failed: "Échec",
};

export const CONNECTOR_STATUS_LABELS: Record<ConnectorStatus, string> = {
  not_configured: "Non configuré",
  ready: "Prêt",
  connected: "Connecté",
  degraded: "Dégradé",
  expired: "Expiré",
  disconnected: "Déconnecté",
  unsupported: "Non pris en charge",
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  read_items: "Lire les articles",
  read_conversations: "Lire les conversations",
  sync_orders: "Synchroniser les commandes",
  prepare_message: "Préparer un message",
  send_message: "Envoyer un message",
  shipping_document: "Document d'expédition",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "En file",
  running: "En cours",
  succeeded: "Réussi",
  failed: "Échec",
  cancelled: "Annulé",
  skipped: "Ignoré",
  awaiting_approval: "À valider",
};

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  reply_on_new_message: "Réponse à un nouveau message",
  follow_up_no_reply: "Relance sans réponse",
  auto_negotiate: "Négociation automatique",
  post_sale_message: "Message après-vente",
  relist_stale: "Remise en avant d'un article dormant",
  price_drop_stale: "Baisse de prix d'un article dormant",
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  operator: "Opérateur",
  viewer: "Lecture seule",
};

export const PLAN_LABELS: Record<Plan, string> = { free: "Découverte", starter: "Essentiel", pro: "Pro" };
