#!/usr/bin/env node
/* Rendu : seek(t) image par image (Playwright) → H.264, bande son synthétisée (audio.py) mixée à −14 LUFS.
 *   node render.cjs [filtres d'id…] [--fmt 9x16|16x9|1x1] [--stills]
 */
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FPS = 30, SIZES = { "9x16": [1080, 1920], "16x9": [1920, 1080], "1x1": [1080, 1080] };
const args = process.argv.slice(2);
const stills = args.includes("--stills");
const fmtOnly = args.includes("--fmt") ? args[args.indexOf("--fmt") + 1] : null;
const filters = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--fmt");
const OUT = path.join(__dirname, ".."), TMP = path.join(__dirname, "tmp"), STILLS = path.join(__dirname, "stills");
const url = (id, fmt) => "file://" + path.join(__dirname, "player.html") + `?v=${id}&fmt=${fmt}`;

async function renderOne(browser, id, fmt) {
  const [w, h] = SIZES[fmt];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`[${id}] ${e.message}`));
  await page.goto(url(id, fmt));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => 0))); });
  const tl = await page.evaluate(() => ({ DURATION: SELIO.dur, FIN: SELIO.fin, SFX: SELIO.sfx }));
  const name = `Selio-motion-${id}-${fmt}`;
  if (stills) {
    const n = Math.max(6, Math.round(tl.DURATION / 0.9));
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => SELIO.seek(t), ((i + 0.8) / n) * tl.DURATION);
      await page.screenshot({ path: path.join(STILLS, `${name}-${String(i).padStart(2, "0")}.jpg`), type: "jpeg", quality: 80 });
    }
  } else {
    const wav = path.join(TMP, `${id}.wav`), json = path.join(TMP, `${id}.json`), silent = path.join(TMP, `${name}.mp4`);
    if (!fs.existsSync(wav)) { fs.writeFileSync(json, JSON.stringify(tl)); fs.writeFileSync(wav, ""); execFileSync("python3", ["-I", path.join(__dirname, "audio.py"), json, wav]); }
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", silent], { stdio: ["pipe", "inherit", "inherit"] });
    const total = Math.round(tl.DURATION * FPS);
    for (let f = 0; f < total; f++) {
      await page.evaluate((t) => SELIO.seek(t), f / FPS);
      const buf = await page.screenshot({ type: "jpeg", quality: 96 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
    while (fs.statSync(wav).size < 1000) await new Promise((r) => setTimeout(r, 300));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000",
      "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", path.join(OUT, name + ".mp4")]);
  }
  await page.close();
  console.log(`ok ${name} (${tl.DURATION.toFixed(1)} s, ${tl.SFX.length} bruitages)`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url("", "9x16"));
  const all = await page.evaluate(() => Object.entries(SELIO.videos).map(([id, v]) => ({ id, formats: v.formats })));
  await page.close();
  const jobs = [];
  for (const v of all.sort((a, b) => a.id.localeCompare(b.id))) {
    if (filters.length && !filters.some((f) => v.id.includes(f))) continue;
    for (const fmt of v.formats) if (!fmtOnly || fmt === fmtOnly) jobs.push([v.id, fmt]);
  }
  for (const d of [TMP, STILLS]) fs.mkdirSync(d, { recursive: true });
  await Promise.all(Array.from({ length: 4 }, async () => { while (jobs.length) { const [id, fmt] = jobs.shift(); await renderOne(browser, id, fmt); } }));
  await browser.close();
})();
