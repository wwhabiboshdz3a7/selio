import type { ZodType, ZodTypeDef } from "zod";

export type AIErrorCode =
  | "config"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "rate_limited"
  | "circuit_open"
  | "quota_exceeded"
  | "queue_full"
  | "invalid_output"
  | "model_missing"
  | "http";

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIError";
  }
}

export interface GenerateRequest {
  /** Instructions système (jamais de contenu non fiable ici). */
  system: string;
  /** Prompt utilisateur, les données non fiables y sont balisées explicitement. */
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Identifiant de corrélation (journalisation, métriques). */
  requestId?: string;
  kind?: string;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Usage {
  promptTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
  latencyMs: number;
  model: string;
  provider: string;
}

export interface StructuredRequest<T> extends GenerateRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: ZodType<T, ZodTypeDef, any>;
  schemaName: string;
  /** Exemple de forme JSON attendue (aide les petits modèles). */
  example?: unknown;
}

export interface StructuredResult<T> extends GenerateResult {
  data: T;
  raw: string;
}

export interface HealthResult {
  ok: boolean;
  status: "healthy" | "degraded" | "unavailable" | "unconfigured" | "mock";
  message: string;
  latencyMs: number | null;
  model: string;
  provider: string;
  details?: Record<string, unknown>;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  health(opts?: GenerateOptions): Promise<HealthResult>;
  generate(req: GenerateRequest, opts?: GenerateOptions): Promise<GenerateResult>;
  generateStructured<T>(req: StructuredRequest<T>, opts?: GenerateOptions): Promise<StructuredResult<T>>;
  /** Streaming optionnel (tokens au fil de l'eau). */
  stream?(req: GenerateRequest, opts?: GenerateOptions): AsyncIterable<string>;
}

/** Crée un signal qui expire après `timeoutMs` et suit un signal parent optionnel. */
export function withTimeout(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AIError("timeout", `Délai dépassé (${timeoutMs} ms)`, true)), timeoutMs);
  const onParentAbort = () => controller.abort(parent?.reason ?? new AIError("cancelled", "Requête annulée"));
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

export function toAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
    return new AIError("cancelled", "Requête annulée", false, err);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AIError("unavailable", message, true, err);
}

/** Extrait le premier objet JSON d'une sortie de modèle (tolère les ```json fences et le texte autour). */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}
