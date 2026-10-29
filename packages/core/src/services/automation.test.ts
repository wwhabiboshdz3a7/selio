import { describe, expect, it } from "vitest";
import { marginRules } from "@selio/contracts";
import { evaluateOffer } from "@selio/domain";
import { autoNegotiateBody } from "./automation";

describe("négociation automatique : message sans IA (fonction pure)", () => {
  const rules = marginRules.parse({});
  const item = { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000 };
  const counter = evaluateOffer({ item, offerCents: 2500, rules, roundsSoFar: 0 });

  it("contre-offre au-dessus du plancher : formule neutre, sans « meilleur prix » ni « dernier prix »", () => {
    expect(counter.decision).toBe("counter");
    expect(counter.counterCents).toBeGreaterThan(counter.floorCents);
    const body = autoNegotiateBody(counter, 2500, "Léa");
    expect(body).toBe("Bonjour Léa, merci pour votre proposition. Je peux vous le faire à 38,00 €. Si cela vous convient, faites l'offre à ce montant.");
    expect(body).not.toMatch(/meilleur prix|dernier prix/i);
  });

  it("contre-offre au plancher (counterCents === floorCents) : « dernier prix »", () => {
    const atFloor = { ...counter, counterCents: counter.floorCents };
    const body = autoNegotiateBody(atFloor, 2500, "Léa");
    expect(body).toBe("Bonjour Léa, merci pour votre proposition. Je peux aller jusqu'à 30,00 €, c'est mon dernier prix pour cet article. Si cela vous convient, faites l'offre à ce montant.");
    expect(body).not.toMatch(/meilleur prix/i);
  });

  it("acceptation et refus : inchangés, aucun gabarit ne contient « meilleur prix »", () => {
    const accept = evaluateOffer({ item, offerCents: 3900, rules, roundsSoFar: 0 });
    expect(accept.decision).toBe("accept");
    expect(autoNegotiateBody(accept, 3900, "Léa")).toBe("Bonjour Léa, c'est d'accord pour 39,00 €. Faites l'offre sur l'annonce et je l'accepte.");
    const decline = { ...counter, decision: "decline" as const, counterCents: null };
    expect(autoNegotiateBody(decline, 1000, "Léa")).toBe("Bonjour Léa, merci pour l'intérêt. Je ne peux pas descendre à ce prix, l'article reste disponible au prix affiché.");
    for (const ev of [accept, counter, decline]) expect(autoNegotiateBody(ev, 2500, "Léa")).not.toMatch(/meilleur prix/i);
  });
});
