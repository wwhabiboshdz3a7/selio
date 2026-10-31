import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightRunner } from "../runner/playwright";
import type { StorageState } from "../types";
import { PurchaseRunner } from "./purchase";
import { RadarReader } from "./reader";

/**
 * Selio Radar avec un vrai Chromium, sur un serveur HTTP LOCAL qui sert les fixtures synthétiques de
 * l'adaptateur (catalogue, page de blocage, annonce, paiement). Jamais contre vinted.fr ; aucun achat
 * réel (les pages de « paiement » sont des fichiers locaux). Ignoré sans CLOUD_CHROMIUM_PATH
 * (ex. CLOUD_CHROMIUM_PATH=/opt/pw-browsers/chromium).
 *
 * Bac à sable actif, sauf en root (conteneur de développement) : exception de test, refusée en production.
 */
const chromiumPath = process.env.CLOUD_CHROMIUM_PATH;
const isRoot = process.getuid?.() === 0;

const fixture = (name: string) => readFileSync(new URL(`../../../connectors/src/vinted/fixtures/${name}`, import.meta.url), "utf8");

/** « Acheter » ouvre la page de paiement (mode choisi par l'annonce). */
const buyScript = (mode: string) =>
  `<script>document.querySelector('[data-testid="item-buy-button"]').addEventListener("click", function () { location.href = "/checkout?mode=${mode}"; });</script>`;
/** « Payer » : confirmation, ou validation 3-D Secure demandée par la banque. */
const PAY_SCRIPT = `<script>document.querySelector('[data-testid="checkout-pay-button"]').addEventListener("click", function () {
  var mode = new URLSearchParams(location.search).get("mode");
  location.href = mode === "3ds" ? "/checkout/3ds" : "/checkout/success";
});</script>`;
/** Le client valide dans l'application de sa banque (simulé) : Vinted affiche la confirmation. */
const BANK_VALIDATES = `<script>setTimeout(function () { location.href = "/checkout/success"; }, 1500);</script>`;

const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok-test", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [],
};

