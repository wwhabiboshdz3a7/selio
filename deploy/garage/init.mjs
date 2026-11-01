// Initialise Garage (stockage des photos) au démarrage de la machine de production. Idempotent : relancé à
// chaque « docker compose up », il ne fait que ce qui manque. Aucun secret n'est affiché.
//   1. capacité du nœud (une seule fois)  2. bucket  3. clé de l'API (lecture + écriture, jamais propriétaire)
//   4. CORS : PUT et GET autorisés pour l'origine du site seulement (le navigateur envoie les photos directement)
// Variables : GARAGE_ADMIN_URL, GARAGE_ADMIN_TOKEN, GARAGE_S3_URL, GARAGE_CAPACITY, STORAGE_BUCKET, STORAGE_REGION,
//             STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, PUBLIC_WEB_URL (+ CORS_EXTRA_ORIGINS facultatif).
import { createHash, createHmac } from "node:crypto";

const env = (k, def) => {
  const v = process.env[k]?.trim();
  if (v) return v;
  if (def !== undefined) return def;
  throw new Error(`Variable manquante : ${k}`);
};
const ADMIN = env("GARAGE_ADMIN_URL", "http://garage:3903"),
  TOKEN = env("GARAGE_ADMIN_TOKEN");
const S3 = env("GARAGE_S3_URL", "http://garage:3900"),
  REGION = env("STORAGE_REGION", "fr-mrs-1");
const BUCKET = env("STORAGE_BUCKET", "selio-photos"),
  AK = env("STORAGE_ACCESS_KEY"),
  SK = env("STORAGE_SECRET_KEY");
const ORIGINS = [env("PUBLIC_WEB_URL"), ...env("CORS_EXTRA_ORIGINS", "").split(",")]
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const log = (m) => console.info(`[garage-init] ${m}`);

if (!/^GK[0-9a-f]{24}$/.test(AK))
  throw new Error(
    "STORAGE_ACCESS_KEY doit avoir le format Garage « GK » + 24 caractères hexadécimaux (relancer node deploy/generer-secrets.mjs).",
  );
if (!/^[0-9a-f]{64}$/.test(SK))
  throw new Error(
    "STORAGE_SECRET_KEY doit faire 64 caractères hexadécimaux (relancer node deploy/generer-secrets.mjs).",
  );

