// Rendu image par image de scene.html dans Chromium.
//   node render.mjs stills 0.5,3.6,...        → stills/t-XX.XX.jpg (contrôle)
//   node render.mjs frames [fps] - [workers]     → frames/sNNNNNN.jpg : 8 sous-images par image (voir plus bas)
import { linkSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.SELIO_ROOT || new URL("../../../", import.meta.url).pathname;
const require = createRequire(`${ROOT}apps/web/package.json`);
const { chromium } = require("@playwright/test");
const TL = JSON.parse(readFileSync(`${HERE}timeline.json`, "utf8"));
const [mode = "stills", a1 = "1", a2 = "4", a3 = "4"] = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--allow-file-access-from-files", "--force-color-profile=srgb"] });
async function open() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`file://${HERE}scene.html`);
  await page.evaluate(() => window.ready);
  return page;
}
const shot = async (page, t, path) => { await page.evaluate((x) => window.seek(x), t); await page.screenshot({ path, type: "jpeg", quality: 95 }); };

if (mode === "stills") {
  mkdirSync(`${HERE}stills`, { recursive: true });
  const page = await open();
  for (const t of a1.split(",").map(Number)) await shot(page, t, `${HERE}stills/t-${t.toFixed(2).padStart(5, "0")}.jpg`);
  console.log("stills ok");
} else {
  // Flou de mouvement : 8 sous-images par image sur les passages rapides, 2 ailleurs (chacune recopiée 4 fois),
  // toujours réparties sur un demi-intervalle (obturateur à 180°) ; encode.sh moyenne les 8 sous-images.
  const fps = Number(a1), SUB = 8, workers = Number(a3), n = Math.round(TL.DURATION * fps);
  const [ra, rb] = (process.env.RANGE || `0,${TL.DURATION}`).split(",").map(Number);
  const FAST = [[2.9, 3.35], [13.95, 14.65], [15.85, 16.7], [29.0, 29.6], [30.8, 31.4], ...TL.WINS.map((w) => [w.tIn - 0.02, w.tIn + 0.42]), ...TL.SWITCH.map((s) => [s - 0.02, s + 0.28])];
  const fast = (t) => FAST.some(([a, b]) => t >= a && t <= b);
  const tasks = [];
  for (let f = Math.round(ra * fps); f < Math.round(rb * fps); f++) {
    const t = f / fps, file = (k) => `${HERE}frames/s${String(f * SUB + k).padStart(6, "0")}.jpg`;
    if (fast(t)) for (let k = 0; k < SUB; k++) tasks.push({ t: t + (k / SUB) * (0.5 / fps), path: file(k), copies: [] });
    else for (const k of [0, 4]) tasks.push({ t: t + (k / SUB) * (0.5 / fps), path: file(k), copies: [1, 2, 3].map((d) => file(k + d)) });
  }
  mkdirSync(`${HERE}frames`, { recursive: true });
  const t0 = Date.now(); let done = 0, next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    const page = await open();
    while (next < tasks.length) {
      const task = tasks[next++];
      await shot(page, task.t, task.path);
      for (const c of task.copies) { try { unlinkSync(c); } catch {} linkSync(task.path, c); }
      if (++done % 400 === 0) console.log(`${done}/${tasks.length} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  console.log(`${tasks.length} rendus (${n * SUB} sous-images) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
