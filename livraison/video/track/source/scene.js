// Scène de la vidéo Track : l'achat « au feeling », puis le marché suivi et la note de la niche (chiffres fictifs).
const SZ = {};
const RING = 2 * Math.PI * 105;
function sceneReady() {
  for (const id of ["item", "buy", "sell", "mk", "niche"]) { const e = $(id); e.style.display = ""; e.style.transform = "none"; SZ[id] = [e.offsetWidth, e.offsetHeight]; }
}
function suck(st, t, t0, d, x, y) {
  if (t < t0) return st;
  const u = eIn(P(t, t0, t0 + d));
  return { ...st, x: lerp(st.x, x, u), y: lerp(st.y, y, u), s: (st.s ?? 1) * (1 - 0.92 * u), r: (st.r || 0) + 160 * u, o: st.o * (1 - P(u, 0.75, 1)), b: (st.b || 0) * (1 - u) };
}
function drawHook(t) {
  if (t > 4.8) { for (const id of ["item", "buy", "sell"]) vis($(id), false); return; }
  const a = popIn(t, 0.05, 0.5);
  place($("item"), suck({ x: 540, y: 1170 + a.dy + 8 * Math.sin(t * 1.5), s: a.s, r: -3 + 1.5 * Math.sin(t), o: a.o, b: a.b }, t, 4.2, 0.5, 540, 1150), SZ.item[0], SZ.item[1]);
  const b = popIn(t, 2.45, 0.35), c = popIn(t, 3.45, 0.35);
  if (t >= 2.4) place($("buy"), suck({ x: 300, y: 880 + b.dy, s: b.s, r: -8, o: b.o, b: b.b }, t, 4.2, 0.5, 540, 1150), SZ.buy[0], SZ.buy[1]); else vis($("buy"), false);
  if (t >= 3.4) place($("sell"), suck({ x: 760, y: 1560 + c.dy + 6 * Math.sin(t * 7), s: c.s, r: 6 + 3 * Math.sin(t * 9), o: c.o, b: c.b }, t, 4.2, 0.5, 540, 1150), SZ.sell[0], SZ.sell[1]); else vis($("sell"), false);
}
function sub(el, t0, t) { const p = popIn(t, t0, 0.35); css(el, "opacity", p.o.toFixed(3)); css(el, "transform", `translateY(${f2(p.dy * 0.5)}px) scale(${p.s.toFixed(4)})`); }
function drawMarket(t) {
  const el = $("mk");
  if (t < 6.3 || t > 13.7) return vis(el, false);
  const a = popIn(t, 6.35, 0.45), q = popOut(t, 13.35, 0.3), h = SZ.mk[1];
  place(el, { x: 540, y: 640 + h / 2 + a.dy + q.dy, s: a.s * q.s, o: a.o * q.o, b: a.b + q.b }, SZ.mk[0], h);
  sub($("k0"), 8.6, t); sub($("k1"), 9.3, t);
  const m = TL.MEDIAN, n = Math.min(m.length - 1, Math.floor(P(t, 8.75, 10.3) * (m.length - 1) + 0.0001));
  html($("kv0"), `${String(m[n]).replace(".", ",")} €`);
  $("cliprect").setAttribute("width", (820 * eIO(P(t, 8.75, 10.3))).toFixed(1));
  sub($("gsec"), 10.85, t);
  [...$("bars").children].forEach((b, i) => { const u = eBack(P(t, 11.0 + i * 0.1, 11.35 + i * 0.1)); css(b, "height", `${f2(Math.max(0, (TL.GONE[i] / 40) * 150 * u))}px`); });
  html($("gone"), `${Math.round(37 * P(t, 11.6, 12.0))} cette semaine`);
}
function drawNiche(t) {
  const el = $("niche");
  if (t < 13.4 || t > 18.6) return vis(el, false);
  const a = popIn(t, 13.45, 0.45), h = SZ.niche[1];
  place(el, suck({ x: 540, y: 660 + h / 2 + a.dy, s: a.s, o: a.o, b: a.b }, t, 18.1, 0.4, 540, 830), SZ.niche[0], h);
  const u = eOut(P(t, 13.65, 14.6));
  html($("nv"), String(Math.round(TL.NICHE * u)));
  $("ring").setAttribute("stroke-dashoffset", (RING * (1 - (TL.NICHE / 100) * u)).toFixed(1));
  TL.SCORES.forEach(([, v], i) => css($(`sb${i}`), "width", `${f2(v * eOut(P(t, 14.5 + i * 0.18, 15.1 + i * 0.18)))}%`));
  const vd = $("verdict"), p = popIn(t, 16.1, 0.4);
  css(vd, "opacity", p.o.toFixed(3));
  css(vd, "transform", `translateY(${f2(p.dy * 0.5)}px) scale(${(p.s * (1 + 0.03 * bump(t, 17.0, 17.1, 17.25, 17.5))).toFixed(4)})`);
  css(vd, "boxShadow", `0 0 ${f2(50 * bump(t, 16.9, 17.05, 17.4, 17.9))}px rgba(226,198,124,.55)`);
}
function drawScene(t) { drawHook(t); drawMarket(t); drawNiche(t); }
