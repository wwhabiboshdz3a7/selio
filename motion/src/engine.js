/* Selio motion — moteur : timeline deterministe pilotee par seek(t) + composants. */
window.SELIO = { videos: {} };
const reg = (id, v) => (SELIO.videos[id] = v);

/* attribut d'animation : delai (s, relatif a la scene), nom, duree, styles en plus */
const an = (d = 0, name = "up", du = 0.8, extra = "") => ` data-a style="--d:${d}s;--an:${name};--du:${du}s;${extra}"`;

/* enchaine des scenes ; chacune reste affichee 1 s de plus pour etre recouverte par la transition suivante */
function seq(scenes) {
  let t = 0;
  const html = scenes.map((s, i) => {
    const end = t + s.dur + (i < scenes.length - 1 ? 1.1 : 0);
    const h = `<section class="scene ${s.cls || ""}" data-start="${t}" data-end="${end}" style="--s:${t}s;z-index:${i + 1};${s.style || ""}">${s.html}</section>`;
    t += s.dur;
    return h;
  }).join("");
  return { html, dur: t };
}

/* texte revele mot par mot (masque) */
function words(text, d0 = 0, step = 0.07, du = 0.9) {
  let i = 0, em = false;
  return text.split("\n").map((line) => line.split(" ").map((w) => {
    if (w.startsWith("*")) em = true;
    const inner = em ? `<em class="it">${w.replace(/\*/g, "")}</em>` : w;
    if (w.endsWith("*")) em = false;
    return `<span class="w"><i${an(d0 + step * i++, "rise", du)}>${inner}</i></span>`;
  }).join(" ")).join("<br>");
}
const count = (to, at, dur = 1.4, fmt = "int", from = 0) => `<span data-count data-to="${to}" data-from="${from}" data-at="${at}" data-cdur="${dur}" data-fmt="${fmt}"></span>`;
const type = (text, at, cps = 16, caret = true) => `<span data-type="${text.replace(/"/g, "&quot;")}" data-at="${at}" data-cps="${cps}"></span>${caret ? '<span class="caret"></span>' : ""}`;
const tap = (x, y, d) => `<div class="tapc"${an(d, "ripple", 0.7, `left:${x}px;top:${y}px;--ez:ease-out`)}></div>`;

/* ---------- logo ---------- */
const mark = (cls = "", draw = null) => {
  const p = (y, o, i) => `<path d="M6 ${y} L24 ${y - 8} L42 ${y}" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="${o}" ${draw === null ? "" : `pathLength="1" stroke-dasharray="1"${an(draw + (2 - i) * 0.16, "draw", 0.9, "--ez:var(--io)")}`}/>`;
  return `<svg viewBox="0 0 48 48" fill="none" class="${cls}">${p(16, 1, 0)}${p(26, 0.72, 1)}${p(36, 0.48, 2)}</svg>`;
};
const wm = (style, color = "#fff", d = 0.2) => `<div class="wm"${an(d, "fade", 0.8, `color:${color};${style}`)}>${mark()}Selio</div>`;

/* ---------- icones ---------- */
const ic = {
  heart: (c = "none", s = "#51677a") => `<svg viewBox="0 0 24 24" fill="${c}" stroke="${s}" stroke-width="2.2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>`,
  check: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  bolt: (c = "#fff") => `<svg viewBox="0 0 24 24" fill="${c}"><path d="M13.5 2 5 13.5h5.5L9.5 22 19 10h-5.8z"/></svg>`,
  search: (s = "#51677a") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>`,
  cam: (s = "#204868") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2" stroke-linejoin="round"><path d="M3.5 8.5h4l1.5-2.5h6l1.5 2.5h4v10.500h-17z"/><circle cx="12" cy="13.500" r="3.6"/></svg>`,
  clock: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/></svg>`,
  dl: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>`,
  msg: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.2" stroke-linejoin="round"><path d="M4 5h16v11H10l-5 4v-4H4z"/></svg>`,
  loop: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.500-5.800L20 8.500M20 4v4.500h-4.500M20 12a8 8 0 0 1-13.500 5.800L4 15.500M4 20v-4.500h4.500"/></svg>`,
  tag: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.2" stroke-linejoin="round"><path d="M3.500 12.500V4h8.500l8.500 8.500-8.500 8.500z"/><circle cx="8" cy="8.500" r="1.400" fill="${s}"/></svg>`,
  users: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.2" stroke-linecap="round"><circle cx="9" cy="8.500" r="3.500"/><path d="M2.500 20c0-3.600 2.900-6 6.500-6s6.500 2.400 6.500 6M16 5.200a3.500 3.500 0 0 1 0 6.600M18 14.300c2.100.8 3.500 2.700 3.500 5.700"/></svg>`,
  star: (c = "#d9a441") => `<svg viewBox="0 0 24 24" fill="${c}"><path d="M12 2.500l2.900 6.200 6.600.8-4.900 4.600 1.300 6.600L12 17.400 6.100 20.700l1.300-6.600L2.500 9.500l6.600-.8z"/></svg>`,
  box: (s = "#fff") => `<svg viewBox="0 0 24 24" fill="none" stroke="${s}" stroke-width="2.200" stroke-linejoin="round"><path d="M3.500 7.500 12 3l8.500 4.500v9L12 21l-8.500-4.500zM3.500 7.500 12 12l8.500-4.500M12 12v9"/></svg>`,
};

