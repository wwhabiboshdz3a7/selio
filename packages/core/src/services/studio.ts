import { randomUUID } from "node:crypto";
import { z, type ZodType, type ZodTypeDef } from "zod";
import {
  LABEL_FIELDS, LABEL_FIELD_LABELS, MEASUREMENT_LABELS, MEASUREMENT_NAMES, PRICE_METHOD_LABELS, STUDIO_LABEL_MAX_PHOTOS, STUDIO_MAX_PHOTOS, STUDIO_MODEL_JPEG_QUALITY, STUDIO_MODEL_MAX_BYTES, STUDIO_MODEL_MAX_PHOTOS, STUDIO_MODEL_MAX_SIDE_PX, STUDIO_TAPE_MAX_PHOTOS, STUDIO_TRUSTED_CONFIDENCE,
  garmentKind, generatorPhoto, id, itemCategory, labelReadOutput, listingGenerationInput, measurementName, measurementValues, measurementsOutput, namedMeasurementField, nonNegCents, photoRole, photoRoleSource, photoSortOutput, quotasForPlan, sellerQuestion, sizeReference, studioFields, studioSellerHints,
  type GarmentKind, type ItemCategory, type LabelFieldName, type LabelReadOutput, type ListingDraft, type ListingGenerationOutput, type MeasurementName, type MeasurementsOutput, type NamedMeasurementField, type Organization, type PhotoRole, type PhotoRoleSource, type PhotoSortOutput,
  type PriceEstimate, type SellerQuestion, type SizeReference, type SortedPhoto, type StudioFields, type StudioPrep, type StudioPrepArticle,
} from "@selio/contracts";
import { repos } from "@selio/db";
import { AIError, providerCanSeeImages, type AIService } from "@selio/ai";
import {
  assembleStudioPrep, buildSellerQuestions, can, checkImageDimensions, comparablesFromSales, garmentKindFor, groupPhotosByArticle, matchSizeReference, mergeFields, mergeSortBatches, photosWithRole, planPhotoBatches, priceListingDraft, stripUnknownMeasurements, suggestFloorPrice,
  type DraftPricing, type StudioArticleInput,
} from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services } from "../context";
import * as pricing from "./pricing";

type SizeReferenceRecord = repos.SizeReferenceRecord;
type StudioPrepRecord = repos.StudioPrepRecord;

/**
 * Selio Studio.
 *
 * 1. `prepareListing` (Studio façon Kavis, §5.11) : les photos (clés de stockage ou photos réduites) sont
 *    triées par le modèle 1 (face, dos, étiquette, mètre ruban, défauts ; regroupement par article), puis,
 *    par article, l'étiquette est lue (marque, taille, matière, référence) et les mesures sont lues sur le
 *    mètre ruban photographié. La base des références de tailles complète les mesures par la référence lue.
 *    Chaque valeur porte sa provenance (« label », « tape_photo », « reference_db », « seller ») ou reste
 *    vide avec une question au vendeur : JAMAIS de mesure inventée, jamais de marque déduite du style.
 *    Rien n'est compté dans le quota Studio à cette étape (seulement une requête IA).
 * 2. `validatePrep` : les réponses du vendeur deviennent des valeurs « seller » ; s'il coche « partager
 *    anonymement la mesure », ses mesures validées enrichissent la base des références (sans donnée
 *    personnelle).
 * 3. `generateListing` : rédaction de l'annonce par le modèle à partir des photos de l'article et, avec
 *    `prepId`, des champs validés (le modèle ne relit ni l'étiquette ni le ruban : marque, taille, matière et
 *    mesures viennent de la préparation). Prix par l'estimation des prix (§5.10). Une annonce rédigée =
 *    un « studio.listing ». Rien n'est publié ici.
 *
 * Photos : 12 au plus reçues, chacune ≤ 1 600 px de côté long et ≤ 1,5 Mo ; le modèle ne reçoit jamais plus de
 * 6 photos par appel, chacune ≤ 1 024 px et ≤ 1 Mo (réduites par le navigateur, JPEG ≈ 80). Une photo trop
 * grande pour le modèle est réduite par le serveur si un réducteur est branché (`services.studio.reducer`),
 * sinon REFUSÉE (jamais envoyée en pleine taille).
 *
 * Précision : les objectifs (≥ 95 % de marques et tailles justes, 9 mesures sur 10 à 1 cm près) restent « à
 * mesurer » avec le protocole sur nos propres photos ; aucune précision n'est promise.
 */

// ---------------------------------------------------------------- limites

/** Photos reçues par préparation ou génération (comme le générateur). */
export const STUDIO_RECEIVED_MAX_PHOTOS = STUDIO_MAX_PHOTOS;
/** Côté long maximal d'une photo reçue (px) : au-delà, refus (la photo doit être réduite par le navigateur). */
export const STUDIO_RECEIVED_MAX_SIDE_PX = 1600;
/** Poids maximal d'une photo reçue (octets). */
export const STUDIO_RECEIVED_MAX_BYTES = 1_500_000;
/** Photos envoyées pour rédiger la description (face, dos, détails, défauts) : l'étiquette et le mètre sont déjà lus. */
export const STUDIO_DESCRIPTION_MAX_PHOTOS = 4;
/** Brouillons de préparation jamais validés : supprimés après 30 jours (ils ne contiennent que des clés et des champs). */
export const STUDIO_PREP_DRAFT_RETENTION_DAYS = 30;

// ---------------------------------------------------------------- modèle 1 (vision) : interface minimale

export interface StudioVisionCall<T = unknown> {
  data: T;
  provider: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; outputTokens: number };
  /** Questions et avertissements de la validation des lectures (lecture écartée, sans provenance…). */
  questions?: SellerQuestion[];
  warnings?: string[];
  /** L'OCR d'essai (OLLAMA_OCR_MODEL) a servi en second recours pour cette étiquette. */
  ocrUsed?: boolean;
}

export interface StudioVisionOptions {
  signal?: AbortSignal;
}

/**
 * Lecture des photos par le modèle 1 : tri, étiquette, mètre ruban. Images en base64 brut (au plus 6 par
 * appel, déjà vérifiées et réduites). Les sorties sont revalidées ici par les schémas de `@selio/contracts`
 * et fusionnées par `@selio/domain` (provenance obligatoire, seuils de confiance).
 */
export interface StudioVision {
  /** Le modèle voit réellement les photos (sinon : rien n'est lu, refus explicite). */
  readonly canSeeImages: boolean;
  /** Simulateur (démonstration) : les lectures sont marquées simulées. */
  readonly simulated: boolean;
  /** OCR d'essai configuré (OLLAMA_OCR_MODEL), utilisé en second recours sur l'étiquette seulement. */
  readonly ocrConfigured: boolean;
  sortPhotos(orgId: string, input: { images: string[] }, opts?: StudioVisionOptions): Promise<StudioVisionCall>;
  readLabel(orgId: string, input: { images: string[] }, opts?: StudioVisionOptions): Promise<StudioVisionCall>;
  readMeasurements(orgId: string, input: { images: string[]; garmentKind: GarmentKind }, opts?: StudioVisionOptions): Promise<StudioVisionCall>;
}

/**
 * Lecture d'une photo stockée par sa clé (`org/<org>/studio-photo/<id>.<ext>`) : API, stockage S3. `delete`
 * (facultatif) efface un objet du stockage : photo d'une demande de photo portée annulée, refusée, en échec ou
 * purgée, pour ne rien garder sans nécessité.
 */
export interface StudioPhotoStore {
  read(key: string): Promise<{ data: Uint8Array; contentType: string }>;
  delete?(key: string): Promise<void>;
}

/** Réduction d'une image (côté long ≤ `maxSide`, JPEG `quality`) : facultatif, aucun réducteur n'est fourni aujourd'hui. */
export interface ImageReducer {
  reduce(input: { data: Uint8Array; contentType: string }, opts: { maxSide: number; quality: number }): Promise<{ data: Uint8Array; contentType: string }>;
}

export interface StudioServices {
  vision?: StudioVision;
  photos?: StudioPhotoStore;
  reducer?: ImageReducer;
}

type AnyFn = (...args: unknown[]) => Promise<unknown>;

