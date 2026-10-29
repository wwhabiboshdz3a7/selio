import { describe, expect, it } from "vitest";
import { loadStorageConfig, storageConfigSchema, type StorageConfig } from "./config";
import { MAX_UPLOAD_BYTES, UPLOAD_KINDS, extensionFor, normalizeContentType, validateUpload } from "./policy";
import { keyBelongsToOrg, objectKey, orgPrefix, parseObjectKey } from "./keys";
import { StorageClient, createStorageClient } from "./client";

const FULL_ENV = {
  STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  STORAGE_BUCKET: "selio-photos",
  STORAGE_ACCESS_KEY: "selio-minio",
  STORAGE_SECRET_KEY: "selio-minio-secret",
};

const ORG = "6f1c2b3a-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-28T10:00:00Z");

function client(overrides: Partial<StorageConfig> = {}, now: () => Date = () => NOW): StorageClient {
  const cfg = loadStorageConfig(FULL_ENV)!;
  return new StorageClient({ ...cfg, ...overrides }, now);
}

describe("loadStorageConfig", () => {
  it("renvoie null sans STORAGE_ENDPOINT (stockage non configuré)", () => {
    expect(loadStorageConfig({})).toBeNull();
    expect(loadStorageConfig({ STORAGE_ENDPOINT: "   ", STORAGE_BUCKET: "x" })).toBeNull();
    expect(createStorageClient(loadStorageConfig({}))).toBeNull();
  });

  it("applique les valeurs par défaut : région fr-mrs-1, style path, 900 s", () => {
    const cfg = loadStorageConfig(FULL_ENV)!;
    expect(cfg.endpoint.toString()).toBe("http://127.0.0.1:9000/");
    expect(cfg).toMatchObject({ region: "fr-mrs-1", bucket: "selio-photos", accessKey: "selio-minio", secretKey: "selio-minio-secret", forcePathStyle: true, presignTtlSeconds: 900 });
    expect(storageConfigSchema.parse({}).STORAGE_REGION).toBe("fr-mrs-1");
  });

  it("lit les surcharges", () => {
    const cfg = loadStorageConfig({ ...FULL_ENV, STORAGE_REGION: "eu-west-3", STORAGE_FORCE_PATH_STYLE: "false", STORAGE_PRESIGN_TTL_SECONDS: "120" })!;
    expect(cfg).toMatchObject({ region: "eu-west-3", forcePathStyle: false, presignTtlSeconds: 120 });
    expect(loadStorageConfig({ ...FULL_ENV, STORAGE_FORCE_PATH_STYLE: "1" })!.forcePathStyle).toBe(true);
    expect(loadStorageConfig({ ...FULL_ENV, STORAGE_FORCE_PATH_STYLE: "0" })!.forcePathStyle).toBe(false);
  });

  it("accepte un environnement déjà parsé par l'API (booléen et nombre natifs)", () => {
    const cfg = loadStorageConfig({ ...FULL_ENV, STORAGE_FORCE_PATH_STYLE: false, STORAGE_PRESIGN_TTL_SECONDS: 300 })!;
    expect(cfg).toMatchObject({ forcePathStyle: false, presignTtlSeconds: 300 });
    expect(loadStorageConfig({ ...FULL_ENV, STORAGE_FORCE_PATH_STYLE: true })!.forcePathStyle).toBe(true);
  });

  it("refuse une configuration à moitié remplie ou incohérente", () => {
    expect(() => loadStorageConfig({ STORAGE_ENDPOINT: "http://127.0.0.1:9000" })).toThrow(/STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_SECRET_KEY: "" })).toThrow(/STORAGE_SECRET_KEY/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_ENDPOINT: "pas-une-url" })).toThrow(/URL/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_ENDPOINT: "ftp://x" })).toThrow(/http/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_ENDPOINT: "http://x:9000/?a=1" })).toThrow(/paramètres/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_BUCKET: "AB" })).toThrow(/STORAGE_BUCKET/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_PRESIGN_TTL_SECONDS: "10" })).toThrow(/STORAGE_PRESIGN_TTL_SECONDS/);
    expect(() => loadStorageConfig({ ...FULL_ENV, STORAGE_PRESIGN_TTL_SECONDS: "abc" })).toThrow(/STORAGE_PRESIGN_TTL_SECONDS/);
  });
});

