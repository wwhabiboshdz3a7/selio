import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_NAMES, PHOTO_ROLES, STUDIO_ACCURACY_TARGETS, STUDIO_ACCURACY_TO_MEASURE_LABEL, STUDIO_LABEL_MAX_PHOTOS, STUDIO_MODEL_JPEG_QUALITY, STUDIO_MODEL_MAX_PHOTOS, STUDIO_MODEL_MAX_SIDE_PX, STUDIO_TAPE_MAX_PHOTOS,
  WORN_PHOTO_STATUSES, labelReadOutput, measurementField, measurementsOutput, namedMeasurementField, photoSortOutput, sizeReference, studioPrep, studioTextField, wornPhotoJob,
} from "./index";

describe("Studio façon Kavis : limites et objectifs", () => {
  it("4 à 6 photos réduites par appel (côté long 1 024 px, JPEG ≈ 80), 1 à 2 étiquettes, 3 photos de mètre au plus", () => {
    expect(STUDIO_MODEL_MAX_PHOTOS).toBe(6);
    expect(STUDIO_MODEL_MAX_SIDE_PX).toBe(1024);
    expect(STUDIO_MODEL_JPEG_QUALITY).toBe(0.8);
    expect(STUDIO_LABEL_MAX_PHOTOS).toBe(2);
    expect(STUDIO_TAPE_MAX_PHOTOS).toBe(3);
  });
  it("les objectifs de précision restent « à mesurer » tant qu'aucun rapport n'existe", () => {
    expect(STUDIO_ACCURACY_TARGETS).toMatchObject({ brandAndSizeRate: 0.95, measurementRate: 0.9, measurementToleranceCm: 1, protocol: { labelPhotos: 200, tapeArticles: 50 } });
    expect(STUDIO_ACCURACY_TO_MEASURE_LABEL).toMatch(/à mesurer/);
    const prep = studioPrep.parse({ photos: [], articles: [], warnings: [] });
    expect(prep.accuracy).toEqual({ status: "to_measure", brandAndSizeRate: null, measurementRate: null, reportDate: null });
    expect(prep.ocr).toEqual({ configured: false, used: false });
  });
});

describe("sorties du modèle 1 : tolérantes à la forme, jamais à l'invention", () => {
  it("tri : rôle inconnu → « other », confiance en pourcentage ramenée à 0–1, confiance illisible → 0", () => {
    const out = photoSortOutput.parse({ photos: [{ index: 0, role: "selfie", articleGroup: 1, confidence: 85 }, { index: 1, role: "label", articleGroup: 2, confidence: "haute" }] });
    expect(out.photos[0]).toEqual({ index: 0, role: "other", articleGroup: 1, confidence: 0.85 });
    expect(out.photos[1]).toMatchObject({ role: "label", confidence: 0 });
    expect(PHOTO_ROLES).toEqual(["front", "back", "label", "detail", "defect", "tape", "other"]);
  });
  it("étiquette : une valeur seule ou d'une autre provenance n'est pas « lue sur l'étiquette »", () => {
    const out = labelReadOutput.parse({
      brand: "Levi's",
      size: { value: "W32", confidence: 0.9, readFrom: "style" },
      material: null,
      reference: { value: "  ", confidence: 0.9, readFrom: "label" },
    });
    expect(out.brand).toEqual({ value: "Levi's", confidence: 0, readFrom: null });
    expect(out.size).toEqual({ value: "W32", confidence: 0.9, readFrom: null });
    expect(out.material).toEqual({ value: null, confidence: 0, readFrom: null });
    expect(out.reference.value).toBeNull();
    expect(out.text).toBeNull();
  });
  it("mesures : nom inconnu ignoré, preuve autre que « tape_photo » → null (la validation l'écartera)", () => {
    const out = measurementsOutput.parse({
      tapeVisible: true,
      measurements: [
        { name: "chest", valueCm: 52, confidence: 0.9, evidence: "tape_photo" },
        { name: "neck", valueCm: 40, confidence: 0.9, evidence: "tape_photo" },
        { name: "length", valueCm: 70, confidence: 0.9, evidence: "estimation" },
      ],
    });
    expect(out.measurements).toEqual([
      { name: "chest", valueCm: 52, confidence: 0.9, evidence: "tape_photo" },
      { name: "length", valueCm: 70, confidence: 0.9, evidence: null },
    ]);
    expect(measurementsOutput.parse({}).tapeVisible).toBe(false);
    expect(MEASUREMENT_NAMES).toEqual(["chest", "length", "shoulders", "sleeve", "waist", "hips", "inseam", "rise", "sole"]);
  });
});

describe("champs avec provenance", () => {
  it("une mesure porte toujours sa provenance ; sans provenance, elle reste vide", () => {
    expect(measurementField.safeParse({ valueCm: 52, source: "tape_photo", confidence: 0.9 }).success).toBe(true);
    expect(measurementField.safeParse({ valueCm: 52, source: null }).success).toBe(false);
    expect(measurementField.safeParse({ valueCm: null, source: "seller" }).success).toBe(false);
    expect(measurementField.safeParse({ valueCm: null, source: null, question: "Mesurez la poitrine." }).success).toBe(true);
    expect(measurementField.safeParse({ valueCm: 52, source: "eye" }).success).toBe(false);
    expect(namedMeasurementField.safeParse({ name: "sole", valueCm: 27, source: "reference_db" }).success).toBe(true);
    expect(namedMeasurementField.safeParse({ name: "sole", valueCm: 27, source: null }).success).toBe(false);
  });
  it("marque, taille, matière, référence : lues sur l'étiquette ou indiquées par le vendeur, sinon vides", () => {
    expect(studioTextField.safeParse({ value: "Levi's", source: "label", confidence: 0.9 }).success).toBe(true);
    expect(studioTextField.safeParse({ value: "Levi's", source: null }).success).toBe(false);
    expect(studioTextField.safeParse({ value: "Levi's", source: "style" }).success).toBe(false);
    expect(studioTextField.safeParse({ value: null, source: null, question: "Quelle est la marque ?" }).success).toBe(true);
  });
  it("base des références : mesures en cm par grandeur connue seulement", () => {
    expect(sizeReference.parse({ brand: "Levi's", reference: "501", size: "W32 L32", category: "bottom", measurements: { waist: 41, inseam: 81 } })).toMatchObject({ size: "W32 L32", measurements: { waist: 41, inseam: 81 } });
    expect(sizeReference.safeParse({ brand: "Levi's", reference: "501", category: "bottom", measurements: { neck: 40 } }).success).toBe(false);
    expect(sizeReference.parse({ brand: "Longchamp", reference: "Le Pliage", category: "bag", measurements: {} }).size).toBeNull();
  });
});

describe("photos portées : file de nuit, fournisseur à choisir", () => {
  it("une demande en file a une photo source, un fournisseur et un créneau ; statut connu seulement", () => {
    const base = { id: "w1", orgId: "o1", photoKey: "org/o1/studio-photo/a.jpg", status: "queued", provider: "noop", scheduledFor: "2026-11-04T21:00:00.000Z", createdAt: "2026-11-04T10:00:00.000Z" };
    expect(wornPhotoJob.parse(base)).toMatchObject({ itemId: null, resultKey: null, error: null });
    expect(wornPhotoJob.parse({ ...base, status: "refused", error: "Aucun service de photos portées n'est choisi." }).status).toBe("refused");
    expect(wornPhotoJob.safeParse({ ...base, status: "paid" }).success).toBe(false);
    expect(WORN_PHOTO_STATUSES).toEqual(["queued", "running", "done", "failed", "refused"]);
  });
});
