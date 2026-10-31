import { createHash, createHmac } from "node:crypto";

/**
 * Signature AWS Signature Version 4 en paramètres de requête (« presigned
 * URL »), écrite à la main avec node:crypto. Référence : guide SigV4 d'AWS,
 * « Authenticating Requests: Using Query Parameters ». Vérifiée contre le
 * vecteur officiel « GET presigned URL » dans sigv4.test.ts.
 */

export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface PresignInput {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  /** URL de l'objet sans paramètres (ex. https://bucket.s3.amazonaws.com/test.txt). */
  url: URL | string;
  region: string;
  /** Service AWS signé ; « s3 » par défaut. */
  service?: string;
  accessKey: string;
  secretKey: string;
  /** Instant de signature (X-Amz-Date). */
  date: Date;
  /** Durée de validité en secondes (1 à 604 800). */
  expiresSeconds: number;
  /**
   * En-têtes signés en plus de `host`. Le client devra les envoyer à
   * l'identique : c'est ainsi qu'on impose le type et la taille d'un PUT.
   */
  headers?: Record<string, string>;
  /** Paramètres de requête supplémentaires, signés eux aussi. */
  query?: Record<string, string>;
}

export interface PresignResult {
  url: string;
  signature: string;
  canonicalRequest: string;
  stringToSign: string;
  signedHeaders: string;
  expiresAt: Date;
}

/** Encodage URI d'AWS : seuls A–Z a–z 0–9 - _ . ~ restent tels quels ; « / » reste si demandé. */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (ch === "/" && !encodeSlash)) {
      out += ch;
      continue;
    }
    for (const byte of Buffer.from(ch, "utf8")) out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Date « basique » ISO 8601 : 20130524T000000Z. */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signingKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Hôte canonique : sans le port s'il est celui par défaut du protocole (l'URL le retire déjà). */
function hostOf(url: URL): string {
  return url.host.toLowerCase();
}

/**
 * Construit l'URL signée. Le chemin de `url` est utilisé tel quel comme URI
 * canonique : il doit déjà être encodé (voir `uriEncode(key, false)`).
 */
export function presignUrl(input: PresignInput): PresignResult {
  if (!Number.isInteger(input.expiresSeconds) || input.expiresSeconds < 1 || input.expiresSeconds > 604_800) {
    throw new RangeError("expiresSeconds doit être un entier entre 1 et 604800.");
  }
  const url = typeof input.url === "string" ? new URL(input.url) : new URL(input.url.toString());
  if (url.search) throw new Error("L'URL à signer ne doit pas déjà porter de paramètres : passez-les dans `query`.");
  const service = input.service ?? "s3";
  const date = amzDate(input.date);
  const dateStamp = date.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: hostOf(url) };
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.trim().toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(";");
  const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h]}\n`).join("");

  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": SIGV4_ALGORITHM,
    "X-Amz-Credential": `${input.accessKey}/${scope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQueryString = canonicalQuery(query);
  const canonicalUri = url.pathname || "/";
  const canonicalRequest = [input.method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, UNSIGNED_PAYLOAD].join("\n");
  const stringToSign = [SIGV4_ALGORITHM, date, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(input.secretKey, dateStamp, input.region, service), stringToSign).toString("hex");

  const signed = new URL(url.toString());
  signed.search = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  return {
    url: signed.toString(),
    signature,
    canonicalRequest,
    stringToSign,
    signedHeaders,
    expiresAt: new Date(Math.floor(input.date.getTime() / 1000) * 1000 + input.expiresSeconds * 1000),
  };
}
