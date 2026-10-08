import { describe, expect, it } from "vitest";
import { formatCents, formatPercent, formatRelative } from "./format";

describe("format fr-FR", () => {
  it("formate les centimes en euros français", () => {
    expect(formatCents(128600)).toBe("1\u202f286,00\u00a0€");
    expect(formatCents(-1250)).toBe("−12,50\u00a0€");
    expect(formatCents(0)).toBe("0,00\u00a0€");
  });
  it("formate les pourcentages", () => {
    expect(formatPercent(0.425)).toBe("42,5\u00a0%");
  });
  it("formate les dates relatives", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(formatRelative(new Date("2026-10-08T11:58:00Z"), now)).toBe("il y a 2 min");
    expect(formatRelative(new Date("2026-10-07T11:00:00Z"), now)).toBe("hier");
  });
});
