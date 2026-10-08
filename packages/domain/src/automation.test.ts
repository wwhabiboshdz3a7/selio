import { describe, expect, it } from "vitest";
import { automationRule } from "@selio/contracts";
import { gateRule, jobDedupeKey, renderTemplate, retryDelayMs } from "./automation";

const rule = automationRule.parse({
  id: "r1", orgId: "o", name: "Relance", kind: "follow_up_no_reply", enabled: true,
  schedule: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, timezone: "Europe/Paris" },
  limits: { maxPerDay: 2, maxPerCustomerPerDay: 1, minMinutesBetweenActions: 10 },
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
});
const monday10h = new Date("2026-10-05T08:00:00Z"); // 10 h Paris (UTC+2)

describe("automatisations", () => {
  it("autorise dans la fenêtre et sous les limites", () => {
    expect(gateRule({ rule, globalPaused: false, now: monday10h, actionsToday: 0 })).toEqual({ allowed: true });
  });
  it("bloque sur pause globale, règle désactivée, horaire, limites, délai", () => {
    expect(gateRule({ rule, globalPaused: true, now: monday10h, actionsToday: 0 })).toMatchObject({ reason: "global_pause" });
    expect(gateRule({ rule: { ...rule, enabled: false }, globalPaused: false, now: monday10h, actionsToday: 0 })).toMatchObject({ reason: "disabled" });
    expect(gateRule({ rule, globalPaused: false, now: new Date("2026-10-05T20:00:00Z"), actionsToday: 0 })).toMatchObject({ reason: "outside_schedule" });
    expect(gateRule({ rule, globalPaused: false, now: monday10h, actionsToday: 2 })).toMatchObject({ reason: "daily_limit" });
    expect(gateRule({ rule, globalPaused: false, now: monday10h, actionsToday: 0, actionsTodayForCustomer: 1 })).toMatchObject({ reason: "customer_limit" });
    expect(gateRule({ rule, globalPaused: false, now: monday10h, actionsToday: 0, lastActionAt: new Date(monday10h.getTime() - 60_000) })).toMatchObject({ reason: "too_soon" });
  });
  it("génère une clé d'idempotence par jour local", () => {
    expect(jobDedupeKey(rule, "conv1", monday10h)).toBe("follow_up_no_reply:r1:conv1:2026-10-05");
    expect(jobDedupeKey(rule, "conv1", new Date("2026-10-05T22:30:00Z"))).toBe("follow_up_no_reply:r1:conv1:2026-10-06");
  });
  it("retry exponentiel borné", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(1_800_000);
  });
  it("rend un gabarit en texte brut", () => {
    expect(renderTemplate("Bonjour {{ prenom }}, {{ article }} est dispo", { prenom: "Léa", article: "la veste" })).toBe("Bonjour Léa, la veste est dispo");
    expect(renderTemplate("{{inconnu}}", {})).toBe("");
  });
});