/* ---------- vetements (illustrations vectorielles maison) ---------- */
const G = {
  tee: (c, k) => `<path d="M70 30 40 42 14 76l24 20 14-14v90h96V82l14 14 24-20-26-34-30-12q-30 22-60 0z" fill="${c}"/><path d="M70 30q30 22 60 0" fill="none" stroke="${k}" stroke-width="5" stroke-linecap="round"/>`,
  dress: (c, k) => `<path d="M78 20l-6 40q-2 20 12 32L48 180h104L116 92q14-12 12-32l-6-40h-10q-12 24-24 0z" fill="${c}"/><path d="M84 92h32" stroke="${k}" stroke-width="5" stroke-linecap="round"/><path d="M70 130q30 12 60 0" fill="none" stroke="${k}" stroke-width="4" opacity=".5"/>`,
  jeans: (c, k) => `<path d="M56 22h88l8 158h-40L100 70 88 180H48z" fill="${c}"/><path d="M56 40h88M100 40v30" stroke="${k}" stroke-width="4" fill="none"/><path d="M66 40q2 14 16 16M134 40q-2 14-16 16" stroke="${k}" stroke-width="3" fill="none"/>`,
  jacket: (c, k) => `<path d="M72 26 40 40 16 150l26 8 14-66v84h88V92l14 66 26-8-24-110-32-14-28 30z" fill="${c}"/><path d="M100 56v120M72 26l28 30 28-30" stroke="${k}" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M68 122h20M112 122h20" stroke="${k}" stroke-width="4" stroke-linecap="round"/>`,
  bag: (c, k) => `<path d="M70 82q0-52 30-52t30 52" fill="none" stroke="${k}" stroke-width="8" stroke-linecap="round"/><path d="M40 80h120l12 96H28z" fill="${c}"/><path d="M40 80h120l3 24H37z" fill="${k}" opacity=".35"/><circle cx="100" cy="112" r="7" fill="${k}"/>`,
  shoe: (c, k) => `<path d="M20 132v-34q22 4 40-16l44 28q36 8 72 18 10 4 10 18z" fill="${c}"/><path d="M16 146h172v12q0 8-8 8H24q-8 0-8-8z" fill="${k}"/><path d="M70 90l14 20M84 98l14 18M98 106l12 14" stroke="${k}" stroke-width="4" stroke-linecap="round"/>`,
  pull: (c, k) => `<path d="M70 28 38 42 14 150l26 8 14-60v78h92V98l14 60 26-8-24-108-32-14q-30 18-60 0z" fill="${c}"/><path d="M70 28q30 18 60 0M54 162h92" stroke="${k}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
};
const garment = (t, c = "#204868", k = "#0c1b27") => `<svg viewBox="0 0 200 200">${G[t](c, k)}</svg>`;

/* catalogue de demonstration (articles fictifs) */
const ITEMS = {
  veste: { g: "jacket", c: "#7394ae", k: "#204868", bg: "#e4edf4", t: "Veste en jean vintage", p: "32,00 €", m: "Très bon état · @lea.m" },
  robe: { g: "dress", c: "#c9785c", k: "#8f4d37", bg: "#f6e3da", t: "Robe d'été terracotta", p: "24,00 €", m: "Neuf sans étiquette · @camille" },
  sac: { g: "bag", c: "#d9a441", k: "#8c6417", bg: "#faefd6", t: "Sac en cuir camel", p: "45,00 €", m: "Bon état · @ines.b" },
  basket: { g: "shoe", c: "#f5efe6", k: "#204868", bg: "#dfe9e0", t: "Baskets blanches", p: "38,00 €", m: "Très bon état · @tom" },
  pull: { g: "pull", c: "#a3b9a5", k: "#5d7a61", bg: "#eaf0ea", t: "Pull en laine sauge", p: "19,00 €", m: "Bon état · @zoe" },
  jean: { g: "jeans", c: "#204868", k: "#7394ae", bg: "#e8e4f0", t: "Jean droit brut", p: "22,00 €", m: "Neuf sans étiquette · @nour" },
  tee: { g: "tee", c: "#e6b8b0", k: "#b97f75", bg: "#fbeeeb", t: "T-shirt rose poudré", p: "9,00 €", m: "Bon état · @maya" },
};
const lst = (k, attrs = "", heart = "") => {
  const i = ITEMS[k];
  return `<div class="card lst"${attrs}><div class="ph" style="background:${i.bg}">${garment(i.g, i.c, i.k)}${heart}</div><div class="tx"><div class="ti">${i.t}</div><div class="pr">${i.p}</div><div class="me">${i.m}</div></div></div>`;
};
const gFloat = (k, x, y, size, rot, d, extra = "") => {
  const i = ITEMS[k];
  return `<div class="abs"${an(d, "pop", 0.9, `left:${x}px;top:${y}px;width:${size}px;height:${size}px;--ez:var(--back);${extra}`)}><div class="loop" style="--an:floatA;--du:${4 + (x % 3)}s;--r:${rot}deg;--fy:${-24 - (y % 20)}px;width:100%;height:100%;filter:drop-shadow(0 30px 30px rgba(12,27,39,.35))">${garment(i.g, i.c, i.k)}</div></div>`;
};

/* carton de fin commun (format libre, unites vmin) */
const endCard = (line = "Donnez une seconde vie\nà votre dressing", sub = "Achetez et vendez en seconde main") => `
  <div class="chev-bg loop" style="--an:floatA;--du:9s;--fx:-40px;--fy:-60px;--fr:0deg"></div>
  <div class="center" style="padding:0 7vmin">
    <div style="width:26vmin;height:26vmin;color:#fff">${mark("", 0.25)}</div>
    <div class="disp" style="font-size:17vmin;font-weight:700;margin-top:1vmin"><span class="w"><i${an(0.75, "rise", 1)}>Selio</i></span></div>
    <div${an(1.25, "growX", 0.8, "width:14vmin;height:.5vmin;background:#7394ae;border-radius:9px;margin:3.4vmin 0")}></div>
    <div class="disp it" style="font-size:6.4vmin;line-height:1.2">${words(line, 1.35, 0.06)}</div>
    <div${an(2.1, "up", 0.8, "font-size:3.7vmin;color:rgba(255,255,255,.75);margin-top:3.4vmin;font-weight:600;letter-spacing:.04em")}>${sub}</div>
  </div>`;

/* ---------- lecture ---------- */
const fmtN = {
  int: (v) => Math.round(v).toLocaleString("fr-FR"),
  eur: (v) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €",
  eur0: (v) => Math.round(v).toLocaleString("fr-FR") + " €",
  pct: (v) => Math.round(v) + " %",
};
SELIO.mount = (id, fmt) => {
  const v = SELIO.videos[id];
  const built = v.build(fmt);
  const stage = document.getElementById("stage");
  document.body.dataset.fmt = fmt;
  stage.innerHTML = built.html;
  stage.querySelectorAll(".bub, .disp i, .disp em").forEach((el) => el.childNodes.forEach((n) => { if (n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/ ([?!:…])/g, "\u00a0$1"); }));
  const scenes = [...stage.querySelectorAll(".scene")].map((el) => ({ el, start: +el.dataset.start, end: +el.dataset.end }));
  const abs = (el) => +el.dataset.at + +(el.closest(".scene")?.dataset.start || 0);
  const counters = [...stage.querySelectorAll("[data-count]")].map((el) => ({ el, t0: abs(el), dur: +el.dataset.cdur, from: +el.dataset.from, to: +el.dataset.to, f: fmtN[el.dataset.fmt] }));
  const typers = [...stage.querySelectorAll("[data-type]")].map((el) => ({ el, t0: abs(el), cps: +el.dataset.cps, text: el.dataset.type }));
  SELIO.dur = built.dur;
  SELIO.seek = (t) => {
    for (const s of scenes) s.el.style.display = t >= s.start - 1e-4 && t < s.end ? "" : "none";
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
    for (const c of counters) {
      const k = Math.min(1, Math.max(0, (t - c.t0) / c.dur));
      c.el.textContent = c.f(c.from + (c.to - c.from) * (1 - Math.pow(1 - k, 4)));
    }
    for (const y of typers) y.el.textContent = y.text.slice(0, Math.max(0, Math.floor((t - y.t0) * y.cps)));
  };
  SELIO.seek(0);
  return built.dur;
};
