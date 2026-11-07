import { STUDIO_MODEL_JPEG_QUALITY, STUDIO_MODEL_MAX_BYTES, STUDIO_MODEL_MAX_SIDE_PX, type GeneratorPhoto } from "@selio/contracts";
import { base64ByteLength, checkModelImage, newId, reducedDimensions } from "@selio/domain";

/**
 * Réduction des photos dans le navigateur, AVANT tout envoi (Studio façon Kavis, §5.11) : côté long
 * ≤ 1 024 px (`STUDIO_MODEL_MAX_SIDE_PX`), JPEG qualité ≈ 80 (`STUDIO_MODEL_JPEG_QUALITY`), ≤ 1 Mo.
 * Le serveur vérifie les en-têtes et refuse une photo plus grande : jamais de photo en pleine taille
 * envoyée au modèle. Le résultat est relu avec la même vérification que le serveur (`checkModelImage`).
 */

/** Fond posé sous une image transparente (PNG) : le JPEG n'a pas de transparence. Contenu de la photo, pas une couleur d'interface. */
const PHOTO_BACKGROUND = "#ffffff";
/** Qualités essayées si la photo dépasse 1 Mo à 0,8 (photo très détaillée) ; au-delà, refus. */
const FALLBACK_QUALITIES = [0.7, 0.6] as const;
/** Fichier d'origine au-delà duquel on ne tente même pas le décodage (mémoire du téléphone). */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;

export interface ReducedPhoto extends GeneratorPhoto {
  /** Dimensions après réduction (côté long ≤ 1 024 px). */
  width: number;
  height: number;
  /** Poids du JPEG produit (octets). */
  bytes: number;
  /** Dimensions de la photo d'origine. */
  originalWidth: number;
  originalHeight: number;
  /** Qualité JPEG finalement retenue (0,8 sauf photo très détaillée). */
  quality: number;
}

export type ReduceErrorCode = "not_image" | "too_big_file" | "unreadable" | "no_canvas" | "no_jpeg" | "too_heavy" | "check_failed";

export class ReduceError extends Error {
  constructor(public readonly code: ReduceErrorCode, message: string) {
    super(message);
    this.name = "ReduceError";
  }
}

/** Image décodée par le navigateur : source dessinable et dimensions naturelles (orientation EXIF appliquée). */
export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

/** Ce dont la réduction a besoin du navigateur ; remplaçable dans les tests (canvas simulé). */
export interface ImageReduceDeps {
  load(file: Blob, name: string): Promise<LoadedImage>;
  createCanvas(width: number, height: number): Pick<HTMLCanvasElement, "getContext" | "toDataURL" | "width" | "height">;
}

export const browserImageDeps: ImageReduceDeps = {
  async load(file, name) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.decoding = "async";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new ReduceError("unreadable", `Image illisible : ${name}`));
        el.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  },
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

export interface ReduceOptions {
  maxSide?: number;
  quality?: number;
  maxBytes?: number;
}

/**
 * Réduit une photo : côté long ≤ 1 024 px (jamais agrandie), JPEG qualité 0,8, ≤ 1 Mo. Une photo trop
 * détaillée est réessayée à 0,7 puis 0,6 ; au-delà, elle est refusée (jamais envoyée plus lourde).
 */
export async function reducePhoto(file: File, opts: ReduceOptions = {}, deps: ImageReduceDeps = browserImageDeps): Promise<ReducedPhoto> {
  const maxSide = Math.min(opts.maxSide ?? STUDIO_MODEL_MAX_SIDE_PX, STUDIO_MODEL_MAX_SIDE_PX);
  const maxBytes = Math.min(opts.maxBytes ?? STUDIO_MODEL_MAX_BYTES, STUDIO_MODEL_MAX_BYTES);
  const quality = opts.quality ?? STUDIO_MODEL_JPEG_QUALITY;
  const name = file.name || "photo";
  if (file.type && !file.type.startsWith("image/")) throw new ReduceError("not_image", `${name} n'est pas une image.`);
  if (file.size > MAX_INPUT_BYTES) throw new ReduceError("too_big_file", `${name} est trop lourde pour être ouverte (${Math.round(file.size / 1_000_000)} Mo).`);

  const image = await deps.load(file, name);
  try {
    if (!(image.width > 0 && image.height > 0)) throw new ReduceError("unreadable", `Image illisible : ${name}`);
    const dims = reducedDimensions(image.width, image.height, maxSide);
    const canvas = deps.createCanvas(dims.width, dims.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ReduceError("no_canvas", "Réduction des photos indisponible dans ce navigateur.");
    ctx.fillStyle = PHOTO_BACKGROUND;
    ctx.fillRect(0, 0, dims.width, dims.height);
    ctx.drawImage(image.source, 0, 0, dims.width, dims.height);

    for (const q of [quality, ...FALLBACK_QUALITIES.filter((f) => f < quality)]) {
      const url = canvas.toDataURL("image/jpeg", q);
      // Un navigateur sans encodeur JPEG rend du PNG : il serait trop lourd et non conforme à la règle.
      if (!url.startsWith("data:image/jpeg;base64,")) throw new ReduceError("no_jpeg", "Ce navigateur ne sait pas produire de JPEG : la photo ne peut pas être réduite.");
      const bytes = base64ByteLength(url.slice(url.indexOf(",") + 1));
      if (bytes > maxBytes) continue;
      // Même contrôle que le serveur : en-têtes lisibles, côté long ≤ 1 024 px, ≤ 1 Mo.
      const check = checkModelImage(url, { maxSide, maxBytes });
      if (!check.ok) throw new ReduceError("check_failed", `${name} : ${check.reason}`);
      return { id: newId(), url, alt: name.slice(0, 200), width: check.width, height: check.height, bytes, originalWidth: image.width, originalHeight: image.height, quality: q };
    }
    throw new ReduceError("too_heavy", `${name} reste au-dessus de ${Math.round(maxBytes / 1000)} Ko après réduction : choisissez une autre photo.`);
  } finally {
    image.release();
  }
}

/** Photo telle qu'envoyée au serveur (sans les mesures de la réduction). */
export function toGeneratorPhoto(p: GeneratorPhoto): GeneratorPhoto {
  return { id: p.id, url: p.url, alt: p.alt };
}
