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
  byKind: Record<string, { requests: number; failures: number }>;
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
  private byKind = new Map<string, { requests: number; failures: number }>();
  constructor(private readonly reservoirSize = 500) {}

  start(kind = "generate"): void {
    this.requests++;
    const k = this.byKind.get(kind) ?? { requests: 0, failures: 0 };
    k.requests++;
    this.byKind.set(kind, k);
  }
  success(latencyMs: number, usage: { promptTokens: number; outputTokens: number }): void {
    this.successes++;
    this.totalLatencyMs += latencyMs;
    this.promptTokens += usage.promptTokens;
    this.outputTokens += usage.outputTokens;
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.reservoirSize) this.latencies.shift();
  }
  failure(kind = "generate", code?: string): void {
    this.failures++;
    if (code === "timeout") this.timeouts++;
    if (code === "invalid_output") this.rejectedOutputs++;
    const k = this.byKind.get(kind) ?? { requests: 0, failures: 0 };
    k.failures++;
    this.byKind.set(kind, k);
  }
  snapshot(): MetricsSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!);
    return {
      requests: this.requests,
      successes: this.successes,
      failures: this.failures,
      timeouts: this.timeouts,
      rejectedOutputs: this.rejectedOutputs,
      totalLatencyMs: this.totalLatencyMs,
      p50LatencyMs: q(0.5),
      p95LatencyMs: q(0.95),
      promptTokens: this.promptTokens,
      outputTokens: this.outputTokens,
      byKind: Object.fromEntries(this.byKind),
    };
  }
}
