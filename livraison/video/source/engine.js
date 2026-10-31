// Moteur d'animation v2, déterministe : seek(t) place chaque élément pour l'instant t (secondes).
const W = 1080, H = 1920, CX = 540, CY = 960, S = 600 / 1179, FOCAL = 1700, FREEZE = 11.5;
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
// Images clés : [[t, valeur], …] ; interpolation adoucie entre deux clés.
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

// ---------- Caméra de la scène 3D (actes 1 à 4) ----------
function camWorld(t) {
  const tf = Math.min(t, FREEZE);
  let rx = kf(tf, [[0, 0], [3, 3], [9.8, 2], [11.5, 1]]), ry = kf(tf, [[0, 0], [3, -4], [9.8, 5], [11.5, 6]]), tz = kf(tf, [[0, 0], [3, -40], [9.8, 120], [11.5, 170]]);
  if (t > FREEZE) { const u = eIO(P(t, FREEZE, 14)); tz = lerp(170, -220, u); ry = lerp(6, 9, u); rx = lerp(1, -1, u); }
  let jx = 0, jy = 0;
  for (const w of TL.WINS) { const a = 12 * (1 - P(tf, w.tIn + 0.3, w.tIn + 0.5)) * (tf >= w.tIn + 0.3 ? 1 : 0); jx += a * Math.sin(tf * 110 + w.tIn); jy += a * Math.cos(tf * 97 + w.tIn); }
  if (tf > 9.85) { const a = lerp(4, 16, P(tf, 9.85, FREEZE)); jx += a * wob(tf * 9, 3); jy += a * wob(tf * 8, 7); }
  return { rx, ry, tz, jx, jy };
}
const project = (x, y, z, cam) => { const f = FOCAL / (FOCAL - (z + cam.tz)); return [CX + (x - CX) * f + cam.jx, CY + (y - CY) * f + cam.jy, f]; };

// ---------- Fenêtres d'applis ----------
const WIN = TL.WINS.map((w, i) => ({ ...w, i, el: $(`w-${w.id}`) }));
function winPose(w, t) {
  const tf = Math.min(t, FREEZE);
  if (tf < w.tIn) return null;
  const u = P(tf, w.tIn, w.tIn + 0.45), e = eOut(P(tf, w.tIn, w.tIn + 0.4));
  let x = w.x + w.from[0] * (1 - e), y = w.y + w.from[1] * (1 - e), z = w.z, rz = w.rz + w.from[3] * (1 - e), rx = w.rx, ry = w.ry;
  let s = lerp(0.72, 1, eBack(u)), o = P(tf, w.tIn, w.tIn + 0.08);
  y += 6 * Math.sin(tf * 1.3 + w.i); rz += 0.8 * Math.sin(tf * 0.9 + w.i * 1.7); ry += 2 * Math.sin(tf * 0.7 + w.i);
  let push = 0;
  for (const v of WIN) if (v.i > w.i) push += eOut(P(tf, v.tIn, v.tIn + 0.5));
  if (w.focus) { const f = bump(tf, w.focus[0], w.focus[0] + 0.25, w.focus[1], w.focus[1] + 0.25); push *= 1 - f; z += 140 * f; }
  const surge = eOut(P(tf, 9.85, 10.3));
  push *= 1 - surge;
  z += -150 * push + 40 * surge * hash(w.i + 3);
  const b = Math.min(7, 2.3 * push);
  o *= 1 - Math.min(0.45, 0.09 * push);
  if (tf > 9.85) { const a = lerp(3, 14, P(tf, 9.85, FREEZE)); x += a * wob(tf * 9, w.i * 3.1); y += a * wob(tf * 8.3, w.i * 1.7 + 5); rz += a * 0.25 * wob(tf * 6, w.i); }
  return suction({ x, y, z, rx, ry, rz, s, o, b }, t, w.i);
}
function suction(st, t, k) {
  if (t < 14) return st;
  const u = P(t, 14 + k * 0.022, 14.46 + k * 0.002);
  if (u >= 1) return null;
  const e = Math.pow(u, 2.1), dx = st.x - CX, dy = st.y - CY, r0 = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx), rr = r0 * (1 - e), a = a0 + e * 2.8;
  return { ...st, x: CX + rr * Math.cos(a), y: CY + rr * Math.sin(a), z: (st.z ?? 0) * (1 - e), s: st.s * (1 - 0.9 * e), rz: (st.rz ?? st.r ?? 0) + e * 300, r: (st.r ?? 0) + e * 300, o: st.o * (1 - P(u, 0.7, 1)), b: 0 };
}
function placeWin(w, st) {
  if (!vis(w.el, !!st && st.o > 0.002)) return;
  css(w.el, "transformOrigin", `${w.w / 2}px ${w.h / 2}px`);
  css(w.el, "transform", `translate3d(${f2(st.x - w.w / 2)}px, ${f2(st.y - w.h / 2)}px, ${f2(st.z)}px) rotateX(${f2(st.rx)}deg) rotateY(${f2(st.ry)}deg) rotateZ(${f2(st.rz)}deg) scale(${st.s.toFixed(4)})`);
  css(w.el, "opacity", clamp(st.o).toFixed(3));
  css(w.el, "filter", st.b > 0.05 ? `blur(${f2(st.b)}px)` : "none");
}
// Carte du pull dans l'accroche, qui devient la photo de l'annonce Vinted.
function hookPose(t) {
  if (t < 1.55 || t > 3.25) return null;
  const u = P(t, 1.55, 2.0), v = eIO(P(t, 2.95, 3.25));
  return { x: lerp(540, 300, v), y: lerp(1250 + 70 * (1 - eOut(u)), 800, v), z: lerp(120, 150, v), rx: lerp(8, 4, v), ry: lerp(16 * Math.sin(t * 1.5), 12, v), rz: lerp(-3, -2, v), s: lerp(0.5, 1, eBack(u)) * lerp(1, 1.15, v), o: P(t, 1.55, 1.65) * (1 - P(t, 3.08, 3.2)), b: 0 };
}

