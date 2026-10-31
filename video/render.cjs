#!/usr/bin/env node
// Rendu déterministe de la composition (src/index.html) :
//   node render.cjs --stills 0.5,3,6.2 [--outdir out/stills]      → images PNG pour contrôle visuel
//   node render.cjs --every 2 [--outdir out/stills]                → une image toutes les 2 s
//   node render.cjs --render [--out out/video_noaudio.mp4] [--fps 30] [--crf 17] [--preset slow] [--start F --end F]
// Options communes : --timing timing.json (fichier de timing servi depuis la racine video/)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true; opt[k] = v; }
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      let fp = path.normalize(path.join(ROOT, u));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
      fs.readFile(fp, (e, d) => {
        if (e) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(d);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.type(), m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const timing = opt.timing || 'timing.json';
  await page.goto(`http://127.0.0.1:${port}/src/index.html?timing=${encodeURIComponent(timing)}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const duration = await page.evaluate(() => window.__duration);
  const fps = Number(opt.fps || 30);
  const shot = () => page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });

  if (opt.stills || opt.every) {
    const outdir = path.join(ROOT, opt.outdir || 'out/stills');
    fs.rmSync(outdir, { recursive: true, force: true }); fs.mkdirSync(outdir, { recursive: true });
    let times = [];
    if (opt.stills) times = String(opt.stills).split(',').map(Number);
    else { const step = Number(opt.every); for (let t = 0; t < duration; t += step) times.push(+t.toFixed(3)); }
    const t0 = Date.now();
    for (const t of times) {
      await page.evaluate((tt) => window.__seek(tt), t);
      const buf = await shot();
      fs.writeFileSync(path.join(outdir, `t_${t.toFixed(2).padStart(6, '0')}.png`), buf);
    }
    console.log(`${times.length} stills → ${outdir} (${((Date.now() - t0) / times.length).toFixed(0)} ms/frame)`);
  } else {
    const total = Math.round(duration * fps);
    const start = Number(opt.start || 0), end = Math.min(total, Number(opt.end || total));
    const out = path.join(ROOT, opt.out || 'out/video_noaudio.mp4');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', String(opt.preset || 'slow'), '-crf', String(opt.crf || 17), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
      '-movflags', '+faststart', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => { ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c)))); });
    const t0 = Date.now();
    for (let f = start; f < end; f++) {
      await page.evaluate((tt) => window.__seek(tt), f / fps);
      const buf = await shot();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if ((f - start) % 60 === 0 || f === end - 1) {
        const el = (Date.now() - t0) / 1000; const doneN = f - start + 1; const eta = (el / doneN) * (end - start - doneN);
        console.log(`frame ${f + 1}/${end} · ${(el / doneN * 1000).toFixed(0)} ms/frame · ETA ${eta.toFixed(0)} s`);
      }
    }
    ff.stdin.end();
    await done;
    console.log(`video → ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
