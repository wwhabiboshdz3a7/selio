import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MEASUREMENT_NAMES, studioPrep, type LabelReadOutput, type MeasurementsOutput, type SizeReference, type SortedPhoto } from "@selio/contracts";
import {
  EXPECTED_MEASUREMENTS, assembleStudioPrep, base64ByteLength, buildSellerQuestions, buildStudioArticle, checkImageDimensions, checkModelImage, decodeBase64, extractCmValues, garmentKindFor, groupPhotosByArticle,
  matchSizeReference, mergeFields, mergeSortBatches, photosWithRole, planPhotoBatches, reducedDimensions, selectPhotosForModel, stripUnknownMeasurements, studioQuestion,
} from "./studio";

// Petites images réelles (Pillow) : en-têtes produits par de vrais encodeurs.
const JPEG_BASELINE_33x17 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAARACEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2EKKKKACiiigAooooAKKKKACiiigD/9k=";
const JPEG_PROGRESSIVE_40x25 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAZACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAWAQEBAQAAAAAAAAAAAAAAAAAABQb/2gAMAwEAAhADEAAAAZ8TtgAAAAB//8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQABBQIn/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAwEBPwFf/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPwFf/8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQAGPwIn/8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQABPyEn/9oADAMBAAIAAwAAABD/AP8A/wD/AP8A/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAwEBPxBf/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPxBf/8QAFBABAAAAAAAAAAAAAAAAAAAAQP/aAAgBAQABPxAn/9k=";
const PNG_21x13 = "iVBORw0KGgoAAAANSUhEUgAAABUAAAANCAIAAADJ8LI3AAAAGUlEQVR4nGM8ISfHQAFgokTzqP5R/UNcPwB5TwEeR88wzgAAAABJRU5ErkJggg==";
const WEBP_LOSSY_30x20 = "UklGRkoAAABXRUJQVlA4ID4AAABQAwCdASoeABQAPm00lkekIyIhKAgAgA2JZQDMSoAAQOBEAAD+8DhD/i1rcLSw//tLP/qWf/Us/xiVO3AAAA==";
const WEBP_LOSSLESS_31x19 = "UklGRh4AAABXRUJQVlA4TBEAAAAvHoAEAAdQjyLXo/+BiOh/AAA=";
const WEBP_EXTENDED_300x200 = "UklGRuwAAABXRUJQVlA4WAoAAAAQAAAAKwEAxwAAQUxQSBIAAAABB1DAiAgAKNL//xTR/9T/rwFWUDggtAAAAPAQAJ0BKiwByAA+bTaaSaQjIqEgKACADYlpbuF2sR7cB+AAABhhFych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe9IAD+/Qp///mwK5rn6W///2d36M36d3987HwQ8AUAAAAAAAAAAA==";

const bytesOf = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** En-tête PNG (signature + IHDR) aux dimensions voulues : suffit à la lecture des dimensions. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([8, 2, 0, 0, 0], 24);
  return b;
}

/** Ajoute un segment APP1 (EXIF) de `size` octets juste après SOI : le SOF arrive bien plus loin. */
function withExif(jpeg: Uint8Array, size: number): Uint8Array {
  const seg = new Uint8Array(4 + size);
  seg.set([0xff, 0xe1, ((size + 2) >> 8) & 0xff, (size + 2) & 0xff]);
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2));
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

const photo = (index: number, role: SortedPhoto["role"], articleGroup = 1, confidence = 0.9): SortedPhoto => ({ index, role, articleGroup, confidence });
const label = (fields: Partial<Record<"brand" | "size" | "material" | "reference", [string, number] | [string, number, null]>>, text: string | null = null): LabelReadOutput => {
  const f = (k: "brand" | "size" | "material" | "reference") => {
    const v = fields[k];
    if (!v) return { value: null, confidence: 0, readFrom: null };
    return { value: v[0], confidence: v[1], readFrom: v.length === 3 ? null : ("label" as const) };
  };
  return { brand: f("brand"), size: f("size"), material: f("material"), reference: f("reference"), careSymbols: [], text };
};
const tape = (values: Partial<Record<(typeof MEASUREMENT_NAMES)[number], number>>, confidence = 0.9, tapeVisible = true): MeasurementsOutput => ({
  tapeVisible,
  measurements: Object.entries(values).map(([name, valueCm]) => ({ name: name as (typeof MEASUREMENT_NAMES)[number], valueCm: valueCm!, confidence, evidence: "tape_photo" as const })),
});
const levis501: SizeReference = { brand: "Levi's", reference: "501", size: "W32 L32", category: "bottom", measurements: { waist: 41, inseam: 81, rise: 28 } };

