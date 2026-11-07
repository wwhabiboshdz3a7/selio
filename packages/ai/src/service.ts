import { LABEL_FIELDS, STUDIO_LABEL_MAX_PHOTOS, STUDIO_MAX_PHOTOS, STUDIO_MODEL_MAX_PHOTOS, STUDIO_TAPE_MAX_PHOTOS, STUDIO_TRUSTED_CONFIDENCE } from "@selio/contracts";
import type { AiStatus, GarmentKind, HelpAnswerOutput, LabelReadOutput, ListingGenerationOutput, MeasurementsOutput, PhotoSortOutput, ReplySuggestion, SellerQuestion } from "@selio/contracts";
import { EXPECTED_MEASUREMENTS, checkModelImage, mergeSortBatches, planPhotoBatches, sanitizeUntrustedText, scanForInjection } from "@selio/domain";
import { CircuitBreaker } from "./circuit-breaker";
import { AIMetrics } from "./metrics";
import { AIQueue } from "./queue";
import {
  buildHelpAnswerRequest, buildLabelOcrRequest, buildLabelReadRequest, buildListingGenerationRequest, buildListingRequest, buildMeasurementsRequest, buildPhotoSortRequest, buildReplyRequest,
  type HelpAnswerContext, type ListingContext, type ListingGenerationContext, type ReplyContext, type StudioSimulatorHints,
} from "./prompts";
import { fallbackReply, validateHelpAnswer, validateLabelRead, validateMeasurements, validatePhotoSort, validateReplySuggestion, type FieldRejection, type LabelReadValidation } from "./policy/validate";
import { AIError, providerCanSeeImages, toAIError, type AIProvider, type EmbedResult, type GenerateOptions, type HealthResult, type OcrResult, type Usage } from "./types";

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

export interface GenerateListingResult {
  data: ListingGenerationOutput;
  source: "ai" | "fallback";
  provider: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; outputTokens: number };
  warnings: string[];
}

export interface HelpAnswerResult {
  data: HelpAnswerOutput;
  provider: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; outputTokens: number };
}

/**
 * Photos d'un appel Studio : base64 brut (ou data URL) réduites côté navigateur. Un objet `{ images }` est
 * aussi accepté ; pour les mesures, `garmentKind` oriente la lecture (mesures attendues pour la pièce).
 */
export type StudioImagesInput = string[] | { images: string[]; garmentKind?: GarmentKind };

const imagesOf = (input: StudioImagesInput): string[] => (Array.isArray(input) ? input : Array.isArray(input?.images) ? input.images : []);

/** Options des appels Studio (§5.11). */
export interface StudioCallOptions {
  signal?: AbortSignal;
  /** Indices du simulateur (démonstration, tests) : ignorés pour un vrai modèle. */
  simulator?: StudioSimulatorHints;
}

/** Ce que chaque appel Studio renvoie en plus de ses données. */
export interface StudioCallMeta {
  provider: string;
  model: string;
  latencyMs: number;
  usage: Usage;
  /** Vrai avec le simulateur (démonstration) : rien n'est réellement lu sur les photos. */
  simulated: boolean;
  warnings: string[];
}

export interface PhotoSortResult extends StudioCallMeta {
  data: PhotoSortOutput;
  /** Appels au modèle (6 photos au plus par appel). */
  calls: number;
}

export interface LabelReadResult extends StudioCallMeta {
  data: LabelReadOutput;
  questions: SellerQuestion[];
  rejected: FieldRejection[];
  /** OCR d'essai : configuré, tenté (second recours), utilisé (au moins un champ retenu après relecture). */
  ocr: { configured: boolean; attempted: boolean; used: boolean; model: string | null; text: string | null };
  /** Raccourci de `ocr.used`. */
  ocrUsed: boolean;
}

export interface MeasurementsReadResult extends StudioCallMeta {
  data: MeasurementsOutput;
  questions: SellerQuestion[];
  rejected: FieldRejection[];
}

