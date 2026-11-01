// Moteur d'animation de la vidéo bêta (repris du spot de 45 s), déterministe : seek(t) place chaque élément pour l'instant t.
// Les instants charnières viennent de TL.T (build.mjs) : logo, entrée/sortie du téléphone, final, bouton.
const W = 1080, H = 1920, CX = 540, CY = 960, S = 600 / 1179, T = TL.T;
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
const eur = (v, plus) => `${plus ? "+" : ""}${v.toFixed(2).replace(".", ",")} €`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const hms = (s) => { s = Math.max(0, Math.floor(s)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, "0")).join(":"); };
function kf(t, keys, ease = eIO) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], ease(P(t, keys[i - 1][0], keys[i][0])));
  return keys[keys.length - 1][1];
}
const cache = new WeakMap();
function css(el, prop, v) { let c = cache.get(el); if (!c) cache.set(el, (c = {})); if (c[prop] !== v) { el.style[prop] = v; c[prop] = v; } }
function html(el, v) { let c = cache.get(el); if (!c) cache.set(el, (c = {})); if (c.html !== v) { el.innerHTML = v; c.html = v; } }
function vis(el, on) { css(el, "display", on ? "" : "none"); return on; }
function place2d(el, st, ox, oy) {
  if (!vis(el, !!st && st.o > 0.002)) return;
  css(el, "transformOrigin", `${ox}px ${oy}px`);
  css(el, "transform", `translate(${f2(st.x - ox)}px, ${f2(st.y - oy)}px) rotate(${f2(st.r || 0)}deg) scale(${(st.s ?? 1).toFixed(4)})`);
  css(el, "opacity", clamp(st.o).toFixed(3));
  css(el, "filter", st.b > 0.05 ? `blur(${f2(st.b)}px)` : "none");
}
// coups de caméra (zoom bref) et secousses sur les temps forts
const punch = (t) => TL.PUNCH.reduce((s, [t0, a]) => s + (t >= t0 ? a * P(t, t0, t0 + 0.035) * Math.exp(-Math.max(0, t - t0 - 0.035) / 0.16) : 0), 0);
function shake(t) {
  let x = 0, y = 0;
  for (const [t0, a] of TL.SHAKE) if (t >= t0 && t < t0 + 0.5) { const k = a * Math.exp(-(t - t0) / 0.12); x += k * wob(t * 70, t0); y += k * wob(t * 63, t0 + 9); }
  return [x, y];
}

