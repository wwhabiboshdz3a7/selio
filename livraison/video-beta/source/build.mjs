// Vidéo « Rejoins la bêta fermée » (80 s, 1080 × 1920) : timeline + page HTML pilotée par seek(t).
// Même direction artistique que le spot de 45 s (livraison/video-pub) : fond encre et améthyste, Inter, sous-titres
// karaoké, logo en anneau d'or, vrais écrans de la démo en mode sombre + maquettes (mocks/mocks.html) pour les étapes
// qui n'existent pas encore telles quelles dans le produit. Fil conducteur : le pull Tommy Hilfiger femme à pois.
// Écrit scene.html (rendu image par image) et timeline.json (relu par audio.py, srt.mjs et render.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.SELIO_ROOT || new URL("../../../", import.meta.url).pathname;
const FONT = dirname(createRequire(`${ROOT}apps/web/package.json`).resolve("@fontsource/inter/package.json")) + "/files";
const ECR = `${HERE}ecrans`;
const PHOTOS = `${ROOT}apps/web/public/demo/photos`;
const LOGO = `${ROOT}brand/selio-logo-blanc.png`;
const APPICON = `${ROOT}brand/selio-app-icon-noir.png`;
const DURATION = 80;
const S = 600 / 1179;
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const dataUri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const ph = (n) => `file://${PHOTOS}/${n}.webp`;
const MB = JSON.parse(readFileSync(`${HERE}mocks/boxes.json`, "utf8")); // boîtes des maquettes (px de capture)
const bx = (page, key) => { const b = MB[page]?.[key]; if (!b) throw new Error(`boîte absente : ${page}.${key}`); return b; };
const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

// Instants charnières, relus par le moteur
const T = { logo: 5.0, phoneIn: 6.6, phoneOut: 73.3, final: 74.0, btn: 77.3, bio: 78.2, tap: 79.0, dark: 79.55 };

// ---------- Sous-titres karaoké : [mot, instant, style] (g = or) — les 12 « phrases clés » du script ----------
const CAPS = [
  // 1 · accroche
  { top: 230, size: 84, words: [["Tu", 0.25], ["passes", 0.38], ["encore", 0.6], ["\n"], ["des", 0.85], ["heures…", 0.98, "g"]], out: 1.9 },
  { top: 230, size: 84, words: [["à", 1.98], ["chercher,", 2.1, "g"], ["\n"], ["photographier", 2.9, "g"], ["\n"], ["et", 3.55], ["republier ?", 3.7, "g"]], out: 4.5 },
  // 2 · Track
  { top: 300, size: 70, words: [["Revente", 7.5], ["moyenne", 7.72], ["\n"], ["13", 8.1, "g"], ["à", 8.25, "g"], ["14 € :", 8.35, "g"]], out: 10.2, spoken: "Revente moyenne treize à quatorze euros :" },
  { top: 300, size: 70, words: [["Track", 10.3, "g"], ["te", 10.55], ["fixe", 10.67], ["\n"], ["5 €", 11.3, "g"], ["d'achat", 11.5], ["maximum.", 11.75]], out: 13.3, spoken: "Track te fixe cinq euros d'achat maximum." },
  // 3 · Radar
  { top: 300, size: 70, words: [["Radar", 13.9, "g"], ["note", 14.12], ["chaque", 14.3], ["\n"], ["annonce", 14.55], ["sur", 14.85], ["100.", 14.98, "g"]], out: 16.7, spoken: "Radar note chaque annonce sur cent." },
  { top: 300, size: 70, words: [["82 :", 17.5, "g"], ["ton", 17.9], ["téléphone", 18.05], ["sonne,", 18.45]], out: 21.3, spoken: "Quatre-vingt-deux : ton téléphone sonne," },
  { top: 300, size: 70, words: [["tu", 22.2], ["cliques", 22.35], ["Acheter.", 22.7, "g"]], out: 24.4 },
  // 4 · contrôle
  { top: 300, size: 66, words: [["Tu", 24.9], ["vérifies", 25.05], ["toi-même", 25.4, "g"], ["\n"], ["étiquette", 25.9], ["et", 26.2], ["coutures,", 26.32]], out: 27.2 },
  { top: 300, size: 66, words: [["guidé", 27.3], ["par", 27.5], ["les", 27.6], ["\n"], ["indices", 27.75, "g"], ["d'authenticité,", 28.05, "g"]], out: 29.3 },
  { top: 300, size: 66, words: [["puis", 29.4], ["tu", 29.55], ["valides.", 29.7, "g"]], out: 30.85 },
  // 5 · Studio, dépôt
  { top: 300, size: 70, words: [["Dépose", 31.35], ["tes", 31.55], ["photos", 31.7], ["\n"], ["d'un", 32.0, "g"], ["coup :", 32.15, "g"]], out: 33.5 },
  { top: 300, size: 70, words: [["la", 33.6], ["photo", 33.72], ["du", 33.95], ["pull", 34.05], ["\n"], ["passe", 34.3], ["en", 34.5], ["principale.", 34.62, "g"]], out: 36.3 },
  // 6 · Studio, annonce
  { top: 300, size: 70, words: [["Titre", 36.9, "g"], ["complet,", 37.1], ["\n"], ["description", 37.6], ["optimisée :", 38.0, "g"]], out: 39.8 },
  { top: 300, size: 70, words: [["l'annonce", 39.9], ["s'écrit,", 40.15, "g"]], out: 42.1 },
  { top: 300, size: 70, words: [["les", 42.2], ["suivantes", 42.35], ["\n"], ["se", 42.75], ["préparent", 42.9, "g"], ["déjà.", 43.25, "g"]], out: 44.3 },
  // 7 · publication
  { top: 300, size: 70, words: [["Tu", 44.6], ["relis,", 44.75], ["tu", 45.1], ["publies :", 45.25, "g"]], out: 46.4 },
  { top: 300, size: 70, words: [["ton", 46.5], ["pull", 46.62], ["est", 46.85], ["en", 46.97], ["vente.", 47.1, "g"]], out: 48.3 },
  // 8 · dressing
  { top: 300, size: 70, words: [["Ton", 48.8], ["dressing,", 48.95, "g"], ["\n"], ["tel", 49.4], ["que", 49.52], ["tu", 49.62], ["le", 49.72], ["connais,", 49.85]], out: 51.2 },
  { top: 300, size: 70, words: [["avec", 51.3], ["une", 51.45], ["note", 51.55, "g"], ["sur", 51.75, "g"], ["100", 51.85, "g"], ["\n"], ["par", 52.2], ["annonce.", 52.32]], out: 54.3, spoken: "avec une note sur cent par annonce." },
  // 9 · ventes
  { top: 300, size: 70, words: [["Favoris,", 54.8, "g"], ["messages,", 55.6]], out: 57.2 },
  { top: 300, size: 66, words: [["négociation", 57.5], ["selon", 57.9], ["\n"], ["tes", 58.1], ["règles", 58.25, "g"], ["de", 58.5, "g"], ["prix :", 58.6, "g"]], out: 61.4 },
  { top: 300, size: 70, words: [["le", 61.7], ["pull", 61.8], ["est", 62.0], ["vendu.", 62.1, "g"]], out: 63.3 },
  // 10 · automatisation
  { top: 300, size: 70, words: [["La", 63.9], ["relance", 64.05, "g"], ["\n"], ["après", 64.4], ["24 heures ?", 64.55, "g"]], out: 65.6, spoken: "La relance après vingt-quatre heures ?" },
  { top: 300, size: 66, words: [["Avec", 65.7], ["les", 65.85], ["autres", 65.95], ["fonctions,", 66.15], ["\n"], ["incluses", 66.7, "g"], ["dans", 67.0, "g"], ["l'abonnement.", 67.1, "g"]], out: 68.3 },
  // 11 · gestion
  { top: 300, size: 70, words: [["Bordereaux", 68.9, "g"], ["d'envoi", 69.25], ["\n"], ["générés,", 69.55, "g"]], out: 70.85 },
  { top: 300, size: 66, words: [["puis", 70.95], ["l'export", 71.1, "g"], ["pour", 71.4], ["\n"], ["ton", 71.55], ["comptable :", 71.67, "g"]], out: 72.4 },
  { top: 300, size: 70, words: [["ventes", 72.5], ["et", 72.7], ["marges.", 72.8, "g"]], out: 73.25 },
  // 12 · final
  { top: 540, size: 92, width: 1000, slam: true, words: [["Du", 74.15], ["sourcing", 74.3], ["\n"], ["à", 74.8], ["la", 74.9], ["vente,", 75.0], ["\n"], ["un", 75.6], ["seul", 75.75, "g"], ["écosystème.", 75.95, "g"]], out: 99 },
];
// Fin de la voix (bouton, pas de sous-titre karaoké) : « Rejoins la bêta fermée : [LIEN] » → lien en bio
const VO_TAIL = { words: [["Rejoins", 77.3], ["la", 77.48], ["bêta", 77.58], ["fermée :", 77.78], ["lien", 78.25], ["en", 78.38], ["bio.", 78.48]], out: 79.5 };