function bytes(s) {
  const m = String(s)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)i?B?$/i);
  if (!m) throw new Error(`GARAGE_CAPACITY illisible : ${s} (ex. 200G)`);
  return Math.round(Number(m[1]) * 1024 ** "_KMGT".indexOf((m[2] || "_").toUpperCase()));
}
async function admin(method, path, body) {
  const r = await fetch(`${ADMIN}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* réponse non JSON */
  }
  return { status: r.status, json, text };
}
async function must(method, path, body) {
  const r = await admin(method, path, body);
  if (r.status >= 300)
    throw new Error(`${method} ${path} → ${r.status} ${r.json?.message ?? r.text}`);
  return r.json;
}

// SigV4 (en-têtes) pour l'unique appel S3 : PutBucketCors, signé avec une clé temporaire propriétaire du bucket.
function sigv4(method, url, headers, body, key, secret) {
  const u = new URL(url),
    now = new Date(),
    amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, ""),
    day = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const h = {
    ...headers,
    host: u.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  const names = Object.keys(h)
    .map((k) => k.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]),
  );
  const query = [...u.searchParams.keys()].length
    ? [...u.searchParams]
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .sort()
        .join("&")
    : u.search === "?cors"
      ? "cors="
      : "";
  const canonical = [
    method,
    u.pathname,
    query,
    names.map((n) => `${n}:${lower[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonical).digest("hex"),
  ].join("\n");
  let k = createHmac("sha256", `AWS4${secret}`).update(day).digest();
  for (const p of [REGION, "s3", "aws4_request"]) k = createHmac("sha256", k).update(p).digest();
  const sig = createHmac("sha256", k).update(toSign).digest("hex");
  return {
    ...h,
    Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`,
  };
}

async function waitAdmin() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await admin("GET", "/v2/GetClusterStatus");
      if (r.status === 200 && r.json?.nodes?.some((n) => n.isUp)) return r.json;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`Garage injoignable sur ${ADMIN} après 60 s`);
}

const status = await waitAdmin();
// 1. Capacité du nœud
const node = status.nodes.find((n) => n.isUp);
if (!node.role) {
  const capacity = bytes(env("GARAGE_CAPACITY", "200G"));
  await must("POST", "/v2/UpdateClusterLayout", {
    roles: [{ id: node.id, zone: "mrs", capacity, tags: ["selio"] }],
  });
  const layout = await must("GET", "/v2/GetClusterLayout");
  await must("POST", "/v2/ApplyClusterLayout", { version: layout.version + 1 });
  log(`capacité attribuée au nœud : ${env("GARAGE_CAPACITY", "200G")}`);
} else log("capacité déjà attribuée");
for (let i = 0; i < 30; i++) {
  const r = await admin("GET", "/v2/ListBuckets");
  if (r.status === 200) break;
  await new Promise((res) => setTimeout(res, 1000));
}

// 2. Bucket
let bucket = await admin("GET", `/v2/GetBucketInfo?globalAlias=${encodeURIComponent(BUCKET)}`);
if (bucket.status === 404) {
  await must("POST", "/v2/CreateBucket", { globalAlias: BUCKET });
  bucket = await admin("GET", `/v2/GetBucketInfo?globalAlias=${encodeURIComponent(BUCKET)}`);
  log(`bucket créé : ${BUCKET}`);
} else log(`bucket présent : ${BUCKET}`);
if (bucket.status !== 200)
  throw new Error(`Bucket ${BUCKET} illisible : ${bucket.json?.message ?? bucket.text}`);
const bucketId = bucket.json.id;

// 3. Clé de l'API : importée avec les valeurs de deploy/.env, droits lecture + écriture uniquement
const key = await admin("GET", `/v2/GetKeyInfo?id=${AK}&showSecretKey=true`);
if (key.status === 404 || (key.status === 400 && /not found/i.test(key.text))) {
  await must("POST", "/v2/ImportKey", { accessKeyId: AK, secretAccessKey: SK, name: "selio-api" });
  log("clé de l'API importée");
} else if (key.status === 200) {
  if (key.json.secretAccessKey && key.json.secretAccessKey !== SK)
    throw new Error(
      "La clé STORAGE_ACCESS_KEY existe déjà dans Garage avec un autre secret : remettre l'ancien STORAGE_SECRET_KEY, ou générer une nouvelle paire (les deux lignes à A_GENERER).",
    );
  log("clé de l'API présente");
} else throw new Error(`Lecture de la clé : ${key.status} ${key.json?.message ?? key.text}`);
await must("POST", "/v2/AllowBucketKey", {
  bucketId,
  accessKeyId: AK,
  permissions: { read: true, write: true, owner: false },
});
await must("POST", "/v2/DenyBucketKey", {
  bucketId,
  accessKeyId: AK,
  permissions: { read: false, write: false, owner: true },
});
log("droits de la clé de l'API : lecture + écriture (pas propriétaire)");

// 4. CORS, avec une clé temporaire propriétaire supprimée aussitôt
const tmp = await must("POST", "/v2/CreateKey", { name: `selio-init-${Date.now()}` });
try {
  await must("POST", "/v2/AllowBucketKey", {
    bucketId,
    accessKeyId: tmp.accessKeyId,
    permissions: { read: false, write: false, owner: true },
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule>${ORIGINS.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join("")}<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
  const url = `${S3}/${BUCKET}?cors`;
  const headers = sigv4(
    "PUT",
    url,
    {
      "content-type": "application/xml",
      "content-md5": createHash("md5").update(xml).digest("base64"),
    },
    xml,
    tmp.accessKeyId,
    tmp.secretAccessKey,
  );
  delete headers.host;
  const r = await fetch(url, { method: "PUT", headers, body: xml });
  if (r.status >= 300) throw new Error(`PutBucketCors → ${r.status} ${await r.text()}`);
  log(`CORS : PUT et GET autorisés pour ${ORIGINS.join(", ")}`);
} finally {
  await admin("POST", `/v2/DeleteKey?id=${tmp.accessKeyId}`);
}
// Vérification : une requête de pré-vol depuis l'origine du site doit être acceptée
const pre = await fetch(`${S3}/${BUCKET}/org/verification/item-photo/x.png`, {
  method: "OPTIONS",
  headers: {
    Origin: ORIGINS[0],
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": "content-type",
  },
});
if (pre.status !== 200 || pre.headers.get("access-control-allow-origin") !== ORIGINS[0])
  throw new Error(`Pré-vol CORS refusé (${pre.status}) pour ${ORIGINS[0]}`);
log("pré-vol CORS vérifié · Garage prêt");