// ---------- Fond : halos mouvants, étoiles ; calque d'effets : particules, ondes ----------
const bg = $("bg").getContext("2d"), fx = $("fx").getContext("2d");
const STARS = Array.from({ length: 170 }, (_, i) => ({ x: hash(i + 1) * W, y: hash(i + 101) * H, r: 0.6 + hash(i + 201) * 2.2, a: 0.12 + hash(i + 301) * 0.55, ph: hash(i + 401) * 6.28, sp: 5 + hash(i + 501) * 14, g: hash(i + 601) < 0.2 }));
const PART = Array.from({ length: 170 }, (_, i) => ({ a: hash(i + 700) * 6.283, r: 380 + hash(i + 800) * 900, sp: 0.6 + hash(i + 900) * 1.4, sz: 1.2 + hash(i + 1000) * 3.2, c: hash(i + 1100) < 0.35 ? "226,198,124" : hash(i + 1200) < 0.5 ? "185,166,255" : "255,255,255", orb: 260 + hash(i + 1300) * 260 }));
function blob(c, x, y, rx, ry, rgb, a) {
  if (a <= 0.003) return;
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.38})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.fillRect(-rx, -rx, 2 * rx, 2 * rx); c.restore();
}
function drawBg(t) {
  bg.fillStyle = "#0E0C13"; bg.fillRect(0, 0, W, H);
  blob(bg, 540 + 240 * Math.sin(t * 0.21), 150 + 70 * Math.sin(t * 0.17), 1050, 640, "100,66,214", 0.55);
  blob(bg, 220 + 140 * Math.sin(t * 0.15 + 1), 1450 + 120 * Math.sin(t * 0.2), 820, 620, "59,42,143", 0.42);
  blob(bg, 880 + 110 * Math.sin(t * 0.18 + 2), 1960, 900, 430, "193,147,59", 0.17);
  blob(bg, 540, 1200, 820, 700, "214,70,70", 0.14 * bump(t, 2.0, 2.4, 4.2, 4.6)); // rougeur des corvées
  blob(bg, 540, 960, 900, 900, "124,92,235", 0.7 * bump(t, T.logo - 0.1, T.logo + 0.1, T.logo + 1.0, T.logo + 1.7));
  blob(bg, 540, 1500, 760, 520, "193,147,59", 0.22 * bump(t, 61.7, 62.0, 63.0, 63.6)); // halo d'or : vendu
  blob(bg, 540, 480, 820, 720, "124,92,235", 0.5 * P(t, T.final - 0.1, T.final + 0.7));
  for (const s of STARS) {
    const y = (((s.y - t * s.sp) % H) + H) % H;
    bg.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 1.3 + s.ph));
    bg.fillStyle = s.g ? "#E2C67C" : "#FFFFFF";
    bg.beginPath(); bg.arc(s.x, y, s.r, 0, 6.2832); bg.fill();
  }
  bg.globalAlpha = 1;
}
function sparkles(t, t0, cx, cy, n = 46, spread = 520, flat = 0.45) {
  if (t < t0 || t > t0 + 1.25) return;
  for (let i = 0; i < n; i++) {
    const u = P(t, t0 + hash(i + 40) * 0.25, t0 + 1.15), a = hash(i + 50) * 6.283, r = 60 + spread * eOut(u), al = (1 - u) * 0.9;
    if (u <= 0 || u >= 1) continue;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a) * flat, sz = 2 + 4 * hash(i + 60);
    const g = fx.createRadialGradient(x, y, 0, x, y, sz * 4);
    g.addColorStop(0, `rgba(243,226,179,${al.toFixed(3)})`); g.addColorStop(1, "rgba(243,226,179,0)");
    fx.fillStyle = g; fx.fillRect(x - sz * 4, y - sz * 4, sz * 8, sz * 8);
  }
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  fx.globalCompositeOperation = "lighter";
  // particules : aspirées vers le centre avec les corvées, puis éclatent autour du logo
  const s0 = TL.SUCK + 0.05, L = T.logo;
  if (t >= s0 && t < L + 1.7) {
    for (const p of PART) {
      let r, a, al;
      if (t < L) { const u = eIn(P(t, s0, L)); r = p.r * (1 - u) + 10; a = p.a + (t - s0) * p.sp * 2.2; al = P(t, s0, s0 + 0.3) * 0.9; }
      else { const u = eOut(P(t, L, L + 0.8)); r = lerp(10, p.orb + 200 * (1 - P(t, L, L + 1.4)), u); a = p.a + (t - L) * p.sp * 0.5; al = 1 - P(t, L + 0.9, L + 1.6); }
      const x = CX + r * Math.cos(a), y = CY + r * Math.sin(a) * 0.92;
      const g = fx.createRadialGradient(x, y, 0, x, y, p.sz * 4);
      g.addColorStop(0, `rgba(${p.c},${al})`); g.addColorStop(1, `rgba(${p.c},0)`);
      fx.fillStyle = g; fx.fillRect(x - p.sz * 4, y - p.sz * 4, p.sz * 8, p.sz * 8);
    }
  }
  sparkles(t, 61.8, 540, 1150, 46, 520, 0.5); // vendu
  sparkles(t, 75.95, 540, 700, 40, 600, 0.35); // « un seul écosystème »
  const ring = (t0, x, y, maxR, w0, a0) => { if (t < t0 || t > t0 + 0.8) return; const u = eOut(P(t, t0, t0 + 0.8)); fx.strokeStyle = `rgba(243,226,179,${(a0 * (1 - u)).toFixed(3)})`; fx.lineWidth = Math.max(1, w0 * (1 - u)); fx.beginPath(); fx.arc(x, y, 40 + maxR * u, 0, 6.2832); fx.stroke(); };
  ring(L, CX, CY, 1300, 26, 0.85); ring(L + 0.1, CX, CY, 900, 12, 0.6); ring(61.8, 540, 1150, 700, 14, 0.6); ring(T.final + 0.05, 540, 430, 800, 18, 0.6);
  fx.globalCompositeOperation = "source-over";
}
const gr = $("grain").getContext("2d");
const TILES = Array.from({ length: 4 }, (_, k) => { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"); const d = x.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(hash(i * 0.37 + k * 999) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; });
function drawGrain(t) {
  const f = Math.floor(t * 30), tile = TILES[f % 4], ox = Math.floor(hash(f) * 256), oy = Math.floor(hash(f + 5) * 256);
  for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) gr.drawImage(tile, x, y);
}

// ---------- Accroche : le chrono et les trois corvées, aspirés au centre avant le logo ----------
function suction(st, t, k, t0 = TL.SUCK, d = T.logo - TL.SUCK) {
  if (t < t0) return st;
  const u = P(t, t0 + k * 0.05, t0 + d);
  if (u >= 1) return null;
  const e = Math.pow(u, 2.1), dx = st.x - CX, dy = st.y - CY, r0 = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx), rr = r0 * (1 - e), a = a0 + e * 2.8;
  return { ...st, x: CX + rr * Math.cos(a), y: CY + rr * Math.sin(a), s: st.s * (1 - 0.9 * e), r: (st.r ?? 0) + e * 300, o: st.o * (1 - P(u, 0.7, 1)), b: 0 };
}
function drawHook(t) {
  const scene = $("hookScene");
  if (!vis(scene, t <= T.logo)) return;
  const [sx, sy] = shake(t), pu = 1 + punch(t);
  css(scene, "transform", `translate(${f2(sx)}px, ${f2(sy)}px) scale(${pu.toFixed(4)})`);
  const K = TL.TIMER, tm = $("timer"), landed = t >= K.t0 + K.d;
  if (t < K.t0) vis(tm, false);
  else {
    const secs = K.to * eOut(P(t, K.t0, K.t0 + K.d)) + Math.max(0, t - K.t0 - K.d);
    html($("timerv"), hms(secs));
    css($("timerv"), "color", landed ? "#FF8F85" : "#FFFFFF");
    css($("timerv"), "textShadow", landed ? "0 0 60px rgba(255,93,93,.45), 0 8px 40px rgba(0,0,0,.5)" : "0 8px 40px rgba(0,0,0,.5)");
    const nu = P(t, K.t0, K.t0 + 0.25);
    let st = { x: 540, y: 760, r: 0, s: lerp(1.3, 1, eOut(nu)) * (1 + 0.05 * Math.exp(-Math.max(0, t - K.t0 - K.d) / 0.15)), o: P(t, K.t0, K.t0 + 0.08), b: 10 * (1 - eOut(nu)) };
    st = suction(st, t, 3);
    place2d(tm, st, 540, 120);
  }
  TL.TASKS.forEach((k, i) => {
    const el = $(`task${i}`);
    if (t < k.t) { vis(el, false); return; }
    const u = P(t, k.t, k.t + 0.3);
    let st = { x: 540, y: k.y + 6 * Math.sin(t * 1.3 + i), r: lerp(-6, 0, eOut(u)) + 0.4 * Math.sin(t * 0.8 + i), s: lerp(1.6, 1, eOut(u)), o: P(t, k.t, k.t + 0.08), b: 14 * (1 - eOut(u)) };
    st = suction(st, t, i);
    place2d(el, st, 380, 88);
    html($(`tm${i}`), hms(k.start + (t - k.t) * 10));
  });
}

