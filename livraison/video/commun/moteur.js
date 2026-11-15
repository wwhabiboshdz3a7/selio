// Moteur d'animation commun des vidéos Selio, déterministe : seek(t) place chaque élément pour l'instant t (secondes).
// Repris du moteur de la vidéo « Et si une appli centralisait tout ? » (source/engine.js) : fond, grain, sous-titres karaoké,
// logo, bouton final. Chaque vidéo ajoute sa scène (scene.js) : drawScene(t), et au besoin drawSceneBg(t) et sceneReady().
const W = 1080, H = 1920, CX = 540, CY = 960;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const P = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const eOut = (u) => 1 - Math.pow(1 - u, 3);
const eIn = (u) => u * u * u;
const eIO = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const eBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const wob = (x, k) => Math.sin(x * 1.7 + k) * 0.6 + Math.sin(x * 3.1 + k * 2.3) * 0.4;
const bump = (t, a, b, c, d) => P(t, a, b) * (1 - P(t, c, d));
const $ = (id) => document.getElementById(id);
const f2 = (v) => v.toFixed(2);
function kf(t, keys, ease = eIO) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], ease(P(t, keys[i - 1][0], keys[i][0])));
  return keys[keys.length - 1][1];
}
const cache = new WeakMap();
function css(el, prop, v) { let c = cache.get(el); if (!c) cache.set(el, (c = {})); if (c[prop] !== v) { el.style[prop] = v; c[prop] = v; } }
function html(el, v) { let c = cache.get(el); if (!c) cache.set(el, (c = {})); if (c.html !== v) { el.innerHTML = v; c.html = v; } }
function vis(el, on) { css(el, "display", on ? "" : "none"); return on; }
// Place un élément : st = { x, y (centre), s, r, o, b (flou) } ; w, h = taille de l'élément.
function place(el, st, w, h) {
  if (!vis(el, !!st && st.o > 0.002)) return false;
  css(el, "transform", `translate(${f2(st.x - w / 2)}px, ${f2(st.y - h / 2)}px) rotate(${f2(st.r || 0)}deg) scale(${(st.s ?? 1).toFixed(4)})`);
  css(el, "opacity", clamp(st.o).toFixed(3));
  css(el, "filter", st.b > 0.05 ? `blur(${f2(st.b)}px)` : "none");
  return true;
}
// Entrée / sortie classiques : montée + fondu + léger zoom.
function popIn(t, t0, d = 0.35) { const u = P(t, t0, t0 + d); return { o: P(t, t0, t0 + d * 0.5), s: lerp(0.86, 1, eBack(u)), dy: 40 * (1 - eOut(u)), b: 8 * (1 - eOut(u)) }; }
function popOut(t, t1, d = 0.25) { const u = P(t, t1, t1 + d); return { o: 1 - u, s: 1 - 0.08 * eIn(u), dy: -30 * eIn(u), b: 6 * u }; }
const typed = (txt, t, a, b) => txt.slice(0, Math.floor(txt.length * P(t, a, b)));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const CARET = '<span class="caret"></span>';
const blink = (t) => Math.floor(t * 2.2) % 2 === 0;