// ---------- Contenu vivant des fenêtres ----------
const typed = (txt, t, a, b) => txt.slice(0, Math.floor(txt.length * P(t, a, b)));
const CARET = '<span class="caret"></span>';
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function contents(t) {
  const tf = Math.min(t, FREEZE);
  // Vinted
  html($("vlikes"), String(14 + Math.floor(9 * P(tf, 3.4, 11.4))));
  const pasted = tf >= 9.3;
  html($("vdesc"), pasted ? "Joli pull marine à pois blancs, très bon état, porté deux fois. Maille douce, coupe classique." : "Ajoute une description…");
  $("vdesc").className = pasted ? "vdesc full" : "vdesc";
  html($("voff"), tf >= 10.95 ? "5" : "3");
  menuPose($("m-paste"), tf, 9.22, 9.62);
  // Excel
  TL.EXCEL_ROWS.forEach((r, i) => r.forEach((v, c) => {
    const k = i * 5 + c, on = tf >= 4.3 + k * 0.016, el = $(`x${i}-${c}`);
    const err = c === 4 && tf >= 4.88 + i * 0.035;
    html(el, err ? "#REF!" : on ? v : "");
    el.className = `${c ? "n" : ""}${err ? " err" : ""}${!err && on && tf < 4.3 + (k + 1) * 0.016 ? " sel" : ""}`;
  }));
  const row = Math.min(6, Math.floor(P(tf, 4.3, 4.78) * 6) + 2);
  html($("xfx"), tf >= 4.78 ? "=SOMME(E2:E48)" : tf >= 4.3 ? `=C${row}-B${row}-D${row}` : "");
  html($("xtot"), tf >= 4.85 ? "#REF!" : "");
  $("xtot").className = tf >= 4.85 ? "n tot err" : "n tot";
  // Calculatrice
  const steps = [[5.2, "18"], [5.3, "18 − 4,5"], [5.42, "18 − 4,5 − 2,88"], [5.55, "10,62"]];
  let d = "0"; for (const [ts, v] of steps) if (tf >= ts) d = v;
  html($("cdisp"), d); css($("cdisp"), "fontSize", d.length > 9 ? "34px" : "46px");
  const press = { 11: [5.3, 5.42], 19: [5.55], 12: [5.22], 13: [5.25], 16: [5.36] };
  for (let k = 0; k < 20; k++) $(`ck${k}`).classList.toggle("on", (press[k] ?? []).some((ts) => tf >= ts && tf < ts + 0.09));
  // Discord : les messages arrivent et la liste remonte
  const n = Math.max(0, (tf - 6.15) / 0.13);
  TL.DISCORD.forEach((_, i) => { const el = $(`dm${i}`); css(el, "opacity", i < n ? String(clamp((n - i) * 3)) : "0"); });
  css($("dlist"), "transform", `translateY(${f2(-Math.max(0, n * 70 - 330))}px)`);
  // WhatsApp
  TL.WA.forEach(([ts], i) => { const el = $(`wa${i}`); if (vis(el, tf >= ts)) css(el, "transform", `scale(${lerp(0.7, 1, eBack(P(tf, ts, ts + 0.25))).toFixed(3)})`); });
  // ChatGPT
  html($("gq"), esc(typed(TL.GPT_Q, tf, 7.6, 7.95)) + (tf < 7.97 && tf >= 7.6 ? CARET : ""));
  css($("gq"), "visibility", tf >= 7.6 ? "visible" : "hidden");
  const ans = typed(TL.GPT_A, tf, 7.98, 8.8);
  html($("ga"), tf >= 8.85 ? `<span class="sel">${esc(TL.GPT_A)}</span>` : esc(ans) + (tf >= 7.98 ? CARET : ""));
  menuPose($("m-copy"), tf, 8.85, 9.12);
  // Gemini
  html($("gemtxt"), esc(typed(TL.GEM_A, tf, 8.32, 9.05)) + (tf >= 8.32 && tf < 9.2 ? CARET : ""));
  // Photos : la galerie défile
  css($("phin"), "transform", `translateY(${f2(-Math.max(0, tf - 9.4) * 320)}px)`);
  // Notes
  let acc = 9.95;
  TL.NOTES.forEach((l, i) => { const dur = 0.05 + l.length * 0.006; html($(`nl${i}`), esc(typed(l, tf, acc, acc + dur))); acc += dur + 0.04; });
}
function menuPose(el, tf, t0, t1) {
  if (!vis(el, tf >= t0 && tf <= t1)) return;
  css(el, "transform", `scale(${lerp(0.6, 1, eBack(P(tf, t0, t0 + 0.2))).toFixed(3)})`);
  css(el, "opacity", (P(tf, t0, t0 + 0.06) * (1 - P(tf, t1 - 0.1, t1))).toFixed(3));
}

