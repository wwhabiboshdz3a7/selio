import { AIError, type AIErrorCode } from "./types";

export type CircuitState = "closed" | "open" | "half_open";

/**
 * Erreurs qui ne sont pas une panne du serveur IA et ne comptent donc pas dans le disjoncteur :
 * sortie invalide, annulation ou quota (le serveur a répondu), et les erreurs de configuration —
 * « model_missing » (un modèle secondaire pas encore installé, ex. `ollama pull qwen3-vl:8b` oublié)
 * ou « config » (texte vide, modèle non configuré). Sans cette exclusion, trois annonces Studio
 * avec un modèle de vision absent coupaient aussi les réponses aux acheteurs et l'aide.
 */
const NOT_AN_OUTAGE: ReadonlySet<AIErrorCode> = new Set<AIErrorCode>(["invalid_output", "cancelled", "quota_exceeded", "model_missing", "config"]);

export interface CircuitOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

/**
 * Disjoncteur : après N échecs consécutifs, les appels sont refusés
 * immédiatement pendant `cooldownMs`, puis un appel d'essai est autorisé.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  get state(): CircuitState {
    if (this.openedAt === null) return "closed";
    if (this.now() - this.openedAt >= this.opts.cooldownMs) return "half_open";
    return "open";
  }

  snapshot(): { state: CircuitState; failures: number; openedAt: string | null } {
    return { state: this.state, failures: this.failures, openedAt: this.openedAt === null ? null : new Date(this.openedAt).toISOString() };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open") throw new AIError("circuit_open", "Service IA temporairement coupé (disjoncteur ouvert)", true);
    if (state === "half_open") {
      if (this.halfOpenInFlight) throw new AIError("circuit_open", "Service IA en phase de test, réessayez", true);
      this.halfOpenInFlight = true;
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    } finally {
      this.halfOpenInFlight = false;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  private onFailure(err: unknown): void {
    if (err instanceof AIError && NOT_AN_OUTAGE.has(err.code)) return;
    this.failures++;
    if (this.failures >= this.opts.failureThreshold || this.openedAt !== null) this.openedAt = this.now();
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = null;
  }
}
