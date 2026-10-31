import { describe, expect, it } from "vitest";
import { dateInputToIso } from "./dates";

describe("dateInputToIso", () => {
  it("convertit une date du champ en instant ISO à midi UTC", () => {
    expect(dateInputToIso("2026-10-16")).toBe("2026-10-16T12:00:00.000Z");
    expect(dateInputToIso("0006-01-02")).toBe("0006-01-02T12:00:00.000Z");
  });

  it("renvoie null pour un champ vide ou une année hors plage, sans lever d'exception", () => {
    expect(dateInputToIso("")).toBeNull();
    expect(dateInputToIso("20266-02-01")).toBeNull();
    expect(dateInputToIso("275760-09-14")).toBeNull();
    expect(dateInputToIso("2026-13-45")).toBeNull();
  });
});
