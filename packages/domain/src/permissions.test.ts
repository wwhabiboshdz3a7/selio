import { describe, expect, it } from "vitest";
import { ROLES, ROLE_LABELS, type Role } from "@selio/contracts";
import {
  ACTIONS, ACTION_LABELS, PERMISSION_GROUPS, ROLES_BY_RANK, ROLE_RANK, actionsOf, actionsUnlockedAt, actionsWithheldFrom, baseRoleOf, can, canAssignRole, includesRole, minimumRole, rolesAllowed, type Action,
} from "./permissions";

/**
 * Matrice attendue, écrite à la main et indépendante de l'implémentation : chaque action × chaque rôle.
 * O = titulaire, A = administrateur, E = exécuteur, P = contributeur photos, V = lecture seule.
 */
const EXPECTED: Record<Action, string> = {
  "org.read": "OAE-V",
  "org.update": "OA---",
  "org.delete": "O----",
  "members.manage": "OA---",
  "billing.manage": "O----",
  "finances.read": "OA--V",
  "items.read": "OAEPV",
  "items.write": "OAE--",
  "items.photos.write": "OAEP-",
  "items.delete": "OA---",
  "studio.generate": "OAEP-",
  "customers.read": "OAE-V",
  "customers.write": "OAE--",
  "conversations.read": "OAE-V",
  "messages.draft": "OAE--",
  "messages.send": "OAE--",
  "orders.read": "OAE-V",
  "orders.write": "OAE--",
  "analytics.read": "OAE-V",
  "analytics.export": "OA---",
  "automations.read": "OAE-V",
  "automations.write": "OA---",
  "radar.read": "OAE-V",
  "radar.write": "OAE--",
  "purchase.simulate": "OAE--",
  "purchase.execute": "O----",
  "connections.read": "OAE-V",
  "connections.manage": "OA---",
  "cloud.read": "OAE-V",
  "cloud.manage": "OA---",
  "ai.use": "OAE--",
  "ai.configure": "OA---",
  "tokens.manage": "OAE--",
  "data.export": "OA---",
  "data.delete": "O----",
};
const COLUMNS: Role[] = ["owner", "admin", "operator", "photographer", "viewer"];
const LETTER: Record<Role, string> = { owner: "O", admin: "A", operator: "E", photographer: "P", viewer: "V" };

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
    expect(ROLES_BY_RANK).toEqual(["owner", "admin", "operator", "photographer", "viewer"]);
    expect([...ROLES_BY_RANK].sort()).toEqual([...ROLES].sort());
    expect(ROLE_RANK.photographer).toBeGreaterThan(ROLE_RANK.viewer);
    expect(ROLE_RANK.photographer).toBeLessThan(ROLE_RANK.operator);
  });

  it("libellés français des rôles", () => {
    expect(ROLE_LABELS).toEqual({ owner: "Titulaire", admin: "Administrateur", operator: "Exécuteur", photographer: "Contributeur photos", viewer: "Lecture seule" });
  });

  it("la matrice affichée couvre chaque action une seule fois, avec un libellé", () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.actions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) expect(ACTION_LABELS[a], a).toBeTruthy();
  });

  it("matrice exhaustive : chaque action × chaque rôle a la valeur attendue", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const a of ACTIONS) {
      const row = EXPECTED[a];
      for (const [i, r] of COLUMNS.entries()) {
        expect(can(r, a), `${a} / ${r}`).toBe(row[i] === LETTER[r]);
      }
      expect(rolesAllowed(a)).toEqual(COLUMNS.filter((_, i) => row[i] !== "-"));
    }
  });

  it("l'exécuteur publie et répond, sans aucune finance", () => {
    for (const a of ["items.write", "items.photos.write", "studio.generate", "messages.draft", "messages.send", "orders.read", "orders.write", "conversations.read"] as Action[]) expect(can("operator", a), a).toBe(true);
    for (const a of ["finances.read", "billing.manage", "analytics.export", "data.export"] as Action[]) expect(can("operator", a), a).toBe(false);
    // La lecture seule (le comptable) voit les finances que l'exécuteur ne voit pas : rôles latéraux.
    expect(actionsWithheldFrom("operator")).toEqual(["finances.read"]);
  });

  it("le contributeur photos : articles en lecture, photos et générateur, rien d'autre", () => {
    expect(actionsOf("photographer")).toEqual(["items.read", "items.photos.write", "studio.generate"]);
    for (const a of ["conversations.read", "messages.draft", "orders.read", "automations.read", "radar.read", "finances.read", "ai.use", "items.write", "org.read"] as Action[]) expect(can("photographer", a), a).toBe(false);
  });

  it("rôle de base et actions débloquées : la réunion redonne exactement les droits du rôle", () => {
    expect(baseRoleOf("owner")).toBe("admin");
    expect(baseRoleOf("admin")).toBe("operator");
    expect(baseRoleOf("operator")).toBe("photographer");
    expect(baseRoleOf("photographer")).toBeNull();
    expect(baseRoleOf("viewer")).toBeNull();
    for (const r of ROLES_BY_RANK) {
      const base = baseRoleOf(r);
      const union = new Set([...(base ? actionsOf(base) : []), ...actionsUnlockedAt(r)]);
      expect([...union].sort(), r).toEqual(actionsOf(r).sort());
      for (const a of actionsUnlockedAt(r)) expect(base === null || !can(base, a), `${r} ${a}`).toBe(true);
    }
    expect(actionsUnlockedAt("owner")).toEqual(["org.delete", "billing.manage", "purchase.execute", "data.delete"]);
    expect(actionsUnlockedAt("photographer")).toEqual(actionsOf("photographer"));
    expect(includesRole("operator", "viewer")).toBe(false);
    expect(includesRole("admin", "viewer")).toBe(true);
    expect(includesRole("owner", "photographer")).toBe(true);
  });

  it("minimumRole : le rôle autorisé de plus petit rang, cohérent avec can()", () => {
    for (const a of ACTIONS) {
      const min = minimumRole(a);
      expect(can(min, a), a).toBe(true);
      for (const r of ROLES_BY_RANK) if (ROLE_RANK[r] < ROLE_RANK[min]) expect(can(r, a), `${a} ${r}`).toBe(false);
    }
    expect(minimumRole("studio.generate")).toBe("photographer");
    expect(minimumRole("finances.read")).toBe("viewer");
  });

  it("attribution des rôles : un administrateur n'attribue jamais le titulaire", () => {
    for (const target of ROLES) {
      expect(canAssignRole("owner", target)).toBe(true);
      expect(canAssignRole("admin", target)).toBe(target !== "owner");
      for (const actor of ["operator", "photographer", "viewer"] as Role[]) expect(canAssignRole(actor, target)).toBe(false);
    }
  });
});
