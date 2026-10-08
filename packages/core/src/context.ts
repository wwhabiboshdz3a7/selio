import type { Role } from "@selio/contracts";
import type { AIService } from "@selio/ai";
import type { Db, SecretBox, Tx } from "@selio/db";
import { can, type Action } from "@selio/domain";

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

export interface Services {
  db: Db;
  ai: AIService;
  secrets: SecretBox;
  now: () => Date;
  /** Mode d'exécution serveur : jamais de repli simulé en production. */
  allowAiFallback: boolean;
  version: string;
}

/** Contexte d'une requête authentifiée dans une organisation. */
export interface OrgContext {
  services: Services;
  orgId: string;
  userId: string;
  role: Role;
  isOperator: boolean;
  ip: string | null;
}

export function requireAction(ctx: OrgContext, action: Action): void {
  if (!can(ctx.role, action)) throw new AppError("forbidden", `Action non autorisée pour le rôle ${ctx.role}.`, 403);
}

export function withOrg<T>(ctx: OrgContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.services.db.withOrg(ctx.orgId, fn);
}

export function nowIso(ctx: OrgContext): string {
  return ctx.services.now().toISOString();
}
