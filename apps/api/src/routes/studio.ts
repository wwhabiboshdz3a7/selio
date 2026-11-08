import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { STUDIO_ACCURACY_TARGETS, STUDIO_ACCURACY_TO_MEASURE_LABEL, STUDIO_LABEL_MAX_PHOTOS, STUDIO_MAX_PHOTOS, STUDIO_MODEL_JPEG_QUALITY, STUDIO_MODEL_MAX_BYTES, STUDIO_MODEL_MAX_PHOTOS, STUDIO_MODEL_MAX_SIDE_PX, STUDIO_TAPE_MAX_PHOTOS, quotasForPlan } from "@selio/contracts";
import { checkImageDimensions } from "@selio/domain";
import { repos } from "@selio/db";
import { AppError, dressing, items, market, requireAction, studio, studioVisionOf, withOrg, wornPhotos, type OrgContext, type Services } from "@selio/core";

/**
 * Selio Studio : préparation des annonces façon Kavis (§5.11), générateur d'annonces, photos portées,
 * dressing intelligent et analyse des revendeurs.
 *
 * Règles tenues ici, avant tout appel au modèle :
 * - 12 photos au plus par envoi (413 au-delà), chacune ≤ 1,5 Mo (413) et ≤ 1 600 px de côté long (422) ;
 *   une photo trop grande pour le modèle (> 1 024 px ou > 1 Mo, aucun réducteur côté serveur) est refusée en
 *   422 sur TOUS les chemins, générateur historique compris (le serveur réduit ou refuse, il n'envoie jamais une
 *   photo en pleine taille) ; une photo illisible (ni JPEG, ni PNG, ni WebP) est refusée en 422, sauf par le
 *   générateur historique qui la tolère (compatibilité des anciens clients). Toutes les photos refusées sont
 *   listées d'un coup (`details.photos`), avec les limites (`details.limits`).
 * - Le modèle ne reçoit jamais plus de 6 photos par appel (tri), 2 pour l'étiquette, 3 pour le mètre ruban
 *   (le cœur découpe en lots).
 * - Rien n'est inventé : marque, taille, matière, référence et mesures portent leur provenance ou restent
 *   vides avec une question au vendeur ; la précision reste « à mesurer » tant qu'aucun rapport n'existe.
 */

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

/** Corps des envois de photos : 12 photos de 1,5 Mo au plus, en base64 (× 4/3), plus le reste de la demande. */
export const STUDIO_PHOTOS_BODY_LIMIT = Math.ceil((STUDIO_MAX_PHOTOS * studio.STUDIO_RECEIVED_MAX_BYTES * 4) / 3) + 1024 * 1024;

export type PhotoRejectReason = "too_heavy" | "too_large" | "needs_reduction" | "unreadable" | "missing" | "key";

export interface PhotoRejection {
  photoId: string;
  reason: PhotoRejectReason;
  bytes?: number;
  width?: number;
  height?: number;
}

/** Limites rappelées à chaque refus (et par GET /api/studio/limits). */
export const STUDIO_LIMITS = {
  maxPhotos: STUDIO_MAX_PHOTOS,
  maxBytes: studio.STUDIO_RECEIVED_MAX_BYTES,
  maxSidePx: studio.STUDIO_RECEIVED_MAX_SIDE_PX,
  modelMaxSidePx: STUDIO_MODEL_MAX_SIDE_PX,
  modelMaxBytes: STUDIO_MODEL_MAX_BYTES,
  modelJpegQuality: STUDIO_MODEL_JPEG_QUALITY,
  modelPhotosPerCall: STUDIO_MODEL_MAX_PHOTOS,
  labelPhotosPerCall: STUDIO_LABEL_MAX_PHOTOS,
  tapePhotosPerCall: STUDIO_TAPE_MAX_PHOTOS,
} as const;

/** Statut d'un refus de photo : trop lourde → 413, clé invalide → 400, sinon (dimensions, format, absente) → 422. */
export function photoRejectStatus(reasons: readonly (string | undefined)[]): 400 | 413 | 422 {
  if (reasons.includes("too_heavy")) return 413;
  if (reasons.length > 0 && reasons.every((r) => r === "key")) return 400;
  return 422;
}

