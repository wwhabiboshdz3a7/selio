// Vérifie que l'extension compilée se charge dans Chromium (service worker, popup, options) et capture des visuels.
// Usage : node scripts/check-extension.mjs  (nécessite le build et Chromium Playwright)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const dist = new URL("../dist", import.meta.url).pathname;
const out = process.env.SHOTS_DIR ?? new URL("../../../.tmp-shots", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const id = new URL(sw.url()).host;
const errors = [];
for (const page of ["popup.html", "options.html"]) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${page}: ${e.message}`));
  await p.goto(`chrome-extension://${id}/${page}`);
  await p.waitForTimeout(500);
  await p.setViewportSize({ width: page === "popup.html" ? 380 : 760, height: 640 });
  await p.screenshot({ path: `${out}/extension-${page.replace(".html", "")}.png` });
  await p.close();
}
await ctx.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`Extension chargée (id ${id}) : service worker actif, popup et options rendus sans erreur.`);
