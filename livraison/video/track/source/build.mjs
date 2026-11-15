// Vidéo « Selio Track : sache quoi acheter » (24 s, 1080 × 1920) : timeline + page scene.html.
// Tous les chiffres montrés sont fictifs (badge « Exemple · chiffres fictifs » à l'écran et mention finale).
import { readFileSync } from "node:fs";
import { buildPage, ph } from "../../commun/page.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const DURATION = 24;

const T = 300, S = 72;
const CAPS = [
  { top: 290, size: 92, words: [["Tu", 0.2], ["achètes", 0.32], ["au", 0.66], ["feeling ?", 0.8, "r"]], out: 1.9 },
  { top: T, size: S, words: [["Ce", 2.0], ["pull", 2.12], ["à", 2.35], ["8 €…", 2.45, "g"], ["\n"], ["il", 2.95], ["se", 3.05], ["revend", 3.15], ["combien ?", 3.45, "r"]], out: 4.35 },
  { top: T, size: 84, words: [["Avec", 4.45], ["Selio", 4.65, "g"], ["Track…", 4.9, "g"]], out: 6.2, slam: [4.9] },
  { top: T, size: S, words: [["Tu", 6.35], ["suis", 6.47], ["le", 6.7], ["marché", 6.8, "g"], ["\n"], ["de", 7.2], ["ce", 7.3], ["que", 7.4], ["tu", 7.5], ["revends :", 7.6]], out: 8.4 },
  { top: T, size: S, words: [["le", 8.5], ["prix", 8.6], ["médian,", 8.75, "g"], ["\n"], ["la", 9.2], ["fourchette", 9.3], ["de", 9.65], ["prix…", 9.75]], out: 10.7 },
  { top: T, size: S, words: [["les", 10.8], ["annonces", 10.92], ["qui", 11.25], ["disparaissent", 11.38, "g"], ["\n"], ["(vendues", 11.95], ["ou", 12.25], ["retirées).", 12.35]], out: 13.4 },
  { top: T, size: S, words: [["Chaque", 13.5], ["niche", 13.7], ["est", 13.95], ["notée", 14.05, "g"], ["sur", 14.3, "g"], ["100.", 14.42, "g"]], out: 15.6 },
  { top: T, size: S, words: [["Tu", 15.7], ["sais", 15.82], ["quoi", 16.0], ["acheter…", 16.12, "g"], ["\n"], ["et", 16.7], ["à", 16.8], ["quel", 16.9], ["prix.", 17.02, "g"]], out: 18.4 },
  { top: 290, size: 78, words: [["Sache", 18.75], ["quoi", 18.95], ["acheter", 19.1, "g"], ["\n"], ["avant", 19.5], ["d'acheter.", 19.66, "g"]], out: 23.9 },
];

// Données d'exemple (fictives).
const MEDIAN = [16, 16.5, 17, 17, 18, 18.5, 19, 19];
const GONE = [22, 25, 28, 24, 31, 29, 34, 37];
const SCORES = [["Demande", 82], ["Vitesse de vente", 74], ["Concurrence", 61], ["Marge", 80]];
const NICHE = 78;

