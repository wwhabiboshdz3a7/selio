import { describe, expect, it } from "vitest";
import { aiOutcome, effectiveAiQuota, summarizeAiRequests, type AiRequestLike } from "./ai-health";

const now = new Date("2026-10-17T12:00:00Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const req = (p: Partial<AiRequestLike>): AiRequestLike => ({ kind: "reply_suggestion", status: "succeeded", latencyMs: 500, validated: true, rejectionReason: null, createdAt: at(1), ...p });

describe("état de l'IA", () => {
  it("classe chaque requête (repli = réussie avec motif de rejet)", () => {
    expect(aiOutcome({ status: "succeeded", rejectionReason: null })).toBe("succeeded");
    expect(aiOutcome({ status: "succeeded", rejectionReason: "IA indisponible (timeout) : gabarit déterministe utilisé" })).toBe("fallback");
    expect(aiOutcome({ status: "timeout", rejectionReason: null })).toBe("failed");
    expect(aiOutcome({ status: "running", rejectionReason: null })).toBe("in_flight");
  });

  it("calcule les taux sur les requêtes terminées de la période", () => {
    const s = summarizeAiRequests([
      req({}), req({}), req({ latencyMs: 1500 }),
      req({ rejectionReason: "IA indisponible", latencyMs: 0 }),
      req({ status: "rejected", validated: false, latencyMs: 700 }),
      req({ status: "timeout", validated: false, latencyMs: 45_000 }),
      req({ status: "running", validated: false, latencyMs: 0 }),
      req({ status: "cancelled", validated: false }),
      req({ createdAt: at(40) }), // hors période
    ], { now, windowDays: 30 });
    expect(s.finished).toBe(6);
    expect(s.succeeded).toBe(3);
    expect(s.fallbacks).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.timeouts).toBe(1);
    expect(s.inFlight).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.availabilityRate).toBeCloseTo(3 / 6);
    expect(s.produced).toBe(5);
    expect(s.validatedRate).toBeCloseTo(4 / 5);
    expect(s.fallbackRate).toBeCloseTo(2 / 6);
    expect(s.failureRate).toBeCloseTo(1 / 6);
    // Latence des sorties produites (le délai dépassé et le repli sans durée n'y entrent pas).
    expect(s.avgLatencyMs).toBe(Math.round((500 + 500 + 1500 + 700) / 4));
    expect(s.byKind[0]).toEqual({ kind: "reply_suggestion", total: 7, succeeded: 3 });
  });

  it("renvoie des taux nuls (null) sans requête, jamais un faux 100 %", () => {
    const s = summarizeAiRequests([], { now, windowDays: 30 });
    expect(s.availabilityRate).toBeNull();
    expect(s.validatedRate).toBeNull();
    expect(s.avgLatencyMs).toBeNull();
  });

  it("quota effectif : le plus petit du plan et de l'organisation", () => {
    expect(effectiveAiQuota(500, 200)).toBe(200);
    expect(effectiveAiQuota(500, 0)).toBe(500);
    expect(effectiveAiQuota(50, 500)).toBe(50);
  });
});
