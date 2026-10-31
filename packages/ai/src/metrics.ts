export interface MetricsSnapshot {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  rejectedOutputs: number;
  totalLatencyMs: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  promptTokens: number;
  outputTokens: number;
  /** Par rôle (reply_suggestion, listing_generation, help_answer, embed…) : volumes et latences propres. */
  byKind: Record<string, KindMetrics>;
}

export interface KindMetrics {
  requests: number;
  failures: number;
  successes: number;
  totalLatencyMs: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}

interface KindAccumulator {
  requests: number;
  failures: number;
  successes: number;
  totalLatencyMs: number;
  latencies: number[];
}

/** Métriques en mémoire (exposées par l'endpoint de santé protégé et l'admin opérateur). */
export class AIMetrics {
  private requests = 0;
  private successes = 0;
  private failures = 0;
  private timeouts = 0;
  private rejectedOutputs = 0;
  private totalLatencyMs = 0;
  private promptTokens = 0;
  private outputTokens = 0;
  private latencies: number[] = [];
  private byKind = new Map<string, KindAccumulator>();
  constructor(private readonly reservoirSize = 500) {}

  private kind(kind: string): KindAccumulator {
    const k = this.byKind.get(kind) ?? { requests: 0, failures: 0, successes: 0, totalLatencyMs: 0, latencies: [] };
    this.byKind.set(kind, k);
    return k;
  }

  start(kind = "generate"): void {
    this.requests++;
    this.kind(kind).requests++;
  }
  /** Succès : la latence alimente le réservoir global et celui du rôle (`kind`) quand il est donné. */
  success(latencyMs: number, usage: { promptTokens: number; outputTokens: number }, kind?: string): void {
    this.successes++;
    this.totalLatencyMs += latencyMs;
    this.promptTokens += usage.promptTokens;
    this.outputTokens += usage.outputTokens;
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.reservoirSize) this.latencies.shift();
    if (kind) {
      const k = this.kind(kind);
      k.successes++;
      k.totalLatencyMs += latencyMs;
      k.latencies.push(latencyMs);
      if (k.latencies.length > this.reservoirSize) k.latencies.shift();
    }
  }
  failure(kind = "generate", code?: string): void {
    this.failures++;
    if (code === "timeout") this.timeouts++;
    if (code === "invalid_output") this.rejectedOutputs++;
    this.kind(kind).failures++;
  }
  snapshot(): MetricsSnapshot {
    const quantiles = (latencies: number[]) => {
      const sorted = [...latencies].sort((a, b) => a - b);
      const q = (p: number) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!);
      return { p50LatencyMs: q(0.5), p95LatencyMs: q(0.95) };
    };
    const byKind: Record<string, KindMetrics> = {};
    for (const [name, k] of this.byKind) {
      byKind[name] = { requests: k.requests, failures: k.failures, successes: k.successes, totalLatencyMs: k.totalLatencyMs, ...quantiles(k.latencies) };
    }
    return {
      requests: this.requests,
      successes: this.successes,
      failures: this.failures,
      timeouts: this.timeouts,
      rejectedOutputs: this.rejectedOutputs,
      totalLatencyMs: this.totalLatencyMs,
      ...quantiles(this.latencies),
      promptTokens: this.promptTokens,
      outputTokens: this.outputTokens,
      byKind,
    };
  }
}
