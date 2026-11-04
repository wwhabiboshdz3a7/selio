import { EXPLANATION_RULES, blendEstimate, comparablesWeight, formatEuros, roundPsychological, summarizeComparables } from "./blend";
import type { PricePrediction } from "./types";

const model = (over: Partial<PricePrediction> = {}): PricePrediction => ({
  p25: 2400,
  p50: 2800,
  p75: 3300,
  delayDays: 10,
  delayAt: { p25: 7, p50: 10, p75: 15 },
  confidence: "medium",
  method: "model",
  dataOrigin: "real",
  measuredMdape: 0.18,
  factors: [
    { key: "brand", label: "Marque", value: "Levi's", effect: 0.3, versus: "une marque sans historique, même catégorie", support: 200 },
    { key: "condition", label: "État", value: "Très bon état", effect: 0, versus: "très bon état" },
    { key: "season", label: "Saison", value: "Hiver", effect: -0.05, versus: "la moyenne des quatre saisons" },
    { key: "model_error", label: "Erreur du modèle", value: "18 % d'erreur médiane sur le dernier mois", effect: null },
  ],
  ...over,
});

describe("comparablesWeight", () => {
  it("0 comparable → 0 ; croît avec leur nombre ; ≥ 12 → 80 %", () => {
    expect(comparablesWeight(0)).toBe(0);
    expect(comparablesWeight(3)).toBe(0.2);
    expect(comparablesWeight(6)).toBe(0.4);
    expect(comparablesWeight(12)).toBe(0.8);
    expect(comparablesWeight(500)).toBe(0.8);
    for (let n = 1; n < 12; n++) expect(comparablesWeight(n + 1)).toBeGreaterThan(comparablesWeight(n));
  });
});

describe("roundPsychological", () => {
  it("prix psychologique le plus proche, x,90 par défaut, x,99 ou sans arrondi", () => {
    expect(roundPsychological(2743)).toBe(2790);
    expect(roundPsychological(2730)).toBe(2690);
    expect(roundPsychological(2690)).toBe(2690);
    expect(roundPsychological(2743, 99)).toBe(2699);
    expect(roundPsychological(2760, 99)).toBe(2799);
    expect(roundPsychological(2743.4, null)).toBe(2743);
    expect(roundPsychological(2700, 0)).toBe(2700);
  });

  it("jamais sous 1 €", () => {
    expect(roundPsychological(50)).toBe(100);
    expect(roundPsychological(120)).toBe(120);
    expect(roundPsychological(160)).toBe(190);
    expect(() => roundPsychological(1000, 150)).toThrow(RangeError);
  });
});

describe("summarizeComparables", () => {
  it("quantiles et délai médian des ventes proches", () => {
    expect(summarizeComparables([])).toBeNull();
    expect(summarizeComparables([1000, 2000, 3000, 4000, 5000], [2, 4, 30])).toEqual({ p25: 2000, p50: 3000, p75: 4000, count: 5, delayDays: 4 });
    expect(summarizeComparables([1500])).toMatchObject({ p25: 1500, p50: 1500, p75: 1500, count: 1, delayDays: null });
  });
});