function normalizeCall(raw: unknown, fallback: { provider: string; model: string }): StudioVisionCall {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hasData = "data" in r;
  const usage = (r.usage && typeof r.usage === "object" ? r.usage : {}) as Record<string, unknown>;
  const list = <T>(v: unknown, schema: ZodType<T, ZodTypeDef, unknown>): T[] => (Array.isArray(v) ? v.flatMap((x) => { const p = schema.safeParse(x); return p.success ? [p.data] : []; }) : []);
  return {
    data: hasData ? r.data : raw,
    provider: typeof r.provider === "string" ? r.provider : fallback.provider,
    model: typeof r.model === "string" ? r.model : fallback.model,
    latencyMs: typeof r.latencyMs === "number" ? Math.max(0, Math.round(r.latencyMs)) : 0,
    usage: { promptTokens: Number(usage.promptTokens ?? 0) || 0, outputTokens: Number(usage.outputTokens ?? 0) || 0 },
    questions: list(r.questions, sellerQuestion),
    warnings: list(r.warnings, z.string().max(300)),
    ocrUsed: r.ocrUsed === true,
  };
}

/**
 * Le modèle 1 de la passerelle IA, s'il expose les lectures de Studio (`sortPhotos`, `readLabel`,
 * `readMeasurements`, signature `(orgId, entrée, { signal })`). Sinon null.
 */
export function visionFromAI(ai: AIService): StudioVision | null {
  const target = ai as unknown as Record<string, unknown>;
  const fn = (name: string): AnyFn | null => (typeof target[name] === "function" ? (target[name] as AnyFn).bind(ai) : null);
  const sort = fn("sortPhotos");
  const label = fn("readLabel");
  const measure = fn("readMeasurements");
  if (!sort || !label || !measure) return null;
  const meta = { provider: ai.provider.name, model: ai.provider.model };
  const ocrModel = (ai.provider as { ocrModel?: string | null }).ocrModel;
  return {
    canSeeImages: providerCanSeeImages(ai.provider),
    simulated: ai.provider.name === "mock",
    ocrConfigured: typeof ocrModel === "string" && ocrModel.length > 0,
    sortPhotos: async (orgId, input, opts) => normalizeCall(await sort(orgId, input, opts ?? {}), meta),
    readLabel: async (orgId, input, opts) => normalizeCall(await label(orgId, input, opts ?? {}), meta),
    readMeasurements: async (orgId, input, opts) => normalizeCall(await measure(orgId, input, opts ?? {}), meta),
  };
}

/** Lecture des photos de Studio : celle des services, sinon celle de la passerelle IA, sinon aucune. */
export function studioVisionOf(services: Services): StudioVision | null {
  return services.studio?.vision ?? visionFromAI(services.ai);
}

type VisionMethod = "sortPhotos" | "readLabel" | "readMeasurements";
type Programmed = unknown | Error | ((images: number) => unknown);

/**
 * Lecture factice pour les tests : réponses programmées par méthode (données brutes du modèle, une erreur
 * à lever, ou une fonction du nombre d'images), journal des appels. Sans réponse programmée : une seule
 * photo de face par article, étiquette illisible, aucun mètre ruban visible.
 */
export class FakeStudioVision implements StudioVision {
  canSeeImages = true;
  simulated = false;
  ocrConfigured = false;
  readonly calls: { method: VisionMethod; images: number; garmentKind?: GarmentKind }[] = [];
  private readonly queues: Record<VisionMethod, Programmed[]> = { sortPhotos: [], readLabel: [], readMeasurements: [] };

  respond(method: VisionMethod, ...responses: Programmed[]): this {
    this.queues[method].push(...responses);
    return this;
  }

  count(method: VisionMethod): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  private async run(method: VisionMethod, images: string[], fallback: () => unknown, extra: { garmentKind?: GarmentKind } = {}): Promise<StudioVisionCall> {
    this.calls.push({ method, images: images.length, ...extra });
    const next = this.queues[method].shift();
    if (next instanceof Error) throw next;
    const data = next === undefined ? fallback() : typeof next === "function" ? (next as (n: number) => unknown)(images.length) : next;
    return { data, provider: "fake", model: "fake-vision", latencyMs: 5, usage: { promptTokens: 100 * images.length, outputTokens: 40 } };
  }

  sortPhotos(_orgId: string, input: { images: string[] }): Promise<StudioVisionCall> {
    return this.run("sortPhotos", input.images, () => ({ photos: input.images.map((_, i) => ({ index: i, role: i === 0 ? "front" : "other", articleGroup: 1, confidence: 0.9 })) }));
  }

  readLabel(_orgId: string, input: { images: string[] }): Promise<StudioVisionCall> {
    return this.run("readLabel", input.images, () => ({ brand: null, size: null, material: null, reference: null, text: null }));
  }

  readMeasurements(_orgId: string, input: { images: string[]; garmentKind: GarmentKind }): Promise<StudioVisionCall> {
    return this.run("readMeasurements", input.images, () => ({ tapeVisible: false, measurements: [] }), { garmentKind: input.garmentKind });
  }
}

// ---------------------------------------------------------------- photos : contrôle et réduction

const PHOTO_KEY_RE = /^org\/([A-Za-z0-9_-]+)\/(studio-photo|item-photo)\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/;

export interface CheckedPhoto {
  /** Contenu prêt pour le modèle (base64 brut, sans préfixe). */
  base64: string;
  bytes: number;
  width: number;
  height: number;
  /** Réduite par le serveur (réducteur branché). */
  reduced: boolean;
}

const kb = (n: number) => `${Math.round(n / 1000)} Ko`;

function rejectPhoto(photoId: string, reason: string, message: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError("photo_rejected", `Photo ${photoId} : ${message}`, 400, { photoId, reason, ...extra });
}

/**
 * Vérifie une photo reçue puis la prépare pour le modèle : refus au-delà de 1,5 Mo ou de 1 600 px ; au-delà
 * de 1 024 px ou de 1 Mo, réduction par le serveur si un réducteur est branché, sinon REFUS (`needs_reduction`),
 * quel que soit le chemin : le serveur réduit ou refuse, il n'envoie jamais une photo plus grande que ce que le
 * modèle doit recevoir. `lenient` (générateur historique seulement) ne couvre qu'une image dont les dimensions
 * ne se lisent pas dans les en-têtes : elle passe telle quelle (jamais au-delà de 1,5 Mo), par compatibilité.
 */
export async function checkStudioPhoto(services: Pick<Services, "studio">, photoId: string, data: Uint8Array, contentType: string, opts: { lenient?: boolean } = {}): Promise<CheckedPhoto> {
  if (data.length > STUDIO_RECEIVED_MAX_BYTES) throw rejectPhoto(photoId, "too_heavy", `trop lourde (${kb(data.length)}, ${kb(STUDIO_RECEIVED_MAX_BYTES)} au plus) : réduisez-la avant l'envoi.`, { bytes: data.length });
  const info = checkImageDimensions(data);
  if (!info) {
    if (opts.lenient) return { base64: Buffer.from(data).toString("base64"), bytes: data.length, width: 0, height: 0, reduced: false };
    throw rejectPhoto(photoId, "unreadable", "illisible : JPEG, PNG ou WebP attendu.", { bytes: data.length });
  }
  const longSide = Math.max(info.width, info.height);
  if (longSide > STUDIO_RECEIVED_MAX_SIDE_PX) {
    throw rejectPhoto(photoId, "too_large", `trop grande (${info.width} × ${info.height} px, côté long ${STUDIO_RECEIVED_MAX_SIDE_PX} px au plus) : jamais de photo en pleine taille, réduisez-la à ${STUDIO_MODEL_MAX_SIDE_PX} px.`, { width: info.width, height: info.height, bytes: data.length });
  }
  if (longSide <= STUDIO_MODEL_MAX_SIDE_PX && data.length <= STUDIO_MODEL_MAX_BYTES) {
    return { base64: Buffer.from(data).toString("base64"), bytes: data.length, width: info.width, height: info.height, reduced: false };
  }
  const reducer = services.studio?.reducer;
  if (!reducer) {
    throw rejectPhoto(photoId, "needs_reduction", `trop grande pour le modèle (${info.width} × ${info.height} px, ${kb(data.length)} ; ${STUDIO_MODEL_MAX_SIDE_PX} px et ${kb(STUDIO_MODEL_MAX_BYTES)} au plus) : réduisez-la avant l'envoi.`, { width: info.width, height: info.height, bytes: data.length });
  }
  const out = await reducer.reduce({ data, contentType }, { maxSide: STUDIO_MODEL_MAX_SIDE_PX, quality: STUDIO_MODEL_JPEG_QUALITY });
  const after = checkImageDimensions(out.data);
  if (!after || Math.max(after.width, after.height) > STUDIO_MODEL_MAX_SIDE_PX || out.data.length > STUDIO_MODEL_MAX_BYTES) {
    throw rejectPhoto(photoId, "needs_reduction", "la réduction n'a pas abouti : réduisez-la avant l'envoi.", { width: info.width, height: info.height, bytes: data.length });
  }
  return { base64: Buffer.from(out.data).toString("base64"), bytes: out.data.length, width: after.width, height: after.height, reduced: true };
}