describe("tri des photos : regroupement et lots", () => {
  it("regroupe les photos par article, dans l'ordre de leur première photo", () => {
    const groups = groupPhotosByArticle({ photos: [photo(2, "label", 2), photo(0, "front", 1), photo(1, "back", 1), photo(3, "front", 2)] });
    expect(groups.map((g) => [g.articleGroup, g.photoIndexes])).toEqual([[1, [0, 1]], [2, [2, 3]]]);
  });
  it("découpe en lots équilibrés de 6 photos au plus", () => {
    expect(planPhotoBatches(4)).toEqual([{ offset: 0, count: 4 }]);
    expect(planPhotoBatches(6)).toEqual([{ offset: 0, count: 6 }]);
    expect(planPhotoBatches(7)).toEqual([{ offset: 0, count: 4 }, { offset: 4, count: 3 }]);
    expect(planPhotoBatches(12)).toEqual([{ offset: 0, count: 6 }, { offset: 6, count: 6 }]);
    expect(planPhotoBatches(0)).toEqual([]);
    for (let n = 1; n <= 12; n++) expect(planPhotoBatches(n).every((b) => b.count <= 6 && b.count >= 1)).toBe(true);
  });
  it("réunit les lots : un article par lot = le même article ; sinon des groupes distincts, à vérifier", () => {
    const one = mergeSortBatches([{ output: { photos: [photo(0, "front"), photo(1, "label")] }, offset: 0 }, { output: { photos: [photo(0, "tape"), photo(1, "back")] }, offset: 2 }]);
    expect(one.output.photos.map((p) => [p.index, p.articleGroup])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
    expect(one.warnings[0]).toMatch(/même article/);
    const two = mergeSortBatches([{ output: { photos: [photo(0, "front", 1), photo(1, "front", 2)] }, offset: 0 }, { output: { photos: [photo(0, "label", 1)] }, offset: 2 }]);
    expect(two.output.photos.map((p) => p.articleGroup)).toEqual([1, 2, 3]);
    expect(two.warnings[0]).toMatch(/regroupement/);
    expect(mergeSortBatches([{ output: { photos: [photo(0, "front")] }, offset: 0 }]).warnings).toEqual([]);
  });
});

describe("photos envoyées au modèle : 6 au plus, face, étiquette, mètre, dos, détail d'abord", () => {
  it("une de chaque rôle dans l'ordre de priorité, puis les suivantes", () => {
    const photos = [photo(0, "other"), photo(1, "detail"), photo(2, "back"), photo(3, "tape", 1, 0.6), photo(4, "label"), photo(5, "front"), photo(6, "label", 1, 0.7), photo(7, "defect"), photo(8, "tape", 1, 0.95), photo(9, "front", 1, 0.5)];
    const chosen = selectPhotosForModel(photos);
    expect(chosen).toHaveLength(6);
    expect(chosen.map((p) => p.role)).toEqual(["front", "label", "tape", "back", "detail", "defect"]);
    expect(chosen.find((p) => p.role === "tape")!.index).toBe(8); // la plus sûre
    expect(selectPhotosForModel(photos, 12)).toHaveLength(6); // jamais plus de 6
    expect(selectPhotosForModel(photos, 4).map((p) => p.role)).toEqual(["front", "label", "tape", "back"]);
    expect(selectPhotosForModel([photo(0, "front"), photo(1, "front"), photo(2, "label")]).map((p) => p.index)).toEqual([0, 2, 1]);
  });
  it("photos d'étiquette (2 au plus) et de mètre (3 au plus), les plus sûres d'abord", () => {
    const photos = [photo(0, "label", 1, 0.6), photo(1, "label", 1, 0.9), photo(2, "label", 1, 0.8), photo(3, "tape")];
    expect(photosWithRole(photos, "label", 2).map((p) => p.index)).toEqual([1, 2]);
    expect(photosWithRole(photos, "tape", 3).map((p) => p.index)).toEqual([3]);
  });
});

describe("famille de pièce et mesures attendues", () => {
  it("devine la famille d'après le type de pièce, puis la catégorie", () => {
    expect(garmentKindFor({ text: "Pull torsadé" })).toBe("top");
    expect(garmentKindFor({ text: "T-shirt blanc" })).toBe("top");
    expect(garmentKindFor({ text: "Jean 501" })).toBe("bottom");
    expect(garmentKindFor({ text: "Veste en jean" })).toBe("outerwear");
    expect(garmentKindFor({ text: "Robe pull" })).toBe("dress");
    expect(garmentKindFor({ text: "Baskets blanches" })).toBe("shoes");
    expect(garmentKindFor({ text: "Article", category: "bags" })).toBe("bag");
    expect(garmentKindFor({ text: null, category: "women" })).toBe("other");
  });
  it("haut : poitrine, longueur, épaules ; bas : taille, entrejambe ; chaussures : semelle", () => {
    expect(EXPECTED_MEASUREMENTS.top).toEqual(["chest", "length", "shoulders"]);
    expect(EXPECTED_MEASUREMENTS.bottom).toEqual(["waist", "inseam"]);
    expect(EXPECTED_MEASUREMENTS.shoes).toEqual(["sole"]);
    expect(EXPECTED_MEASUREMENTS.bag).toEqual([]);
  });
});

describe("mergeFields : chaque valeur garde sa provenance", () => {
  it("étiquette lue avec confiance (≥ 0,7) > vendeur ; désaccord → question, la valeur lue est gardée", () => {
    const m = mergeFields(label({ brand: ["Levi's", 0.92], size: ["W32 L32", 0.9] }), { brand: "Wrangler", size: "W32 L32" });
    expect(m.fields.brand).toMatchObject({ value: "Levi's", source: "label", confidence: 0.92 });
    expect(m.fields.brand.question).toMatch(/l'étiquette indique « Levi's », vous avez indiqué « Wrangler »/);
    expect(m.fields.size).toEqual({ value: "W32 L32", source: "label", confidence: 0.9 }); // même valeur : pas de question
  });
  it("étiquette peu sûre (0,5 à 0,7) : le vendeur l'emporte ; seule, elle est gardée et à confirmer", () => {
    const withSeller = mergeFields(label({ brand: ["Lewis", 0.6] }), { brand: "Levi's" });
    expect(withSeller.fields.brand).toMatchObject({ value: "Levi's", source: "seller" });
    expect(withSeller.fields.brand.question).toMatch(/Laquelle est juste/);
    const alone = mergeFields(label({ brand: ["Levi's", 0.6] }));
    expect(alone.fields.brand).toEqual({ value: "Levi's", source: "label", confidence: 0.6 });
    expect(buildSellerQuestions(alone.fields, [], "other").find((q) => q.field === "brand")).toMatchObject({ reason: "low_confidence" });
  });
  it("une lecture sans provenance (readFrom absent) ou sous 0,5 n'est jamais retenue", () => {
    const m = mergeFields(label({ brand: ["Levi's", 0.95, null], size: ["M", 0.4] }));
    expect(m.fields.brand).toEqual({ value: null, source: null });
    expect(m.fields.size).toEqual({ value: null, source: null });
  });
  it("mesures : ruban lu (≥ 0,7) > base par la référence > vendeur ; écart de plus d'1 cm → question", () => {
    const m = mergeFields(label({ brand: ["Levi's", 0.9], reference: ["501", 0.9], size: ["W32 L32", 0.9] }), { measurements: { waist: 40, inseam: 80 } }, levis501, tape({ waist: 43 }));
    const by = Object.fromEntries(m.measurements.map((x) => [x.name, x]));
    expect(by.waist).toMatchObject({ valueCm: 43, source: "tape_photo", confidence: 0.9 });
    expect(by.waist!.question).toMatch(/le mètre ruban indique 43 cm, la base des références indique 41 cm/);
    expect(by.inseam).toEqual({ name: "inseam", valueCm: 81, source: "reference_db" }); // 81 vs 80 : dans la tolérance
    expect(by.rise).toEqual({ name: "rise", valueCm: 28, source: "reference_db" });
    expect(m.referenceUsed).toBe(levis501);
  });
  it("sans mètre ruban visible, aucune mesure n'est prise du modèle", () => {
    const m = mergeFields(null, {}, null, tape({ chest: 52, length: 70 }, 0.9, false));
    expect(m.measurements).toEqual([]);
    expect(m.tapeVisible).toBe(false);
    const sellerOnly = mergeFields(null, { measurements: { chest: 50 } }, null, tape({ chest: 52 }, 0.9, false));
    expect(sellerOnly.measurements).toEqual([{ name: "chest", valueCm: 50, source: "seller" }]);
  });
  it("une mesure peu sûre sur le ruban (< 0,5) est ignorée ; entre 0,5 et 0,7, le vendeur l'emporte", () => {
    expect(mergeFields(null, {}, null, tape({ chest: 52 }, 0.4)).measurements).toEqual([]);
    const m = mergeFields(null, { measurements: { chest: 55 } }, null, tape({ chest: 52 }, 0.6));
    expect(m.measurements[0]).toMatchObject({ valueCm: 55, source: "seller" });
    expect(m.measurements[0]!.question).toMatch(/vous avez indiqué 55 cm, le mètre ruban indique 52 cm/);
  });
  it("la base n'est utilisée que pour la bonne marque, la bonne référence et la bonne taille", () => {
    const other = mergeFields(label({ brand: ["Levi's", 0.9], reference: ["505", 0.9], size: ["W32 L32", 0.9] }), {}, levis501);
    expect(other.measurements).toEqual([]);
    expect(other.warnings[0]).toMatch(/marque ou référence différente/);
    const size = mergeFields(label({ brand: ["LEVIS", 0.9], reference: ["501", 0.9], size: ["W34 L32", 0.9] }), {}, levis501);
    expect(size.warnings[0]).toMatch(/taille différente/);
    const noSize = mergeFields(label({ brand: ["Levi's", 0.9], reference: ["501", 0.9] }), {}, levis501);
    expect(noSize.warnings[0]).toMatch(/taille inconnue/);
    expect(matchSizeReference([{ ...levis501, size: "W30 L32" }, levis501], { brand: "levis", reference: "501", size: "w32 l32" })).toBe(levis501);
    const bag: SizeReference = { brand: "Longchamp", reference: "Le Pliage", size: null, category: "bag", measurements: { length: 30 } };
    expect(matchSizeReference([bag], { brand: "Longchamp", reference: "le pliage", size: null })).toBe(bag);
  });
  it("propriété : aucune valeur sans provenance, et chaque mesure vient d'une source fournie", () => {
    const cm = fc.integer({ min: 20, max: 120 });
    fc.assert(
      fc.property(
        fc.record({ chest: fc.option(cm, { nil: undefined }), waist: fc.option(cm, { nil: undefined }) }),
        fc.record({ chest: fc.option(cm, { nil: undefined }), waist: fc.option(cm, { nil: undefined }) }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        fc.option(fc.constantFrom("Levi's", "Zara"), { nil: undefined }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (tapeValues, sellerValues, tapeConf, visible, brand, brandConf) => {
          const t = tape(Object.fromEntries(Object.entries(tapeValues).filter(([, v]) => v !== undefined)), tapeConf, visible);
          const seller = Object.fromEntries(Object.entries(sellerValues).filter(([, v]) => v !== undefined));
          const m = mergeFields(label(brand ? { brand: [brand, brandConf] } : {}), { measurements: seller }, null, t);
          for (const f of Object.values(m.fields)) expect(f.value === null).toBe(f.source === null);
          if (m.fields.brand.value !== null) expect(brandConf).toBeGreaterThanOrEqual(0.5);
          for (const x of m.measurements) {
            expect(x.source).not.toBeNull();
            if (x.source === "tape_photo") {
              expect(visible).toBe(true);
              expect(tapeConf).toBeGreaterThanOrEqual(0.5);
              expect(x.valueCm).toBe(tapeValues[x.name as "chest" | "waist"]);
            } else expect(x.valueCm).toBe(seller[x.name]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("questions au vendeur selon la famille de pièce", () => {
  const empty = mergeFields(null).fields;
  it("haut sans mesures : poitrine, longueur, épaules, plus marque, taille et matière illisibles", () => {
    const qs = buildSellerQuestions(empty, [], "top");
    expect(qs.map((q) => q.field)).toEqual(["brand", "size", "material", "chest", "length", "shoulders"]);
    expect(qs.find((q) => q.field === "chest")!.text).toMatch(/d'une aisselle à l'autre/);
    expect(qs.some((q) => q.field === "reference")).toBe(false); // la référence est facultative
  });
  it("bas : taille et entrejambe ; chaussures : semelle ; sac : ni taille ni mesure", () => {
    expect(buildSellerQuestions(empty, [], "bottom").filter((q) => (MEASUREMENT_NAMES as readonly string[]).includes(q.field)).map((q) => q.field)).toEqual(["waist", "inseam"]);
    expect(buildSellerQuestions(empty, [], "shoes").filter((q) => q.field === "sole")).toHaveLength(1);
    expect(buildSellerQuestions(empty, [], "bag").map((q) => q.field)).toEqual(["brand", "material"]);
  });
  it("sans ruban visible, la question le dit ; une mesure connue n'est pas redemandée", () => {
    const qs = buildSellerQuestions(empty, [{ name: "chest", valueCm: 52, source: "seller" }], "top", { tapeVisible: false });
    expect(qs.some((q) => q.field === "chest")).toBe(false);
    expect(qs.find((q) => q.field === "length")).toMatchObject({ reason: "no_tape" });
    expect(qs.find((q) => q.field === "length")!.text).toMatch(/Aucun mètre ruban n'est visible/);
  });
  it("une mesure lue sur le ruban avec une confiance moyenne est à confirmer", () => {
    const qs = buildSellerQuestions(empty, [{ name: "chest", valueCm: 52, source: "tape_photo", confidence: 0.6 }], "top");
    expect(qs.find((q) => q.field === "chest")).toMatchObject({ reason: "low_confidence" });
  });
  it("une question portée par le champ garde sa raison : lecture peu sûre à confirmer, désaccord entre sources, ou champ vide", () => {
    const fields = { ...empty, size: { value: "M", source: "label" as const, confidence: 0.62, question: "L'étiquette semble indiquer « M » pour la taille : est-ce juste ?" }, brand: { value: "Zara", source: "label" as const, confidence: 0.9, question: "Marque : l'étiquette indique « Zara », vous avez indiqué « Mango ». Laquelle est juste ?" } };
    const qs = buildSellerQuestions(fields, [
      { name: "waist", valueCm: 41, source: "tape_photo", confidence: 0.55, question: "Tour de taille n'a pas pu être lue avec certitude sur le mètre ruban." },
      { name: "chest", valueCm: 52, source: "tape_photo", confidence: 0.9, question: "Poitrine : le mètre ruban indique 52 cm, vous avez indiqué 55 cm. Laquelle est juste ?" },
      { name: "inseam", valueCm: null, source: null, question: "Mesurez l'entrejambe." },
    ], "bottom");
    expect(Object.fromEntries(qs.map((q) => [q.field, q.reason]))).toMatchObject({ size: "low_confidence", brand: "conflict", waist: "low_confidence", chest: "conflict", inseam: "missing" });
  });
  it("le texte d'une question est le même partout", () => {
    expect(studioQuestion("brand", "missing").text).toMatch(/Quelle est la marque/);
    expect(studioQuestion("sole", "missing").text).toMatch(/semelle intérieure/);
    expect(studioQuestion("size", "conflict", { read: "M", other: "L" }).text).toMatch(/l'étiquette indique « M », vous avez indiqué « L »/);
  });
});

describe("préparation Studio complète", () => {
  it("assemble articles, rôles, champs et mesures avec provenance, questions ; précision « à mesurer »", () => {
    const sort = { photos: [photo(0, "front"), photo(1, "label"), photo(2, "tape"), photo(3, "back"), photo(4, "front", 2), photo(5, "label", 2)] };
    const prep = assembleStudioPrep({
      sort,
      articles: [
        { articleGroup: 1, label: label({ brand: ["Levi's", 0.92], size: ["W32 L32", 0.9], reference: ["501", 0.9], material: ["100 % coton", 0.8] }), tape: tape({ waist: 41.2 }), hints: {}, reference: levis501, text: "Jean 501" },
        { articleGroup: 2, label: label({ brand: ["Zara", 0.4] }), tape: null, text: "Pull", questions: [studioQuestion("brand", "low_confidence")] },
      ],
      warnings: ["Photos triées en 1 lot."],
      simulated: true,
    });
    expect(studioPrep.safeParse(prep).success).toBe(true);
    expect(prep.accuracy.status).toBe("to_measure");
    expect(prep.articles).toHaveLength(2);
    const jean = prep.articles[0]!;
    expect(jean.garmentKind).toBe("bottom");
    expect(jean.modelPhotoIndexes).toEqual([0, 1, 2, 3]);
    expect(jean.measurements.find((m) => m.name === "waist")).toMatchObject({ valueCm: 41, source: "tape_photo" }); // arrondi au demi-centimètre
    expect(jean.measurements.find((m) => m.name === "inseam")).toMatchObject({ valueCm: 81, source: "reference_db" });
    expect(jean.sizeReference).toEqual({ brand: "Levi's", reference: "501", size: "W32 L32" });
    expect(jean.questions).toEqual([]);
    const pull = prep.articles[1]!;
    expect(pull.garmentKind).toBe("top");
    expect(pull.fields.brand.value).toBeNull();
    // La question de la validation (lecture peu sûre) est gardée pour la marque restée vide.
    expect(pull.questions.find((q) => q.field === "brand")).toMatchObject({ reason: "low_confidence" });
    expect(pull.fields.brand.question).toBe(pull.questions.find((q) => q.field === "brand")!.text);
    for (const name of ["chest", "length", "shoulders"] as const) {
      const m = pull.measurements.find((x) => x.name === name)!;
      expect(m).toMatchObject({ valueCm: null, source: null });
      expect(m.question).toMatch(/Aucun mètre ruban n'est visible/);
    }
    for (const a of prep.articles) for (const m of a.measurements) expect(m.valueCm === null).toBe(m.source === null);
  });
  it("un article sans lecture reste vide, avec ses questions", () => {
    const a = buildStudioArticle({ articleGroup: 1, photoIndexes: [0], photos: [photo(0, "front")] }, undefined);
    expect(a.fields.brand).toMatchObject({ value: null, source: null });
    expect(a.measurements).toEqual([]);
    expect(a.questions.map((q) => q.field)).toEqual(["brand", "size", "material"]);
  });
});

describe("mesures citées dans un texte rédigé : seules celles de la préparation restent", () => {
  it("extractCmValues lit « 52 cm », « 41,5cm », « 70.5 cm », pas « 48 h » ni un pourcentage", () => {
    expect(extractCmValues("Poitrine 52 cm, longueur 41,5cm et 70.5 cm ; envoi sous 48 h ; 100 % coton")).toEqual([52, 41.5, 70.5]);
    expect(extractCmValues("aucune mesure")).toEqual([]);
  });
  it("titre : la mention inventée seule est retirée (ponctuation nettoyée) ; les mesures connues restent", () => {
    expect(stripUnknownMeasurements("Pull bleu marine 68 cm taille M", [48], "title")).toEqual({ text: "Pull bleu marine taille M", removed: [68] });
    expect(stripUnknownMeasurements("Jean Levi's 501 (taille 41 cm, 81 cm)", [41, 81], "title")).toEqual({ text: "Jean Levi's 501 (taille 41 cm, 81 cm)", removed: [] });
    expect(stripUnknownMeasurements("Robe longue (120 cm)", [], "title")).toEqual({ text: "Robe longue", removed: [120] });
    // 30 cm n'est pas 30,2 cm : une valeur proche n'est pas une valeur connue.
    expect(stripUnknownMeasurements("Sac cabas - 30 cm", [30.2], "title").removed).toEqual([30]);
  });
  it("description : la phrase entière qui cite une mesure inconnue disparaît, les autres restent, paragraphes gardés", () => {
    const text = "Pull en maille torsadée. Longueur 68 cm, épaules 44 cm. Très bon état.\n\nMesures à plat : poitrine 48 cm. Envoi soigné sous 48 h.";
    expect(stripUnknownMeasurements(text, [48], "description")).toEqual({ text: "Pull en maille torsadée. Très bon état.\n\nMesures à plat : poitrine 48 cm. Envoi soigné sous 48 h.", removed: [68, 44] });
    // Une phrase mêlant une mesure connue et une inventée part aussi (le reste décrit la mesure inventée).
    expect(stripUnknownMeasurements("Poitrine 48 cm et longueur 70 cm. Très bon état.", [48], "description")).toEqual({ text: "Très bon état.", removed: [70] });
    // « 41,5 » et 41.5 sont la même mesure.
    expect(stripUnknownMeasurements("Tour de taille 41,5 cm.", [41.5], "description").removed).toEqual([]);
    // Sans mesure connue, aucune mesure ne survit.
    expect(extractCmValues(stripUnknownMeasurements("Longueur 70 cm. Manche 60cm. Coupe droite.", [], "description").text)).toEqual([]);
  });
});

describe("photos réduites : dimensions lues dans les en-têtes, sans dépendance", () => {
  it("lit JPEG (de base et progressif, après un long EXIF), PNG et WebP (VP8, VP8L, VP8X)", () => {
    expect(checkImageDimensions(bytesOf(JPEG_BASELINE_33x17))).toEqual({ format: "jpeg", width: 33, height: 17 });
    expect(checkImageDimensions(bytesOf(JPEG_PROGRESSIVE_40x25))).toEqual({ format: "jpeg", width: 40, height: 25 });
    expect(checkImageDimensions(withExif(bytesOf(JPEG_BASELINE_33x17), 60_000))).toEqual({ format: "jpeg", width: 33, height: 17 });
    expect(checkImageDimensions(bytesOf(PNG_21x13))).toEqual({ format: "png", width: 21, height: 13 });
    expect(checkImageDimensions(pngHeader(4032, 3024))).toEqual({ format: "png", width: 4032, height: 3024 });
    expect(checkImageDimensions(bytesOf(WEBP_LOSSY_30x20))).toEqual({ format: "webp", width: 30, height: 20 });
    expect(checkImageDimensions(bytesOf(WEBP_LOSSLESS_31x19))).toEqual({ format: "webp", width: 31, height: 19 });
    expect(checkImageDimensions(bytesOf(WEBP_EXTENDED_300x200))).toEqual({ format: "webp", width: 300, height: 200 });
  });
  it("refuse ce qui n'est pas une image ou un en-tête tronqué", () => {
    expect(checkImageDimensions(new TextEncoder().encode("hello"))).toBeNull();
    expect(checkImageDimensions(bytesOf(JPEG_BASELINE_33x17).subarray(0, 100))).toBeNull();
    expect(checkImageDimensions(bytesOf(PNG_21x13).subarray(0, 20))).toBeNull();
    expect(checkImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(checkImageDimensions(new Uint8Array(0))).toBeNull();
  });
  it("calcule les dimensions réduites (côté long ≤ 1 024 px, sans agrandir)", () => {
    expect(reducedDimensions(4032, 3024)).toEqual({ width: 1024, height: 768, scale: 1024 / 4032 });
    expect(reducedDimensions(3024, 4032)).toMatchObject({ width: 768, height: 1024 });
    expect(reducedDimensions(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(reducedDimensions(5000, 10)).toMatchObject({ width: 1024, height: 2 });
    expect(reducedDimensions(0, 10)).toEqual({ width: 0, height: 0, scale: 0 });
  });
  it("décode le base64 (et base64url, data URL) comme Node, sans dépendance", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 200 }), (bytes) => {
        const b64 = toB64(bytes);
        expect([...decodeBase64(b64)!]).toEqual([...bytes]);
        expect([...decodeBase64(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))!]).toEqual([...bytes]);
        expect(base64ByteLength(b64)).toBe(bytes.length);
      }),
    );
    expect([...decodeBase64(`data:image/png;base64,${PNG_21x13}`, 8)!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(decodeBase64("@@@@")).toBeNull();
  });
  it("vérification serveur : format reconnu, côté long ≤ 1 024 px, poids ≤ 1 Mo ; sinon refus explicite", () => {
    expect(checkModelImage(toB64(pngHeader(1024, 768)))).toMatchObject({ ok: true, format: "png", width: 1024, height: 768 });
    expect(checkModelImage(`data:image/jpeg;base64,${JPEG_BASELINE_33x17}`)).toMatchObject({ ok: true, format: "jpeg" });
    expect(checkModelImage(toB64(withExif(bytesOf(JPEG_BASELINE_33x17), 60_000)))).toMatchObject({ ok: true, width: 33, height: 17 });
    const big = checkModelImage(toB64(pngHeader(4032, 3024)));
    expect(big).toMatchObject({ ok: false, code: "too_large", width: 4032 });
    expect(!big.ok && big.reason).toMatch(/réduisez-la/);
    expect(checkModelImage(toB64(new Uint8Array(1_200_000)))).toMatchObject({ ok: false, code: "too_heavy" });
    expect(checkModelImage("aGVsbG8=")).toMatchObject({ ok: false, code: "unreadable" });
    expect(checkModelImage(bytesOf(PNG_21x13))).toMatchObject({ ok: true, bytes: bytesOf(PNG_21x13).length });
  });
});
