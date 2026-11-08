// Préparation du paquet Chrome Web Store : manifeste de publication, contrôles et archive ZIP.
// Fonctions pures (testées dans test/pack.test.ts) ; le script pack.mjs les enchaîne sur dist/.
// Rien n'est publié ici : la publication se fait à la main, par Ibrahim (docs/WEB-STORE.md).
import { deflateRawSync } from "node:zlib";

/** Limites de la fiche et du manifeste imposées par le Chrome Web Store. */
export const CWS_LIMITS = { nameMax: 75, shortNameMax: 12, descriptionMax: 132 };

/**
 * Permissions autorisées, chacune justifiée dans store/justifications.md. Toute autre
 * permission fait échouer le paquet : l'ajouter exige d'abord sa justification.
 */
export const ALLOWED_PERMISSIONS = ["storage", "activeTab"];

/** Domaines où le script de contenu peut s'exécuter (pages Vinted lues à la demande). */
export const ALLOWED_CONTENT_HOSTS = ["https://www.vinted.fr/*", "https://www.vinted.be/*", "https://www.vinted.com/*"];

/** Fichiers jamais publiés (cartes de sources, fichiers cachés, traces locales). */
export function isPackable(relPath) {
  const parts = relPath.split("/");
  if (parts.some((p) => p.startsWith("."))) return false;
  if (/\.map$/.test(relPath)) return false;
  if (/(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(relPath)) return false;
  return true;
}

/**
 * Manifeste de publication, dérivé de celui de dist/ :
 * - les origines http:// de développement (127.0.0.1, localhost) sont retirées : la
 *   version publiée ne parle qu'à une API en HTTPS ;
 * - avec `apiOrigin` (https://api.exemple.fr), l'autorisation facultative est
 *   restreinte à cette seule origine au lieu de « https://* ».
 */
export function storeManifest(manifest, { apiOrigin = "", allowLocalApi = false } = {}) {
  const out = structuredClone(manifest);
  let optional = Array.isArray(out.optional_host_permissions) ? [...out.optional_host_permissions] : [];
  if (!allowLocalApi) optional = optional.filter((o) => !o.startsWith("http://"));
  if (apiOrigin) {
    let url;
    try {
      url = new URL(apiOrigin);
    } catch {
      throw new Error(`EXTENSION_API_ORIGIN invalide : ${apiOrigin}`);
    }
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw new Error(`EXTENSION_API_ORIGIN doit être une origine HTTPS sans chemin (ex. https://api.exemple.fr), reçu : ${apiOrigin}`);
    optional = [`${url.origin}/*`];
  }
  out.optional_host_permissions = optional;
  return out;
}

/** Contrôles avant publication : erreurs bloquantes et avertissements. */
export function validateManifest(m) {
  const errors = [];
  const warnings = [];
  if (m.manifest_version !== 3) errors.push("manifest_version doit valoir 3.");
  if (typeof m.name !== "string" || !m.name.trim()) errors.push("Nom manquant.");
  else if (m.name.length > CWS_LIMITS.nameMax) errors.push(`Nom trop long (${m.name.length} > ${CWS_LIMITS.nameMax}).`);
  if (m.short_name && m.short_name.length > CWS_LIMITS.shortNameMax) errors.push(`short_name trop long (${m.short_name.length} > ${CWS_LIMITS.shortNameMax}).`);
  if (typeof m.description !== "string" || !m.description.trim()) errors.push("Description manquante.");
  else if ([...m.description].length > CWS_LIMITS.descriptionMax) errors.push(`Description trop longue (${[...m.description].length} > ${CWS_LIMITS.descriptionMax}).`);
  if (typeof m.version !== "string" || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(m.version)) errors.push(`Version invalide pour le Chrome Web Store : ${m.version} (1 à 4 nombres séparés par des points).`);
  if (!m.icons || !m.icons["128"]) errors.push("Icône 128 × 128 manquante (icons.128).");
  for (const p of m.permissions ?? []) {
    if (!ALLOWED_PERMISSIONS.includes(p)) errors.push(`Permission non justifiée : ${p} (ajoutez-la à store/justifications.md et à ALLOWED_PERMISSIONS, ou retirez-la).`);
  }
  if ((m.host_permissions ?? []).length > 0) errors.push(`host_permissions doit rester vide (accès demandé à la demande) : ${m.host_permissions.join(", ")}.`);
  for (const cs of m.content_scripts ?? []) {
    for (const match of cs.matches ?? []) if (!ALLOWED_CONTENT_HOSTS.includes(match)) errors.push(`Script de contenu hors des pages Vinted prises en charge : ${match}.`);
    if (cs.all_frames) errors.push("Le script de contenu ne doit pas s'exécuter dans tous les cadres (all_frames).");
  }
  const optional = m.optional_host_permissions ?? [];
  for (const o of optional) {
    if (o.startsWith("http://")) errors.push(`Origine non chiffrée dans la version publiée : ${o}.`);
    if (o === "<all_urls>" || o === "*://*/*") errors.push(`Autorisation facultative trop large : ${o}.`);
  }
  if (optional.includes("https://*/*")) warnings.push("Autorisation facultative « https://*/* » (l'origine de l'API est choisie par l'utilisateur) : examen approfondi probable. Fixez EXTENSION_API_ORIGIN dès que l'adresse de production est connue.");
  const csp = m.content_security_policy?.extension_pages ?? "";
  if (!csp) errors.push("Politique de sécurité du contenu (content_security_policy.extension_pages) manquante.");
  if (/unsafe-eval|unsafe-inline|https?:\/\//.test(csp)) errors.push(`Politique de sécurité trop permissive (code distant ou évalué) : ${csp}.`);
  if (m.externally_connectable) errors.push("externally_connectable non prévu : aucune page web ne doit parler à l'extension.");
  if (m.web_accessible_resources?.length) warnings.push("web_accessible_resources déclarées : à justifier dans la fiche.");
  return { errors, warnings };
}

/** Contrôle du code construit : aucun script distant, adresse d'API par défaut signalée. */
export function inspectBundle(files) {
  const errors = [];
  const warnings = [];
  for (const [name, text] of files) {
    if (/\.html$/.test(name) && /<script[^>]+src=["']https?:/i.test(text)) errors.push(`${name} charge un script distant.`);
    if (/\.js$/.test(name) && /importScripts\(\s*["']https?:/.test(text)) errors.push(`${name} importe un script distant.`);
    if (/\.js$/.test(name) && /http:\/\/127\.0\.0\.1:8787/.test(text)) warnings.push(`${name} propose http://127.0.0.1:8787 comme adresse d'API par défaut : construisez avec VITE_DEFAULT_API_BASE_URL=https://api.<domaine> pour la version publiée.`);
  }
  return { errors, warnings };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date DOS fixe (1er janvier 2026) : la même entrée donne toujours la même archive. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * Archive ZIP (méthode « deflate », sans dépendance), entrées triées par nom.
 * @param {{ name: string, data: Buffer }[]} entries
 */
export function createZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of sorted) {
    if (e.name.startsWith("/") || e.name.includes("..") || e.name.includes("\\")) throw new Error(`Nom d'entrée refusé : ${e.name}`);
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
