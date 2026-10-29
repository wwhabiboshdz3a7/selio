import type { Role } from "@selio/contracts";
import type { AIService } from "@selio/ai";
import type { Db, SecretBox, Tx } from "@selio/db";
import type { EmailMessage, EmailProvider } from "@selio/email";
import type { PaymentProvider } from "@selio/connectors";
import { can, type Action } from "@selio/domain";
import type { BillingOptions } from "./types";

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
  /**
   * Emails transactionnels (invitations, mot de passe oublié, échec de paiement, alertes).
   * L'API le fournit toujours (fournisseur « noop » au minimum) ; absent dans le worker
   * tant qu'il n'envoie rien : `sendEmail` le signale alors sans lever.
   */
  email?: EmailProvider;
  /** URL publique du site (PUBLIC_WEB_URL), base des liens envoyés par email. */
  publicWebUrl?: string;
  /**
   * Fournisseur de paiement (Revolut Merchant API). Absent ou null tant que REVOLUT_SECRET_KEY
   * n'est pas renseignée : aucune commande n'est créée, l'interface le dit honnêtement.
   */
  payments?: PaymentProvider | null;
  /** Options de facturation (franchise de TVA). Par défaut : TVA à 20 %. */
  billing?: BillingOptions;
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

/** Même valeur par défaut que PUBLIC_WEB_URL dans l'API (développement local). */
export const DEFAULT_PUBLIC_WEB_URL = "http://127.0.0.1:5173";

/** Lien absolu vers une page du site : `webLink(services, "/invitation", { token })`. */
export function webLink(services: Services, path: string, query: Record<string, string> = {}): string {
  const base = (services.publicWebUrl ?? DEFAULT_PUBLIC_WEB_URL).replace(/\/+$/, "");
  const qs = new URLSearchParams(query).toString();
  return `${base}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
}

export interface EmailOutcome {
  sent: boolean;
  id?: string;
  /** Message d'erreur technique (sans donnée personnelle), à journaliser côté API. */
  error?: string;
}

/**
 * Envoi « au mieux » : ne lève jamais. L'appelant décide si l'échec fait échouer
 * l'opération (invitation : rien n'est créé sans email) ou s'il est seulement
 * journalisé (mot de passe oublié : la réponse ne doit rien révéler).
 */
export async function sendEmail(services: Services, message: EmailMessage): Promise<EmailOutcome> {
  if (!services.email) return { sent: false, error: "aucun fournisseur d'email dans les services" };
  try {
    const { id } = await services.email.send(message);
    return { sent: true, id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