/** « 1 600 » : séparateur des milliers français (espace insécable), indépendant de l'ICU du serveur. */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
const kbLabel = (n: number) => `${thousands(Math.round(n / 1000))} Ko`;
const REASON_TEXT: Record<PhotoRejectReason, string> = {
  too_heavy: `plus de ${kbLabel(studio.STUDIO_RECEIVED_MAX_BYTES)}`,
  too_large: `côté long au-delà de ${thousands(studio.STUDIO_RECEIVED_MAX_SIDE_PX)} px`,
  needs_reduction: `au-delà de ${thousands(STUDIO_MODEL_MAX_SIDE_PX)} px ou ${kbLabel(STUDIO_MODEL_MAX_BYTES)} pour le modèle (aucune réduction côté serveur)`,
  unreadable: "format illisible (JPEG, PNG ou WebP attendu)",
  missing: "introuvable dans le stockage",
  key: "clé de stockage invalide",
};

function rejectionError(rejections: PhotoRejection[]): AppError {
  const byReason = new Map<PhotoRejectReason, string[]>();
  for (const r of rejections) byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r.photoId]);
  const parts = [...byReason].map(([reason, ids]) => `${REASON_TEXT[reason]} (${ids.length > 4 ? `${ids.slice(0, 4).join(", ")}… ${ids.length} photos` : ids.join(", ")})`);
  const message = `${rejections.length > 1 ? `${rejections.length} photos refusées` : "Photo refusée"} : ${parts.join(" ; ")}. Jamais de photo en pleine taille : réduisez-les à ${thousands(STUDIO_MODEL_MAX_SIDE_PX)} px de côté long (JPEG qualité ${Math.round(STUDIO_MODEL_JPEG_QUALITY * 100)}) avant l'envoi.`;
  const first = rejections[0]!;
  return new AppError("photo_rejected", message, photoRejectStatus(rejections.map((r) => r.reason)), { ...first, photos: rejections, limits: STUDIO_LIMITS });
}

/** Refus d'une photo par le cœur (une à la fois) → même forme et statut explicite (413 / 422 / 400). */
function explicitPhotoError(err: unknown): unknown {
  if (!(err instanceof AppError) || err.code !== "photo_rejected") return err;
  const d = (err.details && typeof err.details === "object" ? err.details : {}) as Record<string, unknown>;
  if (Array.isArray(d.photos)) return err;
  const reason = typeof d.reason === "string" ? d.reason : undefined;
  const status = reason ? photoRejectStatus([reason]) : 422;
  return new AppError("photo_rejected", err.message, status, { ...d, ...(reason && typeof d.photoId === "string" ? { photos: [{ photoId: d.photoId, reason, ...(typeof d.width === "number" ? { width: d.width, height: d.height } : {}), ...(typeof d.bytes === "number" ? { bytes: d.bytes } : {}) }] } : {}), limits: STUDIO_LIMITS });
}

/** Octets d'une photo envoyée en data URL base64 (sans la décoder si elle est manifestement trop lourde). */
function inlineBytes(url: string, maxBytes: number): { bytes: number; data: Uint8Array | null } {
  const comma = url.indexOf(",");
  const body = comma >= 0 ? url.slice(comma + 1) : url;
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((body.length * 3) / 4) - padding);
  if (bytes > maxBytes) return { bytes, data: null };
  const data = new Uint8Array(Buffer.from(body, "base64"));
  return { bytes: data.length, data };
}

/**
 * Contrôle de TOUTES les photos envoyées avant d'appeler le cœur (qui s'arrête à la première) : nombre, poids,
 * dimensions lues dans les en-têtes. Sans réducteur serveur, une image lisible au-delà de ce que le modèle accepte
 * (> 1 024 px ou > 1 Mo) est refusée sur tous les chemins (`needs_reduction`). `strict` (préparation, génération
 * depuis une préparation) refuse aussi une image illisible ; le générateur historique (`strict: false`) garde une
 * image dont les dimensions ne se lisent pas (compatibilité des anciens clients, dont la PWA se met à jour seule).
 */
