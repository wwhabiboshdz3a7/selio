import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyRate, centsToDecimalString, parseEuroInput, roundHalfAway, sumCents } from "./money";

describe("money", () => {
  it("parse les saisies françaises et anglaises", () => {
    expect(parseEuroInput("12,50")).toBe(1250);
    expect(parseEuroInput("12.5")).toBe(1250);
    expect(parseEuroInput("1 286,00 €")).toBe(128600);
    expect(parseEuroInput("1 286,00 €")).toBe(128600);
    expect(parseEuroInput("-3")).toBe(-300);
    expect(parseEuroInput("abc")).toBeNull();
    expect(parseEuroInput("")).toBeNull();
    expect(parseEuroInput("12.345")).toBeNull();
  });
  it("arrondit demi vers l'infini", () => {
    expect(roundHalfAway(0.5)).toBe(1);
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(applyRate(1000, 0.125)).toBe(125);
    expect(applyRate(999, 0.5)).toBe(500);
  });
  it("refuse les flottants", () => {
    expect(() => sumCents([1, 2.5])).toThrow(RangeError);
  });
  it("sérialise en décimal", () => {
    expect(centsToDecimalString(128600)).toBe("1286,00");
    expect(centsToDecimalString(-5, ".")).toBe("-0.05");
  });
  it("parse ∘ format est l'identité (propriété)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (c) => {
        expect(parseEuroInput(centsToDecimalString(c))).toBe(c);
      }),
    );
  });
});
