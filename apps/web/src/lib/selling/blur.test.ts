import { describe, expect, it } from "vitest";
import { DEFAULT_BLUR_THRESHOLD, isBlurry } from "@selio/domain";
import { analysisSize, blurScoreFromImage, blurScoreFromPixels, type CanvasLike, type PixelSource } from "./blur";

/** Pixels RGBA d'une image synthétique : `value(x, y)` donne le niveau de gris. */
function pixels(width: number, height: number, value: (x: number, y: number) => number): PixelSource {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = value(x, y);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const sharp = (w: number, h: number) => pixels(w, h, (x, y) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 20 : 235));
// Même motif, très adouci : une rampe lente, comme une photo floue.
const blurry = (w: number, h: number) => pixels(w, h, (x, y) => Math.round(110 + 20 * Math.sin(x / 9) + 15 * Math.cos(y / 11)));

/** Double d'un canvas : rend les pixels fournis, ou lève l'erreur d'un canvas « sali » par une image d'un autre domaine. */
function fakeCanvas(render: (w: number, h: number) => PixelSource, opts: { taint?: boolean; calls?: { draw: number[] } } = {}): () => CanvasLike {
  return () => {
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_img, _x, _y, w, h) => { opts.calls?.draw.push(w, h); },
        getImageData: (_x, _y, w, h) => {
          if (opts.taint) throw new DOMException("The canvas has been tainted by cross-origin data.", "SecurityError");
          return render(w, h);
        },
      }),
    };
    return canvas;
  };
}

describe("netteté des photos calculée sur canvas, dans le navigateur", () => {
  it("une photo nette dépasse le seuil, une photo floue reste en dessous", () => {
    const s = blurScoreFromPixels(sharp(64, 64));
    const b = blurScoreFromPixels(blurry(64, 64));
    expect(s).toBeGreaterThan(DEFAULT_BLUR_THRESHOLD);
    expect(isBlurry(s)).toBe(false);
    expect(b).toBeLessThan(DEFAULT_BLUR_THRESHOLD);
    expect(isBlurry(b)).toBe(true);
    // Image uniforme : aucun contour, score nul ; image minuscule : 0, on ne devine pas.
    expect(blurScoreFromPixels(pixels(32, 32, () => 128))).toBe(0);
    expect(blurScoreFromPixels(pixels(2, 2, () => 0))).toBe(0);
  });

  it("la photo est réduite à 512 px au plus sur le grand côté avant le calcul", () => {
    expect(analysisSize(2000, 1000)).toEqual({ width: 512, height: 256 });
    expect(analysisSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(analysisSize(0, 10)).toEqual({ width: 0, height: 0 });
    const calls = { draw: [] as number[] };
    const score = blurScoreFromImage({ naturalWidth: 4000, naturalHeight: 3000, width: 4000, height: 3000 } as unknown as HTMLImageElement, fakeCanvas(sharp, { calls }));
    expect(calls.draw).toEqual([512, 384]);
    expect(score).toBeGreaterThan(DEFAULT_BLUR_THRESHOLD);
  });

  it("flou détecté sur un canvas simulé ; canvas sali (autre domaine) → non calculé, jamais inventé", () => {
    const img = { naturalWidth: 800, naturalHeight: 600, width: 800, height: 600 } as unknown as HTMLImageElement;
    const blurredScore = blurScoreFromImage(img, fakeCanvas(blurry));
    expect(blurredScore).not.toBeNull();
    expect(isBlurry(blurredScore!)).toBe(true);
    expect(blurScoreFromImage(img, fakeCanvas(sharp, { taint: true }))).toBeNull();
    expect(blurScoreFromImage({ naturalWidth: 1, naturalHeight: 1, width: 1, height: 1 } as unknown as HTMLImageElement, fakeCanvas(sharp))).toBeNull();
    expect(blurScoreFromImage(img, () => ({ width: 0, height: 0, getContext: () => null }))).toBeNull();
  });
});
