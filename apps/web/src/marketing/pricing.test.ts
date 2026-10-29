import { describe, expect, it } from "vitest";
import { PRICING } from "@selio/demo-data";
import { STUDIO_SLIDER, annualMonthlyEquivalentCents, annualSavingsCents, studioQuote } from "./pricing";

describe("tarifs : Studio seul au curseur", () => {
  it("retombe sur le prix des packs et respecte le minimum par achat", () => {
    const [p80, p200, p1200] = PRICING.subsidiaries.studio.packs;
    expect(studioQuote(p80!.photos).cents).toBe(p80!.cents);
    expect(studioQuote(p200!.photos).cents).toBe(p200!.cents);
    expect(studioQuote(p1200!.photos).cents).toBe(p1200!.cents);
    // 40 photos au tarif du premier pack feraient moins que le minimum : le minimum s'applique.
    const small = studioQuote(40);
    expect(small).toMatchObject({ photos: 40, cents: PRICING.subsidiaries.studio.minPurchaseCents, minimumApplied: true });
    expect(studioQuote(0)).toMatchObject({ cents: 0, perPhotoCents: 0 });
  });

  it("le prix ne baisse jamais quand on prend plus de photos (tout le curseur, cran par cran)", () => {
    // Avant correction : 200 photos = 9,99 € mais 220 photos = 5,50 € (tarif du pack supérieur appliqué à tout).
    const { min, max, step } = STUDIO_SLIDER;
    for (let n = min; n + step <= max; n += step) {
      const here = studioQuote(n);
      const next = studioQuote(n + step);
      expect(next.cents, `${n + step} photos ne doivent pas coûter moins que ${n}`).toBeGreaterThanOrEqual(here.cents);
      // Dégressif : le prix à la photo n'augmente pas avec le volume (à l'arrondi au centime près).
      expect(next.perPhotoCents).toBeLessThanOrEqual(here.perPhotoCents + 0.001);
    }
    expect(studioQuote(220).cents).toBeGreaterThan(studioQuote(200).cents);
    // Entre deux packs : prix du pack inférieur + photos supplémentaires au tarif marginal (ici 2 c la photo entre 200 et 1 200).
    expect(studioQuote(220).cents).toBe(999 + 20 * 2);
    expect(studioQuote(700).cents).toBe(999 + 500 * 2);
  });

  it("au-delà du plus grand pack, garde son tarif à la photo ; le plancher par photo s'impose aux packs trop bas", () => {
    const big = studioQuote(2000);
    expect(big.cents).toBe(Math.round(2999 + 800 * (2999 / 1200)));
    expect(big.cents).toBe(Math.round(2000 * (2999 / 1200)));
    expect(big.perPhotoCents).toBeGreaterThanOrEqual(PRICING.subsidiaries.studio.floorCentsPerPhoto);
    const floored = studioQuote(100, { packs: [{ photos: 100, cents: 100 }], floorCentsPerPhoto: 2, minPurchaseCents: 150 });
    expect(floored).toMatchObject({ cents: 200, perPhotoCents: 2, floorApplied: true, minimumApplied: false });
    // Plancher plus haut que le tarif marginal entre deux packs : il relève aussi les quantités intermédiaires.
    const steep = { packs: [{ photos: 100, cents: 1000 }, { photos: 200, cents: 1050 }], floorCentsPerPhoto: 6, minPurchaseCents: 0 };
    expect(studioQuote(150, steep)).toMatchObject({ cents: 1025, floorApplied: false });
    expect(studioQuote(200, steep)).toMatchObject({ cents: 1200, floorApplied: true });
  });

  it("annuel : deux mois offerts, mensualité équivalente arrondie", () => {
    expect(annualSavingsCents("pro")).toBe(PRICING.monthlyCents.pro * (12 - PRICING.annualMonthsCharged));
    expect(annualMonthlyEquivalentCents("starter")).toBe(Math.round((PRICING.monthlyCents.starter * PRICING.annualMonthsCharged) / 12));
  });
});
