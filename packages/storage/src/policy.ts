/**
 * Politique de téléversement : ce que l'API accepte avant de signer une URL.
 * Fonctions pures, sans accès réseau, testées à part.
 */

export const UPLOAD_KINDS = ["item-photo", "studio-photo", "avatar"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Types MIME acceptés et extension de clé correspondante (jamais celle du fichier de l'utilisateur). */
export const ALLOWED_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;
export type AllowedExtension = (typeof ALLOWED_CONTENT_TYPES)[AllowedContentType];

/** 5 Mo : les photos sont compressées côté navigateur avant l'envoi (~300 Ko). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type UploadRejection = "kind" | "content_type" | "size";

export type UploadValidation = { ok: true; extension: AllowedExtension; reason?: undefined } | { ok: false; reason: UploadRejection; message: string };

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === "string" && (UPLOAD_KINDS as readonly string[]).includes(value);
}

export function isAllowedContentType(value: unknown): value is AllowedContentType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ALLOWED_CONTENT_TYPES, value);
}

/** Normalise un type MIME tel qu'envoyé par un navigateur (« image/JPEG; charset=… » → « image/jpeg »). */
export function normalizeContentType(value: unknown): string {
  return typeof value === "string" ? (value.split(";")[0] ?? "").trim().toLowerCase() : "";
}

/** Extension de clé pour un type accepté. */
export function extensionFor(contentType: AllowedContentType): AllowedExtension {
  return ALLOWED_CONTENT_TYPES[contentType];
}

/**
 * Valide une demande de téléversement. `size` est la taille annoncée en
 * octets ; elle est ensuite imposée par la signature (Content-Length signé),
 * donc un client qui ment sur la taille voit son PUT refusé par le stockage.
 */
export function validateUpload(kind: unknown, contentType: unknown, size: unknown): UploadValidation {
  if (!isUploadKind(kind)) return { ok: false, reason: "kind", message: `Type d'envoi inconnu : attendu ${UPLOAD_KINDS.join(", ")}.` };
  const ct = normalizeContentType(contentType);
  if (!isAllowedContentType(ct)) return { ok: false, reason: "content_type", message: "Format refusé : seules les images JPEG, PNG et WebP sont acceptées." };
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return { ok: false, reason: "size", message: "Taille invalide : un nombre entier d'octets supérieur à zéro est attendu." };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: "size", message: `Fichier trop lourd : ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo au maximum.` };
  return { ok: true, extension: extensionFor(ct) };
}
