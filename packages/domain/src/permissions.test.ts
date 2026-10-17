import { describe, expect, it } from "vitest";
import { ROLES } from "@selio/contracts";
import { ACTIONS, ACTION_LABELS, PERMISSION_GROUPS, ROLES_BY_RANK, actionsUnlockedAt, can, minimumRole } from "./permissions";

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

  it("classe les rôles du plus large au plus restreint", () => {
    expect(ROLES_BY_RANK).toEqual(["owner", "admin", "operator", "viewer"]);
    expect([...ROLES_BY_RANK].sort()).toEqual([...ROLES].sort());
  });

  it("la matrice affichée couvre chaque action une seule fois, avec un libellé", () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.actions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) expect(ACTION_LABELS[a], a).toBeTruthy();
  });

  it("chaque action est débloquée à un seul rôle, cohérent avec can()", () => {
    const unlocked = ROLES_BY_RANK.flatMap((r) => actionsUnlockedAt(r));
    expect([...unlocked].sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) {
      const min = minimumRole(a);
      expect(actionsUnlockedAt(min)).toContain(a);
      for (const r of ROLES_BY_RANK) expect(can(r, a)).toBe(ROLES_BY_RANK.indexOf(r) <= ROLES_BY_RANK.indexOf(min));
    }
  });
});