const BRANDS = [{ tIn: 4.75, tOut: 6.15, y: 1150, sub: "Track" }, { tIn: 18.55, tOut: 25, y: 830, s: 0.92, sub: "Track" }];
const CTA = { t: 19.2, btn: "Essaie 14 jours gratuitement", bio: "Lien en bio", legal: "Outil indépendant, non affilié à Vinted ni aux marques citées.<br>Chiffres fictifs, pour l'exemple. Track montre des statistiques, pas d'annonces.", yBtn: 1290, yBio: 1450, yLegal: 1690 };
const SFX = [
  [0.2, "pop", 0], [0.8, "error", 0], [2.0, "swish", 0], [2.45, "kaching", 0], [3.45, "thud", 0],
  [4.2, "suck", 0.55], [4.75, "impact", 0], [4.75, "sparkle", 0.9], [5.2, "shine", 0], [6.1, "whoosh", 1],
  [6.35, "swish", 1], [6.7, "pop", 2], [8.6, "pop", 3], [8.9, "pop", 4], [9.0, "riser", 1.4], [10.5, "check", 0],
  ...GONE.map((_, i) => [11.0 + i * 0.1, "blip", i % 3]), [12.0, "coin", 0],
  [13.35, "whip", 0], [13.6, "riser", 1.0], [14.6, "ding", 0], ...SCORES.map((_, i) => [14.5 + i * 0.18, "pop", i + 2]),
  [16.1, "shimmer", 0], [17.0, "kaching", 0],
  [18.15, "suck", 0.4], [18.55, "impact", 1], [18.55, "shine", 0], [19.2, "pop", 4], [19.66, "ding", 1],
];
const FAST = [[4.1, 5.2], [6.1, 6.6], [13.2, 13.8], [18.0, 19.0], [19.15, 19.6]];
const TL = {
  DURATION, CAPS, BRANDS, CTA, SFX, FAST, MEDIAN, GONE, SCORES, NICHE,
  FLASH: [[4.75, 0.9, 0.45], [18.55, 0.45, 0.35]], BURSTS: [[4.75, 540, 1150, 1], [18.55, 540, 830, 0.7]], GLOW: [[4.7, 6.4], [18.5, 24]],
  CAPBAND: [[0, 0.01, 23.9, 24]],
};

// Courbe du prix médian (SVG 820 × 280).
const CW = 820, CH = 280, x = (i) => 30 + (i * (CW - 60)) / (MEDIAN.length - 1), y = (v) => CH - 30 - ((v - 14) / 7) * (CH - 70);
const LINE = MEDIAN.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
const AREA = `${LINE} L${x(MEDIAN.length - 1)},${CH - 30} L${x(0)},${CH - 30} Z`;

