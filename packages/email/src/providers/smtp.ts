import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { maskEmail } from "../mask";
import type { EmailLogger, EmailMessage, EmailProvider } from "../types";

/** Ce dont on a besoin d'un transport nodemailer (injectable dans les tests, sans réseau). */
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string; html?: string }): Promise<{ messageId?: string }>;
  verify(): Promise<unknown>;
  close(): void;
}

export interface SmtpEmailOptions {
  /** `smtp://utilisateur:motdepasse@hôte:587` ou `smtps://…:465`. Jamais journalisée. */
  url?: string;
  from: string;
  logger?: EmailLogger;
  /** Transport déjà construit (tests). Sinon créé depuis `url`. */
  transport?: MailTransport;
}

/**
 * Délais du transport (ms). Les défauts de nodemailer (2 min de connexion, 10 min d'inactivité)
 * sont bien trop longs pour un envoi fait pendant une requête HTTP : un serveur SMTP injoignable
 * doit échouer vite, pas retenir des ressources.
 */
export const SMTP_TIMEOUTS_MS = { connection: 10_000, greeting: 10_000, socket: 15_000 } as const;

/** Options de transport dérivées de l'URL SMTP (ce que `nodemailer.createTransport` reçoit). */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  /** TLS dès la connexion (`smtps://`, 465 par défaut). */
  secure: boolean;
  /** `smtp://` : STARTTLS **imposé** ; sans lui, nodemailer continue en clair si le serveur n'annonce pas STARTTLS. */
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

/**
 * Construit les options depuis `SMTP_URL`. On ne passe pas l'URL brute à nodemailer : sous cette
 * forme, `smtp://…:587` donne `{ secure: false }` sans `requireTLS`, et STARTTLS n'est tenté que si
 * la réponse EHLO l'annonce — un relais mal configuré ou un attaquant qui retire cette capacité
 * (repli classique) ferait partir le mot de passe SMTP et les liens à jeton en clair. Ici :
 * `smtp://` → STARTTLS obligatoire, `smtps://` → TLS direct. Identifiants décodés (`%40` → `@`).
 */
export function smtpTransportOptions(rawUrl: string): SmtpTransportOptions {
  const url = new URL(rawUrl);
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") throw new Error("SMTP_URL doit commencer par smtp:// ou smtps://.");
  const secure = url.protocol === "smtps:";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("SMTP_URL : port invalide.");
  const options: SmtpTransportOptions = {
    host: url.hostname,
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: SMTP_TIMEOUTS_MS.connection,
    greetingTimeout: SMTP_TIMEOUTS_MS.greeting,
    socketTimeout: SMTP_TIMEOUTS_MS.socket,
  };
  if (url.username) options.auth = { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) };
  return options;
}

/** Envoi réel par SMTP (nodemailer). Les identifiants ne vivent que dans SMTP_URL. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: MailTransport;
  private readonly from: string;
  private readonly logger: EmailLogger | undefined;

  constructor(opts: SmtpEmailOptions) {
    if (!opts.transport && !opts.url) throw new Error("SmtpEmailProvider : SMTP_URL requise.");
    this.transport = opts.transport ?? (nodemailer.createTransport(smtpTransportOptions(opts.url!)) as unknown as MailTransport);
    this.from = opts.from;
    this.logger = opts.logger;
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    try {
      const info = await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) });
      const id = info.messageId || `smtp-${randomUUID()}`;
      this.logger?.info({ provider: "smtp", id, to: maskEmail(message.to), subject: message.subject }, "email envoyé");
      return { id };
    } catch (err) {
      // Le message d'erreur SMTP peut citer l'hôte, jamais les identifiants : on ne journalise que lui.
      this.logger?.warn({ provider: "smtp", to: maskEmail(message.to), subject: message.subject, error: err instanceof Error ? err.message : String(err) }, "échec d'envoi SMTP");
      throw err;
    }
  }

  /** Vérifie la connexion au serveur (diagnostic au démarrage ; facultatif). */
  async verify(): Promise<void> {
    await this.transport.verify();
  }

  close(): void {
    this.transport.close();
  }
}