function dataUrlBytes(url: string): { data: Uint8Array; contentType: string } {
  const comma = url.indexOf(",");
  const contentType = url.slice(5, url.indexOf(";")) || "image/jpeg";
  return { data: new Uint8Array(Buffer.from(url.slice(comma + 1), "base64")), contentType };
}

async function readStoredPhoto(ctx: OrgContext, photoId: string, key: string): Promise<{ data: Uint8Array; contentType: string }> {
  const m = PHOTO_KEY_RE.exec(key);
  if (!m) throw rejectPhoto(photoId, "key", "clé de stockage invalide (photo d'article ou de Studio attendue).");
  if (m[1] !== ctx.orgId) throw new AppError("forbidden", `Photo ${photoId} : elle n'appartient pas à votre espace.`, 403, { photoId });
  const store = ctx.services.studio?.photos;
  if (!store) throw new AppError("storage_unconfigured", "Le stockage des photos n'est pas configuré sur ce serveur : envoyez les photos réduites directement.", 503);
  try {
    return await store.read(key);
  } catch {
    throw rejectPhoto(photoId, "missing", "introuvable dans le stockage (téléversement inachevé ou expiré).");
  }
}

// ---------------------------------------------------------------- quotas et requête IA

const monthStartOf = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

async function loadOrg(ctx: OrgContext): Promise<Organization> {
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  if (!org.settings.ai.enabled) throw new AppError("ai_unavailable", "L'assistant IA est désactivé dans les paramètres.", 409);
  return org;
}

/**
 * Contrôle des quotas avant tout appel au modèle : Studio inclus et quota d'annonces du mois non atteint
 * (rien n'est compté ici), quota IA mensuel. Crée la ligne `ai_requests` « en cours ».
 */
async function studioGate(ctx: OrgContext, org: Organization) {
  const monthStart = monthStartOf(ctx.services.now());
  return withOrg(ctx, async (tx) => {
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
    // Quota Studio du plan (annonces générées par mois, remis à zéro le 1er du mois UTC).
    const studioQuota = quotas.studioListingsPerMonth;
    if (studioQuota <= 0) throw new AppError("quota_exceeded", "Studio n'est pas inclus dans votre offre.", 402);
    if ((await repos.usage.sumKindSince(tx, "studio.listing", monthStart)) >= studioQuota) throw new AppError("quota_exceeded", `Quota Studio du mois atteint (${studioQuota}).`, 402);
    // Quota IA mensuel (plan et réglage de l'organisation), commun à toutes les requêtes IA.
    const quota = Math.min(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota || Infinity);
    if ((await repos.aiRequests.countSince(tx, monthStart)) >= quota) throw new AppError("quota_exceeded", `Quota IA mensuel atteint (${quota}).`, 402);
    return repos.aiRequests.create(tx, { kind: "listing_generation", provider: ctx.services.ai.provider.name, model: ctx.services.ai.provider.model, status: "running" });
  });
}

function aiStatusOf(err: unknown): "timeout" | "cancelled" | "rejected" | "failed" {
  const code = err instanceof AIError ? err.code : null;
  return code === "timeout" ? "timeout" : code === "cancelled" ? "cancelled" : code === "invalid_output" ? "rejected" : "failed";
}

/** Erreur de la passerelle IA → erreur d'API (jamais un résultat simulé présenté comme lu). */
function aiFailure(err: unknown, what: string): AppError {
  if (err instanceof AppError) return err;
  const e = err instanceof AIError ? err : null;
  if (e?.code === "quota_exceeded") return new AppError("quota_exceeded", e.message, 402);
  if (e?.code === "invalid_output") return new AppError("ai_invalid_output", e.message, 422);
  if ((e?.code as string | undefined) === "input_rejected") return new AppError("photo_rejected", e!.message, 400);
  return new AppError("ai_unavailable", `${what} indisponible (${e?.code ?? "erreur"}). Vous pouvez créer l'annonce à la main.`, 503);
}

// ---------------------------------------------------------------- préparation (Studio façon Kavis)

