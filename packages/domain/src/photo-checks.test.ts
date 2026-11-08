import { describe, expect, it } from "vitest";
import { DEFAULT_BLUR_THRESHOLD, MIN_LISTING_PHOTOS, blurScore, checkListing, downsampleGray, isBlurry, measurementsInText, missingMeasurements, requiredMeasurementsFor, toGrayscale } from "./photo-checks";

/** Damier net : contours partout. */
function checkerboard(width: number, height: number, cell = 8): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) g[y * width + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 235 : 20;
  return g;
}
/** Dégradé doux : aucun contour, l'image « floue » par construction. */
function gradient(width: number, height: number): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) g[y * width + x] = Math.round((x / (width - 1)) * 255);
  return g;
}
/** Flou en boîte (rayon r) : ce qu'une photo bougée donnerait. */
function boxBlur(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
        acc += src[yy * width + xx]!;
        n++;
      }
      out[y * width + x] = Math.round(acc / n);
    }
  }
  return out;
}

describe("netteté : variance du laplacien sur des images synthétiques", () => {
  it("un damier net a un score très élevé, un dégradé flou un score proche de 0", () => {
    const sharp = blurScore(checkerboard(64, 64), 64, 64);
    const soft = blurScore(gradient(64, 64), 64, 64);
    expect(sharp).toBeGreaterThan(10_000);
    expect(soft).toBeLessThan(5);
    expect(isBlurry(sharp)).toBe(false);
    expect(isBlurry(soft)).toBe(true);
  });
  it("flouter le damier fait chuter le score ; le seuil est paramétrable", () => {
    const g = checkerboard(64, 64);
    const sharp = blurScore(g, 64, 64);
    const blurred = blurScore(boxBlur(g, 64, 64, 3), 64, 64);
    expect(blurred).toBeLessThan(sharp / 4);
    expect(isBlurry(blurred, blurred + 1)).toBe(true);
    expect(isBlurry(blurred, blurred - 1)).toBe(false);
    expect(DEFAULT_BLUR_THRESHOLD).toBe(100);
  });
  it("image uniforme, trop petite ou tampon incomplet : 0 (jamais une estimation)", () => {
    expect(blurScore(new Uint8Array(16 * 16).fill(128), 16, 16)).toBe(0);
    expect(blurScore(new Uint8Array(4), 2, 2)).toBe(0);
    expect(blurScore(new Uint8Array(10), 8, 8)).toBe(0);
    expect(isBlurry(Number.NaN)).toBe(true);
  });
  it("niveaux de gris depuis un tampon RGBA de canvas, et réduction par zones pour le serveur", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
    const gray = toGrayscale(rgba, 2, 2);
    expect([...gray]).toEqual([255, 0, 76, 29]);
    expect(() => toGrayscale(rgba, 3, 3)).toThrow(RangeError);
    const big = checkerboard(128, 96, 16);
    const small = downsampleGray(big, 128, 96, 64);
    expect(small).toMatchObject({ width: 64, height: 48, factor: 2 });
    expect(small.gray.length).toBe(64 * 48);
    expect(blurScore(small.gray, 64, 48)).toBeGreaterThan(DEFAULT_BLUR_THRESHOLD);
    expect(downsampleGray(big, 128, 96, 512).factor).toBe(1);
  });
});