// ---------- Pastille en haut à droite : [instant, texte, style] ("" = masquée) ----------
const CHIP = [[6.65, "Selio Track", ""], [13.55, "Selio Radar", ""], [24.55, "Contrôle à la réception", ""], [31.05, "Selio Studio", ""], [44.55, "Publication", ""],
  [48.55, "Dressing", ""], [54.55, "Ventes", ""], [63.55, "Automatisation", ""], [68.55, "Gestion", ""], [T.phoneOut, "", ""]];

// ---------- Accroche : un chrono qui s'emballe et trois corvées qui tournent en même temps ----------
const TIMER = { t0: 0.4, to: 6 * 3600 + 12 * 60 + 48, d: 1.5 }; // 00:00:00 → 06:12:48 pendant « des heures… »
const TASKS = [
  { t: 2.1, label: "Chercher", ic: "search", start: 4360, y: 1010 },
  { t: 2.9, label: "Photographier", ic: "camera", start: 2835, y: 1210 },
  { t: 3.7, label: "Republier", ic: "refresh", start: 1862, y: 1410 },
];
const SUCK = 4.4; // tout est aspiré au centre, puis le logo

// ---------- iPhone : 13 écrans (ecrans/page-*.png, 1179 px de large) ----------
const PAGES = ["track", "radar", "deal", "vlisting", "check", "studio", "studiolisting", "vpublished", "vdressing", "nego", "autohub", "orders", "analytics"]
  .map((id) => ({ id, size: pngSize(`${ECR}/page-${id}.png`) }));
