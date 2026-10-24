// Vidéo « Et si une appli centralisait tout ? » : timeline + page HTML pilotée par seek(t).
// Écrit scene.html (rendu image par image) et timeline.json (sous-titres et bruitages pour l'audio et le SRT).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = new URL("../../../", import.meta.url).pathname; // racine du dépôt
const FONT = dirname(createRequire(`${ROOT}apps/web/package.json`).resolve("@fontsource/inter/package.json")) + "/files";
const MOCK = `${HERE}ecrans`; // captures iPhone de la démo, mode sombre
const LOGO = `${ROOT}brand/selio-logo-blanc.png`;
const PULL = `${ROOT}apps/web/public/demo/photos/g-yw5b-1.webp`;
const SI = `${HERE}logos`; // Simple Icons, CC0
const DURATION = 35;

// ---------- Logos : Simple Icons (CC0) pour les marques disponibles, icônes génériques sinon ----------
const siPath = (slug) => readFileSync(`${SI}/${slug}.svg`, "utf8").match(/ d="([^"]+)"/)[1];
const fill = (d, color = "#fff") => `<path d="${d}" fill="${color}"/>`;
const stroke = (inner, color = "#fff", w = 1.7) => `<g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const LOGOS = {
  vinted: { bg: "#007782", svg: fill(siPath("vinted")), name: "Vinted" },
  discord: { bg: "#5865F2", svg: fill(siPath("discord")), name: "Discord" },
  whatsapp: { bg: "#25D366", svg: fill(siPath("whatsapp")), name: "WhatsApp" },
  gemini: { bg: "#FFFFFF", svg: `<defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4285F4"/><stop offset=".55" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs>${fill(siPath("googlegemini"), "url(#gm)")}`, name: "Gemini" },
  // Génériques (aucun logo officiel reproduit) : le nom de l'appli est écrit sous l'icône.
  excel: { bg: "#107C41", svg: stroke(`<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>`), name: "Excel" },
  calc: { bg: "#2C2C2E", svg: `${stroke(`<rect x="5" y="2.8" width="14" height="18.4" rx="2.6"/><rect x="7.6" y="5.4" width="8.8" height="3.6" rx=".8"/>`, "#FF9F0A")}${[[8.8, 12.4], [12, 12.4], [15.2, 12.4], [8.8, 15.4], [12, 15.4], [15.2, 15.4], [8.8, 18.4], [12, 18.4], [15.2, 18.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.05" fill="#FF9F0A"/>`).join("")}`, name: "Calculatrice" },
  chatgpt: { bg: "#0D0D0D", svg: `${stroke(`<path d="M5.2 4.6h13.6a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2h-6.6l-4.4 3.6v-3.6H5.2A2.2 2.2 0 0 1 3 15V6.8a2.2 2.2 0 0 1 2.2-2.2z"/>`)}<path d="M12 7.2l1.05 2.45 2.45 1.05-2.45 1.05L12 14.2l-1.05-2.45L8.5 10.7l2.45-1.05z" fill="#fff"/>`, name: "ChatGPT" },
  photos: { bg: "#FFFFFF", svg: `${stroke(`<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6"/>`, "#8E8E93", 1.6)}<circle cx="9" cy="9.6" r="1.9" fill="#FF9F0A"/><path d="M4 17.6l4.6-4.8 3.6 3.6 2.8-2.8 5 4.4v.4H4z" fill="#34C759"/>`, name: "Photos" },
  notes: { bg: "#FFD60A", svg: stroke(`<path d="M7 7.5h10M7 11.5h10M7 15.5h6"/>`, "#3A2E00", 2), name: "Notes" },
};

// ---------- Timeline (secondes) ----------
// Sous-titres karaoké : chaque mot s'allume quand la voix le dit. g = or (mot clé), r = rouge.
const CAPS = [
  { top: 600, size: 94, width: 940, words: [["Combien", 0.2], ["d'applis", 0.48], ["tu", 0.8], ["ouvres…", 0.92], ["pour", 1.55], ["vendre", 1.72], ["un", 2.02, "g"], ["seul", 2.15, "g"], ["pull ?", 2.38, "g"]], out: 2.98 },
  { top: 330, size: 70, words: [["Les", 3.05], ["annonces", 3.18], ["sur", 3.48], ["Vinted.", 3.62, "g"]], out: 4.12 },
  { top: 330, size: 70, words: [["Le", 4.2], ["stock", 4.32], ["sur", 4.58], ["Excel…", 4.7, "g"]], out: 5.08 },
  { top: 330, size: 66, words: [["Les", 5.15], ["marges", 5.28], ["à", 5.58], ["la", 5.66], ["calculette,", 5.78, "g"], ["\n"], ["le", 6.1], ["sourcing", 6.22], ["sur", 6.6], ["Discord…", 6.74, "g"]], out: 7.45 },
  { top: 330, size: 66, words: [["Et", 7.55], ["ChatGPT", 7.68, "g"], ["ou", 8.1], ["Gemini…", 8.22, "g"], ["\n"], ["en", 8.85], ["copier-coller.", 9.0, "g"]], out: 9.72 },
  { top: 320, size: 96, words: [["Neuf", 9.9, "r"], ["applis.", 10.1, "r"], ["\n"], ["Pour", 10.55], ["un", 10.7], ["pull.", 10.82]], out: 11.45, glitch: true },
  { top: 700, size: 100, width: 880, words: [["Et", 11.75], ["si…", 11.9], ["\n"], ["une", 12.45, "g"], ["seule", 12.62, "g"], ["appli", 12.85, "g"], ["\n"], ["centralisait", 13.15], ["tout ?", 13.62]], out: 13.98 },
  { top: 1330, size: 64, words: [["Voici", 14.95], ["Selio.", 15.22, "g"]], out: 15.95 },
  { top: 330, size: 70, words: [["Ton", 16.3], ["stock,", 16.45], ["tes", 16.85], ["ventes", 17.0, "g"]], out: 17.4 },
  { top: 330, size: 66, words: [["et", 17.45], ["tes", 17.58], ["vraies", 17.72, "g"], ["marges…", 17.95, "g"], ["\n"], ["au", 18.75], ["même", 18.88], ["endroit.", 19.05]], out: 19.85 },
  { top: 330, size: 72, words: [["Une", 20.2], ["offre", 20.33], ["trop", 20.62, "r"], ["basse ?", 20.78, "r"]], out: 21.3 },
  { top: 330, size: 66, words: [["Selio", 21.4], ["calcule", 21.62], ["la", 21.95], ["bonne", 22.05, "g"], ["contre-offre,", 22.25, "g"]], out: 23.0 },
  { top: 330, size: 66, words: [["sans", 23.05], ["jamais", 23.2], ["passer", 23.5], ["sous", 23.75], ["ton", 23.88], ["prix", 24.0, "g"], ["plancher.", 24.15, "g"]], out: 24.9 },
  { top: 330, size: 66, words: [["Chaque", 25.2], ["annonce", 25.38], ["\n"], ["est", 25.72], ["notée", 25.85, "g"], ["sur", 26.12, "g"], ["100 :", 26.25, "g"]], out: 26.92, spoken: "Chaque annonce est notée sur cent :" },
  { top: 330, size: 66, words: [["tu", 27.0], ["sais", 27.1], ["quoi", 27.25], ["republier,", 27.42, "g"], ["\n"], ["et", 28.05], ["quand.", 28.2, "g"]], out: 28.88 },
  { top: 800, size: 92, words: [["Une", 29.2], ["appli.", 29.38], ["\n"], ["Tout", 29.85], ["ton", 30.0], ["business", 30.12, "g"], ["Vinted.", 30.45, "g"]], out: 99 },
];
// Fin de la voix off, portée par le bouton et « Lien en bio » (pas de sous-titre incrusté en double).
const VO_TAIL = { words: [["Rejoins", 31.0], ["la", 31.22], ["bêta", 31.32], ["gratuite :", 31.52], ["lien", 32.05], ["en", 32.2], ["bio.", 32.3]], out: 33.2 };

const TILES = [
  { id: "vinted", label: "les annonces", x: 540, y: 720, rot: 0, tIn: 3.1, from: [0, 0], blur: [7.55, 9.15] },
  { id: "excel", label: "le stock", x: 230, y: 830, rot: -8, tIn: 4.25, from: [-420, 60], blur: [7.55, 9.85] },
  { id: "calc", label: "les marges", x: 850, y: 830, rot: 7, tIn: 5.2, from: [420, 60], blur: [7.55, 9.85] },
  { id: "discord", label: "le sourcing", x: 230, y: 1120, rot: -5, tIn: 6.15, from: [-380, 120], badge: "99+", badgeT: 6.4, blur: [7.55, 9.85] },
  { id: "whatsapp", label: "les clients", x: 850, y: 1120, rot: 6, tIn: 6.98, from: [380, 120], badge: "12", badgeT: 7.12, blur: [7.55, 9.85] },
  { id: "chatgpt", label: "les descriptions", x: 320, y: 1360, rot: -4, tIn: 7.7, from: [0, 320] },
  { id: "gemini", label: "les réponses", x: 760, y: 1360, rot: 5, tIn: 8.27, from: [0, 320] },
  { id: "photos", label: "247 photos", x: 540, y: 1040, rot: 3, tIn: 9.48, from: [0, 0] },
  { id: "notes", label: "les prix d'achat", x: 540, y: 1330, rot: -3, tIn: 9.88, from: [0, 0] },
];
const CHIP = [[0.25, "0 appli", ""], [3.1, "1 appli", ""], [4.25, "2 applis", ""], [5.2, "3 applis", ""], [6.15, "4 applis", ""], [6.98, "5 applis", ""], [7.7, "6 applis", ""], [8.27, "7 applis", ""], [9.48, "8 applis", ""], [9.88, "9 applis · 23 onglets", "red"], [14.5, "1 appli", "gold"]];
const NOTIFS = [
  { id: "n-lea", app: "whatsapp", who: "Léa", where: "WhatsApp", msg: "Toujours dispo ??", x: 540, y: 600, rot: 0, tIn: 7.12, tOut: 7.62 },
  { id: "n1", app: "vinted", who: "Julien", where: "Vinted", msg: "Tu fais 12 € ?", x: 420, y: 600, rot: -3, tIn: 9.95 },
  { id: "n2", app: "vinted", who: "Sarah", where: "Vinted", msg: "Colis pas reçu…", x: 650, y: 790, rot: 3, tIn: 10.2 },
  { id: "n3", app: "excel", who: "Fichiers", where: "", msg: "stock_final_V3_vraiment_final.xlsx", x: 520, y: 1230, rot: -2, tIn: 10.45 },
  { id: "n4", app: "discord", who: "#bons-plans", where: "Discord", msg: "99+ nouveaux messages", x: 560, y: 1440, rot: 2, tIn: 10.7 },
];
// Écrans réels de l'app (captures iPhone 1179 × 2556) et zones mises en avant (px de la capture).
const SCREENS = ["selio-1-vue-ensemble-sombre.png", "selio-2-negociation-ia-sombre.png", "selio-3-dressing-intelligent-sombre.png"];
const POPS = [
  { scr: 0, box: [52, 2066, 584, 2420], t0: 17.0, t1: 19.7, s: 1.1 },
  { scr: 0, box: [590, 2066, 1128, 2420], t0: 17.9, t1: 19.7, s: 1.1 },
  { scr: 1, box: [100, 1312, 1078, 1512], t0: 20.72, t1: 21.55, s: 1.08 },
  { scr: 1, box: [100, 1828, 1078, 1904], t0: 22.2, t1: 24.65, s: 1.1 },
  { scr: 1, box: [100, 1652, 1078, 1820], t0: 23.95, t1: 24.65, s: 1.06 },
  { scr: 2, box: [73, 389, 233, 549], t0: 25.85, t1: 26.85, s: 1.6, ring: 0.83 },
  { scr: 2, box: [893, 2056, 1100, 2122], t0: 26.25, t1: 26.85, s: 1.3 },
  { scr: 2, box: [96, 2222, 858, 2320], t0: 27.4, t1: 28.9, s: 1.08, pulse: true },
];
const P0 = { fx: 589, fy: 1278, k: 0.9, X: 540, Y: 1190 };
const CAM = [
  { t: 15.9, ...P0, Y: 2700 }, { t: 16.5, ...P0 }, { t: 16.55, ...P0 },
  { t: 16.95, fx: 590, fy: 2243, k: 1.18, X: 540, Y: 1060 }, { t: 19.7, fx: 590, fy: 2243, k: 1.18, X: 540, Y: 1060 },
  { t: 20.0, ...P0 }, { t: 20.3, ...P0 },
  { t: 20.62, fx: 589, fy: 1410, k: 1.25, X: 540, Y: 1000 }, { t: 21.45, fx: 589, fy: 1410, k: 1.25, X: 540, Y: 1000 },
  { t: 21.8, fx: 589, fy: 1800, k: 1.25, X: 540, Y: 1000 }, { t: 24.7, fx: 589, fy: 1800, k: 1.25, X: 540, Y: 1000 },
  { t: 25.0, ...P0 }, { t: 25.3, ...P0 },
  { t: 25.65, fx: 589, fy: 1000, k: 1.15, X: 540, Y: 1000 }, { t: 26.75, fx: 589, fy: 1000, k: 1.15, X: 540, Y: 1000 },
  { t: 27.1, fx: 589, fy: 2150, k: 1.15, X: 540, Y: 1100 }, { t: 29.0, fx: 589, fy: 2150, k: 1.15, X: 540, Y: 1100 },
  { t: 29.45, fx: 589, fy: 2150, k: 1.15, X: 540, Y: 2900 },
];
const SWIPES = [[19.95, 20.35], [24.95, 25.35]];

// Bruitages (repris par audio.py) : [temps, type, paramètre]
const SFX = [
  ...CAPS[0].words.map(([, t]) => [t, "tick", 0]),
  [2.38, "pop", 0], [2.95, "swish", 0],
  ...TILES.map((t, i) => [t.tIn, "pop", i + 1]),
  ...TILES.filter((t) => t.badgeT).map((t) => [t.badgeT, "blip", 0]),
  [4.4, "blip", 1], [4.85, "error", 0],
  [7.12, "notif", 0], [9.95, "notif", 1], [10.2, "notif", 0], [10.45, "notif", 1], [10.7, "notif", 0],
  ...Array.from({ length: 13 }, (_, i) => [7.86 + i * 0.068 + (i % 3) * 0.009, "key", i]),
  [8.85, "tap", 0], [9.25, "tap", 1], [9.32, "pop", 0],
  [9.85, "riser", 1.65], [11.0, "glitch", 0.5], [11.5, "cut", 0],
  [13.55, "suck", 0.95], [14.5, "impact", 0], [14.5, "sparkle", 0.8],
  [15.9, "swish", 1], [16.0, "whoosh", 0],
  [17.0, "kaching", 0], [17.9, "coin", 0],
  [19.95, "swish", 0], [20.72, "thud", 0], [22.2, "ding", 0], [23.95, "check", 0],
  [24.95, "swish", 0], [25.85, "sparkle", 0.6], [26.25, "check", 0], [27.4, "tap", 0], [27.45, "shimmer", 0],
  [29.0, "whoosh", 1], [29.1, "impact", 1], [31.0, "pop", 4], [32.05, "ding", 1],
];

const TL = { DURATION, CAPS, VO_TAIL, TILES, CHIP, NOTIFS, SCREENS, POPS, CAM, SWIPES, SFX };
writeFileSync(`${HERE}timeline.json`, JSON.stringify(TL, null, 1));

// ---------- Page ----------
const CSS = `
@font-face { font-family: Inter; font-weight: 500; src: url("file://${FONT}/inter-latin-500-normal.woff2"); }
@font-face { font-family: Inter; font-weight: 600; src: url("file://${FONT}/inter-latin-600-normal.woff2"); }
@font-face { font-family: Inter; font-weight: 700; src: url("file://${FONT}/inter-latin-700-normal.woff2"); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #121017; }
body { position: relative; font-family: Inter, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
#bg { position: absolute; inset: 0; }
.layer { position: absolute; inset: 0; }
.sp { position: absolute; left: 0; top: 0; will-change: transform; }
.tile { width: 300px; text-align: center; }
.tile .sq { position: relative; width: 176px; height: 176px; margin: 0 auto; border-radius: 44px; display: flex; align-items: center; justify-content: center; box-shadow: 0 22px 50px rgba(0,0,0,.45), inset 0 0 0 2px rgba(255,255,255,.1); }
.tile .sq svg { width: 100px; height: 100px; }
.tile .lab { display: inline-block; margin-top: 16px; padding: 8px 20px; border-radius: 99px; background: rgba(255,255,255,.1); border: 1.5px solid rgba(255,255,255,.14); font: 500 27px Inter; white-space: nowrap; }
.tile .badge { position: absolute; top: -14px; right: -16px; min-width: 56px; height: 56px; padding: 0 13px; border-radius: 99px; background: #E5484D; font: 700 28px/56px Inter; box-shadow: 0 6px 16px rgba(0,0,0,.35); }
.notif { width: 760px; display: flex; gap: 22px; align-items: center; padding: 22px 28px; border-radius: 38px; background: rgba(246,245,250,.96); color: #1C1A24; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
.notif .ic { flex: none; width: 76px; height: 76px; border-radius: 19px; display: flex; align-items: center; justify-content: center; }
.notif .ic svg { width: 46px; height: 46px; }
.notif .tx { min-width: 0; }
.notif .hd { font: 500 25px Inter; color: #6E6A7B; }
.notif .hd b { font-weight: 700; color: #1C1A24; }
.notif .msg { font: 600 33px/1.25 Inter; overflow-wrap: anywhere; }
.sheet { width: 470px; padding: 18px 22px 22px; border-radius: 26px; background: #fff; color: #1F2328; box-shadow: 0 24px 60px rgba(0,0,0,.45); font: 500 28px "DejaVu Sans Mono", monospace; }
.sheet .fx { display: flex; gap: 14px; align-items: center; padding-bottom: 14px; border-bottom: 2px solid #E3E6EA; }
.sheet .fx i { font: italic 600 24px Inter; color: #107C41; }
.sheet .cell { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border: 3px solid #107C41; border-radius: 10px; font-size: 34px; font-weight: 700; }
.sheet .cell span { font: 500 22px Inter; color: #6E7781; }
.prompt { width: 900px; padding: 26px 30px 30px; border-radius: 40px; background: #1E1C26; border: 2px solid rgba(255,255,255,.12); box-shadow: 0 30px 70px rgba(0,0,0,.5); }
.prompt .hd { display: flex; align-items: center; gap: 16px; font: 600 28px Inter; color: rgba(255,255,255,.8); margin-bottom: 18px; }
.prompt .hd .ic { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; }
.prompt .hd .ic svg { width: 32px; height: 32px; }
.prompt .tx { min-height: 92px; font: 500 35px/1.32 Inter; }
.prompt .tx .sel { background: rgba(10,132,255,.5); border-radius: 6px; }
.prompt .tx .caret { display: inline-block; width: 3px; height: 38px; margin-left: 2px; vertical-align: -6px; background: #fff; }
.menu { padding: 16px 30px; border-radius: 18px; background: #2C2C2E; font: 500 32px Inter; box-shadow: 0 14px 34px rgba(0,0,0,.45); white-space: nowrap; }
.menu::after { content: ""; position: absolute; left: 50%; bottom: -12px; margin-left: -12px; border: 12px solid transparent; border-bottom: 0; border-top-color: #2C2C2E; }
.pullcard { width: 330px; padding: 14px; border-radius: 30px; background: #F5F5F7; box-shadow: 0 30px 70px rgba(0,0,0,.5); }
.pullcard img { display: block; width: 302px; height: 402px; object-fit: cover; border-radius: 20px; }
.cap { position: absolute; text-align: center; font-weight: 600; letter-spacing: -0.025em; line-height: 1.1; text-shadow: 0 6px 30px rgba(0,0,0,.55); }
.cap .w { display: inline-block; }
#chip { position: absolute; top: 236px; right: 64px; padding: 14px 26px; border-radius: 99px; font: 600 34px Inter; letter-spacing: -.01em; white-space: nowrap; transform-origin: 100% 50%; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18); }
#chip.red { background: rgba(180,35,24,.35); border-color: rgba(240,133,122,.8); color: #FFD9D4; }
#chip.gold { background: rgba(226,198,124,.16); border-color: rgba(226,198,124,.85); color: #F3E2B3; }
#phone { position: absolute; left: 0; top: 0; width: 636px; height: 1337px; border-radius: 102px; background: #0B0B0C; box-shadow: 0 0 0 3px #45414F, 0 0 0 7px #17151C, 0 50px 140px rgba(100,66,214,.4); transform-origin: 0 0; }
#screen { position: absolute; left: 18px; top: 18px; width: 600px; height: 1301px; border-radius: 84px; overflow: hidden; background: #121017; }
#screen img { position: absolute; left: 0; top: 0; width: 600px; height: 1301px; }
#phone .di { position: absolute; top: 35px; left: 222px; width: 192px; height: 56px; border-radius: 99px; background: #000; }
.pop { position: absolute; border-radius: 16px; background-repeat: no-repeat; background-size: 600px 1301px; }
.btn { padding: 36px 66px; border-radius: 99px; background: linear-gradient(90deg, #5232B5, #7C5CEB); font: 600 48px Inter; white-space: nowrap; box-shadow: 0 20px 60px rgba(100,66,214,.55), inset 0 0 0 2px rgba(255,255,255,.15); overflow: hidden; }
.btn .shine { position: absolute; top: 0; bottom: 0; width: 120px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); transform: skewX(-20deg); }
.small { font: 500 26px/1.35 Inter; color: rgba(255,255,255,.55); text-align: center; }
#dark, #flash, #scrim { position: absolute; inset: 0; pointer-events: none; }
#scrim { background: linear-gradient(180deg, #121017 0, rgba(18,16,23,.97) 540px, rgba(18,16,23,0) 780px); }
#dark { background: rgba(8,6,12,1); }
#flash { background: radial-gradient(circle at 540px 960px, rgba(255,255,255,1), rgba(196,178,255,.6) 35%, rgba(124,92,235,0) 70%); }
`;

const icon = (id) => `<svg viewBox="0 0 24 24">${LOGOS[id].svg}</svg>`;
const tileHtml = (t) => `<div class="sp tile" id="t-${t.id}"><div class="sq" style="background:${LOGOS[t.id].bg}">${icon(t.id)}${t.badge ? `<span class="badge">${t.badge}</span>` : ""}</div><span class="lab">${t.label}</span></div>`;
const notifHtml = (n) => `<div class="sp notif" id="${n.id}"><span class="ic" style="background:${LOGOS[n.app].bg}">${icon(n.app)}</span><div class="tx"><div class="hd"><b>${n.who}</b>${n.where ? ` · ${n.where}` : ""} · maintenant</div><div class="msg">${n.msg}</div></div></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<canvas id="bg" width="1080" height="1920"></canvas>
<div class="layer" id="stage">
  ${TILES.map(tileHtml).join("\n  ")}
  <div class="sp sheet" id="sheet"><div class="fx"><i>fx</i><span>=SOMME(C2:C48)</span></div><div class="cell"><b id="sheetv">1 284,50 €</b><span>C49</span></div></div>
  ${NOTIFS.map(notifHtml).join("\n  ")}
  <div class="sp prompt" id="prompt"><div class="hd"><span class="ic" style="background:${LOGOS.chatgpt.bg}">${icon("chatgpt")}</span>ChatGPT</div><div class="tx" id="ptx"></div></div>
  <div class="sp menu" id="m-copy">Copier</div>
  <div class="sp menu" id="m-paste">Coller</div>
</div>
<div class="sp pullcard" id="pull"><img src="file://${PULL}"/></div>
<svg class="layer" id="brand" viewBox="0 0 1080 1920" width="1080" height="1920"><g id="ringg"></g><image id="logo" href="file://${LOGO}" x="260" y="873" width="560" height="174"/></svg>
<div class="sp" id="phone"><div id="screen">${SCREENS.map((s, i) => `<img id="scr${i}" src="file://${MOCK}/${s}"/>`).join("")}</div><span class="di"></span><div id="pops"></div></div>
<div id="scrim"></div>
<div class="layer" id="cta">
  <img class="sp" id="ctalogo" src="file://${LOGO}" style="width:500px"/>
  <div class="sp btn" id="btn"><span class="shine" id="shine"></span>Rejoins la bêta gratuite</div>
  <div class="sp" id="bio" style="font:600 40px Inter;color:#F3E2B3;display:flex;align-items:center;gap:14px">Lien en bio <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F3E2B3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/></svg></div>
  <div class="sp small" id="legal" style="width:900px">Outil indépendant, non affilié à Vinted ni aux marques citées.<br>Chiffres de démonstration.</div>
</div>
<div id="dark"></div>
<div class="layer" id="caps"></div>
<div id="chip"></div>
<div id="flash"></div>
<script>
const TL = ${JSON.stringify(TL)};
${readFileSync(`${HERE}engine.js`, "utf8")}
</script></body></html>`;
writeFileSync(`${HERE}scene.html`, html);
console.log("scene.html + timeline.json écrits");
