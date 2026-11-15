import { describe, expect, it } from "vitest";
import { OPERATOR_CAPABILITIES, operatorCan, operatorHasLevel, parseEmailList, resolveOperatorRole, type OperatorCapability } from "./operator-permissions";

/** Matrice attendue, écrite à la main : T = technique, B = business. */
const EXPECTED: Record<OperatorCapability, string> = {
  "admin.growth": "TB",
  "admin.accounts.read": "TB",
  "admin.accounts.manage": "TB",
  "admin.offers": "TB",
  "admin.usage.read": "TB",
  "admin.track.read": "TB",
  "admin.health": "T-",
  "admin.supervision": "T-",
  "admin.ai": "T-",
  "admin.pricing": "T-",
  "admin.size_references": "T-",
  "admin.switches": "T-",
  "admin.plans": "T-",
  "admin.radar": "T-",
  "admin.audit": "T-",
};

describe("Selio Admin : matrice des droits des opérateurs", () => {
  it("chaque droit × chaque rôle, et aucun droit sans rôle d'opérateur", () => {
    for (const cap of OPERATOR_CAPABILITIES) {
      const got = `${operatorCan("tech", cap) ? "T" : "-"}${operatorCan("business", cap) ? "B" : "-"}`;
      expect(got, cap).toBe(EXPECTED[cap]);
      expect(operatorCan(null, cap)).toBe(false);
      expect(operatorCan(undefined, cap)).toBe(false);
    }
  });

  it("niveau des routes : « business » = tout opérateur, « tech » = technique seulement", () => {
    expect(operatorHasLevel("tech", "tech")).toBe(true);
    expect(operatorHasLevel("tech", "business")).toBe(true);
    expect(operatorHasLevel("business", "business")).toBe(true);
    expect(operatorHasLevel("business", "tech")).toBe(false);
    expect(operatorHasLevel(null, "business")).toBe(false);
  });

  it("rôle tiré de la configuration, recalculé pour un compte existant ; l'ancien drapeau vaut « tech »", () => {
    const cfg = { tech: parseEmailList(" Ibrahim@Selio.fr ,"), business: parseEmailList("elias@selio.fr, ibrahim@selio.fr") };
    expect(resolveOperatorRole(cfg, { email: "ibrahim@selio.fr" })).toBe("tech");
    expect(resolveOperatorRole(cfg, { email: "ELIAS@selio.fr", isOperator: false })).toBe("business");
    expect(resolveOperatorRole(cfg, { email: "client@exemple.fr", isOperator: false })).toBeNull();
    expect(resolveOperatorRole(cfg, { email: "ancien@selio.fr", isOperator: true })).toBe("tech");
    expect(resolveOperatorRole(undefined, { email: "elias@selio.fr" })).toBeNull();
  });
});