describe("mesures requises et manquantes", () => {
  it("par catégorie puis par titre (famille Studio), même table que Studio", () => {
    expect(requiredMeasurementsFor("shoes")).toEqual(["sole"]);
    expect(requiredMeasurementsFor("men", "Jean Levi's 501")).toEqual(["waist", "inseam"]);
    expect(requiredMeasurementsFor("women", "Robe midi")).toEqual(["chest", "waist", "length"]);
    expect(requiredMeasurementsFor("top")).toEqual(["chest", "length", "shoulders"]);
    expect(requiredMeasurementsFor("outerwear", "Veste")).toEqual(["chest", "length", "shoulders", "sleeve"]);
    expect(requiredMeasurementsFor("bags")).toEqual([]);
    expect(requiredMeasurementsFor(null)).toEqual([]);
  });
  it("lit les mesures écrites par le vendeur dans la description (cm seulement, « taille M » n'est pas un tour de taille)", () => {
    expect(measurementsInText("Mesures à plat : poitrine 52 cm, longueur : 70cm, épaules 46 cm. Taille M. Tour de taille 40 cm.")).toEqual({ chest: 52, length: 70, shoulders: 46, waist: 40 });
    expect(measurementsInText("Taille 40, longueur 25 pouces")).toEqual({});
    expect(measurementsInText(null)).toEqual({});
  });
  it("reprend les mesures de Studio avec provenance ; une mesure sans provenance ne compte pas", () => {
    const r = missingMeasurements({
      category: "men", title: "Pull en maille",
      measurements: [
        { name: "chest", valueCm: 50, source: "tape_photo", confidence: 0.9 },
        { name: "length", valueCm: null, source: null, question: "Longueur ?" },
        { name: "shoulders", valueCm: 44, source: "seller" },
      ],
      description: "Longueur 66 cm.",
    });
    expect(r.garmentKind).toBe("top");
    expect(r.present.map((p) => [p.name, p.valueCm, p.source])).toEqual([["chest", 50, "tape_photo"], ["shoulders", 44, "seller"], ["length", 66, "seller"]]);
    expect(r.missing).toEqual([]);
    const missing = missingMeasurements({ category: "men", title: "Veste en jean", measurements: [{ name: "chest", valueCm: 50, source: "tape_photo" }] });
    expect(missing.missing).toEqual(["length", "shoulders", "sleeve"]);
  });
});

describe("contrôle d'une annonce", () => {
  const photos = (n: number, alts: string[] = []) => Array.from({ length: n }, (_, i) => ({ alt: alts[i] ?? "" }));
  it("photo floue n°, moins de 3 photos, pas d'étiquette, mesures manquantes", () => {
    const r = checkListing({ category: "men", title: "Sweat à capuche", photos: photos(2), description: "" }, [5000, 12]);
    const codes = r.warnings.map((w) => w.code);
    expect(r.ok).toBe(false);
    expect(codes).toEqual(["few_photos", "blurry_photo", "no_label_photo", "missing_measurements"]);
    expect(r.warnings.find((w) => w.code === "blurry_photo")).toMatchObject({ photoIndex: 1, severity: "medium" });
    expect(r.warnings.find((w) => w.code === "blurry_photo")?.message).toContain("Photo n° 2 floue");
    expect(r.warnings.find((w) => w.code === "missing_measurements")?.measurements).toEqual(["chest", "length", "shoulders"]);
    expect(r.warnings.find((w) => w.code === "missing_measurements")?.message).toContain("Selio n'en invente aucune");
    expect(MIN_LISTING_PHOTOS).toBe(3);
  });
  it("tout va bien : étiquette repérée par le rôle Studio, mesures présentes, photos nettes", () => {
    const r = checkListing(
      { category: "men", title: "Sweat à capuche", photos: photos(4), photoRoles: ["front", "back", "label", "detail"], measurements: [{ name: "chest", valueCm: 55, source: "tape_photo" }, { name: "length", valueCm: 68, source: "seller" }, { name: "shoulders", valueCm: 48, source: "reference_db" }] },
      [800, 900, null, 1200],
    );
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it("sans rôles Studio, les légendes servent de repère (étiquette = avertissement léger « à vérifier ») ; seuil de flou paramétrable", () => {
    const base = { category: "shoes" as const, title: "Baskets", photos: photos(3, ["face", "dos", "étiquette"]), measurements: [{ name: "sole" as const, valueCm: 28, source: "seller" as const }] };
    expect(checkListing(base, [500, 500, 500]).ok).toBe(true);
    const noAlt = checkListing({ ...base, photos: photos(3) }, [500, 500, 500]);
    expect(noAlt.warnings.map((w) => [w.code, w.severity])).toEqual([["no_label_photo", "low"]]);
    const strict = checkListing(base, [500, 500, 500], { blurThreshold: 600 });
    expect(strict.warnings.filter((w) => w.code === "blurry_photo")).toHaveLength(3);
    expect(checkListing({ ...base, photos: 0 }, []).warnings.map((w) => w.code)).toEqual(["no_photos"]);
  });
  it("un score fourni pour une photo qui n'existe pas est ignoré", () => {
    const r = checkListing({ category: "bags", title: "Sac", photos: photos(3, ["face", "dos", "étiquette"]) }, [500, 500, 500, 1]);
    expect(r.ok).toBe(true);
  });
});
