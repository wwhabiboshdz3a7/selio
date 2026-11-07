import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AIError, createAIService, loadAIConfig } from "@selio/ai";
import { STUDIO_ACCURACY_TARGETS } from "@selio/contracts";
import { emptyTally } from "./compare";
import { loadDataset } from "./dataset";
import { DirectReader } from "./readers";
import { objectiveLine, renderReport, reportFileName } from "./report";
import { runEval } from "./run";
import { FakeAI, fakeJpeg, writeDataset } from "./testing";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function sampleDataset(): Promise<string> {
  const dir = await writeDataset({
    labelsCsv: "photo;brand;size;material;reference\ne1.jpg;Levi's;W32 L32;;04511\ne2.jpg;Zara;M;coton;\ne3.jpg;Nike;42;;\ngrande.jpg;Adidas;L;;\n",
    labelPhotos: { "e1.jpg": fakeJpeg(800, 600), "e2.jpg": fakeJpeg(1024, 768), "e3.jpg": fakeJpeg(640, 480), "grande.jpg": fakeJpeg(1600, 1200) },
    tapesCsv: "article;garmentKind;photos;chest;length;waist\nA1;top;a1-1.jpg|a1-2.jpg;52;68;\nA2;bottom;a2.jpg;;;41\n",
    tapePhotos: { "a1-1.jpg": fakeJpeg(900, 900), "a1-2.jpg": fakeJpeg(900, 900), "a2.jpg": fakeJpeg(700, 500) },
  });
  dirs.push(dir);
  return dir;
}

