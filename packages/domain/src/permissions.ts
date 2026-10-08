import type { Role } from "@selio/contracts";

export type Action =
  | "org.read" | "org.update" | "org.delete" | "members.manage" | "billing.manage"
  | "items.read" | "items.write" | "items.delete"
  | "customers.read" | "customers.write"
  | "conversations.read" | "messages.draft" | "messages.send"
  | "orders.read" | "orders.write"
  | "analytics.read" | "analytics.export"
  | "automations.read" | "automations.write"
  | "radar.read" | "radar.write" | "purchase.simulate" | "purchase.execute"
  | "connections.read" | "connections.manage"
  | "ai.use" | "ai.configure"
  | "tokens.manage" | "data.export" | "data.delete";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

const MIN_ROLE: Record<Action, Role> = {
  "org.read": "viewer", "org.update": "admin", "org.delete": "owner", "members.manage": "admin", "billing.manage": "owner",
  "items.read": "viewer", "items.write": "operator", "items.delete": "admin",
  "customers.read": "viewer", "customers.write": "operator",
  "conversations.read": "viewer", "messages.draft": "operator", "messages.send": "operator",
  "orders.read": "viewer", "orders.write": "operator",
  "analytics.read": "viewer", "analytics.export": "operator",
  "automations.read": "viewer", "automations.write": "admin",
  "radar.read": "viewer", "radar.write": "operator", "purchase.simulate": "operator", "purchase.execute": "owner",
  "connections.read": "viewer", "connections.manage": "admin",
  "ai.use": "operator", "ai.configure": "admin",
  "tokens.manage": "operator", "data.export": "admin", "data.delete": "owner",
};

export function can(role: Role, action: Action): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[action]];
}

export function minimumRole(action: Action): Role {
  return MIN_ROLE[action];
}