const SWITCH = [13.5, 19.05, 21.6, 24.5, 31.0, 36.5, 45.1, 48.5, 57.2, 63.5, 68.5, 70.8]; // passage à l'écran suivant (balayage)
const SCROLL = {
  track: [[6.6, 0]],
  radar: [[13.5, 0], [15.05, 0], [15.5, 456]],
  deal: [[19.05, 0], [19.9, 0], [20.3, 645]],
  vlisting: [[21.6, 0]],
  check: [[24.5, 0]],
  studio: [[31.0, 0], [35.2, 0], [35.65, 3100]],
  studiolisting: [[36.5, 0], [42.0, 0], [42.4, 369]],
  vpublished: [[45.1, 0]],
  vdressing: [[48.5, 0]],
  nego: [[57.2, 0]],
  autohub: [[63.5, 760], [65.0, 760], [65.45, 5400]],
  orders: [[68.5, 0]],
  analytics: [[70.8, 300]],
};
// Zones de l'écran mises en avant (recadrage de l'image, anneau d'or)
const POPS = [
  { page: "track", box: bx("track", "t-avg"), t0: 8.0, t1: 10.1, s: 1.3 },
  { page: "track", box: bx("track", "t-low"), t0: 10.5, t1: 13.3, s: 1.15 },
  { page: "track", box: bx("track", "t-max"), t0: 11.25, t1: 13.3, s: 1.3, pulse: true },
  { page: "radar", box: bx("radar", "r-brand"), t0: 14.0, t1: 15.0, s: 1.3 },
  { page: "radar", box: bx("radar", "r-price"), t0: 14.6, t1: 15.3, s: 1.08 },
  { page: "radar", box: bx("radar", "r-score"), t0: 15.7, t1: 16.8, s: 1.35, pulse: true },
  { page: "deal", box: bx("deal", "d-score"), t0: 19.4, t1: 20.4, s: 1.5, ring: 0.82 },
  { page: "deal", box: bx("deal", "d-profit"), t0: 20.55, t1: 21.4, s: 1.1 },
  { page: "vlisting", box: bx("vlisting", "v-price"), t0: 22.0, t1: 23.2, s: 1.08 },
  { page: "studio", box: [150, 1717, 427, 1994], t0: 33.7, t1: 35.3, s: 1.25, pulse: true },
  { page: "studio", box: [99, 4301, 1080, 4433], t0: 35.75, t1: 36.45, s: 1.06 },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ page: "studiolisting", box: bx("studiolisting", `s-f${i}`), t0: 40.4 + (i - 1) * 0.25, t1: 42.0, s: 1.08 })),
  { page: "studiolisting", box: bx("studiolisting", "s-price"), t0: 42.55, t1: 43.9, s: 1.1, pulse: true },
  { page: "vpublished", box: bx("vpublished", "p-online"), t0: 45.7, t1: 47.8, s: 1.4 },
  { page: "vpublished", box: bx("vpublished", "p-stats"), t0: 47.0, t1: 48.3, s: 1.1 },
  { page: "vdressing", box: bx("vdressing", "w-pull"), t0: 48.9, t1: 49.65, s: 1.07 },
  ...[1248, 1872, 2496, 3120].map((y, i) => ({ page: "autohub", box: [875, y, 1068, y + 72], t0: 64.0 + i * 0.25, t1: 65.3, s: 1.3 })),
  { page: "autohub", box: [279, 7276, 598, 7336], t0: 65.7, t1: 68.3, s: 1.35, pulse: true },
  { page: "analytics", box: [51, 1366, 588, 1756], t0: 71.1, t1: 72.4, s: 1.07 },
  { page: "analytics", box: [591, 1366, 1128, 1756], t0: 71.3, t1: 72.4, s: 1.07 },
  { page: "analytics", box: [48, 871, 475, 979], t0: 71.9, t1: 72.5, s: 1.15 },
];
const tapAt = (page, key, t) => { const [x, y] = mid(bx(page, key)); return { page, t, x, y }; };
const TAPS = [
  tapAt("radar", "r-start", 16.5), tapAt("deal", "d-open", 21.4), tapAt("vlisting", "v-buy", 23.5), tapAt("check", "c-validate", 29.9),
  { page: "studio", t: 35.95, x: 589, y: 4367 }, tapAt("studiolisting", "s-publish", 44.85), { page: "analytics", t: 72.2, x: 261, y: 925 },
];
// Les six photos du pull, déposées d'un coup : elles partent du même point et rejoignent les emplacements du générateur.
const SLOTS = [[150, 1717, 427, 1994], [451, 1717, 728, 1994], [752, 1717, 1029, 1994], [150, 2018, 427, 2295], [451, 2018, 728, 2295], [752, 2018, 1029, 2295]];
const FLY = SLOTS.map((slot, i) => ({ n: `g-yw5b-${i + 1}`, slot, t: 31.55 + i * 0.13, from: [-330 + 14 * i, 1150 + 22 * (i % 3), [-18, -6, 8, -12, 4, 14][i]] }));
const P0 = { fx: 589, fy: 1278, k: 0.95, X: 540, Y: 1200, rx: 6, ry: -9 };
const Z = (fx, fy, k, X, Y, rx, ry) => ({ fx, fy, k, X, Y, rx, ry });
const CAM = [
  { t: 6.6, ...P0, Y: 2600, rx: 24, ry: -20 }, { t: 7.3, ...P0 }, { t: 7.9, ...P0, ry: -6 },
  { t: 8.1, ...Z(589, 950, 1.2, 540, 1050, 3, -4) }, { t: 10.0, ...Z(589, 950, 1.2, 540, 1050, 3, -2) },
  { t: 10.5, ...Z(589, 1650, 1.2, 540, 1150, 3, 0) }, { t: 13.2, ...Z(589, 1650, 1.2, 540, 1150, 3, 2) },
  { t: 13.5, ...P0, ry: 6 }, { t: 15.0, ...P0, ry: 4 },
  { t: 15.5, ...Z(589, 1950, 1.1, 540, 1200, 3, 2) }, { t: 16.8, ...Z(589, 1950, 1.1, 540, 1200, 3, 0) },
  { t: 16.95, ...P0, k: 0.9, Y: 1250, ry: -4 }, { t: 18.9, ...P0, k: 0.9, Y: 1250, ry: -2 },
  { t: 19.05, ...P0, k: 0.98, ry: 5 }, { t: 19.4, ...Z(300, 570, 1.25, 480, 1000, 3, 3) }, { t: 20.25, ...Z(300, 570, 1.25, 480, 1000, 3, 2) },
  { t: 20.5, ...Z(589, 2000, 1.15, 540, 1150, 3, 1) }, { t: 21.5, ...Z(589, 2000, 1.15, 540, 1150, 3, 0) },
  { t: 21.6, ...P0, ry: -6 }, { t: 23.3, ...P0, ry: -4 }, { t: 23.5, ...Z(589, 2238, 1.15, 540, 1150, 3, -2) }, { t: 24.4, ...Z(589, 2238, 1.15, 540, 1150, 3, 0) },
  { t: 24.5, ...P0, ry: 7 }, { t: 25.4, ...P0, ry: 6 }, { t: 25.6, ...Z(589, 1850, 1.18, 540, 1100, 3, 4) }, { t: 28.6, ...Z(589, 1850, 1.18, 540, 1100, 3, 2) },
  { t: 29.0, ...P0, k: 1.0, ry: 3 }, { t: 30.9, ...P0, k: 1.0, ry: 1 },
  { t: 31.0, ...P0, ry: -8 }, { t: 33.4, ...P0, ry: -6 }, { t: 33.6, ...Z(400, 1850, 1.25, 520, 1050, 3, -4) }, { t: 35.1, ...Z(400, 1850, 1.25, 520, 1050, 3, -2) },
  { t: 35.3, ...P0, k: 0.98, ry: -3 }, { t: 36.4, ...P0, k: 0.98, ry: -1 },
  { t: 36.5, ...Z(589, 1000, 1.15, 540, 1100, 3, 5) }, { t: 39.7, ...Z(589, 1000, 1.15, 540, 1100, 3, 3) },
  { t: 39.9, ...Z(589, 1350, 1.1, 540, 1150, 3, 3) }, { t: 42.0, ...Z(589, 1350, 1.1, 540, 1150, 3, 1) },
  { t: 42.4, ...P0, k: 1.0, ry: 1 }, { t: 44.9, ...P0, k: 1.0, ry: -1 },
  { t: 45.1, ...P0, ry: -5 }, { t: 45.6, ...P0, ry: -4 }, { t: 45.8, ...Z(589, 1750, 1.15, 540, 1100, 3, -2) }, { t: 48.4, ...Z(589, 1750, 1.15, 540, 1100, 3, 0) },
  { t: 48.5, ...P0, ry: 6 }, { t: 54.4, ...P0, ry: 3 },
  { t: 54.6, ...Z(310, 1000, 1.25, 500, 1050, 3, 2) }, { t: 57.0, ...Z(310, 1000, 1.25, 500, 1050, 3, 1) },
  { t: 57.2, ...P0, k: 0.98, ry: -4 }, { t: 58.1, ...P0, k: 0.98, ry: -3 }, { t: 58.3, ...Z(589, 1750, 1.12, 540, 1150, 3, -2) }, { t: 63.4, ...Z(589, 1750, 1.12, 540, 1150, 3, 1) },
  { t: 63.5, ...P0, ry: 7 }, { t: 65.3, ...P0, ry: 5 }, { t: 65.5, ...Z(440, 1900, 1.2, 540, 1150, 3, 3) }, { t: 68.4, ...Z(440, 1900, 1.2, 540, 1150, 3, 1) },
  { t: 68.5, ...P0, ry: -6 }, { t: 70.7, ...P0, ry: -4 },
  { t: 70.8, ...P0, k: 1.0, ry: 4 }, { t: 73.3, ...P0, k: 1.0, ry: 2 },
  { t: 74.0, ...Z(589, 1278, 0.05, 540, 960, 0, 40), ease: "in" },
];
const VIBRATE = [17.45, 17.85];
// Écran de veille + notification de Selio Radar
const LOCK = { off: 16.9, on: 17.3, out: 18.95, time: "9:41", date: "mardi 3 novembre" };
const ALERT = { t0: 17.45, t1: 19.15, tap: 18.95, y: 1000, title: "Affaire Radar : Pull Tommy Hilfiger femme à pois", body: "4,00 € · note 82 · revente estimée 13,50 €" };

