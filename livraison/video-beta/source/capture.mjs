// Captures pleine page (mode sombre, iPhone 15 Pro @3x) des écrans réels de la démo utilisés dans la vidéo bêta,
// plus la position (px de capture) des éléments texte et images (captures/boxes.json).
//   pnpm --filter @selio/web build && pnpm --filter @selio/web preview   puis   node capture.mjs http://127.0.0.1:4173
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
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
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(base + "/demo"); await page.waitForTimeout(1500);
const SHOTS = [["radar", "/app/radar"], ["studio", "/studio"], ["autohub", "/app/automatisation"], ["orders", "/app/orders"], ["analytics", "/app/analytics"], ["overview", "/app"], ["dressing", "/app/dressing?sort=score_desc"], ["track", "/track"], ["studioann", "/studio/annonces"]];
const boxes = {};
for (const [name, path] of SHOTS) {
  await page.goto(base + path); await page.waitForLoadState("networkidle"); await page.waitForTimeout(1200);
  if (name === "studio") { await page.locator('input[aria-label="Choisir des photos"]').setInputFiles([1, 2, 3, 4, 5, 6].map((i) => `${ROOT}apps/web/public/demo/photos/g-yw5b-${i}.webp`)); await page.waitForTimeout(1800); }
  await decorate(page, "dark");
  await page.evaluate(() => { const w = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/\s*·\s*simulé/i.test(n.textContent)) n.textContent = n.textContent.replace(/\s*·\s*simulé/gi, ""); });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  boxes[name] = await page.evaluate(() => {
    const res = [];
    for (const el of document.querySelectorAll("main *")) {
      const t = (el.innerText || "").trim(); if (!t || t.length > 90) continue;
      const kids = [...el.children].filter((c) => (c.innerText || "").trim()); if (kids.length > 3) continue;
      const b = el.getBoundingClientRect(); if (b.width < 4 || b.height < 4) continue;
      res.push({ tag: el.tagName, t: t.replace(/\s+/g, " "), b: [b.left, b.top + scrollY, b.right, b.bottom + scrollY].map((v) => Math.round(v * 3)) });
    }
    for (const img of document.querySelectorAll("main img, main figure")) { const b = img.getBoundingClientRect(); res.push({ tag: img.tagName, t: (img.getAttribute("src") || img.innerText || "").slice(0, 40), b: [b.left, b.top + scrollY, b.right, b.bottom + scrollY].map((v) => Math.round(v * 3)) }); }
    return res;
  });
  console.log(name, await page.evaluate(() => document.documentElement.scrollHeight * 3));
}
writeFileSync(`${out}/boxes.json`, JSON.stringify(boxes));
await browser.close();