describe("runEval", () => {
  it("lit chaque étiquette et chaque article, écarte les photos trop grandes, compare et compte", async () => {
    const dataset = await loadDataset(await sampleDataset());
    const ai = new FakeAI(
      [
        { brand: { value: "LEVIS" }, size: { value: "W32/L32" }, reference: { value: "04511" } },
        { brand: { value: "Zara" }, size: { value: "S" } },
        { material: { value: "cuir" } },
      ],
      [{ measurements: [{ name: "chest", valueCm: 52.5 }, { name: "length", valueCm: 71 }, { name: "sleeve", valueCm: 60 }] }, { tapeVisible: false }],
    );
    const lines: string[] = [];
    const r = await runEval({ dataset, reader: new DirectReader(ai), ocr: true, log: (l) => lines.push(l), now: () => new Date("2026-11-06T10:00:00Z") });

    expect(r.generatedAt).toBe("2026-11-06T10:00:00.000Z");
    expect(r.simulated).toBe(false);
    expect(r.stopped).toBeNull();
    expect(ai.labelCalls.map((c) => c.ocrFallback)).toEqual([true, true, true]);
    expect(r.labels.total).toBe(4);
    expect(r.labels.cases.map((c) => c.photo)).toEqual(["e1.jpg", "e2.jpg", "e3.jpg"]);
    expect(r.labels.skipped).toEqual([{ id: "E004", photo: "grande.jpg", reason: expect.stringMatching(/^too_large : /) }]);
    expect(r.labels.tally.brand).toEqual({ expected: 3, correct: 2, wrong: 0, unread: 1, unexpected: 0 });
    expect(r.labels.tally.size).toEqual({ expected: 3, correct: 1, wrong: 1, unread: 1, unexpected: 0 });
    expect(r.labels.tally.material).toEqual({ expected: 1, correct: 0, wrong: 0, unread: 1, unexpected: 0 });
    expect(r.labels.tally.reference).toEqual({ expected: 1, correct: 1, wrong: 0, unread: 0, unexpected: 0 });
    expect(r.labels.brandAndSize).toEqual({ expected: 6, correct: 3, wrong: 1, unread: 2, unexpected: 0 });
    expect(r.labels.latencyMs).toEqual([120, 120, 120]);

    expect(ai.tapeCalls.map((c) => [c.images.length, c.garmentKind])).toEqual([
      [2, "top"],
      [1, "bottom"],
    ]);
    expect(r.measures.cases).toHaveLength(2);
    expect(r.measures.noTape).toBe(1);
    expect(r.measures.tally).toEqual({ expected: 3, correct: 1, wrong: 1, unread: 1, unexpected: 1 });
    expect(r.measures.byName.chest.correct).toBe(1);
    expect(r.measures.byName.length.wrong).toBe(1);
    expect(r.measures.byName.waist.unread).toBe(1);
    expect(r.measures.byName.sleeve.unexpected).toBe(1);
    expect(lines.some((l) => l.includes("[étiquettes 2/4] e2.jpg") && l.includes("taille : FAUSSE"))).toBe(true);
    expect(lines.some((l) => l.includes("grande.jpg : écartée"))).toBe(true);
    expect(lines.some((l) => l.includes("[mesures 2/2] A2 · aucun mètre ruban vu"))).toBe(true);
  });

  it("s'arrête sur une erreur fatale du lecteur et le dit ; une erreur de cas n'arrête pas", async () => {
    const dataset = await loadDataset(await sampleDataset());
    const ai = new FakeAI([new AIError("input_rejected", "photo illisible"), { brand: { value: "Zara" } }, new AIError("unavailable", "Ollama injoignable", true)]);
    const r = await runEval({ dataset, reader: new DirectReader(ai), ocr: false });
    expect(r.labels.errors.map((e) => [e.photo, e.code])).toEqual([
      ["e1.jpg", "input_rejected"],
      ["e3.jpg", "unavailable"],
    ]);
    expect(r.labels.cases.map((c) => c.photo)).toEqual(["e2.jpg"]);
    expect(r.stopped).toMatch(/^Arrêt sur une erreur du lecteur \(unavailable\)/);
    expect(r.measures.cases).toHaveLength(0);
    expect(ai.tapeCalls).toHaveLength(0);
  });

  it("s'arrête après trop d'erreurs consécutives", async () => {
    const dataset = await loadDataset(await sampleDataset());
    const ai = new FakeAI([new AIError("timeout", "1", true), new AIError("timeout", "2", true), new AIError("timeout", "3", true)]);
    const r = await runEval({ dataset, reader: new DirectReader(ai), ocr: true, maxConsecutiveErrors: 2 });
    expect(r.labels.errors).toHaveLength(2);
    expect(r.stopped).toBe("Arrêt après 2 erreurs consécutives (dernière : timeout).");
  });

  it("avec le simulateur du dépôt (AI_PROVIDER=mock), rien n'est lu et le résultat est marqué simulé", async () => {
    const dataset = await loadDataset(await sampleDataset());
    const service = createAIService({ config: loadAIConfig({ AI_PROVIDER: "mock" }), allowFallback: false });
    const r = await runEval({ dataset, reader: new DirectReader(service), ocr: true });
    expect(r.simulated).toBe(true);
    expect(r.reader.provider).toBe("mock");
    expect(r.labels.cases).toHaveLength(3);
    expect(r.labels.brandAndSize).toEqual({ expected: 6, correct: 0, wrong: 0, unread: 6, unexpected: 0 });
    expect(r.measures.noTape).toBe(2);
    expect(r.measures.tally.correct).toBe(0);
  });
});

