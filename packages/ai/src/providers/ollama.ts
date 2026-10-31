import { AIError, extractJson, toAIError, withTimeout, type AIProvider, type EmbedResult, type ExpectedModel, type GenerateOptions, type GenerateRequest, type GenerateResult, type HealthResult, type StructuredRequest, type StructuredResult } from "../types";

export interface OllamaOptions {
  baseUrl: string;
  /** « Mon IA perso » : modèle de texte. */
  model: string;
  /** Modèle 1, « les photos » : utilisé quand la requête contient des images. */
  visionModel?: string;
  /** Modèle 2, « les prix » : utilisé par `embed()`. */
  embedModel?: string;
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

interface OllamaEmbedResponse {
  model?: string;
  embeddings?: unknown;
  prompt_eval_count?: number;
  error?: string;
}

/**
 * Un modèle est présent si son nom exact figure dans /api/tags ; sans étiquette
 * (« qwen3-vl »), Ollama résout « :latest ». Une autre étiquette (« :4b » pour
 * « :0.6b ») est un autre modèle : la génération répondrait 404.
 */
export function hasModel(installed: string[], expected: string): boolean {
  const want = expected.includes(":") ? expected : `${expected}:latest`;
  return installed.some((n) => n === expected || n === want);
}

/**
 * Provider Ollama côté serveur uniquement (jamais appelé depuis un navigateur).
 * Routage : les requêtes avec images vont au modèle de vision, `embed()` au
 * modèle d'embedding, tout le reste au modèle de texte (« mon IA perso »).
 * Utilise /api/generate avec `stream:false` et `format:"json"` pour les sorties structurées.
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly model: string;
  readonly visionModel: string | null;
  readonly embedModel: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OllamaOptions) {
    this.model = opts.model;
    this.visionModel = opts.visionModel ?? null;
    this.embedModel = opts.embedModel ?? null;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) throw new AIError("config", "fetch indisponible dans cet environnement");
  }

  private url(path: string): string {
    return this.opts.baseUrl.replace(/\/+$/, "") + path;
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", accept: "application/json", ...(this.opts.headers ?? {}) };
  }

  /** Les trois modèles attendus par la configuration, dans l'ordre texte, vision, embed. */
  expectedModels(installed: string[] = []): ExpectedModel[] {
    const out: ExpectedModel[] = [{ role: "text", name: this.model, present: hasModel(installed, this.model) }];
    if (this.visionModel) out.push({ role: "vision", name: this.visionModel, present: hasModel(installed, this.visionModel) });
    if (this.embedModel) out.push({ role: "embed", name: this.embedModel, present: hasModel(installed, this.embedModel) });
    return out;
  }

  async health(opts?: GenerateOptions): Promise<HealthResult> {
    const started = Date.now();
    const t = withTimeout(opts?.timeoutMs ?? Math.min(this.opts.timeoutMs, 10_000), opts?.signal);
    try {
      const res = await this.fetchImpl(this.url("/api/tags"), { headers: this.headers(), signal: t.signal });
      const latencyMs = Date.now() - started;
      if (!res.ok) return { ok: false, status: "unavailable", message: `Ollama a répondu ${res.status}`, latencyMs, model: this.model, provider: this.name };
      const body = (await res.json()) as { models?: { name: string }[] };
      const installed = (body.models ?? []).map((m) => m.name);
      const models = this.expectedModels(installed);
      const missing = models.filter((m) => !m.present).map((m) => m.name);
      const details = { models, missing, installed };
      const pull = missing.map((m) => `ollama pull ${m}`).join(" ; ");
      if (!models[0]!.present) {
        return { ok: false, status: "unavailable", message: `Serveur joignable mais modèle de texte « ${this.model} » absent (${pull})`, latencyMs, model: this.model, provider: this.name, details };
      }
      if (missing.length > 0) {
        const roles = models.filter((m) => !m.present).map((m) => (m.role === "vision" ? "les photos ne seront pas lues" : "les prix comparables ne seront pas retrouvés"));
        return { ok: false, status: "degraded", message: `Modèle de texte présent, mais ${missing.length > 1 ? "modèles" : "modèle"} « ${missing.join(" », « ")} » absent${missing.length > 1 ? "s" : ""} (${pull}) : ${roles.join(", ")}`, latencyMs, model: this.model, provider: this.name, details };
      }
      return { ok: true, status: "healthy", message: `Ollama joignable, ${models.length > 1 ? "modèles" : "modèle"} « ${models.map((m) => m.name).join(" », « ")} » présent${models.length > 1 ? "s" : ""}`, latencyMs, model: this.model, provider: this.name, details };
    } catch (err) {
      const e = toAIError(err);
      return { ok: false, status: "unavailable", message: e.code === "timeout" ? "Délai de connexion dépassé" : `Ollama injoignable : ${e.message}`, latencyMs: Date.now() - started, model: this.model, provider: this.name };
    } finally {
      t.clear();
    }
  }

