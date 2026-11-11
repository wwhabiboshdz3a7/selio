/* Selio motion — moteur déterministe : toute la vidéo est une fonction de seek(t). */
window.SELIO = { videos: {} };
const reg = (id, v) => (SELIO.videos[id] = v);
const ECR = "../../video-beta/source/ecrans/", BRAND = "../../../brand/";
const an = (d = 0, name = "up", du = 0.6, extra = "") => ` data-a style="--d:${d}s;--an:${name};--du:${du}s;${extra}"`;
const sfx = (kind, at, p = 0, n = 1, gap = 0.08) => `<i hidden data-sfx="${kind}" data-at="${at}" data-p="${p}" data-n="${n}" data-gap="${gap}"></i>`;

/* scènes transparentes posées sur le fond commun ; keep = la scène reste sous la suivante (même téléphone, écran suivant) */
function seq(scenes) {
  let t = 0;
  const html = scenes.map((s, i) => {
    const last = i === scenes.length - 1, end = t + s.dur;
    const h = `<section class="scene" data-start="${t}" data-end="${last ? 1e6 : end + (s.keep ? 0.5 : 0.06)}" style="--s:${t}s;--e:${last ? 1e6 : end - 0.26}s;${s.keep ? "--out:none2;" : ""}z-index:${i + 1}">${i ? sfx("whip", 0, i % 2) : ""}${s.html}</section>`;
    t = end;
    return h;
  }).join("");
  return { html, dur: t };
}

/* sous-titres karaoké : [début, fin, "texte avec *mots en or*"] ; les mots s'allument un par un */
function caps(list, o = {}) {
  return list.map(([t0, t1, text, opt = {}]) => {
    let i = 0, g = false;
    const step = opt.step ?? 0.13;
    const body = text.replace(/ ([?!:…])/g, "\u00a0$1").split("\n").map((line) => line.split(" ").map((w) => {
      if (w.startsWith("*")) g = true;
      const s = `<span class="cw"${an(t0 + 0.05 + step * i++, g ? "sayG" : "say", 0.22)}>${w.replace(/\*/g, "")}</span>`;
      if (w.endsWith("*")) g = false;
      return s;
    }).join(" ")).join("<br>");
    return `<div class="cap${opt.slam ? " slam" : ""}" style="--top:${opt.top ?? o.top ?? 250}px;--fs:${opt.fs ?? o.fs ?? 84}px"><div${an(t0, opt.slam ? "slam" : "up", opt.slam ? 0.4 : 0.35)}><div${an(t1 - 0.2, "out", 0.2)}>${body}</div></div></div>${opt.slam ? sfx("slam", t0, 1) : ""}`;
  }).join("");
}
const chip = (label) => `<div class="chip"${an(0.15, "pop", 0.5, "--ez:var(--back);transform-origin:100% 50%")}><i></i>${label}</div>`;
const count = (to, at, dur = 1.2, fmt = "eur", from = 0) => `<span data-count data-to="${to}" data-from="${from}" data-at="${at}" data-cdur="${dur}" data-fmt="${fmt}"></span>`;
const type = (text, at, cps = 30) => `<span data-type="${text.replace(/"/g, "&quot;")}" data-at="${at}" data-cps="${cps}"></span><span class="caret"></span>${sfx("type", at, 0, Math.ceil(text.length / cps / 0.08), 0.08)}`;

const ICON = {
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6L12 16.7 6.500 19.600l1.200-6L3.200 9.400l6.100-.8z"/>',
  heart: '<path d="M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0 1 12 7.600a4.300 4.300 0 0 1 7.500 2.200C19.500 15.400 12 20 12 20z"/>',
  shield: '<path d="M12 3l7 3v5.500c0 4.300-2.900 7.900-7 9.500-4.100-1.600-7-5.200-7-9.500V6z"/><path d="M9 12l2.200 2.200L15.200 10"/>',
  coin: '<circle cx="12" cy="12" r="8.500"/><path d="M14.500 9.200c-.6-.8-1.500-1.200-2.600-1.200-1.500 0-2.500.8-2.500 1.900 0 2.700 5.400 1.200 5.400 4 0 1.200-1.100 2.100-2.800 2.100-1.200 0-2.300-.5-2.900-1.400M12 6.500V8M12 16v1.500"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  box: '<path d="M3.500 7.500L12 3l8.500 4.500v9L12 21l-8.500-4.500zM3.500 7.500L12 12l8.500-4.500M12 12v9"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.500 2h-15zM10 20a2 2 0 0 0 4 0"/>',
  tag: '<path d="M3.500 12.500V4H12l8.500 8.500L12 21z"/><circle cx="8" cy="8.500" r="1.200"/>',
  msg: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  cam: '<path d="M3.500 8.500h4L9 6h6l1.500 2.500h4V19h-17z"/><circle cx="12" cy="13.500" r="3.500"/>',
  spark: '<path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM18.500 15.500l.8 2.200 2.200.8-2.200.8-.8 2.200-.8-2.200-2.200-.8 2.200-.8z"/>',
};
const svg = (k, color, size = 36) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const CK = '<svg viewBox="0 0 24 24" fill="none" stroke="#1C1A24" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>';

