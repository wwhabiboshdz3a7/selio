import { cleanReferences } from "./clean";
import { loadPriceModel, predictDelay, predictPrice, serializePriceModel } from "./predict";
import { flatMetrics, formatTrainingReport, modelStatus } from "./report";
import { generateSyntheticReferences } from "./synthetic";
import { MIN_REFERENCES, resolveParams, trainPriceModel } from "./train";
import { FORBIDDEN_REFERENCE_KEYS, type PriceFeatures, type PriceReference, type SerializedPriceModel } from "./types";

const NOW = "2026-10-30T12:00:00Z";

const ITEMS: PriceFeatures[] = [
  { brand: "Levi's", category: "Jeans", subcategory: "Jean droit", size: "W32", material: "Denim", condition: "Très bon état", listedAt: "2026-11-02", photoCount: 6 },
  { brand: "Zara", category: "Robes", subcategory: "Robe midi", size: "38", material: "Viscose", condition: "Bon état", listedAt: "2026-06-15", photoCount: 4 },
  { brand: "The North Face", category: "Manteaux", subcategory: "Doudoune", size: "M", material: "Nylon", condition: "Neuf avec étiquette", listedAt: "2026-12-01", photoCount: 8 },
  { brand: "Marque inconnue", category: "T-shirts", size: "L", condition: "Satisfaisant" },
  { brand: "Nike", category: "Baskets", subcategory: "Baskets basses", size: "42,5", material: "Cuir", condition: "new", listedAt: "2026-04-10", photoCount: 5 },
];

