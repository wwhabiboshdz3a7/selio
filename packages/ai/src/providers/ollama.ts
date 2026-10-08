import { AIError, extractJson, toAIError, withTimeout, type AIProvider, type GenerateOptions, type GenerateRequest, type GenerateResult, type HealthResult, type StructuredRequest, type StructuredResult } from "../types";

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  contextLimit: number;
  maxOutputTokens: number;
  /** Injectable pour les tests (HTTP simulé). */
  fetchImpl?: typeof fetch;
  /** En-têtes additionnels (ex. jeton d'une passerelle authentifiée devant Ollama). */
  headers?: Record<string, string>;
}

interface OllamaGenerateResponse {
  response?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  model?: string;
  error?: string;
}

/**
 * Provider Ollama côté serveur uniquement (jamais appelé depuis un navigateur).
 * Utilise /api/generate avec `stream:false` et `format:"json"` pour les sorties structurées.
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OllamaOptions) {
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) throw new AIError("config", "fetch indisponible dans cet environnement");
  }

  private url(path: string): string {
    return this.opts.baseUrl.replace(/\/+$/, "") + path;
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", accept: "application/json", ...(this.opts.headers ?? {}) };
  }

  async health(opts?: GenerateOptions): Promise<HealthResult> {
    const started = Date.now();
    const t = withTimeout(opts?.timeoutMs ?? Math.min(this.opts.timeoutMs, 10_000), opts?.signal);
    try {
      const res = await this.fetchImpl(this.url("/api/tags"), { headers: this.headers(), signal: t.signal });
      const latencyMs = Date.now() - started;
      if (!res.ok) return { ok: false, status: "unavailable", message: `Ollama a répondu ${res.status}`, latencyMs, model: this.model, provider: this.name };
      const body = (await res.json()) as { models?: { name: string }[] };
      const names = (body.models ?? []).map((m) => m.name);
      const present = names.some((n) => n === this.model || n.split(":")[0] === this.model.split(":")[0]);
      if (!present) {
        return { ok: false, status: "degraded", message: `Serveur joignable mais modèle « ${this.model} » absent (ollama pull ${this.model})`, latencyMs, model: this.model, provider: this.name, details: { models: names } };
      }
      return { ok: true, status: "healthy", message: "Ollama joignable, modèle présent", latencyMs, model: this.model, provider: this.name, details: { models: names } };
    } catch (err) {
      const e = toAIError(err);
      return { ok: false, status: "unavailable", message: e.code === "timeout" ? "Délai de connexion dépassé" : `Ollama injoignable : ${e.message}`, latencyMs: Date.now() - started, model: this.model, provider: this.name };
    } finally {
      t.clear();
    }
  }

  private async call(body: Record<string, unknown>, opts?: GenerateOptions): Promise<{ data: OllamaGenerateResponse; latencyMs: number }> {
    const started = Date.now();
    const t = withTimeout(opts?.timeoutMs ?? this.opts.timeoutMs, opts?.signal);
    try {
      const res = await this.fetchImpl(this.url("/api/generate"), { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: t.signal });
      if (res.status === 404) {
        const text = await safeText(res);
        if (/model/i.test(text)) throw new AIError("model_missing", `Modèle « ${this.model} » introuvable sur le serveur Ollama`, false);
        throw new AIError("http", `Ollama 404 : ${text.slice(0, 200)}`, false);
      }
      if (res.status === 429) throw new AIError("rate_limited", "Ollama sature (429)", true);
      if (!res.ok) throw new AIError("http", `Ollama a répondu ${res.status} : ${(await safeText(res)).slice(0, 200)}`, res.status >= 500);
      const data = (await res.json()) as OllamaGenerateResponse;
      if (data.error) throw new AIError("http", `Ollama : ${data.error}`, false);
      return { data, latencyMs: Date.now() - started };
    } catch (err) {
      if (t.signal.aborted && t.signal.reason instanceof AIError) throw t.signal.reason;
      throw toAIError(err);
    } finally {
      t.clear();
    }
  }

  private options(req: GenerateRequest): Record<string, unknown> {
    return {
      num_ctx: this.opts.contextLimit,
      num_predict: Math.min(req.maxOutputTokens ?? this.opts.maxOutputTokens, this.opts.maxOutputTokens),
      temperature: req.temperature ?? 0.3,
    };
  }

  async generate(req: GenerateRequest, opts?: GenerateOptions): Promise<GenerateResult> {
    const { data, latencyMs } = await this.call({ model: this.model, system: req.system, prompt: req.prompt, stream: false, options: this.options(req) }, opts);
    return {
      text: (data.response ?? "").trim(),
      usage: { promptTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      latencyMs,
      model: data.model ?? this.model,
      provider: this.name,
    };
  }

  async generateStructured<T>(req: StructuredRequest<T>, opts?: GenerateOptions): Promise<StructuredResult<T>> {
    const prompt = `${req.prompt}\n\nRéponds UNIQUEMENT avec un objet JSON valide${req.example ? ` de la forme : ${JSON.stringify(req.example)}` : ""}.`;
    const { data, latencyMs } = await this.call({ model: this.model, system: req.system, prompt, stream: false, format: "json", options: this.options(req) }, opts);
    const raw = (data.response ?? "").trim();
    const json = extractJson(raw);
    let parsedJson: unknown;
    try {
      parsedJson = json ? JSON.parse(json) : JSON.parse(raw);
    } catch {
      throw new AIError("invalid_output", "Le modèle n'a pas renvoyé de JSON exploitable", false, raw.slice(0, 300));
    }
    const parsed = req.schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AIError("invalid_output", `Sortie hors schéma ${req.schemaName} : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, false, raw.slice(0, 300));
    }
    return {
      data: parsed.data,
      raw,
      text: raw,
      usage: { promptTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      latencyMs,
      model: data.model ?? this.model,
      provider: this.name,
    };
  }

  async *stream(req: GenerateRequest, opts?: GenerateOptions): AsyncIterable<string> {
    const t = withTimeout(opts?.timeoutMs ?? this.opts.timeoutMs, opts?.signal);
    try {
      const res = await this.fetchImpl(this.url("/api/generate"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model: this.model, system: req.system, prompt: req.prompt, stream: true, options: this.options(req) }),
        signal: t.signal,
      });
      if (!res.ok || !res.body) throw new AIError("http", `Ollama a répondu ${res.status}`, res.status >= 500);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const chunk = JSON.parse(line) as OllamaGenerateResponse;
          if (chunk.response) yield chunk.response;
          if (chunk.done) return;
        }
      }
    } catch (err) {
      if (t.signal.aborted && t.signal.reason instanceof AIError) throw t.signal.reason;
      throw toAIError(err);
    } finally {
      t.clear();
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
