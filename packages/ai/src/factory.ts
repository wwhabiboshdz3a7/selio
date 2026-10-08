import { loadAIConfig, type AIConfig } from "./config";
import { MockAIProvider } from "./providers/mock";
import { OllamaProvider } from "./providers/ollama";
import { AIService, type QuotaGuard } from "./service";
import type { AIProvider } from "./types";

export function createProvider(config: AIConfig, deps: { fetchImpl?: typeof fetch; headers?: Record<string, string> } = {}): AIProvider {
  switch (config.AI_PROVIDER) {
    case "ollama":
      return new OllamaProvider({
        baseUrl: config.OLLAMA_BASE_URL,
        model: config.OLLAMA_MODEL,
        timeoutMs: config.AI_TIMEOUT_MS,
        contextLimit: config.AI_CONTEXT_LIMIT,
        maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
        fetchImpl: deps.fetchImpl,
        headers: deps.headers,
      });
    case "mock":
    default:
      return new MockAIProvider();
  }
}

export function createAIService(opts: { env?: Record<string, string | undefined>; config?: AIConfig; quota?: QuotaGuard; allowFallback: boolean; fetchImpl?: typeof fetch }): AIService {
  const config = opts.config ?? loadAIConfig(opts.env);
  const provider = createProvider(config, { fetchImpl: opts.fetchImpl });
  return new AIService({
    provider,
    concurrency: config.AI_MAX_CONCURRENCY,
    maxPending: config.AI_QUEUE_MAX_PENDING,
    circuitFailures: config.AI_CIRCUIT_FAILURES,
    circuitCooldownMs: config.AI_CIRCUIT_COOLDOWN_MS,
    timeoutMs: config.AI_TIMEOUT_MS,
    quota: opts.quota,
    allowFallback: opts.allowFallback,
  });
}
