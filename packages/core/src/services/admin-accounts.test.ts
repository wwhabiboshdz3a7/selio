import { describe, expect, it } from "vitest";
import { AppError, operatorRoleOf, requireOperator, requireOperatorCapability } from "../context";
import { isInternalAdminAuditAction } from "./admin-accounts";

describe("Selio Admin : gardes des opérateurs (packages/core)", () => {
  it("requireOperator(ctx, « business ») : tout opérateur ; « tech » (défaut) : opérateur technique seulement", () => {
    expect(requireOperator({ isOperator: true, operatorRole: "business" }, "business")).toBe("business");
    expect(requireOperator({ isOperator: true, operatorRole: "tech" }, "business")).toBe("tech");
    expect(requireOperator({ isOperator: true, operatorRole: "tech" })).toBe("tech");
    const refused = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof AppError ? `${e.status} ${e.code}` : "autre";
      }
      return "accepté";
    };
    expect(refused(() => requireOperator({ isOperator: true, operatorRole: "business" }))).toBe("403 forbidden");
    expect(refused(() => requireOperator({ isOperator: false, operatorRole: null }, "business"))).toBe("403 forbidden");
    expect(refused(() => requireOperatorCapability({ isOperator: true, operatorRole: "business" }, "admin.health"))).toBe("403 forbidden");
    expect(refused(() => requireOperatorCapability({ isOperator: true, operatorRole: "business" }, "admin.accounts.manage"))).toBe("accepté");
  });

  it("compatibilité : un contexte sans `operatorRole` (worker, anciens tests) vaut « tech » s'il est opérateur", () => {
    expect(operatorRoleOf({ isOperator: true })).toBe("tech");
    expect(operatorRoleOf({ isOperator: false })).toBeNull();
    expect(operatorRoleOf({ isOperator: true, operatorRole: "business" })).toBe("business");
  });

  it("les actions internes de Selio Admin sont retirées du journal vu par le client", () => {
    for (const a of ["admin.account_qualified", "admin.account_note_updated", "admin.access_granted", "admin.access_revoked", "admin.trial_extended"]) expect(isInternalAdminAuditAction(a), a).toBe(true);
    for (const a of ["admin.plan_changed", "billing.grant_ended", "auth.login", "org.updated"]) expect(isInternalAdminAuditAction(a), a).toBe(false);
  });
});