describe.skipIf(!chromiumPath)("Selio Radar avec Chromium (pages locales)", () => {
  let server: Server;
  let base = "";
  let profileBase = "";
  const requests: { url: string; userAgent: string; cookie: string; method: string }[] = [];
  /** Pages demandées depuis `from` (l'icône que Chromium demande de lui-même n'est pas une action). */
  const pagesSince = (from: number) => requests.slice(from).map((q) => q.url).filter((u) => u !== "/favicon.ico");

  beforeAll(async () => {
    profileBase = await mkdtemp(join(tmpdir(), "selio-radar-int-"));
    server = createServer((req: IncomingMessage, res) => {
      requests.push({ url: req.url ?? "", userAgent: req.headers["user-agent"] ?? "", cookie: req.headers.cookie ?? "", method: req.method ?? "" });
      const u = new URL(req.url ?? "/", "http://local");
      const html = (body: string, status = 200) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      };
      const q = u.searchParams.get("search_text");
      if (u.pathname === "/catalog") {
        if (q === "bloque") return html(fixture("catalog-blocked.v1.html"));
        if (q === "trop") return html(`<!doctype html><html><head><title>Vinted</title></head><body><h1>Trop de requêtes</h1></body></html>`, 429);
        if (q === "verif") {
          res.writeHead(302, { location: "/captcha/?initialCid=TEST" });
          return res.end();
        }
        return html(fixture("catalog-page.v1.html"));
      }
      if (u.pathname.startsWith("/captcha")) return html(`<!doctype html><html><head><title>Un instant</title></head><body><p>…</p></body></html>`);
      if (u.pathname === "/items/5012345601-veste-en-jean-levi-s-trucker") return html(fixture("item-buy.v1.html").replace("</body>", `${buyScript("done")}</body>`));
      if (u.pathname === "/items/5012345602-veste-3ds") return html(fixture("item-buy.v1.html").replace("</body>", `${buyScript("3ds")}</body>`));
      if (u.pathname === "/checkout") return html(fixture("checkout-page.v1.html").replace("</body>", `${PAY_SCRIPT}</body>`));
      if (u.pathname === "/checkout/3ds") return html(fixture("checkout-3ds.v1.html").replace("</body>", `${BANK_VALIDATES}</body>`));
      if (u.pathname === "/checkout/success") return html(fixture("checkout-done.v1.html"));
      return html("<h1>Introuvable</h1>", 404);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (profileBase) await rm(profileBase, { recursive: true, force: true });
  });

  const runner = () => new PlaywrightRunner({ chromiumPath: chromiumPath!, baseUrl: base, actionTimeoutMs: 45_000, sandbox: !isRoot, profileBaseDir: profileBase });

  it("lit les 12 annonces de la page catalogue, sans rien faire sur la page, puis referme tout", async () => {
    const r0 = runner();
    const reader = new RadarReader({ fetcher: r0, pageBudgetMs: 30_000 });
    const before = requests.length;
    const r = await reader.readSearch({ session, url: `${base}/catalog?search_text=veste&order=newest_first` });
    expect(r).toMatchObject({ outcome: "ok", pageOk: true, blocked: null, measure: "ok", launched: true, status: 200, seenCount: 12 });
    expect(r.items).toHaveLength(12);
    expect(r.items.map((i) => i.externalRef)).toEqual(Array.from({ length: 12 }, (_, i) => `50123456${String(i + 1).padStart(2, "0")}`));
    expect(r.items[2]).toMatchObject({ title: "Robe midi fleurie Sézane", publishedAt: "2026-10-29T09:57:00.000Z", publishedAtSource: "absolute" });
    expect(r.durationMs).toBeGreaterThan(0);
    // Une seule page demandée (GET), aucun clic ni formulaire ; navigateur sans User-Agent falsifié.
    const mine = requests.slice(before).filter((q) => q.url.startsWith("/catalog"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ method: "GET" });
    expect(mine[0]?.userAgent).toMatch(/HeadlessChrome/);
    // Les cookies du compte Achat (vinted.fr) ne partent jamais vers un autre domaine.
    expect(mine[0]?.cookie ?? "").not.toContain("tok-test");
    // Session rendue filtrée (vinted.* seulement), dossier de travail supprimé, créneau rendu.
    expect(r.session?.cookies.map((c) => `${c.domain}:${c.name}`)).toEqual([".vinted.fr:access_token_web"]);
    expect(await readdir(profileBase)).toEqual([]);
    expect(r0.slots.inUse).toBe(0);
  });

  it("page de blocage : arrêt immédiat (blocked), pause du compte ; « trop de requêtes » : coupe-circuit", async () => {
    const reader = new RadarReader({ fetcher: runner(), pageBudgetMs: 30_000 });
    const blocked = await reader.readSearch({ session, url: `${base}/catalog?search_text=bloque` });
    expect(blocked).toMatchObject({ outcome: "blocked", items: [], measure: "blocked", blocked: { code: "captcha" }, stop: { pauseAccount: true, tripMachineCircuit: false } });
    const tooMany = await reader.readSearch({ session, url: `${base}/catalog?search_text=trop` });
    expect(tooMany).toMatchObject({ outcome: "blocked", status: 429, blocked: { code: "rate_limited" }, stop: { tripMachineCircuit: true } });
    // Redirection vers une page de vérification : reconnue par l'adresse finale.
    const redirected = await reader.readSearch({ session, url: `${base}/catalog?search_text=verif` });
    expect(redirected).toMatchObject({ outcome: "blocked", blocked: { code: "captcha" }, finalUrl: expect.stringContaining("/captcha/") });
    expect(await readdir(profileBase)).toEqual([]);
  });

  it("Radar Auto, essai à blanc : Acheter, porte-monnaie coché (état lu dans la page vivante), total lu, AUCUN paiement", async () => {
    const purchase = new PurchaseRunner({ opener: runner(), pollMs: 200, stepTimeoutMs: 10_000 });
    const before = requests.length;
    const r = await purchase.buy({ session, itemUrl: `${base}/items/5012345601-veste-en-jean-levi-s-trucker`, maxTotalCents: 2500, dryRun: true });
    expect(r).toMatchObject({ outcome: "dry_run", totalCents: 2248, itemPriceCents: 1800, walletOffered: true, walletSelected: true });
    expect(pagesSince(before)).toEqual(["/items/5012345601-veste-en-jean-levi-s-trucker", "/checkout?mode=done"]);
    expect(await readdir(profileBase)).toEqual([]);
  });

  it("Radar Auto, prix au-dessus du maximum : price_changed sans aucun clic (la page de paiement n'est jamais demandée)", async () => {
    const purchase = new PurchaseRunner({ opener: runner(), pollMs: 200 });
    const before = requests.length;
    expect(await purchase.buy({ session, itemUrl: `${base}/items/5012345601-veste-en-jean-levi-s-trucker`, maxTotalCents: 1000, dryRun: true })).toMatchObject({ outcome: "price_changed", stage: "item" });
    expect(pagesSince(before)).toEqual(["/items/5012345601-veste-en-jean-levi-s-trucker"]);
  });

  it("Radar Auto (verrous ouverts, pages locales) : confirmation, puis 3-D Secure attendu du client et relu", async () => {
    const r0 = runner();
    const purchase = new PurchaseRunner({ opener: r0, realPurchaseAllowed: true, pollMs: 200, stepTimeoutMs: 10_000, confirmTimeoutMs: 10_000, threeDsTimeoutMs: 60_000 });
    const done = await purchase.buy({ session, itemUrl: `${base}/items/5012345601-veste-en-jean-levi-s-trucker`, maxTotalCents: 2500, dryRun: false });
    expect(done).toMatchObject({ outcome: "purchased", orderRef: "7788990011", totalCents: 2248, walletSelected: true });
    expect(r0.slots.inUse).toBe(0);

    const waiting = await purchase.buy({ session, itemUrl: `${base}/items/5012345602-veste-3ds`, maxTotalCents: 2500, dryRun: false });
    expect(waiting).toMatchObject({ outcome: "awaiting_3ds", totalCents: 2248 });
    // Navigateur gardé ouvert pendant l'attente (créneau pris), rien n'est saisi.
    expect(r0.slots.inUse).toBe(1);
    if (waiting.outcome !== "awaiting_3ds") throw new Error("attente 3-D Secure attendue");
    const confirmed = await purchase.resume(waiting.resumeToken, { waitMs: 10_000 });
    expect(confirmed).toMatchObject({ outcome: "purchased", orderRef: "7788990011" });
    expect(r0.slots.inUse).toBe(0);
    expect(await readdir(profileBase)).toEqual([]);
  });

  it("la page de navigation d'achat n'expose aucune méthode de saisie", async () => {
    const opened = await runner().openBrowsing({ session, timeoutMs: 20_000 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      expect(Object.keys(opened.browsing.page).sort()).toEqual(["click", "content", "goto", "isChecked", "settle", "url", "wait"]);
      await expect(opened.browsing.page.goto("https://evil.example/items/1")).rejects.toThrow(/Adresse refusée/);
    } finally {
      await opened.browsing.close();
    }
    expect(opened.browsing.closed).toBe(true);
  });
});