describe("validateUpload (politique)", () => {
  it("accepte JPEG, PNG et WebP jusqu'à 5 Mo pour les trois kinds", () => {
    for (const kind of UPLOAD_KINDS) {
      expect(validateUpload(kind, "image/jpeg", 1)).toEqual({ ok: true, extension: "jpg" });
      expect(validateUpload(kind, "image/png", MAX_UPLOAD_BYTES)).toEqual({ ok: true, extension: "png" });
      expect(validateUpload(kind, "image/webp", 300 * 1024)).toEqual({ ok: true, extension: "webp" });
    }
    expect(validateUpload("avatar", "IMAGE/JPEG; charset=binary", 10)).toEqual({ ok: true, extension: "jpg" });
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it("refuse les kinds, types et tailles hors politique avec une raison", () => {
    expect(validateUpload("document", "image/jpeg", 10)).toMatchObject({ ok: false, reason: "kind" });
    expect(validateUpload(undefined, "image/jpeg", 10)).toMatchObject({ ok: false, reason: "kind" });
    expect(validateUpload("item-photo", "image/gif", 10)).toMatchObject({ ok: false, reason: "content_type" });
    expect(validateUpload("item-photo", "image/svg+xml", 10)).toMatchObject({ ok: false, reason: "content_type" });
    expect(validateUpload("item-photo", "text/html", 10)).toMatchObject({ ok: false, reason: "content_type" });
    expect(validateUpload("item-photo", undefined, 10)).toMatchObject({ ok: false, reason: "content_type" });
    expect(validateUpload("item-photo", "image/jpeg", MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, reason: "size" });
    expect(validateUpload("item-photo", "image/jpeg", 0)).toMatchObject({ ok: false, reason: "size" });
    expect(validateUpload("item-photo", "image/jpeg", -5)).toMatchObject({ ok: false, reason: "size" });
    expect(validateUpload("item-photo", "image/jpeg", 12.5)).toMatchObject({ ok: false, reason: "size" });
    expect(validateUpload("item-photo", "image/jpeg", "100")).toMatchObject({ ok: false, reason: "size" });
    expect(validateUpload("item-photo", "image/jpeg", Number.NaN)).toMatchObject({ ok: false, reason: "size" });
  });

  it("normalise le type et donne l'extension de clé", () => {
    expect(normalizeContentType(" Image/WebP ;q=1")).toBe("image/webp");
    expect(normalizeContentType(42)).toBe("");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("clés d'objet", () => {
  it("produit org/<orgId>/<kind>/<id>.<ext>", () => {
    expect(objectKey(ORG, "item-photo", "itm_01HZX", "jpg")).toBe(`org/${ORG}/item-photo/itm_01HZX.jpg`);
    expect(orgPrefix(ORG)).toBe(`org/${ORG}/`);
    expect(parseObjectKey(`org/${ORG}/studio-photo/abc.webp`)).toEqual({ orgId: ORG, kind: "studio-photo", id: "abc", ext: "webp" });
    expect(parseObjectKey(`org/${ORG}/autre/abc.webp`)).toBeNull();
    expect(parseObjectKey(`org/${ORG}/avatar/abc.exe`)).toBeNull();
  });

  it("refuse tout identifiant qui ne soit pas sûr (jamais un nom de fichier utilisateur)", () => {
    expect(() => objectKey("../x", "item-photo", "a", "jpg")).toThrow(/orgId/);
    expect(() => objectKey(ORG, "item-photo", "ma photo.jpg", "jpg")).toThrow(/id/);
    expect(() => objectKey(ORG, "item-photo", "a/b", "jpg")).toThrow(/id/);
    expect(() => objectKey(ORG, "document" as never, "a", "jpg")).toThrow(/kind/);
    expect(() => objectKey(ORG, "item-photo", "a", "exe" as never)).toThrow(/extension/);
    expect(() => objectKey("", "item-photo", "a", "jpg")).toThrow(/orgId/);
  });

  it("keyBelongsToOrg : seule l'organisation du préfixe peut lire", () => {
    const key = objectKey(ORG, "item-photo", "a1", "jpg");
    expect(keyBelongsToOrg(key, ORG)).toBe(true);
    expect(keyBelongsToOrg(key, "6f1c2b3a-0000-4000-8000-000000000002")).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}x/item-photo/a1.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/../autre/a1.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}//a1.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/./a1.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/a%2F..%2Fb.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/a\u0000.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/a\\b.jpg`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`org/${ORG}/${"a".repeat(600)}`, ORG)).toBe(false);
    expect(keyBelongsToOrg(undefined, ORG)).toBe(false);
    expect(keyBelongsToOrg(key, "../")).toBe(false);
  });
});

describe("StorageClient", () => {
  it("construit l'URL de l'objet en style path (MinIO) ou virtual-hosted", () => {
    expect(client().objectUrl("org/o/item-photo/a.jpg").toString()).toBe("http://127.0.0.1:9000/selio-photos/org/o/item-photo/a.jpg");
    expect(client({ forcePathStyle: false, endpoint: new URL("https://s3.fr-par.example.net") }).objectUrl("org/o/item-photo/a.jpg").toString()).toBe("https://selio-photos.s3.fr-par.example.net/org/o/item-photo/a.jpg");
    expect(client({ endpoint: new URL("http://127.0.0.1:9000/base/") }).objectUrl("a b.jpg").toString()).toBe("http://127.0.0.1:9000/base/selio-photos/a%20b.jpg");
    expect(() => client().objectUrl("/x")).toThrow();
  });

  it("presignUpload : PUT avec type et taille signés, expiration = maintenant + TTL", () => {
    const key = objectKey(ORG, "item-photo", "a1", "jpg");
    const up = client().presignUpload({ key, contentType: "image/jpeg", contentLength: 1234 });
    expect(up.method).toBe("PUT");
    expect(up.headers).toEqual({ "Content-Type": "image/jpeg", "Content-Length": "1234" });
    expect(up.expiresAt).toBe("2026-10-28T10:15:00.000Z");
    const url = new URL(up.url);
    expect(url.origin + url.pathname).toBe(`http://127.0.0.1:9000/selio-photos/${key}`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("selio-minio/20261028/fr-mrs-1/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261028T100000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Le secret n'apparaît jamais dans l'URL.
    expect(up.url).not.toContain("selio-minio-secret");
  });

  it("presignUpload : une autre taille ou un autre type donne une autre signature", () => {
    const key = objectKey(ORG, "item-photo", "a1", "jpg");
    const sig = (u: string) => new URL(u).searchParams.get("X-Amz-Signature");
    const a = client().presignUpload({ key, contentType: "image/jpeg", contentLength: 1234 }).url;
    const b = client().presignUpload({ key, contentType: "image/jpeg", contentLength: 1235 }).url;
    const c = client().presignUpload({ key, contentType: "image/png", contentLength: 1234 }).url;
    expect(sig(a)).not.toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
    expect(sig(a)).toBe(sig(client().presignUpload({ key, contentType: "image/jpeg", contentLength: 1234 }).url));
  });

  it("presignUpload : refuse la politique même si la route a oublié de valider", () => {
    const key = objectKey(ORG, "item-photo", "a1", "jpg");
    expect(() => client().presignUpload({ key, contentType: "image/gif", contentLength: 10 })).toThrow(/Type/);
    expect(() => client().presignUpload({ key, contentType: "image/jpeg", contentLength: MAX_UPLOAD_BYTES + 1 })).toThrow(/Taille/);
    expect(() => client().presignUpload({ key, contentType: "image/jpeg", contentLength: 0 })).toThrow(/Taille/);
  });

  it("presignDownload : GET signé, hôte seul, TTL plafonné par la configuration", () => {
    const key = objectKey(ORG, "studio-photo", "s9", "webp");
    const dl = client().presignDownload({ key });
    const url = new URL(dl.url);
    expect(url.pathname).toBe(`/selio-photos/${key}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(dl.expiresAt).toBe("2026-10-28T10:15:00.000Z");
    const short = client().presignDownload({ key, ttlSeconds: 60 });
    expect(new URL(short.url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect(short.expiresAt).toBe("2026-10-28T10:01:00.000Z");
    const capped = client().presignDownload({ key, ttlSeconds: 99_999 });
    expect(new URL(capped.url).searchParams.get("X-Amz-Expires")).toBe("900");
    expect(() => client().presignDownload({ key, ttlSeconds: 0 })).toThrow(/Durée/);
  });
});