const prepPhotoInput = z
  .object({
    id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant de photo invalide"),
    /** Clé de stockage (`org/<org>/studio-photo/<id>.<ext>`), lue par le serveur. */
    key: z.string().trim().max(300).optional(),
    /** Ou photo réduite par le navigateur (data URL, JPEG ≈ 80, côté long ≤ 1 024 px). */
    url: z.string().max(3_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo JPEG, PNG ou WebP attendue").optional(),
    /** Rôle indiqué par le vendeur (« c'est l'étiquette ») : il prime sur le tri du modèle. */
    role: photoRole.optional(),
  })
  .refine((p) => (p.key ? 1 : 0) + (p.url ? 1 : 0) === 1, "Chaque photo : une clé de stockage ou une photo réduite, l'une ou l'autre.");

export const studioPrepareInput = z.object({
  photos: z.array(prepPhotoInput).min(1, "Ajoutez au moins une photo").max(STUDIO_RECEIVED_MAX_PHOTOS, `${STUDIO_RECEIVED_MAX_PHOTOS} photos au plus`),
  itemId: id.nullable().default(null),
  /** Catégorie de l'article et famille de la pièce : elles fixent les mesures à demander (jamais une valeur). */
  category: itemCategory.nullable().default(null),
  garmentKind: garmentKind.optional(),
  /** Type de pièce en quelques mots (« jean slim ») : sert seulement à choisir les mesures à demander. */
  notes: z.string().trim().max(200).optional(),
  /** Indications du vendeur : provenance « seller ». */
  hints: studioSellerHints.default({}),
});
export type StudioPrepareInput = z.input<typeof studioPrepareInput>;

/** Photo d'une préparation : identifiant donné par le client, clé de stockage (jamais l'image), rôle et sa provenance. */
export interface StudioPrepPhoto {
  index: number;
  id: string;
  key: string | null;
  role: PhotoRole;
  confidence: number;
  /** D'où vient le rôle : du tri du modèle, ou indiqué par le vendeur (jamais déduit de la confiance). */
  roleSource: PhotoRoleSource;
}

export type StudioPrepArticleView = StudioPrepArticle & { prepId: string; status: "draft" | "validated" };
export type StudioPrepResult = Omit<StudioPrep, "articles"> & { batchId: string; articles: StudioPrepArticleView[] };

interface VisionTotals {
  calls: number;
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
}

function addCall(totals: VisionTotals, call: StudioVisionCall): void {
  totals.calls++;
  totals.promptTokens += call.usage.promptTokens;
  totals.outputTokens += call.usage.outputTokens;
  totals.latencyMs += call.latencyMs;
}

/** Les erreurs qui arrêtent tout (quota, annulation) remontent ; les autres sont rendues. */
function fatal(err: unknown): boolean {
  return err instanceof AIError && (err.code === "quota_exceeded" || err.code === "cancelled");
}

/** Tri d'un lot revalidé : positions dans le lot, sans doublon. */
function cleanSort(raw: unknown, size: number): PhotoSortOutput {
  const parsed = photoSortOutput.safeParse(raw);
  if (!parsed.success) return { photos: [] };
  const seen = new Set<number>();
  return { photos: parsed.data.photos.filter((p) => p.index < size && !seen.has(p.index) && seen.add(p.index)) };
}

/**
 * Complète le tri : chaque photo reçue y figure une fois (une photo oubliée par le modèle rejoint le premier
 * article avec le rôle « other »), le rôle indiqué par le vendeur prime, les articles sont renumérotés 1, 2…
 * La provenance du rôle (`roleSource`) est posée ici, explicitement : « seller » pour un rôle indiqué par le
 * vendeur, « model » sinon (jamais déduite de la confiance, qu'un modèle peut renvoyer à 1).
 */
function completeSort(sort: PhotoSortOutput, count: number, roleHints: (PhotoRole | undefined)[]): PhotoSortOutput {
  const byIndex = new Map(sort.photos.map((p) => [p.index, p]));
  const firstGroup = [...sort.photos].sort((a, b) => a.index - b.index)[0]?.articleGroup ?? 1;
  const photos: SortedPhoto[] = [];
  for (let i = 0; i < count; i++) {
    const p = byIndex.get(i) ?? { index: i, role: "other" as PhotoRole, articleGroup: firstGroup, confidence: 0 };
    const hint = roleHints[i];
    photos.push(hint ? { ...p, role: hint, confidence: 1, roleSource: "seller" } : { ...p, roleSource: "model" });
  }
  const order = new Map<number, number>();
  for (const p of photos) if (!order.has(p.articleGroup)) order.set(p.articleGroup, order.size + 1);
  return { photos: photos.map((p) => ({ ...p, articleGroup: Math.min(12, order.get(p.articleGroup)!) })) };
}

function toSizeReferences(rows: SizeReferenceRecord[]): SizeReference[] {
  return rows.flatMap((r) => {
    const p = sizeReference.safeParse({ brand: r.brand, reference: r.reference, size: r.size, category: r.category, measurements: r.measurements });
    return p.success ? [p.data] : [];
  });
}

/**
 * Prépare une annonce à partir des photos : tri par article, lecture de l'étiquette, mesures sur le mètre
 * ruban, base des références, fusion avec provenance et questions au vendeur. Enregistre une préparation
 * par article (`studio_preps`, sans image) et rend la préparation complète avec l'identifiant de chaque
 * article. Ne compte pas d'annonce Studio (seulement une requête IA).
 */
export async function prepareListing(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<StudioPrepResult> {
  requireAction(ctx, "studio.generate");
  const parsed = studioPrepareInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  const org = await loadOrg(ctx);
  const vision = studioVisionOf(ctx.services);
  if (!vision) throw new AppError("ai_unavailable", "Préparation indisponible : la lecture des photos (modèle 1) n'est pas branchée sur ce serveur. Vous pouvez remplir l'annonce à la main.", 503);
  if (!vision.canSeeImages) throw new AppError("ai_unavailable", "Aucun modèle de vision configuré (OLLAMA_VISION_MODEL) : rien n'est lu sur les photos, aucune valeur n'est devinée. Remplissez les champs à la main.", 503);
  if (input.itemId) await withOrg(ctx, (tx) => repos.items.byId(tx, input.itemId!));

  // Photos : toutes vérifiées AVANT tout appel (12 photos en pleine taille sont refusées, rien n'est envoyé).
  const checked: (CheckedPhoto & { id: string; key: string | null })[] = [];
  for (const p of input.photos) {
    const src = p.key ? await readStoredPhoto(ctx, p.id, p.key) : dataUrlBytes(p.url!);
    checked.push({ ...(await checkStudioPhoto(ctx.services, p.id, src.data, src.contentType)), id: p.id, key: p.key ?? null });
  }

  const req = await studioGate(ctx, org);
  const started = Date.now();
  const totals: VisionTotals = { calls: 0, promptTokens: 0, outputTokens: 0, latencyMs: 0 };
  const warnings: string[] = [];
  let ocrUsed = false;
  try {
    // 1. Tri, au plus 6 photos par appel (7 → 4 + 3, 12 → 6 + 6).
    const batches: { output: PhotoSortOutput; offset: number }[] = [];
    for (const b of planPhotoBatches(checked.length, STUDIO_MODEL_MAX_PHOTOS)) {
      const call = await vision.sortPhotos(ctx.orgId, { images: checked.slice(b.offset, b.offset + b.count).map((c) => c.base64) }, { signal });
      addCall(totals, call);
      batches.push({ output: cleanSort(call.data, b.count), offset: b.offset });
      warnings.push(...(call.warnings ?? []));
    }
    const merged = mergeSortBatches(batches);
    warnings.push(...merged.warnings);
    const sort = completeSort(merged.output, checked.length, input.photos.map((p) => p.role));
    const groups = groupPhotosByArticle(sort);

    // 2. Par article : étiquette (2 photos au plus), mètre ruban (3 au plus), base des références.
    const kind: GarmentKind = input.garmentKind ?? garmentKindFor({ text: input.notes ?? null, category: input.category });
    const articles: StudioArticleInput[] = [];
    for (const group of groups) {
      const articleWarnings: string[] = [];
      const articleQuestions: SellerQuestion[] = [];
      let label: LabelReadOutput | null = null;
      let tape: MeasurementsOutput | null = null;
      const labelPhotos = photosWithRole(group.photos, "label", STUDIO_LABEL_MAX_PHOTOS);
      if (labelPhotos.length > 0) {
        try {
          const call = await vision.readLabel(ctx.orgId, { images: labelPhotos.map((p) => checked[p.index]!.base64) }, { signal });
          addCall(totals, call);
          const p = labelReadOutput.safeParse(call.data);
          if (p.success) label = p.data;
          else articleWarnings.push("Lecture de l'étiquette illisible : rien n'est retenu, complétez les champs.");
          articleQuestions.push(...(call.questions ?? []));
          articleWarnings.push(...(call.warnings ?? []));
          ocrUsed ||= call.ocrUsed === true;
        } catch (err) {
          if (fatal(err)) throw err;
          articleWarnings.push(`Lecture de l'étiquette indisponible (${err instanceof AIError ? err.code : "erreur"}) : rien n'est retenu, complétez les champs.`);
        }
      } else {
        articleWarnings.push("Aucune photo d'étiquette : marque, taille et matière restent à indiquer (jamais devinées d'après le style).");
      }
      const tapePhotos = photosWithRole(group.photos, "tape", STUDIO_TAPE_MAX_PHOTOS);
      if (tapePhotos.length > 0) {
        try {
          const call = await vision.readMeasurements(ctx.orgId, { images: tapePhotos.map((p) => checked[p.index]!.base64), garmentKind: kind }, { signal });
          addCall(totals, call);
          const p = measurementsOutput.safeParse(call.data);
          if (p.success) tape = p.data;
          else articleWarnings.push("Lecture du mètre ruban illisible : aucune mesure n'est retenue.");
          articleQuestions.push(...(call.questions ?? []));
          articleWarnings.push(...(call.warnings ?? []));
        } catch (err) {
          if (fatal(err)) throw err;
          articleWarnings.push(`Lecture du mètre ruban indisponible (${err instanceof AIError ? err.code : "erreur"}) : aucune mesure n'est retenue.`);
        }
      }
      // Aucune photo avec un mètre ruban : aucune mesure lue, jamais une estimation « à l'œil ».
      // Base des références : seulement par la marque et la référence lues (ou indiquées par le vendeur).
      const known = mergeFields(label, input.hints, null, tape).fields;
      let reference: SizeReference | null = null;
      if (known.brand.value && known.reference.value) {
        const refs = toSizeReferences(await ctx.services.db.withGlobal((g) => repos.sizeReferences.findAll(g, known.brand.value!, known.reference.value!)));
        reference = matchSizeReference(refs, { brand: known.brand.value, reference: known.reference.value, size: known.size.value });
        if (!reference && refs.length > 0) articleWarnings.push("Référence connue de la base, mais pas dans cette taille : mesures non reprises.");
      }
      articles.push({ articleGroup: group.articleGroup, label, tape, hints: input.hints, reference, garmentKind: kind, text: input.notes ?? null, category: input.category, questions: articleQuestions, warnings: articleWarnings });
    }

    if (vision.simulated) warnings.push("Démonstration : le simulateur ne lit pas réellement les photos, vérifiez chaque champ.");
    const prep = assembleStudioPrep({ sort, articles, warnings, simulated: vision.simulated, ocr: { configured: vision.ocrConfigured, used: ocrUsed } });

    // 3. Une préparation par article : clés et rôles des photos, champs et mesures avec provenance, questions.
    const batchId = randomUUID();
    const sortedByIndex = new Map(sort.photos.map((p) => [p.index, p]));
    return await withOrg(ctx, async (tx) => {
      const views: StudioPrepArticleView[] = [];
      for (const article of prep.articles) {
        const photos: StudioPrepPhoto[] = article.photoIndexes.map((i) => ({ index: i, id: checked[i]!.id, key: checked[i]!.key, role: sortedByIndex.get(i)?.role ?? "other", confidence: sortedByIndex.get(i)?.confidence ?? 0, roleSource: sortedByIndex.get(i)?.roleSource ?? "model" }));
        const row = await repos.studioPreps.create(tx, {
          batchId,
          articleGroup: article.articleGroup,
          itemId: input.itemId,
          photos,
          fields: article.fields,
          measurements: article.measurements,
          questions: article.questions,
          warnings: article.warnings,
          details: { photoIndexes: article.photoIndexes, modelPhotoIndexes: article.modelPhotoIndexes, careSymbols: article.careSymbols, tapeVisible: article.tapeVisible, sizeReference: article.sizeReference, ocrUsed },
          garment: article.garmentKind,
          category: input.category,
          simulated: vision.simulated,
          createdAt: nowIso(ctx),
        });
        views.push({ ...article, prepId: row.id, status: row.status });
      }
      await repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, promptTokens: totals.promptTokens, outputTokens: totals.outputTokens, latencyMs: Math.max(totals.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
      await repos.usage.record(tx, "ai.request", { requestId: req.id, kind: "studio_prep", calls: totals.calls, photos: checked.length, articles: views.length });
      return { ...prep, batchId, articles: views };
    });
  } catch (err) {
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: aiStatusOf(err), error: (err as Error).message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) })).catch(() => undefined);
    throw aiFailure(err, "Préparation");
  }
}

