// Scène de la vidéo Studio : photos en éventail, formulaire vide, analyse des photos, annonce rédigée.
const SZ = {};
const PC = TL.PHOTOS.map((_, i) => $(`pc${i}`)), TH = TL.PHOTOS.map((_, i) => $(`th${i}`)), VI = [0, 1, 2].map((i) => $(`vi${i}`));
const FL = TL.FIELDS.map((_, i) => $(`fl${i}`)), AT = TL.ITEM.attrs.map((_, i) => $(`at${i}`));
let REL = {};
function sceneReady() {
  for (const id of ["form", "count", "view", "ch0", "ch1", "ch2", "card"]) { const e = $(id); e.style.display = ""; e.style.transform = "none"; SZ[id] = [e.offsetWidth, e.offsetHeight]; }
  const rel = (el) => { let x = 0, y = 0, e = el; while (e && e.id !== "card") { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return [x + el.offsetWidth / 2, y + el.offsetHeight / 2]; };
  REL = { qin: rel($("qin")), pub: rel($("pub")) };
}
const CS = 0.92, CARD_Y = () => 625 + (CS * SZ.card[1]) / 2;

// Suction vers un point (fin d'un passage).
function suck(st, t, t0, d, x, y) {
  if (t < t0) return st;
  const u = eIn(P(t, t0, t0 + d));
  return { ...st, x: lerp(st.x, x, u), y: lerp(st.y, y, u), s: (st.s ?? 1) * (1 - 0.92 * u), r: (st.r || 0) + 160 * u, o: st.o * (1 - P(u, 0.75, 1)), b: (st.b || 0) * (1 - u) };
}

function drawPhotos(t) {
  PC.forEach((el, i) => {
    const t0 = 0.1 + i * 0.12;
    if (t < t0 || t > 7.0) return vis(el, false);
    const e = eOut(P(t, t0, t0 + 0.45)), k = i - 3;
    let x = 540 + k * 100, y = 1230 + Math.abs(k) * 24 + 10 * Math.sin(t * 1.4 + i), r = k * 8 + 2 * Math.sin(t + i);
    y = lerp(-400, y, e); r += 30 * (1 - e) * (i % 2 ? 1 : -1);
    let s = 1 + 0.06 * bump(t, 1.6, 1.8, 2.3, 2.8), o = P(t, t0, t0 + 0.1), b = 0;
    const back = eIO(P(t, 2.95, 3.4));
    x = lerp(x, 540 + k * 120, back); y = lerp(y, 1560, back); s = lerp(s, 0.72, back); o *= 1 - 0.65 * back; b = 5 * back;
    place(el, suck({ x, y, s, r, o, b }, t, 6.45, 0.5, 540, 1150), 280, 373);
  });
}

function drawForm(t) {
  const el = $("form"), w = SZ.form[0], h = SZ.form[1];
  const c = $("count");
  if (t < 2.95 || t > 7.0) { vis(c, false); return vis(el, false); }
  const a = popIn(t, 3.0, 0.4);
  place(el, suck({ x: 540, y: 1170 + a.dy, s: a.s, o: a.o, b: a.b }, t, 6.4, 0.5, 540, 1150), w, h);
  let act = -1;
  TL.FIELD_T.forEach((ft, i) => { if (t >= ft) act = i; });
  FL.forEach((f, i) => { f.className = `fl${i === 4 ? " big" : ""}${i === act ? " on" : ""}`; html(f.lastChild, i === act && blink(t) ? CARET : ""); });
  if (vis(c, t >= 5.1 && t < 6.9)) {
    const n = 1 + Math.floor(23 * P(t, 5.3, 6.4)), p = popIn(t, 5.1, 0.3);
    html(c, `Article ${n} / 24`);
    const pulse = 1 + 0.08 * (1 - P(t - 5.3 - (n - 1) * (1.1 / 23), 0, 0.04));
    place(c, suck({ x: 760, y: 1170 - h / 2 - 10 + p.dy, s: p.s * (t > 5.3 && n < 24 ? pulse : 1) * (1 + 0.15 * bump(t, 6.38, 6.45, 6.5, 6.6)), o: p.o, b: p.b }, t, 6.4, 0.5, 540, 1150), SZ.count[0], SZ.count[1]);
  }
}

const THX = (i) => 540 + (i - 3) * 126, THY = 1720;
function drawAnalysis(t) {
  const view = $("view"), out = popOut(t, 14.05, 0.3);
  TH.forEach((el, i) => {
    const t0 = 8.75 + i * 0.08;
    if (t < t0 || t > 14.4) return vis(el, false);
    const e = eBack(P(t, t0, t0 + 0.4)), on = (t < 10 ? 0 : t < 12.4 ? 1 : 2) === i && t >= 9.3;
    el.className = `thumb${on ? " on" : ""}`;
    place(el, { x: lerp(540, THX(i), eOut(P(t, t0, t0 + 0.4))), y: lerp(2150, THY, e) + out.dy, s: (on ? 1.1 : 1) * out.s, r: lerp(20 * (i - 3), 0, e), o: P(t, t0, t0 + 0.1) * out.o, b: out.b }, 112, 150);
  });
  if (!vis(view, t >= 9.1 && t < 14.4)) { for (const id of ["ch0", "ch1", "ch2"]) vis($(id), false); return; }
  const a = popIn(t, 9.1, 0.45);
  place(view, { x: 540, y: 1110 + a.dy + out.dy, s: a.s * out.s, o: a.o * out.o, b: a.b + out.b }, 720, 960);
  css(VI[0], "opacity", "1");
  css(VI[1], "opacity", (P(t, 10.0, 10.2) * (1 - P(t, 12.4, 12.6))).toFixed(3));
  css(VI[2], "opacity", P(t, 12.4, 12.6).toFixed(3));
  const z = lerp(1, 1.6, eIO(P(t, 10.05, 10.9)));
  css(VI[1].firstChild, "transformOrigin", "51% 57.5%");
  css(VI[1].firstChild, "transform", `scale(${z.toFixed(4)})`);
  css(VI[2].firstChild, "transform", `scale(${lerp(1, 1.06, P(t, 12.4, 14.2)).toFixed(4)})`);
  css(VI[0].firstChild, "transform", `scale(${lerp(1.08, 1, P(t, 9.1, 10)).toFixed(4)})`);
  const sc = $("scanl");
  if (vis(sc, t >= 10.15 && t <= 10.9)) css(sc, "top", `${f2(lerp(-10, 960, eIO(P(t, 10.15, 10.85))))}px`);
  const hl = $("hl");
  if (vis(hl, t >= 10.85 && t < 12.45)) { const u = eBack(P(t, 10.85, 11.15)); const w = 346 * lerp(1.25, 1, u), h = 200 * lerp(1.25, 1, u); css(hl, "left", `${f2(367 - w / 2)}px`); css(hl, "top", `${f2(552 - h / 2)}px`); css(hl, "width", `${f2(w)}px`); css(hl, "height", `${f2(h)}px`); css(hl, "opacity", P(t, 10.85, 10.95).toFixed(3)); }
  const tp = $("tape");
  if (vis(tp, t >= 12.55)) { const u = eIO(P(t, 12.55, 13.05)); css(tp, "left", "492px"); css(tp, "top", `${f2(0.15 * 960)}px`); css(tp, "height", `${f2(0.82 * 960 * u)}px`); css(tp, "opacity", (0.85 + 0.15 * Math.sin(t * 8)).toFixed(3)); }
  css($("vtag"), "opacity", P(t, 10.0, 10.2).toFixed(3));
  const chip = (id, t0, t1, x, y) => { const el = $(id); if (t < t0 || t > t1 + 0.3) return vis(el, false); const p = popIn(t, t0), q = popOut(t, t1); place(el, { x, y: y + p.dy + q.dy, s: p.s * q.s, o: p.o * q.o, b: p.b + q.b }, SZ[id][0], SZ[id][1]); };
  chip("ch0", 11.05, 12.35, 360, 1380);
  chip("ch1", 11.5, 12.35, 720, 1505);
  chip("ch2", 12.95, 14.05, 540, 1460);
}

function drawCard(t) {
  const el = $("card");
  if (t < TL.T_CARD - 0.05 || t > 23.1) { vis($("tap"), false); return vis(el, false); }
  const a = popIn(t, TL.T_CARD, 0.45), cy = CARD_Y();
  const pulse = 1 + 0.02 * bump(t, TL.T_PUB, TL.T_PUB + 0.08, TL.T_PUB + 0.2, TL.T_PUB + 0.5);
  place(el, suck({ x: 540, y: cy + a.dy, s: CS * a.s * pulse, o: a.o, b: a.b }, t, 22.5, 0.4, 540, 830), SZ.card[0], SZ.card[1]);
  const ti = typed(TL.ITEM.title, t, ...TL.T_TITLE);
  html($("ttl"), esc(ti) + (t < TL.T_TITLE[1] + 0.4 && blink(t) ? CARET : ""));
  AT.forEach((e, i) => { const p = popIn(t, TL.T_ATTR[i], 0.3); css(e, "opacity", p.o.toFixed(3)); css(e, "transform", `translateY(${f2(p.dy * 0.5)}px) scale(${p.s.toFixed(4)})`); });
  html($("desc"), esc(typed(TL.ITEM.desc, t, ...TL.T_DESC)) + (t >= TL.T_DESC[0] - 0.1 && t < TL.T_DESC[1] + 0.3 && blink(t) ? CARET : ""));
  const q = $("qbox"), qp = popIn(t, TL.T_Q, 0.35), ok = t >= TL.T_QOK;
  css(q, "opacity", qp.o.toFixed(3));
  css(q, "transform", `scale(${(qp.s * (1 + 0.03 * bump(t, TL.T_Q + 0.3, TL.T_Q + 0.45, TL.T_Q + 0.6, TL.T_Q + 0.9))).toFixed(4)})`);
  css(q, "borderColor", ok ? "rgba(74,222,128,.7)" : "rgba(226,198,124,.8)");
  css(q, "background", ok ? "rgba(74,222,128,.08)" : "rgba(226,198,124,.08)");
  html($("qtxt"), ok ? "Matière : indiquée par toi" : "Matière : pas lisible sur les photos. Tu peux la préciser ?");
  const word = typed("Coton", t, ...TL.T_QTYPE);
  html($("qin"), ok ? `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Coton` : t >= TL.T_QTAP ? esc(word) + (blink(t) ? CARET : "") : '<span style="color:rgba(255,255,255,.3)">Ta réponse</span>');
  const pub = $("pub"), done = t >= TL.T_PUB + 0.1;
  pub.className = done ? "ok" : "";
  html(pub, done ? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Annonce validée` : "Publier l'annonce");
  // tapotements
  const tap = $("tap");
  let shown = false;
  for (const [tt, key] of [[TL.T_QTAP, "qin"], [TL.T_PUB, "pub"]]) {
    if (t < tt - 0.25 || t > tt + 0.35) continue;
    const [rx, ry] = REL[key], x = 540 + CS * (rx - SZ.card[0] / 2 + 120), y = cy + CS * (ry - SZ.card[1] / 2 + 10);
    const s = t < tt ? lerp(1.4, 1, eOut(P(t, tt - 0.25, tt))) : lerp(1, 0.8, P(t, tt, tt + 0.35));
    place(tap, { x, y, s, o: P(t, tt - 0.25, tt - 0.15) * (1 - P(t, tt + 0.15, tt + 0.35)) }, 84, 84);
    shown = true;
  }
  if (!shown) vis(tap, false);
}

function drawScene(t) {
  drawPhotos(t);
  drawForm(t);
  drawAnalysis(t);
  drawCard(t);
}