/* pastille flottante hors téléphone, centrée en (x, y), visible de t0 à t1 */
const fchip = (t0, t1, x, y, k, v, ic, gold = false) => `<div class="fcw" style="left:${x}px;top:${y}px"><div${an(t1 - 0.2, "out", 0.2)}><div${an(t0, "pop", 0.45, "--ez:var(--back)")}><div class="fchip${gold ? " gold" : ""}"><span class="ic">${svg(ic, gold ? "#E2C67C" : "#C9BBFF")}</span><div><small>${k}</small><b>${v}</b></div></div></div></div></div>${sfx(gold ? "kaching" : "pop", t0, gold ? 0 : 3)}`;

/* superpositions dans l'écran (coordonnées de la page, largeur 600) */
const hl = (d, x, y, w, h, d1 = 99) => `<div${an(d1, "out", 0.2, `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px`)}><div class="ov hl"${an(d, "pop", 0.4, "inset:0;--ez:var(--back)")}></div></div>${sfx("pop", d, 4)}`;
const ck = (d, x, y) => `<div class="ov ck"${an(d, "pop", 0.4, `left:${x}px;top:${y}px;--ez:var(--back)`)}>${CK}</div>${sfx("check", d)}`;
const bd = (d, x, y, v, gold = false) => `<div class="ov bd${gold ? " gold" : ""}"${an(d, "pop", 0.4, `left:${x}px;top:${y}px;--ez:var(--back)`)}>${v}</div>${sfx("pop", d, gold ? 4 : 2)}`;
const tapS = (d, x, y) => `<div class="tapc"${an(d, "ripple", 0.6, `left:${x}px;top:${y}px;--ez:ease-out`)}></div>${sfx("tap", d)}`;

/* iPhone avec un vrai écran de la démo ; scroll = [[instant, déplacement px, durée], …] */
function phone(page, { top = 500, scroll = [], ov = "", enter = true, hd = 168, zoom = null } = {}) {
  const src = `${ECR}page-${page}.png`;
  let inner = `<img class="pg" src="${src}">${ov}`;
  for (const [d, dy, du = 1.2] of [...scroll].reverse()) inner = `<div${an(d, "move", du, `--y1:${-dy}px;--ez:var(--io)`)}>${inner}</div>`;
  const z = zoom ? an(zoom[0], "move", zoom[4] ?? 1.2, `--s1:${zoom[1]};--ez:var(--io);transform-origin:${zoom[2]}px ${zoom[3]}px;position:absolute;inset:0`) : ' style="position:absolute;inset:0"';
  return `<div${z}><div class="phoneL"${enter ? an(0.1, "phoneIn", 1.0, `top:${top}px`) : ` style="top:${top}px"`}><div class="phone loop" style="--an:floatP;--du:5s"><div class="di"></div>
    <div class="screen"><div class="pgc">${inner}</div><div class="phd" style="height:${hd}px"><img src="${src}"></div><div class="sheen"${an(0.9, "shine", 1.4, "--ez:linear")}></div></div></div></div></div>${enter ? sfx("whoosh", 0.1) : ""}`;
}
const notif = (t0, t1, top, title, body) => `<div style="position:absolute;inset:0;z-index:20"><div${an(t1 - 0.25, "out", 0.25)}><div class="notif"${an(t0, "drop", 0.55, `top:${top}px`)}><img src="${BRAND}selio-app-icon-noir.png"><div style="flex:1"><div class="hd"><b>SELIO</b><span>maintenant</span></div><div class="ti">${title}</div><div class="bo">${body}</div></div></div></div></div>${sfx("notif", t0)}${sfx("buzz", t0)}${sfx("buzz", t0 + 0.4)}`;

