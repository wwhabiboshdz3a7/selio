/**
 * Emails transactionnels de Selio : invitations, mot de passe oublié, échec de
 * paiement, alertes. Le fournisseur (SMTP réel ou « noop » qui journalise) est
 * choisi par la configuration ; les services métier ne connaissent que cette
 * interface.
 */
export interface EmailMessage {
  /** Adresse du destinataire (une seule : pas de liste de diffusion dans Selio). */
  to: string;
  subject: string;
  /** Version texte, toujours présente : lisible partout, et c'est elle que les tests lisent. */
  text: string;
  /** Version HTML facultative (simple, sans image externe). */
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** Sous-ensemble d'un logger pino (Fastify `app.log`) : jamais le contenu complet d'un email. */
export interface EmailLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
}