export function precheckStudioPhotos(body: unknown, opts: { strict: boolean; reducer: boolean }): void {
  const photos = body && typeof body === "object" ? (body as { photos?: unknown }).photos : undefined;
  if (!Array.isArray(photos)) return; // le schéma du cœur répond 400
  if (photos.length > STUDIO_MAX_PHOTOS) {
    throw new AppError("too_many_photos", `${photos.length} photos envoyées : ${STUDIO_MAX_PHOTOS} au plus par envoi (le modèle n'en reçoit jamais plus de ${STUDIO_MODEL_MAX_PHOTOS} à la fois).`, 413, { received: photos.length, limits: STUDIO_LIMITS });
  }
  const rejections: PhotoRejection[] = [];
  photos.forEach((p, i) => {
    if (!p || typeof p !== "object") return;
    const photo = p as { id?: unknown; url?: unknown };
    if (typeof photo.url !== "string" || !photo.url.startsWith("data:")) return;
    const photoId = typeof photo.id === "string" && photo.id ? photo.id.slice(0, 64) : String(i + 1);
    const { bytes, data } = inlineBytes(photo.url, studio.STUDIO_RECEIVED_MAX_BYTES);
    if (!data) return void rejections.push({ photoId, reason: "too_heavy", bytes });
    const info = checkImageDimensions(data);
    if (!info) {
      if (opts.strict) rejections.push({ photoId, reason: "unreadable", bytes });
      return;
    }
    const longSide = Math.max(info.width, info.height);
    if (longSide > studio.STUDIO_RECEIVED_MAX_SIDE_PX) return void rejections.push({ photoId, reason: "too_large", bytes, width: info.width, height: info.height });
    if (!opts.reducer && (longSide > STUDIO_MODEL_MAX_SIDE_PX || bytes > STUDIO_MODEL_MAX_BYTES)) rejections.push({ photoId, reason: "needs_reduction", bytes, width: info.width, height: info.height });
  });
  if (rejections.length > 0) throw rejectionError(rejections);
}