const FICON = {
  box: `<path d="M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8"/>`, chart: `<path d="M4 20V10 M10 20V4 M16 20v-7 M21 20H3"/>`,
  coin: `<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5a3 3 0 1 0 0 5 M8.5 11h5 M8.5 13h5"/>`, shield: `<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z M9 12l2 2 4-4"/>`,
  star: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`, clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  tag: `<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.4 1.4 0 0 1 0 2l-6.6 6.6a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>`,
  check: `<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.2l2.5 2.5 5-5.2"/>`, text: `<path d="M5 6h14 M5 10.5h14 M5 15h9"/>`,
  ruler: `<path d="M3.5 16.5L16.5 3.5l4 4-13 13z M7 13l2 2 M10 10l2 2 M13 7l2 2"/>`, heart: `<path d="M12 20s-7-4.4-8.6-8.6C2.2 8.2 4.3 5.2 7.4 5.2c1.9 0 3.3 1 4.6 2.7 1.3-1.7 2.7-2.7 4.6-2.7 3.1 0 5.2 3 4 6.2C19 15.6 12 20 12 20z"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>`, camera: `<path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20v10H4z"/><circle cx="12" cy="13.3" r="3.2"/>`,
  refresh: `<path d="M20 11a8 8 0 0 0-14.6-3.5M4 13a8 8 0 0 0 14.6 3.5"/><path d="M20 4v4h-4M4 20v-4h4"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>`,
};

