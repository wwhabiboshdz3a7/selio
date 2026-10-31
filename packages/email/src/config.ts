import { z } from "zod";
import type { EmailLogger, EmailProvider } from "./types";
import { NoopEmailProvider } from "./providers/noop";
import { SmtpEmailProvider } from "./providers/smtp";

export const EMAIL_PROVIDERS = ["noop", "smtp"] as const;
export type EmailProviderKind = (typeof EMAIL_PROVIDERS)[number];

export const DEFAULT_EMAIL_FROM = "Selio <no-reply@localhost>";

const trimmed = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));

/**
 * Variables d'environnement des emails. Toutes facultatives : sans rien, le
 * fournisseur « noop » journalise les envois (adresse masquée) sans rien
 * expédier — c'est le cas de la démo, des tests et, tant que le service n'est
 * pas choisi par Ibrahim, de la production (signalé par un avertissement).
 * Accepte aussi un environnement déjà parsé par l'API (valeurs normalisées).
 */
export const emailConfigSchema = z.object({
  EMAIL_PROVIDER: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.enum(EMAIL_PROVIDERS).default("noop")),
  /** `smtp://utilisateur:motdepasse@hôte:587` (STARTTLS imposé, jamais de repli en clair) ou `smtps://…:465` (TLS direct). Jamais journalisée. */
  SMTP_URL: trimmed,
  /** Expéditeur affiché, ex. `Selio <no-reply@selio.fr>`. */
  EMAIL_FROM: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : DEFAULT_EMAIL_FROM)),
});

export type EmailEnv = z.infer<typeof emailConfigSchema>;

export interface EmailConfig {
  provider: EmailProviderKind;
  from: string;
  /** Présente seulement avec le fournisseur smtp. */
  smtpUrl?: string;
}

/** Lit et vérifie la configuration : `smtp` exige une `SMTP_URL` en smtp:// ou smtps://. */
export function loadEmailConfig(env: Record<string, unknown> = process.env): EmailConfig {
  const parsed = emailConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration des emails invalide : ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.EMAIL_PROVIDER === "noop") return { provider: "noop", from: cfg.EMAIL_FROM };
  if (!cfg.SMTP_URL) throw new Error("Configuration des emails invalide : EMAIL_PROVIDER=smtp exige SMTP_URL.");
  let url: URL;
  try {
    url = new URL(cfg.SMTP_URL);
  } catch {
    throw new Error("Configuration des emails invalide : SMTP_URL doit être une URL (smtp://utilisateur:motdepasse@hôte:587).");
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") throw new Error("Configuration des emails invalide : SMTP_URL doit commencer par smtp:// ou smtps://.");
  return { provider: "smtp", from: cfg.EMAIL_FROM, smtpUrl: cfg.SMTP_URL };
}

/** Avertissements de démarrage (jamais bloquants) : en production, « noop » signifie qu'aucun email ne part. */
export function emailStartupWarnings(cfg: EmailConfig, nodeEnv: string | undefined): string[] {
  if (nodeEnv === "production" && cfg.provider === "noop") {
    return ["EMAIL_PROVIDER=noop en production : aucun email (invitations, mot de passe oublié, échecs de paiement) n'est envoyé, ils sont seulement journalisés. Le service d'email reste à choisir avec Ibrahim (EMAIL_PROVIDER=smtp + SMTP_URL)."];
  }
  return [];
}

/** Construit le fournisseur d'après la configuration. */
export function createEmailProvider(cfg: EmailConfig, opts: { logger?: EmailLogger } = {}): EmailProvider {
  if (cfg.provider === "smtp") return new SmtpEmailProvider({ url: cfg.smtpUrl!, from: cfg.from, logger: opts.logger });
  return new NoopEmailProvider({ logger: opts.logger });
}
