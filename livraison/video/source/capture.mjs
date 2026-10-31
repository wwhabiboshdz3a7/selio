// Captures pleine page (mode sombre, iPhone 15 Pro @3x) des écrans utilisés dans la vidéo v2.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url).pathname);
const { chromium } = require("@playwright/test");
const [base, out, decoPath] = process.argv.slice(2);
const { decorate } = await import(decoPath);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block", reducedMotion: "reduce" });
await ctx.addInitScript(() => { try { localStorage.setItem("selio.theme", "dark"); } catch {} });
const page = await ctx.newPage();
await page.goto(base + "/demo"); await page.waitForURL(/\/app/, { timeout: 20000 });
const SHOTS = [
  ["overview", "/app"], ["items", "/app/items"], ["orders", "/app/orders"], ["analytics", "/app/analytics"],
  ["nego", "/app/messages/conv-001"], ["dressing", "/app/dressing?sort=score_desc"], ["studio", "/studio"], ["radar", "/app/radar"],
];
for (const [name, path] of SHOTS) {
  await page.goto(base + path); await page.waitForLoadState("networkidle"); await page.waitForTimeout(900);
  await decorate(page, "dark");
  // Mentions propres au simulateur de démonstration (« · simulé »), retirées comme dans les captures précédentes.
  await page.evaluate(() => {
    const w = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) if (/\s*·\s*simulé/i.test(n.textContent)) n.textContent = n.textContent.replace(/\s*·\s*simulé/gi, "");
  });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  const imgs = await page.evaluate(() => [...document.querySelectorAll("main img")].map((i) => { const b = i.getBoundingClientRect(); return `${i.getAttribute("src")?.split("/").pop()}@${Math.round((b.top + scrollY) * 3)}`; }).slice(0, 12));
  console.log(name, await page.evaluate(() => document.documentElement.scrollHeight * 3), imgs.join(" "));
}
await browser.close();
