// Rendu image par image de scene.html dans Chromium.
//   node render.mjs stills 0.5,3.6,...        → stills/t-XX.XX.jpg (contrôle)
//   node render.mjs frames [fps] - [workers]  → frames/sNNNNNN.jpg : 8 sous-images par image (flou de mouvement)
import { linkSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.SELIO_ROOT || new URL("../../../", import.meta.url).pathname;
const require = createRequire(`${ROOT}apps/web/package.json`);
const { chromium } = require("@playwright/test");
const TL = JSON.parse(readFileSync(`${HERE}timeline.json`, "utf8"));
const [mode = "stills", a1 = "1", , a3 = "4"] = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--allow-file-access-from-files", "--force-color-profile=srgb"] });
async function open() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console", m.text()); });
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
  // 8 sous-images par image sur les passages rapides, 2 ailleurs (chacune recopiée 4 fois), sur un demi-intervalle
  // (obturateur à 180°) ; encode.sh moyenne les 8 sous-images.
  const fps = Number(a1), SUB = 8, workers = Number(a3), n = Math.round(TL.DURATION * fps);
  const [ra, rb] = (process.env.RANGE || `0,${TL.DURATION}`).split(",").map(Number);
  const FAST = [[0, 0.5], [1.95, 2.35], [2.75, 3.15], [3.55, 3.95], [4.3, 5.6], [6.5, 7.4], [13.4, 13.9], [15.4, 15.8], [16.8, 17.9], [18.9, 19.4], [20.2, 20.6], [21.5, 21.9],
    [24.4, 24.9], [30.9, 32.9], [35.55, 36.0], [36.4, 36.9], [42.3, 42.7], [45.0, 45.5], [48.4, 48.9], [57.1, 57.6], [61.7, 62.1], [63.4, 63.9], [65.35, 65.8], [68.4, 68.9], [70.7, 71.2], [73.2, 74.6], [76.4, 77.6]];
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
