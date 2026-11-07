import { describe, expect, it } from "vitest";
import { addOutcome, compareLabel, compareMeasurements, emptyTally, percentile, rate, readRate, sameText, type ReadFields } from "./compare";

const read = (v: Partial<Record<keyof ReadFields, string | null>>): ReadFields => ({
  brand: { value: v.brand ?? null, confidence: v.brand ? 0.9 : 0 },
  size: { value: v.size ?? null, confidence: v.size ? 0.8 : 0 },
  material: { value: v.material ?? null, confidence: v.material ? 0.7 : 0 },
  reference: { value: v.reference ?? null, confidence: v.reference ? 0.6 : 0 },
});

describe("sameText", () => {
  it("ignore accents, casse, ponctuation et espaces, mais pas le contenu", () => {
    expect(sameText("Levi's", "LEVIS")).toBe(true);
    expect(sameText("W32 L32", "w32/l32")).toBe(true);
    expect(sameText("Éram", "eram")).toBe(true);
    expect(sameText("Zara", "Zara Kids")).toBe(false);
    expect(sameText("38", "38 FR")).toBe(false);
    expect(sameText("", "")).toBe(false);
  });
});

describe("compareLabel", () => {
  it("classe chaque champ : juste, fausse, non lue, non évaluée", () => {
    const out = compareLabel({ brand: "Levi's", size: "W32 L32", material: null, reference: "04511" }, read({ brand: "LEVIS", size: "W30 L32", material: "coton" }));
    expect(out.map((c) => [c.field, c.outcome])).toEqual([
      ["brand", "correct"],
      ["size", "wrong"],
      ["material", "not_evaluated"],
      ["reference", "unread"],
    ]);
    expect(out[0]!.confidence).toBe(0.9);
    expect(out[1]).toMatchObject({ expected: "W32 L32", read: "W30 L32" });
  });

  it("une vérité faite d'espaces n'est pas évaluée", () => {
    const out = compareLabel({ brand: "  ", size: null, material: null, reference: null }, read({ brand: "Zara" }));
    expect(out[0]!.outcome).toBe("not_evaluated");
  });
});

describe("compareMeasurements", () => {
  it("juste à ± 1 cm inclus, fausse au-delà, non lue si absente, inattendue sans vérité", () => {
    const out = compareMeasurements({ chest: 52, length: 68, waist: 40 }, [
      { name: "chest", valueCm: 53, confidence: 0.9 },
      { name: "length", valueCm: 69.01, confidence: 0.9 },
      { name: "sleeve", valueCm: 60, confidence: 0.8 },
    ]);
    const byName = Object.fromEntries(out.map((c) => [c.name, c.outcome]));
    expect(byName).toEqual({ chest: "correct", length: "wrong", waist: "unread", sleeve: "unexpected" });
    expect(out.find((c) => c.name === "sleeve")).toMatchObject({ expected: null, read: 60 });
  });

  it("garde la première lecture d'une même mesure et respecte une tolérance différente", () => {
    const out = compareMeasurements({ chest: 50 }, [
      { name: "chest", valueCm: 52, confidence: 0.9 },
      { name: "chest", valueCm: 50, confidence: 0.5 },
    ]);
    expect(out[0]!.outcome).toBe("wrong");
    expect(compareMeasurements({ chest: 50 }, [{ name: "chest", valueCm: 52, confidence: 0.9 }], 2)[0]!.outcome).toBe("correct");
  });
});

describe("tally", () => {
  it("compte attendues, justes, fausses, non lues, inattendues ; taux sur attendues et sur lues", () => {
    const t = emptyTally();
    for (const o of ["correct", "correct", "wrong", "unread", "unexpected", "not_evaluated"] as const) addOutcome(t, o);
    expect(t).toEqual({ expected: 4, correct: 2, wrong: 1, unread: 1, unexpected: 1 });
    expect(rate(t)).toBeCloseTo(0.5);
    expect(readRate(t)).toBeCloseTo(2 / 3);
    expect(rate(emptyTally())).toBeNull();
    expect(readRate(emptyTally())).toBeNull();
  });

  it("percentiles sur un échantillon", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([10, 1, 7, 3, 2], 50)).toBe(3);
    expect(percentile([10, 1, 7, 3, 2], 95)).toBe(10);
  });
});