// ---------- Superpositions dans l'écran (px de capture de la page, suivent le défilement) ----------
const CHECK_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1C1A24" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>`;
const HEART = (c = "#FF6B8A") => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${c}"><path d="M12 21s-7.5-4.7-9.3-9.2C1.4 8.5 3.6 5.3 7 5.3c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.6 3.2 4.3 6.5C19.5 16.3 12 21 12 21z"/></svg>`;
const TITLE = "Pull Tommy Hilfiger femme col rond à pois · Bleu marine · Taille M · Très bon état · Coton";
const DESC = "Pull Tommy Hilfiger pour femme, bleu marine à pois blancs, col rond, maille fine en coton. Très bon état, porté deux fois, aucun défaut. Taille M, coupe droite, mesures sur les photos. Envoi rapide et soigné.";
const BADGES = [["w-badge1", 49.7, 90, true], ["w-badge2", 50.0, 80], ["w-badge3", 50.3, 70], ["w-badge4", 50.6, 85], ["w-badge5", 50.9, 75], ["w-badge6", 51.2, 65]];
const favBox = bx("vdressing", "w-fav1");
const OVERLAYS = [
  // contrôle à la réception : les trois indices se cochent
  ...[1, 2, 3].map((i) => ({ page: "check", box: bx("check", `c-${i}`), t0: [25.6, 26.5, 27.8][i - 1], t1: [26.6, 27.6, 28.9][i - 1], kind: "hl" })),
  ...[1, 2, 3].map((i) => ({ page: "check", box: bx("check", `c-dot${i}`), t0: [25.6, 26.5, 27.8][i - 1], t1: 99, kind: "pop", cls: "ck", html: CHECK_SVG })),
  // Studio : le titre et la description s'écrivent
  { page: "studiolisting", box: bx("studiolisting", "s-title"), t0: 37.0, t1: 99, kind: "type", d: 2.5, text: TITLE, cls: "tf" },
  { page: "studiolisting", box: bx("studiolisting", "s-desc"), t0: 39.9, t1: 99, kind: "type", d: 1.7, text: DESC, cls: "tf small" },
  // dressing : une note sur 100 par annonce
  ...BADGES.map(([k, t0, n, gold]) => ({ page: "vdressing", box: bx("vdressing", k), t0, t1: 99, kind: "pop", cls: gold ? "bd gold" : "bd", html: String(n) })),
  // ventes : les favoris arrivent sur le pull
  { page: "vdressing", box: favBox, t0: 54.7, t1: 57.2, kind: "count", cls: "fav", count: [0, 12, 54.8, 1.2], html: `${HEART()}<b></b>` },
  ...Array.from({ length: 7 }, (_, i) => ({ page: "vdressing", box: [favBox[0] + 20 + (i % 3) * 22, favBox[1] - 10, favBox[0] + 60 + (i % 3) * 22, favBox[1] + 30], t0: 54.85 + i * 0.16, t1: 56.3 + i * 0.16, kind: "heart", cls: "heart", html: HEART(i % 2 ? "#FF6B8A" : "#FF9DB0") })),
  // négociation selon les règles de prix
  { page: "nego", box: bx("nego", "n-offer"), t0: 57.6, t1: 99, kind: "fade", cls: "nline", html: `Offre reçue · 10,00 € — sous ton plancher (11,50 €)` },
  { page: "nego", box: [48, 1275, 1131, 1760], t0: 58.3, t1: 99, kind: "pop", cls: "ncard", html: `<div class="h"><img src="file://${APPICON}"/>Négociation automatique · ta règle de prix</div><div class="r"><span>Prix affiché</span><b>14,00 €</b></div><div class="r"><span>Ton prix plancher</span><b>11,50 €</b></div><div class="r"><span>Palier de remise</span><b>−10 %</b></div><div class="r gold"><span>Contre-offre envoyée</span><b>12,50 €</b></div><div class="f">Jamais sous ton plancher · message envoyé à Léa</div>` },
  { page: "nego", box: [48, 1790, 1131, 2060], t0: 59.4, t1: 99, kind: "pop", cls: "msgbox out", html: `<div class="msg out">Bonjour Léa ! 10 € c'est trop juste pour ce pull en très bon état. Je peux vous le faire à 12,50 € envoi compris, ça vous va ?<span class="t">20:05 · envoyé automatiquement</span></div>` },
  { page: "nego", box: [48, 2090, 1131, 2215], t0: 60.6, t1: 99, kind: "pop", cls: "msgbox in", html: `<div class="msg in">Parfait pour 12,50 €, je prends !<span class="t">20:11</span></div>` },
  { page: "nego", box: [48, 2245, 1131, 2370], t0: 61.8, t1: 99, kind: "pop", cls: "sold", html: `<span class="ok">${CHECK_SVG}</span>Vendu · 12,50 €` },
  // gestion : bordereaux générés (feuille par-dessus la liste des commandes)
  { page: "orders", box: [48, 1560, 1131, 2350], t0: 69.0, t1: 99, kind: "pop", cls: "sheet", html: `<div class="sh"><span class="ic">${ICON_SVG("box", "#E2C67C")}</span><div><b>3 bordereaux générés</b><small>commandés à la vente, prêts à imprimer</small></div></div>` },
  ...[["Pull Tommy Hilfiger femme à pois", "Léa M. · Lyon", 69.3], ["Pull ras de cou Tommy Hilfiger gris", "Nina V. · Nantes", 69.6], ["Cardigan à fleurs Tommy Hilfiger marine", "Sofia R. · Lille", 69.9]]
    .map(([a, b, t0], i) => ({ page: "orders", box: [78, 1790 + i * 172, 1101, 1942 + i * 172], t0, t1: 99, kind: "pop", cls: "row", html: `<span class="ok">${CHECK_SVG}</span><div><span>${a}</span><small>${b} · bordereau prêt</small></div>` })),
  // export pour le comptable
  { page: "analytics", box: [48, 2030, 1131, 2560], t0: 72.35, t1: 99, kind: "pop", cls: "sheet", html: `<div class="sh"><span class="ic">${ICON_SVG("chart", "#E2C67C")}</span><div><b>Export ventes et marges</b><small>CSV · 90 jours · 13 ventes · CA 206,86 € · marge brute 117,86 €</small></div></div><div class="tagline">${CHECK_SVG}<span>Prêt pour ton comptable</span></div>` },
];
function ICON_SVG(name, color) { return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FICON[name]}</svg>`; }

// Cartes flottantes autour du téléphone
const FCHIPS = [
  { t0: 11.4, t1: 13.3, x: 800, y: 1660, k: "Achat max conseillé", v: "5,00 €", ic: "coin", gold: true },
  { t0: 15.8, t1: 16.8, x: 300, y: 1700, k: "Alerte", v: "à partir de 80 / 100", ic: "star", gold: true },
  { t0: 20.6, t1: 21.5, x: 300, y: 1620, k: "Bénéfice estimé", v: "+5,70 €", ic: "coin", gold: true },
  { t0: 23.7, t1: 24.45, x: 780, y: 880, k: "Achat validé par toi", v: "4,00 €", ic: "check", gold: true },
  { t0: 30.1, t1: 30.95, x: 790, y: 880, k: "Contrôle", v: "3 indices vérifiés", ic: "shield", gold: true },
  { t0: 33.9, t1: 35.2, x: 790, y: 1700, k: "Couverture", v: "la photo du pull", ic: "star", gold: true },
  { t0: 42.7, t1: 44.3, x: 540, y: 1760, k: "En arrière-plan", v: "2 annonces se préparent", ic: "clock" },
  { t0: 46.3, t1: 48.3, x: 300, y: 1700, k: "Statut", v: "En ligne · 14,00 €", ic: "tag", gold: true },
  { t0: 52.3, t1: 54.4, x: 800, y: 1700, k: "Note du pull", v: "90 / 100", ic: "star", gold: true },
  { t0: 56.0, t1: 57.15, x: 540, y: 1760, k: "Message automatique", v: "envoyé aux 12 favoris", ic: "heart" },
  { t0: 58.5, t1: 61.6, x: 300, y: 1760, k: "Prix plancher", v: "11,50 € respecté", ic: "shield" },
  { t0: 62.0, t1: 63.4, x: 800, y: 1760, k: "Vendu", v: "12,50 €", ic: "coin", gold: true },
  { t0: 65.8, t1: 68.3, x: 300, y: 900, k: "Après-vente", v: "relance après 24 h", ic: "clock" },
  { t0: 66.7, t1: 68.35, x: 540, y: 1760, k: "Toutes ces fonctions", v: "incluses dans l'abonnement", ic: "check", gold: true },
  { t0: 69.1, t1: 70.7, x: 790, y: 880, k: "Après-vente", v: "3 bordereaux générés", ic: "box", gold: true },
  { t0: 72.4, t1: 73.25, x: 790, y: 880, k: "Export", v: "ventes et marges · CSV", ic: "chart", gold: true },
];
const CAROUSEL = ["overview", "radar", "studioann", "nego", "autohub", "analytics", "dressing", "cloud"];
// Petits coups de caméra et secousses sur les temps forts : [instant, amplitude]
const PUNCH = [[0.4, 0.03], [2.1, 0.04], [2.9, 0.04], [3.7, 0.04], [T.logo, 0.05], [8.1, 0.02], [11.3, 0.03], [17.45, 0.02], [19.4, 0.03], [23.5, 0.03], [29.9, 0.02], [34.6, 0.02],
  [42.55, 0.02], [45.7, 0.02], [49.7, 0.02], [61.8, 0.04], [66.7, 0.02], [72.35, 0.02], [T.final, 0.05]];
const SHAKE = [[2.1, 14], [2.9, 14], [3.7, 16], [T.logo, 26], [61.8, 12], [T.final, 22]];

// Bruitages (repris par audio.py) : [temps, type, paramètre]
const SFX = [
  ...Array.from({ length: 19 }, (_, i) => [0.4 + i * 0.08, "tick", 0]),
  [2.08, "slam", 0], [2.1, "impact", 1], [2.88, "slam", 1], [2.9, "impact", 1], [3.68, "slam", 2], [3.7, "impact", 1],
  [3.9, "riser", 1.05], [SUCK, "suck", 0.6], [T.logo, "impact", 0], [T.logo, "sparkle", 0.9], [T.logo + 0.5, "shine", 0],
  [6.6, "whoosh", 0], [8.0, "pop", 3], [10.5, "pop", 1], [11.25, "kaching", 0], [11.4, "pop", 4],
  [13.5, "whip", 0], [14.0, "pop", 2], [14.6, "pop", 3], [15.5, "swish", 0], [15.7, "pop", 4], [15.8, "pop", 2], [16.5, "tap", 0], [16.9, "thud", 0],
  [17.45, "notif", 0], [17.45, "buzz", 0], [17.85, "buzz", 0], [18.95, "tap", 0], [19.05, "whip", 1], [19.4, "sparkle", 0.5], [19.42, "pop", 3],
  [20.3, "swish", 1], [20.55, "kaching", 0], [20.6, "pop", 1], [21.4, "tap", 0], [21.6, "whip", 0], [22.0, "pop", 2], [23.5, "tap", 0], [23.55, "check", 0], [23.7, "pop", 4],
  [24.5, "whip", 1], [25.6, "check", 0], [26.5, "check", 0], [27.8, "check", 0], [29.9, "tap", 0], [30.1, "pop", 4],
  [31.0, "whip", 0], ...FLY.map((f, i) => [f.t + 0.36, "slam", i]), [33.7, "shimmer", 0], [33.9, "pop", 4], [35.65, "swish", 0], [35.95, "tap", 0],
  [36.5, "whip", 1], ...Array.from({ length: 31 }, (_, i) => [37.0 + i * 0.08, "type", i]), [39.9, "shimmer", 0],
  ...[1, 2, 3, 4, 5, 6].map((i) => [40.4 + (i - 1) * 0.25, "pop", i % 4]), [42.4, "swish", 1], [42.55, "kaching", 0], [42.7, "pop", 2],
  [44.85, "tap", 0], [45.1, "whip", 0], [45.7, "ding", 0], [45.72, "pop", 4], [46.3, "pop", 1],
  [48.5, "whip", 1], [48.9, "pop", 2], [49.7, "coin", 0], [49.7, "pop", 4], [50.0, "pop", 3], [50.3, "pop", 2], [50.6, "pop", 3], [50.9, "pop", 2], [51.2, "pop", 1], [52.3, "pop", 4],
  ...Array.from({ length: 12 }, (_, i) => [54.85 + i * 0.1, "blip", i * 0.6]), [56.0, "ding", 1], [56.02, "pop", 2],
  [57.2, "whip", 0], [57.6, "thud", 0], [58.3, "pop", 3], [58.5, "pop", 2], [59.4, "swish", 1], [60.6, "notif", 1], [61.8, "kaching", 0], [61.8, "impact", 1], [61.85, "sparkle", 0.6], [62.0, "pop", 4],
  [63.5, "whip", 1], [64.0, "check", 0], [64.25, "check", 0], [64.5, "check", 0], [64.75, "check", 0], [65.45, "swish", 0], [65.7, "pop", 3], [65.8, "pop", 2], [66.7, "ding", 1], [66.72, "pop", 4],
  [68.5, "whip", 0], [69.0, "pop", 1], [69.1, "pop", 4], [69.3, "check", 0], [69.6, "check", 0], [69.9, "check", 0],
  [70.8, "whip", 1], [71.1, "pop", 2], [71.3, "pop", 3], [72.2, "tap", 0], [72.35, "shimmer", 0], [72.4, "pop", 4],
  [T.phoneOut, "suck", 0.7], [T.final, "impact", 0], [T.final, "sparkle", 0.9], [74.15, "slam", 1], [74.8, "slam", 2], [75.6, "slam", 3], [75.95, "kaching", 0], [T.final + 0.5, "shine", 0],
  [T.btn, "pop", 4], [T.bio, "ding", 1], [T.tap, "tap", 0],
];

const TL = { DURATION, T, CAPS, VO_TAIL, CHIP, TIMER, TASKS, SUCK, PAGES, SWITCH, SCROLL, POPS, TAPS, FLY, CAM, VIBRATE, LOCK, ALERT, OVERLAYS, FCHIPS, CAROUSEL, PUNCH, SHAKE, SFX };
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
/* Accroche */
#hookScene { position: absolute; inset: 0; }
#timer { position: absolute; left: 0; top: 0; width: 1080px; text-align: center; }
#timer small { display: block; font: 600 30px Inter; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.62); }
#timer b { display: block; margin-top: 2px; font: 800 190px/1 Inter; letter-spacing: -.05em; font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 8px 40px rgba(0,0,0,.5); }
.task { position: absolute; left: 0; top: 0; width: 760px; height: 176px; display: flex; align-items: center; gap: 26px; padding: 0 40px 0 30px; border-radius: 34px; background: rgba(35,32,42,.92); box-shadow: 0 40px 100px rgba(0,0,0,.6), 0 0 0 2px rgba(255,255,255,.1); }
.task .ic { flex: none; width: 104px; height: 104px; border-radius: 30px; display: flex; align-items: center; justify-content: center; background: rgba(124,92,235,.28); }
.task .lb { flex: 1; font: 600 46px Inter; letter-spacing: -.02em; color: #EEEBF3; }
.task .tm { font: 700 54px Inter; letter-spacing: -.03em; font-variant-numeric: tabular-nums; color: #FF8F85; }
.task .dot { flex: none; width: 18px; height: 18px; border-radius: 50%; background: #FF5D5D; box-shadow: 0 0 16px #FF5D5D; }
/* Notification iOS */
.notif { width: 900px; display: flex; gap: 24px; align-items: center; padding: 24px 30px; border-radius: 42px; background: rgba(246,245,250,.97); color: #1C1A24; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
.notif img { flex: none; width: 84px; height: 84px; border-radius: 20px; }
.notif .hd { display: flex; justify-content: space-between; font: 500 24px Inter; color: #6E6A7B; } .notif .hd b { font-weight: 700; color: #1C1A24; letter-spacing: .02em; }
.notif .ti { margin-top: 4px; font: 700 29px/1.22 Inter; letter-spacing: -.01em; } .notif .bo { margin-top: 4px; font: 500 27px/1.25 Inter; color: #3F3B4A; }
/* Sous-titres */
.cap { position: absolute; text-align: center; font-weight: 700; letter-spacing: -0.03em; line-height: 1.08; text-shadow: 0 6px 34px rgba(0,0,0,.6); }
.cap .w { display: inline-block; background-repeat: no-repeat; background-position: 0 86%; background-image: linear-gradient(rgba(226,198,124,.3), rgba(226,198,124,.3)); background-size: 0% 30%; }
.cap.slam { font-weight: 800; letter-spacing: -0.045em; }
#capband { position: absolute; left: 0; right: 0; top: 0; height: 720px; background: linear-gradient(180deg, rgba(14,12,19,.92) 0, rgba(14,12,19,.8) 480px, rgba(14,12,19,0) 720px); }
#chip { position: absolute; top: 176px; right: 64px; display: flex; align-items: center; gap: 12px; padding: 13px 26px 13px 22px; border-radius: 99px; font: 600 32px Inter; letter-spacing: -.01em; white-space: nowrap; transform-origin: 100% 50%; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18); }
#chip i { width: 14px; height: 14px; border-radius: 50%; background: #B9A6FF; box-shadow: 0 0 12px #B9A6FF; }
/* Logo */
#brand { position: absolute; inset: 0; }
#logoBox { position: absolute; left: 0; top: 0; width: 600px; height: 186px; }
#logoBox img, #logoShine { position: absolute; inset: 0; width: 600px; height: 186px; }
#logoShine { -webkit-mask: url("${dataUri(LOGO)}") 0 0 / 100% 100% no-repeat; background: linear-gradient(105deg, transparent 0 38%, rgba(255,246,220,.95) 50%, transparent 62% 100%) no-repeat; background-size: 300% 100%; }
/* iPhone */
#phoneLayer { position: absolute; inset: 0; perspective: 2400px; perspective-origin: 540px 960px; }
#phone { position: absolute; left: 0; top: 0; width: 636px; height: 1337px; border-radius: 102px; background: #0B0B0C; box-shadow: 0 0 0 3px #4A4652, 0 0 0 8px #17151C, 0 60px 160px rgba(100,66,214,.45), 0 30px 60px rgba(0,0,0,.6); transform-origin: 0 0; transform-style: flat; }
#screen { position: absolute; left: 18px; top: 18px; width: 600px; height: 1301px; border-radius: 84px; overflow: hidden; background: #121017; }
.pg { position: absolute; left: 0; top: 0; width: 600px; height: 1301px; overflow: hidden; background: #1A1820; }
.pg .pc { position: absolute; left: 0; top: 0; width: 600px; }
.pg .ph { position: absolute; left: 0; top: 0; width: 600px; overflow: hidden; } .pg .ph img { width: 600px; display: block; }
.cover { position: absolute; background: #27242E; border-radius: 8px; }
.ovl { position: absolute; left: 0; top: 0; width: 600px; height: 0; }
.ov { position: absolute; transform-origin: 50% 50%; }
.ov.ck { border-radius: 50%; background: #E2C67C; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 3px rgba(226,198,124,.3), 0 0 18px rgba(226,198,124,.6); }
.ov.hl { border-radius: 10px; box-shadow: inset 0 0 0 2px rgba(226,198,124,.9); background: rgba(226,198,124,.08); }
.ov.tf { padding: 11px 13px; font: 500 22px/1.3 Inter; color: #EEEBF3; letter-spacing: -.01em; white-space: pre-wrap; overflow: hidden; } .ov.tf.small { font-size: 18px; line-height: 1.38; color: #D8D4E2; }
.ov.tf .caret { display: inline-block; width: 2.5px; height: 1em; background: #B5A3FF; vertical-align: -.15em; margin-left: 2px; }
.ov.bd { border-radius: 50%; background: rgba(26,24,32,.94); border: 2px solid #9B80F7; color: #EEEBF3; font: 700 24px Inter; letter-spacing: -.03em; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 16px rgba(0,0,0,.45); }
.ov.bd.gold { border-color: #E2C67C; color: #F3E2B3; box-shadow: 0 0 0 3px rgba(226,198,124,.25), 0 0 20px rgba(226,198,124,.45), 0 6px 18px rgba(0,0,0,.45); }
.ov.fav { border-radius: 99px; background: #fff; color: #1C1A24; font: 700 17px Inter; display: flex; align-items: center; justify-content: center; gap: 4px; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
.ov.heart { display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 6px rgba(0,0,0,.4)); }
.ov.nline { font: 500 16px Inter; color: #868193; display: flex; align-items: center; justify-content: center; }
.ov.ncard { border-radius: 18px; background: #23202A; border: 1px solid #48434F; padding: 16px 18px; color: #EEEBF3; font: 500 17px/1.3 Inter; box-shadow: 0 14px 40px rgba(0,0,0,.45); }
.ncard .h { display: flex; align-items: center; gap: 10px; font: 600 17px Inter; color: #C9BBFF; margin-bottom: 8px; } .ncard .h img { width: 28px; height: 28px; border-radius: 8px; }
.ncard .r { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid #37333F; color: #B4AFC0; } .ncard .r b { color: #EEEBF3; font-weight: 600; font-variant-numeric: tabular-nums; }
.ncard .r.gold b { color: #E8CF8E; font-size: 22px; } .ncard .f { margin-top: 8px; font-size: 14px; color: #868193; }
.ov.msgbox { display: flex; } .ov.msgbox.out { justify-content: flex-end; } .ov.msgbox.in { justify-content: flex-start; }
.msg { max-width: 84%; border-radius: 18px; padding: 11px 14px; font: 500 17px/1.33 Inter; } .msg.out { background: linear-gradient(90deg, #5232B5, #7C5CEB); color: #fff; border-bottom-right-radius: 5px; } .msg.in { background: #2D2A35; color: #EEEBF3; border-bottom-left-radius: 5px; }
.msg .t { display: block; margin-top: 5px; font-size: 12px; opacity: .65; }
.ov.sold { border-radius: 14px; background: rgba(226,198,124,.16); border: 1.5px solid rgba(226,198,124,.85); color: #F3E2B3; font: 600 21px Inter; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 0 24px rgba(226,198,124,.3); }
.ok { width: 24px; height: 24px; border-radius: 50%; background: #E2C67C; flex: none; display: flex; align-items: center; justify-content: center; } .ok svg { width: 16px; height: 16px; }
.ov.sheet { border-radius: 20px; background: #23202A; border: 1px solid #48434F; padding: 16px 18px; color: #EEEBF3; box-shadow: 0 -14px 50px rgba(0,0,0,.55); }
.sheet .sh { display: flex; align-items: center; gap: 14px; } .sheet .sh .ic { flex: none; width: 52px; height: 52px; border-radius: 16px; background: rgba(226,198,124,.16); display: flex; align-items: center; justify-content: center; }
.sheet .sh b { display: block; font: 600 25px Inter; letter-spacing: -.01em; } .sheet .sh small { display: block; margin-top: 3px; font: 500 16px/1.3 Inter; color: #868193; }
.sheet .tagline { margin-top: 18px; display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-radius: 14px; background: rgba(226,198,124,.14); border: 1.5px solid rgba(226,198,124,.7); color: #F3E2B3; font: 600 21px Inter; } .sheet .tagline svg { width: 20px; height: 20px; stroke: #F3E2B3; }
.ov.row { display: flex; align-items: center; gap: 14px; padding: 0 18px; border-radius: 14px; background: #2D2A35; font: 500 19px/1.25 Inter; color: #EEEBF3; } .ov.row small { display: block; color: #868193; font-size: 15px; margin-top: 2px; }
#lock { position: absolute; inset: 0; background: #000; } #lockwall { position: absolute; inset: 0; background: radial-gradient(ellipse 90% 60% at 30% 10%, rgba(124,92,235,.75), transparent 62%), radial-gradient(ellipse 70% 50% at 90% 90%, rgba(193,147,59,.45), transparent 60%), linear-gradient(180deg, #16131F, #0E0C13); text-align: center; color: #fff; }
#lockwall .lk { position: absolute; top: 56px; left: 0; right: 0; } #lockwall .lk svg { opacity: .8; }
#lockwall .tm { position: absolute; top: 108px; left: 0; right: 0; font: 600 120px/1 Inter; letter-spacing: -.04em; font-variant-numeric: tabular-nums; } #lockwall .dt { position: absolute; top: 236px; left: 0; right: 0; font: 500 24px Inter; color: rgba(255,255,255,.75); }
#sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 0 42%, rgba(255,255,255,.07) 50%, transparent 58% 100%); background-size: 300% 100%; }
#phone .di { position: absolute; top: 35px; left: 222px; width: 192px; height: 56px; border-radius: 99px; background: #000; }
.fly { position: absolute; left: 0; top: 0; width: ${(277 * S).toFixed(2)}px; height: ${(277 * S).toFixed(2)}px; border-radius: 10px; object-fit: cover; box-shadow: 0 30px 60px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.25); }
.pop { position: absolute; border-radius: 16px; background-repeat: no-repeat; background-size: 600px auto; }
.tap { position: absolute; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; background: rgba(255,255,255,.35); border: 3px solid rgba(255,255,255,.7); }
.ripple { position: absolute; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; border: 4px solid rgba(255,255,255,.8); }
.fchip { display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 18px; border-radius: 30px; background: rgba(32,28,44,.82); border: 2px solid rgba(255,255,255,.14); box-shadow: 0 24px 60px rgba(0,0,0,.45); white-space: nowrap; }
.fchip .ic { width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; background: rgba(124,92,235,.3); }
.fchip.gold { border-color: rgba(226,198,124,.6); } .fchip.gold .ic { background: rgba(226,198,124,.22); }
.fchip small { display: block; font: 500 24px Inter; color: rgba(255,255,255,.62); } .fchip b { display: block; font: 700 35px Inter; color: #fff; font-variant-numeric: tabular-nums; } .fchip.gold b { color: #F3E2B3; }
/* Final */
#ctaScene { position: absolute; inset: 0; perspective: 1700px; perspective-origin: 540px 960px; }
#carousel { position: absolute; left: 540px; top: 1260px; width: 0; height: 0; transform-style: preserve-3d; }
.cc { position: absolute; left: -140px; top: -303px; width: 280px; height: 606px; border-radius: 36px; overflow: hidden; background: #17151D; border: 3px solid #45414F; box-shadow: 0 30px 70px rgba(0,0,0,.5); backface-visibility: hidden; }
.cc img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.btn { padding: 36px 66px; border-radius: 99px; background: linear-gradient(90deg, #5232B5, #7C5CEB); font: 700 48px Inter; white-space: nowrap; box-shadow: 0 20px 60px rgba(100,66,214,.6), inset 0 0 0 2px rgba(255,255,255,.18); overflow: hidden; }
.btn .shine { position: absolute; top: 0; bottom: 0; width: 140px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent); transform: skewX(-20deg); }
.small { font: 500 25px/1.4 Inter; color: rgba(255,255,255,.55); text-align: center; }
#dark, #flash, #vignette { position: absolute; inset: 0; pointer-events: none; }
#dark { background: #07060A; }
#flash { background: radial-gradient(circle at 540px 960px, #fff, rgba(214,200,255,.75) 30%, rgba(124,92,235,0) 70%); }
#vignette { background: radial-gradient(ellipse 75% 60% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%); }
#grain { mix-blend-mode: overlay; opacity: .09; }
`;


