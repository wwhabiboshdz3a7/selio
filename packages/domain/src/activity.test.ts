import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@selio/contracts";
import { activityLink, counterpartName, describeActivity } from "./activity";

const base: ActivityRow = {
  id: "r1", at: "2026-11-16T10:00:00.000Z", verb: "item.created", actorKind: "member", actorUserId: "u1", targetType: "item", targetId: "i1",
  itemId: "i1", itemTitle: "Veste Levi's", counterpart: null, priceCents: null, purchaseCents: null, status: "done", data: {},
};
const row = (patch: Partial<ActivityRow>): ActivityRow => ({ ...base, ...patch });
const names = (id: string) => (id === "u1" ? "Marie" : null);

describe("journal d'activité : phrases", () => {
  it("article ajouté par un membre, nommé, avec lien vers la fiche", () => {
    const e = describeActivity(base, { finances: true, memberName: names });
    expect(e.actor).toEqual({ kind: "member", userId: "u1", name: "Marie" });
    expect(e.summary).toBe("a ajouté l'article « Veste Levi's »");
    expect(e.automatic).toBe(false);
    expect(e.category).toBe("stock");
    expect(e.link).toBe("/app/items/i1");
  });

  it("négociation : contre-offre, acceptation à valider, refus ; prénom seulement, lien vers la conversation", () => {
    const counter = describeActivity(row({ verb: "negotiation.countered", actorKind: "selio", actorUserId: null, counterpart: "Léa", priceCents: 3500, targetType: "conversation", targetId: "c1" }), { finances: false });
    expect(counter.actor.name).toBe("Selio");
    expect(counter.summary).toBe("a fait une contre-offre à Léa : 35,00 €");
    expect(counter.automatic).toBe(true);
    expect(counter.link).toBe("/app/messages/c1");
    expect(describeActivity(row({ verb: "negotiation.accepted", actorKind: "selio", counterpart: "Léa", priceCents: 3000, status: "pending" }), { finances: false }).summary).toBe("propose d'accepter l'offre de Léa à 30,00 € (à valider)");
    expect(describeActivity(row({ verb: "negotiation.refused", actorKind: "selio", counterpart: "Tom" }), { finances: false }).summary).toBe("a refusé poliment l'offre de Tom");
  });

  it("prix d'achat montré seulement avec « finances.read » (achat Radar, achat validé)", () => {
    const r = row({ verb: "purchase.validated", purchaseCents: 1200, targetType: "purchase", targetId: "p1" });
    expect(describeActivity(r, { finances: true }).summary).toBe("a validé l'achat de « Veste Levi's » pour 12,00 €");
    const hidden = describeActivity(r, { finances: false });
    expect(hidden.summary).toBe("a validé l'achat de « Veste Levi's »");
    expect(hidden.purchaseCents).toBeNull();
    expect(hidden.link).toBe("/app/purchase");
  });

  it("fiche modifiée : le prix d'achat n'est pas cité pour l'exécuteur", () => {
    const r = row({ verb: "item.updated", data: { changes: { title: { from: "a", to: "b" }, purchasePriceCents: { from: 1, to: 2 } } } });
    expect(describeActivity(r, { finances: true }).summary).toBe("a modifié la fiche « Veste Levi's » (titre, prix d'achat)");
    expect(describeActivity(r, { finances: false }).summary).toBe("a modifié la fiche « Veste Levi's » (titre)");
  });

  it("Studio : photos triées et étiquette lue ; annonce rédigée avec prix estimé", () => {
    expect(describeActivity(row({ verb: "studio.prepared", actorKind: "studio", data: { photos: 5, labelRead: true, brand: "Zara", size: "M" } }), { finances: false }).summary).toBe("a trié 5 photos et lu l'étiquette (Zara, taille M)");
    const listing = describeActivity(row({ verb: "studio.listing_written", actorKind: "studio", priceCents: 2500 }), { finances: false });
    expect(listing.actor.name).toBe("Studio");
    expect(listing.summary).toBe("a rédigé l'annonce « Veste Levi's » et estimé le prix à 25,00 €");
  });

  it("statut, prix, photos, réponse IA, relance, vente", () => {
    expect(describeActivity(row({ verb: "item.status_changed", data: { changes: { status: { from: "in_stock", to: "listed" } } } }), { finances: true }).summary).toBe("a mis « Veste Levi's » en vente");
    expect(describeActivity(row({ verb: "item.price_changed", data: { changes: { listedPriceCents: { from: 4000, to: 3500 } } } }), { finances: true }).summary).toBe("a changé le prix de « Veste Levi's » : 40,00 € → 35,00 €");
    expect(describeActivity(row({ verb: "item.photos_added", data: { changes: { photos: { from: 1, to: 4 } } } }), { finances: true }).summary).toBe("a ajouté 3 photos à « Veste Levi's »");
    expect(describeActivity(row({ verb: "message.sent", counterpart: "Léa", data: { ai: true } }), { finances: true }).summary).toBe("a envoyé une réponse rédigée avec l'IA à Léa");
    expect(describeActivity(row({ verb: "followup.sent", actorKind: "selio", counterpart: "Léa" }), { finances: true }).summary).toBe("a relancé Léa (sans réponse depuis 24 h)");
    expect(describeActivity(row({ verb: "order.created", actorKind: "selio", counterpart: "Léa", priceCents: 4500, targetType: "order", targetId: "o1" }), { finances: false }).summary).toBe("a enregistré la vente de « Veste Levi's » à Léa pour 45,00 €");
  });

  it("Selio Bot : phrase fournie, nettoyée ; acteur « Selio Bot » ; famille bot", () => {
    const e = describeActivity(row({ verb: "bot.offer_sent", actorKind: "bot", actorUserId: null, counterpart: "Léa", priceCents: 2000, data: { summary: "a envoyé une offre groupée à Léa" } }), { finances: false });
    expect(e.actor.name).toBe("Selio Bot");
    expect(e.category).toBe("bot");
    expect(e.summary).toBe("a envoyé une offre groupée à Léa");
    expect(describeActivity(row({ verb: "bot.offer_sent", actorKind: "bot", counterpart: "Léa", priceCents: 2000 }), { finances: false }).summary).toBe("a envoyé une offre à Léa : 20,00 €");
  });

  it("membre inconnu, article supprimé sans lien, prénom de l'acheteur", () => {
    expect(describeActivity(row({ actorUserId: "u9" }), { finances: true, memberName: names }).actor.name).toBe("Un membre de l'équipe");
    expect(activityLink(row({ verb: "item.deleted" }))).toBeNull();
    expect(counterpartName("Léa Martin", "lea_m")).toBe("Léa");
    expect(counterpartName("", "lea_m")).toBe("lea_m");
  });
});
