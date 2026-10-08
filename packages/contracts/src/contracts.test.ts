import { describe, expect, it } from "vitest";
import { inventoryItemCreate, orderCreate, replySuggestion, registerInput } from "./index";

describe("contracts", () => {
  it("applique des valeurs par défaut cohérentes à un article", () => {
    const parsed = inventoryItemCreate.parse({ title: "Veste" });
    expect(parsed.status).toBe("in_stock");
    expect(parsed.purchasePriceCents).toBe(0);
    expect(parsed.photos).toEqual([]);
  });
  it("refuse une commande sans prix entier", () => {
    expect(() => orderCreate.parse({ itemId: "a", customerId: "b", salePriceCents: 12.5 })).toThrow();
  });
  it("valide une sortie IA structurée et refuse les intentions inconnues", () => {
    expect(replySuggestion.safeParse({ reply: "Bonjour", intent: "answer" }).success).toBe(true);
    expect(replySuggestion.safeParse({ reply: "Bonjour", intent: "buy_now" }).success).toBe(false);
  });
  it("exige un mot de passe de 10 caractères", () => {
    expect(registerInput.safeParse({ email: "a@b.fr", password: "court", displayName: "A", orgName: "O" }).success).toBe(false);
  });
});
