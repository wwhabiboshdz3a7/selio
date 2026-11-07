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

export interface DeleteObjectOptions {
  fetchImpl?: typeof fetch;
  /** Délai de la requête (10 s par défaut). */
  timeoutMs?: number;
}

/**
 * Client de stockage : pour le navigateur, il ne fait que signer des URLs
 * (PUT, GET) utilisées directement ; aucune URL publique, tout accès passe
 * par une signature courte. Seule la SUPPRESSION d'un objet est faite par le
 * serveur lui-même (`deleteObject`, DELETE signé exécuté par l'API ou le
 * worker) : une photo de Studio annulée, refusée, en échec ou purgée ne
 * reste pas dans le bucket.
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

  /** DELETE signé, courte durée (usage serveur : jamais rendu au navigateur). */
  presignDelete(input: PresignDownloadInput): PresignedDownload {
    const signed = presignUrl({
      method: "DELETE",
      url: this.objectUrl(input.key),
      region: this.cfg.region,
      accessKey: this.cfg.accessKey,
      secretKey: this.cfg.secretKey,
      date: this.now(),
      expiresSeconds: this.ttl(input.ttlSeconds),
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * Supprime un objet du bucket (l'appelant a déjà vérifié que la clé appartient à l'organisation). Idempotent :
   * un objet déjà absent (404) compte comme supprimé ; toute autre réponse d'erreur lève. Aucune redirection suivie.
   */
  async deleteObject(key: string, opts: DeleteObjectOptions = {}): Promise<void> {
    const { url } = this.presignDelete({ key });
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(url, { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok && res.status !== 404) throw new Error(`stockage : suppression refusée (HTTP ${res.status})`);
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