const listQuery = z.object({
  batchId: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const wornListQuery = z.object({
  itemId: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/** Quota des photos portées du mois, réglages (dépassement, file de nuit) et fournisseur : ce que l'écran affiche. */
async function wornOverview(ctx: OrgContext, services: Services) {
  const settings = wornPhotos.wornSettings(services);
  const now = services.now();
  const { quota, used } = await withOrg(ctx, async (tx) => {
    const sub = await repos.subscriptions.get(tx);
    return { quota: (sub?.quotas ?? quotasForPlan("free")).wornPhotosPerMonth, used: await repos.usage.sumKindSince(tx, "studio.worn_photo", monthStart(now)) };
  });
  const next = wornPhotos.nextNightWindow(now, settings.window.timezone, settings.window);
  const provider = services.wornPhotos?.name ?? "noop";
  return {
    quota: { used, quota, remaining: Math.max(0, quota - used) },
    provider: {
      name: provider,
      configured: provider !== "noop",
      ...(provider === "noop" ? { message: `Photos portées : ${wornPhotos.NO_WORN_PROVIDER_MESSAGE}.` } : {}),
    },
    // 0,25 € la photo au-delà du quota : PROPOSITION (prix à décider), seulement si le réglage est ouvert.
    overage: { enabled: settings.overageEnabled, unitCents: settings.overageUnitCents, proposal: true },
    nightWindow: { startHour: settings.window.startHour, endHour: settings.window.endHour, timezone: settings.window.timezone, nextStart: next.start.toISOString(), nextEnd: next.end.toISOString(), inWindow: next.inWindow },
  };
}

function abortOnClose(req: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  req.raw.on("close", () => { if (req.raw.destroyed) controller.abort(); });
  return controller.signal;
}

export default async function studioRoutes(app: FastifyInstance) {
  /** Limites des photos et état de la lecture (modèle de vision, OCR d'essai), précision « à mesurer ». */
  app.get("/api/studio/limits", async (req) => {
    app.requireCtx(req);
    const vision = studioVisionOf(app.services);
    return {
      ...STUDIO_LIMITS,
      vision: { available: !!vision && vision.canSeeImages, simulated: vision?.simulated ?? false, ocrConfigured: vision?.ocrConfigured ?? false },
      serverReduction: !!app.services.studio?.reducer,
      accuracy: { status: "to_measure", label: STUDIO_ACCURACY_TO_MEASURE_LABEL, targets: STUDIO_ACCURACY_TARGETS },
    };
  });

  /**
   * Préparation (Studio façon Kavis) : tri des photos par article, étiquette, mètre ruban, base des références,
   * provenance de chaque valeur et questions au vendeur. Une préparation par article (sans image) ; rien n'est
   * compté dans le quota Studio (seulement une requête IA).
   */
  app.post("/api/studio/prepare", { bodyLimit: STUDIO_PHOTOS_BODY_LIMIT, config: perUser("studio-prepare", 10, "1 minute") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    // Générateur : titulaire, administrateur, exécuteur et contributeur photos (« studio.generate »).
    requireAction(ctx, "studio.generate");
    precheckStudioPhotos(req.body, { strict: true, reducer: !!app.services.studio?.reducer });
    try {
      const prep = await studio.prepareListing(ctx, req.body, abortOnClose(req));
      reply.status(201);
      return prep;
    } catch (err) {
      throw explicitPhotoError(err);
    }
  });

  app.get("/api/studio/preps", async (req) => {
    const ctx = app.requireCtx(req);
    const q = listQuery.parse(req.query ?? {});
    return studio.listPreps(ctx, q);
  });

  app.get<{ Params: { id: string } }>("/api/studio/preps/:id", async (req) => studio.getPrep(app.requireCtx(req), req.params.id));

  /** Réponses du vendeur (provenance « seller ») ; « partager anonymement la mesure » enrichit la base des références. */
  app.post<{ Params: { id: string } }>("/api/studio/preps/:id/validate", { config: perUser("studio-validate", 60, "1 minute") }, async (req) => studio.validatePrep(app.requireCtx(req), req.params.id, req.body ?? {}));

  /**
   * Générateur d'annonces : photos → annonce (une annonce = un « studio.listing »). Avec `prepId` (préparation
   * validée), marque, taille, matière et mesures viennent de la préparation, rien n'est relu.
   */
  app.post("/api/studio/generate", { bodyLimit: STUDIO_PHOTOS_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = app.requireCtx(req);
    const fromPrep = !!req.body && typeof req.body === "object" && (req.body as { prepId?: unknown }).prepId != null;
    precheckStudioPhotos(req.body, { strict: fromPrep, reducer: !!app.services.studio?.reducer });
    try {
      return await studio.generateListing(ctx, req.body, abortOnClose(req));
    } catch (err) {
      throw explicitPhotoError(err);
    }
  });

  /**
   * Brouillon de l'annonce générée (« studio.generate ») : article « en stock », sans prix d'achat, sans
   * plancher, sans compte Vinted, jamais publié. Seule écriture du stock ouverte au contributeur photos.
   */
  app.post("/api/studio/drafts", { bodyLimit: STUDIO_PHOTOS_BODY_LIMIT, config: perUser("studio-drafts", 30, "1 minute") }, async (req, reply) => {
    const item = await items.createStudioDraft(app.requireCtx(req), req.body ?? {});
    reply.status(201);
    return item;
  });

  // ---------------------------------------------------------------- photos portées

  /**
   * Demande d'une photo portée : mise en file pour la nuit (WORN_NIGHT_WINDOW), quota du plan, dépassement
   * seulement avec WORN_OVERAGE_ENABLED et l'accord explicite du client (`acceptOverage: true`), sinon 402.
   * Aucun fournisseur choisi : « noop » refuse proprement la nuit venue, quota rendu.
   */
  app.post("/api/studio/worn", { config: perUser("studio-worn", 30, "1 minute") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    const job = await wornPhotos.requestWornPhoto(ctx, req.body ?? {});
    reply.status(201);
    return job;
  });

  app.get("/api/studio/worn", async (req) => {
    const ctx = app.requireCtx(req);
    const q = wornListQuery.parse(req.query ?? {});
    const jobs = await wornPhotos.listWornPhotos(ctx, q);
    return { jobs, ...(await wornOverview(ctx, app.services)) };
  });

  /** Annule une demande encore en file : supprimée, place de quota rendue, jamais facturée (409 si déjà traitée). */
  app.delete<{ Params: { id: string } }>("/api/studio/worn/:id", async (req) => wornPhotos.cancelWornPhoto(app.requireCtx(req), req.params.id));

  // ---------------------------------------------------------------- dressing et marché

  app.get("/api/dressing", async (req) => dressing.getDressing(app.requireCtx(req), req.query as Record<string, unknown>));
  app.post<{ Params: { id: string } }>("/api/items/:id/republish", async (req) => dressing.republishItem(app.requireCtx(req), req.params.id, (req.body as { variantId?: unknown } | null)?.variantId));
  app.get("/api/market/insights", async (req) => market.getMarketInsights(app.requireCtx(req), req.query as Record<string, unknown>));
}