// ---------------------------------------------------------------- lecture des préparations

export interface StudioPrepView {
  prepId: string;
  batchId: string;
  articleGroup: number;
  status: "draft" | "validated";
  itemId: string | null;
  garmentKind: GarmentKind;
  category: ItemCategory | null;
  fields: StudioFields;
  measurements: NamedMeasurementField[];
  questions: SellerQuestion[];
  warnings: string[];
  photos: StudioPrepPhoto[];
  photoIndexes: number[];
  modelPhotoIndexes: number[];
  careSymbols: string[];
  tapeVisible: boolean;
  sizeReference: { brand: string; reference: string; size: string | null } | null;
  simulated: boolean;
  shareMeasurements: boolean;
  validatedAt: string | null;
  listingGeneratedAt: string | null;
  createdAt: string;
}

const EMPTY_FIELDS: StudioFields = { brand: { value: null, source: null }, size: { value: null, source: null }, material: { value: null, source: null }, reference: { value: null, source: null } };

function parseList<T>(raw: unknown[], schema: ZodType<T, ZodTypeDef, unknown>): T[] {
  return raw.flatMap((x) => {
    const p = schema.safeParse(x);
    return p.success ? [p.data] : [];
  });
}

const prepPhotoRow = z.object({ index: z.number().int().min(0).max(11), id: z.string(), key: z.string().nullable().default(null), role: photoRole.catch("other"), confidence: z.number().min(0).max(1).catch(0), roleSource: photoRoleSource.catch("model") });
const prepDetails = z.object({
  photoIndexes: z.array(z.number().int()).catch([]),
  modelPhotoIndexes: z.array(z.number().int()).catch([]),
  careSymbols: z.array(z.string()).catch([]),
  tapeVisible: z.boolean().catch(false),
  sizeReference: z.object({ brand: z.string(), reference: z.string(), size: z.string().nullable() }).nullable().catch(null),
}).partial();

function toPrepView(r: StudioPrepRecord): StudioPrepView {
  const fields = studioFields.safeParse(r.fields);
  const details = prepDetails.safeParse(r.details);
  const d = details.success ? details.data : {};
  const kind = garmentKind.safeParse(r.garment);
  return {
    prepId: r.id,
    batchId: r.batchId,
    articleGroup: r.articleGroup,
    status: r.status,
    itemId: r.itemId,
    garmentKind: kind.success ? kind.data : "other",
    category: r.category,
    fields: fields.success ? fields.data : EMPTY_FIELDS,
    measurements: parseList(r.measurements, namedMeasurementField),
    questions: parseList(r.questions, sellerQuestion),
    warnings: r.warnings,
    photos: parseList(r.photos, prepPhotoRow),
    photoIndexes: d.photoIndexes ?? [],
    modelPhotoIndexes: d.modelPhotoIndexes ?? [],
    careSymbols: d.careSymbols ?? [],
    tapeVisible: d.tapeVisible ?? false,
    sizeReference: d.sizeReference ?? null,
    simulated: r.simulated,
    shareMeasurements: r.shareMeasurements,
    validatedAt: r.validatedAt,
    listingGeneratedAt: r.listingGeneratedAt,
    createdAt: r.createdAt,
  };
}

export async function getPrep(ctx: OrgContext, prepId: string): Promise<StudioPrepView> {
  requireAction(ctx, "items.read");
  const row = await withOrg(ctx, (tx) => repos.studioPreps.byId(tx, prepId));
  if (!row) throw new AppError("not_found", "Préparation introuvable.", 404);
  return toPrepView(row);
}

export async function listPreps(ctx: OrgContext, opts: { batchId?: string; limit?: number } = {}): Promise<StudioPrepView[]> {
  requireAction(ctx, "items.read");
  return withOrg(ctx, async (tx) => (opts.batchId ? await repos.studioPreps.byBatch(tx, opts.batchId) : await repos.studioPreps.list(tx, opts.limit ?? 20)).map(toPrepView));
}

/** Brouillons jamais validés de plus de 30 jours (tâche de rétention du worker). */
export async function purgeStalePreps(services: Services, orgId: string, now: Date = services.now()): Promise<number> {
  const before = new Date(now.getTime() - STUDIO_PREP_DRAFT_RETENTION_DAYS * 86_400_000).toISOString();
  return services.db.withOrg(orgId, (tx) => repos.studioPreps.purgeDraftsBefore(tx, before));
}

// ---------------------------------------------------------------- validation par le vendeur

const answerText = (max: number) => z.string().trim().max(max).nullable().transform((v) => (v && v.length > 0 ? v : null));

export const studioPrepAnswers = z.object({
  /** Réponses du vendeur : une valeur (provenance « seller ») ou null (« inconnue », le champ reste vide). */
  fields: z.object({ brand: answerText(80).optional(), size: answerText(40).optional(), material: answerText(80).optional(), reference: answerText(80).optional() }).default({}),
  /** Mesures en cm saisies par le vendeur (provenance « seller ») ; null : la mesure reste vide. */
  measurements: z.record(measurementName, z.number().positive().max(300).nullable()).default({}),
  garmentKind: garmentKind.optional(),
  itemId: id.nullable().optional(),
  /**
   * « Partager anonymement la mesure » : les mesures validées (lues sur le ruban ou saisies), avec la marque,
   * la référence et la taille, enrichissent la base des références. Aucune donnée personnelle ni d'organisation.
   */
  shareMeasurements: z.boolean().default(false),
});
export type StudioPrepAnswers = z.input<typeof studioPrepAnswers>;

export interface ValidatePrepResult {
  prep: StudioPrepView;
  /** Partage anonyme des mesures : fait, ou la raison pour laquelle il n'a pas eu lieu. */
  shared: { done: boolean; reason: string | null };
}

const roundHalf = (v: number) => Math.round(v * 2) / 2;
const SIZE_FREE_KINDS: readonly GarmentKind[] = ["bag", "accessory"];

