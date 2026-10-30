import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeProfileDir } from "../profile";
import { FakeRunner } from "../runner/fake";
import { PlaywrightRunner } from "../runner/playwright";
import { BrowserSlots } from "../slots";
import type { StorageState } from "../types";
import { FAKE_BLOCK_PAGE_HTML } from "./fake";
import { isRadarOrigin, radarPageKind, resolveRadarUrl } from "./urls";

const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [],
};
const CATALOG = "https://www.vinted.fr/catalog?search_text=veste&order=newest_first";

describe("adresses Radar", () => {
  it("catalogue et annonces Vinted seulement (liste fermée, https), ou l'origine de test", () => {
    expect(radarPageKind("/catalog")).toBe("catalog");
    expect(radarPageKind("/catalog/2050-vetements")).toBe("catalog");
    expect(radarPageKind("/items/5012345601-veste")).toBe("item");
    expect(radarPageKind("/items/5012345601")).toBe("item");
    for (const p of ["/inbox/1", "/member/1", "/catalogue", "/items/abc", "/", "/checkout"]) expect(radarPageKind(p)).toBeNull();
    expect(resolveRadarUrl(CATALOG, ["catalog"])?.href).toBe(CATALOG);
    expect(resolveRadarUrl("https://www.vinted.be/items/1-x", ["item"])).not.toBeNull();
    expect(resolveRadarUrl(CATALOG, ["item"])).toBeNull();
    for (const bad of ["http://www.vinted.fr/catalog", "https://www.vinted.lol/catalog", "https://www.vinted.fr:8443/catalog", "https://u:p@www.vinted.fr/catalog", "https://evil.example/catalog", "javascript:alert(1)"]) {
      expect(resolveRadarUrl(bad, ["catalog", "item"]), bad).toBeNull();
    }
    expect(resolveRadarUrl("http://127.0.0.1:4000/catalog?x=1", ["catalog"], "http://127.0.0.1:4000")).not.toBeNull();
    expect(resolveRadarUrl("http://127.0.0.1:4001/catalog", ["catalog"], "http://127.0.0.1:4000")).toBeNull();
    expect(isRadarOrigin("https://www.vinted.fr/checkout")).toBe(true);
    expect(isRadarOrigin("https://acs.banque.example/3ds")).toBe(false);
  });
});

describe("FakeRunner — lecture de page (Radar)", () => {
  it("scénarios dans l'ordre, puis « ok » avec la fixture ; appels enregistrés", async () => {
    const runner = new FakeRunner({ pageHtml: (u) => `<p>${u}</p>`, fetchScenarios: ["blocked", "rate_limited", "timeout", "unavailable"] });
    expect(await runner.fetchPage({ session, url: CATALOG })).toMatchObject({ ok: true, html: FAKE_BLOCK_PAGE_HTML, status: 200 });
    expect(await runner.fetchPage({ session, url: CATALOG })).toMatchObject({ ok: true, status: 429 });
    expect(await runner.fetchPage({ session, url: CATALOG, timeoutMs: 5 })).toMatchObject({ ok: false, code: "timeout", launched: true });
    expect(await runner.fetchPage({ session, url: CATALOG })).toMatchObject({ ok: false, code: "unavailable", launched: false });
    expect(await runner.fetchPage({ session, url: CATALOG })).toMatchObject({ ok: true, html: `<p>${CATALOG}</p>`, finalUrl: CATALOG, session: { cookies: [{ name: "access_token_web" }] } });
    expect(runner.fetchCalls.map((c) => c.timeoutMs)).toEqual([undefined, undefined, 5, undefined, undefined]);
    runner.setFetchFallback("error").setPageHtml("x");
    expect(await runner.fetchPage({ session, url: CATALOG })).toMatchObject({ ok: false, code: "error" });
  });

  it("refuse les adresses hors Vinted et les pages qui ne sont ni catalogue ni annonce", async () => {
    const runner = new FakeRunner();
    expect(await runner.fetchPage({ session, url: "https://www.vinted.fr/inbox/1" })).toMatchObject({ ok: false, code: "error", launched: false });
    expect(runner.allowsTarget("https://www.vinted.fr/items/1-x", "item")).toBe(true);
    expect(runner.allowsTarget("https://www.vinted.fr/items/1-x", "catalog")).toBe(false);
  });

  it("navigation d'achat : scénarios consommés dans l'ordre, refus sans session", async () => {
    const runner = new FakeRunner({ browsingScenarios: ["unavailable", { pages: {} }] });
    expect(await runner.openBrowsing({ session: null })).toMatchObject({ ok: false, code: "not_logged_in", launched: false });
    expect(await runner.openBrowsing({ session })).toMatchObject({ ok: false, code: "unavailable", launched: false });
    const ok = await runner.openBrowsing({ session });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await ok.browsing.page.goto("https://www.vinted.fr/items/1-x")).toEqual({ status: 404 });
    await expect(ok.browsing.page.goto("https://evil.example/items/1")).rejects.toThrow(/Adresse refusée/);
    expect(await ok.browsing.page.click({ intent: "buy", selectors: ["button"] })).toBe(false);
    expect(await runner.openBrowsing({ session })).toMatchObject({ ok: false, code: "error" });
  });
});

