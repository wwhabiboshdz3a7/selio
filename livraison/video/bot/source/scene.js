// Scène de la vidéo Bot : nuit et notifications, règles, négociation, relance, résumé du matin.
const SZ = {};
const NT = TL.NOTIFS.map((_, i) => $(`nt${i}`)), RU = TL.RULES.map((_, i) => $(`ru${i}`)), SR = TL.SUM.map((_, i) => $(`sr${i}`));
let VREL = [0, 0];
function sceneReady() {
  for (const id of ["clock", "dnd", "unread", "rules", "rchip", "chat", "rel", "sum", ...TL.NOTIFS.map((_, i) => `nt${i}`)]) { const e = $(id); e.style.display = ""; e.style.transform = "none"; SZ[id] = [e.offsetWidth, e.offsetHeight]; }
  const el = $("vbtn"); let x = 0, y = 0, e = el; while (e && e.id !== "sum") { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
  VREL = [x + el.offsetWidth / 2, y + el.offsetHeight / 2];
}
function suck(st, t, t0, d, x, y) {
  if (t < t0) return st;
  const u = eIn(P(t, t0, t0 + d));
  return { ...st, x: lerp(st.x, x, u), y: lerp(st.y, y, u), s: (st.s ?? 1) * (1 - 0.92 * u), r: (st.r || 0) + 160 * u, o: st.o * (1 - P(u, 0.75, 1)), b: (st.b || 0) * (1 - u) };
}
// Nuit (0 → 6,6 s), un peu moins sombre « au réveil » ; lever de soleil pour le résumé du matin.
function bgNight(t) { return (1 - 0.3 * P(t, 3.0, 3.5)) * (1 - P(t, 6.6, 6.95)); }
function drawSceneBg(t, c) {
  const n = 1 - P(t, 3.0, 3.6) * 0.6 - P(t, 6.4, 6.9) * 0.4;
  if (n > 0.01) {
    const x = 930, y = 590;
    blob(c, x, y, 220, 220, "200,210,255", 0.25 * n);
    c.save(); c.globalAlpha = n; c.fillStyle = "#EDEBFF"; c.beginPath(); c.arc(x, y, 48, 0, 6.2832); c.fill();
    c.globalCompositeOperation = "destination-out"; c.beginPath(); c.arc(x + 22, y - 14, 44, 0, 6.2832); c.fill(); c.restore();
  }
  const m = bump(t, 19.35, 20.3, 23.9, 24.4);
  blob(c, 540, 2050, 1100, 700, "255,150,70", 0.42 * m);
  blob(c, 540, 1900, 700, 380, "255,200,120", 0.3 * m);
}

function drawNight(t) {
  const out = (id) => vis($(id), false);
  if (t > 6.95) { ["clock", "dnd", "unread"].forEach(out); NT.forEach((e) => vis(e, false)); return; }
  const cl = $("clock"), a = popIn(t, 0.0, 0.5), fl = bump(t, 2.95, 3.05, 3.1, 3.25);
  html($("clockh"), t < 3.08 ? "02:47" : "07:12");
  html($("clockd"), t < 3.08 ? "Écran verrouillé" : "Bonjour");
  place(cl, suck({ x: 540, y: 760 + a.dy, s: a.s * (1 - 0.06 * fl), o: a.o * (1 - 0.6 * fl), b: 6 * fl }, t, 6.45, 0.5, 540, 1150), SZ.clock[0], SZ.clock[1]);
  const d = popIn(t, 0.3), dq = popOut(t, 3.0);
  if (t < 3.3) place($("dnd"), { x: 540, y: 960 + d.dy + dq.dy, s: d.s * dq.s, o: d.o * dq.o, b: d.b + dq.b }, SZ.dnd[0], SZ.dnd[1]); else out("dnd");
  const u = popIn(t, 3.6, 0.3);
  if (t >= 3.6) place($("unread"), suck({ x: 540, y: 960 + u.dy, s: u.s * (1 + 0.06 * Math.sin(t * 9) * P(t, 3.9, 4.2)), o: u.o, b: u.b }, t, 6.45, 0.5, 540, 1150), SZ.unread[0], SZ.unread[1]); else out("unread");
  const grey = P(t, 5.9, 6.3);
  NT.forEach((el, i) => {
    const n = TL.NOTIFS[i];
    if (t < n.t) return vis(el, false);
    const k = TL.NOTIFS.filter((m) => m.t > n.t && t >= m.t).length;
    const yk = kf(t, [[n.t, 0], ...TL.NOTIFS.filter((m) => m.t > n.t).map((m, j) => [m.t + 0.25, j + 1])], eOut);
    const p = popIn(t, n.t, 0.35), h = SZ[`nt${i}`][1];
    place(el, suck({ x: 540, y: 1120 + yk * (h + 18) + p.dy, s: p.s * (1 - 0.04 * grey), o: p.o * (1 - 0.45 * grey) * (k > 3 ? 0.6 : 1), b: p.b }, t, 6.45, 0.5, 540, 1150), SZ[`nt${i}`][0], h);
    css(el, "filter", grey > 0 ? `grayscale(${grey.toFixed(3)})` : el.style.filter);
  });
}

function drawRules(t) {
  const el = $("rules"), rc = $("rchip");
  if (t >= 10.95 && t < 16.2) { const p = popIn(t, 11.0, 0.35), q = popOut(t, 15.85); place(rc, { x: 540, y: 655 + p.dy + q.dy, s: p.s * q.s, o: p.o * q.o, b: p.b + q.b }, SZ.rchip[0], SZ.rchip[1]); } else vis(rc, false);
  if (t < TL.T_RULES - 0.05 || t > 11.3) return vis(el, false);
  const a = popIn(t, TL.T_RULES, 0.45), h = SZ.rules[1];
  place(el, suck({ x: 540, y: 660 + h / 2 + a.dy, s: a.s, o: a.o, b: a.b }, t, 10.85, 0.35, 540, 655), SZ.rules[0], h);
  RU.forEach((r, i) => { const p = popIn(t, TL.T_RULE[i], 0.3); css(r, "opacity", (0.25 + 0.75 * p.o).toFixed(3)); const tg = r.firstChild; css(tg, "transform", `scale(${(t >= TL.T_RULE[i] ? lerp(0.4, 1, eBack(P(t, TL.T_RULE[i], TL.T_RULE[i] + 0.3))) : 0.4).toFixed(3)})`); css(tg, "background", t >= TL.T_RULE[i] ? "#7C5CEB" : "rgba(124,92,235,.25)"); });
}

function drawChat(t) {
  const el = $("chat"), B = TL.B;
  if (t < TL.T_CHAT - 0.05 || t > 16.2) return vis(el, false);
  const a = popIn(t, TL.T_CHAT, 0.45), q = popOut(t, 15.85), h = SZ.chat[1];
  place(el, { x: 540, y: 740 + h / 2 + a.dy + q.dy, s: a.s * q.s, o: a.o * q.o, b: a.b + q.b }, SZ.chat[0], h);
  const sub = (id, t0, from = 0) => { const e = $(id), p = popIn(t, t0, 0.3); if (!vis(e, t >= t0)) return; css(e, "opacity", p.o.toFixed(3)); css(e, "transform", `translate(${f2(from * (1 - eOut(P(t, t0, t0 + 0.3))))}px, ${f2(p.dy * 0.5)}px) scale(${p.s.toFixed(4)})`); };
  sub("b0", B.b0, -40); sub("toffer", B.offer); sub("tdec", B.decide, 30); sub("b1", B.b1, 40); sub("b2", B.b2, -40); sub("tok", B.ok, 30);
  const dots = $("dots");
  if (vis(dots, t >= B.dots[0] && t < B.dots[1])) [...dots.children].forEach((d, i) => css(d, "transform", `translateY(${f2(-8 * Math.max(0, Math.sin((t - B.dots[0]) * 12 - i * 0.9)))}px)`));
  const g = bump(t, 14.35, 14.5, 14.8, 15.1);
  css($("b1"), "boxShadow", g > 0 ? `0 0 0 ${f2(4 * g)}px rgba(226,198,124,.9), 0 0 ${f2(50 * g)}px rgba(226,198,124,.6)` : "none");
}

function drawRelance(t) {
  const el = $("rel");
  if (t < TL.T_REL - 0.05 || t > 19.6) return vis(el, false);
  const a = popIn(t, TL.T_REL, 0.45), q = popOut(t, 19.3), h = SZ.rel[1];
  place(el, { x: 540, y: 680 + h / 2 + a.dy + q.dy, s: a.s * q.s, o: a.o * q.o, b: a.b + q.b }, SZ.rel[0], h);
  TL.T_SENT.forEach((ts, i) => { const st = $(`st${i}`); st.className = `st${t >= ts ? " ok" : ""}`; html(st, t >= ts ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#86EFAC" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Message envoyé' : t >= ts - 0.4 ? "Envoi…" : "En attente"); });
  const p = popIn(t, TL.T_PREV, 0.35), pr = $("prev");
  css(pr, "opacity", p.o.toFixed(3)); css(pr, "transform", `translateY(${f2(p.dy * 0.6)}px) scale(${p.s.toFixed(4)})`);
}

function drawSummary(t) {
  const el = $("sum"), tap = $("tap");
  if (t < TL.T_SUM - 0.05 || t > 24.4) { vis(tap, false); return vis(el, false); }
  const a = popIn(t, TL.T_SUM, 0.45), h = SZ.sum[1], cy = 700 + h / 2;
  const pulse = 1 + 0.02 * bump(t, TL.T_VTAP, TL.T_VTAP + 0.08, TL.T_VTAP + 0.2, TL.T_VTAP + 0.5);
  place(el, suck({ x: 540, y: cy + a.dy, s: a.s * pulse, o: a.o, b: a.b }, t, 23.95, 0.4, 540, 830), SZ.sum[0], h);
  SR.forEach((r, i) => { const p = popIn(t, TL.T_SROW[i], 0.3); css(r, "opacity", p.o.toFixed(3)); css(r, "transform", `translateY(${f2(p.dy * 0.5)}px) scale(${p.s.toFixed(4)})`); });
  const last = SR[SR.length - 1], done = t >= TL.T_VOK;
  last.className = `srow gold${done ? " done" : ""}`;
  const hl = bump(t, 21.3, 21.45, 21.9, 22.1);
  css(last, "boxShadow", hl > 0 ? `0 0 ${f2(50 * hl)}px rgba(226,198,124,.55)` : "none");
  html(last.firstChild, done ? "Demande traitée par toi" : "À valider par toi");
  html($("vbtn"), done ? "Validé" : "Valider");
  css($("vbtn"), "background", done ? "linear-gradient(90deg, #15803D, #22C55E)" : "linear-gradient(90deg, #5232B5, #7C5CEB)");
  const tt = TL.T_VTAP;
  if (t >= tt - 0.25 && t <= tt + 0.35) {
    const x = 540 + VREL[0] - SZ.sum[0] / 2 + 20, y = cy + VREL[1] - h / 2 + 20;
    const s = t < tt ? lerp(1.4, 1, eOut(P(t, tt - 0.25, tt))) : lerp(1, 0.8, P(t, tt, tt + 0.35));
    place(tap, { x, y, s, o: P(t, tt - 0.25, tt - 0.15) * (1 - P(t, tt + 0.15, tt + 0.35)) }, 84, 84);
  } else vis(tap, false);
}

function drawScene(t) {
  drawNight(t);
  drawRules(t);
  drawChat(t);
  drawRelance(t);
  drawSummary(t);
}
