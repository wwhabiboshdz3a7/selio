// Positions (px de la capture pleine page, 3x) des éléments animés dans la vidéo v2.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url).pathname);
const { chromium } = require("@playwright/test");
const [base, decoPath] = process.argv.slice(2);
const { decorate } = await import(decoPath);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark", serviceWorkers: "block", reducedMotion: "reduce" });
await ctx.addInitScript(() => { try { localStorage.setItem("selio.theme", "dark"); } catch {} });
const page = await ctx.newPage();
await page.goto(base + "/demo"); await page.waitForURL(/\/app/, { timeout: 20000 });
const Q = {
  overview: ["Chiffre d'affaires", "Bénéfice (marge brute)", "Ventes et marge brute", "Objectif du mois", "Bonjour Marie"],
  items: ["Tous actifs", "Articles et stock", "Pull col roulé Tommy Hilfiger rouge"],
  orders: ["Commandes", "Pull ras de cou Tommy Hilfiger gris", "Pull d'hiver Tommy Hilfiger rouge"],
  analytics: ["Chiffre d'affaires", "Marge brute", "Panier moyen", "CA et marge brute"],
  nego: ["Offre de Léa", "Contre-proposition calculée", "Préparer la contre-offre", "Offre détectée", "Bonjour, est-ce que"],
  dressing: ["Pull à pois Tommy Hilfiger marine", "Republier", "Excellente", "Note moyenne"],
};
const PATHS = { overview: "/app", items: "/app/items", orders: "/app/orders", analytics: "/app/analytics", nego: "/app/messages/conv-001", dressing: "/app/dressing?sort=score_desc" };
const out = {};
for (const [name, path] of Object.entries(PATHS)) {
  await page.goto(base + path); await page.waitForLoadState("networkidle"); await page.waitForTimeout(900);
  await decorate(page, "dark");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  out[name] = await page.evaluate((texts) => {
    const f = (b) => [b.left, b.top + scrollY, b.right, b.bottom + scrollY].map((v) => Math.round(v * 3));
    const res = { header: Math.round((document.querySelector("header")?.getBoundingClientRect().bottom ?? 0) * 3) };
    for (const t of texts) {
      const all = [...document.querySelectorAll("main *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase().startsWith(t.toLowerCase()); });
      all.sort((a, b) => a.textContent.length - b.textContent.length);
      const el = all[0]; if (!el) { res[t] = null; continue; }
      let card = el; while (card && card !== document.body && !/(^|\s)(card|rounded-(xl|2xl))(\s|$)/.test(String(card.className))) card = card.parentElement;
      res[t] = { el: f(el.getBoundingClientRect()), card: card && card !== document.body ? f(card.getBoundingClientRect()) : null };
    }
    const g = [...document.querySelectorAll("main img")].map((i) => [i.getAttribute("src")?.split("/").pop(), ...f(i.getBoundingClientRect())]).filter((x) => x[3] > 0).slice(0, 4);
    res.imgs = g;
    return res;
  }, Q[name]);
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
