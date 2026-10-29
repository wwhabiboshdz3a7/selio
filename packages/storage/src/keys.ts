import { ALLOWED_CONTENT_TYPES, isUploadKind, type AllowedExtension, type UploadKind } from "./policy";

/**
 * Clés d'objet : `org/<orgId>/<kind>/<id>.<ext>`. L'organisation est le
 * premier préfixe, ce qui permet de vérifier l'appartenance d'une clé sans
 * consulter la base, et aucun nom de fichier fourni par l'utilisateur
 * n'entre jamais dans la clé.
 */

const ORG_PREFIX = "org/";
/** Identifiants acceptés dans une clé : UUID ou identifiants courts du dépôt (lettres, chiffres, « - », « _ »). */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_EXTENSIONS = new Set<string>(Object.values(ALLOWED_CONTENT_TYPES));

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_RE.test(value)) throw new Error(`${label} invalide pour une clé de stockage.`);
}

export function objectKey(orgId: string, kind: UploadKind, id: string, ext: AllowedExtension): string {
  assertSafeId(orgId, "orgId");
  assertSafeId(id, "id");
  if (!isUploadKind(kind)) throw new Error("kind invalide pour une clé de stockage.");
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("extension invalide pour une clé de stockage.");
  return `${ORG_PREFIX}${orgId}/${kind}/${id}.${ext}`;
}

/** Préfixe de toutes les clés d'une organisation. */
export function orgPrefix(orgId: string): string {
  assertSafeId(orgId, "orgId");
  return `${ORG_PREFIX}${orgId}/`;
}

/**
 * Une clé est lisible par une organisation si elle commence par son préfixe
 * et ne contient rien qui permette d'en sortir (segments vides, « . »,
 * « .. », caractères de contrôle, encodage douteux).
 */
export function keyBelongsToOrg(key: unknown, orgId: string): key is string {
  if (typeof key !== "string" || !SAFE_ID_RE.test(orgId)) return false;
  if (key.length > 512 || !key.startsWith(orgPrefix(orgId))) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\%]/.test(key)) return false;
  const segments = key.split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}

/** Décompose une clé produite par `objectKey` ; `null` si elle n'a pas cette forme. */
export function parseObjectKey(key: string): { orgId: string; kind: UploadKind; id: string; ext: AllowedExtension } | null {
  const m = /^org\/([A-Za-z0-9_-]{1,64})\/([a-z-]+)\/([A-Za-z0-9_-]{1,64})\.([a-z0-9]+)$/.exec(key);
  if (!m) return null;
  const [, orgId, kind, id, ext] = m;
  if (!orgId || !id || !isUploadKind(kind) || !ext || !ALLOWED_EXTENSIONS.has(ext)) return null;
  return { orgId, kind, id, ext: ext as AllowedExtension };
}
