import { describe, expect, it } from "vitest";
import type { Db } from "@selio/db";
import {
  SUPERVISION_FAILURES_BEFORE_ALERT, SUPERVISION_REMINDER_MINUTES, checkTargets, healthReport, initialState, nextState, safeUrl, supervisionPayload,
  type CheckResult, type SupervisionFetch, type TargetState,
} from "./supervision";

/**
 * Supervision, partie sans base : vérification HTTP (simulée), machine à états, texte des alertes, santé
 * de l'API. Le passage complet sur PostgreSQL (alerte unique, rappel, rétablissement, Web Push et email)
 * est testé dans apps/worker/src/supervision.test.ts, sur sa propre base.
 */

const T0 = new Date("2026-11-08T10:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000).toISOString();
const fail = (min: number, error = "HTTP 503"): CheckResult => ({ name: "api", url: "https://api.selio.test/api/health", ok: false, statusCode: 503, latencyMs: 12, error, checkedAt: at(min) });
const ok = (min: number): CheckResult => ({ name: "api", url: "https://api.selio.test/api/health", ok: true, statusCode: 200, latencyMs: 8, error: null, checkedAt: at(min) });

function run(results: CheckResult[], start: TargetState = initialState("api", "https://api.selio.test/api/health")) {
  let state = start;
  const events: (string | null)[] = [];
  for (const r of results) {
    const n = nextState(state, r);
    state = n.state;
    events.push(n.event);
  }
  return { state, events };
}

describe("machine à états de la supervision", () => {
  it("valeurs par défaut : 3 échecs avant alerte, rappel toutes les 60 min", () => {
    expect(SUPERVISION_FAILURES_BEFORE_ALERT).toBe(3);
    expect(SUPERVISION_REMINDER_MINUTES).toBe(60);
  });

  it("alerte une seule fois au troisième échec consécutif, puis rien jusqu'au rappel", () => {
    const { state, events } = run([fail(0), fail(1), fail(2), fail(3), fail(4), fail(30)]);
    expect(events).toEqual([null, null, "alert", null, null, null]);
    expect(state).toMatchObject({ status: "down", consecutiveFailures: 6, failingSince: at(0), downSince: at(2), lastAlertAt: at(2), lastError: "HTTP 503" });
  });

  it("rappel toutes les 60 min tant que la panne dure", () => {
    const seq = [fail(0), fail(1), fail(2)];
    for (let m = 3; m <= 125; m++) seq.push(fail(m));
    const { events } = run(seq);
    const idx = events.map((e, i) => (e ? `${e}@${i}` : null)).filter(Boolean);
    expect(idx).toEqual(["alert@2", "reminder@62", "reminder@122"]);
  });

  it("rétablissement notifié après une panne signalée, et la série repart de zéro", () => {
    const { state, events } = run([fail(0), fail(1), fail(2), ok(3), fail(4), fail(5), ok(6)]);
    expect(events).toEqual([null, null, "alert", "recovered", null, null, null]);
    expect(state).toMatchObject({ status: "up", consecutiveFailures: 0, failingSince: null, downSince: null, lastAlertAt: null, lastOkAt: at(6) });
  });

  it("échecs isolés (moins de 3) : aucune alerte ni rétablissement", () => {
    const { events } = run([ok(0), fail(1), fail(2), ok(3), fail(4), ok(5)]);
    expect(events.every((e) => e === null)).toBe(true);
  });

  it("seuil et rappel réglables", () => {
    let s = initialState("ia", "x");
    const first = nextState(s, fail(0), { failuresBeforeAlert: 1, reminderMinutes: 5 });
    expect(first.event).toBe("alert");
    s = first.state;
    expect(nextState(s, fail(4), { failuresBeforeAlert: 1, reminderMinutes: 5 }).event).toBeNull();
    expect(nextState(s, fail(5), { failuresBeforeAlert: 1, reminderMinutes: 5 }).event).toBe("reminder");
  });
});

describe("vérification HTTP (simulée)", () => {
  const services = (fetch: SupervisionFetch, timeoutMs = 200) => ({ now: () => T0, supervision: { fetch, timeoutMs } });

  it("2xx = succès ; autre statut, « ok: false », erreur réseau et délai = échec", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetch: SupervisionFetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      if (url.includes("/ok")) return { status: 200, json: async () => ({ ok: true }) };
      if (url.includes("/text")) return { status: 204 };
      if (url.includes("/bad")) return { status: 503, json: async () => ({ ok: false }) };
      if (url.includes("/declared")) return { status: 200, json: async () => ({ ok: false, status: "down" }) };
      if (url.includes("/slow")) return new Promise(() => {});
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    const res = await checkTargets(services(fetch), [
      { name: "ok", url: "https://a.test/ok" },
      { name: "texte", url: "https://a.test/text" },
      { name: "bad", url: "https://a.test/bad" },
      { name: "declared", url: "https://a.test/declared" },
      { name: "slow", url: "https://a.test/slow" },
      { name: "down", url: "https://a.test/down" },
      { name: "ia", url: "https://a.test/ok/ai?x=1", headers: { "x-health-token": "jeton-secret-de-test" } },
    ]);
    const by = Object.fromEntries(res.map((r) => [r.name, r]));
    expect(by.ok).toMatchObject({ ok: true, statusCode: 200, error: null, checkedAt: T0.toISOString() });
    expect(by.texte).toMatchObject({ ok: true, statusCode: 204 });
    expect(by.bad).toMatchObject({ ok: false, statusCode: 503, error: "HTTP 503" });
    expect(by.declared).toMatchObject({ ok: false, statusCode: 200, error: "réponse « ok: false »" });
    expect(by.slow).toMatchObject({ ok: false, statusCode: null, latencyMs: null });
    expect(by.slow!.error).toContain("délai dépassé");
    expect(by.down).toMatchObject({ ok: false, statusCode: null, error: "fetch failed (ECONNREFUSED)" });
    // Le jeton part dans l'en-tête, jamais dans le résultat ; l'adresse enregistrée est sans requête.
    expect(seen.find((s) => s.url.includes("/ai"))!.headers["x-health-token"]).toBe("jeton-secret-de-test");
    expect(JSON.stringify(res)).not.toContain("jeton-secret-de-test");
    expect(by.ia!.url).toBe("https://a.test/ok/ai");
  });

  it("adresse enregistrée sans identifiants, requête ni fragment", () => {
    expect(safeUrl("https://user:pw@api.selio.test:8443/api/health?token=abc#x")).toBe("https://api.selio.test:8443/api/health");
    expect(safeUrl("pas une adresse")).toBe("adresse invalide");
  });
});

