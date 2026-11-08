import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { automationSettings, marginRules, schedule } from "@selio/contracts";
import { evaluateOffer } from "./negotiation";
import { allocateProportionally, bundleMessage, bundlePolicyFor, bundleReplyKind, bundleTemplateAllowed, evaluateBundleOffer, fillBundleTemplate, lotFloorCents } from "./negotiation-lots";

const rules = marginRules.parse({ minMarginRate: 0.25, minMarginCents: 500, maxDiscountRate: 0.2, counterStepRate: 0.05, maxRoundsPerCustomer: 2 });
// Total affiché 60 €, somme des planchers réels 46 €.
const items = [
  { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000 },
  { purchasePriceCents: 1000, purchaseFeesCents: 0, listedPriceCents: 2000, floorPriceCents: 1600 },
];
const policy = { maxDiscountRate: 0.25, minItems: 2 };
const messages = automationSettings.parse({}).negotiation.messages;

describe("négociation sur un lot", () => {
  it("plancher du lot : total affiché moins la remise de lot, jamais sous la somme des planchers réels", () => {
    // 25 % de 60 € = 45 € < 46 € de planchers réels : le plancher du lot reste 46 €.
    expect(lotFloorCents(items, rules, policy)).toEqual({ floorSumCents: 4600, listedTotalCents: 6000, floorCents: 4600 });
    // 10 % seulement : 54 € > 46 €, c'est la remise de lot qui borne.
    expect(lotFloorCents(items, rules, { maxDiscountRate: 0.1 }).floorCents).toBe(5400);
    // Sans plancher fixé, le plancher suggéré par les règles de marge sert de plancher réel.
    const suggested = lotFloorCents([{ ...items[0]!, floorPriceCents: null }, items[1]!], rules, policy);
    expect(suggested.floorSumCents).toBeGreaterThan(1600);
    // Un article sans prix affiché : pas de total, plancher = somme des planchers.
    expect(lotFloorCents([items[0]!, { ...items[1]!, listedPriceCents: null }], rules, policy)).toMatchObject({ listedTotalCents: null, floorCents: 4600 });
  });

  it("ne descend jamais sous la somme des planchers réels, quelles que soient l'offre, la remise et le tour (propriété)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12_000 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 5 }), (offerCents, maxDiscountRate, roundsSoFar) => {
        const r = evaluateBundleOffer({ items, offerCents, rules: { ...rules, maxRoundsPerCustomer: 10 }, bundlePolicy: { maxDiscountRate, minItems: 2 }, roundsSoFar });
        expect(r.floorCents).toBeGreaterThanOrEqual(r.floorSumCents);
        expect(r.floorSumCents).toBe(4600);
        if (r.counterCents !== null) {
          expect(r.counterCents).toBeGreaterThanOrEqual(r.floorCents);
          expect(r.counterCents).toBeGreaterThan(offerCents);
        }
        if (r.decision === "accept") expect(offerCents).toBeGreaterThanOrEqual(r.floorCents);
        expect(r.perItemAllocationCents.reduce((a, b) => a + b, 0)).toBe(r.settledCents);
        expect(r.perItemAllocationCents).toHaveLength(2);
      }),
      { numRuns: 300 },
    );
  });

  it("mêmes paliers et même approbation que l'article seul", () => {
    const r0 = evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(r0.decision).toBe("counter");
    expect(r0.counterCents).toBe(5700); // 60 € − 5 %
    expect(r0.requiresApproval).toBe(false);
    expect(r0.reasons[0]).toMatch(/Lot de 2 articles : total affiché 60,00 €, plancher du lot 46,00 €/);
    // L'article synthétique (somme des coûts, total affiché, plancher du lot) donne exactement le même palier.
    const single = evaluateOffer({ item: { purchasePriceCents: 2500, purchaseFeesCents: 0, listedPriceCents: 6000, floorPriceCents: 4600 }, offerCents: 4000, rules: { ...rules, maxDiscountRate: 0.25 }, roundsSoFar: 0 });
    expect(single.counterCents).toBe(r0.counterCents);
    const r1 = evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 1 });
    expect(r1.counterCents).toBe(5400);
    const r2 = evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 2 });
    expect(r2.decision).toBe("escalate");
    expect(r2.requiresApproval).toBe(true);
    // Offre au-dessus du plancher du lot et dans la remise de lot : acceptée sans validation.
    const ok = evaluateBundleOffer({ items, offerCents: 5500, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(ok.decision).toBe("accept");
    expect(ok.requiresApproval).toBe(false);
    expect(ok.settledCents).toBe(5500);
    // Hors plage horaire : différé, comme l'article seul.
    const s = schedule.parse({ days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, timezone: "Europe/Paris" });
    expect(evaluateBundleOffer({ items, offerCents: 5500, rules, bundlePolicy: policy, roundsSoFar: 0, schedule: s, now: new Date("2026-10-11T12:00:00Z") }).decision).toBe("hold");
  });

  it("répartit le prix retenu au prorata du prix affiché, en centimes exacts", () => {
    expect(allocateProportionally(4600, [4000, 2000])).toEqual([3067, 1533]);
    expect(allocateProportionally(5500, [4000, 2000])).toEqual([3667, 1833]);
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportionally(100, [0, 0, 0])).toEqual([34, 33, 33]);
    expect(allocateProportionally(0, [4000, 2000])).toEqual([0, 0]);
    expect(allocateProportionally(100, [])).toEqual([]);
    const accepted = evaluateBundleOffer({ items, offerCents: 5500, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(accepted.perItemAllocationCents).toEqual([3667, 1833]);
    const countered = evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(countered.perItemAllocationCents).toEqual([3800, 1900]);
    fc.assert(fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 8 }), (total, weights) => {
      const parts = allocateProportionally(total, weights);
      expect(parts).toHaveLength(weights.length);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }));
  });

  it("transmet au vendeur un lot vide, trop petit ou sans prix affiché", () => {
    expect(evaluateBundleOffer({ items: [], offerCents: 1000, rules, bundlePolicy: policy, roundsSoFar: 0 })).toMatchObject({ decision: "escalate", requiresApproval: true, itemCount: 0 });
    const small = evaluateBundleOffer({ items: [items[0]!], offerCents: 3500, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(small.decision).toBe("escalate");
    expect(small.reasons[0]).toMatch(/en dessous du minimum de 2/);
    const noPrice = evaluateBundleOffer({ items: [items[0]!, { ...items[1]!, listedPriceCents: null }], offerCents: 5000, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(noPrice.decision).toBe("escalate");
    expect(noPrice.floorCents).toBe(4600);
  });

  it("la politique de lot des réglages accepte au moins la remise de lot proposée spontanément", () => {
    const n = automationSettings.parse({}).negotiation;
    expect(bundlePolicyFor(n, 2)).toEqual({ enabled: true, maxDiscountRate: 0.25, minItems: 2 });
    const stingy = { ...n, bundle: { ...n.bundle, maxDiscountRate: 0.05 } };
    expect(bundlePolicyFor(stingy, 2).maxDiscountRate).toBe(0.1);
    expect(bundlePolicyFor(stingy, 3).maxDiscountRate).toBe(0.15);
    expect(bundlePolicyFor({ ...stingy, lot: { ...n.lot, enabled: false } }, 3).maxDiscountRate).toBe(0.05);
  });

  it("gabarits de lot : « dernier prix » seulement au plancher du lot, jamais « meilleur prix »", () => {
    const counter = evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(bundleReplyKind(counter)).toBe("counter");
    const text = bundleMessage(counter, messages, { prenom: "Léa" })!;
    expect(text).toBe("Pour le lot de 2 articles, je peux vous le faire à 57,00 €. Si cela vous convient, faites l'offre à ce montant.");
    expect(text).not.toMatch(/dernier prix|meilleur prix/i);
    // Un grand pas ramène la contre-proposition au plancher du lot : offre finale.
    const final = evaluateBundleOffer({ items, offerCents: 4000, rules: { ...rules, counterStepRate: 0.5 }, bundlePolicy: policy, roundsSoFar: 0 });
    expect(final.counterCents).toBe(4600);
    expect(bundleReplyKind(final)).toBe("final");
    expect(bundleMessage(final, messages)).toContain("je peux aller jusqu'à 46,00 €, c'est mon dernier prix pour ce lot");
    const accepted = evaluateBundleOffer({ items, offerCents: 5500, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(bundleMessage(accepted, messages)).toBe("Parfait, c'est d'accord pour le lot de 2 articles à 55,00 € ! Je prépare le colis dès votre achat.");
    expect(bundleMessage(evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 2 }), messages)).toBeNull();
    for (const t of [messages.bundleCounter, messages.bundleFinal, messages.bundleAccepted]) expect(t).not.toMatch(/meilleur prix/i);
  });

  it("gabarit de lot modifié hors de l'écran : « meilleur prix » ou « dernier prix » mal placé → gabarit par défaut", () => {
    expect(bundleTemplateAllowed("counter", "Lot à {prix}, mon meilleur prix.")).toBe(false);
    expect(bundleTemplateAllowed("counter", "Lot à {prix}, c'est mon dernier prix.")).toBe(false);
    expect(bundleTemplateAllowed("accepted", "D'accord, dernier prix {prix}.")).toBe(false);
    expect(bundleTemplateAllowed("final", "Lot à {prix}, mon dernier prix.")).toBe(true);
    expect(bundleTemplateAllowed("final", "Lot à {prix}, mon Meilleur Prix.")).toBe(false);
    const bad = { bundleCounter: "Lot à {prix}, c'est mon meilleur prix !", bundleFinal: "{prix}, meilleur prix", bundleAccepted: "Ok {prix}, dernier prix" };
    const counter = evaluateBundleOffer({ items, offerCents: 4000, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(bundleMessage(counter, bad)).toBe(bundleMessage(counter, messages));
    const final = evaluateBundleOffer({ items, offerCents: 4000, rules: { ...rules, counterStepRate: 0.5 }, bundlePolicy: policy, roundsSoFar: 0 });
    expect(bundleMessage(final, bad)).toBe(bundleMessage(final, messages));
    const accepted = evaluateBundleOffer({ items, offerCents: 5500, rules, bundlePolicy: policy, roundsSoFar: 0 });
    expect(bundleMessage(accepted, bad)).toBe(bundleMessage(accepted, messages));
    for (const r of [counter, final, accepted]) expect(bundleMessage(r, bad)).not.toMatch(/meilleur prix/i);
  });

  it("remplit les variables des gabarits de lot", () => {
    expect(fillBundleTemplate("{prenom} : {nb_articles} articles à {prix} au lieu de {prix_initial} ({article}) {inconnu}", { prenom: "Léa", nb_articles: 3, prix: "50,00 €", prix_initial: "60,00 €", article: "Veste" })).toBe("Léa : 3 articles à 50,00 € au lieu de 60,00 € (Veste) {inconnu}");
    expect(fillBundleTemplate("{prenom}{prix}", {})).toBe("");
  });
});
