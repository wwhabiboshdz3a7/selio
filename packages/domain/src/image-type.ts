/**
 * Type réel d'un fichier envoyé comme photo, lu dans ses premiers octets (« octets magiques ») : jamais dans
 * son extension ni dans le type annoncé par le navigateur. Un PDF renommé en .jpg, un fichier vide, un SVG ou
 * une photo HEIC d'iPhone sont reconnus et refusés avec un message clair, au lieu d'une image cassée.
 * Partagé par le navigateur (contrôle AVANT l'envoi) et le serveur (contrôle des photos reçues).
 */

export type DetectedFileType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/heic" | "image/avif" | "image/svg+xml" | "application/pdf" | "unknown" | "empty";

/** Types de photo acceptés partout dans Selio. */
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedPhotoType = (typeof ACCEPTED_PHOTO_TYPES)[number];

/** Octets à lire pour reconnaître le type (en-tête ISO BMFF compris). */
export const FILE_TYPE_SNIFF_BYTES = 64;

export function detectFileType(bytes: Uint8Array): DetectedFileType {
  if (bytes.length === 0) return "empty";
  const at = (i: number, sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + n)));
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  // ISO BMFF (HEIC, HEIF, AVIF) : « ftyp » à l'octet 4, puis la marque.
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4).toLowerCase();
    if (brand.startsWith("avi")) return "image/avif";
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  // Texte (SVG) : marque d'ordre des octets UTF-8 (EF BB BF) et espaces ignorés en tête.
  const bom = at(0, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  const head = ascii(bom, FILE_TYPE_SNIFF_BYTES).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return "unknown";
}

/**
 * Motif de refus d'une photo d'après son contenu réel, en français ; null si c'est bien une image acceptée.
 * Une image acceptée annoncée sous un autre type accepté (« .jpg » qui est en réalité un PNG) passe : le
 * navigateur l'affiche correctement.
 */
export function photoContentProblem(bytes: Uint8Array, opts: { name?: string } = {}): string | null {
  const who = opts.name ? `« ${opts.name} »` : "Cette photo";
  const type = detectFileType(bytes);
  if (type === "empty") return `${who} est vide (0 octet) : choisissez une autre photo.`;
  if (type === "image/heic") return `${who} est au format HEIC (iPhone), que ce navigateur ne sait pas lire : exportez-la en JPEG (Réglages › Appareil photo › Formats › « Le plus compatible ») ou faites une capture d'écran.`;
  if (type === "application/pdf") return `${who} est un document PDF, pas une photo : JPEG, PNG ou WebP attendu.`;
  if (type === "image/svg+xml") return `${who} est un dessin SVG, pas une photo : JPEG, PNG ou WebP attendu.`;
  if (type === "image/gif" || type === "image/avif") return `${who} est au format ${type === "image/gif" ? "GIF" : "AVIF"} : JPEG, PNG ou WebP attendu.`;
  if (type === "unknown") return `${who} n'est pas une image lisible (fichier corrompu ou d'un autre type) : JPEG, PNG ou WebP attendu.`;
  return null;
}

/** Octets d'une data URL base64 (`data:image/jpeg;base64,…`) et son type annoncé ; null si ce n'en est pas une. */
export function dataUrlHead(url: string, maxBytes = FILE_TYPE_SNIFF_BYTES): { declared: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,/.exec(url);
  if (!m) return null;
  const b64 = url.slice(m[0].length, m[0].length + Math.ceil((maxBytes * 4) / 3) + 4).replace(/[^A-Za-z0-9+/=]/g, "");
  const usable = b64.slice(0, b64.length - (b64.length % 4));
  let bin = "";
  try {
    bin = typeof atob === "function" ? atob(usable) : "";
  } catch {
    return { declared: m[1]!, bytes: new Uint8Array() };
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { declared: m[1]!, bytes };
}
