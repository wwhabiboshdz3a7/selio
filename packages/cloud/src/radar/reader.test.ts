import { readFileSync } from "node:fs";
import { buildSearchUrl } from "@selio/connectors/vinted-adapter";
import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runner/fake";
import type { CloudLogger, StorageState } from "../types";
import { BlockRateWindow, detectionDelayMs, summarizeDelays } from "./metrics";
import { RadarReader } from "./reader";

/** Fixtures de l'adaptateur catalogue (pages synthétiques, jamais vinted.fr). */
const fixture = (name: string) => readFileSync(new URL(`../../../connectors/src/vinted/fixtures/${name}`, import.meta.url), "utf8");
const catalogHtml = fixture("catalog-page.v1.html");

const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [],
};
const now = new Date("2026-10-29T10:00:00Z");
const url = buildSearchUrl({ keywords: ["veste"], maxPriceCents: 10_000 });

function reader(runner: FakeRunner, logger?: CloudLogger) {
  return new RadarReader({ fetcher: runner, now: () => now, pageBudgetMs: 20_000, ...(logger ? { logger } : {}) });
}

describe("RadarReader (FakeRunner, fixtures)", () => {
  it("lit les 12 annonces de la page catalogue, horodatées, sans rien faire sur la page", async () => {
    const runner = new FakeRunner({ pageHtml: catalogHtml });
    const r = await reader(runner).readSearch({ session, url });
    expect(r).toMatchObject({ outcome: "ok", pageOk: true, blocked: null, stop: null, measure: "ok", launched: true, finalUrl: url, status: 200, seenCount: 12, observedAt: now.toISOString(), adapterVersion: "vinted-catalog-v1" });
    expect(r.items).toHaveLength(12);
    expect(r.items[0]).toMatchObject({ externalRef: "5012345601", priceCents: 1800, sellerHandle: "vendeuse_demo_01", photoCount: 6, publishedAt: now.toISOString() });
    expect(r.session?.cookies.map((c) => c.name)).toEqual(["access_token_web"]);
    // Lecture seule : un appel, avec la session du compte Achat et le budget de page.
    expect(runner.fetchCalls).toEqual([{ url, hadSession: true, timeoutMs: 20_000 }]);
    expect(runner.calls).toEqual([]);
    expect(runner.browsings).toEqual([]);
    // Délais publication → détection : lus ou estimés, à la précision du texte relatif.
    const delays = r.items.map((i) => detectionDelayMs(i.publishedAt, r.observedAt));
    expect(delays.slice(0, 3)).toEqual([0, 60_000, 180_000]);
    expect(summarizeDelays(delays)).toMatchObject({ count: 12, minMs: 0, maxMs: 86_400_000 });
  });

  it("filtre localement les critères qui ne passent pas dans l'adresse", async () => {
    const r = await reader(new FakeRunner({ pageHtml: catalogHtml })).readSearch({ session, url, criteria: { brands: ["Nike", "Levi's"], maxPriceCents: 2500 } });
    expect(r.outcome).toBe("ok");
    expect(r.seenCount).toBe(12);
    expect(r.items.map((i) => i.brand)).toEqual(["Levi's", "Nike"]);
    expect(r.message).toMatch(/12 annonce\(s\) lue\(s\), 2 retenue\(s\)/);
  });

  it("page de blocage (fixture) : arrêt immédiat, pause du compte, alerte, mesure « bloquée »", async () => {
    const warns: string[] = [];
    const logger: CloudLogger = { info: () => {}, warn: (m) => warns.push(m) };
    const runner = new FakeRunner({ fetchScenarios: [{ html: fixture("catalog-blocked.v1.html") }] });
    const r = await reader(runner, logger).readSearch({ session, url });
    expect(r).toMatchObject({ outcome: "blocked", items: [], pageOk: false, measure: "blocked", launched: true, blocked: { code: "captcha", pattern: expect.stringMatching(/^captcha\./) } });
    expect(r.stop).toMatchObject({ code: "captcha", pauseAccount: true, alertClient: true, recordBlock: true, tripMachineCircuit: false });
    expect(warns).toEqual(["radar.read.stopped"]);
  });

  it("en-tête de vérification anti-robot (cf-mitigated: challenge) : CAPTCHA, quel que soit le statut ou le contenu", async () => {
    for (const status of [200, 403, 503]) {
      const runner = new FakeRunner({ fetchScenarios: [{ html: catalogHtml, status, challenge: true }] });
      const r = await reader(runner).readSearch({ session, url });
      expect(r, String(status)).toMatchObject({ outcome: "blocked", items: [], measure: "blocked", launched: true, blocked: { code: "captcha", pattern: "captcha.header.cf-mitigated" } });
      expect(r.stop).toMatchObject({ code: "captcha", pauseAccount: true });
    }
  });

  it("statut 5xx sans motif reconnu : erreur lancée (le cœur la compte comme lecture anormale), aucune annonce", async () => {
    const r = await reader(new FakeRunner({ fetchScenarios: [{ html: "<html><body><p>Service indisponible</p></body></html>", status: 503 }] })).readSearch({ session, url });
    expect(r).toMatchObject({ outcome: "error", launched: true, items: [], status: 503 });
  });

  it("scénarios de l'exécuteur : blocked, trop de requêtes (coupe-circuit), délai, indisponible", async () => {
    const runner = new FakeRunner({ pageHtml: catalogHtml, fetchScenarios: ["blocked", "rate_limited", "timeout", "unavailable", "error"] });
    const rd = reader(runner);
    const blocked = await rd.readSearch({ session, url });
    expect(blocked).toMatchObject({ outcome: "blocked", measure: "blocked", stop: { code: "captcha" } });
    const tooMany = await rd.readSearch({ session, url });
    expect(tooMany).toMatchObject({ outcome: "blocked", status: 429, measure: "blocked", stop: { code: "rate_limited", tripMachineCircuit: true } });
    // Rien de reçu : rien ne compte dans le taux de blocage.
    expect(await rd.readSearch({ session, url })).toMatchObject({ outcome: "timeout", measure: null, launched: true, items: [] });
    expect(await rd.readSearch({ session, url })).toMatchObject({ outcome: "unavailable", measure: null, launched: false });
    expect(await rd.readSearch({ session, url })).toMatchObject({ outcome: "error", measure: null });
    // File vide : retour au scénario « ok ».
    expect((await rd.readSearch({ session, url })).items).toHaveLength(12);
  });

  it("signal rendu directement par l'exécuteur (CAPTCHA relu après une exception) : même conduite", async () => {
    const runner = new FakeRunner({ fetchScenarios: [{ ok: false, code: "captcha", message: "x", launched: true, durationMs: 12 }] });
    const r = await reader(runner).readSearch({ session, url });
    expect(r).toMatchObject({ outcome: "blocked", measure: "blocked", durationMs: 12, stop: { code: "captcha", pauseAccount: true } });
    const notLaunched = await reader(new FakeRunner({ fetchScenarios: [{ ok: false, code: "blocked", message: "x", launched: false, durationMs: 0 }] })).readSearch({ session, url });
    expect(notLaunched).toMatchObject({ outcome: "blocked", measure: null, stop: { tripMachineCircuit: true } });
  });

  it("mesures : les lectures alimentent la fenêtre glissante", async () => {
    const runner = new FakeRunner({ pageHtml: catalogHtml, fetchScenarios: ["ok", "blocked", "ok", "timeout", "ok"] });
    const rd = reader(runner);
    const w = new BlockRateWindow();
    for (let i = 0; i < 5; i++) {
      const r = await rd.readSearch({ session, url });
      if (r.measure) w.push(r.measure);
    }
    expect(w.size).toBe(4);
    expect(w.blockedPerThousand()).toBe(250);
  });

  it("sans session du compte Achat : rien n'est lancé, aucun scénario consommé", async () => {
    const runner = new FakeRunner({ pageHtml: catalogHtml, fetchScenarios: ["blocked"] });
    const r = await reader(runner).readSearch({ session: null, url });
    expect(r).toMatchObject({ outcome: "not_logged_in", launched: false, measure: null });
    const empty = await reader(runner).readSearch({ session: { cookies: [{ ...session.cookies[0]!, domain: ".google.com" }], origins: [] }, url });
    expect(empty).toMatchObject({ outcome: "not_logged_in", launched: false });
    expect((await reader(runner).readSearch({ session, url })).outcome).toBe("blocked");
  });

  it("redirection vers la connexion : session du compte Achat plus reconnue", async () => {
    const runner = new FakeRunner({ fetchScenarios: [{ html: "<html><body><h1>Connecte-toi</h1></body></html>", finalUrl: "https://www.vinted.fr/member/login?ref=catalog" }] });
    expect(await reader(runner).readSearch({ session, url })).toMatchObject({ outcome: "not_logged_in", measure: "ok", launched: true });
  });

  it("page inconnue ou statut d'erreur : rien n'est inventé", async () => {
    const changed = await reader(new FakeRunner({ fetchScenarios: [{ html: fixture("unknown-page.html") }] })).readSearch({ session, url });
    expect(changed).toMatchObject({ outcome: "page_changed", pageOk: false, items: [], measure: "ok", missing: ["catalog-grid"] });
    const down = await reader(new FakeRunner({ fetchScenarios: [{ html: "<h1>Erreur interne</h1>", status: 500 }] })).readSearch({ session, url });
    expect(down).toMatchObject({ outcome: "error", measure: null, items: [], message: expect.stringMatching(/500/) });
  });

  it("refuse toute adresse qui n'est pas une page catalogue (sans rien lancer)", async () => {
    const runner = new FakeRunner({ pageHtml: catalogHtml });
    for (const bad of ["https://www.vinted.fr/items/123-veste", "https://www.vinted.fr/inbox/1", "pas une adresse"]) {
      expect(await reader(runner).readSearch({ session, url: bad })).toMatchObject({ outcome: "error", launched: false });
    }
    expect(runner.fetchCalls).toEqual([]);
    // Domaine hors liste fermée : refusé par l'exécuteur.
    expect(await reader(runner).readSearch({ session, url: "https://www.vinted.lol/catalog?search_text=x" })).toMatchObject({ outcome: "error", launched: false });
  });
});
