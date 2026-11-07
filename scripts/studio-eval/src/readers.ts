import { LABEL_FIELDS, type GarmentKind, type LabelFieldName, type MeasurementName } from "@selio/contracts";
import { AIError, type AIService, type HealthResult } from "@selio/ai";
import { dataUrlOf, type LoadedImage } from "./images";

/**
 * Deux façons de lire, derrière une même interface :
 *
 * - `DirectReader` : le service IA du dépôt (`@selio/ai`, `AIService.readLabel` / `readMeasurements`) avec
 *   `AI_PROVIDER=ollama` ; aucune base, aucun quota, aucune ligne écrite. C'est la voie de la machine de
 *   Marseille. Le simulateur (`mock`) n'est accepté que sur demande explicite, et le rapport le dit.
 * - `ApiReader` : l'API locale (`POST /api/studio/prepare`, rôle des photos imposé : étiquette ou mètre), avec
 *   un compte de l'équipe. Toute la chaîne du serveur est traversée (vérification des photos, lots, fusion
 *   avec provenance) ; chaque appel compte une requête IA et laisse un brouillon de préparation (purgé après
 *   30 jours, sans image). Seules les valeurs de provenance « label » et « tape_photo » sont évaluées.
 *
 * Dans les deux cas, rien n'est inventé par le script : il compare ce que le modèle a lu à la vérité terrain.
 */

export interface ReaderInfo {
  mode: "direct" | "api";
  provider: string;
  /** Modèle de texte (direct) ou adresse de l'API. */
  model: string;
  visionModel: string | null;
  ocrModel: string | null;
  ocrConfigured: boolean;
  /** Vrai avec le simulateur : rien n'est lu sur les photos, le rapport ne mesure rien. */
  simulated: boolean;
  status: string;
  message: string;
}

export type ReadField = { value: string | null; confidence: number };

export interface LabelReading {
  fields: Record<LabelFieldName, ReadField>;
  questions: number;
  rejected: number;
  ocr: { configured: boolean; attempted: boolean; used: boolean };
  latencyMs: number;
  simulated: boolean;
  warnings: string[];
}

export interface TapeReading {
  tapeVisible: boolean;
  measurements: { name: MeasurementName; valueCm: number; confidence: number }[];
  questions: number;
  rejected: number;
  latencyMs: number;
  simulated: boolean;
  warnings: string[];
}

/** Erreur d'une lecture : `fatal` arrête le protocole (serveur injoignable, configuration), sinon le cas est compté en erreur. */
export class ReaderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly fatal: boolean,
  ) {
    super(message);
    this.name = "ReaderError";
  }
}

export interface StudioReader {
  readonly mode: "direct" | "api";
  info(): Promise<ReaderInfo>;
  readLabel(image: LoadedImage, opts: { ocr: boolean }): Promise<LabelReading>;
  readMeasurements(images: LoadedImage[], garmentKind: GarmentKind): Promise<TapeReading>;
}

// ---------------------------------------------------------------- service IA du dépôt

/** Ce que le lecteur direct attend du service IA (sous-ensemble d'`AIService`, pour les tests). */
export type StudioAI = Pick<AIService, "health" | "readLabel" | "readMeasurements">;

/** Codes d'`AIError` après lesquels continuer n'a pas de sens (serveur ou configuration, pas la photo). */
const FATAL_AI_CODES = new Set(["unavailable", "circuit_open", "model_missing", "config", "cancelled", "queue_full"]);

export function toReaderError(err: unknown): ReaderError {
  if (err instanceof ReaderError) return err;
  if (err instanceof AIError) return new ReaderError(err.code, err.message, FATAL_AI_CODES.has(err.code));
  if (err instanceof Error) return new ReaderError("error", err.message, false);
  return new ReaderError("error", String(err), false);
}

export class DirectReader implements StudioReader {
  readonly mode = "direct" as const;
  private static readonly ORG_ID = "studio-eval";

  constructor(private readonly ai: StudioAI) {}

