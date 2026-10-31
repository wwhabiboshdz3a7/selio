// Vidéo v2 « Et si une appli centralisait tout ? » : timeline + page HTML pilotée par seek(t).
// Écrit scene.html (rendu image par image) et timeline.json (sous-titres et bruitages pour l'audio et le SRT).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.SELIO_ROOT || new URL("../../../", import.meta.url).pathname; // racine du dépôt
const FONT = dirname(createRequire(`${ROOT}apps/web/package.json`).resolve("@fontsource/inter/package.json")) + "/files";
const ECR = `${HERE}ecrans`; // captures pleine page de la démo (mode sombre, iPhone @3x)
const PHOTOS = `${ROOT}apps/web/public/demo/photos`;
const LOGO = `${ROOT}brand/selio-logo-blanc.png`;
const SI = `${HERE}logos`; // Simple Icons, CC0
const DURATION = 35;
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const dataUri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;

// ---------- Logos : Simple Icons (CC0) pour les marques disponibles, icônes génériques sinon ----------
const siPath = (slug) => readFileSync(`${SI}/${slug}.svg`, "utf8").match(/ d="([^"]+)"/)[1];
const fill = (d, color = "#fff") => `<path d="${d}" fill="${color}"/>`;
const stroke = (inner, color = "#fff", w = 1.7) => `<g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const GEM = `<defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4285F4"/><stop offset=".55" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs>${fill(siPath("googlegemini"), "url(#gm)")}`;
const ICON = {
  vinted: fill(siPath("vinted")),
  discord: fill(siPath("discord")),
  whatsapp: fill(siPath("whatsapp")),
  gemini: GEM,
  excel: stroke(`<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>`),
  chatgpt: `${stroke(`<path d="M5.2 4.6h13.6a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2h-6.6l-4.4 3.6v-3.6H5.2A2.2 2.2 0 0 1 3 15V6.8a2.2 2.2 0 0 1 2.2-2.2z"/>`)}<path d="M12 7.2l1.05 2.45 2.45 1.05-2.45 1.05L12 14.2l-1.05-2.45L8.5 10.7l2.45-1.05z" fill="#fff"/>`,
  photos: `${stroke(`<rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6"/>`, "#8E8E93", 1.6)}<circle cx="9" cy="9.6" r="1.9" fill="#FF9F0A"/><path d="M4 17.6l4.6-4.8 3.6 3.6 2.8-2.8 5 4.4v.4H4z" fill="#34C759"/>`,
  notes: stroke(`<path d="M7 7.5h10M7 11.5h10M7 15.5h6"/>`, "#3A2E00", 2),
  calc: stroke(`<rect x="5" y="2.8" width="14" height="18.4" rx="2.6"/><rect x="7.6" y="5.4" width="8.8" height="3.6" rx=".8"/><path d="M8.8 12.4h.01M12 12.4h.01M15.2 12.4h.01M8.8 15.4h.01M12 15.4h.01M15.2 15.4h.01M8.8 18.4h.01M12 18.4h.01M15.2 18.4h.01"/>`, "#FF9F0A", 2.2),
  relay: stroke(`<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>`, "#fff", 1.6),
  battery: stroke(`<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M21.5 10.5v3"/><rect x="4.5" y="9" width="2.5" height="6" rx=".6" fill="#fff" stroke="none"/>`, "#fff", 1.6),
  heart: `<path d="M12 20.3s-7.6-4.6-9.3-9.2C1.4 7.6 3.6 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.3 0 5.5 3.1 4.2 6.6-1.7 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="#111" stroke-width="1.8"/>`,
};
const svg = (k, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}">${ICON[k]}</svg>`;

// ---------- Sous-titres karaoké : chaque mot s'allume quand la voix le dit (g = or, r = rouge) ----------
const CAPS = [
  { top: 560, size: 92, width: 960, words: [["Combien", 0.2], ["d'applis", 0.48], ["tu", 0.8], ["ouvres…", 0.92], ["pour", 1.55], ["vendre", 1.72], ["un", 2.02, "g"], ["seul", 2.15, "g"], ["pull ?", 2.38, "g"]], out: 2.98 },
  { top: 330, size: 74, words: [["Les", 3.05], ["annonces", 3.18], ["sur", 3.48], ["Vinted.", 3.62, "g"]], out: 4.12 },
  { top: 330, size: 74, words: [["Le", 4.2], ["stock", 4.32], ["sur", 4.58], ["Excel…", 4.7, "g"]], out: 5.08 },
  { top: 330, size: 68, words: [["Les", 5.15], ["marges", 5.28], ["à", 5.58], ["la", 5.66], ["calculette,", 5.78, "g"], ["\n"], ["le", 6.1], ["sourcing", 6.22], ["sur", 6.6], ["Discord…", 6.74, "g"]], out: 7.45 },
  { top: 330, size: 68, words: [["Et", 7.55], ["ChatGPT", 7.68, "g"], ["ou", 8.1], ["Gemini…", 8.22, "g"], ["\n"], ["en", 8.85], ["copier-coller.", 9.0, "g"]], out: 9.72 },
  { top: 320, size: 100, words: [["Neuf", 9.9, "r"], ["applis.", 10.1, "r"], ["\n"], ["Pour", 10.55], ["un", 10.7], ["pull.", 10.82]], out: 11.45, glitch: true },
  { top: 690, size: 112, width: 900, words: [["Et", 11.75], ["si…", 11.9], ["\n"], ["une", 12.45, "g"], ["seule", 12.62, "g"], ["appli", 12.85, "g"], ["\n"], ["centralisait", 13.15], ["tout ?", 13.62]], out: 13.98, slam: true },
  { top: 1330, size: 66, words: [["Voici", 14.95], ["Selio.", 15.22, "g"]], out: 15.95 },
  { top: 330, size: 74, words: [["Ton", 16.3], ["stock,", 16.45, "g"], ["tes", 16.85], ["ventes", 17.0, "g"]], out: 17.4 },
  { top: 330, size: 68, words: [["et", 17.45], ["tes", 17.58], ["vraies", 17.72, "g"], ["marges…", 17.95, "g"], ["\n"], ["au", 18.75], ["même", 18.88], ["endroit.", 19.05]], out: 19.85 },
  { top: 330, size: 76, words: [["Une", 20.2], ["offre", 20.33], ["trop", 20.62, "r"], ["basse ?", 20.78, "r"]], out: 21.3 },
  { top: 330, size: 68, words: [["Selio", 21.4], ["calcule", 21.62], ["la", 21.95], ["bonne", 22.05, "g"], ["contre-offre,", 22.25, "g"]], out: 23.0 },
  { top: 330, size: 68, words: [["sans", 23.05], ["jamais", 23.2], ["passer", 23.5], ["sous", 23.75], ["ton", 23.88], ["prix", 24.0, "g"], ["plancher.", 24.15, "g"]], out: 24.9 },
  { top: 330, size: 68, words: [["Chaque", 25.2], ["annonce", 25.38], ["\n"], ["est", 25.72], ["notée", 25.85, "g"], ["sur", 26.12, "g"], ["100 :", 26.25, "g"]], out: 26.92, spoken: "Chaque annonce est notée sur cent :" },
  { top: 330, size: 68, words: [["tu", 27.0], ["sais", 27.1], ["quoi", 27.25], ["republier,", 27.42, "g"], ["\n"], ["et", 28.05], ["quand.", 28.2, "g"]], out: 28.88 },
  { top: 560, size: 94, words: [["Une", 29.2], ["appli.", 29.38], ["\n"], ["Tout", 29.85], ["ton", 30.0], ["business", 30.12, "g"], ["Vinted.", 30.45, "g"]], out: 99 },
];
// Fin de la voix off, portée par le bouton et « Lien en bio ».
const VO_TAIL = { words: [["Rejoins", 31.45], ["la", 31.65], ["bêta", 31.75], ["gratuite :", 31.95], ["lien", 32.5], ["en", 32.62], ["bio.", 32.72]], out: 33.6 };

// ---------- Acte 2 : les fenêtres d'applis (scène 3D) ----------
const WINS = [
  { id: "vinted", w: 480, h: 820, x: 300, y: 930, z: 150, rx: 4, ry: 12, rz: -2, tIn: 3.12, from: [0, 0, 0, 0], focus: [9.05, 9.65] },
  { id: "excel", w: 660, h: 500, x: 680, y: 820, z: 190, rx: 4, ry: -14, rz: 2, tIn: 4.15, from: [520, -80, 0, 14] },
  { id: "calc", w: 300, h: 480, x: 800, y: 1270, z: 210, rx: 2, ry: -10, rz: 5, tIn: 5.15, from: [420, 300, 0, 20] },
  { id: "discord", w: 600, h: 470, x: 340, y: 1280, z: 190, rx: 4, ry: 14, rz: -3, tIn: 6.1, from: [-520, 200, 0, -16] },
  { id: "whatsapp", w: 460, h: 540, x: 760, y: 1040, z: 210, rx: 2, ry: -10, rz: 3, tIn: 6.95, from: [480, 0, 0, 12] },
  { id: "chatgpt", w: 660, h: 500, x: 480, y: 880, z: 240, rx: 3, ry: 8, rz: -1, tIn: 7.55, from: [-200, -500, 0, -8] },
  { id: "gemini", w: 600, h: 380, x: 610, y: 1300, z: 250, rx: 2, ry: -8, rz: 2, tIn: 8.2, from: [300, 500, 0, 10] },
  { id: "photos", w: 520, h: 560, x: 360, y: 1030, z: 260, rx: 3, ry: 12, rz: -4, tIn: 9.4, from: [-500, 100, 0, -14] },
  { id: "notes", w: 440, h: 400, x: 760, y: 840, z: 270, rx: 2, ry: -12, rz: 4, tIn: 9.85, from: [400, -300, 0, 12] },
];
const EXCEL_ROWS = [
  ["Pull à pois TH", "4,50", "18,00", "2,88", "10,62"],
  ["Cardigan TH marine", "5,00", "17,00", "2,70", "9,30"],
  ["Pull rayé orange", "3,00", "15,00", "2,50", "9,50"],
  ["Polo rayé TH", "4,00", "14,00", "2,40", "7,60"],
  ["Sweat col V gris", "3,50", "17,99", "2,88", "11,61"],
  ["Pull d'hiver rouge", "6,00", "22,00", "3,10", "12,90"],
];
const DISCORD = [
  ["Max", "#F0B232", "lot de 12 pulls Tommy à 40 €, qui prend ?"], ["Inès", "#EB459E", "dispo encore ?"], ["Yanis", "#57F287", "MP"],
  ["Sofia", "#5865F2", "arrivage friperie demain 9 h"], ["Max", "#F0B232", "je garde le marine"], ["Lucas", "#ED4245", "prix du cardigan ?"],
  ["Inès", "#EB459E", "+1"], ["Sofia", "#5865F2", "@everyone vide-dressing samedi"], ["Yanis", "#57F287", "photo stp"], ["Max", "#F0B232", "vendu, désolé"],
  ["Lucas", "#ED4245", "quelqu'un à Lyon ?"], ["Inès", "#EB459E", "je prends le rouge"],
];
const WA = [[7.12, "Toujours dispo ??"], [7.3, "Tu fais 12 € ?"], [7.46, "Je peux passer le chercher ce soir ?"]];
const GPT_Q = "Écris une annonce Vinted pour mon pull à pois Tommy Hilfiger, taille M";
const GPT_A = "Pull à pois Tommy Hilfiger · taille M\nJoli pull marine à pois blancs, très bon état, porté deux fois. Maille douce, coupe classique. Envoi rapide et soigné.";
const GEM_A = "Bonjour ! Oui, il est toujours disponible. Je peux vous le proposer à 16 €, avec un envoi sous 24 h.";
const NOTES = ["Achats octobre", "Pull à pois — 4,50 € (Emmaüs)", "Cardigan marine — 5 € (vide-grenier)", "Lot Vinted — 40 € (12 pulls)", "Colis Léa ???"];
const GALLERY = ["00gd", "1vw3", "4c28", "58bh", "72r7", "74wo", "7iic", "8mcb", "9ftg", "as1z", "dkl8", "gocv", "hu2a", "i0f8", "j0ql", "lpdt", "n5g4", "nxjw", "oyuf", "prkn", "qeub", "s33t", "usyx", "xn51", "xu43", "yaso", "ybm9", "z815"];
// Notifications de la surcharge (calque 2D)
const NOTIFS = [
  { app: "vinted", who: "Julien", where: "Vinted", msg: "Tu fais 12 € ?", x: 420, y: 600, rot: -3, tIn: 9.92 },
  { app: "vinted", who: "Sarah", where: "Vinted", msg: "Colis pas reçu…", x: 660, y: 770, rot: 3, tIn: 10.1 },
  { app: "relay", who: "Point relais", where: "", msg: "Colis en attente de dépôt", x: 470, y: 1180, rot: -2, tIn: 10.28, bg: "#C8102E" },
  { app: "discord", who: "#bons-plans", where: "Discord", msg: "99+ nouveaux messages", x: 600, y: 1380, rot: 2, tIn: 10.46 },
  { app: "excel", who: "Excel", where: "", msg: "Fichier verrouillé par un autre utilisateur", x: 520, y: 940, rot: -1.5, tIn: 10.64, bg: "#107C41" },
  { app: "whatsapp", who: "Léa", where: "WhatsApp", msg: "???", x: 380, y: 1460, rot: 2.5, tIn: 10.82 },
  { app: "vinted", who: "Vinted", where: "", msg: "3 nouvelles offres sur tes articles", x: 640, y: 1060, rot: -2.5, tIn: 11.0 },
  { app: "battery", who: "Batterie faible", where: "", msg: "10 % restants", x: 500, y: 680, rot: 1.5, tIn: 11.18, bg: "#E5484D" },
];
const CHIP = [[0.25, "0 appli", ""], [3.1, "1 appli", ""], [4.2, "2 applis", ""], [5.2, "3 applis", ""], [6.15, "4 applis", ""], [7.0, "5 applis", ""], [7.6, "6 applis", ""], [8.25, "7 applis", ""], [9.45, "8 applis", ""], [9.88, "9 applis · 23 onglets", "red"], [14.5, "1 appli", "gold"]];

// ---------- Acte 5 : l'app sur iPhone (captures pleine page, px de la capture) ----------
const PAGES = ["items", "orders", "analytics", "overview", "nego", "dressing"].map((id) => ({ id, size: pngSize(`${ECR}/${id}-full.png`) }));
const SWITCH = [16.85, 17.45, 18.75, 19.95, 24.95]; // passage à l'écran suivant (balayage)
const SCROLL = {
  items: [[16.0, 0], [16.95, 760]],
  orders: [[16.85, 0], [17.5, 260]],
  analytics: [[17.45, 0], [17.95, 650]],
  overview: [[18.75, 1150], [19.95, 1700]],
  nego: [[19.95, 0], [20.55, 250], [21.45, 250], [21.85, 600]],
  dressing: [[24.95, 4300], [26.8, 4300], [27.2, 5850]],
};
const POPS = [
  { page: "analytics", box: [590, 1362, 1130, 1755], t0: 17.85, t1: 18.7, s: 1.1 },
  { page: "overview", box: [52, 2066, 584, 2420], t0: 18.95, t1: 19.85, s: 1.08 },
  { page: "overview", box: [590, 2066, 1128, 2420], t0: 19.1, t1: 19.85, s: 1.08 },
  { page: "nego", box: [100, 1312, 1078, 1512], t0: 20.72, t1: 21.55, s: 1.08 },
  { page: "nego", box: [100, 1828, 1078, 1904], t0: 22.2, t1: 24.7, s: 1.1 },
  { page: "nego", box: [100, 1652, 1078, 1820], t0: 23.95, t1: 24.7, s: 1.06 },
  { page: "dressing", box: [73, 4691, 233, 4851], t0: 25.85, t1: 26.85, s: 1.6, ring: 0.83 },
  { page: "dressing", box: [893, 6358, 1100, 6424], t0: 26.25, t1: 26.85, s: 1.3 },
  { page: "dressing", box: [96, 6524, 858, 6622], t0: 27.45, t1: 28.9, s: 1.08, pulse: true },
];
const TAPS = [{ page: "nego", t: 24.3, x: 406, y: 1971 }, { page: "dressing", t: 27.55, x: 477, y: 6573 }];
const P0 = { fx: 589, fy: 1278, k: 0.99, X: 540, Y: 1150, rx: 6, ry: -9 };
const CAM = [
  { t: 15.9, ...P0, Y: 2500, rx: 22, ry: -18 }, { t: 16.55, ...P0 }, { t: 17.45, ...P0, ry: -6 },
  { t: 17.8, fx: 589, fy: 900, k: 1.122, X: 540, Y: 1060, rx: 3, ry: -4 }, { t: 18.7, fx: 589, fy: 900, k: 1.122, X: 540, Y: 1060, rx: 3, ry: -3 },
  { t: 19.0, fx: 589, fy: 760, k: 1.122, X: 540, Y: 1050, rx: 3, ry: -2 }, { t: 19.8, fx: 589, fy: 760, k: 1.122, X: 540, Y: 1050, rx: 3, ry: 0 },
  { t: 20.1, ...P0, k: 1.045, ry: 7 },
  { t: 20.5, fx: 589, fy: 1160, k: 1.298, X: 540, Y: 1000, rx: 2, ry: 5 }, { t: 21.45, fx: 589, fy: 1160, k: 1.298, X: 540, Y: 1000, rx: 2, ry: 4 },
  { t: 21.85, fx: 589, fy: 1250, k: 1.298, X: 540, Y: 1000, rx: 2, ry: 3 }, { t: 24.6, fx: 589, fy: 1250, k: 1.298, X: 540, Y: 1000, rx: 2, ry: 1 },
  { t: 24.95, ...P0, k: 1.045, ry: -7 },
  { t: 25.4, fx: 589, fy: 800, k: 1.232, X: 540, Y: 1020, rx: 3, ry: -4 }, { t: 26.8, fx: 589, fy: 800, k: 1.232, X: 540, Y: 1020, rx: 3, ry: -2 },
  { t: 27.2, fx: 589, fy: 650, k: 1.232, X: 540, Y: 1060, rx: 3, ry: -1 }, { t: 29.0, fx: 589, fy: 650, k: 1.232, X: 540, Y: 1060, rx: 3, ry: 2 },
  { t: 29.4, fx: 589, fy: 1278, k: 0.605, X: 540, Y: 1300, rx: 10, ry: 25 },
];
// Cartes flottantes autour du téléphone (chiffres lus dans la démo)
const FCHIPS = [
  { t0: 16.35, t1: 17.35, x: 250, y: 720, k: "Stock", v: "32 articles actifs", ic: "box" },
  { t0: 16.95, t1: 17.45, x: 820, y: 860, k: "Ventes", v: "13 en 90 jours", ic: "bag" },
  { t0: 17.95, t1: 19.7, x: 250, y: 1420, k: "Marge brute", v: "57 % du CA", ic: "chart", gold: true },
  { t0: 22.3, t1: 24.8, x: 820, y: 760, k: "Contre-offre", v: "+4,10 € vs l'offre", ic: "coin", gold: true },
  { t0: 24.0, t1: 24.8, x: 260, y: 1420, k: "Prix plancher", v: "14,50 € respecté", ic: "shield" },
  { t0: 26.0, t1: 26.95, x: 820, y: 760, k: "Note", v: "83 / 100", ic: "star", gold: true },
  { t0: 27.65, t1: 28.95, x: 260, y: 1420, k: "Conseil", v: "En ligne depuis 15 jours", ic: "clock" },
];
const CAROUSEL = ["overview", "items", "orders", "analytics", "nego", "dressing", "studio", "radar"];

// Bruitages (repris par audio.py) : [temps, type, paramètre]
const SFX = [
  ...CAPS[0].words.map(([, t]) => [t, "tick", 0]),
  [1.55, "pop", 0], [2.38, "shimmer", 0], [2.98, "swish", 0],
  ...WINS.map((w, i) => [w.tIn, "slam", i]),
  ...EXCEL_ROWS.flatMap((_, r) => [0, 1, 2, 3, 4].map((c) => [4.3 + (r * 5 + c) * 0.016, "key", r * 5 + c])).filter((_, i) => i % 3 === 0),
  [4.85, "error", 0],
  [5.3, "beep", 0], [5.42, "beep", 1], [5.55, "beep", 2], [5.7, "beep", 3],
  ...Array.from({ length: 8 }, (_, i) => [6.25 + i * 0.13, "blip", i % 3]),
  ...WA.map(([t], i) => [t, "notif", i % 2]),
  ...Array.from({ length: 10 }, (_, i) => [7.6 + i * 0.035, "key", 40 + i]),
  ...Array.from({ length: 12 }, (_, i) => [7.98 + i * 0.07, "type", i]),
  [8.85, "tap", 0], [9.25, "tap", 1], [9.3, "pop", 2],
  ...Array.from({ length: 9 }, (_, i) => [8.32 + i * 0.08, "type", 20 + i]),
  [9.45, "swish", 1],
  ...NOTIFS.map((n, i) => [n.tIn, "notif", i % 2]),
  [9.85, "riser", 1.65], [11.0, "glitch", 0.5], [11.5, "cut", 0],
  [12.85, "heart", 0], [13.62, "heart", 1],
  [13.55, "suck", 0.95], [14.5, "impact", 0], [14.5, "sparkle", 0.9], [15.0, "shine", 0],
  [15.9, "whoosh", 0], [16.85, "whip", 0], [17.45, "whip", 1], [18.75, "whip", 0], [19.95, "whip", 1], [24.95, "whip", 0],
  [16.35, "pop", 1], [16.95, "pop", 2], [17.85, "kaching", 0], [17.95, "pop", 3], [18.95, "coin", 0],
  [20.72, "thud", 0], [22.2, "ding", 0], [22.3, "pop", 4], [23.95, "check", 0], [24.3, "tap", 0],
  [25.85, "sparkle", 0.6], [26.0, "pop", 3], [26.25, "check", 0], [27.55, "tap", 0], [27.6, "shimmer", 0],
  [29.0, "whoosh", 1], [29.2, "swish", 0], [30.85, "suck", 0.45], [31.3, "impact", 1], [31.35, "shine", 0], [31.45, "pop", 4], [32.5, "ding", 1], [33.3, "tap", 0],
];

const TL = { DURATION, CAPS, VO_TAIL, WINS, EXCEL_ROWS, DISCORD, WA, GPT_Q, GPT_A, GEM_A, NOTES, NOTIFS, CHIP, PAGES, SWITCH, SCROLL, POPS, TAPS, CAM, FCHIPS, CAROUSEL, SFX };
writeFileSync(`${HERE}timeline.json`, JSON.stringify(TL, null, 1));

// ---------- Page ----------
const CSS = `
@font-face { font-family: Inter; font-weight: 500; src: url("file://${FONT}/inter-latin-500-normal.woff2"); }
@font-face { font-family: Inter; font-weight: 600; src: url("file://${FONT}/inter-latin-600-normal.woff2"); }
@font-face { font-family: Inter; font-weight: 700; src: url("file://${FONT}/inter-latin-700-normal.woff2"); }
@font-face { font-family: Inter; font-weight: 800; src: url("file://${FONT}/inter-latin-800-normal.woff2"); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0E0C13; }
body { position: relative; font-family: Inter, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
canvas { position: absolute; left: 0; top: 0; }
.layer { position: absolute; inset: 0; }
.sp { position: absolute; left: 0; top: 0; }
#scene, #ctaScene { position: absolute; inset: 0; perspective: 1700px; perspective-origin: 540px 960px; }
#world { position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: 540px 960px; }
.win { position: absolute; left: 0; top: 0; border-radius: 28px; overflow: hidden; background: #fff; color: #16141B; box-shadow: 0 50px 110px rgba(0,0,0,.6), 0 0 0 1.5px rgba(255,255,255,.14); backface-visibility: hidden; }
.bar { height: 64px; display: flex; align-items: center; gap: 14px; padding: 0 22px; font: 700 26px Inter; color: #fff; white-space: nowrap; overflow: hidden; }
.bar .dots { margin-left: auto; display: flex; gap: 8px; } .bar .dots i { width: 13px; height: 13px; border-radius: 50%; background: rgba(255,255,255,.55); }
/* Vinted */
.vphoto { position: relative; height: 430px; overflow: hidden; } .vphoto img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%; }
.vlike { position: absolute; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 99px; background: #fff; font: 600 24px Inter; color: #111; }
.vinfo { padding: 18px 24px 22px; } .vt { font: 600 28px/1.2 Inter; } .vs { margin-top: 4px; font: 500 21px Inter; color: #75727D; } .vp { margin-top: 8px; font: 700 34px Inter; color: #007782; }
.vdesc { position: relative; margin-top: 12px; min-height: 104px; padding: 10px 14px; border-radius: 14px; border: 2px dashed #D6D3DD; font: 500 19px/1.35 Inter; color: #A3A0AA; }
.vdesc.full { border: 2px solid #007782; color: #2B2933; }
.vbtn { margin-top: 12px; padding: 14px; border-radius: 14px; background: #007782; color: #fff; text-align: center; font: 600 23px Inter; }
.menu { position: absolute; padding: 14px 26px; border-radius: 16px; background: #2C2C2E; color: #fff; font: 500 28px Inter; box-shadow: 0 14px 34px rgba(0,0,0,.45); white-space: nowrap; }
.menu::after { content: ""; position: absolute; left: 50%; bottom: -11px; margin-left: -11px; border: 11px solid transparent; border-bottom: 0; border-top-color: #2C2C2E; }
/* Excel */
.ribbon { display: flex; gap: 26px; padding: 10px 22px; background: #F3F6F4; font: 500 19px Inter; color: #3B3A40; border-bottom: 1px solid #E1E4E2; } .ribbon b { color: #107C41; font-weight: 600; }
.xfx { display: flex; align-items: center; gap: 14px; height: 50px; padding: 0 16px; border-bottom: 2px solid #E3E6EA; font: 500 22px "DejaVu Sans Mono", monospace; color: #1F2328; } .xfx i { font: italic 600 22px Inter; color: #107C41; }
.xg { border-collapse: collapse; width: 100%; font: 500 20px Inter; table-layout: fixed; }
.xg th { height: 40px; background: #F3F3F3; color: #6E7781; font-weight: 500; border: 1px solid #E1E1E1; }
.xg td { height: 44px; padding: 0 10px; border: 1px solid #E6E6E6; white-space: nowrap; overflow: hidden; text-overflow: clip; color: #1F2328; }
.xg td.n { text-align: right; } .xg td.rn { background: #F3F3F3; color: #6E7781; text-align: center; padding: 0; }
.xg td.err { color: #CF222E; font-weight: 700; background: #FFEBE9; } .xg td.tot { font-weight: 700; }
.xg td.sel { outline: 3px solid #107C41; outline-offset: -3px; }
/* Calculatrice */
.calc { background: #1C1C1E; color: #fff; border-radius: 40px; padding: 22px 20px; }
.cdisp { height: 120px; display: flex; align-items: flex-end; justify-content: flex-end; padding: 0 8px 10px; font: 400 46px Inter; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; }
.ckeys { display: grid; grid-template-columns: repeat(4, 56px); gap: 12px; justify-content: center; }
.ckeys span { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 500 25px Inter; background: #333336; }
.ckeys span.op { background: #FF9F0A; } .ckeys span.fn { background: #A5A5A5; color: #000; } .ckeys span.on { filter: brightness(1.7); }
/* Discord */
.dsc { display: flex; height: 100%; background: #313338; color: #DBDEE1; }
.dsc .rail { width: 74px; flex: none; background: #1E1F22; display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 14px; }
.dsc .rail i { width: 48px; height: 48px; border-radius: 16px; display: flex; align-items: center; justify-content: center; font: 700 20px Inter; font-style: normal; color: #fff; }
.dsc .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dsc .ch { height: 58px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 2px solid #26272B; font: 700 24px Inter; color: #F2F3F5; }
.dsc .ch .bdg { margin-left: auto; padding: 3px 12px; border-radius: 99px; background: #ED4245; font: 700 19px Inter; color: #fff; }
.dsc .msgs { position: relative; flex: 1; overflow: hidden; } .dsc .list { position: absolute; left: 0; right: 0; top: 0; padding: 10px 16px; }
.dm { display: flex; gap: 14px; height: 70px; align-items: flex-start; padding-top: 8px; } .dm .av { flex: none; width: 42px; height: 42px; border-radius: 50%; }
.dm b { font: 600 20px Inter; } .dm small { margin-left: 8px; font: 500 15px Inter; color: #949BA4; } .dm p { font: 500 20px/1.25 Inter; color: #DBDEE1; white-space: nowrap; }
/* WhatsApp */
.wa-h { height: 76px; display: flex; align-items: center; gap: 14px; padding: 0 20px; background: #008069; color: #fff; }
.wa-h .av { width: 46px; height: 46px; border-radius: 50%; background: #DFE5E7; color: #54656F; display: flex; align-items: center; justify-content: center; font: 700 22px Inter; }
.wa-h b { font: 600 24px Inter; display: block; } .wa-h small { font: 500 17px Inter; opacity: .85; }
.wa-b { position: relative; height: calc(100% - 76px); background: #EFEAE2; padding: 18px; display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; }
.bub { align-self: flex-start; max-width: 85%; padding: 12px 16px 8px; border-radius: 4px 18px 18px 18px; background: #fff; color: #111B21; font: 500 23px/1.3 Inter; box-shadow: 0 1px 1px rgba(0,0,0,.12); transform-origin: 0 0; }
.bub small { display: block; text-align: right; font: 500 14px Inter; color: #667781; margin-top: 2px; }
/* ChatGPT */
.gpt { background: #212121; color: #ECECEC; height: 100%; }
.gpt .hd { height: 60px; display: flex; align-items: center; gap: 12px; padding: 0 20px; font: 600 23px Inter; border-bottom: 1px solid #2F2F2F; }
.gpt .hd .ic, .gem .hd .ic { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.gpt .q { margin: 18px 20px 0 auto; max-width: 78%; padding: 14px 18px; border-radius: 22px; background: #303030; font: 500 21px/1.4 Inter; }
.gpt .a { padding: 18px 24px; font: 500 21px/1.5 Inter; white-space: pre-wrap; }
.sel { background: rgba(10,132,255,.5); border-radius: 4px; }
.caret { display: inline-block; width: 3px; height: 24px; margin-left: 2px; vertical-align: -4px; background: currentColor; }
/* Gemini */
.gem { background: #fff; color: #1F1F1F; height: 100%; }
.gem .hd { height: 60px; display: flex; align-items: center; gap: 12px; padding: 0 20px; font: 600 24px Inter; border-bottom: 1px solid #EEE; }
.gem .a { display: flex; gap: 14px; padding: 22px 24px; font: 500 22px/1.5 Inter; } .gem .a svg { flex: none; margin-top: 4px; }
/* Photos */
.ph-h { height: 74px; display: flex; align-items: baseline; gap: 14px; padding: 18px 22px 0; font: 700 32px Inter; color: #111; } .ph-h small { font: 500 21px Inter; color: #8E8E93; }
.ph-g { position: relative; height: calc(100% - 74px); overflow: hidden; } .ph-in { position: absolute; left: 4px; right: 4px; top: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.ph-in img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
/* Notes */
.notes { background: #FFFDF5; height: 100%; } .nt-h { height: 56px; display: flex; align-items: center; padding: 0 20px; background: #F6F1DF; font: 600 21px Inter; color: #C79A00; }
.nt-b { padding: 18px 26px; font: 500 23px/1.75 Inter; color: #2B2933; } .nt-b .t { font: 700 30px Inter; margin-bottom: 6px; }
/* Notifications */
.notif { width: 760px; display: flex; gap: 22px; align-items: center; padding: 22px 28px; border-radius: 38px; background: rgba(246,245,250,.96); color: #1C1A24; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
.notif .ic { flex: none; width: 76px; height: 76px; border-radius: 19px; display: flex; align-items: center; justify-content: center; }
.notif .hd { font: 500 25px Inter; color: #6E6A7B; } .notif .hd b { font-weight: 700; color: #1C1A24; } .notif .msg { font: 600 32px/1.25 Inter; }
/* Carte de l'accroche */
.hook { width: 380px; border-radius: 30px; overflow: hidden; background: #fff; color: #111; box-shadow: 0 50px 110px rgba(0,0,0,.6); }
.hook img { display: block; width: 380px; height: 430px; object-fit: cover; object-position: 50% 40%; }
.hook .hp { display: flex; justify-content: space-between; align-items: center; padding: 16px 22px; font: 600 24px Inter; } .hook .hp b { font: 700 32px Inter; color: #007782; }
/* Sous-titres */
.cap { position: absolute; text-align: center; font-weight: 700; letter-spacing: -0.03em; line-height: 1.08; text-shadow: 0 6px 34px rgba(0,0,0,.6); }
.cap .w { display: inline-block; background-repeat: no-repeat; background-position: 0 86%; background-image: linear-gradient(rgba(226,198,124,.3), rgba(226,198,124,.3)); background-size: 0% 30%; }
#capband { position: absolute; left: 0; right: 0; top: 0; height: 760px; background: linear-gradient(180deg, rgba(14,12,19,.92) 0, rgba(14,12,19,.82) 520px, rgba(14,12,19,0) 760px); }
#chip { position: absolute; top: 236px; right: 64px; display: flex; align-items: center; gap: 12px; padding: 14px 26px 14px 22px; border-radius: 99px; font: 600 34px Inter; letter-spacing: -.01em; white-space: nowrap; transform-origin: 100% 50%; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18); backdrop-filter: blur(8px); }
#chip i { width: 14px; height: 14px; border-radius: 50%; background: #B9A6FF; box-shadow: 0 0 12px #B9A6FF; }
#chip.red { background: rgba(180,35,24,.4); border-color: rgba(240,133,122,.85); color: #FFD9D4; } #chip.red i { background: #FF6B5E; box-shadow: 0 0 14px #FF6B5E; }
#chip.gold { background: rgba(226,198,124,.16); border-color: rgba(226,198,124,.85); color: #F3E2B3; } #chip.gold i { background: #E2C67C; box-shadow: 0 0 14px #E2C67C; }
/* Logo */
#brand { position: absolute; inset: 0; }
#logoBox { position: absolute; left: 0; top: 0; width: 600px; height: 186px; }
#logoBox img, #logoShine { position: absolute; inset: 0; width: 600px; height: 186px; }
#logoShine { -webkit-mask: url("${dataUri(LOGO)}") 0 0 / 100% 100% no-repeat; background: linear-gradient(105deg, transparent 0 38%, rgba(255,246,220,.95) 50%, transparent 62% 100%) no-repeat; background-size: 300% 100%; }
/* iPhone */
#phoneLayer { position: absolute; inset: 0; perspective: 2400px; perspective-origin: 540px 960px; }
#phone { position: absolute; left: 0; top: 0; width: 636px; height: 1337px; border-radius: 102px; background: #0B0B0C; box-shadow: 0 0 0 3px #4A4652, 0 0 0 8px #17151C, 0 60px 160px rgba(100,66,214,.45), 0 30px 60px rgba(0,0,0,.6); transform-origin: 0 0; transform-style: flat; }
#screen { position: absolute; left: 18px; top: 18px; width: 600px; height: 1301px; border-radius: 84px; overflow: hidden; background: #121017; }
.pg { position: absolute; left: 0; top: 0; width: 600px; height: 1301px; overflow: hidden; background: #17151D; }
.pg .pc { position: absolute; left: 0; top: 0; width: 600px; }
.pg .ph { position: absolute; left: 0; top: 0; width: 600px; overflow: hidden; } .pg .ph img { width: 600px; display: block; }
#sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 0 42%, rgba(255,255,255,.07) 50%, transparent 58% 100%); background-size: 300% 100%; }
#phone .di { position: absolute; top: 35px; left: 222px; width: 192px; height: 56px; border-radius: 99px; background: #000; }
.pop { position: absolute; border-radius: 16px; background-repeat: no-repeat; background-size: 600px auto; }
.tap { position: absolute; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; background: rgba(255,255,255,.35); border: 3px solid rgba(255,255,255,.7); }
.ripple { position: absolute; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; border: 4px solid rgba(255,255,255,.8); }
.fchip { display: flex; align-items: center; gap: 18px; padding: 18px 26px 18px 18px; border-radius: 30px; background: rgba(32,28,44,.72); border: 2px solid rgba(255,255,255,.14); backdrop-filter: blur(14px); box-shadow: 0 24px 60px rgba(0,0,0,.45); white-space: nowrap; }
.fchip .ic { width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; background: rgba(124,92,235,.3); }
.fchip.gold { border-color: rgba(226,198,124,.6); } .fchip.gold .ic { background: rgba(226,198,124,.22); }
.fchip small { display: block; font: 500 22px Inter; color: rgba(255,255,255,.62); } .fchip b { display: block; font: 700 32px Inter; color: #fff; } .fchip.gold b { color: #F3E2B3; }
/* Final */
#carousel { position: absolute; left: 540px; top: 1260px; width: 0; height: 0; transform-style: preserve-3d; }
.cc { position: absolute; left: -140px; top: -303px; width: 280px; height: 606px; border-radius: 36px; overflow: hidden; background: #17151D; border: 3px solid #45414F; box-shadow: 0 30px 70px rgba(0,0,0,.5); backface-visibility: hidden; }
.cc img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.btn { padding: 36px 66px; border-radius: 99px; background: linear-gradient(90deg, #5232B5, #7C5CEB); font: 700 48px Inter; white-space: nowrap; box-shadow: 0 20px 60px rgba(100,66,214,.6), inset 0 0 0 2px rgba(255,255,255,.18); overflow: hidden; }
.btn .shine { position: absolute; top: 0; bottom: 0; width: 140px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent); transform: skewX(-20deg); }
.small { font: 500 25px/1.4 Inter; color: rgba(255,255,255,.55); text-align: center; }
#dark, #flash, #redtint, #vignette, #scan { position: absolute; inset: 0; pointer-events: none; }
#dark { background: #07060A; }
#flash { background: radial-gradient(circle at 540px 960px, #fff, rgba(214,200,255,.75) 30%, rgba(124,92,235,0) 70%); }
#redtint { background: radial-gradient(ellipse at 50% 55%, rgba(220,40,30,0) 30%, rgba(220,40,30,.35) 100%); }
#vignette { background: radial-gradient(ellipse 75% 60% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%); }
#scan { background: repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 2px, transparent 2px 6px); }
#grain { mix-blend-mode: overlay; opacity: .09; }
`;

const ph = (n) => `file://${PHOTOS}/${n}.webp`;
const winHtml = {
  vinted: () => `<div class="bar" style="background:#007782">${svg("vinted", 34)}Vinted<span class="dots"><i></i><i></i><i></i></span></div>
    <div class="vphoto"><img src="${ph("g-yw5b-1")}"/><span class="vlike">${svg("heart", 26)}<b id="vlikes">14</b></span></div>
    <div class="vinfo"><div class="vt">Pull à pois Tommy Hilfiger</div><div class="vs">M · Très bon état · Tommy Hilfiger</div><div class="vp">18,00 €</div>
    <div class="vdesc" id="vdesc">Ajoute une description…</div><div class="vbtn">Offres reçues · <span id="voff">3</span></div></div>
    <div class="menu" id="m-paste" style="left:150px;top:600px">Coller</div>`,
  excel: () => `<div class="bar" style="background:#107C41">${svg("excel", 32)}stock_final_V3_vraiment_final.xlsx</div>
    <div class="ribbon"><b>Accueil</b><span>Insertion</span><span>Formules</span><span>Données</span><span>Affichage</span></div>
    <div class="xfx"><i>fx</i><span id="xfx"></span></div>
    <table class="xg"><colgroup><col style="width:46px"><col style="width:214px"><col><col><col><col style="width:110px"></colgroup>
    <tr><th></th><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th></tr>
    <tr><td class="rn">1</td><td><b>Article</b></td><td class="n"><b>Achat</b></td><td class="n"><b>Vente</b></td><td class="n"><b>Frais</b></td><td class="n"><b>Marge</b></td></tr>
    ${EXCEL_ROWS.map((r, i) => `<tr><td class="rn">${i + 2}</td>${r.map((_, c) => `<td class="${c ? "n" : ""}" id="x${i}-${c}"></td>`).join("")}</tr>`).join("")}
    <tr><td class="rn">8</td><td class="tot">Total</td><td></td><td></td><td></td><td class="n tot" id="xtot"></td></tr></table>`,
  calc: () => `<div class="cdisp" id="cdisp">0</div><div class="ckeys">${["AC", "±", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ",", "⌫", "="].map((k, i) => `<span id="ck${i}" class="${[3, 7, 11, 15, 19].includes(i) ? "op" : i < 3 ? "fn" : ""}">${k}</span>`).join("")}</div>`,
  discord: () => `<div class="dsc"><div class="rail"><i style="background:#5865F2">${svg("discord", 28)}</i><i style="background:#3BA55C">FR</i><i style="background:#EB459E">VD</i><i style="background:#F0B232">TH</i><i style="background:#ED4245">RE</i></div>
    <div class="main"><div class="ch"># bons-plans<span class="bdg">99+</span></div><div class="msgs"><div class="list" id="dlist">${DISCORD.map(([n, c, m], i) => `<div class="dm" id="dm${i}"><span class="av" style="background:${c}"></span><div><b style="color:${c}">${n}</b><small>aujourd'hui</small><p>${m}</p></div></div>`).join("")}</div></div></div></div>`,
  whatsapp: () => `<div class="wa-h"><span class="av">L</span><div><b>Léa</b><small>en ligne</small></div></div><div class="wa-b">${WA.map(([, m], i) => `<div class="bub" id="wa${i}">${m}<small>21:0${4 + i}</small></div>`).join("")}</div>`,
  chatgpt: () => `<div class="gpt"><div class="hd"><span class="ic" style="background:#0D0D0D">${svg("chatgpt", 26)}</span>ChatGPT</div><div class="q" id="gq"></div><div class="a" id="ga"></div>
    <div class="menu" id="m-copy" style="left:240px;top:150px">Copier</div></div>`,
  gemini: () => `<div class="gem"><div class="hd"><span class="ic">${svg("gemini", 32)}</span>Gemini</div><div class="a">${svg("gemini", 30)}<span id="gemtxt"></span></div></div>`,
  photos: () => `<div class="ph-h">Photos<small>247 éléments</small></div><div class="ph-g"><div class="ph-in" id="phin">${[...GALLERY, ...GALLERY].map((n) => `<img src="${ph(`r-${n}`)}"/>`).join("")}</div></div>`,
  notes: () => `<div class="notes"><div class="nt-h">‹ Notes</div><div class="nt-b" id="notes">${NOTES.map((l, i) => `<div class="${i ? "" : "t"}" id="nl${i}"></div>`).join("")}</div></div>`,
};
const notifHtml = (n, i) => `<div class="sp notif" id="nt${i}"><span class="ic" style="background:${n.bg ?? { vinted: "#007782", discord: "#5865F2", whatsapp: "#25D366", excel: "#107C41" }[n.app]}">${svg(n.app, 46)}</span><div><div class="hd"><b>${n.who}</b>${n.where ? ` · ${n.where}` : ""} · maintenant</div><div class="msg">${n.msg}</div></div></div>`;
const FICON = {
  box: `<path d="M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8"/>`, bag: `<path d="M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2"/>`, chart: `<path d="M4 20V10 M10 20V4 M16 20v-7 M21 20H3"/>`,
  coin: `<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5a3 3 0 1 0 0 5 M8.5 11h5 M8.5 13h5"/>`, shield: `<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z M9 12l2 2 4-4"/>`,
  star: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`, clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
};
const fchipHtml = (c, i) => `<div class="sp fchip${c.gold ? " gold" : ""}" id="fc${i}"><span class="ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${c.gold ? "#E2C67C" : "#C9BBFF"}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FICON[c.ic]}</svg></span><div><small>${c.k}</small><b>${c.v}</b></div></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<canvas id="bg" width="1080" height="1920"></canvas>
<div id="scene"><div id="world">
  <div class="sp hook" id="hook"><img src="${ph("g-yw5b-1")}"/><div class="hp"><span>Pull à pois · M</span><b>18,00 €</b></div></div>
  ${WINS.map((w) => `<div class="win${w.id === "calc" ? " calc" : ""}" id="w-${w.id}" style="width:${w.w}px;height:${w.h}px">${winHtml[w.id]()}</div>`).join("\n  ")}
</div></div>
<div class="layer" id="notifs">${NOTIFS.map(notifHtml).join("")}</div>
<canvas id="fx" width="1080" height="1920"></canvas>
<div id="brand"><svg class="layer" viewBox="0 0 1080 1920" width="1080" height="1920"><g id="ringg"></g></svg><div id="logoBox"><img src="file://${LOGO}"/><div id="logoShine"></div></div></div>
<div id="phoneLayer"><div id="phone"><div id="screen">${PAGES.map((p) => `<div class="pg" id="pg-${p.id}"><img class="pc" src="file://${ECR}/${p.id}-full.png" style="height:${(p.size[1] * 600) / 1179}px"/><div class="ph" style="height:${(330 * 600) / 1179}px"><img src="file://${ECR}/${p.id}-full.png"/></div></div>`).join("")}<div id="sheen"></div></div><span class="di"></span><div id="pops"></div><div class="ripple" id="ripple"></div><div class="tap" id="tap"></div></div></div>
<div class="layer" id="fchips">${FCHIPS.map(fchipHtml).join("")}</div>
<div id="ctaScene"><div id="carousel">${CAROUSEL.map((id, i) => `<div class="cc" id="cc${i}"><img src="file://${ECR}/${id}-full.png"/></div>`).join("")}</div></div>
<div class="layer" id="cta">
  <div class="sp btn" id="btn"><span class="shine" id="shine"></span>Rejoins la bêta gratuite</div>
  <div class="sp" id="bio" style="font:600 40px Inter;color:#F3E2B3;display:flex;align-items:center;gap:14px">Lien en bio <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F3E2B3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/></svg></div>
  <div class="sp small" id="legal" style="width:900px">Outil indépendant, non affilié à Vinted ni aux marques citées.<br>Chiffres de démonstration.</div>
  <div class="ripple" id="ripple2"></div><div class="tap" id="tap2"></div>
</div>
<div id="redtint"></div>
<div id="dark"></div>
<div id="capband"></div>
<div class="layer" id="caps"></div>
<div id="chip"><i></i><span id="chipt"></span></div>
<div id="scan"></div>
<div id="flash"></div>
<div id="vignette"></div>
<canvas id="grain" width="1080" height="1920"></canvas>
<script>
const TL = ${JSON.stringify(TL)};
${readFileSync(`${HERE}engine.js`, "utf8")}
</script></body></html>`;
writeFileSync(`${HERE}scene.html`, html);
console.log("scene.html + timeline.json écrits");
