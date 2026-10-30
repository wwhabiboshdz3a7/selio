import { isVintedDomain } from "../session";
import type { RadarPageKind } from "./types";

/**
 * Adresses que Radar a le droit d'ouvrir : une page catalogue (`/catalog`, `/catalog/<catégorie>`)
 * ou une annonce (`/items/<id>`), en https sur un domaine Vinted de la liste fermée. Les exécuteurs
 * acceptent en plus l'origine injectée par un test (serveur local), jamais autre chose.
 */
export function radarPageKind(pathname: string): RadarPageKind | null {
  if (/^\/catalog(?:\/[\w-]*)?\/?$/.test(pathname)) return "catalog";
  if (/^\/items\/\d+(?:-[\w-]*)?\/?$/.test(pathname)) return "item";
  return null;
}

/**
 * Résout une adresse Radar : relative à `base`, ou absolue en https sur un domaine Vinted (port par
 * défaut, sans identifiants dans l'adresse). `null` si l'adresse est refusée ou n'est pas du bon type.
 */
export function resolveRadarUrl(raw: string, kinds: readonly RadarPageKind[], base: URL | string = "https://www.vinted.fr"): URL | null {
  const baseUrl = typeof base === "string" ? new URL(base) : base;
  let u: URL;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.username !== "" || u.password !== "") return null;
  const sameBase = u.origin === baseUrl.origin;
  const vinted = u.protocol === "https:" && u.port === "" && isVintedDomain(u.hostname);
  if (!sameBase && !vinted) return null;
  const kind = radarPageKind(u.pathname);
  return kind !== null && kinds.includes(kind) ? u : null;
}

/** Page affichée sur Vinted (ou sur l'origine de test) : seule condition pour qu'un clic soit permis. */
export function isRadarOrigin(raw: string, base: URL | string = "https://www.vinted.fr"): boolean {
  const baseUrl = typeof base === "string" ? new URL(base) : base;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.origin === baseUrl.origin || (u.protocol === "https:" && u.port === "" && isVintedDomain(u.hostname));
}
