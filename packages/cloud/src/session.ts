import { z } from "zod";
import { isAntiBotCookie, isVintedHost, isVintedOrigin as isVintedOriginContract } from "@selio/contracts";
import type { SessionCookie, SessionOrigin, StorageState } from "./types";

/**
 * Session d'un compte Cloud : seuls les cookies et le stockage local des
 * domaines de Vinted sont conservés. Tout le reste (autres sites, localhost,
 * extensions, IndexedDB…) est refusé avant chiffrement — aucune collecte
 * globale de cookies, et rien qui lise ou devine un mot de passe.
 *
 * Les domaines viennent de la liste FERMÉE des contrats (`VINTED_DOMAINS`) :
 * `vinted.xyz` ou `x.vinted.lol` ne sont pas des domaines de Vinted. Les
 * cookies de passage des services anti-robot (`datadome`, `cf_clearance`…)
 * sont écartés : une vérification humaine ne sert jamais de laissez-passer
 * aux actions automatiques.
 */

/** `vinted.fr`, `www.vinted.com`, `.vinted.co.uk`, `api.vinted.be`… ; refuse `notvinted.fr`, `vinted.fr.evil.com`, `vinted.lol`. */
export function isVintedDomain(domain: string): boolean {
  return isVintedHost(domain);
}

/** Origine `https://` d'un hôte Vinted (le stockage local d'une page http n'est jamais gardé). */
export function isVintedOrigin(origin: string): boolean {
  return isVintedOriginContract(origin);
}

export { isAntiBotCookie };

const cookieSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(8192),
  domain: z.string().min(1).max(253),
  path: z.string().max(1024).default("/"),
  expires: z.number().finite().default(-1),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
});

const originSchema = z.object({
  origin: z.string().min(1).max(2048),
  localStorage: z.array(z.object({ name: z.string().max(1024), value: z.string().max(1_000_000) })).max(500).default([]),
});

/** Forme acceptée en entrée (état Playwright brut ou session relue). Les champs inconnus sont ignorés. */
export const storageStateSchema = z.object({
  cookies: z.array(cookieSchema).max(2000).default([]),
  origins: z.array(originSchema).max(200).default([]),
});

export class CloudSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudSessionError";
  }
}

/** Enveloppe lâche : les éléments sont validés un par un, après le tri par domaine. */
const looseStateSchema = z.object({
  cookies: z.array(z.unknown()).max(20_000).default([]),
  origins: z.array(z.unknown()).max(2_000).default([]),
});

function field(raw: unknown, key: string): unknown {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
}

/**
 * Ne garde que ce qui appartient à Vinted : cookies dont le domaine est un
 * domaine de Vinted (ou un sous-domaine), hors cookies de passage anti-robot,
 * origines https://…vinted.* avec leur stockage local. Renvoie toujours un objet neuf ne contenant que ces deux
 * champs (jamais d'IndexedDB, de credentials ni d'autre extension du format).
 *
 * Le tri par domaine passe AVANT la validation de forme : un cookie d'un autre
 * site (trop long, mal formé) est écarté sans faire échouer le reste, et aucune
 * valeur hors vinted.* n'est jamais examinée ni recopiée.
 */
export function filterStorageState(state: StorageState | Record<string, unknown> | null | undefined): StorageState {
  if (!state || typeof state !== "object") return { cookies: [], origins: [] };
  const loose = looseStateSchema.safeParse(state);
  if (!loose.success) return { cookies: [], origins: [] };
  const cookies: SessionCookie[] = [];
  for (const raw of loose.data.cookies) {
    const domain = field(raw, "domain");
    if (typeof domain !== "string" || !isVintedDomain(domain)) continue;
    const name = field(raw, "name");
    if (typeof name === "string" && isAntiBotCookie(name)) continue;
    const c = cookieSchema.safeParse(raw);
    if (!c.success) continue;
    cookies.push({ name: c.data.name, value: c.data.value, domain: c.data.domain, path: c.data.path, expires: c.data.expires, httpOnly: c.data.httpOnly, secure: c.data.secure, sameSite: c.data.sameSite });
  }
  const origins: SessionOrigin[] = [];
  for (const raw of loose.data.origins) {
    const origin = field(raw, "origin");
    if (typeof origin !== "string" || !isVintedOrigin(origin)) continue;
    const o = originSchema.safeParse(raw);
    if (!o.success) continue;
    origins.push({ origin: o.data.origin, localStorage: o.data.localStorage.map((e) => ({ name: e.name, value: e.value })) });
  }
  return { cookies, origins };
}

export function isSessionEmpty(state: StorageState | null | undefined): boolean {
  return !state || (state.cookies.length === 0 && state.origins.length === 0);
}

/** Sérialise une session filtrée (JSON UTF-8) ; l'appelant chiffre ces octets. */
export function sessionBytes(state: StorageState): Buffer {
  return Buffer.from(JSON.stringify(filterStorageState(state)), "utf8");
}

/** Relit une session (octets ou texte) : JSON valide, forme vérifiée, re-filtrée par sécurité. */
export function parseSession(bytes: Uint8Array | string): StorageState {
  const text = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CloudSessionError("Session illisible (JSON invalide).");
  }
  const parsed = storageStateSchema.safeParse(raw);
  if (!parsed.success) throw new CloudSessionError("Session illisible (forme inattendue).");
  return filterStorageState(parsed.data);
}

export interface SessionSummary {
  cookieCount: number;
  /** Domaines des cookies, sans doublon, triés. */
  domains: string[];
  origins: string[];
  /** Expiration la plus proche parmi les cookies datés, ou null (cookies de session seulement). */
  earliestExpiry: Date | null;
  empty: boolean;
}

/** Ce qu'on peut afficher d'une session sans révéler aucune valeur. */
export function sessionSummary(state: StorageState | null | undefined): SessionSummary {
  const s = filterStorageState(state ?? null);
  const dated = s.cookies.map((c) => c.expires).filter((e) => e > 0);
  return {
    cookieCount: s.cookies.length,
    domains: [...new Set(s.cookies.map((c) => c.domain.replace(/^\./, "").toLowerCase()))].sort(),
    origins: [...new Set(s.origins.map((o) => o.origin))].sort(),
    earliestExpiry: dated.length ? new Date(Math.min(...dated) * 1000) : null,
    empty: isSessionEmpty(s),
  };
}
