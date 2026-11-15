// Vidéo « Selio Studio : tes photos deviennent une annonce » (27 s, 1080 × 1920) : timeline + page scene.html.
import { readFileSync } from "node:fs";
import { buildPage, ph } from "../../commun/page.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const DURATION = 27;

// ---------- Sous-titres karaoké (g = or, r = rouge) ----------
const T = 300, S = 72;
const CAPS = [
  { top: 290, size: 90, words: [["Tes", 0.2], ["photos", 0.36], ["sont", 0.66], ["prêtes…", 0.8], ["\n"], ["et", 1.5], ["l'annonce ?", 1.65, "g"]], out: 2.9 },
  { top: T, size: S, words: [["Titre,", 3.05], ["marque,", 3.4], ["taille,", 3.72], ["\n"], ["mesures,", 4.02], ["description…", 4.35, "g"]], out: 5.0 },
  { top: T, size: S, words: [["Et", 5.1], ["tu", 5.22], ["recommences", 5.34], ["\n"], ["pour", 5.85], ["chaque", 6.0, "r"], ["article.", 6.25, "r"]], out: 6.75 },
  { top: T, size: 84, words: [["Avec", 6.85], ["Selio", 7.05, "g"], ["Studio…", 7.3, "g"]], out: 8.5, slam: [7.3] },
  { top: T, size: S, words: [["Tu", 8.7], ["déposes", 8.85], ["tes", 9.15], ["photos.", 9.3, "g"]], out: 9.95 },
  { top: T, size: S, words: [["Studio", 10.05], ["lit", 10.35], ["l'étiquette :", 10.48], ["\n"], ["la", 10.95], ["marque,", 11.05, "g"], ["la", 11.4], ["taille…", 11.5, "g"]], out: 12.3 },
  { top: T, size: S, words: [["les", 12.4], ["mesures,", 12.55, "g"], ["\n"], ["sur", 12.95], ["le", 13.08], ["mètre", 13.18], ["ruban…", 13.4]], out: 14.1 },
  { top: T, size: S, words: [["et", 14.2], ["il", 14.32], ["rédige", 14.42], ["le", 14.7], ["titre", 14.8, "g"], ["\n"], ["et", 15.1], ["la", 15.2], ["description.", 15.3, "g"]], out: 16.5 },
  { top: T, size: S, words: [["Ce", 16.6], ["qu'il", 16.72], ["ne", 16.9], ["voit", 17.0], ["pas,", 17.2], ["\n"], ["il", 17.6], ["te", 17.7], ["le", 17.8], ["demande.", 17.9, "g"]], out: 19.3 },
  { top: T, size: S, words: [["Tu", 19.45], ["relis,", 19.6], ["tu", 19.95], ["ajustes,", 20.08], ["\n"], ["tu", 20.5], ["publies.", 20.62, "g"]], out: 21.3 },
  { top: T, size: 84, words: [["Tu", 21.4], ["gardes", 21.55], ["la", 21.85], ["main.", 21.95, "g"]], out: 22.7, slam: [21.95] },
  { top: T, size: 80, words: [["Tes", 23.0], ["photos", 23.15], ["deviennent", 23.45], ["\n"], ["une", 23.85], ["annonce.", 24.0, "g"]], out: 26.85 },
];

// ---------- Scène ----------
const PHOTOS = [1, 2, 3, 4, 5, 6, 7].map((k) => `g-yw5b-${k}`);
const ITEM = {
  title: "Pull à pois Tommy Hilfiger marine",
  attrs: [["Marque", "Tommy Hilfiger", "lue sur l'étiquette"], ["Taille", "M", "lue sur l'étiquette"], ["Couleur", "Bleu marine", "vue sur les photos"], ["Catégorie", "Pulls ras de cou", "vue sur les photos"]],
  desc: "Joli pull Tommy Hilfiger bleu marine à pois blancs, taille M. Maille douce, coupe classique, col rond. Mesures à plat en photo. Envoi rapide et soigné.",
};
const FIELDS = ["Titre", "Marque", "Taille", "Mesures", "Description"];
const FIELD_T = [3.05, 3.4, 3.72, 4.02, 4.35];
const T_CARD = 14.2, T_TITLE = [14.45, 15.15], T_ATTR = [14.85, 15.05, 15.25, 15.45], T_DESC = [15.3, 16.45];
const T_Q = 16.85, T_QTAP = 17.75, T_QTYPE = [17.95, 18.35], T_QOK = 18.55, T_PUB = 20.62;

const BRANDS = [{ tIn: 6.95, tOut: 8.4, y: 1150, sub: "Studio" }, { tIn: 22.85, tOut: 28, y: 830, s: 0.92, sub: "Studio" }];
const CTA = { t: 23.6, btn: "Essaie 14 jours gratuitement", bio: "Lien en bio", legal: "Outil indépendant, non affilié à Vinted ni aux marques citées.<br>Démonstration sur photos d'exemple : relis l'annonce avant de publier.", yBtn: 1290, yBio: 1450, yLegal: 1690 };

