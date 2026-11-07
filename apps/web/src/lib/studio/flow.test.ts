import { describe, expect, it } from "vitest";
import type { StudioTextField } from "@selio/contracts";
import type { StudioPrepArticleView, StudioPrepResultView } from "../data/types";
import { assignmentChanged, assignmentFrom, coverFirst, fieldQuestion, groupsFrom, measurementQuestion, mergeUiPreps, nextGroup, openQuestionsCount, toUiPrep } from "./flow";

const field = (value: string | null, source: StudioTextField["source"] = value ? "label" : null, confidence?: number, question?: string): StudioTextField => ({ value, source, ...(confidence !== undefined ? { confidence } : {}), ...(question ? { question } : {}) });

function article(prepId: string, articleGroup: number, photoIndexes: number[], over: Partial<StudioPrepArticleView> = {}): StudioPrepArticleView {
  return {
    prepId,
    status: "draft",
    articleGroup,
    photoIndexes,
    modelPhotoIndexes: photoIndexes.slice(0, 6),
    garmentKind: "bottom",
    fields: { brand: field("Levi's", "label", 0.92), size: field("W32 L32", "label", 0.9), material: field(null, null, undefined, "Quelle est la composition ?"), reference: field("501", "label", 0.85) },
    careSymbols: [],
    tapeVisible: true,
    measurements: [
      { name: "waist", valueCm: 41, source: "tape_photo", confidence: 0.88 },
      { name: "inseam", valueCm: null, source: null, question: "Mesurez l'entrejambe." },
    ],
    sizeReference: null,
    questions: [
      { field: "material", reason: "missing", text: "Quelle est la composition ?" },
      { field: "inseam", reason: "missing", text: "Mesurez l'entrejambe." },
    ],
    warnings: [],
    ...over,
  };
}

/** Deux articles : un jean (face, étiquette, mètre ruban) et un pull (face). */
const result: StudioPrepResultView = {
  batchId: "lot-1",
  photos: [
    { index: 0, role: "front", articleGroup: 1, confidence: 0.9 },
    { index: 1, role: "label", articleGroup: 1, confidence: 0.95 },
    { index: 2, role: "tape", articleGroup: 1, confidence: 0.8 },
    { index: 3, role: "front", articleGroup: 2, confidence: 0.7 },
  ],
  articles: [article("prep-jean", 1, [0, 1, 2]), article("prep-pull", 2, [3], { garmentKind: "top", tapeVisible: false, measurements: [], questions: [] })],
  warnings: ["Vérifiez le regroupement des photos par article."],
  simulated: true,
  ocr: { configured: false, used: false },
  accuracy: { status: "to_measure", brandAndSizeRate: null, measurementRate: null, reportDate: null },
};
const sent = ["a", "b", "c", "d"];

describe("préparation vue par l'écran", () => {
  it("relie chaque article à ses photos (identifiants du navigateur) et à leurs rôles", () => {
    const ui = toUiPrep(result, sent);
    expect(ui.articles.map((a) => a.prepId)).toEqual(["prep-jean", "prep-pull"]);
    expect(ui.articles[0]!.photoIds).toEqual(["a", "b", "c"]);
    expect(ui.articles[0]!.roles).toEqual({ a: { role: "front", confidence: 0.9, source: "model" }, b: { role: "label", confidence: 0.95, source: "model" }, c: { role: "tape", confidence: 0.8, source: "model" } });
    // La provenance du rôle est celle posée par le serveur (« seller » quand le vendeur l'a indiqué), jamais déduite de la confiance.
    const seller = toUiPrep({ ...result, photos: result.photos.map((p, i) => (i === 1 ? { ...p, confidence: 1, roleSource: "seller" as const } : i === 0 ? { ...p, confidence: 1 } : p)) }, sent);
    expect(seller.articles[0]!.roles.b).toEqual({ role: "label", confidence: 1, source: "seller" });
    expect(seller.articles[0]!.roles.a).toEqual({ role: "front", confidence: 1, source: "model" });
    expect(ui.articles[1]!.photoIds).toEqual(["d"]);
    expect(ui).toMatchObject({ simulated: true, warnings: result.warnings, accuracy: { status: "to_measure" } });
    // Un index sans photo envoyée est ignoré plutôt qu'inventé.
    expect(toUiPrep(result, ["a", "b"]).articles[0]!.photoIds).toEqual(["a", "b"]);
  });

  it("réunit plusieurs relectures sans doubler les avertissements", () => {
    const ui = toUiPrep(result, sent);
    const merged = mergeUiPreps([ui, { ...ui, ocr: { configured: true, used: true } }]);
    expect(merged.articles).toHaveLength(4);
    expect(merged.warnings).toEqual(result.warnings);
    expect(merged.ocr).toEqual({ configured: true, used: true });
    expect(mergeUiPreps([]).accuracy.status).toBe("to_measure");
  });
});