describe("texte des alertes", () => {
  it("titre, durée et dernière erreur ; lien relatif vers l'administration ; aucun secret", () => {
    const down = run([fail(0), fail(1), fail(2)]).state;
    const alert = supervisionPayload("alert", down, at(2));
    expect(alert.title).toBe("Selio : « api » ne répond plus");
    expect(alert.body).toContain("3 vérifications en échec");
    expect(alert.body).toContain("HTTP 503");
    expect(alert.url).toBe("/admin");
    const later = run([fail(3)], down).state;
    expect(supervisionPayload("reminder", later, at(62)).body).toContain("En panne depuis 60 min");
    const up = run([ok(70)], later).state;
    expect(supervisionPayload("recovered", up, at(70)).title).toBe("Selio : « api » rétabli");
  });
});

describe("santé publique de l'API", () => {
  const db = (pingOk: boolean) => ({ ping: async () => { if (!pingOk) throw new Error("connexion refusée à 10.0.0.5:5432"); return 3; } }) as unknown as Db;

  it("base, Redis, file, version, durée de fonctionnement ; ok faux si un composant est en panne", async () => {
    const started = new Date(T0.getTime() - 90_000);
    const good = await healthReport({ db: db(true), now: () => T0 }, { version: "1.2.3", startedAt: started, redis: async () => 2, queues: async () => [] });
    expect(good).toEqual({ ok: true, status: "ok", version: "1.2.3", uptimeSeconds: 90, checkedAt: T0.toISOString(), checks: { database: "ok", redis: "ok", queue: "ok" }, latencyMs: { database: 3, redis: 2 } });
    const inline = await healthReport({ db: db(true), now: () => T0 }, { version: "1", startedAt: started, redis: async () => null });
    expect(inline.checks).toEqual({ database: "ok", redis: "inline", queue: "inline" });
    expect(inline.ok).toBe(true);
    const dbDown = await healthReport({ db: db(false), now: () => T0 }, { version: "1", startedAt: started });
    expect(dbDown).toMatchObject({ ok: false, status: "down", checks: { database: "down" } });
    // Jamais le message d'erreur (adresse interne) dans la réponse publique.
    expect(JSON.stringify(dbDown)).not.toContain("10.0.0.5");
    const redisDown = await healthReport({ db: db(true), now: () => T0 }, { version: "1", startedAt: started, redis: async () => { throw new Error("ECONNREFUSED"); } });
    expect(redisDown).toMatchObject({ ok: false, checks: { redis: "down", queue: "down" } });
    const queueDown = await healthReport({ db: db(true), now: () => T0 }, { version: "1", startedAt: started, redis: async () => 1, queues: async () => { throw new Error("x"); } });
    expect(queueDown).toMatchObject({ ok: false, checks: { redis: "ok", queue: "down" } });
    const slow = await healthReport({ db: { ping: () => new Promise<number>(() => {}) } as unknown as Db, now: () => T0 }, { version: "1", startedAt: started, timeoutMs: 50 });
    expect(slow.checks.database).toBe("down");
  });
});