// ---------- Sous-titres karaoké ----------
const CAPS = TL.CAPS.map((c) => {
  const d = document.createElement("div"); const w = c.width || 960;
  d.className = c.slam ? "cap slam" : "cap"; d.style.left = `${(W - w) / 2}px`; d.style.width = `${w}px`; d.style.top = `${c.top}px`; d.style.fontSize = `${c.size}px`;
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
    if (c.slam) sc = 1 + spans.reduce((s, w) => s + 0.05 * Math.exp(-((t - w.t) ** 2) / 0.004), 0);
    css(d, "transform", `translateY(${f2(26 * (1 - a) - 20 * z)}px) scale(${sc.toFixed(4)})`);
    for (const w of spans) {
      const on = t >= w.t, col = w.st === "g" ? "#E2C67C" : w.st === "r" ? "#FF8F85" : "#FFFFFF", u = P(t, w.t, w.t + 0.18);
      css(w.s, "color", on ? col : c.slam ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.28)");
      if (c.slam) { css(w.s, "transform", on ? `scale(${(1 + 0.18 * (1 - eOut(u))).toFixed(3)})` : "scale(1)"); css(w.s, "filter", on && u < 1 ? `blur(${f2(7 * (1 - eOut(u)))}px)` : "none"); }
      else { css(w.s, "transform", `translateY(${f2(on ? 12 * (1 - eOut(u)) : 12)}px)`); css(w.s, "filter", on && u < 1 ? `blur(${f2(5 * (1 - eOut(u)))}px)` : "none"); }
      css(w.s, "backgroundSize", w.st === "g" && on && !c.slam ? `${(100 * eOut(P(t, w.t + 0.05, w.t + 0.35))).toFixed(1)}% 30%` : "0% 30%");
    }
  }
  css($("capband"), "opacity", (bump(t, -1, 0, TL.SUCK + 0.3, TL.SUCK + 0.55) + bump(t, T.phoneIn - 0.2, T.phoneIn + 0.1, T.phoneOut - 0.1, T.phoneOut + 0.2)).toFixed(3));
}

// ---------- Pastille en haut à droite ----------
function drawChip(t) {
  const el = $("chip"); let cur = null, idx = -1;
  TL.CHIP.forEach((c, i) => { if (t >= c[0]) { cur = c; idx = i; } });
  if (!vis(el, !!cur && cur[1] !== "")) return;
  html($("chipt"), cur[1]); el.className = cur[2];
  const u = P(t, cur[0], cur[0] + 0.3);
  const prevHidden = idx === 0 || TL.CHIP[idx - 1][1] === "";
  const s = prevHidden ? lerp(0.3, 1, eBack(u)) : 1 + 0.22 * (1 - eOut(u));
  css(el, "transform", `scale(${s.toFixed(4)})`);
  css(el, "opacity", prevHidden ? P(t, cur[0], cur[0] + 0.1).toFixed(3) : "1");
}