const logo = (d, w = 600) => `<div class="logo"${an(d, "slam", 0.5, `width:${w}px;height:${(w * 186) / 600}px`)}><img src="${BRAND}selio-logo-blanc.png"><div class="ls"${an(d + 0.5, "shine", 1.1, "--ez:linear")}></div></div>`;
const CTA = "Essaie 14 jours gratuits";
const DISCLAIMER = "Carte enregistrée à l'inscription, rien n'est débité avant la fin.<br>Outil indépendant, non affilié à Vinted ni aux marques citées. Chiffres de démonstration.";
const THUMBS = ["overview", "radar", "studioann", "nego", "autohub", "analytics", "dressing", "cloud"];
const capWords = (text, d0, step = 0.16) => { let i = 0, g = false; return text.replace(/ ([?!:…])/g, "\u00a0$1").split("\n").map((l) => l.split(" ").map((w) => { if (w.startsWith("*")) g = true; const s = `<span class="cw"${an(d0 + step * i++, g ? "sayG" : "say", 0.22)}>${w.replace(/\*/g, "")}</span>`; if (w.endsWith("*")) g = false; return s; }).join(" ")).join("<br>"); };

/* carton final vertical : logo, promesse, bouton, mention, carrousel d'écrans */
const endCard = (lines = "Du sourcing\nà la vente,\nun *seul écosystème.*", th = 0, cta = CTA) => `
  <div class="flash"${an(0, "flash", 0.7, "--ez:ease-out")}></div>${sfx("impact", 0)}${sfx("sparkle", 0, 0.9)}${sfx("shine", 0.5)}
  <div style="position:absolute;left:240px;top:330px">${logo(0.05)}</div>
  <div class="cap slam" style="--top:560px;--fs:98px"><div${an(0.35, "up", 0.5)}>${capWords(lines, 0.5)}</div></div>
  <div style="position:absolute;left:0;right:0;top:930px;text-align:center"><div class="btn"${an(1.5, "pop", 0.5, "--ez:var(--back)")}>${cta}<div class="sh"${an(2.0, "shineX", 0.9, "--ez:linear")}></div></div>${sfx("pop", 1.5, 4)}
    <div${an(1.9, "up", 0.5, "font:600 34px Inter;margin-top:34px")}>Lien en bio ↓</div>${sfx("ding", 1.9, 1)}
    <div class="small"${an(2.2, "fade", 0.6, "margin-top:26px")}>${DISCLAIMER}</div></div>
  <div style="position:absolute;inset:0;perspective:1700px">${[0, 1, 2, 3, 4].map((i) => `<div${an(0.5 + i * 0.09, "up", 0.9, `position:absolute;left:${-170 + i * 290}px;top:${1390 + Math.abs(i - 2) * 50}px`)}><div class="loop" style="--an:drift;--du:8s;--dx:-90px"><div class="cc" style="transform:rotateY(${(2 - i) * 16}deg) rotateX(6deg)"><img src="${ECR}thumb-${THUMBS[(i + th) % 8]}.jpg"></div></div></div>`).join("")}</div>`;

/* carton final en vmin (9:16, 16:9, 1:1) */
const endFlex = (lines = "Du sourcing à la vente,\nun *seul écosystème.*", cta = CTA) => `
  <div class="flash"${an(0, "flash", 0.7, "--ez:ease-out")}></div>${sfx("impact", 0)}${sfx("sparkle", 0, 0.9)}${sfx("shine", 0.5)}
  <div class="center" style="padding:0 6vmin"><div style="font-size:0">${logo(0.05, 0).replace("width:0px;height:0px", "width:56vmin;height:17.36vmin")}</div>
    <div class="fx" style="font-size:7.6vmin;font-weight:800;margin-top:5vmin"><div${an(0.35, "up", 0.5)}>${capWords(lines, 0.5)}</div></div>
    <div class="btn"${an(1.6, "pop", 0.5, "--ez:var(--back);margin-top:6vmin;font-size:4.4vmin;padding:3.2vmin 6vmin")}>${cta}<div class="sh"${an(2.1, "shineX", 0.9, "--ez:linear")}></div></div>${sfx("pop", 1.6, 4)}
    <div class="small"${an(2.2, "fade", 0.6, "margin-top:4vmin;font-size:2.2vmin")}>${DISCLAIMER}</div></div>`;