describe("données synthétiques", () => {
  it("reproductibles, toutes « demo », sans aucun champ personnel", () => {
    const a = generateSyntheticReferences({ n: 500, seed: 11 });
    const b = generateSyntheticReferences({ n: 500, seed: 11 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(500);
    expect(a.every((r) => r.source === "demo")).toBe(true);
    const forbidden = new Set<string>(FORBIDDEN_REFERENCE_KEYS);
    expect(a.some((r) => Object.keys(r).some((k) => forbidden.has(k)))).toBe(false);
  });

  it("les lignes sales sont toutes écartées par le nettoyage", () => {
    const refs = generateSyntheticReferences({ n: 2000, seed: 12, dirtyShare: 0.05 });
    const clean = generateSyntheticReferences({ n: 2000, seed: 12, dirtyShare: 0 });
    const { report } = cleanReferences(refs, { now: NOW });
    const dropped = Object.values(report.dropped).reduce((s, v) => s + v, 0);
    expect(dropped).toBeGreaterThanOrEqual(100);
    expect(report.dropped.duplicate).toBeGreaterThan(0);
    expect(report.dropped.price_too_low).toBeGreaterThan(0);
    expect(report.dropped.price_too_high).toBeGreaterThan(0);
    expect(report.dropped.negative_delay).toBeGreaterThan(0);
    expect(report.dropped.bundle).toBeGreaterThan(0);
    expect(report.dropped.invalid_condition).toBeGreaterThan(0);
    expect(clean).toHaveLength(2000);
  });
});

describe("trainPriceModel sur 20 000 références synthétiques", () => {
  let model: SerializedPriceModel;
  let report: ReturnType<typeof trainPriceModel>["report"];

  beforeAll(() => {
    const out = trainPriceModel(generateSyntheticReferences({ n: 20_000, seed: 7 }), { now: NOW, seed: 42 });
    expect(out.model).not.toBeNull();
    model = out.model!;
    report = out.report;
  });

  it("erreur médiane < 25 % et couverture P25–P75 entre 35 % et 65 % sur le dernier mois jamais vu", () => {
    expect(report.insufficient).toBe(false);
    expect(report.nHoldout).toBeGreaterThan(500);
    const m = report.metrics.price!;
    expect(m.mdape).toBeLessThan(0.25);
    expect(m.coverage50).toBeGreaterThan(0.35);
    expect(m.coverage50).toBeLessThan(0.65);
    expect(m.within20).toBeGreaterThan(0.4);
    // Le modèle fait mieux que la médiane de la marque et de la catégorie.
    expect(m.mdape).toBeLessThan(m.baselineMdape!);
    expect(report.metrics.delay).not.toBeNull();
    expect(model.models.delay).not.toBeNull();
  });

  it("le test porte sur le dernier mois, jamais vu à l'entraînement", () => {
    expect(report.holdout.to).toBe(new Date(NOW).toISOString());
    expect(Date.parse(report.holdout.to) - Date.parse(report.holdout.from)).toBe(30 * 86_400_000);
    expect(model.trainedUntil).toBe(report.holdout.from);
    expect(report.nTrain + report.nValidation + report.nHoldout).toBe(report.usable);
  });

  it("marqué « données de démonstration » : jamais présenté comme mesuré", () => {
    expect(model.dataOrigin).toBe("demo");
    expect(modelStatus(model)).toBe("demo_data");
    expect(modelStatus(null)).toBe("not_trained");
    expect(modelStatus({ ...model, dataOrigin: "real", metrics: { price: null, delay: null } })).toBe("unmeasured");
    expect(modelStatus({ ...model, dataOrigin: "real" })).toBe("measured");
    expect(formatTrainingReport(report)).toMatch(/DÉMONSTRATION/);
    const flat = flatMetrics(report);
    expect(flat).toMatchObject({ dataOrigin: "demo", measured: false, insufficient: false, mdape: report.metrics.price!.mdape });
    expect(Object.values(flat).every((v) => v === null || ["number", "string", "boolean"].includes(typeof v))).toBe(true);
    const p = predictPrice(model, ITEMS[0]!);
    expect(p.dataOrigin).toBe("demo");
    expect(p.confidence).toBe("low");
  });

  it("prédit trois quantiles ordonnés, un délai et des facteurs d'explication", () => {
    for (const item of ITEMS) {
      const p = predictPrice(model, item, { explain: true });
      expect(p.method).toBe("model");
      expect(p.p25).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p75);
      expect(p.p25).toBeGreaterThan(100);
      expect(p.delayDays).not.toBeNull();
      expect(p.delayAt).not.toBeNull();
      expect(p.factors!.map((f) => f.key)).toEqual(expect.arrayContaining(["brand", "condition", "size", "season", "model_error"]));
    }
    // Ordres de grandeur attendus de la structure synthétique.
    const tnf = predictPrice(model, ITEMS[2]!).p50;
    const tee = predictPrice(model, ITEMS[3]!).p50;
    expect(tnf).toBeGreaterThan(3 * tee);
    const nwt = predictPrice(model, { ...ITEMS[0]!, condition: "Neuf avec étiquette" }).p50;
    const worn = predictPrice(model, { ...ITEMS[0]!, condition: "Satisfaisant" }).p50;
    expect(nwt).toBeGreaterThan(worn);
    const brand = predictPrice(model, ITEMS[0]!, { explain: true }).factors!.find((f) => f.key === "brand")!;
    expect(brand.support).toBeGreaterThan(50);
  });

  it("un prix affiché plus haut allonge le délai estimé", () => {
    const p = predictPrice(model, ITEMS[0]!);
    const slow = predictDelay(model, ITEMS[0]!, p.p50 * 2)!;
    const fast = predictDelay(model, ITEMS[0]!, Math.round(p.p50 * 0.6))!;
    expect(slow).toBeGreaterThan(fast);
    expect(predictDelay(model, ITEMS[0]!, 0)).toBeNull();
  });

  it("JSON versionné : rechargé, il donne exactement les mêmes prédictions", () => {
    const json = serializePriceModel(model);
    const reloaded = loadPriceModel(json);
    expect(reloaded.format).toBe("selio-price-model");
    expect(reloaded.version).toBe(1);
    for (const item of ITEMS) expect(predictPrice(reloaded, item, { explain: true })).toEqual(predictPrice(model, item, { explain: true }));
    expect(() => loadPriceModel({ ...JSON.parse(json), version: 2 })).toThrow(/version/);
    expect(() => loadPriceModel({ format: "autre" })).toThrow(/format/);
  });

  it("le modèle ne contient aucune donnée personnelle", () => {
    const json = serializePriceModel(model);
    expect(json).not.toMatch(/pseudo|seller|vinted\.fr|https?:/i);
  });

  it("prédiction en moins de 5 ms par article", () => {
    const n = 500;
    const started = performance.now();
    for (let i = 0; i < n; i++) predictPrice(model, ITEMS[i % ITEMS.length]!);
    expect((performance.now() - started) / n).toBeLessThan(5);
  });
});

describe("trainPriceModel : garde-fous", () => {
  it("refuse d'entraîner sous 500 références (300 synthétiques)", () => {
    const { model, report } = trainPriceModel(generateSyntheticReferences({ n: 300, seed: 1 }), { now: NOW });
    expect(model).toBeNull();
    expect(report.insufficient).toBe(true);
    expect(report.reason).toMatch(/500/);
    expect(report.metrics).toEqual({ price: null, delay: null });
    expect(report.nTrain).toBeLessThan(MIN_REFERENCES);
    expect(formatTrainingReport(report)).toMatch(/MODÈLE NON ENTRAÎNÉ/);
    expect(flatMetrics(report)).toMatchObject({ insufficient: true, measured: false, mdape: null, delayMdaeDays: null });
  });

  it("base vide : modèle non entraîné", () => {
    const { model, report } = trainPriceModel([], { now: NOW });
    expect(model).toBeNull();
    expect(report.insufficient).toBe(true);
    expect(report.dataOrigin).toBe("real");
  });

  it("mois de test sans ventes : modèle entraîné, erreur non mesurée", () => {
    const refs = generateSyntheticReferences({ n: 1500, seed: 5, now: "2026-06-30T12:00:00Z" });
    const { model, report } = trainPriceModel(refs, { now: "2026-09-30T12:00:00Z", seed: 3 });
    expect(model).not.toBeNull();
    expect(report.metrics.price).toBeNull();
    expect(model!.metrics.price).toBeNull();
    expect(report.notes.join(" ")).toMatch(/non mesurée/);
  });

  it("déterministe : même graine, même modèle ; base mêlée marquée « mixed »", () => {
    const refs: PriceReference[] = generateSyntheticReferences({ n: 1500, seed: 9 }).map((r, i) => (i % 2 ? { ...r, source: "client_sale" } : r));
    const a = trainPriceModel(refs, { now: NOW, seed: 4 });
    const b = trainPriceModel(refs, { now: NOW, seed: 4 });
    expect(serializePriceModel(a.model!)).toBe(serializePriceModel(b.model!));
    expect(a.model!.dataOrigin).toBe("mixed");
    const c = trainPriceModel(refs, { now: NOW, seed: 5 });
    expect(serializePriceModel(c.model!)).not.toBe(serializePriceModel(a.model!));
  });

  it("backtest glissant sur 4 fenêtres d'un mois", () => {
    const { report } = trainPriceModel(generateSyntheticReferences({ n: 4000, seed: 2 }), { now: NOW, seed: 1, backtest: true });
    expect(report.backtest).toHaveLength(4);
    const [w0, w1] = report.backtest!;
    expect(w0!.to).toBe(new Date(NOW).toISOString());
    expect(w1!.to).toBe(w0!.from);
    expect(report.backtest!.every((w) => w.insufficient || w.price === null || w.price.mdape < 0.4)).toBe(true);
    expect(w0!.price).toEqual(report.metrics.price);
  });

  it("valide les réglages (150 à 400 arbres, profondeur 4 à 6, ≤ 64 classes)", () => {
    expect(resolveParams()).toMatchObject({ trees: 300, learningRate: 0.05, maxDepth: 5, maxBins: 64 });
    expect(() => resolveParams({ trees: 100 })).toThrow(RangeError);
    expect(() => resolveParams({ trees: 500 })).toThrow(RangeError);
    expect(() => resolveParams({ maxDepth: 3 })).toThrow(RangeError);
    expect(() => resolveParams({ maxDepth: 7 })).toThrow(RangeError);
    expect(() => resolveParams({ maxBins: 128 })).toThrow(RangeError);
    expect(() => trainPriceModel([], { now: "pas une date" })).toThrow(RangeError);
  });

  it("le type d'une référence interdit les champs personnels", () => {
    const ok: PriceReference = { brand: "Zara", category: "Robes", condition: "good", listedPriceCents: 1500, listedAt: NOW, source: "track" };
    // @ts-expect-error — un pseudo ne peut pas entrer dans une référence de prix.
    const withPseudo: PriceReference = { ...ok, pseudo: "quelqu'un" };
    // @ts-expect-error — ni l'adresse d'une annonce.
    const withUrl: PriceReference = { ...ok, url: "https://exemple.invalid/annonce" };
    expect([withPseudo, withUrl]).toHaveLength(2);
  });
});

describe("trainPriceModel : prix finals estimés (annonces disparues)", () => {
  // Ventes au prix réel + ventes « disparues » au prix ESTIMÉ (dernier prix affiché), sources réelles.
  const base = generateSyntheticReferences({ n: 4000, seed: 21, dirtyShare: 0 }).map((r) => ({ ...r, source: "client_sale" as const }));
  const holdoutFrom = Date.parse(NOW) - 30 * 86_400_000;
  const inHoldout = (r: PriceReference) => r.soldAt !== null && r.soldAt !== undefined && Date.parse(String(r.soldAt)) >= holdoutFrom;

  it("jamais dans le mois de test : l'erreur publiée ne porte que sur des ventes au prix réel", () => {
    let flagged = 0;
    const refs = base.map((r) => (inHoldout(r) && flagged++ % 2 === 0 ? { ...r, source: "track" as const, finalPriceEstimated: true } : r));
    const plain = trainPriceModel(base, { now: NOW, seed: 3 });
    const mixed = trainPriceModel(refs, { now: NOW, seed: 3 });
    expect(mixed.report.estimated.excludedFromTest).toBeGreaterThan(0);
    expect(mixed.report.nHoldout).toBe(plain.report.nHoldout - mixed.report.estimated.excludedFromTest);
    expect(mixed.report.estimated.train).toBe(0);
    expect(mixed.report.notes.some((n) => n.includes("écartée(s) de la mesure"))).toBe(true);
    expect(flatMetrics(mixed.report)).toMatchObject({ estimatedExcludedFromTest: mixed.report.estimated.excludedFromTest, estimatedTrain: 0 });
  });

  it("à l'entraînement seulement à défaut d'assez de ventes au prix réel, et le rapport le dit", () => {
    const refs = base.map((r) => (inHoldout(r) ? r : { ...r, source: "track" as const, finalPriceEstimated: true }));
    const { model, report } = trainPriceModel(refs, { now: NOW, seed: 3 });
    expect(model).not.toBeNull();
    expect(report.estimated.train).toBe(report.nTrain + report.nValidation);
    expect(report.notes.some((n) => n.includes("prix estimé(s)"))).toBe(true);
    expect(formatTrainingReport(report)).toContain("Prix estimés (annonces disparues)");
  });
});