describe("renderReport", () => {
  it("rapport en français : conditions, tableaux, objectifs, lectures fausses, photos écartées, aucune image ni secret", async () => {
    const dataset = await loadDataset(await sampleDataset());
    const ai = new FakeAI(
      [
        { brand: { value: "Levi's" }, size: { value: "W32 L32" }, reference: { value: "04511" } },
        { brand: { value: "Zara" }, size: { value: "S", confidence: 0.77 } },
        { brand: { value: "Nike" }, size: { value: "42" } },
      ],
      [{ measurements: [{ name: "chest", valueCm: 52 }, { name: "length", valueCm: 71, confidence: 0.8 }] }, { measurements: [{ name: "waist", valueCm: 41 }] }],
    );
    const r = await runEval({ dataset, reader: new DirectReader(ai), ocr: true, now: () => new Date("2026-11-06T10:00:00Z") });
    const md = renderReport(r);
    expect(md).toContain("# Studio — validation de la lecture des étiquettes et des mesures");
    expect(md).not.toContain("SIMULATEUR");
    expect(md).toContain("- Modèle 1 (photos) : vision-factice · modèle de texte : texte-factice");
    expect(md).toContain("- Jeu : 4 photo(s) d'étiquette (protocole : 200) · 2 article(s) avec mètre ruban (protocole : 50)");
    expect(md).toContain("| **Marques et tailles** | 6 | 5 | 1 | 0 | 83,3 % | 83,3 % |");
    expect(md).toContain("**Marques et tailles justes : 83,3 % (objectif ≥ 95,0 %) — non atteint.** Échantillon de 3 (protocole : 200) : à confirmer sur le jeu complet.");
    expect(md).toContain("- e2.jpg · Taille : attendu « M », lu « S » (confiance 0,77)");
    expect(md).toContain("| **Toutes** | 3 | 2 | 1 | 0 | 0 | 66,7 % | 66,7 % |");
    expect(md).toContain("- A1 (a1-1.jpg, a1-2.jpg) · Longueur : attendu 68 cm, lu 71 cm (confiance 0,80)");
    expect(md).toContain("- grande.jpg : too_large");
    expect(md).toContain("| Étiquette (1 photo) | 3 | 120 ms | 120 ms |");
    expect(md).toContain("à mesurer");
    expect(md).not.toContain("base64");
    expect(md).not.toContain("mot-de-passe");
  });

  it("avec le simulateur, le rapport dit en tête qu'il ne mesure rien et aucun objectif n'est jugé", async () => {
    const dataset = await loadDataset(await sampleDataset());
    const ai = new FakeAI([{ brand: { value: "Levi's" } }]);
    ai.simulated = true;
    const md = renderReport(await runEval({ dataset, reader: new DirectReader(ai), ocr: true }));
    expect(md).toContain("> **SIMULATEUR — CE RAPPORT NE MESURE RIEN.**");
    expect(md).toContain("**Marques et tailles justes : non mesuré (simulateur).**");
    expect(md).toContain("**Mesures justes à 1 cm près : non mesuré (simulateur).**");
    expect(md).not.toMatch(/— (atteint|non atteint)\./);
  });

  it("signale un protocole interrompu et les lignes de vérité ignorées", async () => {
    const dir = await writeDataset({ labelsCsv: "photo;brand\ne1.jpg;Zara\nabsente.jpg;Nike\n", labelPhotos: { "e1.jpg": fakeJpeg(10, 10) } });
    dirs.push(dir);
    const dataset = await loadDataset(dir);
    const md = renderReport(await runEval({ dataset, reader: new DirectReader(new FakeAI([new AIError("config", "aucun modèle de vision")])), ocr: true }));
    expect(md).toContain("> **Protocole interrompu.** Arrêt sur une erreur du lecteur (config) : aucun modèle de vision");
    expect(md).toContain("## Lignes de vérité ignorées (1)");
    expect(md).toContain("- etiquettes : ligne 3 : photo « absente.jpg » introuvable, ligne ignorée");
    expect(md).toContain("- e1.jpg : config — aucun modèle de vision");
  });

  it("objectifs : atteint au seuil, non mesurable sans attendue ; nom de fichier daté", () => {
    const t = { ...emptyTally(), expected: 200, correct: 190 };
    expect(objectiveLine("X", t, STUDIO_ACCURACY_TARGETS.brandAndSizeRate, 200, 200, false)).toBe("**X : 95,0 % (objectif ≥ 95,0 %) — atteint.**");
    expect(objectiveLine("X", emptyTally(), 0.9, 0, 50, false)).toBe("**X : non mesurable (aucune valeur attendue dans le jeu).**");
    expect(reportFileName(new Date(2026, 10, 6, 9, 5))).toBe("2026-11-06-0905-studio-eval.md");
  });
});
