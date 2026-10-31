import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repos } from "@selio/db";
import { newId } from "@selio/domain";
import { AppError, requireAction, withOrg } from "@selio/core";
import { MAX_UPLOAD_BYTES, UPLOAD_KINDS, keyBelongsToOrg, objectKey, validateUpload, type StorageClient, type UploadKind } from "@selio/storage";

/**
 * Téléversement des photos vers le stockage objet (S3 / MinIO) par URLs
 * signées : le navigateur n'envoie jamais le fichier à l'API, il reçoit une
 * URL PUT signée (type et taille imposés par la signature) puis lit la photo
 * par une URL GET signée, courte. Aucune URL publique.
 */

const presignBody = z.object({
  kind: z.string().min(1).max(32),
  contentType: z.string().min(1).max(128),
  size: z.number().int().positive().max(1024 * 1024 * 1024),
});

const readQuery = z.object({ key: z.string().min(1).max(512) });

export const UPLOAD_PRESIGN_RATE_LIMIT = { max: 60, timeWindow: "1 minute" } as const;

/** Qui peut téléverser quoi : photos d'articles et du générateur = rôle opérateur ; avatar = tout membre connecté. */
function requireUploadRight(ctx: Parameters<typeof requireAction>[0], kind: UploadKind): void {
  if (kind !== "avatar") requireAction(ctx, "items.write");
}

export default async function uploadsRoutes(app: FastifyInstance, opts: { storage: StorageClient | null }) {
  function storageOrUnavailable(): StorageClient {
    if (!opts.storage) throw new AppError("storage_unconfigured", "Le stockage des photos n'est pas configuré sur ce serveur (STORAGE_ENDPOINT absent).", 503);
    return opts.storage;
  }

  /** Politique du téléversement, lisible par le client avant de choisir un fichier. */
  app.get("/api/uploads/policy", async (req) => {
    app.requireCtx(req);
    return { configured: opts.storage !== null, kinds: UPLOAD_KINDS, contentTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: MAX_UPLOAD_BYTES };
  });

  app.post("/api/uploads/presign", { config: { rateLimit: UPLOAD_PRESIGN_RATE_LIMIT } }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    const storage = storageOrUnavailable();
    const body = presignBody.parse(req.body);
    const verdict = validateUpload(body.kind, body.contentType, body.size);
    if (!verdict.ok) throw new AppError("upload_rejected", verdict.message, 400, { reason: verdict.reason });
    const kind = body.kind as UploadKind;
    requireUploadRight(ctx, kind);

    const id = newId();
    const key = objectKey(ctx.orgId, kind, id, verdict.extension);
    const contentType = body.contentType.split(";")[0]!.trim().toLowerCase();
    const upload = storage.presignUpload({ key, contentType, contentLength: body.size });
    const read = storage.presignDownload({ key });

    await withOrg(ctx, (tx) =>
      repos.audit.add(tx, { actorUserId: ctx.userId, action: "upload.presigned", targetType: "storage_object", targetId: id, meta: { key, kind, size: body.size, contentType }, ip: ctx.ip }),
    );

    reply.status(201);
    return { key, uploadUrl: upload.url, method: upload.method, headers: upload.headers, readUrl: read.url, expiresAt: upload.expiresAt };
  });

  app.get("/api/uploads/read", async (req) => {
    const ctx = app.requireCtx(req);
    const storage = storageOrUnavailable();
    const { key } = readQuery.parse(req.query);
    // Seules les clés du préfixe de l'organisation de la session sont lisibles : une clé d'une autre
    // organisation (ou mal formée) est refusée sans révéler si elle existe.
    if (!keyBelongsToOrg(key, ctx.orgId)) throw new AppError("forbidden", "Cette photo n'appartient pas à votre organisation.", 403);
    const read = storage.presignDownload({ key });
    return { url: read.url, expiresAt: read.expiresAt };
  });
}
