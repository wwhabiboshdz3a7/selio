import { randomUUID } from "node:crypto";
import { maskEmail } from "../mask";
import type { EmailLogger, EmailMessage, EmailProvider } from "../types";

export interface SentEmail extends EmailMessage {
  id: string;
  sentAt: string;
}

export interface NoopEmailOptions {
  logger?: EmailLogger;
  /** Nombre de derniers messages gardés en mémoire (tests, démo). 0 = rien. */
  keepLast?: number;
}

/**
 * Fournisseur « noop » : n'envoie rien. Il journalise chaque envoi avec
 * l'adresse masquée et le sujet — jamais le corps ni les liens (ils portent
 * des jetons) — et garde les derniers messages en mémoire pour que les tests
 * d'intégration puissent lire le lien envoyé.
 */
export class NoopEmailProvider implements EmailProvider {
  private readonly logger: EmailLogger | undefined;
  private readonly keepLast: number;
  private readonly sent: SentEmail[] = [];

  constructor(opts: NoopEmailOptions = {}) {
    this.logger = opts.logger;
    this.keepLast = Math.max(0, opts.keepLast ?? 20);
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    const id = `noop-${randomUUID()}`;
    this.logger?.info({ provider: "noop", id, to: maskEmail(message.to), subject: message.subject, bytes: message.text.length }, "email non envoyé (fournisseur noop)");
    if (this.keepLast > 0) {
      this.sent.push({ ...message, id, sentAt: new Date().toISOString() });
      while (this.sent.length > this.keepLast) this.sent.shift();
    }
    return { id };
  }

  /** Dernier message « envoyé », ou null. */
  last(): SentEmail | null {
    return this.sent[this.sent.length - 1] ?? null;
  }

  all(): readonly SentEmail[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
  }
}
