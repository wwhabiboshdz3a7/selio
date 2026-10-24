// Moteur d'animation déterministe : seek(t) place chaque élément pour l'instant t (secondes).
const W = 1080, H = 1920, CX = 540, CY = 960, S = 600 / 1179;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const P = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const eOut = (u) => 1 - Math.pow(1 - u, 3);
const eIn = (u) => u * u * u;
const eIO = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const eBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const wob = (x, k) => Math.sin(x * 1.7 + k) * 0.6 + Math.sin(x * 3.1 + k * 2.3) * 0.4;
const $ = (id) => document.getElementById(id);

function place(el, st, ox, oy) {
  if (!st || st.o <= 0.002) { el.style.display = "none"; return; }
  el.style.display = "";
  el.style.transformOrigin = `${ox}px ${oy}px`;
  el.style.transform = `translate(${(st.x - ox).toFixed(2)}px, ${(st.y - oy).toFixed(2)}px) rotate(${(st.r || 0).toFixed(2)}deg) scale(${(st.s ?? 1).toFixed(4)})`;
  el.style.opacity = clamp(st.o).toFixed(3);
  el.style.filter = st.b > 0.05 ? `blur(${st.b.toFixed(2)}px)` : "none";
}

// ---------- Sprites du chaos (logos, notifications, cartes) ----------
const CHAOS = [];
TL.TILES.forEach((t, i) => {
  CHAOS.push({ el: $(`t-${t.id}`), k: i, ox: 150, oy: 88, base: (te) => {
    if (te < t.tIn) return null;
    const u = P(te, t.tIn, t.tIn + 0.42), pu = eOut(P(te, t.tIn, t.tIn + 0.38));
    let x = t.x + t.from[0] * (1 - pu), y = t.y + t.from[1] * (1 - pu), r = t.rot - 22 * (1 - pu);
    let s = lerp(0.2, 1, eBack(u)), o = P(te, t.tIn, t.tIn + 0.12), b = 0;
    y += 7 * Math.sin(2 * Math.PI * (te * 0.45 + i * 0.17)) * P(te, t.tIn + 0.3, t.tIn + 0.8);
    r += 1.6 * Math.sin(2 * Math.PI * (te * 0.3 + i * 0.23));
    if (t.blur) { const k = P(te, t.blur[0], t.blur[0] + 0.3) * (1 - P(te, t.blur[1], t.blur[1] + 0.2)); b = 8 * k; o *= 1 - 0.5 * k; s *= 1 - 0.07 * k; }
    if (t.id === "vinted") s *= 1 + 0.14 * Math.sin(Math.PI * P(te, 9.3, 9.55));
    if (t.id === "excel" && te > 4.85) x += 10 * Math.sin(te * 90) * (1 - P(te, 4.85, 5.15));
    const badge = t.badge && $(`t-${t.id}`).querySelector(".badge");
    if (badge) { const bu = P(te, t.badgeT, t.badgeT + 0.3); badge.style.display = te < t.badgeT ? "none" : ""; badge.style.transform = `scale(${lerp(0.2, 1, eBack(bu)).toFixed(3)})`; }
    return { x, y, r, s, o, b };
  } });
});
CHAOS.push({ el: $("sheet"), k: 9, base: (te) => {
  if (te < 4.4 || te > 5.72) return null;
  const u = P(te, 4.4, 4.75), v = P(te, 5.5, 5.72), err = te >= 4.85;
  const val = $("sheetv"); val.textContent = err ? "#REF!" : "1 284,50 €"; val.style.color = err ? "#CF222E" : "#1F2328";
  return { x: 330 + (err ? 12 * Math.sin(te * 95) * (1 - P(te, 4.85, 5.2)) : 0), y: 1040 + 30 * (1 - eOut(u)), r: -3, s: lerp(0.6, 1, eBack(u)) * (1 - 0.4 * eIn(v)), o: P(te, 4.4, 4.5) * (1 - v), b: 0 };
} });
TL.NOTIFS.forEach((n, i) => CHAOS.push({ el: $(n.id), k: 10 + i, base: (te) => {
  if (te < n.tIn) return null;
  const u = eOut(P(te, n.tIn, n.tIn + 0.28));
  let o = P(te, n.tIn, n.tIn + 0.12), y = n.y - 70 * (1 - u);
  if (n.tOut) { const v = P(te, n.tOut, n.tOut + 0.2); if (v >= 1) return null; o *= 1 - v; y -= 60 * eIn(v); }
  return { x: n.x, y, r: n.rot, s: lerp(0.92, 1, u), o, b: 0 };
} }));
const PROMPT = "Écris une annonce Vinted pour mon pull à pois Tommy Hilfiger, taille M";
CHAOS.push({ el: $("prompt"), k: 16, base: (te) => {
  if (te < 7.8 || te > 9.32) return null;
  const u = P(te, 7.8, 8.15), v = P(te, 9.1, 9.32);
  const n = Math.floor(PROMPT.length * P(te, 7.86, 8.75)), typing = te < 8.8;
  const caret = typing && (te < 8.75 || Math.floor(te * 4) % 2 === 0) ? '<span class="caret"></span>' : "";
  $("ptx").innerHTML = te >= 8.85 ? `<span class="sel">${PROMPT}</span>` : PROMPT.slice(0, n) + caret;
  return { x: 540 + 180 * eIn(v), y: 700 + 50 * (1 - eOut(u)) - 120 * eIn(v), r: 0, s: lerp(0.9, 1, eBack(u)) * (1 - 0.4 * v), o: P(te, 7.8, 7.92) * (1 - v), b: 0 };
} });
const menu = (t0, t1, x, y) => (te) => { if (te < t0 || te > t1) return null; const u = P(te, t0, t0 + 0.2), v = P(te, t1 - 0.12, t1); return { x, y, r: 0, s: lerp(0.6, 1, eBack(u)), o: P(te, t0, t0 + 0.06) * (1 - v), b: 0 }; };
CHAOS.push({ el: $("m-copy"), k: 17, base: menu(8.85, 9.12, 540, 590) });
CHAOS.push({ el: $("m-paste"), k: 18, base: menu(9.25, 9.62, 540, 590) });