describe("tri corrigé par le vendeur", () => {
  it("part du tri du modèle ; déplacer une photo ou changer son rôle est détecté", () => {
    const ui = toUiPrep(result, sent);
    const a = assignmentFrom(ui);
    expect(a).toEqual({ a: { group: 1, role: "front" }, b: { group: 1, role: "label" }, c: { group: 1, role: "tape" }, d: { group: 2, role: "front" } });
    expect(assignmentChanged(ui, a)).toBe(false);
    expect(assignmentChanged(ui, { ...a, c: { group: 2, role: "tape" } })).toBe(true);
    expect(assignmentChanged(ui, { ...a, b: { group: 1, role: "detail" } })).toBe(true);
  });

  it("renumérote les articles dans l'ordre des photos et oublie un article vide", () => {
    const groups = groupsFrom({ a: { group: 3, role: "front" }, b: { group: 1, role: "label" }, c: { group: 3, role: "tape" } }, ["a", "b", "c", "zz"]);
    expect(groups).toEqual([{ group: 1, photoIds: ["a", "c"] }, { group: 2, photoIds: ["b"] }]);
    expect(nextGroup({ a: { group: 3, role: "front" } })).toBe(4);
    expect(nextGroup({})).toBe(1);
  });

  it("la couverture est la face ; étiquette et mètre ruban passent après", () => {
    const roles = { a: { role: "tape" as const, confidence: 1, source: "seller" as const }, b: { role: "label" as const, confidence: 1, source: "model" as const }, c: { role: "front" as const, confidence: 1, source: "model" as const }, d: { role: "back" as const, confidence: 1, source: "model" as const } };
    expect(coverFirst(["a", "b", "c", "d"], roles)).toEqual(["c", "d", "b", "a"]);
  });
});

describe("questions au vendeur", () => {
  it("un champ de l'étiquette vide pose sa question ; un champ lu n'en a pas", () => {
    const art = result.articles[0]!;
    expect(fieldQuestion(art, "material")).toBe("Quelle est la composition ?");
    expect(fieldQuestion(art, "brand")).toBeNull();
    // Vidé à l'écran par le vendeur, ou vide sans question du serveur : la question standard, jamais une valeur proposée.
    expect(fieldQuestion(art, "brand", { cleared: true })).toMatch(/^Quelle est la marque \?/);
    expect(fieldQuestion({ ...art, fields: { ...art.fields, size: field(null) }, questions: [] }, "size")).toMatch(/^Quelle taille est indiquée sur l'étiquette/);
    expect(fieldQuestion({ ...art, fields: { ...art.fields, material: field(null, null, undefined, "Composition ?") } }, "material")).toBe("Composition ?");
    expect(openQuestionsCount(art)).toBe(2);
  });

  it("une mesure vide pose toujours une question, jamais une valeur proposée", () => {
    const art = result.articles[0]!;
    expect(measurementQuestion(art, art.measurements[1]!)).toBe("Mesurez l'entrejambe.");
    expect(measurementQuestion(art, art.measurements[0]!)).toBeNull();
    // Mesure ajoutée à l'écran (sans question du serveur) : question standard, selon que le ruban était visible.
    expect(measurementQuestion({ questions: [], tapeVisible: true }, { name: "rise", valueCm: null, source: null })).toMatch(/^Mesurez le montant/);
    expect(measurementQuestion({ questions: [], tapeVisible: false }, { name: "rise", valueCm: null, source: null })).toMatch(/Aucun mètre ruban n'est visible/);
    // Question de la liste quand la mesure n'en porte pas.
    expect(measurementQuestion({ questions: [{ field: "rise", reason: "no_tape", text: "Montant ?" }], tapeVisible: false }, { name: "rise", valueCm: null, source: null })).toBe("Montant ?");
  });
});
