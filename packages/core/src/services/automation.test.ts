import { describe, expect, it } from "vitest";
import { marginRules } from "@selio/contracts";
import { evaluateOffer } from "@selio/domain";
import { autoNegotiateBody, decideRunsIn } from "./automation";

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

describe("transport d'une tâche : serveur, extension ou Cloud (fonction pure)", () => {
  const active = { status: "active" as const, hasSession: true };

  it("réponse et relance passent par le Cloud quand le compte de la conversation y est actif", () => {
    expect(decideRunsIn({ ruleKind: "reply_on_new_message", ruleRunsIn: "browser", cloudAccount: active })).toBe("cloud");
    expect(decideRunsIn({ ruleKind: "follow_up_no_reply", ruleRunsIn: "server", cloudAccount: active })).toBe("cloud");
  });

  it("compte absent, en pause, à reconnecter, arrêté ou sans session : la règle garde son emplacement", () => {
    for (const cloudAccount of [null, undefined, { status: "paused" as const, hasSession: true }, { status: "needs_login" as const, hasSession: false }, { status: "stopped" as const, hasSession: false }, { status: "active" as const, hasSession: false }]) {
      expect(decideRunsIn({ ruleKind: "reply_on_new_message", ruleRunsIn: "browser", cloudAccount })).toBe("browser");
      expect(decideRunsIn({ ruleKind: "follow_up_no_reply", ruleRunsIn: "server", cloudAccount })).toBe("server");
    }
  });

  it("les autres règles ne passent jamais par le Cloud au lancement (actions légères seulement)", () => {
    for (const ruleKind of ["auto_negotiate", "post_sale_message", "relist_stale", "price_drop_stale"] as const) {
      expect(decideRunsIn({ ruleKind, ruleRunsIn: "browser", cloudAccount: active })).toBe("browser");
    }
    // Une règle enregistrée « cloud » sans compte actif part vers l'extension.
    expect(decideRunsIn({ ruleKind: "relist_stale", ruleRunsIn: "cloud", cloudAccount: null })).toBe("browser");
  });
});
