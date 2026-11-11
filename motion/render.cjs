#!/usr/bin/env node
/* Rendu des videos Selio : chaque image est calculee par seek(t) (deterministe), capturee puis encodee en H.264.
 *   node render.cjs                 -> toutes les videos, tous les formats
 *   node render.cjs 03 07           -> seulement les videos dont l'id contient 03 ou 07
 *   node render.cjs --fmt 9x16      -> un seul format
 *   node render.cjs --stills 02     -> planche d'images de controle (out/_stills) au lieu des MP4
 */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30;
const SIZES = { "9x16": [1080, 1920], "16x9": [1920, 1080], "1x1": [1080, 1080] };
const args = process.argv.slice(2);
const stills = args.includes("--stills");
const fmtOnly = args.includes("--fmt") ? args[args.indexOf("--fmt") + 1] : null;
const filters = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--fmt");
const OUT = path.join(__dirname, "out");
const url = (id, fmt) => "file://" + path.join(__dirname, "src/player.html") + `?v=${id}&fmt=${fmt}`;

async function renderOne(browser, id, fmt) {
  const [w, h] = SIZES[fmt];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`[${id}] ${e.message}`));
  await page.goto(url(id, fmt));
  await page.evaluate(() => document.fonts.ready);
  const dur = await page.evaluate(() => SELIO.dur);
  const name = `selio-${id}-${fmt}`;
  if (stills) {
    const dir = path.join(OUT, "_stills");
    fs.mkdirSync(dir, { recursive: true });
    const n = Math.max(6, Math.round(dur / 1.1));
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.85) / n) * dur;
      await page.evaluate((t) => SELIO.seek(t), t);
      await page.screenshot({ path: path.join(dir, `${name}-${String(i).padStart(2, "0")}.jpg`), type: "jpeg", quality: 80 });
    }
  } else {
    const file = path.join(OUT, name + ".mp4");
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
    const total = Math.round(dur * FPS);
    for (let f = 0; f < total; f++) {
      await page.evaluate((t) => SELIO.seek(t), f / FPS);
      const buf = await page.screenshot({ type: "jpeg", quality: 96 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
  }
  await page.close();
  console.log(`ok ${name} (${dur.toFixed(1)} s)`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url("", "9x16"));
  const all = await page.evaluate(() => Object.entries(SELIO.videos).map(([id, v]) => ({ id, formats: v.formats })));
  await page.close();
  const jobs = [];
  for (const v of all) {
    if (filters.length && !filters.some((f) => v.id.includes(f))) continue;
    for (const fmt of v.formats) if (!fmtOnly || fmt === fmtOnly) jobs.push([v.id, fmt]);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const workers = Array.from({ length: 4 }, async () => { while (jobs.length) { const [id, fmt] = jobs.shift(); await renderOne(browser, id, fmt); } });
  await Promise.all(workers);
  await browser.close();
})();
