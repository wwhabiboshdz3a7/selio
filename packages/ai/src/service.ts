import type { AiStatus, ReplySuggestion } from "@selio/contracts";
import { CircuitBreaker } from "./circuit-breaker";
import { AIMetrics } from "./metrics";
import { AIQueue } from "./queue";
import { buildListingRequest, buildReplyRequest, type ListingContext, type ReplyContext } from "./prompts";
import { fallbackReply, validateReplySuggestion } from "./policy/validate";
import { AIError, toAIError, type AIProvider, type GenerateOptions, type HealthResult } from "./types";

export interface QuotaGuard {
  /** Lève AIError("quota_exceeded") si l'organisation a épuisé son quota. */
  check(orgId: string, kind: string): Promise<void>;
  record(orgId: string, kind: string, usage: { promptTokens: number; outputTokens: number }): Promise<void>;
}

export interface AIServiceOptions {
  provider: AIProvider;
  concurrency: number;
  maxPending: number;
  circuitFailures: number;
  circuitCooldownMs: number;
  timeoutMs: number;
  quota?: QuotaGuard;
  /**
   * Autorise le repli sur un gabarit déterministe quand l'IA échoue.
   * Doit rester `false` en production : un résultat simulé ne remplace jamais
   * silencieusement Ollama. La démo le met à `true` et marque le résultat.
   */
  allowFallback: boolean;
}

export interface SuggestReplyResult {
  suggestion: ReplySuggestion;
  source: "ai" | "fallback";
  provider: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; outputTokens: number };
  validated: boolean;
  rejectionReason: string | null;
}

/** Passerelle IA : file, disjoncteur, quotas, métriques, validation. */
export class AIService {
  readonly metrics = new AIMetrics();
  readonly breaker: CircuitBreaker;
  readonly queue: AIQueue;
  private lastHealth: HealthResult | null = null;

  constructor(private readonly opts: AIServiceOptions) {
    this.breaker = new CircuitBreaker({ failureThreshold: opts.circuitFailures, cooldownMs: opts.circuitCooldownMs });
    this.queue = new AIQueue({ concurrency: opts.concurrency, maxPending: opts.maxPending });
  }

  get provider(): AIProvider {
    return this.opts.provider;
  }

  async health(opts?: GenerateOptions): Promise<HealthResult> {
    this.lastHealth = await this.opts.provider.health(opts);
    return this.lastHealth;
  }

  async status(): Promise<AiStatus> {
    const h = this.lastHealth ?? (await this.health());
    const circuit = this.breaker.snapshot();
    const status: AiStatus["status"] =
      circuit.state === "open" ? "circuit_open" : h.status === "mock" ? "mock" : h.status === "healthy" ? "healthy" : h.status === "degraded" ? "degraded" : h.status === "unconfigured" ? "unconfigured" : "unavailable";
    return {
      provider: h.provider,
      model: h.model,
      status,
      message: h.message,
      latencyMs: h.latencyMs,
      checkedAt: new Date().toISOString(),
      queue: this.queue.snapshot(),
      circuit,
    };
  }

  private async run<T>(orgId: string, kind: string, fn: (opts: GenerateOptions) => Promise<T & { usage: { promptTokens: number; outputTokens: number }; latencyMs: number }>, signal?: AbortSignal): Promise<T & { usage: { promptTokens: number; outputTokens: number }; latencyMs: number }> {
    this.metrics.start(kind);
    try {
      await this.opts.quota?.check(orgId, kind);
      const result = await this.queue.enqueue(() => this.breaker.run(() => fn({ signal, timeoutMs: this.opts.timeoutMs })), signal);
      this.metrics.success(result.latencyMs, result.usage);
      await this.opts.quota?.record(orgId, kind, result.usage);
      return result;
    } catch (err) {
      const e = toAIError(err);
      this.metrics.failure(kind, e.code);
      throw e;
    }
  }

  /**
   * Suggestion de réponse : la politique métier a déjà décidé (ctx.decision),
   * l'IA rédige, la sortie est validée par schéma puis par la politique.
   * Sans repli autorisé (production), toute défaillance remonte une AIError
   * explicite : jamais de texte simulé présenté comme venant d'Ollama.
   */
  async suggestReply(orgId: string, ctx: ReplyContext & { purchasePriceCents: number }, opts: { signal?: AbortSignal; allowFallback?: boolean } = {}): Promise<SuggestReplyResult> {
    const allowFallback = opts.allowFallback ?? this.opts.allowFallback;
    const req = buildReplyRequest(ctx);
    const validation = { decision: ctx.decision, offerCents: ctx.offerCents, floorPriceCents: ctx.floorPriceCents, purchasePriceCents: ctx.purchasePriceCents, listedPriceCents: ctx.listedPriceCents };
    const fallback = (reason: string, meta: { provider: string; model: string; latencyMs: number; usage: { promptTokens: number; outputTokens: number } }): SuggestReplyResult => ({
      suggestion: fallbackReply({ decision: ctx.decision, offerCents: ctx.offerCents, buyerName: ctx.buyerName, signature: ctx.settings.signature }),
      source: "fallback",
      ...meta,
      validated: true,
      rejectionReason: reason,
    });
    let res;
    try {
      res = await this.run(orgId, "reply_suggestion", (o) => this.opts.provider.generateStructured(req, o), opts.signal);
    } catch (err) {
      const e = toAIError(err);
      if (e.code === "quota_exceeded" || e.code === "cancelled" || !allowFallback) throw e;
      return fallback(`IA indisponible (${e.code}) : gabarit déterministe utilisé`, { provider: this.opts.provider.name, model: this.opts.provider.model, latencyMs: 0, usage: { promptTokens: 0, outputTokens: 0 } });
    }
    const v = validateReplySuggestion(res.data, validation);
    if (!v.ok) {
      this.metrics.failure("reply_suggestion", "invalid_output");
      if (!allowFallback) throw new AIError("invalid_output", `Sortie IA rejetée par la politique métier : ${v.reason}`, false, res.raw);
      return fallback(`Sortie IA rejetée (${v.code}) : gabarit déterministe utilisé`, { provider: res.provider, model: res.model, latencyMs: res.latencyMs, usage: res.usage });
    }
    return { suggestion: v.suggestion, source: "ai", provider: res.provider, model: res.model, latencyMs: res.latencyMs, usage: res.usage, validated: true, rejectionReason: null };
  }

  async describeListing(orgId: string, ctx: ListingContext, signal?: AbortSignal) {
    const req = buildListingRequest(ctx);
    const res = await this.run(orgId, "listing_description", (o) => this.opts.provider.generateStructured(req, o), signal);
    if (/<[a-z!/][^>]*>|https?:\/\//i.test(res.data.description + res.data.title)) {
      throw new AIError("invalid_output", "La description générée contient du HTML ou un lien", false);
    }
    return res;
  }
}