// ---------- Logo Selio en constellation (révélation et final) ----------
const NS = "http://www.w3.org/2000/svg", ringG = $("ringg"), R1 = 300, R2 = 410, C1 = 2 * Math.PI * R1, C2 = 2 * Math.PI * R2;
const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); ringG.appendChild(e); return e; };
const DOTS = Array.from({ length: 8 }, (_, i) => { const a = (-90 + i * 45 + 12) * Math.PI / 180; return { x: R1 * Math.cos(a), y: R1 * Math.sin(a), f: (i * 45 + 12) / 360 }; });
const LINES = DOTS.map((p, i) => { const q = DOTS[(i + 3) % 8]; return mk("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: "#E2C67C", "stroke-width": 1.5, opacity: 0 }); });
const ring2 = mk("circle", { r: R2, fill: "none", stroke: "rgba(226,198,124,.35)", "stroke-width": 2, "stroke-dasharray": C2, transform: "rotate(-90)" });
const ring1 = mk("circle", { r: R1, fill: "none", stroke: "#E2C67C", "stroke-width": 3.5, "stroke-dasharray": C1, transform: "rotate(-90)" });
const DOTEL = DOTS.map((p) => mk("circle", { cx: p.x, cy: p.y, r: 0, fill: "#F3E2B3" }));
ringG.parentElement.style.filter = "drop-shadow(0 0 10px rgba(226,198,124,.8))";
const LOGO_OUT = T.phoneIn - 0.4; // le logo s'efface juste avant l'arrivée du téléphone
function drawBrand(t) {
  const R0 = T.logo, reveal = t >= R0 - 0.05 && t <= LOGO_OUT + 0.45, cta = t >= T.final;
  if (!vis($("brand"), reveal || cta)) return;
  const box = $("logoBox"), img = box.querySelector("img"), shine = $("logoShine");
  let cx, cy, sc, t0, op = 1, exitY = 0;
  const [sx, sy] = shake(t);
  if (reveal) {
    cx = 540; cy = 960; t0 = R0;
    const x = eIn(P(t, LOGO_OUT, LOGO_OUT + 0.4)); op = 1 - x; exitY = -180 * x;
    sc = lerp(1.12, 1, eOut(P(t, R0, R0 + 0.8))) * (1 - 0.25 * x) * (1 + 0.05 * (1 - eOut(P(t, R0, R0 + 0.35))));
    vis(ringG.parentElement, true);
    css(ringG.parentElement, "opacity", op.toFixed(3));
    const ru = eIO(P(t, R0, R0 + 0.7)), ru2 = eIO(P(t, R0 + 0.1, R0 + 0.95));
    ringG.setAttribute("transform", `translate(${f2(540 + sx)} ${f2(960 + exitY + sy)}) rotate(${f2((t - R0) * 8)}) scale(${(1 - 0.25 * x).toFixed(4)})`);
    ring1.setAttribute("stroke-dashoffset", C1 * (1 - ru)); ring2.setAttribute("stroke-dashoffset", C2 * (1 - ru2));
    DOTS.forEach((p, i) => DOTEL[i].setAttribute("r", f2(ru >= p.f ? 7 * eBack(P(t, R0 + 0.7 * p.f, R0 + 0.25 + 0.7 * p.f)) : 0)));
    LINES.forEach((l) => l.setAttribute("opacity", (0.4 * P(t, R0 + 0.5, R0 + 0.9)).toFixed(3)));
  } else {
    vis(ringG.parentElement, false);
    cx = 540; cy = 400; t0 = T.final + 0.05; sc = 0.92 * lerp(1.12, 1, eOut(P(t, t0, t0 + 0.7))) * (1 + 0.012 * Math.sin((t - t0) * 2));
  }
  const wipe = eOut(P(t, t0 + 0.02, t0 + 0.42));
  css(box, "transform", `translate(${f2(cx - 300 + sx)}px, ${f2(cy + exitY - 93 + sy)}px) scale(${sc.toFixed(4)})`);
  css(box, "opacity", op.toFixed(3));
  css(img, "clipPath", `inset(0 ${f2(100 - 100 * wipe)}% 0 0)`);
  css(img, "filter", `blur(${f2(10 * (1 - eOut(P(t, t0, t0 + 0.3))))}px) drop-shadow(0 0 28px rgba(124,92,235,.9))`);
  const su = P(t, t0 + 0.5, t0 + 1.1);
  css(shine, "backgroundPosition", `${f2(100 - 100 * su)}% 0`);
  css(shine, "opacity", su > 0 && su < 1 ? "1" : "0");
}

// ---------- iPhone : écrans réels et maquettes, défilement, zones mises en avant, superpositions, tapotements ----------
const phone = $("phone"), PG = TL.PAGES.map((p) => ({ ...p, el: $(`pg-${p.id}`), pc: $(`pg-${p.id}`).querySelector(".pc"), ovl: $(`ovl-${p.id}`) }));
const IDX = Object.fromEntries(TL.PAGES.map((p, i) => [p.id, i]));
const POPS = TL.POPS.map((p) => {
  const d = document.createElement("div"); const [x0, y0, x1, y1] = p.box;
  d.className = "pop";
  Object.assign(d.style, { left: `${18 + x0 * S}px`, top: "0px", width: `${(x1 - x0) * S}px`, height: `${(y1 - y0) * S}px`, backgroundImage: `url("${PG[IDX[p.page]].pc.src}")`, backgroundPosition: `${-x0 * S}px ${-y0 * S}px` });
  let arc = null;
  if (p.ring) {
    d.style.borderRadius = "50%";
    const sz = (x1 - x0) * S + 22, r = sz / 2 - 3, svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", sz); svg.setAttribute("height", sz); Object.assign(svg.style, { position: "absolute", left: "-11px", top: "-11px", overflow: "visible" });
    arc = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ cx: sz / 2, cy: sz / 2, r, fill: "none", stroke: "#F3E2B3", "stroke-width": 3, "stroke-linecap": "round", "stroke-dasharray": 2 * Math.PI * r, transform: `rotate(-90 ${sz / 2} ${sz / 2})` })) arc.setAttribute(k, v);
    arc.dataset.c = 2 * Math.PI * r; svg.appendChild(arc); d.appendChild(svg);
  }
  $("pops").appendChild(d); return { p, d, arc };
});
const OV = TL.OVERLAYS.map((o, i) => ({ ...o, el: $(`ov${i}`), b: $(`ov${i}`).querySelector("b") }));
function camPhone(t) {
  const K = TL.CAM, keys = ["fx", "fy", "k", "X", "Y", "rx", "ry"];
  if (t <= K[0].t) return K[0];
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1];
    if (t <= b.t) {
      const lin = P(t, a.t, b.t), u = b.ease === "in" ? eIn(lin) : b.ease === "out" ? eOut(lin) : b.Y - a.Y > 800 ? eIn(lin) : a.Y - b.Y > 800 ? eOut(lin) : eIO(lin);
      return Object.fromEntries(keys.map((k) => [k, lerp(a[k], b[k], u)]));
    }
  }
  return K[K.length - 1];
}
const scrollOf = (id, t) => kf(t, TL.SCROLL[id]);
const FLY = TL.FLY.map((f, i) => ({ ...f, el: $(`fl${i}`), cv: $(`cv${i}`) }));
function drawOverlays(t, pos) {
  for (const o of OV) {
    if (Math.abs(pos - IDX[o.page]) >= 1 || t < o.t0 || t > o.t1) { vis(o.el, false); continue; }
    vis(o.el, true);
    const u = P(t, o.t0, o.t0 + 0.35), v = P(t, o.t1 - 0.2, o.t1);
    if (o.kind === "pop") { css(o.el, "transform", `scale(${(lerp(0.6, 1, eBack(u)) * (1 - 0.1 * v)).toFixed(4)})`); css(o.el, "opacity", (P(t, o.t0, o.t0 + 0.1) * (1 - v)).toFixed(3)); }
    else if (o.kind === "fade") { const w = eOut(P(t, o.t0, o.t0 + 0.4)); css(o.el, "transform", `translateY(${f2(8 * (1 - w))}px)`); css(o.el, "opacity", (w * (1 - v)).toFixed(3)); }
    else if (o.kind === "hl") { css(o.el, "opacity", bump(t, o.t0, o.t0 + 0.15, o.t1 - 0.3, o.t1).toFixed(3)); }
    else if (o.kind === "type") {
      const n = Math.floor(o.text.length * P(t, o.t0, o.t0 + o.d)), done = t >= o.t0 + o.d + 0.8;
      html(o.el, esc(o.text.slice(0, n)) + (done ? "" : `<span class="caret" style="opacity:${Math.floor(t * 2.5) % 2 ? 0 : 1}"></span>`));
    }
    else if (o.kind === "count") {
      const [a, b, ta, d] = o.count; html(o.b, String(Math.round(lerp(a, b, eOut(P(t, ta, ta + d))))));
      css(o.el, "transform", `scale(${lerp(1, 1.5, eBack(u)).toFixed(4)})`); css(o.el, "opacity", (P(t, o.t0, o.t0 + 0.1) * (1 - v)).toFixed(3));
    }
    else if (o.kind === "heart") {
      const w = P(t, o.t0, o.t0 + 0.9);
      css(o.el, "transform", `translate(${f2(10 * Math.sin(w * 6 + o.t0))}px, ${f2(-150 * w)}px) scale(${(0.6 + 0.7 * w).toFixed(3)})`); css(o.el, "opacity", (P(t, o.t0, o.t0 + 0.1) * (1 - w)).toFixed(3));
    }
  }
}
function drawPhone(t) {
  const layer = $("phoneLayer");
  if (!vis(phone, t >= T.phoneIn && t <= T.phoneOut + 0.75)) return;
  const [sx, sy] = shake(t), pu = 1 + punch(t);
  let vx = 0, vy = 0;
  for (const v of TL.VIBRATE) if (t >= v && t < v + 0.28) { const k = 9 * (1 - P(t, v, v + 0.28)); vx += k * Math.sin(t * 150); vy += k * 0.4 * Math.cos(t * 170); }
  css(layer, "transform", `translate(${f2(sx + vx)}px, ${f2(sy + vy)}px) scale(${pu.toFixed(4)})`);
  const c = camPhone(t), lx = 18 + c.fx * S, ly = 18 + c.fy * S, tx = c.X - lx, ty = c.Y - ly;
  const sway = 1.5 * Math.sin(t * 0.9);
  css(phone, "transform", `translate(${f2(tx)}px, ${f2(ty)}px) translate(${f2(lx)}px, ${f2(ly)}px) scale(${c.k.toFixed(4)}) rotateX(${f2(c.rx)}deg) rotateY(${f2(c.ry + sway)}deg) translate(${f2(-lx)}px, ${f2(-ly)}px)`);
  css(phone, "opacity", (P(t, T.phoneIn, T.phoneIn + 0.15) * (1 - P(t, T.phoneOut + 0.3, T.phoneOut + 0.65))).toFixed(3));
  const pos = TL.SWITCH.reduce((n, ts) => n + eIO(P(t, ts, ts + 0.24)), 0);
  PG.forEach((p, i) => {
    const dx = (i - pos) * 600;
    if (!vis(p.el, Math.abs(dx) < 600)) return;
    css(p.el, "transform", `translateX(${f2(dx)}px)`);
    const sc = `translateY(${f2(-scrollOf(p.id, t) * S)}px)`;
    css(p.pc, "transform", sc); css(p.ovl, "transform", sc);
  });
  drawOverlays(t, pos);
  // écran de veille, puis réveil par la notification
  const L = TL.LOCK, la = P(t, L.off, L.off + 0.15) * (1 - P(t, L.out, L.out + 0.15));
  if (vis($("lock"), la > 0.002)) { css($("lock"), "opacity", la.toFixed(3)); css($("lockwall"), "opacity", P(t, L.on, L.on + 0.2).toFixed(3)); }
  css($("sheen"), "backgroundPosition", `${f2(50 + (c.ry + sway) * 5)}% 0`);
  const cur = Math.round(pos);
  // photos du pull : elles volent jusqu'à leur emplacement, l'emplacement se découvre à l'arrivée
  const scs = scrollOf("studio", t);
  for (const f of FLY) {
    const land = f.t + 0.42, top = (f.slot[1] - scs) * S - 3;
    css(f.cv, "top", `${f2(top)}px`); css(f.cv, "opacity", (1 - P(t, land - 0.02, land + 0.08)).toFixed(3));
    if (!vis(f.el, t >= f.t - 0.05 && t <= land + 0.12 && cur === IDX.studio)) continue;
    const u = eOut(P(t, f.t, land)), x1 = 18 + f.slot[0] * S, y1 = 18 + (f.slot[1] - scs) * S, x0 = f.from[0], y0 = f.from[1];
    const s = lerp(2.3, 1, u), r = lerp(f.from[2], 0, u);
    css(f.el, "transform", `translate(${f2(lerp(x0, x1, u))}px, ${f2(lerp(y0, y1, u))}px) rotate(${f2(r)}deg) scale(${s.toFixed(4)})`);
    css(f.el, "transformOrigin", "0 0");
    css(f.el, "opacity", (P(t, f.t - 0.05, f.t + 0.05) * (1 - P(t, land + 0.02, land + 0.12))).toFixed(3));
  }
  for (const { p, d, arc } of POPS) {
    const i = IDX[p.page];
    if (!vis(d, t >= p.t0 && t <= p.t1 && i === cur && Math.abs(pos - cur) < 0.01)) continue;
    const u = P(t, p.t0, p.t0 + 0.35), v = P(t, p.t1 - 0.25, p.t1), g = eOut(u) * (1 - v);
    const pulse = p.pulse ? 0.03 * Math.sin((t - p.t0) * 9) * P(t, p.t0 + 0.35, p.t0 + 0.5) : 0;
    const scl = 1 + (p.s - 1) * eBack(u) * (1 - eIO(v)) + pulse, top = 18 + (p.box[1] - scrollOf(p.page, t)) * S;
    css(d, "top", `${f2(top)}px`);
    css(d, "transform", `translateY(${f2(-6 * g)}px) scale(${scl.toFixed(4)})`);
    css(d, "boxShadow", `0 0 0 3.5px rgba(226,198,124,${g.toFixed(3)}), 0 0 40px rgba(226,198,124,${(0.6 * g).toFixed(3)}), 0 ${f2(26 * g)}px ${f2(54 * g)}px rgba(0,0,0,${(0.55 * g).toFixed(3)})`);
    if (arc) { const cc = +arc.dataset.c; arc.setAttribute("stroke-dashoffset", f2(cc * (1 - p.ring * eIO(P(t, p.t0 + 0.15, p.t0 + 0.85))))); arc.style.opacity = (1 - v).toFixed(3); }
  }
  const tap = TL.TAPS.find((k) => t >= k.t - 0.4 && t <= k.t + 0.5);
  if (vis($("tap"), !!tap) && tap) {
    const x = 18 + tap.x * S, y = 18 + (tap.y - scrollOf(tap.page, t)) * S, u = eOut(P(t, tap.t - 0.4, tap.t - 0.1));
    const press = t >= tap.t && t < tap.t + 0.12 ? 0.82 : 1;
    css($("tap"), "transform", `translate(${f2(x + 70 * (1 - u))}px, ${f2(y + 110 * (1 - u))}px) scale(${press})`);
    css($("tap"), "opacity", (P(t, tap.t - 0.4, tap.t - 0.3) * (1 - P(t, tap.t + 0.3, tap.t + 0.5))).toFixed(3));
    const r = P(t, tap.t, tap.t + 0.45);
    vis($("ripple"), r > 0 && r < 1);
    css($("ripple"), "transform", `translate(${f2(x)}px, ${f2(y)}px) scale(${(1 + 2.2 * eOut(r)).toFixed(3)})`);
    css($("ripple"), "opacity", (1 - r).toFixed(3));
  } else vis($("ripple"), false);
}