  async info(): Promise<ReaderInfo> {
    let health: HealthResult;
    try {
      health = await this.ai.health();
    } catch (err) {
      throw new ReaderError("unavailable", `Serveur IA injoignable : ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const models = health.details?.models ?? [];
    const vision = models.find((m) => m.role === "vision");
    const ocr = models.find((m) => m.role === "ocr");
    const simulated = health.provider === "mock" || health.status === "mock";
    return {
      mode: "direct",
      provider: health.provider,
      model: health.model,
      visionModel: vision ? `${vision.name}${vision.present ? "" : " (ABSENT)"}` : simulated ? "simulateur" : null,
      ocrModel: ocr ? `${ocr.name}${ocr.present ? "" : " (ABSENT)"}` : null,
      ocrConfigured: !!ocr,
      simulated,
      status: health.status,
      message: health.message,
    };
  }

  async readLabel(image: LoadedImage, opts: { ocr: boolean }): Promise<LabelReading> {
    try {
      const res = await this.ai.readLabel(DirectReader.ORG_ID, [image.base64], { ocrFallback: opts.ocr });
      const fields = {} as Record<LabelFieldName, ReadField>;
      for (const k of LABEL_FIELDS) fields[k] = { value: res.data[k].value, confidence: res.data[k].confidence };
      return { fields, questions: res.questions.length, rejected: res.rejected.length, ocr: { configured: res.ocr.configured, attempted: res.ocr.attempted, used: res.ocr.used }, latencyMs: res.latencyMs, simulated: res.simulated, warnings: res.warnings };
    } catch (err) {
      throw toReaderError(err);
    }
  }

  async readMeasurements(images: LoadedImage[], garmentKind: GarmentKind): Promise<TapeReading> {
    try {
      const res = await this.ai.readMeasurements(DirectReader.ORG_ID, { images: images.map((i) => i.base64), garmentKind }, {});
      const measurements = res.data.measurements.flatMap((m) => (m.valueCm !== null && m.evidence === "tape_photo" ? [{ name: m.name, valueCm: m.valueCm, confidence: m.confidence }] : []));
      return { tapeVisible: res.data.tapeVisible, measurements, questions: res.questions.length, rejected: res.rejected.length, latencyMs: res.latencyMs, simulated: res.simulated, warnings: res.warnings };
    } catch (err) {
      throw toReaderError(err);
    }
  }
}

// ---------------------------------------------------------------- API locale

export interface ApiReaderOptions {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
  /** Attente (ms) : remplacée dans les tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Nouvelles tentatives après un 429 (10 préparations par minute et par membre côté API). */
  maxRetries?: number;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

interface PrepArticle {
  fields: Record<LabelFieldName, { value: string | null; source: string | null; confidence?: number }>;
  tapeVisible: boolean;
  measurements: { name: MeasurementName; valueCm: number | null; source: string | null; confidence?: number }[];
  questions: unknown[];
  warnings: string[];
}

interface PrepResponse {
  articles: PrepArticle[];
  warnings: string[];
  simulated: boolean;
  ocr: { configured: boolean; used: boolean };
}

const RETRY_AFTER_MAX_MS = 90_000;
const RETRY_AFTER_DEFAULT_MS = 6_000;

export class ApiReader implements StudioReader {
  readonly mode = "api" as const;
  private cookie: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly opts: ApiReaderOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 20;
  }

  private url(p: string): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}${p}`;
  }

  /** Session de l'API : le mot de passe part dans le corps de la requête de connexion, jamais ailleurs (ni journal, ni rapport). */
  async login(): Promise<void> {
    if (this.cookie) return;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url("/api/auth/login"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: this.opts.email, password: this.opts.password }) });
    } catch (err) {
      throw new ReaderError("unavailable", `API injoignable (${this.opts.baseUrl}) : ${err instanceof Error ? err.message : String(err)}`, true);
    }
    if (!res.ok) throw new ReaderError("auth", `Connexion à l'API refusée (${res.status}) : vérifiez STUDIO_EVAL_EMAIL et STUDIO_EVAL_PASSWORD.`, true);
    const raw: string[] = typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function" ? (res.headers as { getSetCookie: () => string[] }).getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    const cookie = raw.map((c) => c.split(";")[0]?.trim() ?? "").filter((c) => c.includes("=")).join("; ");
    if (!cookie) throw new ReaderError("auth", "Connexion sans cookie de session : API inattendue.", true);
    this.cookie = cookie;
  }

  async info(): Promise<ReaderInfo> {
    await this.login();
    const res = await this.fetchImpl(this.url("/api/studio/limits"), { headers: { cookie: this.cookie! } });
    if (!res.ok) throw new ReaderError("unavailable", `GET /api/studio/limits a répondu ${res.status}.`, true);
    const limits = (await res.json()) as { vision?: { available?: boolean; simulated?: boolean; ocrConfigured?: boolean }; serverReduction?: boolean };
    const available = limits.vision?.available === true;
    const simulated = limits.vision?.simulated === true;
    return {
      mode: "api",
      provider: simulated ? "mock (via l'API)" : "API locale",
      model: this.opts.baseUrl,
      visionModel: available ? (simulated ? "simulateur" : "modèle 1 du serveur (nom : /api/ai/health)") : null,
      ocrModel: limits.vision?.ocrConfigured ? "OCR d'essai configuré (nom : /api/ai/health)" : null,
      ocrConfigured: limits.vision?.ocrConfigured === true,
      simulated,
      status: available ? "healthy" : "unavailable",
      message: available ? "Lecture des photos disponible sur l'API." : "Aucun modèle de vision branché sur l'API : rien ne peut être lu.",
    };
  }

  private async prepare(body: Record<string, unknown>): Promise<PrepResponse> {
    await this.login();
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.url("/api/studio/prepare"), { method: "POST", headers: { "content-type": "application/json", cookie: this.cookie! }, body: JSON.stringify(body) });
      } catch (err) {
        throw new ReaderError("unavailable", `API injoignable : ${err instanceof Error ? err.message : String(err)}`, true);
      }
      if (res.status === 429) {
        if (attempt >= this.maxRetries) throw new ReaderError("rate_limited", "Limite de débit de l'API atteinte trop longtemps (429).", true);
        const header = Number(res.headers.get("retry-after") ?? "");
        await this.sleep(Number.isFinite(header) && header > 0 ? Math.min(header * 1000, RETRY_AFTER_MAX_MS) : RETRY_AFTER_DEFAULT_MS);
        continue;
      }
      if (res.ok) return (await res.json()) as PrepResponse;
      let parsed: ApiErrorBody = {};
      try {
        parsed = (await res.json()) as ApiErrorBody;
      } catch {
        /* corps non JSON */
      }
      const code = parsed.error?.code ?? "http";
      const message = parsed.error?.message ?? `L'API a répondu ${res.status}.`;
      if (res.status === 401) throw new ReaderError("auth", `Session de l'API refusée (401) : ${message}`, true);
      if (res.status === 402 || res.status === 403 || res.status === 503) throw new ReaderError(code, message, true);
      if (code === "photo_rejected" || code === "too_many_photos" || code === "payload_too_large" || code === "ai_input_rejected") throw new ReaderError("input_rejected", message, false);
      throw new ReaderError(code, message, res.status >= 500);
    }
  }

  private static article(prep: PrepResponse): PrepArticle {
    const article = prep.articles[0];
    if (!article) throw new ReaderError("empty", "La préparation n'a renvoyé aucun article.", false);
    return article;
  }

  async readLabel(image: LoadedImage, _opts: { ocr: boolean }): Promise<LabelReading> {
    const started = Date.now();
    const prep = await this.prepare({ photos: [{ id: "etiquette", url: dataUrlOf(image), role: "label" }] });
    const article = ApiReader.article(prep);
    const fields = {} as Record<LabelFieldName, ReadField>;
    for (const k of LABEL_FIELDS) {
      const f = article.fields[k];
      fields[k] = f && f.source === "label" && f.value !== null ? { value: f.value, confidence: f.confidence ?? 0 } : { value: null, confidence: 0 };
    }
    return {
      fields,
      questions: article.questions.length,
      rejected: 0,
      ocr: { configured: prep.ocr?.configured === true, attempted: prep.ocr?.used === true, used: prep.ocr?.used === true },
      latencyMs: Date.now() - started,
      simulated: prep.simulated === true,
      warnings: [...(prep.warnings ?? []), ...(article.warnings ?? [])],
    };
  }

  async readMeasurements(images: LoadedImage[], garmentKind: GarmentKind): Promise<TapeReading> {
    const started = Date.now();
    const prep = await this.prepare({ photos: images.map((img, i) => ({ id: `metre-${i + 1}`, url: dataUrlOf(img), role: "tape" })), garmentKind });
    const article = ApiReader.article(prep);
    const measurements = article.measurements.flatMap((m) => (m.source === "tape_photo" && m.valueCm !== null ? [{ name: m.name, valueCm: m.valueCm, confidence: m.confidence ?? 0 }] : []));
    return { tapeVisible: article.tapeVisible === true, measurements, questions: article.questions.length, rejected: 0, latencyMs: Date.now() - started, simulated: prep.simulated === true, warnings: [...(prep.warnings ?? []), ...(article.warnings ?? [])] };
  }
}
