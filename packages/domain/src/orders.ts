import type { Order, OrderStatus } from "@selio/contracts";
import { computeMargin, type MarginBreakdown } from "./pricing";

/** Transitions autorisées du cycle de vie d'une commande. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["completed", "refunded"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export class OrderTransitionError extends Error {
  constructor(public readonly from: OrderStatus, public readonly to: OrderStatus) {
    super(`Transition de commande interdite : ${from} → ${to}`);
    this.name = "OrderTransitionError";
  }
}

export function transitionOrder(order: Order, to: OrderStatus, at: string, note: string | null = null): Order {
  if (!canTransition(order.status, to)) throw new OrderTransitionError(order.status, to);
  return {
    ...order,
    status: to,
    updatedAt: at,
    statusHistory: [...order.statusHistory, { status: to, at, note }],
  };
}

/** Les commandes qui comptent dans le CA et la marge. */
export const REVENUE_STATUSES: readonly OrderStatus[] = ["paid", "shipped", "delivered", "completed"];

export function countsAsRevenue(status: OrderStatus): boolean {
  return REVENUE_STATUSES.includes(status);
}

export function orderMargin(order: Pick<Order, "salePriceCents" | "platformFeeCents" | "shippingCostCents" | "otherCostsCents" | "purchasePriceCents" | "purchaseFeesCents">): MarginBreakdown {
  return computeMargin(order);
}

/** Clé d'idempotence : une référence externe prime ; sinon article + client + jour. */
export function orderDedupeKey(input: { provider: string; externalRef?: string | null; itemId: string; customerId: string; day: string }): string {
  if (input.externalRef) return `${input.provider}:${input.externalRef}`;
  return `${input.provider}:${input.itemId}:${input.customerId}:${input.day}`;
}

/** Statut d'article résultant d'un statut de commande. */
export function itemStatusForOrder(status: OrderStatus): "reserved" | "sold" | "listed" {
  if (status === "pending") return "reserved";
  if (status === "cancelled" || status === "refunded") return "listed";
  return "sold";
}