/**
 * Valide une préparation : chaque réponse du vendeur devient une valeur de provenance « seller » (ou un champ
 * volontairement vide) ; les questions auxquelles il a répondu disparaissent. Avec « partager anonymement la
 * mesure » coché, et seulement si la marque et la référence sont connues, les mesures validées (ruban ou
 * vendeur, jamais celles reprises de la base) enrichissent `size_references` (« seller_validated »), sans
 * jamais écraser une référence fournie par l'opérateur.
 */
export async function validatePrep(ctx: OrgContext, prepId: string, raw: unknown): Promise<ValidatePrepResult> {
  requireAction(ctx, "studio.generate");
  const parsed = studioPrepAnswers.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Réponses invalides", 400, parsed.error.flatten());
  const answers = parsed.data;
  return withOrg(ctx, async (tx) => {
    const row = await repos.studioPreps.lock(tx, prepId);
    if (!row) throw new AppError("not_found", "Préparation introuvable.", 404);
    if (answers.itemId) await repos.items.byId(tx, answers.itemId);
    const current = toPrepView(row);
    const answered = new Set<string>();
    const fields: StudioFields = { ...current.fields };
    for (const key of LABEL_FIELDS) {
      const v = answers.fields[key];
      if (v === undefined) continue;
      answered.add(key);
      fields[key] = v === null ? { value: null, source: null } : { value: v, source: "seller" };
    }
    const byName = new Map<MeasurementName, NamedMeasurementField>(current.measurements.map((m) => [m.name, m]));
    for (const [name, v] of Object.entries(answers.measurements) as [MeasurementName, number | null][]) {
      answered.add(name);
      byName.set(name, v === null ? { name, valueCm: null, source: null } : { name, valueCm: roundHalf(v), source: "seller" });
    }
    const order = new Map(MEASUREMENT_NAMES.map((n, i) => [n, i]));
    const measurements = [...byName.values()].sort((a, b) => order.get(a.name)! - order.get(b.name)!);
    for (const m of measurements) {
      if (!namedMeasurementField.safeParse(m).success) throw new AppError("validation", `Mesure ${m.name} invalide.`, 400);
    }
    const kind = answers.garmentKind ?? current.garmentKind;
    // Questions restantes : celles des champs auxquels le vendeur n'a pas répondu (une réponse « inconnue » n'est pas redemandée).
    const remaining = buildSellerQuestions(fields, measurements, kind, { tapeVisible: current.tapeVisible }).filter((q) => !answered.has(q.field));
    // Une lecture peu sûre (0,5 à 0,7) ou un désaccord entre deux sources ne se valide pas en silence : le vendeur
    // confirme la valeur (elle devient « seller ») ou la corrige ; sinon la validation est refusée et dit quels champs.
    const unconfirmed = remaining.filter((q) => q.reason === "low_confidence" || q.reason === "conflict");
    if (unconfirmed.length > 0) {
      const labels = unconfirmed.map((q) => (isLabelField(q.field) ? LABEL_FIELD_LABELS[q.field] : MEASUREMENT_LABELS[q.field as MeasurementName]).toLowerCase());
      throw new AppError("prep_unconfirmed", `Confirmez d'abord ${labels.join(", ")} : lecture peu sûre ou en désaccord avec une autre source. Répondez à la question (confirmez la valeur ou corrigez-la) avant de générer.`, 409, { fields: unconfirmed });
    }
    const validatedAt = nowIso(ctx);
    const updated = await repos.studioPreps.update(tx, prepId, {
      status: "validated",
      validatedAt,
      fields,
      measurements,
      questions: remaining,
      garment: kind,
      shareMeasurements: answers.shareMeasurements,
      ...(answers.itemId !== undefined ? { itemId: answers.itemId } : {}),
    });

    let shared: ValidatePrepResult["shared"] = { done: false, reason: null };
    if (answers.shareMeasurements) {
      const brand = fields.brand.value;
      const reference = fields.reference.value;
      const sizeFree = SIZE_FREE_KINDS.includes(kind);
      const size = sizeFree ? null : fields.size.value;
      const values = shareableMeasurements(measurements, remaining);
      const checkedValues = measurementValues.safeParse(values);
      const blocker = brand && reference ? shareBlocker(brand, reference) : null;
      if (!brand || !reference) shared = { done: false, reason: "Marque et référence nécessaires pour partager une mesure." };
      else if (blocker) shared = { done: false, reason: blocker };
      else if (!sizeFree && !size) shared = { done: false, reason: "Taille nécessaire : les mesures d'un vêtement dépendent de sa taille." };
      else if (!checkedValues.success || Object.keys(checkedValues.data).length === 0) shared = { done: false, reason: "Aucune mesure confirmée à partager (saisie par vous, ou lue sur le ruban avec certitude)." };
      else {
        // Le partage est facultatif : un refus de la base partagée ne doit jamais annuler la validation (point de
        // reprise dans la transaction), il devient une raison rendue au vendeur.
        await tx.query("savepoint studio_share");
        try {
          const stored = await repos.sizeReferences.contribute(tx, { brand, reference, size, category: kind, measurements: checkedValues.data as Record<string, number> });
          await tx.query("release savepoint studio_share");
          shared = stored ? { done: true, reason: null } : { done: false, reason: "Cette référence est déjà fournie par Selio : elle n'est pas modifiée." };
          // Journal de l'organisation : ce qui a été partagé (jamais d'identité dans la base partagée).
          if (stored) await repos.audit.add(tx, { actorUserId: ctx.userId, action: "studio.measurements_shared", targetType: "studio_prep", targetId: prepId, meta: { brand, reference, size, names: Object.keys(checkedValues.data) }, ip: ctx.ip });
        } catch {
          await tx.query("rollback to savepoint studio_share");
          shared = { done: false, reason: "La base des références a refusé cette ligne (référence, taille ou mesure hors de ses règles) : rien n'est partagé." };
        }
      }
    }
    return { prep: toPrepView(updated), shared };
  });
}

const isLabelField = (f: string): f is LabelFieldName => (LABEL_FIELDS as readonly string[]).includes(f);

/**
 * Mesures qu'un vendeur peut partager avec la base des références : saisies par lui, ou lues sur le mètre ruban
 * avec certitude (≥ 0,7) ; jamais une lecture « à confirmer », une mesure encore en question (conflit), ni une
 * mesure reprise de la base. Les mesures validées par d'autres vendeurs sont « premier arrivé » (STUDIO.md §5.4).
 */
export function shareableMeasurements(measurements: readonly NamedMeasurementField[], remaining: readonly SellerQuestion[]): Record<string, number> {
  const open = new Set<string>(remaining.map((q) => q.field));
  return Object.fromEntries(
    measurements
      .filter((m) => m.valueCm !== null && !open.has(m.name) && (m.source === "seller" || (m.source === "tape_photo" && (m.confidence ?? 0) >= STUDIO_TRUSTED_CONFIDENCE)))
      .map((m) => [m.name, m.valueCm!]),
  );
}

/** Mêmes règles que `size_references` (migration 0014) : marque avec ≥ 1 lettre ou chiffre, référence avec ≥ 2 ; sinon la raison. */
export function shareBlocker(brand: string, reference: string): string | null {
  if (brand.replace(/[^\p{L}\p{N}]/gu, "").length < 1) return "Marque trop courte pour la base des références (une lettre ou un chiffre au moins).";
  if (reference.replace(/[^A-Za-z0-9]/g, "").length < 2) return "Référence trop courte pour la base des références (deux lettres ou chiffres au moins).";
  return null;
}

// ---------------------------------------------------------------- base des références (opérateur)

/** Ajoute ou remplace une référence de tailles fournie par Selio (opérateur seulement). */
export async function provideSizeReference(ctx: OrgContext, raw: unknown): Promise<SizeReferenceRecord> {
  if (!ctx.isOperator) throw new AppError("forbidden", "Réservé à l'opérateur Selio.", 403);
  const parsed = sizeReference.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Référence invalide", 400, parsed.error.flatten());
  const r = parsed.data;
  if (Object.keys(r.measurements).length === 0) throw new AppError("validation", "Au moins une mesure est nécessaire.", 400);
  return ctx.services.db.withGlobal((g) => repos.sizeReferences.provide(g, { brand: r.brand, reference: r.reference, size: r.size, category: r.category, measurements: r.measurements as Record<string, number> }));
}

