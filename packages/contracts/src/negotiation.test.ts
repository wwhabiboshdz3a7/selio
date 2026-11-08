import { describe, expect, it } from "vitest";
import {
  CLOUD_ACTION_LEVEL_BY_KIND, CLOUD_RULE_ACTIONS, FOLLOW_UP_24H_DEFAULT_DELAY_HOURS, FOLLOW_UP_24H_MAX_AGE_HOURS, RULE_KINDS, RULE_KIND_LABELS, VINTED_LIMITS_DEFAULTS,
  automationRuleCreate, automationSettings, bundleOfferPolicy, keywordSituation, orgSettings, ruleConfig, vintedLimits, vintedLimitsMeasurementInput,
} from "./index";

describe("négociation avancée : réglages", () => {
  it("politique de lot par défaut : activée, 25 % au plus sur le total du lot, 2 articles au moins", () => {
    const n = automationSettings.parse({}).negotiation;
    expect(n.bundle).toEqual({ enabled: true, maxDiscountRate: 0.25, minItems: 2 });
    expect(bundleOfferPolicy.safeParse({ minItems: 1 }).success).toBe(false);
    expect(bundleOfferPolicy.safeParse({ maxDiscountRate: 1.5 }).success).toBe(false);
    // Les anciens réglages (sans `bundle`) se lisent toujours.
    expect(orgSettings.parse({ automation: { negotiation: { lot: { enabled: false } } } }).automation.negotiation.bundle.minItems).toBe(2);
  });

  it("gabarits de lot et de relance : « dernier prix » seulement dans l'offre finale, jamais « meilleur prix », relance sans chiffre", () => {
    const m = automationSettings.parse({}).negotiation.messages;
    expect(m.bundleCounter).toContain("{nb_articles}");
    expect(m.bundleCounter).toContain("{prix}");
    expect(m.bundleCounter).not.toMatch(/dernier prix|meilleur prix/i);
    expect(m.bundleFinal).toMatch(/dernier prix pour ce lot/);
    expect(m.bundleAccepted).not.toMatch(/dernier prix|meilleur prix/i);
    expect(m.followUp).toContain("{article}");
    expect(m.followUp).not.toMatch(/\d/);
    expect(m.followUp).not.toMatch(/dernier prix|meilleur prix|{prix}/i);
    for (const text of Object.values(m)) expect(text).not.toMatch(/meilleur prix/i);
  });

  it("situations par mots-clés : vides par défaut, schéma strict, surcharge limitée à « escalate »", () => {
    expect(automationSettings.parse({}).autoReply.situations).toEqual([]);
    const ok = keywordSituation.parse({ id: "defaut", name: "Défaut", keywords: ["défaut", "abîmé"], response: { kind: "ai", guidance: "Reste courtois." }, decisionOverride: "escalate" });
    expect(ok).toMatchObject({ matchMode: "any", enabled: true, decisionOverride: "escalate" });
    expect(keywordSituation.safeParse({ id: "x", name: "X", keywords: [] }).success).toBe(false);
    expect(keywordSituation.safeParse({ id: "x", name: "X", keywords: ["a"] }).success).toBe(false);
    expect(keywordSituation.safeParse({ id: "x", name: "X", keywords: ["défaut"], decisionOverride: "accept" }).success).toBe(false);
    expect(keywordSituation.safeParse({ id: "x", name: "X", keywords: ["défaut"], response: { guidance: "x".repeat(301) } }).success).toBe(false);
    expect(keywordSituation.safeParse({ id: "x", name: "X", keywords: ["défaut"], matchMode: "regex" }).success).toBe(false);
  });

  it("limites de Vinted : valeurs prudentes « à mesurer », source fermée, mesure sans source ni date", () => {
    expect(VINTED_LIMITS_DEFAULTS).toEqual({ maxCounterOffersPerConversation: 3, offerDurationHours: 48, minDelayBetweenMessagesSeconds: 60, measuredAt: null, source: "default_conservative" });
    expect(automationSettings.parse({}).vintedLimits).toEqual(VINTED_LIMITS_DEFAULTS);
    expect(vintedLimits.safeParse({ source: "verified" }).success).toBe(false);
    expect(vintedLimits.safeParse({ maxCounterOffersPerConversation: 0 }).success).toBe(false);
    expect(vintedLimitsMeasurementInput.safeParse({ maxCounterOffersPerConversation: 4, offerDurationHours: 24 }).success).toBe(false);
    const input = vintedLimitsMeasurementInput.parse({ maxCounterOffersPerConversation: 4, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 45 });
    expect("source" in input).toBe(false);
    expect("measuredAt" in input).toBe(false);
  });

  it("nouvelles règles : relance après 24 h (Cloud, action légère) et situation par mots-clés", () => {
    expect(RULE_KINDS).toContain("follow_up_24h");
    expect(RULE_KINDS).toContain("keyword_situation");
    for (const kind of RULE_KINDS) expect(RULE_KIND_LABELS[kind]).toBeTruthy();
    expect(CLOUD_RULE_ACTIONS.follow_up_24h).toBe("follow_up");
    expect(CLOUD_ACTION_LEVEL_BY_KIND[CLOUD_RULE_ACTIONS.follow_up_24h!]).toBe("light");
    expect(CLOUD_RULE_ACTIONS.keyword_situation).toBeUndefined();
    expect(FOLLOW_UP_24H_DEFAULT_DELAY_HOURS).toBe(24);
    expect(FOLLOW_UP_24H_MAX_AGE_HOURS).toBe(168);
    expect(ruleConfig.parse({ situationId: "defaut", delayHours: 24 })).toEqual({ situationId: "defaut", delayHours: 24 });
    const rule = automationRuleCreate.parse({ name: "Relance 24 h", kind: "follow_up_24h", config: { delayHours: 24 } });
    expect(rule).toMatchObject({ kind: "follow_up_24h", enabled: false, requiresApproval: true, runsIn: "server" });
  });
});
