import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, runMigrations, MIGRATIONS_DIR, SecretBox, type PgPool } from "@selio/db";
import { loadEnv } from "../src/config";
import { buildServer, type BuiltServer } from "../src/server";

/**
 * Stockage LOCAL des photos (sans S3) : demande d'envoi → envoi signé → lecture signée, servis par l'API sous
 * /api/storage/…. Base dédiée selio_test_api_storage_local. Ignoré si PostgreSQL n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_API_STORAGE_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_api_storage_local";
const APP_URL = process.env.TEST_API_STORAGE_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_api_storage_local";
const PUBLIC = "https://seliovprod.example";

let available = true;
let owner: PgPool;
let built: BuiltServer;
let dir: string;
let cookie = "";

async function ensureDatabase(): Promise<void> {
  const url = new URL(OWNER_URL);
  const dbName = url.pathname.replace(/^\//, "");
  url.pathname = "/postgres";
  const admin = createPool(url.toString(), { max: 1 });
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database "${dbName.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.alloc(2000, 7)]);

/** Chemin + paramètres d'une URL publique signée (l'API reçoit le chemin relayé tel quel). */
const pathOf = (u: string) => {
  const url = new URL(u);
  expect(url.origin).toBe(PUBLIC);
  return `${url.pathname}${url.search}`;
};

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 1 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  dir = await mkdtemp(join(tmpdir(), "selio-photos-"));
  const env = loadEnv({ DATABASE_URL: APP_URL, SECRETS_ENCRYPTION_KEY: SecretBox.generateKey(), NODE_ENV: "test", LOG_LEVEL: "silent", AI_PROVIDER: "mock", ALLOW_AI_FALLBACK: "false", PUBLIC_WEB_URL: PUBLIC, STORAGE_LOCAL_DIR: dir, STORAGE_PUBLIC_URL: PUBLIC, STORAGE_SECRET_KEY: "une-cle-de-signature-de-test-assez-longue-0123456789" });
  built = await buildServer(env, {}, { priceModelRefreshMs: 0 });
  await built.app.ready();
  const r = await built.app.inject({ method: "POST", url: "/api/auth/register", remoteAddress: "10.9.0.1", payload: { email: "photos@selio.test", password: "motdepasse-R1", displayName: "Camille", orgName: "Boutique photos" } });
  expect(r.statusCode).toBe(201);
  const raw = r.headers["set-cookie"];
  cookie = String(Array.isArray(raw) ? raw[0] : raw).split(";")[0]!;
});

afterAll(async () => {
  if (built) await built.app.close();
  await owner?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function presign(size = JPEG.length, contentType = "image/jpeg") {
  const r = await built.app.inject({ method: "POST", url: "/api/uploads/presign", headers: { cookie }, payload: { kind: "item-photo", contentType, size } });
  return { status: r.statusCode, json: JSON.parse(r.body) as { key: string; uploadUrl: string; readUrl: string; headers: Record<string, string> } };
}

describe("stockage local des photos", () => {
  it("la politique annonce le stockage comme configuré", async () => {
    if (!available) return;
    const r = await built.app.inject({ method: "GET", url: "/api/uploads/policy", headers: { cookie } });
    expect(JSON.parse(r.body)).toMatchObject({ configured: true });
  });

  it("envoi puis lecture : la photo est écrite sur le disque et servie avec son type", async () => {
    if (!available) return;
    const p = await presign();
    expect(p.status).toBe(201);
    const put = await built.app.inject({ method: "PUT", url: pathOf(p.json.uploadUrl), headers: { "content-type": "image/jpeg" }, payload: JPEG });
    expect(put.statusCode).toBe(200);
    const get = await built.app.inject({ method: "GET", url: pathOf(p.json.readUrl) });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.from(get.rawPayload).equals(JPEG)).toBe(true);
    // Lecture par la route authentifiée existante : nouveau lien signé, valide.
    const again = await built.app.inject({ method: "GET", url: `/api/uploads/read?key=${encodeURIComponent(p.json.key)}`, headers: { cookie } });
    const { url } = JSON.parse(again.body) as { url: string };
    expect((await built.app.inject({ method: "GET", url: pathOf(url) })).statusCode).toBe(200);
  });

  it("lien falsifié, taille différente, faux type ou lien de lecture utilisé pour écrire : refusés, rien d'écrit", async () => {
    if (!available) return;
    const before = (await readdir(dir, { recursive: true })).length;
    const p = await presign();
    const tampered = pathOf(p.json.uploadUrl).replace(/signature=[^&]+/, "signature=AAAA");
    expect((await built.app.inject({ method: "PUT", url: tampered, headers: { "content-type": "image/jpeg" }, payload: JPEG })).statusCode).toBe(403);
    // Taille différente de celle signée.
    expect((await built.app.inject({ method: "PUT", url: pathOf(p.json.uploadUrl), headers: { "content-type": "image/jpeg" }, payload: Buffer.concat([JPEG, Buffer.from("x")]) })).statusCode).toBe(403);
    // Lien de LECTURE réutilisé pour écrire.
    expect((await built.app.inject({ method: "PUT", url: pathOf(p.json.readUrl), headers: { "content-type": "image/jpeg" }, payload: JPEG })).statusCode).toBe(403);
    // Un PDF annoncé en JPEG, à la bonne taille : refusé sur son contenu réel.
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(JPEG.length - 9, 1)]);
    const put = await built.app.inject({ method: "PUT", url: pathOf(p.json.uploadUrl), headers: { "content-type": "image/jpeg" }, payload: pdf });
    expect(put.statusCode).toBe(415);
    expect(JSON.parse(put.body).error.message).toMatch(/pas une photo/);
    expect((await readdir(dir, { recursive: true })).length).toBe(before);
  });

  it("clés hors format et tentatives de sortie du dossier : 404, sans rien lire", async () => {
    if (!available) return;
    for (const url of ["/api/storage/..%2F..%2Fetc%2Fpasswd?expires=9999999999&signature=x", "/api/storage/org/x/item-photo/a.exe?expires=1&signature=x", "/api/storage/?expires=1&signature=x"]) {
      expect((await built.app.inject({ method: "GET", url })).statusCode).toBe(404);
    }
  });
});