// ---------- Notifications de la surcharge ----------
const NT = TL.NOTIFS.map((n, i) => ({ ...n, i, el: $(`nt${i}`) }));
function notifPose(n, t) {
  const tf = Math.min(t, FREEZE);
  if (tf < n.tIn) return null;
  const u = eOut(P(tf, n.tIn, n.tIn + 0.26));
  let x = n.x, y = n.y - 90 * (1 - u), r = n.rot;
  if (tf > 9.85) { const a = lerp(2, 10, P(tf, 9.85, FREEZE)); x += a * wob(tf * 9, 20 + n.i); y += a * wob(tf * 8, 30 + n.i); }
  const st = suction({ x, y, z: 0, r, s: lerp(0.9, 1, u), o: P(tf, n.tIn, n.tIn + 0.1), b: 0 }, t, 9 + n.i);
  return st;
}

// ---------- Fond : halos mouvants, étoiles ; calque d'effets : traînées, particules, ondes ----------
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
  const te = t < FREEZE ? t : t < 14 ? FREEZE + (t - FREEZE) * 0.15 : t - 2.125;
  bg.fillStyle = "#0E0C13"; bg.fillRect(0, 0, W, H);
  blob(bg, 540 + 240 * Math.sin(te * 0.21), 150 + 70 * Math.sin(te * 0.17), 1050, 640, "100,66,214", 0.55);
  blob(bg, 220 + 140 * Math.sin(te * 0.15 + 1), 1450 + 120 * Math.sin(te * 0.2), 820, 620, "59,42,143", 0.42);
  blob(bg, 880 + 110 * Math.sin(te * 0.18 + 2), 1960, 900, 430, "193,147,59", 0.17);
  blob(bg, 540, 960, 900, 900, "124,92,235", 0.7 * bump(t, 14.2, 14.5, 15.6, 16.4));
  blob(bg, 540, 480, 820, 720, "124,92,235", 0.5 * P(t, 29.0, 29.8));
  for (const s of STARS) {
    const y = (((s.y - te * s.sp) % H) + H) % H;
    bg.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(te * 1.3 + s.ph));
    bg.fillStyle = s.g ? "#E2C67C" : "#FFFFFF";
    bg.beginPath(); bg.arc(s.x, y, s.r, 0, 6.2832); bg.fill();
  }
  bg.globalAlpha = 1;
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  fx.globalCompositeOperation = "lighter";
  // traînées lumineuses de l'aspiration
  if (t >= 14 && t < 14.6) {
    fx.lineCap = "round";
    const items = [...WIN.map((w) => (tt) => { const st = winPose(w, tt); if (!st) return null; const p = project(st.x, st.y, st.z, camWorld(tt)); return { x: p[0], y: p[1], s: st.s * p[2], o: st.o }; }), ...NT.map((n) => (tt) => notifPose(n, tt))];
    for (const f of items) {
      const pts = [];
      for (let j = 0; j < 10; j++) { const tt = t - j * 0.02; if (tt < 14) break; const p = f(tt); if (!p) break; pts.push(p); }
      for (let j = 0; j < pts.length - 1; j++) {
        fx.strokeStyle = `rgba(185,166,255,${(0.6 * (1 - j / 9) * pts[0].o).toFixed(3)})`;
        fx.lineWidth = Math.max(1.5, 22 * (1 - j / 9) * pts[j].s);
        fx.beginPath(); fx.moveTo(pts[j].x, pts[j].y); fx.lineTo(pts[j + 1].x, pts[j + 1].y); fx.stroke();
      }
    }
  }
  // particules : aspirées vers le centre, puis éclatent et gravitent autour du logo
  if (t >= 13.6 && t < 16.3) {
    for (const p of PART) {
      let r, a, al;
      if (t < 14.5) { const u = eIn(P(t, 13.6, 14.5)); r = p.r * (1 - u) + 10; a = p.a + (t - 13.6) * p.sp * 2.2; al = P(t, 13.6, 13.9) * 0.9; }
      else { const u = eOut(P(t, 14.5, 15.3)); r = lerp(10, p.orb + 200 * (1 - P(t, 14.5, 16)), u); a = p.a + (t - 14.5) * p.sp * 0.5; al = 1 - P(t, 15.5, 16.25); }
      const x = CX + r * Math.cos(a), y = CY + r * Math.sin(a) * 0.92;
      const g = fx.createRadialGradient(x, y, 0, x, y, p.sz * 4);
      g.addColorStop(0, `rgba(${p.c},${al})`); g.addColorStop(1, `rgba(${p.c},0)`);
      fx.fillStyle = g; fx.fillRect(x - p.sz * 4, y - p.sz * 4, p.sz * 8, p.sz * 8);
    }
  }
  // ondes de choc
  const ring = (t0, x, y, maxR, w0, a0) => { if (t < t0 || t > t0 + 0.8) return; const u = eOut(P(t, t0, t0 + 0.8)); fx.strokeStyle = `rgba(243,226,179,${(a0 * (1 - u)).toFixed(3)})`; fx.lineWidth = Math.max(1, w0 * (1 - u)); fx.beginPath(); fx.arc(x, y, 40 + maxR * u, 0, 6.2832); fx.stroke(); };
  ring(14.5, CX, CY, 1300, 26, 0.85); ring(14.6, CX, CY, 900, 12, 0.6); ring(31.3, 540, 430, 800, 18, 0.6);
  fx.globalCompositeOperation = "source-over";
}
// grain de pellicule
const gr = $("grain").getContext("2d");
const TILES = Array.from({ length: 4 }, (_, k) => { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"); const d = x.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(hash(i * 0.37 + k * 999) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; });
function drawGrain(t) {
  const f = Math.floor(t * 30), tile = TILES[f % 4], ox = Math.floor(hash(f) * 256), oy = Math.floor(hash(f + 5) * 256);
  for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) gr.drawImage(tile, x, y);
}

// ---------- Sous-titres karaoké ----------
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
    let dx = 0, sh = "0 6px 34px rgba(0,0,0,.6)", sc = 1;
    if (c.glitch && t > 11.0 && t < FREEZE) { const f = Math.floor(t * 30); if (hash(f) > 0.3) { const g = 5 + 10 * hash(f + 9); sh = `${g}px 0 rgba(255,40,90,.85), ${-g}px 0 rgba(0,220,255,.85)`; dx = (hash(f + 4) - 0.5) * 30; } }
    if (c.slam) sc = 1 + 0.045 * (Math.exp(-((t - 12.85) ** 2) / 0.004) + Math.exp(-((t - 13.62) ** 2) / 0.004));
    css(d, "textShadow", sh);
    css(d, "transform", `translate(${f2(dx)}px, ${f2(26 * (1 - a) - 20 * z)}px) scale(${sc.toFixed(4)})`);
    for (const w of spans) {
      const on = t >= w.t, col = w.st === "g" ? "#E2C67C" : w.st === "r" ? "#FF8F85" : "#FFFFFF", u = P(t, w.t, w.t + 0.18);
      css(w.s, "color", on ? col : "rgba(255,255,255,.28)");
      if (c.slam) { css(w.s, "transform", on ? `scale(${(1 + 0.35 * (1 - eOut(u))).toFixed(3)})` : "scale(1)"); css(w.s, "filter", on && u < 1 ? `blur(${f2(6 * (1 - eOut(u)))}px)` : "none"); }
      else { css(w.s, "transform", `translateY(${f2(on ? 12 * (1 - eOut(u)) : 12)}px)`); css(w.s, "filter", on && u < 1 ? `blur(${f2(5 * (1 - eOut(u)))}px)` : "none"); }
      css(w.s, "backgroundSize", w.st === "g" && on ? `${(100 * eOut(P(t, w.t + 0.05, w.t + 0.35))).toFixed(1)}% 30%` : "0% 30%");
    }
  }
  css($("capband"), "opacity", (bump(t, 2.9, 3.2, 11.45, 11.6) + bump(t, 15.95, 16.3, 28.9, 29.2)).toFixed(3));
}

