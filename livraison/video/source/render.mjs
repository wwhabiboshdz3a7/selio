// Rendu image par image de scene.html dans Chromium.
//   node render.mjs stills 0.5,3.6,...   → stills/t-XX.XX.jpg (contrôle)
//   node render.mjs frames [fps] [workers] → frames/fNNNNN.jpg (vidéo complète)
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const HERE = new URL(".", import.meta.url).pathname;
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url).pathname);
const { chromium } = require("@playwright/test");
const TL = JSON.parse(readFileSync(`${HERE}timeline.json`, "utf8"));
const [mode = "stills", arg = "1", arg2 = "4"] = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--allow-file-access-from-files", "--force-color-profile=srgb"] });
async function open() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`file://${HERE}scene.html`);
  await page.evaluate(() => window.ready);
  return page;
}
const shot = async (page, t, path) => { await page.evaluate((x) => window.seek(x), t); await page.screenshot({ path, type: "jpeg", quality: 94 }); };

if (mode === "stills") {
  mkdirSync(`${HERE}stills`, { recursive: true });
  const page = await open();
  for (const t of arg.split(",").map(Number)) { await shot(page, t, `${HERE}stills/t-${t.toFixed(2).padStart(5, "0")}.jpg`); }
  console.log("stills ok");
} else {
  const fps = Number(arg), workers = Number(arg2), n = Math.round(TL.DURATION * fps);
  mkdirSync(`${HERE}frames`, { recursive: true });
  const t0 = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await open();
    for (let f = w; f < n; f += workers) {
      await shot(page, f / fps, `${HERE}frames/f${String(f).padStart(5, "0")}.jpg`);
      if (++done % 150 === 0) console.log(`${done}/${n} images · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  console.log(`${n} images en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