const addUsage = (a: Usage, b: Usage): Usage => ({ promptTokens: a.promptTokens + b.promptTokens, outputTokens: a.outputTokens + b.outputTokens });

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

  /** Limites de la passerelle (affichées dans Paramètres › Assistant IA). */
  get limits(): { timeoutMs: number; concurrency: number; maxPending: number; circuitFailures: number; circuitCooldownMs: number } {
    const { timeoutMs, concurrency, maxPending, circuitFailures, circuitCooldownMs } = this.opts;
    return { timeoutMs, concurrency, maxPending, circuitFailures, circuitCooldownMs };
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
      this.metrics.success(result.latencyMs, result.usage, kind);
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

  /**
   * Générateur d'annonces : photos (+ indications) → annonce structurée.
   * Le texte est contrôlé (pas de HTML, de lien ni de motif d'injection).
   * Sans repli autorisé (production), toute défaillance remonte une AIError.
   */
  async generateListing(orgId: string, ctx: ListingGenerationContext, opts: { signal?: AbortSignal; allowFallback?: boolean; fallback?: () => ListingGenerationOutput } = {}): Promise<GenerateListingResult> {
    const allowFallback = opts.allowFallback ?? this.opts.allowFallback;
    const req = buildListingGenerationRequest(ctx);
    const warnings: string[] = [];
    if (ctx.images.length > STUDIO_MODEL_MAX_PHOTOS) warnings.push(`Seules ${STUDIO_MODEL_MAX_PHOTOS} photos sur ${ctx.images.length} ont été envoyées au modèle (${STUDIO_MODEL_MAX_PHOTOS} au plus par appel) : face, étiquette, mètre, dos et détail d'abord.`);
    try {
      const res = await this.run(orgId, "listing_generation", (o) => this.opts.provider.generateStructured(req, o), opts.signal);
      const text = `${res.data.title}\n${res.data.description}`;
      if (/<[a-z!/][^>]*>|https?:\/\/|www\./i.test(text)) throw new AIError("invalid_output", "L'annonce générée contient du HTML ou un lien", false);
      if (scanForInjection(text).suspicious) throw new AIError("invalid_output", "L'annonce générée reprend un motif suspect", false);
      if (ctx.images.length > 0 && this.opts.provider.name === "ollama" && !(this.opts.provider as { visionModel?: string | null }).visionModel) warnings.push("Aucun modèle de vision configuré : l'annonce est rédigée sans lire les photos (OLLAMA_VISION_MODEL).");
      if (res.data.confidence < 0.5) warnings.push("Confiance faible : vérifiez la marque, la taille et l'état avant de publier.");
      return { data: res.data, source: "ai", provider: res.provider, model: res.model, latencyMs: res.latencyMs, usage: res.usage, warnings };
    } catch (err) {
      const e = toAIError(err);
      if (e.code === "quota_exceeded" || e.code === "cancelled" || !allowFallback || !opts.fallback) throw e;
      warnings.push(`IA indisponible (${e.code}) : gabarit déterministe utilisé, relisez l'annonce.`);
      return { data: opts.fallback(), source: "fallback", provider: this.opts.provider.name, model: this.opts.provider.model, latencyMs: 0, usage: { promptTokens: 0, outputTokens: 0 }, warnings };
    }
  }

  /**
   * Assistant d'aide : l'IA rédige à partir des passages de la FAQ retenus, et sa sortie
   * n'est acceptée que si elle reste dans ces passages (validateHelpAnswer). Toute
   * défaillance remonte une AIError : l'appelant affiche alors la réponse de la FAQ,
   * signalée comme telle (jamais un texte simulé présenté comme venant du modèle).
   */
  async answerHelp(orgId: string, ctx: HelpAnswerContext, opts: { signal?: AbortSignal } = {}): Promise<HelpAnswerResult> {
    const req = buildHelpAnswerRequest(ctx);
    const res = await this.run(orgId, "help_answer", (o) => this.opts.provider.generateStructured(req, o), opts.signal);
    const v = validateHelpAnswer(res.data, ctx.passages);
    if (!v.ok) {
      this.metrics.failure("help_answer", "invalid_output");
      throw new AIError("invalid_output", `Réponse d'aide écartée (${v.code}) : ${v.reason}`, false, res.raw);
    }
    return { data: v.output, provider: res.provider, model: res.model, latencyMs: res.latencyMs, usage: res.usage };
  }

  /** Le fournisseur sait-il produire des embeddings (modèle 2) ? */
  get canEmbed(): boolean {
    return typeof this.opts.provider.embed === "function";
  }

  /**
   * Embeddings (modèle 2, « les prix ») : vecteurs pour retrouver les ventes
   * comparables. Passe par la file et le disjoncteur comme les générations,
   * et mesure sa latence sous le rôle « embed » (séparée des générations de
   * texte, bien plus longues). Les textes vides sont refusés ici, avant la file et le
   * disjoncteur : une erreur d'appelant n'est pas une panne du serveur.
   */
  async embed(orgId: string, texts: string[], opts: { signal?: AbortSignal } = {}): Promise<EmbedResult> {
    const provider = this.opts.provider;
    if (typeof provider.embed !== "function") {
      throw new AIError("config", `Le fournisseur IA « ${provider.name} » ne produit pas d'embeddings (modèle 2 absent)`, false);
    }
    if (texts.length === 0) return { embeddings: [], dimensions: 0, usage: { promptTokens: 0, outputTokens: 0 }, latencyMs: 0, model: provider.model, provider: provider.name };
    if (texts.some((t) => typeof t !== "string" || t.trim().length === 0)) throw new AIError("config", "Chaque texte à vectoriser doit être non vide", false);
    return this.run(orgId, "embed", (o) => provider.embed!(texts, o), opts.signal);
  }

  // -------------------------------------------------------------- Studio façon Kavis (§5.11)

  /** Le fournisseur a-t-il un OCR d'essai configuré (OLLAMA_OCR_MODEL) ? Facultatif. */
  get canOcr(): boolean {
    return typeof this.opts.provider.ocr === "function" && Boolean(this.opts.provider.ocrModel);
  }

  /** Indices du simulateur : seulement pour le simulateur, jamais transmis à un vrai modèle. */
  private simulatorFor(sim: StudioSimulatorHints | undefined): StudioSimulatorHints | undefined {
    return this.opts.provider.name === "mock" ? sim : undefined;
  }

  /** Sans modèle de vision, rien n'est lu : refus plutôt qu'une lecture d'une photo non vue. */
  private requireVision(what: string): void {
    if (!providerCanSeeImages(this.opts.provider)) {
      throw new AIError("config", `Aucun modèle de vision (modèle 1) configuré : ${what} est impossible sans lire les photos, rien n'est deviné (OLLAMA_VISION_MODEL).`, false);
    }
  }

  /**
   * Photos destinées au modèle 1 : nombre limité par appel, et chacune réduite côté navigateur (côté long
   * ≤ 1 024 px, ≤ 1 Mo, JPEG, PNG ou WebP lus dans les en-têtes). Le serveur ne réduit pas : il refuse,
   * avant la file et le disjoncteur (une photo trop grande n'est pas une panne du serveur).
   */
  private studioImages(images: string[], max: number, what: string): string[] {
    const list = images.filter((i): i is string => typeof i === "string").map((i) => (i.startsWith("data:") ? i.slice(i.indexOf(",") + 1) : i)).filter((i) => i.length > 0);
    if (list.length === 0) throw new AIError("input_rejected", `Aucune photo pour ${what}`, false);
    if (list.length > max) throw new AIError("input_rejected", `${list.length} photos pour ${what} : ${max} au plus`, false);
    list.forEach((img, i) => {
      const c = checkModelImage(img);
      if (!c.ok) throw new AIError("input_rejected", `Photo ${i + 1} : ${c.reason}`, false);
    });
    return list;
  }

  private meta(provider: { provider: string; model: string }, latencyMs: number, usage: Usage, warnings: string[]): StudioCallMeta {
    return { provider: provider.provider, model: provider.model, latencyMs, usage, simulated: this.opts.provider.name === "mock", warnings };
  }

  /**
   * Tri des photos (modèle 1) : rôle de chaque photo (face, dos, étiquette, détail, défaut, mètre ruban,
   * autre) et article auquel elle appartient. Au plus 6 photos réduites par appel : au-delà (12 au plus),
   * le tri se fait en lots équilibrés, réunis ensuite (le vendeur est prévenu de vérifier le regroupement).
   */
  async sortPhotos(orgId: string, input: StudioImagesInput, opts: StudioCallOptions = {}): Promise<PhotoSortResult> {
    this.requireVision("le tri des photos");
    const list = this.studioImages(imagesOf(input), STUDIO_MAX_PHOTOS, "le tri");
    const sim = this.simulatorFor(opts.simulator);
    const outputs: { output: PhotoSortOutput; offset: number }[] = [];
    const warnings: string[] = [];
    let usage: Usage = { promptTokens: 0, outputTokens: 0 };
    let latencyMs = 0;
    let last = { provider: this.opts.provider.name, model: this.opts.provider.model };
    const batches = planPhotoBatches(list.length);
    for (const b of batches) {
      const slice = <T>(v: T[] | undefined) => v?.slice(b.offset, b.offset + b.count);
      const req = buildPhotoSortRequest({ images: list.slice(b.offset, b.offset + b.count), simulator: sim && { ...sim, photoNames: slice(sim.photoNames), roles: slice(sim.roles), groups: slice(sim.groups) } });
      const res = await this.run(orgId, "photo_sort", (o) => this.opts.provider.generateStructured(req, o), opts.signal);
      const v = validatePhotoSort(res.data, b.count);
      if (!v.ok) {
        this.metrics.failure("photo_sort", "invalid_output");
        throw new AIError("invalid_output", `Tri des photos écarté (${v.code}) : ${v.reason}`, false, res.raw);
      }
      outputs.push({ output: v.output, offset: b.offset });
      warnings.push(...v.warnings);
      usage = addUsage(usage, res.usage);
      latencyMs += res.latencyMs;
      last = res;
    }
    const merged = mergeSortBatches(outputs);
    return { data: merged.output, calls: batches.length, ...this.meta(last, latencyMs, usage, [...warnings, ...merged.warnings]) };
  }

  /**
   * OCR d'essai sur l'image de l'étiquette (OLLAMA_OCR_MODEL). Facultatif : non configuré, AIError
   * « config ». Son texte n'est jamais utilisé seul : `readLabel` le donne au modèle 1 pour relecture.
   */
  async ocrLabel(orgId: string, input: StudioImagesInput, opts: StudioCallOptions = {}): Promise<OcrResult> {
    const provider = this.opts.provider;
    if (!this.canOcr || typeof provider.ocr !== "function") throw new AIError("config", "Aucun modèle OCR configuré (OLLAMA_OCR_MODEL, facultatif)", false);
    const list = this.studioImages(imagesOf(input), STUDIO_LABEL_MAX_PHOTOS, "l'OCR de l'étiquette");
    const req = buildLabelOcrRequest({ images: list, simulator: this.simulatorFor(opts.simulator) });
    return this.run(orgId, "label_ocr", (o) => provider.ocr!(req, o), opts.signal);
  }

  /**
   * Lecture de l'étiquette (modèle 1, 1 à 2 photos) : marque, taille, matière, référence lues sur
   * l'étiquette avec leur confiance, ou null avec une question au vendeur. Si la marque ou la taille
   * restent vides ou peu sûres et que l'OCR d'essai est configuré (`ocrFallback`, vrai par défaut), son
   * texte est donné au modèle 1 comme une donnée à relire (second recours, jamais obligatoire) ; une
   * panne de l'OCR garde la première lecture.
   */
  async readLabel(orgId: string, input: StudioImagesInput, opts: StudioCallOptions & { ocrFallback?: boolean } = {}): Promise<LabelReadResult> {
    this.requireVision("la lecture de l'étiquette");
    const list = this.studioImages(imagesOf(input), STUDIO_LABEL_MAX_PHOTOS, "la lecture de l'étiquette");
    const sim = this.simulatorFor(opts.simulator);
    const first = await this.run(orgId, "label_read", (o) => this.opts.provider.generateStructured(buildLabelReadRequest({ images: list, simulator: sim }), o), opts.signal);
    let v = validateLabelRead(first.data);
    let usage = first.usage;
    let latencyMs = first.latencyMs;
    let last: { provider: string; model: string } = first;
    const warnings: string[] = [];
    const ocr: LabelReadResult["ocr"] = { configured: this.canOcr, attempted: false, used: false, model: this.canOcr ? this.opts.provider.ocrModel ?? null : null, text: null };
    const weak = (["brand", "size"] as const).some((k) => v.output[k].value === null || v.output[k].confidence < STUDIO_TRUSTED_CONFIDENCE);
    if (opts.ocrFallback !== false && this.canOcr && weak) {
      ocr.attempted = true;
      try {
        const o = await this.ocrLabel(orgId, list, { signal: opts.signal, simulator: sim });
        usage = addUsage(usage, o.usage);
        latencyMs += o.latencyMs;
        const text = sanitizeUntrustedText(o.text, 600);
        if (text.trim()) {
          ocr.text = text;
          const second = await this.run(orgId, "label_read", (q) => this.opts.provider.generateStructured(buildLabelReadRequest({ images: list, ocrText: text, simulator: sim }), q), opts.signal);
          usage = addUsage(usage, second.usage);
          latencyMs += second.latencyMs;
          last = second;
          const merged = mergeLabelReads(v, validateLabelRead(second.data, { ocrText: text }));
          v = merged.validation;
          ocr.used = merged.fromSecond;
        } else warnings.push("L'OCR d'essai n'a reconnu aucun texte sur l'étiquette.");
      } catch (err) {
        const e = toAIError(err);
        if (e.code === "cancelled") throw e;
        warnings.push(`OCR d'essai indisponible (${e.code}) : l'étiquette est lue sans second recours.`);
      }
    }
    if (v.noTranscript && v.rejected.length > 0) warnings.push("Aucune transcription du texte de l'étiquette : rien n'est retenu (une valeur sans texte lu serait une déduction), les champs restent à indiquer.");
    if (v.rejected.length > 0) warnings.push(`${v.rejected.length} valeur(s) de l'étiquette écartée(s) (non lue(s) ou peu sûre(s)) : une question est posée au vendeur.`);
    return { data: v.output, questions: v.questions, rejected: v.rejected, ocr, ocrUsed: ocr.used, ...this.meta(last, latencyMs, usage, warnings) };
  }

  /**
   * Mesures lues sur le mètre ruban photographié (modèle 1, 3 photos au plus). Aucune photo de mètre :
   * aucun appel, aucune mesure. Sans ruban visible, ou mesure peu sûre, la mesure reste vide et une
   * question est posée au vendeur : jamais de mesure estimée à l'œil.
   */
  async readMeasurements(orgId: string, input: StudioImagesInput, opts: StudioCallOptions = {}): Promise<MeasurementsReadResult> {
    this.requireVision("la lecture des mesures");
    const images = imagesOf(input);
    const kind = Array.isArray(input) ? undefined : input.garmentKind;
    if (images.filter((i) => typeof i === "string" && i.length > 0).length === 0) {
      return { data: { tapeVisible: false, measurements: [] }, questions: [], rejected: [], ...this.meta({ provider: this.opts.provider.name, model: this.opts.provider.model }, 0, { promptTokens: 0, outputTokens: 0 }, ["Aucune photo avec un mètre ruban : aucune mesure n'est lue."]) };
    }
    const list = this.studioImages(images, STUDIO_TAPE_MAX_PHOTOS, "la lecture des mesures");
    const res = await this.run(orgId, "measurements_read", (o) => this.opts.provider.generateStructured(buildMeasurementsRequest({ images: list, expected: kind ? EXPECTED_MEASUREMENTS[kind] : undefined, simulator: this.simulatorFor(opts.simulator) }), o), opts.signal);
    const v = validateMeasurements(res.data);
    const warnings: string[] = [];
    if (!v.output.tapeVisible) warnings.push("Aucun mètre ruban visible sur les photos : aucune mesure n'est lue.");
    if (v.rejected.length > 0) warnings.push(`${v.rejected.length} mesure(s) écartée(s) (sans ruban, peu sûre(s) ou invraisemblable(s)) : une question est posée au vendeur.`);
    const kept = new Set<string>(v.output.measurements.map((m) => m.name));
    return { data: v.output, questions: v.questions.filter((q) => !kept.has(q.field)), rejected: v.rejected, ...this.meta(res, res.latencyMs, res.usage, warnings) };
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

/**
 * Réunit la première lecture de l'étiquette et sa relecture avec le texte de l'OCR d'essai : champ par
 * champ, la lecture validée la plus sûre (la relecture à confiance égale). Les questions ne restent que
 * pour les champs vides.
 */
function mergeLabelReads(a: LabelReadValidation, b: LabelReadValidation): { validation: LabelReadValidation; fromSecond: boolean } {
  const output: LabelReadOutput = { ...a.output };
  let fromSecond = false;
  for (const key of LABEL_FIELDS) {
    const fa = a.output[key];
    const fb = b.output[key];
    if (fb.value !== null && (fa.value === null || fb.confidence >= fa.confidence)) {
      output[key] = fb;
      fromSecond = true;
    }
  }
  output.careSymbols = [...new Set([...(a.output.careSymbols ?? []), ...(b.output.careSymbols ?? [])])].slice(0, 12);
  output.text = b.output.text ?? a.output.text;
  const empty = new Set(LABEL_FIELDS.filter((k) => output[k].value === null));
  const questions: SellerQuestion[] = [];
  for (const q of [...b.questions, ...a.questions]) if (empty.has(q.field as (typeof LABEL_FIELDS)[number]) && !questions.some((x) => x.field === q.field)) questions.push(q);
  return { validation: { output, questions, rejected: [...a.rejected, ...b.rejected], noTranscript: a.noTranscript && b.noTranscript }, fromSecond };
}
