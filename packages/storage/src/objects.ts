import type { StorageClient } from "./client";

/**
 * Lecture et suppression d'un objet du stockage par le SERVEUR (API ou worker), avec les mêmes URLs signées que
 * le navigateur : aucune URL n'est rendue au client, le secret ne quitte pas le serveur. Sert à Studio : lecture
 * d'une photo envoyée par sa clé (préparation, génération), et suppression de la photo d'une demande de photo
 * portée annulée, refusée, en échec ou purgée.
 *
 * L'appelant vérifie la clé (préfixe de l'organisation) AVANT d'appeler `read` ou `delete`. Ici : délai borné,
 * aucune redirection suivie, et jamais plus de `maxBytes + 1` octets lus en mémoire (une photo plus lourde est
 * ensuite refusée par l'appelant comme « trop lourde », sans avoir été chargée en entier).
 */
export interface StorageObjectStoreOptions {
  fetchImpl?: typeof fetch;
  /** Délai d'une requête (10 s par défaut). */
  timeoutMs?: number;
  /** Octets lus au plus par `read` (1,5 Mo par défaut : limite d'une photo reçue par Studio). */
  maxBytes?: number;
}

/** 1,5 Mo : poids maximal d'une photo reçue par Studio (`studio.STUDIO_RECEIVED_MAX_BYTES`). */
export const STORAGE_READ_MAX_BYTES = 1_500_000;

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class StorageObjectStore {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(private readonly storage: Pick<StorageClient, "presignDownload"> & Partial<Pick<StorageClient, "deleteObject">>, opts: StorageObjectStoreOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxBytes = opts.maxBytes ?? STORAGE_READ_MAX_BYTES;
  }

  async read(key: string): Promise<{ data: Uint8Array; contentType: string }> {
    const { url } = this.storage.presignDownload({ key });
    const res = await this.fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`stockage : HTTP ${res.status}`);
    }
    const data = await readCapped(res, this.maxBytes + 1);
    const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    const contentType = Object.values(CONTENT_TYPES).includes(declared) ? declared : CONTENT_TYPES[ext] ?? "application/octet-stream";
    return { data, contentType };
  }

  /** Efface un objet : DELETE signé exécuté par le serveur (idempotent : un objet déjà absent compte comme supprimé). */
  async delete(key: string): Promise<void> {
    if (typeof this.storage.deleteObject !== "function") throw new Error("stockage : suppression non disponible");
    await this.storage.deleteObject(key, { fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs });
  }
}

/** Lit au plus `limit` octets du corps (le reste n'est jamais chargé : le flux est annulé). */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, Math.min(value.length, limit - total));
      chunks.push(take);
      total += take.length;
    }
  } finally {
    if (total >= limit) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
