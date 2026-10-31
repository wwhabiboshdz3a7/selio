import { describe, expect, it } from "vitest";
import { loadRadarBrowserConfig, RADAR_BROWSER_DEFAULTS } from "./config";
import {
  BlockRateWindow,
  NOT_MEASURED_LABEL,
  delayMs,
  detectionDelayMs,
  factorAfterBlock,
  intervalFor,
  normalizeFactor,
  purchaseDelayMs,
  rateFactor,
  slowdownFactor,
  summarizeDelays,
} from "./metrics";
import { MACHINE_CIRCUIT_CODES, radarStopFor } from "./policy";

describe("délais publication → détection → achat", () => {
  it("calcule le délai, tolère un petit décalage d'horloge, refuse l'incohérent", () => {
    expect(detectionDelayMs("2026-10-29T09:57:00.000Z", "2026-10-29T10:00:00.000Z")).toBe(180_000);
    expect(purchaseDelayMs(new Date("2026-10-29T10:00:00Z"), new Date("2026-10-29T10:00:42Z"))).toBe(42_000);
    expect(delayMs(0, 1_500)).toBe(1_500);
    // Publication estimée à la minute, un peu « après » la détection : 0, pas un délai négatif.
    expect(detectionDelayMs("2026-10-29T10:01:00Z", "2026-10-29T10:00:00Z")).toBe(0);
    // Plus de 5 min dans le futur : date incohérente.
    expect(detectionDelayMs("2026-10-29T10:10:00Z", "2026-10-29T10:00:00Z")).toBeNull();
    expect(detectionDelayMs(null, "2026-10-29T10:00:00Z")).toBeNull();
    expect(detectionDelayMs("demain", "2026-10-29T10:00:00Z")).toBeNull();
  });

  it("résumé : rien n'est présenté comme mesuré sans échantillon", () => {
    expect(summarizeDelays([])).toBeNull();
    expect(summarizeDelays([null, undefined, Number.NaN, -1])).toBeNull();
    expect(NOT_MEASURED_LABEL).toBe("à mesurer");
    expect(summarizeDelays([30_000, 10_000, null, 20_000, 120_000])).toEqual({ count: 4, minMs: 10_000, p50Ms: 20_000, p90Ms: 120_000, maxMs: 120_000 });
    expect(summarizeDelays([5])).toEqual({ count: 1, minMs: 5, p50Ms: 5, p90Ms: 5, maxMs: 5 });
  });
});

describe("taux de blocage (fenêtre glissante de 1 000 pages)", () => {
  it("fenêtre vide : taux inconnu (à mesurer), jamais 0 présenté comme mesuré", () => {
    const w = new BlockRateWindow();
    expect(w.capacity).toBe(1000);
    expect(w.size).toBe(0);
    expect(w.rate()).toBe(0);
    expect(w.blockedPerThousand()).toBeNull();
  });

  it("compte les blocages pour 1 000 pages et oublie les plus anciennes", () => {
    const w = new BlockRateWindow();
    w.push("blocked");
    for (let i = 0; i < 999; i++) w.push("ok");
    expect(w.isFull).toBe(true);
    expect(w.blocked).toBe(1);
    expect(w.blockedPerThousand()).toBe(1);
    expect(w.rate()).toBe(0.001);
    // La page bloquée sort de la fenêtre.
    w.push("ok");
    expect(w.blocked).toBe(0);
    expect(w.blockedPerThousand()).toBe(0);
    w.push("blocked").push("blocked");
    expect(w.blockedPerThousand()).toBe(2);
    expect(w.size).toBe(1000);
  });

  it("fenêtre incomplète : taux rapporté aux pages présentes (prudent)", () => {
    const w = BlockRateWindow.from(["ok", "ok", "ok", "blocked"]);
    expect(w.blockedPerThousand()).toBe(250);
    expect(w.toArray()).toEqual(["ok", "ok", "ok", "blocked"]);
  });

  it("petite capacité : ordre conservé dans toArray après rotation", () => {
    const w = BlockRateWindow.from(["blocked", "ok", "ok", "blocked", "ok"], 3);
    expect(w.toArray()).toEqual(["ok", "blocked", "ok"]);
    expect(w.blocked).toBe(1);
  });
});

