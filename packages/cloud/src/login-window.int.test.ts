import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoginWindow, installLoginNavigationGuard, loginPartsFromPlaywright } from "./login-window";
import { createProfileDir, removeProfileDir } from "./profile";
import { contextOptions, launchOptions } from "./runner/launch";
import type { ScreencastFrame } from "./types";

/**
 * Fenêtre de connexion sur un vrai Chromium, page locale (jamais vinted.fr) :
 * capture d'écran CDP, relais des entrées et garde de navigation (redirections
 * comprises). Ignoré sans CLOUD_CHROMIUM_PATH.
 *
 * Bac à sable : actif, sauf si le test tourne en root (conteneur de
 * développement), où Chromium refuse de démarrer avec son bac à sable ; la
 * production l'impose (CLOUD_CHROMIUM_SANDBOX=false refusé).
 */
const chromiumPath = process.env.CLOUD_CHROMIUM_PATH;
const sandbox = process.getuid?.() !== 0;

const LOGIN_PAGE = `<!doctype html><html lang="fr"><head><title>Connexion (test)</title></head><body style="margin:0">
<form><input id="email" style="position:absolute;left:20px;top:20px;width:300px;height:30px" autocomplete="off"></form>
</body></html>`;

describe.skipIf(!chromiumPath)("LoginWindow avec Chromium (page locale)", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/redirect-out") {
        // Hôte autorisé qui redirige ailleurs : `route` ne voit que la première adresse.
        res.writeHead(302, { location: "/interne/admin" });
        return res.end();
      }
      if (path === "/interne/admin") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end("<h1>Page interne</h1>");
      }
      if (path === "/interdit") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end("<h1>Interdit</h1>");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(LOGIN_PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const launch = async (workDir: string) => {
    await mkdir(join(workDir, "artifacts"), { mode: 0o700 });
    return chromium.launch(launchOptions({ chromiumPath: chromiumPath!, headless: true, timeoutMs: 30_000, sandbox, workDir }));
  };

  it("diffuse des images JPEG et relaie clic et texte jusqu'au champ", async () => {
    const profileDir = await createProfileDir();
    const viewport = { width: 640, height: 400 };
    let browser: Browser | null = null;
    try {
      browser = await launch(profileDir);
      const context = await browser.newContext(contextOptions(viewport));
      const page = await context.newPage();
      await page.goto(base);
      const cdp = await context.newCDPSession(page);
      const win = new LoginWindow({ ...loginPartsFromPlaywright(context, page, cdp, browser), viewport, timeoutMs: 60_000, maxFps: 4 });
      const frames: ScreencastFrame[] = [];
      win.onFrame((f) => frames.push(f));
      await win.start();
      const deadline = Date.now() + 10_000;
      while (frames.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(frames.length).toBeGreaterThan(0);
      const jpeg = Buffer.from(frames[0]!.data, "base64");
      expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
      expect(frames[0]!.width).toBe(640);

      await win.dispatchInput({ type: "mouse", action: "down", x: 60, y: 35 });
      await win.dispatchInput({ type: "mouse", action: "up", x: 60, y: 35 });
      await win.dispatchInput({ type: "text", text: "client@example.test" });
      await win.dispatchInput({ type: "key", action: "down", key: "!", code: "Digit1", keyCode: 49, text: "!" });
      await win.dispatchInput({ type: "key", action: "up", key: "!", code: "Digit1", keyCode: 49 });
      expect(await page.inputValue("#email")).toBe("client@example.test!");
      // Page locale : ni Vinted, ni connecté.
      expect(await win.isLoggedIn()).toBe(false);

      await context.addCookies([{ name: "access_token_web", value: "tok", domain: ".vinted.fr", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      const state = await win.finish();
      expect(state.cookies.map((c) => c.name)).toEqual(["access_token_web"]);
      expect(state.origins).toEqual([]);
      expect(win.status).toBe("finished");
      // Fermer la fenêtre ferme aussi le navigateur.
      expect(browser.isConnected()).toBe(false);
      browser = null;
    } finally {
      await browser?.close().catch(() => {});
      await removeProfileDir(profileDir);
    }
  });

  it("garde de navigation : redirection vers une adresse hors liste repérée (fenêtre à fermer), navigation directe bloquée", async () => {
    const profileDir = await createProfileDir();
    let browser: Browser | null = null;
    try {
      browser = await launch(profileDir);
      const context = await browser.newContext(contextOptions({ width: 640, height: 400 }));
      const page = await context.newPage();
      const violations: string[] = [];
      const allowed = (url: string) => {
        try {
          const u = new URL(url);
          return u.origin === base && (u.pathname === "/" || u.pathname === "/redirect-out");
        } catch {
          return false;
        }
      };
      await installLoginNavigationGuard(context, page, {
        isAllowedUrl: allowed,
        isAllowedPage: (url) => url === "about:blank" || url.startsWith("chrome-error://") || allowed(url),
        isBlockedHost: (h) => h === "169.254.169.254",
        onViolation: () => violations.push(page.url()),
      });
      await page.goto(base);
      expect(violations).toEqual([]);
      // Navigation directe hors liste : refusée par `route`, aucune page interdite affichée.
      await page.evaluate(() => {
        window.location.href = "/interdit";
      });
      await page.waitForTimeout(500);
      expect(await page.content()).not.toContain("Interdit");
      // Première adresse autorisée, redirection vers une adresse hors liste : repérée.
      await page.goto(`${base}/redirect-out`).catch(() => null);
      expect(violations.length).toBeGreaterThan(0);
    } finally {
      await browser?.close().catch(() => {});
      await removeProfileDir(profileDir);
    }
  });
});
