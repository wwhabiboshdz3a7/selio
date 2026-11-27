import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { detectFileType } from "@selio/domain";
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES, parseObjectKey, type StorageClient } from "@selio/storage";

/**
 * Stockage LOCAL des photos (sans S3) : l'API reçoit et sert les fichiers elle-même, sous `/api/storage/<clé>`,
 * derrière le même relais que le reste de l'API (Netlify → Tailscale → API). Chaque lien est signé par HMAC
 * et daté (`STORAGE_PRESIGN_TTL_SECONDS`), comme une URL S3 signée : un envoi impose le type et la taille
 * annoncés, une lecture n'ouvre qu'une clé précise. Aucune session n'est demandée (le lien suffit), aucune
 * liste du dossier n'est possible. Le contenu envoyé est vérifié (vrai type d'image, taille exacte).
 */

const CONTENT_TYPE_OF_EXT: Record<string, string> = Object.fromEntries(Object.entries(ALLOWED_CONTENT_TYPES).map(([type, ext]) => [ext, type]));

type StorageRequest = FastifyRequest<{ Params: { "*": string }; Querystring: { expires?: string; signature?: string } }>;

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

function keyOf(req: StorageRequest): string | null {
  let key: string;
  try {
    key = decodeURIComponent(req.params["*"] ?? "");
  } catch {
    return null;
  }
  return parseObjectKey(key) ? key : null;
}

export default async function storageLocalRoutes(app: FastifyInstance, opts: { storage: StorageClient | null }) {
  const storage = opts.storage;
  if (!storage || !storage.isLocal) return;

  // Corps binaire des photos (jpeg, png, webp) : tampon borné à la taille maximale d'un envoi.
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));

  app.put("/api/storage/*", { bodyLimit: MAX_UPLOAD_BYTES }, async (req: StorageRequest, reply) => {
    const key = keyOf(req);
    if (!key) return fail(reply, 404, "not_found", "Photo introuvable.");
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) return fail(reply, 400, "upload_rejected", "Fichier vide : choisissez une autre photo.");
    const check = storage.verifyLocal({ method: "PUT", key, expires: req.query.expires, signature: req.query.signature, contentType, contentLength: body.length });
    if (!check.ok) return fail(reply, 403, check.reason === "expired" ? "link_expired" : "forbidden", check.reason === "expired" ? "Le lien d'envoi a expiré : recommencez l'envoi de la photo." : "Lien d'envoi invalide.");
    const real = detectFileType(new Uint8Array(body.subarray(0, 64)));
    if (real !== "image/jpeg" && real !== "image/png" && real !== "image/webp") return fail(reply, 415, "upload_rejected", "Ce fichier n'est pas une photo JPEG, PNG ou WebP lisible.");
    const path = storage.localPath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Écriture atomique : un fichier à moitié écrit n'est jamais servi.
    const tmp = `${path}.${process.pid}.${Date.now()}.part`;
    try {
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    return reply.status(200).send({ ok: true });
  });

  app.get("/api/storage/*", async (req: StorageRequest, reply) => {
    const key = keyOf(req);
    if (!key) return fail(reply, 404, "not_found", "Photo introuvable.");
    const check = storage.verifyLocal({ method: "GET", key, expires: req.query.expires, signature: req.query.signature });
    if (!check.ok) return fail(reply, 403, check.reason === "expired" ? "link_expired" : "forbidden", check.reason === "expired" ? "Le lien de la photo a expiré : rechargez la page." : "Lien de photo invalide.");
    const path = storage.localPath(key);
    let size: number;
    try {
      const st = await stat(path);
      if (!st.isFile()) return fail(reply, 404, "not_found", "Photo introuvable.");
      size = st.size;
    } catch {
      return fail(reply, 404, "not_found", "Photo introuvable.");
    }
    const ext = parseObjectKey(key)!.ext;
    reply.header("content-type", CONTENT_TYPE_OF_EXT[ext] ?? "application/octet-stream");
    reply.header("content-length", String(size));
    reply.header("cache-control", "private, max-age=300");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-disposition", "inline");
    return reply.send(createReadStream(path));
  });
}
