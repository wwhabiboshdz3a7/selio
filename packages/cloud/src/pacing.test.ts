import { describe, expect, it } from "vitest";
import { HUMAN_DELAY_MAX_MS, HUMAN_DELAY_MIN_MS, START_JITTER_MAX_MS, canAct, humanDelayMs, isActiveHour, localParts, nextActiveAt, startJitterMs } from "./pacing";

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 29 octobre 2026 : Paris est en UTC+1 (heure d'hiver depuis le 25 octobre).
const at = (iso: string) => new Date(iso);

describe("humanDelayMs", () => {
  it("reste entre 45 s et 180 s, bornes comprises", () => {
    expect(humanDelayMs(() => 0)).toBe(HUMAN_DELAY_MIN_MS);
    expect(humanDelayMs(() => 0.999_999_999_9)).toBeLessThanOrEqual(HUMAN_DELAY_MAX_MS);
    expect(humanDelayMs(() => 0.5)).toBe(112_500);
    const rng = seeded(42);
    for (let i = 0; i < 2_000; i++) {
      const d = humanDelayMs(rng);
      expect(d).toBeGreaterThanOrEqual(HUMAN_DELAY_MIN_MS);
      expect(d).toBeLessThanOrEqual(HUMAN_DELAY_MAX_MS);
    }
  });

  it("résiste à un générateur défaillant", () => {
    expect(humanDelayMs(() => Number.NaN)).toBe(112_500);
    expect(humanDelayMs(() => 7)).toBeLessThanOrEqual(HUMAN_DELAY_MAX_MS);
  });
});

describe("isActiveHour", () => {
  it("8 h – 23 h heure de Paris par défaut (UTC+1 en hiver, UTC+2 en été)", () => {
    expect(isActiveHour(at("2026-10-29T06:59:00Z"))).toBe(false); // 7 h 59 à Paris
    expect(isActiveHour(at("2026-10-29T07:00:00Z"))).toBe(true); // 8 h
    expect(isActiveHour(at("2026-10-29T21:59:00Z"))).toBe(true); // 22 h 59
    expect(isActiveHour(at("2026-10-29T22:00:00Z"))).toBe(false); // 23 h
    expect(isActiveHour(at("2026-07-01T06:30:00Z"))).toBe(true); // 8 h 30 (UTC+2)
  });

  it("accepte un autre fuseau, une plage de nuit, et « jamais »", () => {
    expect(isActiveHour(at("2026-10-29T07:30:00Z"), "UTC", 8, 23)).toBe(false);
    expect(isActiveHour(at("2026-10-29T23:30:00Z"), "Europe/Paris", 22, 6)).toBe(true); // 0 h 30
    expect(isActiveHour(at("2026-10-29T12:00:00Z"), "Europe/Paris", 22, 6)).toBe(false);
    expect(isActiveHour(at("2026-10-29T12:00:00Z"), "Europe/Paris", 9, 9)).toBe(false);
  });

  it("localParts donne le jour et l'heure locaux", () => {
    expect(localParts(at("2026-10-29T23:30:00Z"))).toEqual({ day: "2026-10-30", hour: 0, minute: 30 });
  });
});

describe("nextActiveAt", () => {
  it("rend l'instant lui-même s'il est actif, sinon 8 h locale suivante", () => {
    const noon = at("2026-10-29T11:00:00Z");
    expect(nextActiveAt(noon)).toEqual(noon);
    expect(nextActiveAt(at("2026-10-29T22:30:00Z"))?.toISOString()).toBe("2026-10-30T07:00:00.000Z");
  });

  it("nextDay : premier instant actif d'un autre jour local", () => {
    expect(nextActiveAt(at("2026-10-29T11:00:00Z"), { nextDay: true })?.toISOString()).toBe("2026-10-30T07:00:00.000Z");
  });
});

describe("canAct", () => {
  const base = { actionsLastHour: 0, actionsToday: 0, dailyCap: 50, lastActionAt: null, now: at("2026-10-29T11:00:00Z") };

  it("autorise une action dans les clous", () => {
    expect(canAct(base)).toEqual({ ok: true, reason: null, nextAt: null });
  });

  it("plafond du jour : reprise le lendemain à 8 h", () => {
    const r = canAct({ ...base, actionsToday: 50 });
    expect(r).toMatchObject({ ok: false, reason: "daily_limit" });
    expect(r.nextAt?.toISOString()).toBe("2026-10-30T07:00:00.000Z");
  });

  it("plafond 0 (offre sans Cloud) : aucune reprise prévue", () => {
    expect(canAct({ ...base, dailyCap: 0 })).toEqual({ ok: false, reason: "daily_limit", nextAt: null });
  });

  it("plafond horaire (12 par défaut) : place libre une heure après la plus ancienne", () => {
    const r = canAct({ ...base, actionsLastHour: 12, oldestActionLastHourAt: at("2026-10-29T10:20:00Z") });
    expect(r).toMatchObject({ ok: false, reason: "hourly_limit" });
    expect(r.nextAt?.toISOString()).toBe("2026-10-29T11:20:00.000Z");
    expect(canAct({ ...base, actionsLastHour: 11 }).ok).toBe(true);
    expect(canAct({ ...base, actionsLastHour: 3, hourlyCap: 3 }).reason).toBe("hourly_limit");
  });

  it("hors des heures actives : reprise à 8 h", () => {
    const r = canAct({ ...base, now: at("2026-10-29T05:00:00Z") });
    expect(r).toMatchObject({ ok: false, reason: "outside_active_hours" });
    expect(r.nextAt?.toISOString()).toBe("2026-10-29T07:00:00.000Z");
  });

  it("trop tôt après la dernière action (45 s par défaut)", () => {
    const r = canAct({ ...base, lastActionAt: at("2026-10-29T10:59:30Z") });
    expect(r).toMatchObject({ ok: false, reason: "too_soon" });
    expect(r.nextAt?.toISOString()).toBe("2026-10-29T11:00:15.000Z");
    expect(canAct({ ...base, lastActionAt: at("2026-10-29T10:59:00Z") }).ok).toBe(true);
  });

  it("le prochain instant respecte toutes les contraintes à la fois", () => {
    // 22 h 59 à Paris, trop tôt : la reprise ne peut pas tomber à 23 h → lendemain 8 h.
    const r = canAct({ ...base, now: at("2026-10-29T21:59:50Z"), lastActionAt: at("2026-10-29T21:59:40Z") });
    expect(r.reason).toBe("too_soon");
    expect(r.nextAt?.toISOString()).toBe("2026-10-30T07:00:00.000Z");
  });
});

describe("startJitterMs", () => {
  it("stable par compte, borné, et réparti", () => {
    expect(startJitterMs("compte-1")).toBe(startJitterMs("compte-1"));
    const values = Array.from({ length: 200 }, (_, i) => startJitterMs(`compte-${i}`));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(START_JITTER_MAX_MS);
    }
    const minutes = new Set(values.map((v) => Math.floor(v / 60_000)));
    expect(minutes.size).toBe(4);
    expect(startJitterMs("x", 0)).toBe(0);
  });
});
