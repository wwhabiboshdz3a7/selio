import { describe, expect, it } from "vitest";
import { ITEM_MAX_PRICE_CENTS, floorAboveListed, inventoryItemCreate, inventoryItemUpdate, isRealIsoDate, isoDate, nameText, orgUpdate, registerInput } from "./index";

/** Bornes de saisie (docs/ROBUSTESSE.md) : mêmes règles pour le formulaire et pour le serveur. */
describe("robustesse des saisies", () => {
  it("noms : limite claire, espaces seuls, espaces de largeur nulle et caractères de contrôle refusés ; emojis et HTML gardés comme du texte", () => {
    const name = nameText(80);
    expect(name.safeParse("A".repeat(80)).success).toBe(true);
    expect(name.safeParse("A".repeat(81)).error?.issues[0]?.message).toBe("80 caractères au plus.");
    expect(name.safeParse("   ").error?.issues[0]?.message).toBe("Champ requis.");
    expect(name.safeParse("​ ​").error?.issues[0]?.message).toMatch(/espaces seuls/);
    expect(name.safeParse("Zoé\tDupont").error?.issues[0]?.message).toMatch(/Caractère non accepté/);
    expect(name.safeParse("a\u0000b").success).toBe(false);
    expect(name.parse("  🛍️ <b>Zoé</b> & « Cie »  ")).toBe("🛍️ <b>Zoé</b> & « Cie »");
    const base = { email: "a@b.fr", password: "motdepasse-A1", displayName: "A", orgName: "O" };
    expect(registerInput.safeParse({ ...base, displayName: "x".repeat(500) }).success).toBe(false);
    expect(registerInput.safeParse({ ...base, orgName: "O".repeat(121) }).success).toBe(false);
    expect(orgUpdate.safeParse({ name: "   " }).success).toBe(false);
  });

  it("dates : jamais une date impossible transmise à la base", () => {
    for (const bad of ["2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-01-01Tn'importe quoi", "2026-00-10T00:00:00Z"]) {
      expect(isRealIsoDate(bad), bad).toBe(false);
      expect(isoDate.safeParse(bad).success, bad).toBe(false);
    }
    for (const ok of ["2024-02-29T00:00:00.000Z", "2026-11-26T10:00:00+01:00", "2026-11-26T10:00:00.000Z"]) expect(isoDate.safeParse(ok).success, ok).toBe(true);
  });

  it("article : prix, frais, date d'achat et plancher bornés", () => {
    const msg = (input: Record<string, unknown>) => inventoryItemCreate.safeParse({ title: "Veste", ...input }).error?.issues[0]?.message;
    expect(msg({ listedPriceCents: ITEM_MAX_PRICE_CENTS + 1 })).toBe("Montant trop élevé : 100 000 € au plus.");
    expect(msg({ listedPriceCents: 100_000_000 })).toBe("Montant trop élevé : 100 000 € au plus.");
    expect(msg({ listedPriceCents: 0 })).toBe("Le prix affiché doit être d'au moins 1 €.");
    expect(msg({ purchasePriceCents: -1 })).toBeDefined();
    expect(msg({ purchaseFeesCents: 2_000_000_000 })).toBeDefined();
    expect(msg({ purchasedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })).toBe("La date d'achat ne peut pas être dans le futur.");
    expect(msg({ purchasedAt: "1949-12-31T00:00:00.000Z" })).toBe("Date d'achat improbable : 1950 au plus tôt.");
    expect(msg({ title: "   " })).toBe("Champ requis.");
    expect(inventoryItemCreate.safeParse({ title: "Veste", listedPriceCents: 100, purchasePriceCents: 0, purchasedAt: new Date().toISOString() }).success).toBe(true);
    expect(floorAboveListed({ listedPriceCents: 1000, floorPriceCents: 1200 })).toBe(true);
    expect(floorAboveListed({ listedPriceCents: 1000, floorPriceCents: null })).toBe(false);
    // Modification : la date de version attendue est acceptée (contrôle des modifications concurrentes).
    expect(inventoryItemUpdate.parse({ expectedUpdatedAt: "2026-11-26T10:00:00.000Z" }).expectedUpdatedAt).toBe("2026-11-26T10:00:00.000Z");
  });
});