// ---------- Notification de Selio Radar (sur l'écran de veille) ----------
function drawAlert(t) {
  const A = TL.ALERT, el = $("alert");
  if (!(t >= A.t0 && t <= A.t1)) { vis(el, false); vis($("tap3"), false); vis($("ripple3"), false); return; }
  const u = P(t, A.t0, A.t0 + 0.4), v = eIn(P(t, A.t1 - 0.3, A.t1));
  const press = t >= A.tap && t < A.tap + 0.12 ? 0.97 : 1;
  place2d(el, { x: 540, y: lerp(A.y - 300, A.y, eBack(u)) - 260 * v, s: lerp(0.9, 1, eOut(u)) * press, o: P(t, A.t0, A.t0 + 0.1) * (1 - v), b: 0, r: 0 }, SIZES.alert[0] / 2, SIZES.alert[1] / 2);
  const x = 700, y = A.y + 20, tu = eOut(P(t, A.tap - 0.4, A.tap - 0.1));
  if (vis($("tap3"), t >= A.tap - 0.4 && t <= A.tap + 0.45)) {
    css($("tap3"), "transform", `translate(${f2(x + 70 * (1 - tu))}px, ${f2(y + 120 * (1 - tu))}px) scale(${t >= A.tap && t < A.tap + 0.12 ? 0.82 : 1})`);
    css($("tap3"), "opacity", (P(t, A.tap - 0.4, A.tap - 0.3) * (1 - P(t, A.tap + 0.25, A.tap + 0.45))).toFixed(3));
  }
  const r = P(t, A.tap, A.tap + 0.45);
  if (vis($("ripple3"), r > 0 && r < 1)) { css($("ripple3"), "transform", `translate(${x}px, ${y}px) scale(${(1 + 2.2 * eOut(r)).toFixed(3)})`); css($("ripple3"), "opacity", (1 - r).toFixed(3)); }
}

