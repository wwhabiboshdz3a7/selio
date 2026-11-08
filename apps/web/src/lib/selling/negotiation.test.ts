import { describe, expect, it } from "vitest";
import { negotiationAutomation } from "@selio/contracts";
import { bundleProposalText, conversationFollowUp, followUpHasDigits, followUpRuleIds, followUpText, isFollowUpMessage, mentionsBundle } from "./negotiation";

const messages = negotiationAutomation.parse({}).messages;
const at = (h: number) => new Date(Date.UTC(2026, 10, 7, 12) - h * 3_600_000).toISOString();
const now = new Date("2026-11-07T12:00:00Z");

describe("aides de la négociation avancée (affichage seulement)", () => {
  it("badge « Lot » : mots entiers, sans accents ni majuscules ; jamais une interprétation", () => {
    expect(mentionsBundle("Je prends si vous faites un LOT avec le cardigan")).toBe(true);
    expect(mentionsBundle("Je peux faire les deux à 40 €")).toBe(true);
    expect(mentionsBundle("Toujours dispo ?")).toBe(false);
    expect(mentionsBundle("Une belle lotion")).toBe(false);
    expect(mentionsBundle(null)).toBe(false);
  });

  it("relance : brouillon en Pro, Cloud en Agence, rien sans l'offre ; jamais deux par conversation", () => {
    const ids = followUpRuleIds([{ id: "r1", kind: "follow_up_24h" }, { id: "r2", kind: "reply_on_new_message" }]);
    expect([...ids]).toEqual(["r1"]);
    const base = [{ direction: "outbound" as const, status: "sent" as const, createdAt: at(30), ruleId: null, source: "user" as const }];
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: base, mode: "suggested", ruleIds: ids, now }).action).toBe("draft");
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: base, mode: "auto", ruleIds: ids, now })).toMatchObject({ action: "cloud", runsIn: "cloud" });
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: base, mode: "none", ruleIds: ids, now }).code).toBe("not_in_plan");
    // Moins de 24 h, ou l'acheteur a répondu : rien.
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: [{ ...base[0]!, createdAt: at(3) }], mode: "suggested", ruleIds: ids, now }).code).toBe("delay_not_reached");
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: [{ ...base[0]!, direction: "inbound" }], mode: "suggested", ruleIds: ids, now }).code).toBe("buyer_replied");
    // Une relance existe déjà (brouillon compris) : jamais une deuxième. Le brouillon ne compte pas comme dernier message.
    const followed = [...base, { direction: "outbound" as const, status: "draft" as const, createdAt: at(1), ruleId: "r1", source: "automation" as const }];
    expect(isFollowUpMessage(followed[1]!, ids)).toBe(true);
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: followed, mode: "suggested", ruleIds: ids, now }).code).toBe("already_followed_up");
    // Hors des heures actives : différée.
    const night = new Date("2026-11-08T02:00:00Z");
    expect(conversationFollowUp({ conversation: { status: "open" }, messages: base, mode: "suggested", ruleIds: ids, now: night, schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 9, endHour: 21, timezone: "Europe/Paris" } }).code).toBe("outside_schedule");
  });

  it("textes : relance sans chiffre, lot au prix du lot sans « dernier prix »", () => {
    expect(followUpText(messages.followUp, { prenom: "Léa", article: "Pull marine" })).toContain("« Pull marine »");
    expect(followUpHasDigits(messages.followUp)).toBe(false);
    expect(followUpHasDigits("Bonjour {prenom}, encore dispo à 20 € !")).toBe(true);
    const t = bundleProposalText({ prenom: "Léa", titles: ["Pull", "Jean"], priceCents: 4500, listedTotalCents: 5200, messages });
    expect(t).toMatch(/^Bonjour Léa, je vous propose un lot : « Pull », « Jean »\./);
    expect(t).toContain("45,00");
    expect(t).not.toMatch(/dernier prix|meilleur prix/i);
  });
});