export async function listSizeReferences(ctx: OrgContext, opts: { brand?: string; limit?: number } = {}): Promise<SizeReferenceRecord[]> {
  requireAction(ctx, "items.read");
  return ctx.services.db.withGlobal((g) => repos.sizeReferences.list(g, opts));
}

// ---------------------------------------------------------------- génération de l'annonce

const fromPrepInput = z.object({
  prepId: id,
  /** Photos réduites de l'article (mêmes identifiants qu'à la préparation) ; sinon lues par leur clé de stockage. */
  photos: z.array(generatorPhoto).max(STUDIO_RECEIVED_MAX_PHOTOS).default([]),
  connectionId: id.nullable().default(null),
  hints: z.object({ notes: z.string().trim().max(500).optional(), purchasePriceCents: nonNegCents.optional() }).default({}),
});
export type GenerateFromPrepInput = z.input<typeof fromPrepInput>;

export type StudioListingDraft = ListingDraft & {
  pricing: PriceEstimate | null;
  /** Préparation utilisée : champs et mesures avec provenance, repris sans relecture par le modèle. */
  prepId?: string;
  fields?: StudioFields;
  measurements?: NamedMeasurementField[];
};

interface GenerationPlan {
  images: string[];
  fileNames: string[];
  hints: { brand?: string; size?: string; notes?: string };
  photoCount: number;
  purchase: number | null;
  usageMeta: Record<string, unknown>;
  fallback: () => ListingGenerationOutput;
  /** Ajuste la sortie du modèle (préparation : marque, taille, matière et mesures imposées). */
  adjust?: (data: ListingGenerationOutput) => { data: ListingGenerationOutput; warnings: string[] };
  extra?: Pick<StudioListingDraft, "prepId" | "fields" | "measurements">;
  prepId?: string;
}

/**
 * Générateur d'annonces : photos → annonce rédigée par le modèle (Ollama, modèle de vision si configuré),
 * prix conseillé par l'estimation des prix (§5.10 : comparables et modèle de prix, trois stratégies,
 * explication en mots par mon IA perso ; le prix plancher et le prix d'achat sont gardés). Avec `prepId`,
 * les champs validés de la préparation sont repris tels quels (rien n'est relu). Rien n'est publié ici :
 * l'utilisateur relit puis enregistre en brouillon ou met en vente.
 */