function background() {
  let s = '<div class="bg"></div>';
  for (let i = 0; i < 70; i++) {
    const r = (n) => { const v = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return v - Math.floor(v); };
    const sz = 2 + r(3) * 4;
    s += `<div class="star" style="left:${(r(1) * 100).toFixed(2)}%;top:${(r(2) * 100).toFixed(2)}%;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;--du:${(2.5 + r(4) * 4).toFixed(2)}s;--ld:${(-r(5) * 6).toFixed(2)}s${r(6) > 0.85 ? ";background:#E2C67C" : ""}"></div>`;
  }
  return s;
}

const fmtN = {
  int: (v) => Math.round(v).toLocaleString("fr-FR"),
  eur: (v) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €",
  peur: (v) => "+" + v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €",
  hms: (v) => { const s = Math.floor(v); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":"); },
};
SELIO.mount = (id, fmt) => {
  const built = SELIO.videos[id].build(fmt);
  const stage = document.getElementById("stage");
  stage.innerHTML = background() + built.html + '<div class="vig"></div>';
  stage.querySelectorAll(".cw, .fx span, .msg").forEach((el) => el.childNodes.forEach((n) => { if (n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/ ([?!:…])/g, " $1"); }));
  const scenes = [...stage.querySelectorAll(".scene")].map((el) => ({ el, start: +el.dataset.start, end: +el.dataset.end }));
  const abs = (el) => +el.dataset.at + +(el.closest(".scene")?.dataset.start || 0);
  const counters = [...stage.querySelectorAll("[data-count]")].map((el) => ({ el, t0: abs(el), dur: +el.dataset.cdur, from: +el.dataset.from, to: +el.dataset.to, f: fmtN[el.dataset.fmt] }));
  const typers = [...stage.querySelectorAll("[data-type]")].map((el) => ({ el, t0: abs(el), cps: +el.dataset.cps, text: el.dataset.type }));
  SELIO.dur = built.dur;
  SELIO.fin = scenes[scenes.length - 1].start;
  SELIO.sfx = [];
  stage.querySelectorAll("[data-sfx]").forEach((el) => { for (let i = 0; i < +el.dataset.n; i++) SELIO.sfx.push([+(abs(el) + i * +el.dataset.gap).toFixed(3), el.dataset.sfx, +el.dataset.p + (el.dataset.sfx === "type" ? i : 0)]); });
  SELIO.sfx = SELIO.sfx.filter((e) => e[0] < built.dur - 0.2).sort((a, b) => a[0] - b[0]);
  SELIO.seek = (t) => {
    for (const s of scenes) s.el.style.display = t >= s.start - 1e-4 && t < s.end ? "" : "none";
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
    for (const c of counters) { const k = Math.min(1, Math.max(0, (t - c.t0) / c.dur)); c.el.textContent = c.f(c.from + (c.to - c.from) * (c.el.dataset.fmt === "hms" ? k : 1 - Math.pow(1 - k, 4))); }
    for (const y of typers) y.el.textContent = y.text.slice(0, Math.max(0, Math.floor((t - y.t0) * y.cps)));
  };
  SELIO.seek(0);
  return built.dur;
};

/* ligne de liste (coche or, ou croix rouge avec no = true) */
const crow = (d, y, text, no = false) => `<div class="crow${no ? " no" : ""}"${an(d, "up", 0.45, `top:${y}px`)}><span class="ok">${no ? '<svg viewBox="0 0 24 24" fill="none" stroke="#1C1A24" stroke-width="3.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>' : CK}</span><span>${text}</span></div>${sfx(no ? "tick" : "check", d)}`;
const plan = (d, y, name, profile, detail, hot = false) => `<div class="plan${hot ? " hot" : ""}"${an(d, "up", 0.5, `top:${y}px`)}><b>${name}</b><span>${profile}</span><small>${detail}</small></div>${sfx("pop", d, hot ? 4 : 2)}`;
