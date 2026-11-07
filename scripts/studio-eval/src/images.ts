import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkModelImage } from "@selio/domain";

/**
 * Photos du protocole, telles qu'elles partent vers le modèle : la MÊME vérification que le serveur
 * (`checkModelImage` : JPEG, PNG ou WebP lus dans les en-têtes, côté long ≤ 1 024 px, ≤ 1 Mo). Le script ne
 * réduit rien (aucune bibliothèque d'image dans le dépôt) : une photo trop grande est écartée et comptée,
 * jamais envoyée en pleine taille. Les photos restent sur le disque : aucune n'est copiée ni journalisée.
 */

export interface LoadedImage {
  path: string;
  name: string;
  base64: string;
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
  bytes: number;
}

export type ImageLoadResult =
  | { ok: true; image: LoadedImage }
  | { ok: false; code: "missing" | "unreadable" | "too_large" | "too_heavy"; reason: string };

export async function loadModelImage(file: string): Promise<ImageLoadResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { ok: false, code: "missing", reason: code === "ENOENT" ? "fichier introuvable" : `lecture impossible (${code ?? "erreur"})` };
  }
  const check = checkModelImage(bytes);
  if (!check.ok) return { ok: false, code: check.code, reason: check.reason };
  return {
    ok: true,
    image: { path: file, name: path.basename(file), base64: Buffer.from(bytes).toString("base64"), format: check.format, width: check.width, height: check.height, bytes: check.bytes },
  };
}

/** Data URL attendue par l'API (`POST /api/studio/prepare`). */
export function dataUrlOf(image: LoadedImage): string {
  return `data:image/${image.format};base64,${image.base64}`;
}