describe("ralentissement automatique", () => {
  it("double au-delà de 1 pour 1 000 : 1, 2, 4, 8, plafond 8", () => {
    expect(rateFactor(null)).toBe(1);
    expect(rateFactor(0)).toBe(1);
    expect(rateFactor(1)).toBe(1);
    expect(rateFactor(1.01)).toBe(2);
    expect(rateFactor(2)).toBe(2);
    expect(rateFactor(3)).toBe(4);
    expect(rateFactor(4)).toBe(4);
    expect(rateFactor(5)).toBe(8);
    expect(rateFactor(500)).toBe(8);
    expect(slowdownFactor({ blockedPerThousand: 0.5, hoursSinceLastBlock: 1 })).toBe(1);
    expect(slowdownFactor({ blockedPerThousand: 1.5, hoursSinceLastBlock: 0 })).toBe(2);
    expect(slowdownFactor({ blockedPerThousand: 3, hoursSinceLastBlock: 0 })).toBe(4);
    expect(slowdownFactor({ blockedPerThousand: 250, hoursSinceLastBlock: 0 })).toBe(8);
  });

  it("retour d'un cran par tranche de 24 h sans blocage, même si l'ancien blocage reste dans la fenêtre", () => {
    const at = (h: number) => slowdownFactor({ blockedPerThousand: 250, hoursSinceLastBlock: h });
    expect([at(0), at(23.9), at(24), at(47), at(48), at(72), at(500)]).toEqual([8, 8, 4, 4, 2, 1, 1]);
    // Facteur enregistré au dernier blocage (doublements successifs) : même retour progressif.
    expect(slowdownFactor({ blockedPerThousand: 0.2, hoursSinceLastBlock: 30, storedFactor: 8 })).toBe(4);
    expect(slowdownFactor({ blockedPerThousand: 0.2, hoursSinceLastBlock: 30, storedFactor: 64 })).toBe(4);
    expect(slowdownFactor({ blockedPerThousand: null, hoursSinceLastBlock: null })).toBe(1);
  });

  it("au blocage : l'intervalle double (60 → 120 → 240 s…) tant que le taux dépasse le seuil", () => {
    expect(factorAfterBlock({ currentFactor: 1, blockedPerThousand: 1 })).toBe(1);
    expect(factorAfterBlock({ currentFactor: 1, blockedPerThousand: 1.2 })).toBe(2);
    expect(factorAfterBlock({ currentFactor: 2, blockedPerThousand: 1.2 })).toBe(4);
    expect(factorAfterBlock({ currentFactor: 4, blockedPerThousand: 1.2 })).toBe(8);
    expect(factorAfterBlock({ currentFactor: 8, blockedPerThousand: 1.2 })).toBe(8);
    expect(factorAfterBlock({ currentFactor: 1, blockedPerThousand: 100 })).toBe(8);
  });

  it("intervalle : 60 s × facteur (Radar), 30 s × facteur (recherche prioritaire de Radar Auto)", () => {
    expect(intervalFor({ mode: "radar", factor: 1 })).toBe(60_000);
    expect(intervalFor({ mode: "radar", factor: 2 })).toBe(120_000);
    expect(intervalFor({ mode: "radar", factor: 4 })).toBe(240_000);
    expect(intervalFor({ mode: "auto_priority", factor: 1 })).toBe(30_000);
    expect(intervalFor({ mode: "auto_priority", factor: 8 })).toBe(240_000);
    // Facteur absurde : rythme normal, jamais plus rapide.
    expect(intervalFor({ mode: "radar", factor: 0 })).toBe(60_000);
    expect(intervalFor({ mode: "radar", factor: Number.NaN })).toBe(60_000);
    expect(normalizeFactor(3)).toBe(2);
    expect(normalizeFactor(1000)).toBe(64);
  });
});

describe("conduite imposée par un signal de Vinted", () => {
  it("CAPTCHA, avertissement, blocage, trop de requêtes : pause, alerte, mesure ; coupe-circuit pour les deux derniers", () => {
    for (const code of ["captcha", "warning"] as const) {
      expect(radarStopFor(code)).toMatchObject({ code, pauseAccount: true, alertClient: true, recordBlock: true, tripMachineCircuit: false });
    }
    for (const code of ["rate_limited", "blocked"] as const) {
      expect(radarStopFor(code)).toMatchObject({ code, pauseAccount: true, tripMachineCircuit: true, message: expect.stringMatching(/pause/) });
    }
    expect([...MACHINE_CIRCUIT_CODES].sort()).toEqual(["blocked", "rate_limited"]);
    for (const code of ["timeout", "not_logged_in", "error", "unavailable", "selector_missing"]) expect(radarStopFor(code)).toBeNull();
  });
});

describe("réglages navigateur de Radar", () => {
  it("Radar Auto fermé par défaut ; seule une valeur explicite l'ouvre ; bornes", () => {
    expect(loadRadarBrowserConfig({})).toEqual({ ...RADAR_BROWSER_DEFAULTS });
    expect(RADAR_BROWSER_DEFAULTS.threeDsTimeoutMs).toBe(10 * 60_000);
    for (const v of ["false", "0", "", "non", "TRUEISH"]) expect(loadRadarBrowserConfig({ RADAR_AUTO_ENABLED: v }).autoEnabled).toBe(false);
    for (const v of ["true", "1", "oui", "ON"]) expect(loadRadarBrowserConfig({ RADAR_AUTO_ENABLED: v }).autoEnabled).toBe(true);
    expect(loadRadarBrowserConfig({ CLOUD_3DS_TIMEOUT_MS: "5" }).threeDsTimeoutMs).toBe(60_000);
    expect(loadRadarBrowserConfig({ CLOUD_3DS_TIMEOUT_MS: "99999999" }).threeDsTimeoutMs).toBe(30 * 60_000);
    expect(loadRadarBrowserConfig({ CLOUD_3DS_TIMEOUT_MS: "x" }).threeDsTimeoutMs).toBe(600_000);
  });
});
