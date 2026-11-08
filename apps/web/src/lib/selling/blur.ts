import { BLUR_ANALYSIS_MAX_SIDE_PX, DEFAULT_BLUR_THRESHOLD, blurScore, isBlurry, toGrayscale } from "@selio/domain";

/**
 * Netteté d'une photo calculée DANS LE NAVIGATEUR (§5.14, contrôle des photos) : la photo est dessinée,
 * réduite (512 px au plus sur le grand côté), dans un canvas ; ses pixels passent en niveaux de gris puis
 * par la variance du laplacien (`blurScore`, @selio/domain). Rien n'est envoyé au serveur ni à l'IA.
 * Une photo d'un autre domaine sans en-tête CORS « salit » le canvas : le score vaut alors null
 * (« non calculé »), jamais une valeur inventée.
 */

/** Pixels RGBA, tels que les rend `getImageData`. */
export interface PixelSource {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Score de netteté à partir de pixels RGBA (plus il est bas, plus la photo est floue). */
export function blurScoreFromPixels(img: PixelSource): number {
  if (img.width < 3 || img.height < 3) return 0;
  const gray = toGrayscale(img.data, img.width, img.height, 4);
  return blurScore(gray, img.width, img.height);
}

/** Taille de dessin : le grand côté ramené à `maxSide`, proportions gardées. */
export function analysisSize(width: number, height: number, maxSide: number = BLUR_ANALYSIS_MAX_SIDE_PX): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const factor = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

/** Le strict nécessaire d'un canvas (un vrai `HTMLCanvasElement`, ou un double dans les tests). */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d", opts?: { willReadFrequently?: boolean }): {
    drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): PixelSource;
  } | null;
}

export interface DrawableImage {
  naturalWidth?: number;
  naturalHeight?: number;
  width: number;
  height: number;
}

/**
 * Score d'une image déjà chargée, dessinée réduite dans un canvas. Null si le canvas est indisponible
 * ou « sali » par une image d'un autre domaine (SecurityError à la lecture des pixels).
 */
export function blurScoreFromImage(image: DrawableImage & CanvasImageSource, createCanvas: () => CanvasLike = () => document.createElement("canvas") as unknown as CanvasLike): number | null {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const size = analysisSize(w, h);
  if (size.width < 3 || size.height < 3) return null;
  try {
    const canvas = createCanvas();
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return blurScoreFromPixels(ctx.getImageData(0, 0, size.width, size.height));
  } catch {
    return null;
  }
}

/** Charge une photo (même origine, data URL, ou CORS autorisé) ; null si elle ne se charge pas. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Score d'une photo par son adresse (null : non calculé). */
export async function blurScoreFromUrl(url: string): Promise<number | null> {
  const img = await loadImage(url);
  return img ? blurScoreFromImage(img) : null;
}

export { DEFAULT_BLUR_THRESHOLD, isBlurry };
