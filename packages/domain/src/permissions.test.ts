import { describe, expect, it } from "vitest";
import { can } from "./permissions";

describe("permissions", () => {
  it("hiérarchise les rôles", () => {
    expect(can("viewer", "items.read")).toBe(true);
    expect(can("viewer", "items.write")).toBe(false);
    expect(can("operator", "items.write")).toBe(true);
    expect(can("operator", "automations.write")).toBe(false);
    expect(can("admin", "automations.write")).toBe(true);
    expect(can("admin", "org.delete")).toBe(false);
    expect(can("owner", "purchase.execute")).toBe(true);
  });
});