function chaosPose(c, t) {
  const tf = Math.min(t, 11.5);
  const st = c.base(tf);
  if (!st) return null;
  if (tf > 9.85) { const a = lerp(3, 15, P(tf, 9.85, 11.5)); st.x += a * wob(tf * 9, c.k * 3.1); st.y += a * wob(tf * 8.3, c.k * 1.7 + 5); st.r += a * 0.22 * wob(tf * 6, c.k); }
  if (t >= 14) {
    const u = P(t, 14 + c.k * 0.018, 14.46 + c.k * 0.002);
    if (u >= 1) return null;
    const e = Math.pow(u, 2.1), dx = st.x - CX, dy = st.y - CY, r0 = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx);
    const rr = r0 * (1 - e), a = a0 + e * 2.6;
    st.x = CX + rr * Math.cos(a); st.y = CY + rr * Math.sin(a);
    st.s *= 1 - 0.88 * e; st.r += e * 260; st.o *= 1 - P(u, 0.72, 1); st.b = 0;
  }
  return st;
}

// ---------- Fond : halos, étoiles, traînées ----------
const ctx = $("bg").getContext("2d");
const STARS = Array.from({ length: 150 }, (_, i) => ({ x: hash(i + 1) * W, y: hash(i + 101) * H, r: 0.8 + hash(i + 201) * 2.4, a: 0.15 + hash(i + 301) * 0.6, ph: hash(i + 401) * 6.28, sp: 6 + hash(i + 501) * 16, g: hash(i + 601) < 0.2 }));
function halo(x, y, rx, ry, rgb, a) {
  if (a <= 0.003) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.55, `rgba(${rgb},${a * 0.35})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx); ctx.restore();
}
function drawBg(t) {
  const te = t < 11.5 ? t : t < 14 ? 11.5 : t - 2.5;
  ctx.fillStyle = "#121017"; ctx.fillRect(0, 0, W, H);
  halo(540, 90, 1050, 560, "100,66,214", 0.5 + 0.06 * Math.sin(te * 0.9));
  halo(540, 1960, 900, 420, "193,147,59", 0.2 + 0.04 * Math.sin(te * 0.7 + 1));
  halo(540, 960, 760, 760, "205,45,35", 0.24 * P(t, 9.85, 10.3) * (1 - P(t, 11.5, 11.9)));
  halo(540, 960, 820, 820, "124,92,235", 0.6 * P(t, 14.25, 14.5) * (1 - P(t, 15.6, 16.4)));
  halo(540, 640, 760, 620, "124,92,235", 0.4 * P(t, 29.0, 29.6));
  for (const s of STARS) {
    const y = (((s.y - te * s.sp) % H) + H) % H;
    ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(te * 1.3 + s.ph));
    ctx.fillStyle = s.g ? "#E2C67C" : "#FFFFFF";
    ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (t >= 14 && t < 14.65) {
    ctx.lineCap = "round";
    for (const c of CHAOS) {
      const pts = [];
      for (let j = 0; j < 9; j++) { const p = chaosPose(c, t - j * 0.022); if (!p || t - j * 0.022 < 14) break; pts.push(p); }
      for (let j = 0; j < pts.length - 1; j++) {
        ctx.strokeStyle = `rgba(185,166,255,${(0.75 * (1 - j / 8) * pts[0].o).toFixed(3)})`;
        ctx.lineWidth = Math.max(1, 16 * (1 - j / 8) * pts[j].s);
        ctx.beginPath(); ctx.moveTo(pts[j].x, pts[j].y); ctx.lineTo(pts[j + 1].x, pts[j + 1].y); ctx.stroke();
      }
    }
  }
}

// ---------- Sous-titres karaoké ----------
const CAPS = TL.CAPS.map((c) => {
  const d = document.createElement("div"); const w = c.width || 940;
  d.className = "cap"; d.style.left = `${(W - w) / 2}px`; d.style.width = `${w}px`; d.style.top = `${c.top}px`; d.style.fontSize = `${c.size}px`;
  const spans = [];
  for (const [txt, wt, st] of c.words) {
    if (txt === "\n") { d.appendChild(document.createElement("br")); continue; }
    const s = document.createElement("span"); s.className = "w"; s.textContent = txt;
    d.appendChild(s); d.appendChild(document.createTextNode(" ")); spans.push({ s, t: wt, st });
  }
  $("caps").appendChild(d); return { d, c, spans };
});
// Un sous-titre laisse la place au suivant dès que celui-ci commence (coupe franche, pas de chevauchement).
CAPS.forEach((k, i) => { const nx = CAPS[i + 1]; const t0n = nx ? nx.spans[0].t - 0.12 : Infinity; k.end = Math.min(k.c.out, t0n - 0.07); k.fade = k.c.out > t0n - 0.07 ? 0.07 : 0.15; });
function drawCaps(t) {
  for (const { d, c, spans, end, fade } of CAPS) {
    const t0 = spans[0].t - 0.12;
    if (t < t0 || t > end + fade) { d.style.display = "none"; continue; }
    d.style.display = "";
    const a = eOut(P(t, t0, t0 + 0.16)), z = P(t, end, end + fade);
    d.style.opacity = (a * (1 - z)).toFixed(3);
    let dx = 0, sh = "0 6px 30px rgba(0,0,0,.55)";
    if (c.glitch && t > 11.0 && t < 11.5) { const f = Math.floor(t * 30); if (hash(f) > 0.3) { const g = 5 + 10 * hash(f + 9); sh = `${g}px 0 rgba(255,40,90,.85), ${-g}px 0 rgba(0,220,255,.85)`; dx = (hash(f + 4) - 0.5) * 30; } }
    d.style.textShadow = sh;
    d.style.transform = `translate(${dx.toFixed(1)}px, ${(26 * (1 - a) - 20 * z).toFixed(1)}px)`;
    for (const w of spans) {
      const on = t >= w.t, col = w.st === "g" ? "#E2C67C" : w.st === "r" ? "#FF8F85" : "#FFFFFF";
      w.s.style.color = on ? col : "rgba(255,255,255,.3)";
      w.s.style.transform = on ? `translateY(${(10 * (1 - eOut(P(t, w.t, w.t + 0.18)))).toFixed(2)}px)` : "translateY(10px)";
    }
  }
}

// ---------- Logo Selio et constellation ----------
const NS = "http://www.w3.org/2000/svg";
const ring = $("ringg"), R1 = 300, R2 = 410, C1 = 2 * Math.PI * R1, C2 = 2 * Math.PI * R2;
const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); ring.appendChild(e); return e; };
const DOTS = Array.from({ length: 8 }, (_, i) => { const a = (-90 + i * 45 + 12) * Math.PI / 180; return { x: R1 * Math.cos(a), y: R1 * Math.sin(a), f: (i * 45 + 12) / 360 }; });
const LINES = DOTS.map((p, i) => { const q = DOTS[(i + 3) % 8]; return mk("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: "#E2C67C", "stroke-width": 1.5, opacity: 0 }); });
const ring2 = mk("circle", { r: R2, fill: "none", stroke: "rgba(226,198,124,.35)", "stroke-width": 2, "stroke-dasharray": C2, transform: "rotate(-90)" });
const ring1 = mk("circle", { r: R1, fill: "none", stroke: "#E2C67C", "stroke-width": 3.5, "stroke-dasharray": C1, transform: "rotate(-90)" });
const DOTEL = DOTS.map((p) => mk("circle", { cx: p.x, cy: p.y, r: 7, fill: "#F3E2B3" }));
function drawBrand(t) {
  const el = $("brand");
  if (t < 14.45 || t > 16.3) { el.style.display = "none"; return; }
  el.style.display = "";
  const x = eIn(P(t, 15.85, 16.25)), bump = 1 + 0.05 * (1 - eOut(P(t, 14.5, 14.85)));
  el.style.opacity = (1 - x).toFixed(3);
  el.style.transformOrigin = "540px 960px";
  el.style.transform = `translateY(${(-140 * x).toFixed(1)}px) scale(${((1 - 0.15 * x) * bump).toFixed(4)})`;
  const ru = eIO(P(t, 14.5, 15.2)), ru2 = eIO(P(t, 14.6, 15.45));
  ring.setAttribute("transform", `translate(540 960) rotate(${(t - 14.5) * 8})`);
  ring1.setAttribute("stroke-dashoffset", C1 * (1 - ru)); ring2.setAttribute("stroke-dashoffset", C2 * (1 - ru2));
  DOTS.forEach((p, i) => { const s = ru >= p.f ? eBack(P(t, 14.5 + 0.7 * p.f, 14.5 + 0.7 * p.f + 0.25)) : 0; DOTEL[i].setAttribute("r", (7 * s).toFixed(2)); });
  LINES.forEach((l) => l.setAttribute("opacity", (0.4 * P(t, 15.0, 15.4)).toFixed(3)));
  const lu = P(t, 14.5, 14.95), ls = lerp(0.6, 1, eBack(lu));
  const logo = $("logo");
  logo.setAttribute("transform", `translate(540 960) scale(${ls.toFixed(4)}) translate(-540 -960)`);
  logo.setAttribute("opacity", P(t, 14.5, 14.6).toFixed(3));
  logo.style.filter = "drop-shadow(0 0 28px rgba(124,92,235,.9))";
}

// ---------- iPhone, caméra et zones mises en avant ----------
const phone = $("phone"), SCR = TL.SCREENS.map((_, i) => $(`scr${i}`));
const POPS = TL.POPS.map((p) => {
  const d = document.createElement("div"); const [x0, y0, x1, y1] = p.box;
  d.className = "pop";
  Object.assign(d.style, { left: `${18 + x0 * S}px`, top: `${18 + y0 * S}px`, width: `${(x1 - x0) * S}px`, height: `${(y1 - y0) * S}px`, backgroundImage: `url("${SCR[p.scr].src}")`, backgroundPosition: `${-x0 * S}px ${-y0 * S}px` });
  let arc = null;
  if (p.ring) {
    d.style.borderRadius = "50%";
    const sz = (x1 - x0) * S + 22, r = sz / 2 - 3;
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", sz); svg.setAttribute("height", sz);
    Object.assign(svg.style, { position: "absolute", left: "-11px", top: "-11px", overflow: "visible" });
    arc = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ cx: sz / 2, cy: sz / 2, r, fill: "none", stroke: "#F3E2B3", "stroke-width": 3, "stroke-linecap": "round", "stroke-dasharray": 2 * Math.PI * r, transform: `rotate(-90 ${sz / 2} ${sz / 2})` })) arc.setAttribute(k, v);
    arc.dataset.c = 2 * Math.PI * r; svg.appendChild(arc); d.appendChild(svg);
  }
  $("pops").appendChild(d); return { p, d, arc };
});
function camAt(t) {
  const K = TL.CAM;
  if (t <= K[0].t) return K[0];
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1];
    if (t <= b.t) {
      const lin = P(t, a.t, b.t), u = b.Y - a.Y > 1000 ? eIn(lin) : a.Y - b.Y > 1000 ? eOut(lin) : eIO(lin);
      return { fx: lerp(a.fx, b.fx, u), fy: lerp(a.fy, b.fy, u), k: lerp(a.k, b.k, u), X: lerp(a.X, b.X, u), Y: lerp(a.Y, b.Y, u) };
    }
  }
  return K[K.length - 1];
}
function drawPhone(t) {
  if (t < 15.9 || t > 29.5) { phone.style.display = "none"; return; }
  phone.style.display = "";
  const c = camAt(t), tx = c.X - c.k * (18 + c.fx * S), ty = c.Y - c.k * (18 + c.fy * S);
  phone.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${c.k.toFixed(4)})`;
  const pos = TL.SWIPES.reduce((n, [a, b]) => n + eIO(P(t, a, b)), 0);
  SCR.forEach((img, i) => { img.style.transform = `translateX(${((i - pos) * 600).toFixed(2)}px)`; });
  for (const { p, d, arc } of POPS) {
    if (t < p.t0 || t > p.t1) { d.style.display = "none"; continue; }
    d.style.display = "";
    const u = P(t, p.t0, p.t0 + 0.35), v = P(t, p.t1 - 0.25, p.t1), g = eOut(u) * (1 - v);
    const pulse = p.pulse ? 0.03 * Math.sin((t - p.t0) * 8) * P(t, p.t0 + 0.35, p.t0 + 0.5) : 0;
    const sc = 1 + (p.s - 1) * eBack(u) * (1 - eIO(v)) + pulse;
    d.style.transform = `translateY(${(-6 * g).toFixed(2)}px) scale(${sc.toFixed(4)})`;
    d.style.boxShadow = `0 0 0 3.5px rgba(226,198,124,${g.toFixed(3)}), 0 0 38px rgba(226,198,124,${(0.55 * g).toFixed(3)}), 0 ${(24 * g).toFixed(1)}px ${(50 * g).toFixed(1)}px rgba(0,0,0,${(0.55 * g).toFixed(3)})`;
    if (arc) { const cc = +arc.dataset.c; arc.setAttribute("stroke-dashoffset", (cc * (1 - p.ring * eIO(P(t, p.t0 + 0.15, p.t0 + 0.85)))).toFixed(2)); arc.style.opacity = (1 - v).toFixed(3); }
  }
}

