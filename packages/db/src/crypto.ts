import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/** Hachage de mot de passe (scrypt, sel aléatoire). */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Jeton opaque (sessions, jetons d'extension) et son hachage de stockage. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretsMatch(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newId(): string {
  return randomUUID();
}

/**
 * Coffre serveur : chiffrement authentifié AES-256-GCM des secrets par
 * organisation. La clé (32 octets, base64) vient de l'environnement, jamais
 * de la base. Format : version(1) | iv(12) | tag(16) | ciphertext.
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY doit faire 32 octets (base64).");
    this.key = key;
  }
  static generateKey(): string {
    return randomBytes(32).toString("base64");
  }
  encrypt(plaintext: string, aad = ""): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), enc]);
  }
  decrypt(blob: Buffer, aad = ""): string {
    if (blob[0] !== 1) throw new Error("Version de chiffrement inconnue");
    const iv = blob.subarray(1, 13);
    const tag = blob.subarray(13, 29);
    const data = blob.subarray(29);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}

/** Masque un secret pour l'affichage/journalisation. */
export function maskSecret(s: string): string {
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}