// ---------- Cartes flottantes ----------
const FC = TL.FCHIPS.map((c, i) => ({ ...c, el: $(`fc${i}`), val: $(`fcv${i}`) }));
function drawFchips(t) {
  for (const c of FC) {
    if (!(t >= c.t0 && t <= c.t1)) { vis(c.el, false); continue; }
    const u = P(t, c.t0, c.t0 + 0.35), v = P(t, c.t1 - 0.2, c.t1);
    if (c.count) { const [a, b, t0, d] = c.count; html(c.val, eur(lerp(a, b, eOut(P(t, t0, t0 + d))))); }
    place2d(c.el, { x: c.x, y: c.y + 40 * (1 - eOut(u)) - 24 * v + 6 * Math.sin(t * 2 + c.x), r: 0, s: lerp(0.8, 1, eBack(u)), o: P(t, c.t0, c.t0 + 0.12) * (1 - v), b: 6 * v }, c.w / 2, c.h / 2);
  }
}

// ---------- Final : carrousel des écrans, bouton, lien ----------
const CC = TL.CAROUSEL.map((_, i) => $(`cc${i}`));
function drawCta(t) {
  const car = $("carousel"), [sx, sy] = shake(t), C0 = T.phoneOut + 0.1, D0 = T.btn - 0.8;
  if (vis(car, t >= C0)) {
    const R = 560 * eOut(P(t, C0, C0 + 0.55)), th = 15 + (t - C0) * 30 + 140 * eIO(P(t, D0 - 0.2, D0 + 0.6));
    const down = eIO(P(t, D0, D0 + 0.7)), sc = lerp(0.6, 1, eOut(P(t, C0, C0 + 0.55))) * lerp(1, 0.7, down);
    css(car, "transform", `translate(${f2(sx)}px, ${f2(340 * down + sy)}px) rotateX(${f2(-9 + 5 * down)}deg) rotateY(${f2(th)}deg) scale(${sc.toFixed(4)})`);
    css(car, "opacity", P(t, C0, C0 + 0.2).toFixed(3));
    CC.forEach((el, i) => {
      const a = i * 45, face = Math.cos(((th + a) * Math.PI) / 180);
      css(el, "transform", `rotateY(${a}deg) translateZ(${f2(R)}px)`);
      css(el, "filter", `brightness(${(0.62 + 0.55 * Math.max(0, face)).toFixed(3)})`);
      css(el, "boxShadow", `0 30px 70px rgba(0,0,0,.5), 0 0 ${f2(50 * Math.max(0, face) ** 4)}px rgba(124,92,235,.8)`);
    });
  }
  const lay = $("cta");
  if (!vis(lay, t >= T.btn - 0.2)) return;
  const bu = P(t, T.btn, T.btn + 0.4), press = t >= T.tap && t < T.tap + 0.12 ? 0.95 : 1;
  const pulse = 0.03 * Math.sin(2 * Math.PI * (t - T.btn - 0.4) * 1.1) * P(t, T.btn + 0.4, T.btn + 0.65);
  place2d($("btn"), { x: 540, y: 1030, r: 0, s: (lerp(0.5, 1, eBack(bu)) + pulse) * press, o: P(t, T.btn, T.btn + 0.1), b: 0 }, SIZES.btn[0] / 2, SIZES.btn[1] / 2);
  const ph = ((t - T.btn - 0.6) % 1.8) / 1.8;
  css($("shine"), "left", `${f2(-160 + 1100 * ph)}px`); css($("shine"), "opacity", t > T.btn + 0.6 && ph < 0.7 ? "1" : "0");
  const iu = eOut(P(t, T.bio, T.bio + 0.3));
  place2d($("bio"), { x: 540, y: 1160 + 20 * (1 - iu), r: 0, s: 1, o: iu, b: 0 }, SIZES.bio[0] / 2, SIZES.bio[1] / 2);
  css($("bio").querySelector("svg"), "transform", `translateY(${f2(5 * Math.sin((t - T.bio) * 6))}px)`);
  place2d($("legal"), { x: 540, y: 1268, r: 0, s: 1, o: 0.9 * P(t, T.btn + 0.5, T.btn + 0.9), b: 0 }, SIZES.legal[0] / 2, SIZES.legal[1] / 2);
  const tu = eOut(P(t, T.tap - 0.4, T.tap - 0.1));
  if (vis($("tap2"), t >= T.tap - 0.4 && t <= T.tap + 0.5)) {
    css($("tap2"), "transform", `translate(${f2(640 + 90 * (1 - tu))}px, ${f2(1045 + 140 * (1 - tu))}px) scale(${t >= T.tap && t < T.tap + 0.12 ? 0.82 : 1})`);
    css($("tap2"), "opacity", (P(t, T.tap - 0.4, T.tap - 0.3) * (1 - P(t, T.tap + 0.3, T.tap + 0.5))).toFixed(3));
  }
  const r = P(t, T.tap, T.tap + 0.45);
  if (vis($("ripple2"), r > 0 && r < 1)) { css($("ripple2"), "transform", `translate(640px, 1045px) scale(${(1 + 2.4 * eOut(r)).toFixed(3)})`); css($("ripple2"), "opacity", (1 - r).toFixed(3)); }
}