export async function generateListing(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<StudioListingDraft> {
  requireAction(ctx, "studio.generate");
  if (raw && typeof raw === "object" && (raw as { prepId?: unknown }).prepId !== undefined && (raw as { prepId?: unknown }).prepId !== null) return generateFromPrep(ctx, raw, signal);
  const parsed = listingGenerationInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const org = await loadOrg(ctx);
  const { photos, hints } = parsed.data;
  // Jamais 12 photos en pleine taille : les 6 premières au plus (la première est la couverture), vérifiées et
  // réduites si besoin. Une image dont les dimensions ne se lisent pas passe telle quelle (compatibilité).
  const selected = photos.slice(0, STUDIO_MODEL_MAX_PHOTOS);
  const images: string[] = [];
  for (const p of selected) {
    const src = dataUrlBytes(p.url);
    images.push((await checkStudioPhoto(ctx.services, p.id, src.data, src.contentType, { lenient: true })).base64);
  }
  const warnings = photos.length > selected.length ? [`${selected.length} photos sur ${photos.length} envoyées au modèle (${STUDIO_MODEL_MAX_PHOTOS} au plus par appel).`] : [];
  return runGeneration(ctx, org, {
    images,
    fileNames: selected.map((p) => p.alt),
    hints: { brand: hints.brand, size: hints.size, notes: hints.notes },
    photoCount: photos.length,
    purchase: hints.purchasePriceCents ?? null,
    usageMeta: { photos: photos.length },
    fallback: () => ({ title: [hints.brand, "Article", hints.size].filter(Boolean).join(" ") || "Article", description: "Article d'occasion en bon état. Complétez la marque, la taille et les mesures. Envoi soigné sous 48 h.", brand: hints.brand ?? null, category: "other", size: hints.size ?? null, condition: "good", colors: [], material: null, hashtags: [], confidence: 0.2 }),
    adjust: (data) => ({ data, warnings }),
  }, signal);
}

const DESCRIPTION_ROLE_ORDER: readonly PhotoRole[] = ["front", "back", "detail", "defect", "other"];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cmLabel = (v: number) => `${String(v).replace(".", ",")} cm`;
/** Nettoie la ponctuation laissée par le retrait d'un mot (« , . », « () », doubles espaces), sans toucher aux paragraphes. */
const tidyText = (s: string) => s.replace(/\(\s*\)/g, "").replace(/\s*,\s*(?=[.;!?,])/g, "").replace(/[ \t]{2,}/g, " ").trim();

/** « Mesures à plat : poitrine 52 cm, longueur 70 cm. » (valeurs avec provenance seulement), ou "". */
export function measurementsSentence(measurements: readonly NamedMeasurementField[]): string {
  const known = measurements.filter((m) => m.valueCm !== null && m.source !== null);
  if (known.length === 0) return "";
  return `Mesures à plat : ${known.map((m) => `${MEASUREMENT_LABELS[m.name].toLowerCase()} ${cmLabel(m.valueCm!)}`).join(", ")}.`;
}

async function generateFromPrep(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<StudioListingDraft> {
  const parsed = fromPrepInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  const row = await withOrg(ctx, (tx) => repos.studioPreps.byId(tx, input.prepId));
  if (!row) throw new AppError("not_found", "Préparation introuvable.", 404);
  const prep = toPrepView(row);
  if (prep.status !== "validated") throw new AppError("prep_not_validated", "Validez d'abord la marque, la taille et les mesures de la préparation.", 409);
  const org = await loadOrg(ctx);

  // Photos pour la description : face, dos, détails, défauts (4 au plus). L'étiquette et le mètre ne sont pas relus.
  const byId = new Map(input.photos.map((p) => [p.id, p]));
  const candidates = prep.photos
    .filter((p) => p.role !== "label" && p.role !== "tape")
    .sort((a, b) => DESCRIPTION_ROLE_ORDER.indexOf(a.role) - DESCRIPTION_ROLE_ORDER.indexOf(b.role) || a.index - b.index)
    .slice(0, STUDIO_DESCRIPTION_MAX_PHOTOS);
  const images: string[] = [];
  const warnings: string[] = [];
  for (const p of candidates) {
    const sent = byId.get(p.id);
    const src = sent ? dataUrlBytes(sent.url) : p.key && ctx.services.studio?.photos ? await readStoredPhoto(ctx, p.id, p.key) : null;
    if (!src) continue;
    images.push((await checkStudioPhoto(ctx.services, p.id, src.data, src.contentType)).base64);
  }
  if (candidates.length > 0 && images.length === 0) warnings.push("Photos de l'article non renvoyées : la description est rédigée à partir des champs validés seulement.");

  const f = prep.fields;
  const measuresText = measurementsSentence(prep.measurements);
  const facts = [
    f.material.value ? `Matière (${f.material.source === "label" ? "lue sur l'étiquette" : "indiquée par le vendeur"}) : ${f.material.value}.` : "",
    measuresText,
    !f.brand.value ? "Marque inconnue : n'en cite aucune." : "",
    !f.size.value ? "Taille inconnue : n'en cite aucune." : "",
    !f.material.value ? "Matière inconnue : n'en cite aucune." : "",
    measuresText ? "" : "Aucune mesure connue : n'en cite aucune.",
    input.hints.notes ?? "",
  ].filter(Boolean).join(" ").slice(0, 500);

  return runGeneration(ctx, org, {
    images,
    fileNames: [],
    hints: { brand: f.brand.value ?? undefined, size: f.size.value ?? undefined, notes: facts || undefined },
    photoCount: prep.photos.length,
    purchase: input.hints.purchasePriceCents ?? null,
    usageMeta: { photos: images.length, prepId: prep.prepId },
    prepId: prep.prepId,
    fallback: () => ({ title: [f.brand.value, "Article", f.size.value].filter(Boolean).join(" ") || "Article", description: `Article d'occasion. ${measuresText} Envoi soigné sous 48 h.`.replace(/\s+/g, " ").trim(), brand: f.brand.value, category: prep.category ?? "other", size: f.size.value, condition: "good", colors: [], material: f.material.value, hashtags: [], confidence: 0.2 }),
    adjust: (data) => {
      const w = [...warnings];
      let title = data.title;
      let description = data.description;
      // Marque et taille : celles de la préparation (étiquette ou vendeur), jamais celles « vues » par le modèle.
      if (!f.brand.value && data.brand && data.brand.trim().length >= 2) {
        const re = new RegExp(`\\s*\\b${escapeRe(data.brand.trim())}\\b`, "gi");
        if (re.test(title) || re.test(description)) w.push(`Marque « ${data.brand.trim()} » retirée : elle n'a pas été lue sur l'étiquette ni indiquée.`);
        title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
        description = description.replace(re, "").replace(/\s{2,}/g, " ").trim();
      }
      if (!f.size.value && data.size) {
        const re = new RegExp(`\\s*\\btaille\\s+${escapeRe(data.size.trim())}\\b`, "gi");
        title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
        description = description.replace(re, "").replace(/\s{2,}/g, " ").trim();
      }
      // Matière : celle de la préparation (étiquette ou vendeur) ; une matière « vue » par le modèle sans étiquette lue
      // est retirée du texte (jamais déduite de l'aspect).
      if (!f.material.value && data.material && data.material.trim().length >= 3) {
        const re = new RegExp(`\\s*\\b(?:en\\s+)?${escapeRe(data.material.trim())}\\b`, "gi");
        if (re.test(title) || re.test(description)) w.push(`Matière « ${data.material.trim()} » retirée : elle n'a pas été lue sur l'étiquette ni indiquée.`);
        title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
        description = description.replace(re, "").replace(/\s{2,}/g, " ").trim();
      }
      title = tidyText(title);
      description = tidyText(description);
      // Mesures : seules celles de la préparation (avec provenance). Toute autre valeur en cm écrite par le modèle est
      // une mesure inventée : retirée du titre, et la phrase qui la cite retirée de la description.
      const allowed = prep.measurements.filter((m) => m.valueCm !== null && m.source !== null).map((m) => m.valueCm!);
      const strippedTitle = stripUnknownMeasurements(title, allowed, "title");
      const strippedDescription = stripUnknownMeasurements(description, allowed, "description");
      title = strippedTitle.text;
      description = strippedDescription.text;
      const invented = [...new Set([...strippedTitle.removed, ...strippedDescription.removed])];
      if (invented.length > 0) w.push(`Mesure${invented.length > 1 ? "s" : ""} inventée${invented.length > 1 ? "s" : ""} par le modèle retirée${invented.length > 1 ? "s" : ""} (${invented.map(cmLabel).join(", ")}) : seules les mesures de la préparation sont citées.`);
      if (title.length < 3) title = [f.brand.value, "Article", f.size.value].filter(Boolean).join(" ") || "Article";
      if (description.length < 20) description = `Article d'occasion. ${measuresText} Envoi soigné sous 48 h.`.replace(/\s+/g, " ").trim();
      if (measuresText && !description.includes(measuresText)) description = `${description}\n\n${measuresText}`.slice(0, 2000);
      for (const key of ["brand", "size"] as LabelFieldName[]) if (!f[key].value) w.push(key === "brand" ? "Marque inconnue : à compléter avant de publier." : "Taille inconnue : à compléter avant de publier.");
      return { data: { ...data, title: title.slice(0, 100), description, brand: f.brand.value, size: f.size.value, material: f.material.value }, warnings: w };
    },
    extra: { prepId: prep.prepId, fields: prep.fields, measurements: prep.measurements },
  }, signal);
}

async function runGeneration(ctx: OrgContext, org: Organization, plan: GenerationPlan, signal?: AbortSignal): Promise<StudioListingDraft> {
  const req = await studioGate(ctx, org);
  const started = Date.now();
  let result;
  try {
    result = await ctx.services.ai.generateListing(ctx.orgId, { images: plan.images, fileNames: plan.fileNames, hints: plan.hints }, { signal, allowFallback: ctx.services.allowAiFallback, fallback: plan.fallback });
  } catch (err) {
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: aiStatusOf(err), error: (err as Error).message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) }));
    const mapped = aiFailure(err, "Générateur");
    throw mapped.code === "ai_unavailable" ? new AppError("ai_unavailable", `Générateur indisponible (${err instanceof AIError ? err.code : "erreur"}). Vous pouvez créer l'annonce à la main.`, 503) : mapped;
  }
  const adjusted = plan.adjust ? plan.adjust(result.data) : { data: result.data, warnings: [] };
  const data = adjusted.data;
  // Prix (§5.10) : comparables et modèle de prix, trois stratégies, explication en mots par mon IA perso.
  // Jamais bloquant : sans estimation (panne, aucune référence), le calcul d'avant s'applique.
  const purchase = plan.purchase;
  const estimate = await pricing.estimate(ctx, {
    title: data.title, brand: data.brand, category: data.category, size: data.size, material: data.material,
    // Explication en mots seulement pour qui peut utiliser mon IA perso hors Studio (pas le contributeur photos).
    color: data.colors[0] ?? null, condition: data.condition, photoCount: plan.photoCount, explain: can(ctx.role, "ai.use"),
  }, { signal }).catch(() => null);
  return withOrg(ctx, async (tx) => {
    await repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, promptTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens, latencyMs: Math.max(result.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
    await repos.usage.record(tx, "ai.request", { requestId: req.id, kind: "listing_generation", source: result.source });
    // Compteur Studio : une annonce rédigée avec succès (la préparation n'est pas comptée).
    await repos.usage.record(tx, "studio.listing", { requestId: req.id, source: result.source, ...plan.usageMeta });
    if (plan.prepId) await repos.studioPreps.update(tx, plan.prepId, { listingGeneratedAt: nowIso(ctx) });
    const warnings = [...result.warnings, ...adjusted.warnings];
    let price: Omit<DraftPricing, "lowConfidence">;
    if (estimate && estimate.method !== "none" && estimate.strategies) {
      // Plancher : prix d'achat + marge minimale de l'organisation quand le prix d'achat est connu, 1 € sinon.
      const floor = purchase && purchase > 0 ? suggestFloorPrice({ purchasePriceCents: purchase, purchaseFeesCents: 0 }, org.settings.margin) : 100;
      const lift = (c: number) => Math.max(floor, c);
      const s = estimate.strategies;
      if (s.fast < floor || s.standard < floor) warnings.push(`Prix relevé au plancher (${(floor / 100).toFixed(2).replace(".", ",")} € : prix d'achat et marge minimale).`);
      price = { suggestedPriceCents: lift(s.standard), priceLowCents: lift(s.fast), priceHighCents: lift(s.max), priceMethod: PRICE_METHOD_LABELS[estimate.method], comparableCount: estimate.comparableCount };
      if (estimate.confidenceLevel === "low") warnings.push("Peu de ventes comparables : le prix conseillé est une estimation prudente, ajustez-le.");
      if (estimate.demo) warnings.push("Le modèle de prix repose sur des données de démonstration.");
    } else {
      const items = await repos.items.all(tx);
      // Comparables : ventes réelles de l'organisation (les estimations du radar ne sont pas des ventes).
      const comps = comparablesFromSales(await repos.orders.all(tx), new Map(items.map((i) => [i.id, i])));
      const { lowConfidence, ...legacy } = priceListingDraft(data, comps, purchase);
      price = legacy;
      if (lowConfidence) warnings.push("Peu de ventes comparables : le prix conseillé est une estimation prudente, ajustez-le.");
    }
    const draft: StudioListingDraft = { ...data, ...price, source: result.source, provider: result.provider, model: result.model, latencyMs: result.latencyMs, simulated: result.provider === "mock", warnings, pricing: estimate, ...(plan.extra ?? {}) };
    return draft;
  });
}