const css = `
#item { width: 520px; border-radius: 34px; overflow: hidden; background: #fff; color: #111; box-shadow: 0 50px 110px rgba(0,0,0,.6); }
#item img { display: block; width: 520px; height: 600px; object-fit: cover; }
#item .ip { padding: 18px 26px; font: 700 34px Inter; }
.ptag { padding: 18px 34px; border-radius: 26px; font: 800 52px Inter; white-space: nowrap; box-shadow: 0 30px 70px rgba(0,0,0,.5); }
#buy { background: #F3E2B3; color: #3A2A00; } #sell { background: rgba(180,35,24,.92); color: #fff; border: 3px solid #FF8F85; }
#mk, #niche { width: 900px; padding: 34px 40px 38px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.ttl { margin-top: 10px; font: 700 38px/1.15 Inter; letter-spacing: -.02em; }
.pill { display: inline-flex; align-items: center; gap: 10px; margin-top: 14px; padding: 8px 18px; border-radius: 99px; background: rgba(255,255,255,.07); font: 600 22px Inter; color: rgba(255,255,255,.7); }
.pill i { width: 12px; height: 12px; border-radius: 50%; background: #4ADE80; box-shadow: 0 0 10px #4ADE80; }
.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 22px; }
.kpi { padding: 18px 22px; border-radius: 22px; background: rgba(124,92,235,.14); border: 2px solid rgba(185,166,255,.25); }
.kpi small { display: block; font: 600 22px Inter; color: rgba(255,255,255,.55); } .kpi b { display: block; font: 800 50px Inter; letter-spacing: -.02em; margin-top: 4px; }
.sec { margin-top: 22px; font: 600 23px Inter; color: rgba(255,255,255,.55); display: flex; justify-content: space-between; }
.sec b { color: #F3E2B3; font-weight: 700; }
#bars { display: flex; align-items: flex-end; gap: 16px; height: 150px; margin-top: 12px; padding: 0 10px; }
#bars i { flex: 1; border-radius: 10px 10px 4px 4px; background: linear-gradient(180deg, #9B84F5, #5232B5); }
#bars i:last-child { background: linear-gradient(180deg, #F3E2B3, #C1933B); }
.gauge { display: flex; align-items: center; gap: 34px; margin-top: 24px; }
.gauge .num { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; } .gauge .num b { font: 800 84px Inter; letter-spacing: -.03em; } .gauge .num small { font: 600 24px Inter; color: rgba(255,255,255,.5); }
.sc { margin-bottom: 18px; } .sc div { display: flex; justify-content: space-between; font: 600 24px Inter; color: rgba(255,255,255,.75); } .sc span.tr { display: block; height: 14px; margin-top: 8px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; } .sc span.tr i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #7C5CEB, #B9A6FF); }
#verdict { display: flex; align-items: center; gap: 22px; margin-top: 26px; padding: 20px; border-radius: 24px; border: 3px solid rgba(226,198,124,.8); background: rgba(226,198,124,.08); }
#verdict img { width: 110px; height: 146px; object-fit: cover; border-radius: 16px; }
#verdict small { display: block; font: 600 24px Inter; color: rgba(255,255,255,.65); } #verdict b { display: block; font: 800 40px Inter; color: #F3E2B3; margin-top: 6px; }
`;
const body = `
<div class="layer" id="scene">
  <div class="sp" id="item"><img src="${ph("g-x4iv-1")}"/><div class="ip">Pull torsadé Tommy Hilfiger · XL</div></div>
  <div class="sp ptag" id="buy">Acheté 8 €</div>
  <div class="sp ptag" id="sell">Revente : ?</div>
  <div class="sp card" id="mk">
    <div class="top"><div class="kicker">Selio Track · filtre suivi</div><span class="badge">Exemple · chiffres fictifs</span></div>
    <div class="ttl">Pulls torsadés · Tommy Hilfiger</div>
    <div class="pill"><i></i>Relu toutes les 2 h</div>
    <div class="kpis"><div class="kpi" id="k0"><small>Prix médian</small><b id="kv0">19 €</b></div><div class="kpi" id="k1"><small>Fourchette (P25 – P75)</small><b>14 – 26 €</b></div></div>
    <div class="sec"><span>Prix médian, 8 dernières semaines</span></div>
    <svg id="chart" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" style="display:block;margin-top:6px">
      <defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(124,92,235,.45)"/><stop offset="1" stop-color="rgba(124,92,235,0)"/></linearGradient><clipPath id="clip"><rect id="cliprect" x="0" y="0" width="0" height="${CH}"/></clipPath></defs>
      ${[14, 17.5, 21].map((v) => `<line x1="20" x2="${CW - 20}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.08)" stroke-width="2"/>`).join("")}
      <g clip-path="url(#clip)"><path d="${AREA}" fill="url(#ar)"/><path d="${LINE}" fill="none" stroke="#B9A6FF" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
      ${MEDIAN.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === MEDIAN.length - 1 ? 11 : 7}" fill="${i === MEDIAN.length - 1 ? "#F3E2B3" : "#B9A6FF"}"/>`).join("")}</g>
    </svg>
    <div class="sec" id="gsec"><span>Annonces disparues par semaine</span><b id="gone">37 cette semaine</b></div>
    <div id="bars">${GONE.map(() => "<i></i>").join("")}</div>
  </div>
  <div class="sp card" id="niche">
    <div class="top"><div class="kicker">Note de la niche</div><span class="badge">Exemple · chiffres fictifs</span></div>
    <div class="ttl">Pulls torsadés · Tommy Hilfiger</div>
    <div class="gauge"><div style="position:relative;width:250px;height:250px;flex:none"><svg width="250" height="250" viewBox="0 0 250 250"><circle cx="125" cy="125" r="105" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="22"/><circle id="ring" cx="125" cy="125" r="105" fill="none" stroke="#E2C67C" stroke-width="22" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 105).toFixed(1)}" stroke-dashoffset="${(2 * Math.PI * 105).toFixed(1)}" transform="rotate(-90 125 125)"/></svg><div class="num"><b id="nv">0</b><small>sur 100</small></div></div>
      <div style="flex:1">${SCORES.map(([k, v], i) => `<div class="sc"><div><span>${k}</span><span id="sv${i}">${v}</span></div><span class="tr"><i id="sb${i}"></i></span></div>`).join("")}</div></div>
    <div id="verdict"><img src="${ph("g-x4iv-1")}"/><div><small>Acheté 8 € · prix médian 19 €</small><b>Écart estimé : + 11 €</b><small>avant tes frais (exemple)</small></div></div>
  </div>
</div>`;

buildPage({ here: HERE, TL, css, body, sceneJs: readFileSync(`${HERE}scene.js`, "utf8") });
