import { FILE_TYPE_SNIFF_BYTES, photoContentProblem } from "@selio/domain";

/**
 * Contrôle d'une photo choisie par l'utilisateur, AVANT toute lecture complète et tout envoi : taille (message
 * avec la limite), fichier vide, type RÉEL lu dans les premiers octets (PDF renommé en .jpg, HEIC d'iPhone, SVG,
 * fichier corrompu). Seuls les 64 premiers octets sont lus : un fichier de plusieurs Go est refusé sans être chargé.
 */

/** Taille lisible en unités décimales (comme les limites affichées : « 1,5 Mo maximum »). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3))} Ko`;
}

/** Motif de refus en français, ou null si la photo peut être lue. */
export async function photoFileProblem(file: Blob & { name?: string }, opts: { maxBytes: number }): Promise<string | null> {
  const name = file.name ? `« ${file.name} »` : "Cette photo";
  if (file.size === 0) return `${name} est vide (0 octet) : choisissez une autre photo.`;
  if (file.size > opts.maxBytes) return `${name} est trop lourde (${formatBytes(file.size)}) : ${formatBytes(opts.maxBytes)} au maximum.`;
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, FILE_TYPE_SNIFF_BYTES).arrayBuffer());
  } catch {
    return `${name} n'a pas pu être lue : réessayez ou choisissez une autre photo.`;
  }
  return photoContentProblem(head, file.name ? { name: file.name } : {});
}

/** Lit un fichier en data URL (après contrôle). Rejette avec un message en français si la lecture échoue. */
export function readAsDataUrl(file: Blob & { name?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name ? `« ${file.name} »` : "La photo"} n'a pas pu être lue : réessayez ou choisissez une autre photo.`));
    reader.readAsDataURL(file);
  });
}