const fchipHtml = (c, i) => `<div class="sp fchip${c.gold ? " gold" : ""}" id="fc${i}"><span class="ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${c.gold ? "#E2C67C" : "#C9BBFF"}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FICON[c.ic]}</svg></span><div><small>${c.k}</small><b id="fcv${i}">${c.v}</b></div></div>`;
const px = (v) => `${(v * S).toFixed(1)}px`;
const overlayHtml = (o, i) => `<div class="ov ${o.cls || ""}" id="ov${i}" style="left:${px(o.box[0])};top:${px(o.box[1])};width:${px(o.box[2] - o.box[0])};height:${px(o.box[3] - o.box[1])}">${o.html || ""}</div>`;
const pageHtml = (p) => {
  const h = (p.size[1] * 600) / 1179, src = `file://${ECR}/page-${p.id}.png`;
  const covers = p.id === "studio" ? FLY.map((f, i) => `<div class="cover" id="cv${i}" style="left:${(f.slot[0] * S - 3).toFixed(1)}px;width:${((f.slot[2] - f.slot[0]) * S + 6).toFixed(1)}px;height:${((f.slot[3] - f.slot[1]) * S + 6).toFixed(1)}px"></div>`).join("") : "";
  const ovs = OVERLAYS.map((o, i) => (o.page === p.id ? overlayHtml(o, i) : "")).join("");
  return `<div class="pg" id="pg-${p.id}"><img class="pc" src="${src}" style="height:${h.toFixed(1)}px"/>${covers}<div class="ovl" id="ovl-${p.id}">${ovs}</div><div class="ph" style="height:${(330 * S).toFixed(1)}px"><img src="${src}"/></div></div>`;
};
const taskHtml = (k, i) => `<div class="task" id="task${i}"><span class="ic"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#C9BBFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FICON[k.ic]}</svg></span><span class="lb">${k.label}</span><span class="tm" id="tm${i}">00:00:00</span><i class="dot"></i></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<canvas id="bg" width="1080" height="1920"></canvas>
<div id="hookScene">
  <div id="timer"><small>Temps passé</small><b id="timerv">00:00:00</b></div>
  ${TASKS.map(taskHtml).join("")}
</div>
<canvas id="fx" width="1080" height="1920"></canvas>
<div id="brand"><svg class="layer" viewBox="0 0 1080 1920" width="1080" height="1920"><g id="ringg"></g></svg><div id="logoBox"><img src="file://${LOGO}"/><div id="logoShine"></div></div></div>
<div id="ctaScene"><div id="carousel">${CAROUSEL.map((id, i) => `<div class="cc" id="cc${i}"><img src="file://${ECR}/thumb-${id}.jpg"/></div>`).join("")}</div></div>
<div id="phoneLayer"><div id="phone"><div id="screen">${PAGES.map(pageHtml).join("")}<div id="lock"><div id="lockwall"><div class="lk"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${FICON.lock}</svg></div><div class="tm">${LOCK.time}</div><div class="dt">${LOCK.date}</div></div></div><div id="sheen"></div></div><span class="di"></span><div id="pops"></div>${FLY.map((f, i) => `<img class="fly" id="fl${i}" src="${ph(f.n)}"/>`).join("")}<div class="ripple" id="ripple"></div><div class="tap" id="tap"></div></div></div>
<div class="sp notif" id="alert"><img src="file://${APPICON}"/><div style="flex:1;min-width:0"><div class="hd"><b>SELIO</b><span>maintenant</span></div><div class="ti">${ALERT.title}</div><div class="bo">${ALERT.body}</div></div></div>
<div class="ripple" id="ripple3"></div><div class="tap" id="tap3"></div>
<div class="layer" id="fchips">${FCHIPS.map(fchipHtml).join("")}</div>
<div class="layer" id="cta">
  <div class="sp btn" id="btn"><span class="shine" id="shine"></span>Rejoins la bêta fermée</div>
  <div class="sp" id="bio" style="font:600 40px Inter;color:#F3E2B3;display:flex;align-items:center;gap:14px">Lien en bio <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F3E2B3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/></svg></div>
  <div class="sp small" id="legal" style="width:940px">Outil indépendant, non affilié à Vinted ni aux marques citées.<br>Chiffres d'exemple · certains écrans sont des maquettes.</div>
  <div class="ripple" id="ripple2"></div><div class="tap" id="tap2"></div>
</div>
<div id="dark"></div>
<div id="capband"></div>
<div class="layer" id="caps"></div>
<div id="chip"><i></i><span id="chipt"></span></div>
<div id="flash"></div>
<div id="vignette"></div>
<canvas id="grain" width="1080" height="1920"></canvas>
<script>
const TL = ${JSON.stringify(TL)};
${readFileSync(`${HERE}engine.js`, "utf8")}
</script></body></html>`;
writeFileSync(`${HERE}scene.html`, html);
console.log("scene.html + timeline.json écrits ·", PAGES.length, "écrans ·", CAPS.length, "sous-titres ·", OVERLAYS.length, "superpositions");
