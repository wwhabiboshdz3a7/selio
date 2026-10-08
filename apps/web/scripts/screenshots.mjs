import { chromium } from "@playwright/test";
const out = "/tmp/claude-0/-home-user-selio/5d0b7ce2-1718-59f4-9f45-67fea048935c/scratchpad/shots";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
async function shoot(name, path, { width = 1280, height = 800, theme = "light", demo = false, full = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
  if (demo) {
    await page.goto("http://127.0.0.1:4173/demo");
    await page.waitForURL(/\/app/, { timeout: 15000 });
  }
  await page.goto("http://127.0.0.1:4173" + path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) errors.push(`${name}: débordement horizontal (${await page.evaluate(() => document.documentElement.scrollWidth)} > ${width})`);
  await ctx.close();
}
await shoot("home-desktop", "/");
await shoot("home-mobile", "/", { width: 375, height: 740 });
await shoot("home-dark", "/", { theme: "dark", full: false });
await shoot("pricing-desktop", "/tarifs", { full: false });
await shoot("login-mobile", "/connexion", { width: 375, height: 740 });
await shoot("app-overview", "/app", { demo: true });
await shoot("app-overview-mobile", "/app", { width: 375, height: 740, demo: true });
await shoot("app-overview-dark", "/app", { theme: "dark", demo: true, full: false });
await shoot("app-items", "/app/items", { demo: true, full: false });
await shoot("app-items-mobile", "/app/items", { width: 375, height: 740, demo: true, full: false });
await shoot("app-messages", "/app/messages/conv-001", { demo: true, full: false });
await shoot("app-messages-mobile", "/app/messages/conv-001", { width: 375, height: 740, demo: true, full: false });
await shoot("app-automations", "/app/automations", { demo: true, full: false });
await shoot("app-radar", "/app/radar", { demo: true, full: false });
await shoot("app-analytics-tablet", "/app/analytics", { width: 768, height: 1024, demo: true, full: false });
await shoot("app-settings-connections", "/app/settings/connections", { demo: true, full: false });
await browser.close();
console.log(errors.length ? "ERREURS:\n" + errors.join("\n") : "Aucune erreur JS ni débordement détecté.");
