import { describe, expect, it, vi } from "vitest";
import { STUDIO_MODEL_JPEG_QUALITY, STUDIO_MODEL_MAX_BYTES, STUDIO_MODEL_MAX_SIDE_PX } from "@selio/contracts";
import { checkModelImage } from "@selio/domain";
import { ReduceError, reducePhoto, toGeneratorPhoto, type ImageReduceDeps } from "./reduce";
import { fakeJpeg, toBase64 } from "./test-images";


interface SimulatedCanvas {
  width: number;
  height: number;
  ops: string[];
  qualities: number[];
}

/**
 * Canvas simulé : il garde la trace des opérations et rend un JPEG dont l'en-tête porte ses dimensions,
 * d'un poids choisi par qualité (`weight`), ou du PNG si `noJpeg`.
 */
function simulatedDeps(original: { width: number; height: number }, opts: { weight?: (q: number) => number; noJpeg?: boolean; noContext?: boolean } = {}) {
  const canvases: SimulatedCanvas[] = [];
  const release = vi.fn();
  const deps: ImageReduceDeps = {
    async load() {
      return { source: {} as CanvasImageSource, width: original.width, height: original.height, release };
    },
    createCanvas(width, height) {
      const c: SimulatedCanvas = { width, height, ops: [], qualities: [] };
      canvases.push(c);
      const ctx = {
        set fillStyle(v: string) { c.ops.push(`fill:${v}`); },
        fillRect: (x: number, y: number, w: number, h: number) => c.ops.push(`rect:${x},${y},${w},${h}`),
        drawImage: (_s: unknown, x: number, y: number, w: number, h: number) => c.ops.push(`draw:${x},${y},${w},${h}`),
      };
      return {
        width,
        height,
        getContext: (() => (opts.noContext ? null : ctx)) as unknown as HTMLCanvasElement["getContext"],
        toDataURL: (type?: string, quality?: number) => {
          c.qualities.push(quality ?? -1);
          if (opts.noJpeg || type !== "image/jpeg") return `data:image/png;base64,${toBase64(new Uint8Array([0x89, 0x50]))}`;
          return `data:image/jpeg;base64,${toBase64(fakeJpeg(width, height, opts.weight?.(quality ?? 0.92) ?? 150_000))}`;
        },
      };
    },
  };
  return { deps, canvases, release };
}

const file = (name = "pull.jpg", type = "image/jpeg", size = 4_000_000) => {
  const f = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("réduction des photos dans le navigateur (canvas simulé)", () => {
  it("ramène une photo de téléphone 4 032 × 3 024 à 1 024 px de côté long, en JPEG qualité 0,8", async () => {
    const { deps, canvases, release } = simulatedDeps({ width: 4032, height: 3024 });
    const p = await reducePhoto(file(), {}, deps);
    expect(STUDIO_MODEL_MAX_SIDE_PX).toBe(1024);
    expect(STUDIO_MODEL_JPEG_QUALITY).toBe(0.8);
    expect(canvases[0]).toMatchObject({ width: 1024, height: 768 });
    expect(canvases[0]!.qualities).toEqual([0.8]);
    // Fond posé puis image dessinée à la taille réduite.
    expect(canvases[0]!.ops).toEqual(["fill:#ffffff", "rect:0,0,1024,768", "draw:0,0,1024,768"]);
    expect(p).toMatchObject({ width: 1024, height: 768, originalWidth: 4032, originalHeight: 3024, quality: 0.8, alt: "pull.jpg" });
    expect(p.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    // Le résultat passe la vérification du serveur (en-têtes lus, côté long et poids).
    expect(checkModelImage(p.url)).toMatchObject({ ok: true, width: 1024, height: 768 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("garde les proportions d'une photo en portrait et n'agrandit jamais une petite photo", async () => {
    const portrait = simulatedDeps({ width: 3024, height: 4032 });
    expect(await reducePhoto(file(), {}, portrait.deps)).toMatchObject({ width: 768, height: 1024 });
    const small = simulatedDeps({ width: 800, height: 600 });
    expect(await reducePhoto(file(), {}, small.deps)).toMatchObject({ width: 800, height: 600 });
    expect(small.canvases[0]).toMatchObject({ width: 800, height: 600 });
  });

  it("une option ne peut pas dépasser 1 024 px ni 1 Mo", async () => {
    const { deps, canvases } = simulatedDeps({ width: 4000, height: 2000 });
    await reducePhoto(file(), { maxSide: 4000, maxBytes: 10_000_000 }, deps);
    expect(canvases[0]).toMatchObject({ width: 1024, height: 512 });
  });

  it("une photo très détaillée est réessayée à 0,7 ; au-delà de 1 Mo partout, elle est refusée", async () => {
    const heavyAt80 = simulatedDeps({ width: 4000, height: 3000 }, { weight: (q) => (q >= 0.8 ? STUDIO_MODEL_MAX_BYTES + 50_000 : 600_000) });
    const p = await reducePhoto(file(), {}, heavyAt80.deps);
    expect(p.quality).toBe(0.7);
    expect(heavyAt80.canvases[0]!.qualities).toEqual([0.8, 0.7]);
    expect(p.bytes).toBeLessThanOrEqual(STUDIO_MODEL_MAX_BYTES);

    const always = simulatedDeps({ width: 4000, height: 3000 }, { weight: () => STUDIO_MODEL_MAX_BYTES + 1 });
    await expect(reducePhoto(file(), {}, always.deps)).rejects.toMatchObject({ code: "too_heavy" });
    expect(always.canvases[0]!.qualities).toEqual([0.8, 0.7, 0.6]);
    expect(always.release).toHaveBeenCalledTimes(1);
  });

  it("refuse plutôt que d'envoyer autre chose qu'un JPEG réduit", async () => {
    await expect(reducePhoto(file(), {}, simulatedDeps({ width: 2000, height: 2000 }, { noJpeg: true }).deps)).rejects.toMatchObject({ code: "no_jpeg" });
    await expect(reducePhoto(file(), {}, simulatedDeps({ width: 2000, height: 2000 }, { noContext: true }).deps)).rejects.toMatchObject({ code: "no_canvas" });
    await expect(reducePhoto(file("notes.pdf", "application/pdf"), {}, simulatedDeps({ width: 10, height: 10 }).deps)).rejects.toBeInstanceOf(ReduceError);
    await expect(reducePhoto(file("x.jpg", "image/jpeg", 50 * 1024 * 1024), {}, simulatedDeps({ width: 10, height: 10 }).deps)).rejects.toMatchObject({ code: "too_big_file" });
    await expect(reducePhoto(file(), {}, simulatedDeps({ width: 0, height: 0 }).deps)).rejects.toMatchObject({ code: "unreadable" });
  });

  it("n'envoie au serveur que l'identifiant, la photo et son nom", async () => {
    const p = await reducePhoto(file(), {}, simulatedDeps({ width: 2000, height: 1000 }).deps);
    expect(Object.keys(toGeneratorPhoto(p)).sort()).toEqual(["alt", "id", "url"]);
  });
});