// ---------- Compteur d'applis ----------
function drawChip(t) {
  const el = $("chip"); let cur = null, idx = -1;
  TL.CHIP.forEach((c, i) => { if (t >= c[0]) { cur = c; idx = i; } });
  if (!vis(el, !!cur)) return;
  html($("chipt"), cur[1]); el.className = cur[2];
  const u = P(t, cur[0], cur[0] + 0.3);
  const s = idx === 0 ? lerp(0.3, 1, eBack(u)) : 1 + 0.22 * (1 - eOut(u));
  let dx = 0, dy = 0; const tf = Math.min(t, FREEZE);
  if (t > 9.85 && t < 14) { const a = lerp(2, 9, P(tf, 9.85, FREEZE)); dx = a * wob(tf * 9, 40); dy = a * wob(tf * 8, 41); }
  css(el, "transform", `translate(${f2(dx)}px, ${f2(dy)}px) scale(${s.toFixed(4)})`);
  css(el, "opacity", idx === 0 ? P(t, cur[0], cur[0] + 0.1).toFixed(3) : "1");
}

// ---------- Logo Selio, constellation (révélation et final) ----------
const NS = "http://www.w3.org/2000/svg", ringG = $("ringg"), R1 = 300, R2 = 410, C1 = 2 * Math.PI * R1, C2 = 2 * Math.PI * R2;
const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); ringG.appendChild(e); return e; };
const DOTS = Array.from({ length: 8 }, (_, i) => { const a = (-90 + i * 45 + 12) * Math.PI / 180; return { x: R1 * Math.cos(a), y: R1 * Math.sin(a), f: (i * 45 + 12) / 360 }; });
const LINES = DOTS.map((p, i) => { const q = DOTS[(i + 3) % 8]; return mk("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: "#E2C67C", "stroke-width": 1.5, opacity: 0 }); });
const ring2 = mk("circle", { r: R2, fill: "none", stroke: "rgba(226,198,124,.35)", "stroke-width": 2, "stroke-dasharray": C2, transform: "rotate(-90)" });
const ring1 = mk("circle", { r: R1, fill: "none", stroke: "#E2C67C", "stroke-width": 3.5, "stroke-dasharray": C1, transform: "rotate(-90)" });
const DOTEL = DOTS.map((p) => mk("circle", { cx: p.x, cy: p.y, r: 0, fill: "#F3E2B3" }));
ringG.parentElement.style.filter = "drop-shadow(0 0 10px rgba(226,198,124,.8))";
function drawBrand(t) {
  const reveal = t >= 14.45 && t <= 16.3, cta = t >= 31.25;
  if (!vis($("brand"), reveal || cta)) return;
  const box = $("logoBox"), img = box.querySelector("img"), shine = $("logoShine");
  let cx, cy, sc, t0, op = 1, exitY = 0;
  if (reveal) {
    cx = 540; cy = 960; t0 = 14.5;
    const x = eIn(P(t, 15.85, 16.25)); op = 1 - x; exitY = -180 * x;
    sc = lerp(1.12, 1, eOut(P(t, 14.5, 15.3))) * (1 - 0.25 * x) * (1 + 0.05 * (1 - eOut(P(t, 14.5, 14.85))));
    vis(ringG.parentElement, true);
    css(ringG.parentElement, "opacity", op.toFixed(3));
    const ru = eIO(P(t, 14.5, 15.2)), ru2 = eIO(P(t, 14.6, 15.45));
    ringG.setAttribute("transform", `translate(540 ${960 + exitY}) rotate(${f2((t - 14.5) * 8)}) scale(${(1 - 0.25 * x).toFixed(4)})`);
    ring1.setAttribute("stroke-dashoffset", C1 * (1 - ru)); ring2.setAttribute("stroke-dashoffset", C2 * (1 - ru2));
    DOTS.forEach((p, i) => DOTEL[i].setAttribute("r", f2(ru >= p.f ? 7 * eBack(P(t, 14.5 + 0.7 * p.f, 14.75 + 0.7 * p.f)) : 0)));
    LINES.forEach((l) => l.setAttribute("opacity", (0.4 * P(t, 15.0, 15.4)).toFixed(3)));
  } else {
    vis(ringG.parentElement, false);
    cx = 540; cy = 430; t0 = 31.3; sc = 0.78 * lerp(1.12, 1, eOut(P(t, 31.3, 32.0))) * (1 + 0.012 * Math.sin((t - 31.3) * 2));
  }
  const wipe = eOut(P(t, t0 + 0.02, t0 + 0.42));
  css(box, "transform", `translate(${f2(cx - 300)}px, ${f2(cy + exitY - 93)}px) scale(${sc.toFixed(4)})`);
  css(box, "opacity", op.toFixed(3));
  css(img, "clipPath", `inset(0 ${f2(100 - 100 * wipe)}% 0 0)`);
  css(img, "filter", `blur(${f2(10 * (1 - eOut(P(t, t0, t0 + 0.3))))}px) drop-shadow(0 0 28px rgba(124,92,235,.9))`);
  const su = P(t, t0 + 0.5, t0 + 1.1);
  css(shine, "backgroundPosition", `${f2(100 - 100 * su)}% 0`);
  css(shine, "opacity", su > 0 && su < 1 ? "1" : "0");
}

// ---------- iPhone : vrais écrans, défilement, zones mises en avant, tapotements ----------
const phone = $("phone"), PG = TL.PAGES.map((p) => ({ ...p, el: $(`pg-${p.id}`), pc: $(`pg-${p.id}`).querySelector(".pc") }));
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
function camPhone(t) {
  const K = TL.CAM, keys = ["fx", "fy", "k", "X", "Y", "rx", "ry"];
  if (t <= K[0].t) return K[0];
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1];
    if (t <= b.t) { const lin = P(t, a.t, b.t), u = b.Y - a.Y > 800 ? eIn(lin) : a.Y - b.Y > 800 ? eOut(lin) : eIO(lin); return Object.fromEntries(keys.map((k) => [k, lerp(a[k], b[k], u)])); }
  }
  return K[K.length - 1];
}
const scrollOf = (id, t) => kf(t, TL.SCROLL[id]);
function drawPhone(t) {
  if (!vis(phone, t >= 15.9 && t <= 29.5)) return;
  const c = camPhone(t), lx = 18 + c.fx * S, ly = 18 + c.fy * S, tx = c.X - lx, ty = c.Y - ly;
  const sway = 1.5 * Math.sin(t * 0.9);
  css(phone, "transform", `translate(${f2(tx)}px, ${f2(ty)}px) translate(${f2(lx)}px, ${f2(ly)}px) scale(${c.k.toFixed(4)}) rotateX(${f2(c.rx)}deg) rotateY(${f2(c.ry + sway)}deg) translate(${f2(-lx)}px, ${f2(-ly)}px)`);
  css(phone, "opacity", (1 - P(t, 29.1, 29.45)).toFixed(3));
  const pos = TL.SWITCH.reduce((n, ts) => n + eIO(P(t, ts, ts + 0.24)), 0);
  PG.forEach((p, i) => {
    const dx = (i - pos) * 600;
    if (!vis(p.el, Math.abs(dx) < 600)) return;
    css(p.el, "transform", `translateX(${f2(dx)}px)`);
    css(p.pc, "transform", `translateY(${f2(-scrollOf(p.id, t) * S)}px)`);
  });
  css($("sheen"), "backgroundPosition", `${f2(50 + (c.ry + sway) * 5)}% 0`);
  const cur = Math.round(pos);
  for (const { p, d, arc } of POPS) {
    const i = IDX[p.page];
    if (!vis(d, t >= p.t0 && t <= p.t1 && i === cur && Math.abs(pos - cur) < 0.01)) continue;
    const u = P(t, p.t0, p.t0 + 0.35), v = P(t, p.t1 - 0.25, p.t1), g = eOut(u) * (1 - v);
    const pulse = p.pulse ? 0.03 * Math.sin((t - p.t0) * 8) * P(t, p.t0 + 0.35, p.t0 + 0.5) : 0;
    const sc = 1 + (p.s - 1) * eBack(u) * (1 - eIO(v)) + pulse, top = 18 + (p.box[1] - scrollOf(p.page, t)) * S;
    css(d, "top", `${f2(top)}px`);
    css(d, "transform", `translateY(${f2(-6 * g)}px) scale(${sc.toFixed(4)})`);
    css(d, "boxShadow", `0 0 0 3.5px rgba(226,198,124,${g.toFixed(3)}), 0 0 40px rgba(226,198,124,${(0.6 * g).toFixed(3)}), 0 ${f2(26 * g)}px ${f2(54 * g)}px rgba(0,0,0,${(0.55 * g).toFixed(3)})`);
    if (arc) { const cc = +arc.dataset.c; arc.setAttribute("stroke-dashoffset", f2(cc * (1 - p.ring * eIO(P(t, p.t0 + 0.15, p.t0 + 0.85))))); arc.style.opacity = (1 - v).toFixed(3); }
  }
  // tapotements
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
const FC = TL.FCHIPS.map((c, i) => ({ ...c, el: $(`fc${i}`) }));
function drawFchips(t) {
  for (const c of FC) {
    if (!(t >= c.t0 && t <= c.t1)) { vis(c.el, false); continue; }
    const u = P(t, c.t0, c.t0 + 0.35), v = P(t, c.t1 - 0.2, c.t1);
    place2d(c.el, { x: c.x, y: c.y + 40 * (1 - eOut(u)) - 24 * v + 6 * Math.sin(t * 2 + c.x), r: 0, s: lerp(0.8, 1, eBack(u)), o: P(t, c.t0, c.t0 + 0.12) * (1 - v), b: 6 * v }, c.w / 2, c.h / 2);
  }
}

// ---------- Final : carrousel des écrans, bouton, lien ----------
const CC = TL.CAROUSEL.map((_, i) => $(`cc${i}`));
function drawCta(t) {
  const car = $("carousel");
  if (vis(car, t >= 29.0 && t <= 31.4)) {
    const R = 560 * eOut(P(t, 29.0, 29.55)) * (1 - eIn(P(t, 30.85, 31.3))), th = 15 + (t - 29) * 42;
    const sc = lerp(0.6, 1, eOut(P(t, 29.0, 29.55))) * lerp(1, 0.15, eIn(P(t, 30.85, 31.3))), dy = -870 * eIn(P(t, 30.85, 31.3));
    css(car, "transform", `translateY(${f2(dy)}px) rotateX(-9deg) rotateY(${f2(th)}deg) scale(${sc.toFixed(4)})`);
    css(car, "opacity", (P(t, 29.0, 29.2) * (1 - P(t, 31.15, 31.35))).toFixed(3));
    CC.forEach((el, i) => {
      const a = i * 45, face = Math.cos(((th + a) * Math.PI) / 180);
      css(el, "transform", `rotateY(${a}deg) translateZ(${f2(R)}px)`);
      css(el, "filter", `brightness(${(0.5 + 0.6 * Math.max(0, face)).toFixed(3)})`);
      css(el, "boxShadow", `0 30px 70px rgba(0,0,0,.5), 0 0 ${f2(50 * Math.max(0, face) ** 4)}px rgba(124,92,235,.8)`);
    });
  }
  const lay = $("cta");
  if (!vis(lay, t >= 31.3)) return;
  const bu = P(t, 31.45, 31.85), press = t >= 33.3 && t < 33.42 ? 0.95 : 1;
  const pulse = 0.03 * Math.sin(2 * Math.PI * (t - 31.85) * 1.1) * P(t, 31.85, 32.1);
  place2d($("btn"), { x: 540, y: 1030, r: 0, s: (lerp(0.5, 1, eBack(bu)) + pulse) * press, o: P(t, 31.45, 31.55), b: 0 }, SIZES.btn[0] / 2, SIZES.btn[1] / 2);
  const ph = ((t - 32.0) % 1.8) / 1.8;
  css($("shine"), "left", `${f2(-160 + 1100 * ph)}px`); css($("shine"), "opacity", t > 32.0 && ph < 0.7 ? "1" : "0");
  const iu = eOut(P(t, 32.5, 32.8));
  place2d($("bio"), { x: 540, y: 1160 + 20 * (1 - iu), r: 0, s: 1, o: iu, b: 0 }, SIZES.bio[0] / 2, SIZES.bio[1] / 2);
  css($("bio").querySelector("svg"), "transform", `translateY(${f2(5 * Math.sin((t - 32.5) * 6))}px)`);
  place2d($("legal"), { x: 540, y: 1268, r: 0, s: 1, o: 0.9 * P(t, 31.9, 32.3), b: 0 }, SIZES.legal[0] / 2, SIZES.legal[1] / 2);
  // le doigt appuie sur le bouton
  const tu = eOut(P(t, 32.9, 33.2));
  if (vis($("tap2"), t >= 32.9 && t <= 33.8)) {
    css($("tap2"), "transform", `translate(${f2(640 + 90 * (1 - tu))}px, ${f2(1045 + 140 * (1 - tu))}px) scale(${t >= 33.3 && t < 33.42 ? 0.82 : 1})`);
    css($("tap2"), "opacity", (P(t, 32.9, 33.0) * (1 - P(t, 33.6, 33.8))).toFixed(3));
  }
  const r = P(t, 33.3, 33.75);
  if (vis($("ripple2"), r > 0 && r < 1)) { css($("ripple2"), "transform", `translate(640px, 1045px) scale(${(1 + 2.4 * eOut(r)).toFixed(3)})`); css($("ripple2"), "opacity", (1 - r).toFixed(3)); }
}

// ---------- Image complète ----------
const SIZES = {};
function seek(t) {
  drawBg(t);
  const scene = $("scene"), notifs = $("notifs");
  if (vis(scene, t <= 14.6)) {
    const cam = camWorld(t);
    css($("world"), "transform", `translate3d(${f2(cam.jx)}px, ${f2(cam.jy)}px, ${f2(cam.tz)}px) rotateX(${f2(cam.rx)}deg) rotateY(${f2(cam.ry)}deg)`);
    const hp = hookPose(t), hook = $("hook");
    if (vis(hook, !!hp)) { css(hook, "transform", `translate3d(${f2(hp.x - 190)}px, ${f2(hp.y - 248)}px, 0px) rotateX(${f2(hp.rx)}deg) rotateY(${f2(hp.ry)}deg) rotateZ(${f2(hp.rz)}deg) scale(${hp.s.toFixed(4)})`); css(hook, "opacity", hp.o.toFixed(3)); css(hook, "boxShadow", `0 50px 110px rgba(0,0,0,.6), 0 0 0 ${f2(4 * P(t, 2.38, 2.5))}px rgba(226,198,124,.9), 0 0 ${f2(60 * P(t, 2.38, 2.5))}px rgba(226,198,124,.6)`); }
    for (const w of WIN) placeWin(w, winPose(w, t));
    contents(t);
  }
  if (vis(notifs, t <= 14.6)) for (const n of NT) place2d(n.el, notifPose(n, t), n.w / 2, n.h / 2);
  // gel, glitch
  const fb = 14 * P(t, FREEZE, 11.85) * (1 - P(t, 14.0, 14.12)), gs = 0.75 * P(t, FREEZE, 11.85) * (1 - P(t, 14.0, 14.12));
  const fl = []; let gx = 0, scan = 0;
  if (t >= 11.0 && t < FREEZE) { const fr = Math.floor(t * 30); if (hash(fr) > 0.3) { const d = 6 + 12 * hash(fr + 7); fl.push(`drop-shadow(${f2(d)}px 0 0 rgba(255,40,90,.7)) drop-shadow(${f2(-d)}px 0 0 rgba(0,220,255,.7))`); gx = (hash(fr + 3) - 0.5) * 36; scan = 0.8; } }
  if (fb > 0.05) fl.push(`blur(${f2(fb)}px) grayscale(${gs.toFixed(3)})`);
  for (const el of [scene, notifs]) { css(el, "filter", fl.length ? fl.join(" ") : "none"); css(el, "transform", `translateX(${f2(gx)}px)`); }
  css($("scan"), "opacity", String(scan));
  drawFx(t);
  drawBrand(t);
  drawPhone(t);
  drawFchips(t);
  drawCta(t);
  drawCaps(t);
  drawChip(t);
  css($("redtint"), "opacity", (bump(t, 9.85, 10.3, FREEZE, 11.9) * (0.75 + 0.25 * Math.sin(t * 22))).toFixed(3));
  css($("dark"), "opacity", (0.6 * P(t, FREEZE, 11.85) * (1 - P(t, 14.0, 14.3))).toFixed(3));
  const f1 = t >= 14.5 ? 0.95 * Math.pow(Math.max(0, 1 - (t - 14.5) / 0.45), 1.5) : 0, f2v = t >= 31.3 ? 0.4 * Math.pow(Math.max(0, 1 - (t - 31.3) / 0.35), 1.5) : 0;
  css($("flash"), "opacity", Math.max(f1, f2v).toFixed(3));
  drawGrain(t);
}

window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  for (const n of NT) { n.el.style.display = ""; n.el.style.transform = "none"; n.w = n.el.offsetWidth; n.h = n.el.offsetHeight; }
  for (const c of FC) { c.el.style.display = ""; c.el.style.transform = "none"; c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
  $("cta").style.display = "";
  for (const id of ["btn", "bio", "legal"]) { const e = $(id); e.style.display = ""; e.style.transform = "none"; SIZES[id] = [e.offsetWidth, e.offsetHeight]; }
  return true;
})();
window.seek = seek;
