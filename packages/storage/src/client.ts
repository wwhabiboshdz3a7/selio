import type { StorageConfig } from "./config";
import { presignUrl, uriEncode } from "./sigv4";
import { isAllowedContentType, normalizeContentType, MAX_UPLOAD_BYTES } from "./policy";

export interface PresignUploadInput {
  key: string;
  contentType: string;
  contentLength: number;
  /** Durée de validité ; par défaut celle de la configuration. */
  ttlSeconds?: number;
}

export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** En-têtes que le navigateur doit envoyer tels quels : ils sont signés. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface PresignDownloadInput {
  key: string;
  ttlSeconds?: number;
}

export interface PresignedDownload {
  url: string;
  expiresAt: string;
}

/**
 * Client de stockage : ne parle jamais au service lui-même, il ne fait que
 * signer des URLs que le navigateur utilisera directement. Aucune URL
 * publique : tout accès passe par une signature courte.
 */
export class StorageClient {
  constructor(
    private readonly cfg: StorageConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get bucket(): string {
    return this.cfg.bucket;
  }

  /** URL de l'objet (sans signature), selon le style de chemin configuré. */
  objectUrl(key: string): URL {
    if (!key || key.startsWith("/")) throw new Error("Clé d'objet invalide.");
    const base = new URL(this.cfg.endpoint.toString());
    const encodedKey = uriEncode(key, false);
    if (this.cfg.forcePathStyle) {
      base.pathname = `${base.pathname.replace(/\/+$/, "")}/${this.cfg.bucket}/${encodedKey}`;
    } else {
      base.host = `${this.cfg.bucket}.${base.host}`;
      base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodedKey}`;
    }
    return base;
  }

  /**
   * PUT signé : Content-Type et Content-Length font partie de la signature,
   * donc le stockage refuse un fichier d'un autre type ou d'une autre taille
   * que ce que l'API a validé.
   */
  presignUpload(input: PresignUploadInput): PresignedUpload {
    const contentType = normalizeContentType(input.contentType);
    if (!isAllowedContentType(contentType)) throw new Error("Type de contenu refusé pour un téléversement.");
    if (!Number.isInteger(input.contentLength) || input.contentLength <= 0 || input.contentLength > MAX_UPLOAD_BYTES) throw new Error("Taille refusée pour un téléversement.");
    const headers = { "Content-Type": contentType, "Content-Length": String(input.contentLength) };
    const signed = presignUrl({
      method: "PUT",
      url: this.objectUrl(input.key),
      region: this.cfg.region,
      accessKey: this.cfg.accessKey,
      secretKey: this.cfg.secretKey,
      date: this.now(),
      expiresSeconds: this.ttl(input.ttlSeconds),
      headers,
    });
    return { url: signed.url, method: "PUT", headers, expiresAt: signed.expiresAt.toISOString() };
  }

  /** GET signé, courte durée. L'appelant a déjà vérifié que la clé appartient à l'organisation. */
  presignDownload(input: PresignDownloadInput): PresignedDownload {
    const signed = presignUrl({
      method: "GET",
      url: this.objectUrl(input.key),
      region: this.cfg.region,
      accessKey: this.cfg.accessKey,
      secretKey: this.cfg.secretKey,
      date: this.now(),
      expiresSeconds: this.ttl(input.ttlSeconds),
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  private ttl(requested: number | undefined): number {
    const ttl = requested ?? this.cfg.presignTtlSeconds;
    if (!Number.isInteger(ttl) || ttl < 1) throw new Error("Durée de validité invalide.");
    // Jamais plus long que la configuration : une route ne peut pas allonger la fenêtre.
    return Math.min(ttl, this.cfg.presignTtlSeconds);
  }
}

export function createStorageClient(cfg: StorageConfig | null, now?: () => Date): StorageClient | null {
  return cfg ? new StorageClient(cfg, now) : null;
}