// ---------- Appel à l'action ----------
const SIZES = {};
function drawCta(t) {
  const lay = $("cta");
  if (t < 29.0) { lay.style.display = "none"; return; }
  lay.style.display = "";
  const lu = P(t, 29.1, 29.55);
  place($("ctalogo"), { x: 540, y: 610 + 6 * Math.sin((t - 29) * 1.6), r: 0, s: lerp(0.6, 1, eBack(lu)), o: P(t, 29.1, 29.2), b: 0 }, SIZES.ctalogo[0] / 2, SIZES.ctalogo[1] / 2);
  const bu = P(t, 31.0, 31.4);
  const pulse = 0.03 * Math.sin(2 * Math.PI * (t - 31.4) * 1.1) * P(t, 31.4, 31.7);
  place($("btn"), { x: 540, y: 1185, r: 0, s: lerp(0.5, 1, eBack(bu)) + pulse, o: P(t, 31.0, 31.1), b: 0 }, SIZES.btn[0] / 2, SIZES.btn[1] / 2);
  const ph = ((t - 31.5) % 1.8) / 1.8;
  $("shine").style.left = `${(-160 + 1100 * ph).toFixed(1)}px`; $("shine").style.opacity = t > 31.5 && ph < 0.7 ? "1" : "0";
  const iu = eOut(P(t, 32.05, 32.35));
  place($("bio"), { x: 540, y: 1318 + 20 * (1 - iu), r: 0, s: 1, o: iu, b: 0 }, SIZES.bio[0] / 2, SIZES.bio[1] / 2);
  $("bio").querySelector("svg").style.transform = `translateY(${(5 * Math.sin((t - 32) * 6)).toFixed(2)}px)`;
  place($("legal"), { x: 540, y: 1446, r: 0, s: 1, o: 0.9 * P(t, 31.4, 31.8), b: 0 }, SIZES.legal[0] / 2, SIZES.legal[1] / 2);
}

