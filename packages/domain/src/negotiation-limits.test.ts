import { describe, expect, it } from "vitest";
import { PLAN_QUOTAS, RULE_KINDS, RULE_KIND_LABELS, VINTED_LIMITS_DEFAULTS, marginRules, negotiationAutomation, schedule } from "@selio/contracts";
import { RULE_RUN_LOCATION } from "./automation";
import { evaluateOffer } from "./negotiation";
import {
  VINTED_LIMITS_MEASUREMENT_PROTOCOL, applyLimits, applyLimitsToDecision, checkMessageDelay, decideFollowUp, followUp24hDedupeKey, followUpModeFor, followUpTemplateAllowed, isMeasuredLimits, offerExpiresAt, recordMeasuredLimits, vintedLimitsStatus,
} from "./negotiation-limits";

const now = new Date("2026-11-07T10:00:00Z"); // samedi, 11 h à Paris
const rules = marginRules.parse({});
const item = { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000 };
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe("limites de Vinted (à mesurer)", () => {
  it("défauts prudents, jamais présentés comme vérifiés", () => {
    expect(VINTED_LIMITS_DEFAULTS).toEqual({ maxCounterOffersPerConversation: 3, offerDurationHours: 48, minDelayBetweenMessagesSeconds: 60, measuredAt: null, source: "default_conservative" });
    expect(isMeasuredLimits(VINTED_LIMITS_DEFAULTS)).toBe(false);
    expect(vintedLimitsStatus(VINTED_LIMITS_DEFAULTS)).toEqual({ measured: false, label: "Valeurs prudentes par défaut, à mesurer sur un vrai compte" });
    // « measured » sans date n'est pas une mesure.
    expect(isMeasuredLimits({ source: "measured", measuredAt: null })).toBe(false);
  });

  it("enregistre une mesure datée, refuse une valeur hors bornes", () => {
    const measured = recordMeasuredLimits(VINTED_LIMITS_DEFAULTS, { maxCounterOffersPerConversation: 5, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30 }, now);
    expect(measured).toEqual({ maxCounterOffersPerConversation: 5, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30, measuredAt: "2026-11-07T10:00:00.000Z", source: "measured" });
    expect(vintedLimitsStatus(measured)).toEqual({ measured: true, label: "Mesurées sur un vrai compte le 2026-11-07" });
    expect(() => recordMeasuredLimits(VINTED_LIMITS_DEFAULTS, { maxCounterOffersPerConversation: 0, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30 }, now)).toThrow(RangeError);
    expect(() => recordMeasuredLimits(VINTED_LIMITS_DEFAULTS, { maxCounterOffersPerConversation: 3, offerDurationHours: 1000, minDelayBetweenMessagesSeconds: 30 }, now)).toThrow(RangeError);
    expect(offerExpiresAt(now, measured).toISOString()).toBe("2026-11-08T10:00:00.000Z");
    expect(offerExpiresAt(now, VINTED_LIMITS_DEFAULTS).toISOString()).toBe("2026-11-09T10:00:00.000Z");
  });

  it("refuse une contre-offre au-delà du nombre permis et respecte le délai entre deux messages", () => {
    const base = { limits: VINTED_LIMITS_DEFAULTS, now };
    expect(applyLimits({ ...base, counterOffersSent: 3, lastOutboundAt: null })).toMatchObject({ allowed: false, reason: "max_counter_offers" });
    expect(applyLimits({ ...base, counterOffersSent: 7, lastOutboundAt: null })).toMatchObject({ allowed: false, reason: "max_counter_offers", detail: expect.stringContaining("valeur prudente, à mesurer") });
    expect(applyLimits({ ...base, counterOffersSent: 2, lastOutboundAt: new Date(now.getTime() - 10_000) })).toEqual({ allowed: false, reason: "too_soon", waitSeconds: 50, detail: expect.stringContaining("60 s") });
    expect(applyLimits({ ...base, counterOffersSent: 2, lastOutboundAt: new Date(now.getTime() - 120_000) })).toEqual({ allowed: true, waitSeconds: 0 });
    expect(applyLimits({ ...base, counterOffersSent: 0, lastOutboundAt: null })).toEqual({ allowed: true, waitSeconds: 0 });
    expect(checkMessageDelay({ ...base, counterOffersSent: 9, lastOutboundAt: "date illisible" })).toEqual({ allowed: true, waitSeconds: 0 });
    // Une mesure plus permissive s'applique telle quelle, et le détail le dit.
    const measured = recordMeasuredLimits(VINTED_LIMITS_DEFAULTS, { maxCounterOffersPerConversation: 5, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 0 }, now);
    expect(applyLimits({ limits: measured, now, counterOffersSent: 3, lastOutboundAt: now })).toEqual({ allowed: true, waitSeconds: 0 });
    expect(applyLimits({ limits: measured, now, counterOffersSent: 5, lastOutboundAt: null })).toMatchObject({ allowed: false, detail: expect.stringContaining("valeur mesurée") });
  });

  it("applique les limites à une décision : transmission au-delà des contre-offres, attente si trop tôt", () => {
    const counter = evaluateOffer({ item, offerCents: 2500, rules, roundsSoFar: 0 });
    expect(counter.decision).toBe("counter");
    const blocked = applyLimitsToDecision(counter, { limits: VINTED_LIMITS_DEFAULTS, now, counterOffersSent: 3, lastOutboundAt: null });
    expect(blocked).toMatchObject({ decision: "escalate", counterCents: null, requiresApproval: true, deferUntil: null, limits: { reason: "max_counter_offers" } });
    expect(blocked.reasons.at(-1)).toMatch(/Limite Vinted/);
    const soon = applyLimitsToDecision(counter, { limits: VINTED_LIMITS_DEFAULTS, now, counterOffersSent: 0, lastOutboundAt: new Date(now.getTime() - 10_000) });
    expect(soon.decision).toBe("hold");
    expect(soon.deferUntil?.toISOString()).toBe("2026-11-07T10:00:50.000Z");
    const fine = applyLimitsToDecision(counter, { limits: VINTED_LIMITS_DEFAULTS, now, counterOffersSent: 0, lastOutboundAt: null });
    expect(fine).toMatchObject({ decision: "counter", counterCents: counter.counterCents, deferUntil: null, limits: { allowed: true } });
    // Accepter ou refuser envoie un message : le délai s'applique, pas le nombre de contre-offres.
    const accept = evaluateOffer({ item, offerCents: 3800, rules, roundsSoFar: 0 });
    expect(applyLimitsToDecision(accept, { limits: VINTED_LIMITS_DEFAULTS, now, counterOffersSent: 9, lastOutboundAt: null }).decision).toBe("accept");
    expect(applyLimitsToDecision(accept, { limits: VINTED_LIMITS_DEFAULTS, now, counterOffersSent: 0, lastOutboundAt: now }).decision).toBe("hold");
    // Une décision qui n'envoie rien ne change pas.
    const escalate = evaluateOffer({ item, offerCents: 2500, rules, roundsSoFar: 5 });
    expect(applyLimitsToDecision(escalate, { limits: VINTED_LIMITS_DEFAULTS, now, counterOffersSent: 0, lastOutboundAt: now })).toMatchObject({ decision: "escalate", deferUntil: null });
  });

  it("documente un protocole de mesure manuel, sur un compte de l'équipe, sans contournement", () => {
    expect(VINTED_LIMITS_MEASUREMENT_PROTOCOL.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
    const text = VINTED_LIMITS_MEASUREMENT_PROTOCOL.map((s) => `${s.title} ${s.detail}`).join(" ");
    expect(text).toMatch(/Jamais le compte d'un client/);
    expect(text).toMatch(/CAPTCHA/);
    expect(text).toMatch(/aucun contournement/i);
    expect(text).toMatch(/chaque trimestre/);
  });

  it("chaque sorte de règle a un emplacement et un libellé", () => {
    for (const kind of RULE_KINDS) {
      expect(RULE_RUN_LOCATION[kind].location).toMatch(/^(server|browser)$/);
      expect(RULE_KIND_LABELS[kind].length).toBeGreaterThan(3);
    }
    expect(RULE_RUN_LOCATION.follow_up_24h.location).toBe("server");
    expect(RULE_RUN_LOCATION.keyword_situation.location).toBe("browser");
  });
});

describe("relance après 24 h", () => {
  const conv = (lastMessageDirection: "inbound" | "outbound" | null, hoursAgo: number | null, status: "open" | "archived" = "open") => ({ status, lastMessageDirection, lastMessageAt: hoursAgo === null ? null : ago(hoursAgo) });

  it("mode selon l'offre : rien, proposée (Pro) ou automatique via le Cloud (Agence)", () => {
    expect(followUpModeFor("free")).toBe("none");
    expect(followUpModeFor("starter")).toBe("none");
    expect(followUpModeFor("pro")).toBe("suggested");
    expect(followUpModeFor("agence")).toBe("auto");
    expect(followUpModeFor("inconnu")).toBe("none");
    expect(followUpModeFor(PLAN_QUOTAS.agence)).toBe("auto");
    expect(followUpModeFor("suggested")).toBe("suggested");
  });

  it("Pro : brouillon à valider ; Agence : tâche Cloud ; autres offres : rien", () => {
    const base = { conversation: conv("outbound", 25), now, alreadyFollowedUp: false };
    expect(decideFollowUp({ ...base, plan: "pro" })).toMatchObject({ action: "draft", code: "draft", runsIn: "server", jobStatus: "awaiting_approval", hoursSinceLastMessage: 25 });
    expect(decideFollowUp({ ...base, plan: "agence" })).toMatchObject({ action: "cloud", code: "cloud", runsIn: "cloud", jobStatus: "queued" });
    expect(decideFollowUp({ ...base, plan: { followUp24h: "auto" } })).toMatchObject({ action: "cloud" });
    expect(decideFollowUp({ ...base, plan: "starter" })).toMatchObject({ action: "none", code: "not_in_plan", runsIn: null, jobStatus: null });
    expect(decideFollowUp({ ...base, plan: "free" })).toMatchObject({ action: "none", code: "not_in_plan" });
  });

  it("une seule relance par conversation, jamais quand l'acheteur a répondu", () => {
    expect(decideFollowUp({ conversation: conv("outbound", 48), plan: "agence", now, alreadyFollowedUp: true })).toMatchObject({ action: "none", code: "already_followed_up" });
    expect(decideFollowUp({ conversation: conv("inbound", 48), plan: "agence", now, alreadyFollowedUp: false })).toMatchObject({ action: "none", code: "buyer_replied" });
    expect(decideFollowUp({ conversation: conv(null, null), plan: "agence", now, alreadyFollowedUp: false })).toMatchObject({ action: "none", code: "no_message" });
    expect(decideFollowUp({ conversation: conv("outbound", 48, "archived"), plan: "agence", now, alreadyFollowedUp: false })).toMatchObject({ action: "none", code: "archived" });
    // La clé d'idempotence ne dépend ni du jour ni de la règle : impossible de relancer « demain ».
    expect(followUp24hDedupeKey("conv-1")).toBe("follow_up_24h:conv-1");
    expect(followUp24hDedupeKey("conv-1")).toBe(followUp24hDedupeKey("conv-1"));
  });

  it("délai de 24 h par défaut, réglable, et plus de relance après 7 jours", () => {
    expect(decideFollowUp({ conversation: conv("outbound", 23), plan: "pro", now, alreadyFollowedUp: false })).toMatchObject({ action: "none", code: "delay_not_reached" });
    expect(decideFollowUp({ conversation: conv("outbound", 24), plan: "pro", now, alreadyFollowedUp: false })).toMatchObject({ action: "draft" });
    expect(decideFollowUp({ conversation: conv("outbound", 13), plan: "pro", now, alreadyFollowedUp: false, delayHours: 12 })).toMatchObject({ action: "draft" });
    expect(decideFollowUp({ conversation: conv("outbound", 24 * 8), plan: "pro", now, alreadyFollowedUp: false })).toMatchObject({ action: "none", code: "too_old" });
    expect(decideFollowUp({ conversation: conv("outbound", 24 * 8), plan: "pro", now, alreadyFollowedUp: false, maxAgeHours: 24 * 30 })).toMatchObject({ action: "draft" });
  });

  it("hors des heures actives : différée ; dans les heures : décidée", () => {
    const weekdays = schedule.parse({ days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, timezone: "Europe/Paris" });
    // Samedi : hors plage.
    expect(decideFollowUp({ conversation: conv("outbound", 30), plan: "agence", now, alreadyFollowedUp: false, schedule: weekdays })).toMatchObject({ action: "none", code: "outside_schedule" });
    const monday = new Date("2026-11-09T10:00:00Z");
    expect(decideFollowUp({ conversation: conv("outbound", 30), plan: "agence", now: monday, alreadyFollowedUp: false, schedule: weekdays })).toMatchObject({ action: "cloud" });
    const night = new Date("2026-11-09T22:30:00Z");
    expect(decideFollowUp({ conversation: conv("outbound", 30), plan: "pro", now: night, alreadyFollowedUp: false, schedule: weekdays })).toMatchObject({ action: "none", code: "outside_schedule" });
    expect(decideFollowUp({ conversation: conv("outbound", 30), plan: "pro", now: night, alreadyFollowedUp: false, schedule: null })).toMatchObject({ action: "draft" });
  });
});

describe("gabarit de relance vérifié côté serveur", () => {
  it("aucun chiffre hors de {prenom} et {article}, ni « meilleur / dernier prix », ni lien", () => {
    expect(followUpTemplateAllowed("Bonjour {prenom}, « {article} » est toujours disponible.")).toBe(true);
    expect(followUpTemplateAllowed("Bonjour {prenom}, -10 % si vous vous décidez !")).toBe(false);
    expect(followUpTemplateAllowed("Bonjour, réponse sous 24 h.")).toBe(false);
    expect(followUpTemplateAllowed("Bonjour, c'est mon dernier prix.")).toBe(false);
    expect(followUpTemplateAllowed("Bonjour, mon meilleur prix vous attend.")).toBe(false);
    expect(followUpTemplateAllowed("Bonjour, voir www.exemple.fr")).toBe(false);
    expect(followUpTemplateAllowed(automationSettingsDefaultsFollowUp())).toBe(true);
  });
});

function automationSettingsDefaultsFollowUp(): string {
  return negotiationAutomation.parse({}).messages.followUp;
}
