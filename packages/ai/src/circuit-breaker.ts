import { AIError } from "./types";

export type CircuitState = "closed" | "open" | "half_open";

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
    // Les sorties invalides ne sont pas une panne du service : elles ne font pas sauter le disjoncteur.
    if (err instanceof AIError && (err.code === "invalid_output" || err.code === "cancelled" || err.code === "quota_exceeded")) return;
    this.failures++;
    if (this.failures >= this.opts.failureThreshold || this.openedAt !== null) this.openedAt = this.now();
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = null;
  }
}