describe("blendEstimate", () => {
  it("aucun moteur → « none », aucune stratégie", () => {
    const e = blendEstimate({ comparables: null, model: null });
    expect(e).toMatchObject({ method: "none", p50: null, strategies: [], confidence: "low" });
    expect(blendEstimate({ comparables: { p25: 1, p50: 1, p75: 1, count: 0 }, model: null }).method).toBe("none");
  });

  it("0 comparable → modèle seul", () => {
    const e = blendEstimate({ comparables: null, model: model() });
    expect(e).toMatchObject({ method: "model", p25: 2400, p50: 2800, p75: 3300, weights: { comparables: 0, model: 1 }, confidence: "medium", delayDays: 10 });
  });

  it("comparables seuls quand le modèle n'est pas entraîné", () => {
    const e = blendEstimate({ comparables: { p25: 2000, p50: 2500, p75: 3000, count: 12, delayDays: 6 }, model: null });
    expect(e).toMatchObject({ method: "comparables", p50: 2500, weights: { comparables: 1, model: 0 }, confidence: "high", delayDays: 6 });
    expect(e.strategies[0]!.delayDays).toBeNull();
  });

  it("≥ 12 comparables → 80 % comparables, 20 % modèle", () => {
    const e = blendEstimate({ comparables: { p25: 2000, p50: 2500, p75: 3000, count: 20, delayDays: 5 }, model: model() });
    expect(e.method).toBe("blend");
    expect(e.weights).toEqual({ comparables: 0.8, model: 0.2 });
    expect(e.p25).toBe(Math.round(0.8 * 2000 + 0.2 * 2400));
    expect(e.p50).toBe(Math.round(0.8 * 2500 + 0.2 * 2800));
    expect(e.p75).toBe(Math.round(0.8 * 3000 + 0.2 * 3300));
    expect(e.delayDays).toBe(6);
    expect(e.confidence).toBe("high");
  });

  it("trois stratégies : vente rapide = P25, standard = P50, marge maximale = P75, arrondies et ordonnées", () => {
    const e = blendEstimate({ comparables: { p25: 2130, p50: 2620, p75: 3270, count: 4 }, model: model() });
    const [fast, standard, max] = e.strategies;
    expect(fast).toMatchObject({ key: "fast", label: "Vente rapide", quantile: "p25", rawCents: e.p25 });
    expect(standard).toMatchObject({ key: "standard", label: "Standard", quantile: "p50", rawCents: e.p50 });
    expect(max).toMatchObject({ key: "max", label: "Marge maximale", quantile: "p75", rawCents: e.p75 });
    for (const s of e.strategies) expect(s.priceCents % 100).toBe(90);
    expect(fast!.priceCents).toBeLessThanOrEqual(standard!.priceCents);
    expect(standard!.priceCents).toBeLessThanOrEqual(max!.priceCents);
    expect(fast!.delayDays!).toBeLessThanOrEqual(standard!.delayDays!);
    expect(max!.delayDays!).toBeGreaterThanOrEqual(standard!.delayDays!);
    const e99 = blendEstimate({ comparables: null, model: model() }, { psychologicalEnding: 99 });
    for (const s of e99.strategies) expect(s.priceCents % 100).toBe(99);
  });

  it("explication structurée pour mon IA perso : faits chiffrés, consignes, jamais de décision", () => {
    const e = blendEstimate({ comparables: { p25: 2000, p50: 2500, p75: 3000, count: 6 }, model: model() });
    const { explanation } = e;
    expect(explanation.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["brand", "condition", "season", "comparables", "model_error"]));
    expect(explanation.factors.find((f) => f.key === "comparables")!.support).toBe(6);
    const facts = explanation.facts.join("\n");
    expect(facts).toContain(formatEuros(e.strategies[1]!.priceCents));
    expect(facts).toMatch(/6 ventes comparables \(poids 40 %\)/);
    expect(facts).toMatch(/Marque \(Levi's\) : \+30 %/);
    expect(facts).toMatch(/18 %/);
    // L'état de référence (effet nul) n'est pas cité comme un facteur du prix.
    expect(facts).not.toMatch(/État \(Très bon état\)/);
    expect(explanation.rules).toBe(EXPLANATION_RULES);
    expect(explanation.rules.join(" ")).toMatch(/ne les modifie pas/);
    expect(explanation.summary).toMatch(/Prix conseillé/);
  });

  it("dit « données de démonstration » et « non mesurée » quand c'est le cas", () => {
    const demo = blendEstimate({ comparables: null, model: model({ dataOrigin: "demo", confidence: "low" }) });
    expect(demo.demoData).toBe(true);
    expect(demo.explanation.summary).toMatch(/Données de démonstration/);
    const unmeasured = blendEstimate({ comparables: null, model: model({ measuredMdape: null, factors: [] }) });
    expect(unmeasured.measuredMdape).toBeNull();
    expect(unmeasured.explanation.summary).toMatch(/non mesurée/);
    expect(unmeasured.explanation.facts.join(" ")).toMatch(/non mesurée/);
  });

  it("formatEuros", () => {
    expect(formatEuros(2990)).toBe("29,90 €");
    expect(formatEuros(123456)).toBe("1 234,56 €");
    expect(formatEuros(5)).toBe("0,05 €");
  });
});
