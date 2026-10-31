import { z } from "zod";
import { PAYMENT_MODES, type PaymentMode } from "@selio/contracts";
import { DEFAULT_REVOLUT_API_VERSION, RevolutClient } from "./revolut";
import { PaymentConfigError, type PaymentLogger, type PaymentProvider } from "./types";

const trimmed = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));
const bool = z.union([z.string(), z.boolean()]).optional().transform((v) => v === true || v === "true" || v === "1");

/**
 * Variables d'environnement du paiement (API et worker). Sans REVOLUT_SECRET_KEY, le paiement
 * est désactivé : aucune commande n'est créée et l'interface le dit. Le mode est « sandbox »
 * par défaut ; « live » exige REVOLUT_LIVE_ALLOWED=true (refus explicite sinon : une clé de
 * production ne s'active jamais par accident). Accepte aussi un environnement déjà parsé
 * (valeurs normalisées).
 */
export const paymentConfigSchema = z.object({
  REVOLUT_SECRET_KEY: trimmed,
  REVOLUT_WEBHOOK_SECRET: trimmed,
  REVOLUT_MODE: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.enum(PAYMENT_MODES).default("sandbox")),
  REVOLUT_API_VERSION: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : DEFAULT_REVOLUT_API_VERSION)),
  REVOLUT_LIVE_ALLOWED: bool,
});
export type PaymentEnv = z.infer<typeof paymentConfigSchema>;

export interface PaymentConfig {
  provider: "revolut";
  secretKey: string;
  webhookSecret: string | null;
  mode: PaymentMode;
  apiVersion: string;
  liveAllowed: boolean;
}

/** Lit et vérifie la configuration ; `null` quand aucune clé n'est renseignée (paiement désactivé). */
export function loadPaymentConfig(env: Record<string, unknown> = process.env): PaymentConfig | null {
  const parsed = paymentConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new PaymentConfigError(`Configuration du paiement invalide : ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const cfg = parsed.data;
  if (!cfg.REVOLUT_SECRET_KEY) {
    if (cfg.REVOLUT_MODE === "live" && !cfg.REVOLUT_LIVE_ALLOWED) throw new PaymentConfigError("REVOLUT_MODE=live exige REVOLUT_LIVE_ALLOWED=true (bac à sable par défaut).");
    return null;
  }
  if (!cfg.REVOLUT_SECRET_KEY.startsWith("sk_")) throw new PaymentConfigError("REVOLUT_SECRET_KEY invalide : une clé secrète Revolut commence par sk_.");
  if (cfg.REVOLUT_MODE === "live" && !cfg.REVOLUT_LIVE_ALLOWED) throw new PaymentConfigError("REVOLUT_MODE=live exige REVOLUT_LIVE_ALLOWED=true après validation (bac à sable par défaut).");
  return { provider: "revolut", secretKey: cfg.REVOLUT_SECRET_KEY, webhookSecret: cfg.REVOLUT_WEBHOOK_SECRET ?? null, mode: cfg.REVOLUT_MODE, apiVersion: cfg.REVOLUT_API_VERSION, liveAllowed: cfg.REVOLUT_LIVE_ALLOWED };
}

/** Messages de démarrage, jamais bloquants. */
export function paymentStartupNotices(cfg: PaymentConfig | null, nodeEnv: string | undefined): { level: "warn" | "info"; message: string }[] {
  const prod = nodeEnv === "production";
  if (!cfg) return [{ level: prod ? "warn" : "info", message: "Paiement non configuré (REVOLUT_SECRET_KEY absente) : aucune commande ne peut être créée, l'abonnement reste en essai ou en accès de base." }];
  const out: { level: "warn" | "info"; message: string }[] = [];
  if (!cfg.webhookSecret) out.push({ level: "warn", message: "REVOLUT_WEBHOOK_SECRET absent : les webhooks Revolut sont refusés, aucun paiement ne sera confirmé automatiquement." });
  out.push({ level: cfg.mode === "live" ? "warn" : "info", message: `Paiement Revolut en mode ${cfg.mode === "live" ? "LIVE (argent réel)" : "bac à sable"} (API ${cfg.apiVersion}).` });
  return out;
}

/** Construit le fournisseur ; `null` sans configuration. Le `fetch` injectable sert aux tests. */
export function createPaymentProvider(cfg: PaymentConfig | null, opts: { fetchImpl?: typeof fetch; logger?: PaymentLogger } = {}): PaymentProvider | null {
  if (!cfg) return null;
  return new RevolutClient({ secretKey: cfg.secretKey, webhookSecret: cfg.webhookSecret, mode: cfg.mode, apiVersion: cfg.apiVersion, liveAllowed: cfg.liveAllowed, fetchImpl: opts.fetchImpl, logger: opts.logger });
}