// ---------- Fond : halos mouvants et étoiles ; calque d'effets : éclats et ondes ----------
const bg = $("bg").getContext("2d"), fx = $("fx").getContext("2d");
const STARS = Array.from({ length: 150 }, (_, i) => ({ x: hash(i + 1) * W, y: hash(i + 101) * H, r: 0.6 + hash(i + 201) * 2.2, a: 0.12 + hash(i + 301) * 0.5, ph: hash(i + 401) * 6.28, sp: 5 + hash(i + 501) * 14, g: hash(i + 601) < 0.2 }));
const PART = Array.from({ length: 120 }, (_, i) => ({ a: hash(i + 700) * 6.283, sp: 0.6 + hash(i + 900) * 1.4, sz: 1.2 + hash(i + 1000) * 3.2, c: hash(i + 1100) < 0.35 ? "226,198,124" : hash(i + 1200) < 0.5 ? "185,166,255" : "255,255,255", orb: 220 + hash(i + 1300) * 380 }));
function blob(c, x, y, rx, ry, rgb, a) {
  if (a <= 0.003) return;
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.38})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.fillRect(-rx, -rx, 2 * rx, 2 * rx); c.restore();
}
function drawBg(t) {
  const night = typeof bgNight === "function" ? bgNight(t) : 0; // 0 = fond violet habituel, 1 = nuit bleue
  bg.fillStyle = night > 0 ? `rgb(${Math.round(lerp(14, 6, night))},${Math.round(lerp(12, 9, night))},${Math.round(lerp(19, 22, night))})` : "#0E0C13";
  bg.fillRect(0, 0, W, H);
  blob(bg, 540 + 240 * Math.sin(t * 0.21), 150 + 70 * Math.sin(t * 0.17), 1050, 640, "100,66,214", 0.55 * (1 - 0.55 * night));
  blob(bg, 220 + 140 * Math.sin(t * 0.15 + 1), 1450 + 120 * Math.sin(t * 0.2), 820, 620, night > 0.5 ? "30,44,110" : "59,42,143", 0.42);
  blob(bg, 880 + 110 * Math.sin(t * 0.18 + 2), 1960, 900, 430, "193,147,59", 0.17 * (1 - night));
  for (const [t0, t1] of TL.GLOW || []) blob(bg, 540, 960, 900, 900, "124,92,235", 0.65 * bump(t, t0, t0 + 0.3, t1 - 0.6, t1));
  for (const s of STARS) {
    const y = (((s.y - t * s.sp) % H) + H) % H;
    bg.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 1.3 + s.ph)) * (1 + 0.6 * night);
    bg.fillStyle = s.g ? "#E2C67C" : "#FFFFFF";
    bg.beginPath(); bg.arc(s.x, y, s.r, 0, 6.2832); bg.fill();
  }
  bg.globalAlpha = 1;
  if (typeof drawSceneBg === "function") drawSceneBg(t, bg);
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  fx.globalCompositeOperation = "lighter";
  for (const [t0, x, y, k = 1] of TL.BURSTS || []) {
    if (t < t0 - 0.6 || t > t0 + 1.8) continue;
    for (const p of PART) {
      let r, al;
      if (t < t0) { const u = eIn(P(t, t0 - 0.6, t0)); r = (300 + p.orb) * (1 - u) + 10; al = P(t, t0 - 0.6, t0 - 0.4) * 0.8; }
      else { const u = eOut(P(t, t0, t0 + 0.8)); r = lerp(10, p.orb * k + 160 * (1 - P(t, t0, t0 + 1.5)), u); al = 1 - P(t, t0 + 1.0, t0 + 1.75); }
      const a = p.a + (t - t0) * p.sp * 0.6, px = x + r * Math.cos(a), py = y + r * Math.sin(a) * 0.92;
      const g = fx.createRadialGradient(px, py, 0, px, py, p.sz * 4);
      g.addColorStop(0, `rgba(${p.c},${al})`); g.addColorStop(1, `rgba(${p.c},0)`);
      fx.fillStyle = g; fx.fillRect(px - p.sz * 4, py - p.sz * 4, p.sz * 8, p.sz * 8);
    }
    const ring = (d, maxR, w0, a0) => { const tt = t - t0 - d; if (tt < 0 || tt > 0.8) return; const u = eOut(tt / 0.8); fx.strokeStyle = `rgba(243,226,179,${(a0 * (1 - u)).toFixed(3)})`; fx.lineWidth = Math.max(1, w0 * (1 - u)); fx.beginPath(); fx.arc(x, y, 40 + maxR * u, 0, 6.2832); fx.stroke(); };
    ring(0, 1200 * k, 24, 0.8); ring(0.1, 800 * k, 10, 0.55);
  }
  fx.globalCompositeOperation = "source-over";
}
const gr = $("grain").getContext("2d");
const TILES = Array.from({ length: 4 }, (_, k) => { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"); const d = x.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(hash(i * 0.37 + k * 999) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; });
function drawGrain(t) {
  const f = Math.floor(t * 30), tile = TILES[f % 4], ox = Math.floor(hash(f) * 256), oy = Math.floor(hash(f + 5) * 256);
  for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) gr.drawImage(tile, x, y);
}

// ---------- Sous-titres karaoké : chaque mot s'allume à son instant (g = or, r = rouge) ----------
const CAPS = TL.CAPS.map((c) => {
  const d = document.createElement("div"); const w = c.width || 960;
  d.className = "cap"; d.style.left = `${(W - w) / 2}px`; d.style.width = `${w}px`; d.style.top = `${c.top}px`; d.style.fontSize = `${c.size}px`;
  const spans = [];
  for (const [txt, wt, st] of c.words) {
    if (txt === "\n") { d.appendChild(document.createElement("br")); continue; }
    const s = document.createElement("span"); s.className = "w"; s.textContent = txt;
    d.appendChild(s); d.appendChild(document.createTextNode(" ")); spans.push({ s, t: wt, st });
  }
  $("caps").appendChild(d); return { d, c, spans };
});
CAPS.forEach((k, i) => { const nx = CAPS[i + 1]; const t0n = nx ? nx.spans[0].t - 0.12 : Infinity; k.end = Math.min(k.c.out, t0n - 0.07); k.fade = k.c.out > t0n - 0.07 ? 0.07 : 0.15; });
function drawCaps(t) {
  for (const { d, c, spans, end, fade } of CAPS) {
    const t0 = spans[0].t - 0.12;
    if (!vis(d, t >= t0 && t <= end + fade)) continue;
    const a = eOut(P(t, t0, t0 + 0.16)), z = P(t, end, end + fade);
    css(d, "opacity", (a * (1 - z)).toFixed(3));
    let sc = 1;
    for (const ts of c.slam || []) sc += 0.045 * Math.exp(-((t - ts) ** 2) / 0.004);
    css(d, "transform", `translateY(${f2(26 * (1 - a) - 20 * z)}px) scale(${sc.toFixed(4)})`);
    for (const w of spans) {
      const on = t >= w.t, col = w.st === "g" ? "#E2C67C" : w.st === "r" ? "#FF8F85" : w.st === "v" ? "#C9BBFF" : "#FFFFFF", u = P(t, w.t, w.t + 0.18);
      css(w.s, "color", on ? col : "rgba(255,255,255,.28)");
      css(w.s, "transform", `translateY(${f2(on ? 12 * (1 - eOut(u)) : 12)}px)`);
      css(w.s, "filter", on && u < 1 ? `blur(${f2(5 * (1 - eOut(u)))}px)` : "none");
      css(w.s, "backgroundSize", w.st === "g" && on ? `${(100 * eOut(P(t, w.t + 0.05, w.t + 0.35))).toFixed(1)}% 30%` : "0% 30%");
    }
  }
  let band = 0;
  for (const [a, b, c, d] of TL.CAPBAND || []) band += bump(t, a, b, c, d);
  css($("capband"), "opacity", clamp(band).toFixed(3));
}

// ---------- Logo Selio + nom de la filiale ----------
const BR = (TL.BRANDS || []).map((b, i) => ({ ...b, el: $(`brand${i}`), shine: $(`brand${i}`).querySelector(".shine") }));
function drawBrands(t) {
  for (const b of BR) {
    if (!vis(b.el, t >= b.tIn - 0.05 && t <= b.tOut + 0.4)) continue;
    const u = P(t, b.tIn, b.tIn + 0.7), z = P(t, b.tOut, b.tOut + 0.35);
    const s = (b.s || 1) * (lerp(0.7, 1, eBack(u)) + 0.04 * P(t, b.tIn + 0.7, b.tOut) + 0.15 * eIn(z));
    const o = P(t, b.tIn, b.tIn + 0.2) * (1 - z), bl = 14 * (1 - eOut(u)) + 10 * z;
    css(b.el, "transform", `translate(${f2(540 - 360)}px, ${f2(b.y - 170)}px) scale(${s.toFixed(4)})`);
    css(b.el, "opacity", o.toFixed(3));
    css(b.el, "filter", bl > 0.05 ? `blur(${f2(bl)}px)` : "none");
    css(b.shine, "backgroundPosition", `${f2(lerp(140, -40, eIO(P(t, b.tIn + 0.35, b.tIn + 1.2))))}% 0`);
  }
}

// ---------- Final : bouton, lien, mention ----------
function drawCta(t) {
  const c = TL.CTA; if (!c) return;
  const el = $("cta");
  if (!vis(el, t >= c.t)) return;
  const b = popIn(t, c.t, 0.5), bi = popIn(t, c.t + 0.45), lg = P(t, c.t + 0.7, c.t + 1.1);
  place($("btn"), { x: 540, y: c.yBtn + b.dy, s: b.s * (1 + 0.025 * Math.sin((t - c.t) * 5) * P(t, c.t + 0.6, c.t + 1)), o: b.o, b: b.b }, SIZES.btn[0], SIZES.btn[1]);
  css($("shine"), "left", `${f2(lerp(-200, SIZES.btn[0] + 60, P((t - c.t - 0.7) % 2.2, 0, 0.9)))}px`);
  place($("bio"), { x: 540, y: c.yBio + bi.dy + 8 * Math.sin((t - c.t) * 4), o: bi.o, s: bi.s, b: bi.b }, SIZES.bio[0], SIZES.bio[1]);
  place($("legal"), { x: 540, y: c.yLegal, o: lg, s: 1 }, SIZES.legal[0], SIZES.legal[1]);
}

// ---------- Image complète ----------
const SIZES = {};
function seek(t) {
  drawBg(t);
  drawScene(t);
  drawFx(t);
  drawBrands(t);
  drawCta(t);
  drawCaps(t);
  let fl = 0;
  for (const [t0, a = 0.9, d = 0.45] of TL.FLASH || []) if (t >= t0) fl = Math.max(fl, a * Math.pow(Math.max(0, 1 - (t - t0) / d), 1.5));
  css($("flash"), "opacity", fl.toFixed(3));
  drawGrain(t);
}
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  if (TL.CTA) { $("cta").style.display = ""; for (const id of ["btn", "bio", "legal"]) { const e = $(id); e.style.display = ""; e.style.transform = "none"; SIZES[id] = [e.offsetWidth, e.offsetHeight]; } }
  if (typeof sceneReady === "function") sceneReady();
  return true;
})();
window.seek = seek;