// ---------- Compteur d'applis ----------
function drawChip(t) {
  const el = $("chip");
  let cur = null, idx = -1;
  TL.CHIP.forEach((c, i) => { if (t >= c[0]) { cur = c; idx = i; } });
  if (!cur) { el.style.display = "none"; return; }
  el.style.display = "";
  if (el.textContent !== cur[1]) el.textContent = cur[1];
  el.className = cur[2];
  const u = P(t, cur[0], cur[0] + 0.3);
  let s = idx === 0 ? lerp(0.3, 1, eBack(u)) : 1 + 0.2 * (1 - eOut(u));
  let dx = 0, dy = 0;
  const tf = Math.min(t, 11.5);
  if (t > 9.85 && t < 14) { const a = lerp(2, 9, P(tf, 9.85, 11.5)); dx = a * wob(tf * 9, 40); dy = a * wob(tf * 8, 41); }
  el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${s.toFixed(4)})`;
  el.style.opacity = idx === 0 ? P(t, cur[0], cur[0] + 0.1).toFixed(3) : "1";
}

// ---------- Image complète ----------
function seek(t) {
  drawBg(t);
  const stage = $("stage");
  if (t > 14.6) stage.style.display = "none";
  else {
    stage.style.display = "";
    for (const c of CHAOS) place(c.el, chaosPose(c, t), c.ox ?? c.w / 2, c.oy ?? c.h / 2);
    const fb = 16 * P(t, 11.5, 11.85) * (1 - P(t, 14.0, 14.12)), gs = 0.7 * P(t, 11.5, 11.85) * (1 - P(t, 14.0, 14.12));
    const f = [];
    let gx = 0;
    if (t >= 11.0 && t < 11.5) { const fr = Math.floor(t * 30); if (hash(fr) > 0.3) { const d = 6 + 12 * hash(fr + 7); f.push(`drop-shadow(${d.toFixed(1)}px 0 0 rgba(255,40,90,.7)) drop-shadow(${(-d).toFixed(1)}px 0 0 rgba(0,220,255,.7))`); gx = (hash(fr + 3) - 0.5) * 36; } }
    if (fb > 0.05) f.push(`blur(${fb.toFixed(2)}px) grayscale(${gs.toFixed(3)})`);
    stage.style.filter = f.length ? f.join(" ") : "none";
    stage.style.transform = `translateX(${gx.toFixed(1)}px)`;
  }
  const pu = P(t, 2.38, 2.8), pv = eIn(P(t, 2.95, 3.22));
  place($("pull"), t < 2.38 || t > 3.22 ? null : { x: 540, y: lerp(1250, 720, pv), r: lerp(-6, 0, pv) + 3 * Math.sin(t * 3), s: lerp(0.3, 1, eBack(pu)) * lerp(1, 0.25, pv), o: P(t, 2.38, 2.45) * (1 - P(pv, 0.6, 1)), b: 0 }, SIZES.pull[0] / 2, SIZES.pull[1] / 2);
  drawBrand(t);
  drawPhone(t);
  $("scrim").style.opacity = (P(t, 15.95, 16.4) * (1 - P(t, 28.95, 29.3))).toFixed(3);
  drawCta(t);
  drawCaps(t);
  drawChip(t);
  $("dark").style.opacity = (0.55 * P(t, 11.5, 11.85) * (1 - P(t, 14.0, 14.3))).toFixed(3);
  const fl = t >= 14.5 ? 0.9 * Math.pow(Math.max(0, 1 - (t - 14.5) / 0.4), 1.5) : 0;
  const fl2 = t >= 29.1 ? 0.35 * Math.pow(Math.max(0, 1 - (t - 29.1) / 0.35), 1.5) : 0;
  $("flash").style.opacity = Math.max(fl, fl2).toFixed(3);
}

window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  await Promise.all([...document.querySelectorAll("image")].map((i) => new Promise((r) => { const im = new Image(); im.onload = r; im.onerror = r; im.src = i.getAttribute("href"); })));
  for (const c of CHAOS) { c.el.style.display = ""; c.el.style.transform = "none"; c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
  for (const id of ["pull", "ctalogo", "btn", "bio", "legal"]) { const e = $(id); const lay = $("cta"); lay.style.display = ""; e.style.display = ""; e.style.transform = "none"; SIZES[id] = [e.offsetWidth, e.offsetHeight]; }
  return true;
})();
window.seek = seek;
