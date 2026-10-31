// Captures pleine page (mode sombre, iPhone 15 Pro @3x) des écrans de la démo utilisés dans le spot.
// Servir la démo (pnpm --filter @selio/web build && pnpm --filter @selio/web preview), puis :
//   node capture.mjs http://127.0.0.1:4173 captures && python3 -I prep.py
// L'habillage (barre d'état 9:41, retrait des pastilles « Simulé » et du bandeau de démonstration) est celui de la vidéo v2.
import { createRequire } from "node:module";
const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.SELIO_ROOT || new URL("../../../", import.meta.url).pathname;
const require = createRequire(`${ROOT}apps/web/package.json`);
const { chromium } = require("@playwright/test");
const { decorate } = await import(`${ROOT}livraison/video/source/decorate.mjs`);
const [base = "http://127.0.0.1:4173", out = `${HERE}captures`] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block", reducedMotion: "reduce" });
await ctx.addInitScript(() => { try { localStorage.setItem("selio.theme", "dark"); } catch {} });
const page = await ctx.newPage();
await page.goto(base + "/demo"); await page.waitForTimeout(1500);
const SHOTS = [
  ["radar", "/app/radar"], ["nego", "/app/messages/conv-001"], ["autohub", "/app/automatisation"], ["analytics", "/app/analytics"],
  ["overview", "/app"], ["studioann", "/studio/annonces"], ["dressing", "/app/dressing?sort=score_desc"], ["cloud", "/cloud"], ["studio", "/studio"],
];
for (const [name, path] of SHOTS) {
  await page.goto(base + path); await page.waitForLoadState("networkidle"); await page.waitForTimeout(1200);
  // Studio : les quatre photos du pull à pois de la démo sont déposées dans le générateur (rien n'est généré).
  if (name === "studio") { await page.locator('input[aria-label="Choisir des photos"]').setInputFiles([1, 2, 3, 4].map((i) => `${ROOT}apps/web/public/demo/photos/g-yw5b-${i}.webp`)); await page.waitForTimeout(1500); }
  await decorate(page, "dark");
  await page.evaluate(() => { const w = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/\s*·\s*simulé/i.test(n.textContent)) n.textContent = n.textContent.replace(/\s*·\s*simulé/gi, ""); });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  console.log(name, await page.evaluate(() => document.documentElement.scrollHeight * 3));
}
await browser.close();