describe("PlaywrightRunner — Radar : arrêts avant tout navigateur", () => {
  const dirs: string[] = [];
  const savedTmp = process.env.TMPDIR;
  let base = "";
  beforeAll(async () => {
    // Playwright crée un dossier sous TMPDIR même quand l'exécutable manque : il reste sous un dossier du test.
    const root = await mkdtemp(join(tmpdir(), "selio-cloud-radar-tmp-"));
    dirs.push(root);
    process.env.TMPDIR = root;
    base = await mkdtemp(join(tmpdir(), "selio-cloud-radar-base-"));
    dirs.push(base);
  });
  afterAll(async () => {
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
    for (const d of dirs) await removeProfileDir(d);
  });
  const runner = () => new PlaywrightRunner({ chromiumPath: "/nonexistent/chromium", profileBaseDir: base });

  it("adresses acceptées : catalogue et annonces Vinted, ou l'origine de test injectée", () => {
    expect(runner().allowsTarget(CATALOG, "catalog")).toBe(true);
    expect(runner().allowsTarget("https://www.vinted.fr/items/1-x", "item")).toBe(true);
    expect(runner().allowsTarget("https://www.vinted.fr/inbox/1", "item")).toBe(false);
    const local = new PlaywrightRunner({ chromiumPath: "/x", baseUrl: "http://127.0.0.1:4000" });
    expect(local.allowsTarget("http://127.0.0.1:4000/catalog?search_text=x", "catalog")).toBe(true);
    expect(local.isAllowedOrigin("http://127.0.0.1:4000/checkout")).toBe(true);
    expect(local.isAllowedOrigin("https://acs.banque.example/3ds")).toBe(false);
  });

  it("adresse refusée ou session absente : rien n'est lancé, aucun dossier créé", async () => {
    expect(await runner().fetchPage({ session, url: "https://www.vinted.fr/inbox/1" })).toMatchObject({ ok: false, code: "error", launched: false });
    expect(await runner().fetchPage({ session, url: "https://evil.example/catalog" })).toMatchObject({ ok: false, code: "error", launched: false });
    expect(await runner().fetchPage({ session: null, url: CATALOG })).toMatchObject({ ok: false, code: "not_logged_in", launched: false });
    expect(await runner().openBrowsing({ session: { cookies: [{ ...session.cookies[0]!, domain: ".google.com" }], origins: [] } })).toMatchObject({ ok: false, code: "not_logged_in", launched: false });
    expect(await readdir(base)).toEqual([]);
  });

  it("navigateur introuvable : « unavailable », rien n'a touché Vinted, dossier de travail supprimé", async () => {
    expect(await runner().fetchPage({ session, url: CATALOG })).toMatchObject({ ok: false, code: "unavailable", launched: false, message: expect.stringMatching(/lecture est reportée/) });
    expect(await runner().openBrowsing({ session })).toMatchObject({ ok: false, code: "unavailable", launched: false, message: expect.stringMatching(/achat est reporté/) });
    expect(await readdir(base)).toEqual([]);
  });

  it("dossier fourni non vide : refusé et jamais supprimé", async () => {
    const dir = await mkdtemp(join(tmpdir(), "selio-cloud-radar-dir-"));
    dirs.push(dir);
    await writeFile(join(dir, "donnees.txt"), "x");
    expect(await runner().fetchPage({ session, url: CATALOG, profileDir: dir })).toMatchObject({ ok: false, code: "unavailable", launched: false, message: expect.stringMatching(/pas vide/) });
    expect(await readdir(dir)).toEqual(["donnees.txt"]);
  });

  it("créneaux partagés avec les actions du Cloud : aucun créneau libre → « unavailable » sans lancer", async () => {
    const slots = new BrowserSlots(1);
    const busy = new PlaywrightRunner({ chromiumPath: "/nonexistent/chromium", maxBrowsers: slots, slotWaitMs: 30, profileBaseDir: base });
    const hold = await slots.acquire();
    try {
      expect(await busy.fetchPage({ session, url: CATALOG })).toMatchObject({ ok: false, code: "unavailable", launched: false, message: expect.stringMatching(/Aucun navigateur libre/) });
      expect(slots.inUse).toBe(1);
    } finally {
      hold();
    }
    expect(slots.inUse).toBe(0);
    expect(await readdir(base)).toEqual([]);
  });
});