  /** POST JSON vers Ollama avec délai, annulation et traduction des erreurs HTTP en AIError. */
  private async post<T extends { error?: string }>(path: string, body: Record<string, unknown>, opts?: GenerateOptions): Promise<{ data: T; latencyMs: number }> {
    const started = Date.now();
    const t = withTimeout(opts?.timeoutMs ?? this.opts.timeoutMs, opts?.signal);
    try {
      const res = await this.fetchImpl(this.url(path), { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: t.signal });
      if (res.status === 404) {
        const text = await safeText(res);
        if (/model/i.test(text)) throw new AIError("model_missing", `Modèle « ${String(body.model ?? this.model)} » introuvable sur le serveur Ollama (ollama pull ${String(body.model ?? this.model)})`, false);
        throw new AIError("http", `Ollama 404 : ${text.slice(0, 200)}`, false);
      }
      if (res.status === 429) throw new AIError("rate_limited", "Ollama sature (429)", true);
      if (!res.ok) throw new AIError("http", `Ollama a répondu ${res.status} : ${(await safeText(res)).slice(0, 200)}`, res.status >= 500);
      const data = (await res.json()) as T;
      if (data.error) throw new AIError("http", `Ollama : ${data.error}`, false);
      return { data, latencyMs: Date.now() - started };
    } catch (err) {
      if (t.signal.aborted && t.signal.reason instanceof AIError) throw t.signal.reason;
      throw toAIError(err);
    } finally {
      t.clear();
    }
  }

  private call(body: Record<string, unknown>, opts?: GenerateOptions): Promise<{ data: OllamaGenerateResponse; latencyMs: number }> {
    return this.post<OllamaGenerateResponse>("/api/generate", body, opts);
  }

  private options(req: GenerateRequest): Record<string, unknown> {
    return {
      num_ctx: this.opts.contextLimit,
      num_predict: Math.min(req.maxOutputTokens ?? this.opts.maxOutputTokens, this.opts.maxOutputTokens),
      temperature: req.temperature ?? 0.3,
    };
  }

  /** Modèle et images à envoyer : le modèle de vision n'est utilisé que si la requête contient des photos. */
  private target(req: GenerateRequest): { model: string; images?: string[] } {
    const images = req.images?.filter((i) => i.length > 0) ?? [];
    if (images.length > 0 && this.visionModel) return { model: this.visionModel, images };
    return { model: this.model };
  }

  async generate(req: GenerateRequest, opts?: GenerateOptions): Promise<GenerateResult> {
    const { data, latencyMs } = await this.call({ ...this.target(req), system: req.system, prompt: req.prompt, stream: false, options: this.options(req) }, opts);
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
    const target = this.target(req);
    const { data, latencyMs } = await this.call({ ...target, system: req.system, prompt, stream: false, format: "json", options: this.options(req) }, opts);
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
      model: data.model ?? target.model,
      provider: this.name,
    };
  }

  /**
   * Vecteurs d'embedding via POST /api/embed ({ model, input }) sur le modèle 2.
   * Un vecteur par texte, dans l'ordre ; les textes vides sont refusés (le
   * modèle renverrait un vecteur sans signification).
   */
  async embed(texts: string[], opts?: GenerateOptions): Promise<EmbedResult> {
    const model = this.embedModel;
    if (!model) throw new AIError("config", "Aucun modèle d'embedding configuré (OLLAMA_EMBED_MODEL)", false);
    if (texts.length === 0) return { embeddings: [], dimensions: 0, usage: { promptTokens: 0, outputTokens: 0 }, latencyMs: 0, model, provider: this.name };
    if (texts.some((t) => typeof t !== "string" || t.trim().length === 0)) throw new AIError("config", "Chaque texte à vectoriser doit être non vide", false);
    const { data, latencyMs } = await this.post<OllamaEmbedResponse>("/api/embed", { model, input: texts }, opts);
    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length || !embeddings.every((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x)))) {
      throw new AIError("invalid_output", `Ollama n'a pas renvoyé ${texts.length} vecteur(s) numérique(s) pour « ${model} »`, false);
    }
    const vectors = embeddings as number[][];
    return {
      embeddings: vectors,
      dimensions: vectors[0]!.length,
      usage: { promptTokens: data.prompt_eval_count ?? 0, outputTokens: 0 },
      latencyMs,
      model: data.model ?? model,
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
