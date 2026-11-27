import { createHmac, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
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
    if (this.cfg.local) return new URL(`/api/storage/${uriEncode(key, false)}`, this.cfg.local.publicUrl);
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
    if (this.cfg.local) {
      const signed = this.localSign("PUT", input.key, this.ttl(input.ttlSeconds), contentType, input.contentLength);
      return { url: signed.url, method: "PUT", headers, expiresAt: signed.expiresAt };
    }
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
    if (this.cfg.local) return this.localSign("GET", input.key, this.ttl(input.ttlSeconds));
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
    if (this.cfg.local) return this.localSign("DELETE", input.key, this.ttl(input.ttlSeconds));
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
    if (this.cfg.local) {
      // Stockage local : le fichier est supprimé directement (volume partagé par l'API et le worker).
      await rm(this.localPath(key), { force: true });
      return;
    }
    const { url } = this.presignDelete({ key });
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(url, { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok && res.status !== 404) throw new Error(`stockage : suppression refusée (HTTP ${res.status})`);
  }

  /** Stockage local ? (photos servies par l'API, `/api/storage/…`). */
  get isLocal(): boolean {
    return this.cfg.local !== undefined;
  }

  /**
   * Stockage local : chemin du fichier d'une clé, toujours DANS le dossier configuré (une clé avec `..`,
   * un chemin absolu ou des caractères de contrôle est refusée).
   */
  localPath(key: string): string {
    if (!this.cfg.local) throw new Error("Stockage local non configuré.");
    if (!key || key.length > 512 || key.startsWith("/") || key.split("/").some((p) => p === "" || p === "." || p === "..") || [...key].some((c) => c === "\\" || c.charCodeAt(0) < 0x20)) throw new Error("Clé d'objet invalide.");
    const root = resolve(this.cfg.local.dir);
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error("Clé d'objet invalide.");
    return full;
  }

  /**
   * Stockage local : vérifie un lien signé (méthode, clé, échéance, et pour un envoi le type et la taille
   * imposés). Comparaison en temps constant.
   */
  verifyLocal(input: { method: "PUT" | "GET" | "DELETE"; key: string; expires: string | undefined; signature: string | undefined; contentType?: string; contentLength?: number }): { ok: true } | { ok: false; reason: "expired" | "signature" } {
    if (!this.cfg.local || !input.expires || !input.signature || !/^\d{1,12}$/.test(input.expires)) return { ok: false, reason: "signature" };
    const exp = Number.parseInt(input.expires, 10);
    const expected = this.localSignature(input.method, input.key, exp, input.contentType, input.contentLength);
    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
    if (exp * 1000 < this.now().getTime()) return { ok: false, reason: "expired" };
    return { ok: true };
  }

  private localSignature(method: string, key: string, exp: number, contentType?: string, contentLength?: number): string {
    const payload = [method, key, String(exp), contentType ?? "", contentLength === undefined ? "" : String(contentLength)].join("\n");
    return createHmac("sha256", this.cfg.secretKey).update("selio-storage-v1\n").update(payload).digest("base64url");
  }

  private localSign(method: "PUT" | "GET" | "DELETE", key: string, ttl: number, contentType?: string, contentLength?: number): PresignedDownload {
    const exp = Math.floor(this.now().getTime() / 1000) + ttl;
    const url = this.objectUrl(key);
    url.searchParams.set("expires", String(exp));
    url.searchParams.set("signature", this.localSignature(method, key, exp, contentType, contentLength));
    return { url: url.toString(), expiresAt: new Date(exp * 1000).toISOString() };
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