const SFX = [
  ...PHOTOS.map((_, i) => [0.1 + i * 0.12, "pop", i]),
  [1.65, "shimmer", 0], [2.95, "swish", 0], [3.0, "slam", 0],
  ...FIELD_T.map((t, i) => [t, "blip", i % 3]),
  ...Array.from({ length: 24 }, (_, i) => [5.3 + i * 0.045, "tick", 0]), [6.4, "error", 0],
  [6.45, "suck", 0.5], [6.95, "impact", 0], [6.95, "sparkle", 0.9], [7.4, "shine", 0], [8.45, "whoosh", 1],
  ...PHOTOS.map((_, i) => [8.75 + i * 0.08, "pop", i]), [9.3, "swish", 1],
  [10.0, "whip", 0], [10.15, "riser", 0.7], [10.85, "check", 0], [11.05, "pop", 3], [11.5, "pop", 4],
  [12.4, "whip", 1], [12.6, "shimmer", 0], [12.95, "pop", 5],
  [14.2, "whoosh", 0], ...Array.from({ length: 16 }, (_, i) => [T_TITLE[0] + i * 0.045, "type", i]),
  ...T_ATTR.map((t, i) => [t, "pop", i + 2]), ...Array.from({ length: 22 }, (_, i) => [T_DESC[0] + i * 0.05, "type", 30 + i]),
  [T_Q, "notif", 0], [T_QTAP, "tap", 0], ...Array.from({ length: 5 }, (_, i) => [T_QTYPE[0] + i * 0.08, "key", i]), [T_QOK, "check", 0],
  [T_PUB, "tap", 0], [T_PUB + 0.08, "kaching", 0], [21.95, "ding", 1],
  [22.55, "suck", 0.3], [22.85, "impact", 1], [22.85, "shine", 0], [23.6, "pop", 4], [24.0, "ding", 0], [24.1, "tap", 0],
];
const FAST = [[2.9, 3.4], [6.4, 7.4], [8.4, 9.5], [9.95, 10.2], [12.35, 12.6], [14.1, 14.6], [22.5, 23.3], [23.55, 24.2]];
const TL = {
  DURATION, CAPS, BRANDS, CTA, SFX, FAST, PHOTOS, ITEM, FIELDS, FIELD_T, T_CARD, T_TITLE, T_ATTR, T_DESC, T_Q, T_QTAP, T_QTYPE, T_QOK, T_PUB,
  FLASH: [[6.95, 0.9, 0.45], [22.85, 0.45, 0.35]], BURSTS: [[6.95, 540, 1150, 1], [22.85, 540, 830, 0.7]], GLOW: [[6.85, 8.7], [22.8, 27]],
  CAPBAND: [[0, 0.01, 26.9, 27]],
};