// ---------- Image complète ----------
const SIZES = {};
const flashAt = (t, t0, a, d) => (t >= t0 ? a * Math.pow(Math.max(0, 1 - (t - t0) / d), 1.5) : 0);
function seek(t) {
  drawBg(t);
  drawHook(t);
  drawFx(t);
  drawCta(t);
  drawBrand(t);
  drawPhone(t);
  drawAlert(t);
  drawFchips(t);
  drawCaps(t);
  drawChip(t);
  css($("dark"), "opacity", (0.85 * (1 - P(t, 0, 0.15)) + 0.9 * P(t, T.dark, TL.DURATION)).toFixed(3));
  const f = Math.max(flashAt(t, T.logo, 0.95, 0.45), flashAt(t, T.final, 0.5, 0.35), flashAt(t, 2.1, 0.22, 0.2), flashAt(t, 2.9, 0.22, 0.2), flashAt(t, 3.7, 0.22, 0.2), flashAt(t, 61.8, 0.25, 0.25));
  css($("flash"), "opacity", f.toFixed(3));
  drawGrain(t);
}

window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  for (const c of FC) { c.el.style.display = ""; c.el.style.transform = "none"; c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
  $("cta").style.display = "";
  for (const id of ["btn", "bio", "legal", "alert"]) { const e = $(id); e.style.display = ""; e.style.transform = "none"; SIZES[id] = [e.offsetWidth, e.offsetHeight]; }
  return true;
})();
window.seek = seek;