const ICO = {
  tag: '<path d="M3 12V4h8l9.5 9.5-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6.5 8v3M10 8v4M13.5 8v3M17 8v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  q: '<circle cx="12" cy="12" r="9.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2.9-1.2 1.8v.4M12 17.2h.01"/>',
};
const ic = (k, c = "#C9BBFF") => `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;

const css = `
.pcard { position: absolute; left: 0; top: 0; width: 280px; height: 373px; border-radius: 26px; overflow: hidden; border: 5px solid #fff; box-shadow: 0 40px 90px rgba(0,0,0,.55); background: #ddd; }
.pcard img { width: 100%; height: 100%; object-fit: cover; display: block; }
#form { width: 860px; padding: 40px 44px; }
#form h3 { font: 700 40px Inter; margin: 10px 0 26px; }
.fl { margin-bottom: 20px; } .fl small { display: block; font: 600 23px Inter; color: rgba(255,255,255,.55); margin-bottom: 8px; }
.fl div { height: 74px; border-radius: 18px; border: 2px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); padding: 18px 22px; font: 500 30px Inter; color: rgba(255,255,255,.3); }
.fl.big div { height: 150px; } .fl.on div { border-color: #9B84F5; box-shadow: 0 0 0 5px rgba(124,92,235,.25); color: #fff; }
#count { padding: 14px 26px; border-radius: 99px; font: 700 34px Inter; background: rgba(180,35,24,.4); border: 2px solid rgba(240,133,122,.85); color: #FFD9D4; white-space: nowrap; }
#view { width: 720px; height: 960px; border-radius: 40px; overflow: hidden; border: 3px solid rgba(255,255,255,.18); box-shadow: 0 50px 120px rgba(0,0,0,.6); background: #222; }
#view .vi { position: absolute; inset: 0; } #view .vi img { width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: 50% 50%; }
#scanl { position: absolute; left: 0; right: 0; height: 6px; background: #B9A6FF; box-shadow: 0 0 30px 10px rgba(124,92,235,.65); }
#hl { position: absolute; border: 5px solid #E2C67C; border-radius: 18px; box-shadow: 0 0 40px rgba(226,198,124,.6), inset 0 0 30px rgba(226,198,124,.25); }
#tape { position: absolute; width: 10px; border-radius: 6px; background: #E2C67C; box-shadow: 0 0 30px 8px rgba(226,198,124,.6); }
#vtag { position: absolute; left: 26px; top: 26px; }
.thumb { position: absolute; left: 0; top: 0; width: 112px; height: 150px; border-radius: 16px; overflow: hidden; border: 3px solid rgba(255,255,255,.25); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; } .thumb.on { border-color: #E2C67C; box-shadow: 0 0 24px rgba(226,198,124,.6); }
#card { width: 900px; padding: 38px 42px 40px; }
#card .top { display: flex; align-items: center; justify-content: space-between; }
#card .row { display: flex; gap: 28px; margin-top: 26px; align-items: center; }
#card .row img { width: 170px; height: 227px; object-fit: cover; border-radius: 20px; flex: none; }
#card .lbl { font: 600 22px Inter; color: rgba(255,255,255,.5); }
#ttl { font: 700 44px/1.15 Inter; letter-spacing: -.02em; margin-top: 8px; min-height: 102px; }
#attrs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 24px; }
.at { padding: 14px 20px; border-radius: 18px; background: rgba(124,92,235,.14); border: 2px solid rgba(185,166,255,.25); }
.at small { display: block; font: 600 20px Inter; color: rgba(255,255,255,.5); } .at b { display: block; font: 700 30px Inter; margin: 2px 0; } .at i { display: block; font: 500 18px Inter; font-style: normal; color: #C9BBFF; }
#desc { margin-top: 22px; padding: 18px 22px; min-height: 180px; border-radius: 18px; border: 2px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03); font: 500 27px/1.42 Inter; color: #E9E6F2; }
#qbox { margin-top: 22px; padding: 18px 22px; border-radius: 18px; border: 3px solid rgba(226,198,124,.8); background: rgba(226,198,124,.08); }
#qbox .qh { display: flex; align-items: center; gap: 12px; font: 600 26px/1.3 Inter; color: #F3E2B3; }
#qin { margin-top: 12px; height: 64px; border-radius: 14px; background: rgba(0,0,0,.3); border: 2px solid rgba(255,255,255,.18); padding: 14px 18px; font: 600 30px Inter; display: flex; align-items: center; gap: 10px; }
#pub { margin-top: 24px; height: 96px; border-radius: 26px; display: flex; align-items: center; justify-content: center; gap: 14px; font: 700 36px Inter; background: linear-gradient(90deg, #5232B5, #7C5CEB); box-shadow: 0 16px 40px rgba(100,66,214,.45); }
#pub.ok { background: linear-gradient(90deg, #15803D, #22C55E); box-shadow: 0 16px 40px rgba(34,197,94,.4); }
`;

const body = `
<div class="layer" id="scene">
  ${PHOTOS.map((p, i) => `<div class="pcard" id="pc${i}"><img src="${ph(p)}"/></div>`).join("")}
  <div class="sp card" id="form"><div class="kicker">Nouvelle annonce</div><h3>À remplir à la main</h3>
    ${FIELDS.map((f, i) => `<div class="fl${i === 4 ? " big" : ""}" id="fl${i}"><small>${f}</small><div></div></div>`).join("")}
  </div>
  <div class="sp" id="count">Article 1 / 24</div>
  <div class="sp" id="view">${["g-yw5b-1", "g-yw5b-2", "g-yw5b-3"].map((p, i) => `<div class="vi" id="vi${i}"><img src="${ph(p)}"/></div>`).join("")}
    <div id="hl"></div><div id="tape"></div><div id="scanl"></div><div id="vtag" class="badge">Analyse des photos</div></div>
  ${PHOTOS.map((p, i) => `<div class="thumb" id="th${i}"><img src="${ph(p)}"/></div>`).join("")}
  <div class="sp chip gold" id="ch0"><span class="ic">${ic("tag", "#E2C67C")}</span><div><small>Marque · lue sur l'étiquette</small><b>Tommy Hilfiger</b></div></div>
  <div class="sp chip gold" id="ch1"><span class="ic">${ic("tag", "#E2C67C")}</span><div><small>Taille · lue sur l'étiquette</small><b>M</b></div></div>
  <div class="sp chip" id="ch2"><span class="ic">${ic("ruler")}</span><div><small>Mesures</small><b>lues sur le mètre ruban</b></div></div>
  <div class="sp card" id="card">
    <div class="top"><div class="kicker">Selio Studio · annonce</div><span class="badge">Exemple</span></div>
    <div class="row"><img src="${ph("g-yw5b-1")}"/><div style="flex:1;min-width:0"><div class="lbl">Titre</div><div id="ttl"></div></div></div>
    <div id="attrs">${ITEM.attrs.map(([k, v, w], i) => `<div class="at" id="at${i}"><small>${k}</small><b>${v}</b><i>${w}</i></div>`).join("")}</div>
    <div id="desc"></div>
    <div id="qbox"><div class="qh">${ic("q", "#E2C67C")}<span id="qtxt">Matière : pas lisible sur les photos. Tu peux la préciser ?</span></div><div id="qin"></div></div>
    <div id="pub">Publier l'annonce</div>
  </div>
  <div class="tap" id="tap"></div>
</div>`;

buildPage({ here: HERE, TL, css, body, sceneJs: readFileSync(`${HERE}scene.js`, "utf8") });
