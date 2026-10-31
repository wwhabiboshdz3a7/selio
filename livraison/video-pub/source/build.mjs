// Spot publicitaire « Ce pull, trouvé à 3,50 € » (45 s, 1080 × 1920) : timeline + page HTML pilotée par seek(t).
// Même direction artistique que la vidéo « Et si une appli centralisait tout ? » (livraison/video) : fond encre et
// améthyste, Inter, sous-titres karaoké, révélation du logo en anneau d'or, vrais écrans de la démo en mode sombre.
// Écrit scene.html (rendu image par image) et timeline.json (sous-titres et bruitages, relus par audio.py et srt.mjs).
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
const DURATION = 45;
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const dataUri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const ph = (n) => `file://${PHOTOS}/${n}.webp`;

// ---------- Sous-titres karaoké : [mot, instant, style] (g = or, r = rouge) ----------
const CAPS = [
  // Acte 1 · l'affaire
  { top: 230, size: 84, words: [["Ce", 0.2], ["pull,", 0.32], ["trouvé", 0.55], ["à", 0.72], ["3,50 €…", 0.8, "g"]], out: 1.8 },
  { top: 230, size: 84, words: [["revente", 1.9], ["estimée :", 2.1], ["17,99 €.", 2.5, "g"]], out: 3.2 },
  { top: 230, size: 84, words: [["+10,71 €", 3.35, "g"], ["de", 3.7], ["bénéfice.", 3.8]], out: 4.3, spoken: "Plus dix euros soixante et onze de bénéfice." },
  { top: 230, size: 84, words: [["Et", 4.4], ["tu", 4.5], ["ne", 4.6], ["l'as", 4.7], ["même", 4.85, "g"], ["pas", 5.0, "g"], ["cherché.", 5.12, "g"]], out: 5.85 },
  { top: 1330, size: 66, words: [["Voici", 6.45], ["Selio.", 6.7, "g"]], out: 7.55 },
  // Acte 2 · Radar
  { top: 300, size: 70, words: [["Le", 8.3], ["Radar", 8.42, "g"], ["surveille", 8.75], ["\n"], ["tes", 9.15], ["recherches", 9.28], ["Vinted.", 9.72, "g"]], out: 10.3 },
  { top: 300, size: 70, words: [["Chaque", 10.4], ["affaire", 10.6], ["est", 10.85], ["\n"], ["notée", 11.0, "g"], ["sur", 11.25, "g"], ["100,", 11.38, "g"]], out: 11.95, spoken: "Chaque affaire est notée sur cent," },
  { top: 300, size: 70, words: [["avec", 12.05], ["le", 12.2], ["vrai", 12.3, "g"], ["bénéfice.", 12.45, "g"]], out: 13.0 },
  { top: 300, size: 70, words: [["Une", 13.1], ["pépite ?", 13.22, "g"], ["\n"], ["Ton", 13.75], ["téléphone", 13.88], ["sonne.", 14.2]], out: 14.65 },
  { top: 300, size: 70, words: [["Tu", 14.75], ["valides", 14.88], ["l'achat", 15.15], ["\n"], ["en", 15.5, "g"], ["un", 15.62, "g"], ["clic.", 15.75, "g"]], out: 16.6 },
  // Acte 3 · Studio
  { top: 300, size: 70, words: [["Tu", 16.95], ["prends", 17.08], ["4", 17.35, "g"], ["photos…", 17.48]], out: 18.4 },
  { top: 300, size: 70, words: [["l'IA", 18.5, "g"], ["rédige", 18.72], ["\n"], ["ton", 18.98], ["annonce :", 19.1]], out: 19.85 },
  { top: 300, size: 70, words: [["titre,", 19.95], ["marque,", 20.3], ["\n"], ["taille,", 20.65], ["état,", 21.0]], out: 21.45 },
  { top: 300, size: 70, words: [["et", 21.55], ["même", 21.68], ["le", 21.9], ["\n"], ["prix", 22.0, "g"], ["conseillé.", 22.2, "g"]], out: 22.85 },
  { top: 300, size: 70, words: [["Tu", 22.95], ["relis.", 23.08], ["Tu", 23.4], ["publies.", 23.52, "g"]], out: 24.0 },
  // Acte 4 · Négociation et automatisations
  { top: 300, size: 76, words: [["Une", 24.2], ["offre", 24.33], ["à", 24.6], ["13 € ?", 24.7, "r"]], out: 25.4, spoken: "Une offre à treize euros ?" },
  { top: 300, size: 70, words: [["Selio", 25.5], ["contre-propose", 25.72], ["\n"], ["17,10 €…", 26.25, "g"]], out: 27.0, spoken: "Selio contre-propose dix-sept euros dix…" },
  { top: 300, size: 68, words: [["sans", 27.1], ["jamais", 27.25], ["passer", 27.52], ["\n"], ["sous", 27.78], ["ton", 27.9], ["prix", 28.02, "g"], ["plancher.", 28.18, "g"]], out: 28.7 },
  { top: 300, size: 70, words: [["Favoris,", 28.85], ["réponses,", 29.25], ["\n"], ["après-vente…", 29.65]], out: 30.3 },
  { top: 300, size: 76, words: [["tout", 30.4], ["s'automatise.", 30.55, "g"]], out: 31.2 },
  // Acte 5 · Analyses
  { top: 300, size: 70, words: [["Et", 31.4], ["tu", 31.5], ["vois", 31.62], ["enfin", 31.8], ["\n"], ["tes", 32.1], ["vraies", 32.25, "g"], ["marges.", 32.5, "g"]], out: 33.2 },
  { top: 300, size: 80, words: [["Au", 33.3], ["centime", 33.42, "g"], ["près.", 33.75, "g"]], out: 34.5 },
  // Final
  { top: 330, size: 124, width: 1000, words: [["Trouve.", 34.7], ["Publie.", 35.2], ["\n"], ["Négocie.", 35.7], ["Encaisse.", 36.2, "g"]], out: 37.3, slam: true },
  { top: 560, size: 94, words: [["Une", 37.85], ["appli.", 38.0], ["\n"], ["Tout", 38.35], ["ton", 38.48], ["business", 38.6, "g"], ["Vinted.", 38.92, "g"]], out: 99 },
];
const VO_TAIL = { words: [["Rejoins", 39.6], ["la", 39.78], ["bêta", 39.88], ["gratuite :", 40.08], ["lien", 40.6], ["en", 40.72], ["bio.", 40.82]], out: 41.8 };

// ---------- Compteur en haut à droite : [instant, texte, style] ("" = masqué) ----------
const CHIP = [[7.95, "Selio Radar", ""], [16.75, "Selio Studio", ""], [23.95, "Négociation IA", ""], [28.75, "Automatisations", ""], [31.25, "Analyses", ""], [34.55, "", ""]];

// ---------- Acte 1 : la carte de l'affaire (chiffres de la démo, affaire « Exceptionnelle » du Radar) ----------
const HOOK = { photo: "r-s33t", title: "Sweat à col V rayé", brand: "Tommy Hilfiger · M", spotted: "repérée 2 min après publication" };
const NUM = [ // grand chiffre sous la carte : [début, libellé, valeur de départ, valeur d'arrivée, durée du défilement]
  [0.8, "Prix", 3.5, 3.5, 0], [2.3, "Revente estimée", 3.5, 17.99, 0.55], [3.35, "Bénéfice", 10.71, 10.71, 0],
];

// ---------- iPhone : écrans réels (ecrans/page-*.png, px de capture @3x ; un écran = 1179 × 2556) ----------
const PAGES = ["radar", "studio", "nego", "autohub", "analytics"].map((id) => ({ id, size: pngSize(`${ECR}/page-${id}.png`) }));
const SWITCH = [16.75, 23.95, 28.75, 31.25]; // passage à l'écran suivant (balayage)
const SCROLL = {
  radar: [[8.0, 0], [9.25, 0], [9.95, 4560], [14.25, 4560], [14.75, 10230], [15.0, 10230], [15.4, 10560]],
  studio: [[16.75, 0], [18.25, 0], [18.7, 1900]],
  nego: [[23.95, 0]],
  autohub: [[28.75, 760], [31.25, 980]],
  analytics: [[31.25, 1100], [34.5, 1260]],
};
const POPS = [
  { page: "radar", box: [75, 4730, 243, 4913], t0: 10.95, t1: 11.95, s: 1.55, ring: 0.99 },
  { page: "radar", box: [99, 5864, 411, 5936], t0: 11.15, t1: 11.95, s: 1.25 },
  { page: "radar", box: [118, 6860, 1061, 7160], t0: 12.25, t1: 13.05, s: 1.08 },
  { page: "radar", box: [99, 12871, 508, 12967], t0: 15.62, t1: 16.6, s: 1.18, pulse: true },
  { page: "studio", box: [99, 4000, 1080, 4132], t0: 18.95, t1: 19.8, s: 1.06 },
  { page: "nego", box: [147, 1335, 1032, 1509], t0: 24.45, t1: 25.45, s: 1.08 },
  { page: "nego", box: [147, 1533, 1032, 1887], t0: 25.75, t1: 27.05, s: 1.06 },
  { page: "nego", box: [147, 1659, 1032, 1707], t0: 27.25, t1: 28.7, s: 1.1 },
  { page: "autohub", box: [875, 1248, 1068, 1320], t0: 28.95, t1: 31.2, s: 1.3 },
  { page: "autohub", box: [875, 1872, 1068, 1944], t0: 29.3, t1: 31.2, s: 1.3 },
  { page: "autohub", box: [875, 2496, 1068, 2568], t0: 29.7, t1: 31.2, s: 1.3 },
  { page: "autohub", box: [875, 3120, 1068, 3192], t0: 30.45, t1: 31.2, s: 1.3 },
  { page: "analytics", box: [60, 1395, 580, 1720], t0: 31.75, t1: 34.4, s: 1.07 },
  { page: "analytics", box: [600, 1395, 1120, 1720], t0: 32.3, t1: 34.4, s: 1.07 },
];
const TAPS = [
  { page: "radar", t: 15.75, x: 303, y: 12919 },
  { page: "studio", t: 18.95, x: 589, y: 4066 },
  { page: "nego", t: 28.25, x: 467, y: 2091 },
];
// Les quatre photos du pull à pois arrivent dans les emplacements du générateur (px de capture de page-studio).
const FLY = [
  { n: "g-yw5b-1", slot: [150, 1717, 427, 1994], t: 17.1, from: [-330, 160, -14] },
  { n: "g-yw5b-2", slot: [451, 1717, 728, 1994], t: 17.32, from: [700, 60, 12] },
  { n: "g-yw5b-3", slot: [752, 1717, 1029, 1994], t: 17.54, from: [760, 900, 16] },
  { n: "g-yw5b-4", slot: [150, 2018, 427, 2295], t: 17.76, from: [-300, 1000, -10] },
];
const P0 = { fx: 589, fy: 1278, k: 0.99, X: 540, Y: 1150, rx: 6, ry: -9 };
const CAM = [
  { t: 7.9, ...P0, Y: 2550, rx: 24, ry: -20 }, { t: 8.55, ...P0 }, { t: 9.25, ...P0, ry: -7 },
  { t: 9.95, ...P0, k: 1.04, ry: -5 },
  { t: 10.85, fx: 589, fy: 760, k: 1.2, X: 540, Y: 1080, rx: 3, ry: -4 }, { t: 11.95, fx: 589, fy: 760, k: 1.2, X: 540, Y: 1080, rx: 3, ry: -2 },
  { t: 12.3, fx: 589, fy: 2050, k: 1.22, X: 540, Y: 1240, rx: 3, ry: 0 }, { t: 13.0, fx: 589, fy: 2050, k: 1.22, X: 540, Y: 1240, rx: 3, ry: 1 },
  { t: 13.35, ...P0, Y: 1210, k: 0.95, ry: 4 }, { t: 14.55, ...P0, Y: 1210, k: 0.95, ry: 5 },
  { t: 15.0, ...P0, k: 1.0, ry: 3 }, { t: 15.5, fx: 589, fy: 1900, k: 1.16, X: 540, Y: 1180, rx: 3, ry: 2 }, { t: 16.6, fx: 589, fy: 1900, k: 1.16, X: 540, Y: 1180, rx: 3, ry: 0 },
  { t: 16.95, ...P0, ry: 8 }, { t: 18.25, ...P0, ry: 6 },
  { t: 18.7, fx: 589, fy: 1900, k: 1.1, X: 540, Y: 1150, rx: 3, ry: 3 }, { t: 19.7, fx: 589, fy: 1900, k: 1.1, X: 540, Y: 1150, rx: 3, ry: 1 },
  { t: 20.1, ...P0, k: 0.92, Y: 1200, ry: -3 }, { t: 23.8, ...P0, k: 0.92, Y: 1200, ry: -6 },
  { t: 24.3, fx: 589, fy: 1450, k: 1.26, X: 540, Y: 1080, rx: 2, ry: 5 }, { t: 25.5, fx: 589, fy: 1450, k: 1.26, X: 540, Y: 1080, rx: 2, ry: 4 },
  { t: 25.8, fx: 589, fy: 1700, k: 1.3, X: 540, Y: 1060, rx: 2, ry: 3 }, { t: 28.6, fx: 589, fy: 1760, k: 1.3, X: 540, Y: 1060, rx: 2, ry: 1 },
  { t: 28.95, ...P0, ry: -6 }, { t: 31.1, ...P0, k: 1.02, ry: -8 },
  { t: 31.6, fx: 589, fy: 800, k: 1.18, X: 540, Y: 1060, rx: 3, ry: -4 }, { t: 34.0, fx: 589, fy: 820, k: 1.18, X: 540, Y: 1060, rx: 3, ry: -1 },
  { t: 34.55, fx: 589, fy: 1278, k: 0.6, X: 540, Y: 1320, rx: 10, ry: 25 },
];
const VIBRATE = [13.15, 13.55];
// Cartes flottantes autour du téléphone (chiffres et textes lus dans la démo)
const FCHIPS = [
  { t0: 11.05, t1: 11.95, x: 820, y: 860, k: "Note", v: "99 / 100", ic: "star", gold: true },
  { t0: 12.35, t1: 13.05, x: 300, y: 860, k: "Revente estimée", v: "17,99 €", ic: "tag" },
  { t0: 12.5, t1: 13.05, x: 790, y: 1660, k: "Bénéfice", v: "+10,71 €", ic: "coin", gold: true },
  { t0: 15.85, t1: 16.65, x: 790, y: 860, k: "Achat validé", v: "en un clic", ic: "check", gold: true },
  { t0: 19.95, t1: 23.85, x: 540, y: 840, k: "Titre", v: "Pull à pois Tommy Hilfiger", ic: "text" },
  { t0: 20.3, t1: 23.85, x: 290, y: 1060, k: "Marque", v: "Tommy Hilfiger", ic: "tag" },
  { t0: 20.65, t1: 23.85, x: 820, y: 1240, k: "Taille", v: "M", ic: "ruler" },
  { t0: 21.0, t1: 23.85, x: 300, y: 1430, k: "État", v: "Très bon état", ic: "shield" },
  { t0: 22.0, t1: 23.85, x: 780, y: 1620, k: "Prix conseillé", v: "18,00 €", ic: "coin", gold: true },
  { t0: 23.0, t1: 23.85, x: 540, y: 1800, k: "Studio", v: "Rien n'est publié sans ton clic", ic: "check" },
  { t0: 26.1, t1: 27.05, x: 790, y: 820, k: "Contre-offre", v: "+4,10 € vs l'offre", ic: "coin", gold: true },
  { t0: 27.4, t1: 28.7, x: 290, y: 1700, k: "Prix plancher", v: "14,50 € respecté", ic: "shield" },
  { t0: 29.0, t1: 31.2, x: 300, y: 790, k: "Favoris", v: "petite remise envoyée", ic: "heart" },
  { t0: 29.4, t1: 31.2, x: 790, y: 1430, k: "Réponse auto", v: "questions courantes", ic: "text" },
  { t0: 29.8, t1: 31.2, x: 320, y: 1720, k: "Après-vente", v: "bordereau commandé", ic: "box" },
  { t0: 31.95, t1: 34.45, x: 290, y: 1520, k: "Chiffre d'affaires", v: "206,86 €", ic: "chart", count: [0, 206.86, 31.95, 0.9] },
  { t0: 32.45, t1: 34.45, x: 790, y: 1700, k: "Marge brute", v: "117,86 €", ic: "coin", gold: true, count: [0, 117.86, 32.45, 0.9] },
];
// Notification de Selio Radar (texte au format de opportunityAlertPayload, affaire de la démo)
const ALERT = { t0: 13.12, t1: 14.6, title: "Affaire Radar : Pull col V rayé Tommy Hilfiger fuchsia", body: "4,50 € · note 86 · revente estimée 15,42 €", tap: 14.2 };
const CAROUSEL = ["overview", "radar", "studioann", "nego", "autohub", "analytics", "dressing", "cloud"];
// Petits coups de caméra sur les temps forts : [instant, amplitude]
const PUNCH = [[0.8, 0.05], [2.5, 0.03], [3.35, 0.05], [8.42, 0.02], [11.0, 0.03], [15.75, 0.03], [17.35, 0.02], [18.5, 0.02], [22.0, 0.02], [24.7, 0.03], [26.25, 0.03], [30.55, 0.03], [32.25, 0.02], [33.42, 0.03]];
const SHAKE = [[0.3, 16], [0.8, 22], [3.35, 18], [6.0, 26], [37.55, 14]];

// Bruitages (repris par audio.py) : [temps, type, paramètre]
const SFX = [
  [0.27, "slam", 0], [0.3, "impact", 1], [0.8, "impact", 1], [0.82, "kaching", 0],
  ...Array.from({ length: 9 }, (_, i) => [2.3 + i * 0.06, "tick", 0]), [2.85, "coin", 0],
  [3.35, "impact", 1], [3.38, "kaching", 0], [3.6, "sparkle", 0.6], [3.62, "check", 0],
  [4.6, "riser", 1.35], [5.15, "suck", 0.8], [6.0, "impact", 0], [6.0, "sparkle", 0.9], [6.5, "shine", 0],
  [7.9, "whoosh", 0], [9.25, "whip", 0], [10.95, "sparkle", 0.5], [11.0, "pop", 3], [11.15, "pop", 4], [12.25, "kaching", 0], [12.4, "pop", 1], [12.55, "pop", 2],
  [13.12, "notif", 0], [13.15, "buzz", 0], [13.55, "buzz", 0], [14.2, "tap", 0], [14.25, "whip", 1], [15.0, "swish", 0],
  [15.75, "tap", 0], [15.8, "check", 0], [15.9, "pop", 4],
  [16.75, "whip", 0], ...FLY.map((f, i) => [f.t + 0.36, "slam", i]), [18.95, "tap", 0], [19.0, "shimmer", 0],
  ...Array.from({ length: 26 }, (_, i) => [19.95 + i * 0.075, "type", i]), [20.3, "pop", 1], [20.65, "pop", 2], [21.0, "pop", 3], [22.0, "kaching", 0], [23.0, "check", 0],
  [23.95, "whip", 1], [24.45, "thud", 0], [25.75, "ding", 0], [26.1, "pop", 4], [27.25, "check", 0], [27.4, "pop", 2], [28.25, "tap", 0],
  [28.75, "whip", 0], [28.95, "check", 0], [29.3, "check", 0], [29.7, "check", 0], [30.45, "check", 0], [29.0, "pop", 1], [29.4, "pop", 2], [29.8, "pop", 3],
  [31.25, "whip", 1], ...Array.from({ length: 12 }, (_, i) => [31.95 + i * 0.07, "tick", 0]), [32.85, "kaching", 0], [33.42, "coin", 0],
  [34.55, "whoosh", 1], [34.7, "slam", 1], [35.2, "slam", 2], [35.7, "slam", 3], [36.2, "slam", 4], [36.2, "kaching", 0],
  [36.7, "suck", 0.8], [37.55, "impact", 0], [37.6, "shine", 0], [38.9, "pop", 4], [39.6, "ding", 1], [41.3, "tap", 0],
];

const TL = { DURATION, CAPS, VO_TAIL, CHIP, HOOK, NUM, PAGES, SWITCH, SCROLL, POPS, TAPS, FLY, CAM, VIBRATE, FCHIPS, ALERT, CAROUSEL, PUNCH, SHAKE, SFX };
writeFileSync(`${HERE}timeline.json`, JSON.stringify(TL, null, 1));

// ---------- Page ----------
const S = 600 / 1179;
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
/* Acte 1 */
#hookScene { position: absolute; inset: 0; perspective: 1700px; perspective-origin: 540px 960px; }
#hookCard { position: absolute; left: 0; top: 0; width: 580px; border-radius: 36px; overflow: hidden; background: #23202A; box-shadow: 0 60px 140px rgba(0,0,0,.65), 0 0 0 2px rgba(255,255,255,.1); }
#hookCard img { display: block; width: 580px; height: 660px; object-fit: cover; object-position: 50% 45%; }
#hookCard .ft { padding: 22px 28px 26px; }
#hookCard .tt { font: 600 33px/1.15 Inter; letter-spacing: -.02em; color: #EEEBF3; }
#hookCard .st { margin-top: 6px; font: 500 24px Inter; color: #B4AFC0; }
#hookCard .sp2 { margin-top: 14px; display: inline-flex; align-items: center; gap: 10px; padding: 8px 16px; border-radius: 99px; background: rgba(155,128,247,.18); font: 600 22px Inter; color: #C9BBFF; }
#hookCard .sp2 i { width: 10px; height: 10px; border-radius: 50%; background: #B5A3FF; }
#hookRing { position: absolute; left: 22px; top: 22px; width: 132px; height: 132px; }
#hookRing .disc { position: absolute; inset: 0; border-radius: 50%; background: rgba(20,18,26,.82); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
#hookRing b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 700 50px Inter; letter-spacing: -.03em; color: #F3E2B3; }
#hookBadge { position: absolute; right: 22px; top: 40px; padding: 12px 20px; border-radius: 14px; background: rgba(251,247,236,.95); font: 700 25px Inter; color: #7A591A; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
#num { position: absolute; left: 0; top: 0; width: 1080px; text-align: center; }
#num small { display: block; font: 600 30px Inter; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.62); }
#num b { display: block; margin-top: 2px; font: 800 210px/1 Inter; letter-spacing: -.05em; font-variant-numeric: tabular-nums; color: #fff; }
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
.pg { position: absolute; left: 0; top: 0; width: 600px; height: 1301px; overflow: hidden; background: #1A1820; }
.pg .pc { position: absolute; left: 0; top: 0; width: 600px; }
.pg .ph { position: absolute; left: 0; top: 0; width: 600px; overflow: hidden; } .pg .ph img { width: 600px; display: block; }
.cover { position: absolute; background: #27242E; border-radius: 8px; }
#sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 0 42%, rgba(255,255,255,.07) 50%, transparent 58% 100%); background-size: 300% 100%; }
#phone .di { position: absolute; top: 35px; left: 222px; width: 192px; height: 56px; border-radius: 99px; background: #000; }
.fly { position: absolute; left: 0; top: 0; width: ${(277 * S).toFixed(2)}px; height: ${(277 * S).toFixed(2)}px; border-radius: 10px; object-fit: cover; box-shadow: 0 30px 60px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.25); }
.pop { position: absolute; border-radius: 16px; background-repeat: no-repeat; background-size: 600px auto; }
.tap { position: absolute; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; background: rgba(255,255,255,.35); border: 3px solid rgba(255,255,255,.7); }
.ripple { position: absolute; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; border: 4px solid rgba(255,255,255,.8); }
.fchip { display: flex; align-items: center; gap: 18px; padding: 18px 28px 18px 18px; border-radius: 30px; background: rgba(32,28,44,.78); border: 2px solid rgba(255,255,255,.14); box-shadow: 0 24px 60px rgba(0,0,0,.45); white-space: nowrap; }
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

const FICON = {
  box: `<path d="M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8"/>`, chart: `<path d="M4 20V10 M10 20V4 M16 20v-7 M21 20H3"/>`,
  coin: `<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5a3 3 0 1 0 0 5 M8.5 11h5 M8.5 13h5"/>`, shield: `<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z M9 12l2 2 4-4"/>`,
  star: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>`, clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  tag: `<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.4 1.4 0 0 1 0 2l-6.6 6.6a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>`,
  check: `<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.2l2.5 2.5 5-5.2"/>`, text: `<path d="M5 6h14 M5 10.5h14 M5 15h9"/>`,
  ruler: `<path d="M3.5 16.5L16.5 3.5l4 4-13 13z M7 13l2 2 M10 10l2 2 M13 7l2 2"/>`, heart: `<path d="M12 20s-7-4.4-8.6-8.6C2.2 8.2 4.3 5.2 7.4 5.2c1.9 0 3.3 1 4.6 2.7 1.3-1.7 2.7-2.7 4.6-2.7 3.1 0 5.2 3 4 6.2C19 15.6 12 20 12 20z"/>`,
};
const fchipHtml = (c, i) => `<div class="sp fchip${c.gold ? " gold" : ""}" id="fc${i}"><span class="ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${c.gold ? "#E2C67C" : "#C9BBFF"}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${FICON[c.ic]}</svg></span><div><small>${c.k}</small><b id="fcv${i}">${c.v}</b></div></div>`;
const pageHtml = (p) => {
  const h = (p.size[1] * 600) / 1179, src = `file://${ECR}/page-${p.id}.png`;
  const covers = p.id === "studio" ? FLY.map((f, i) => `<div class="cover" id="cv${i}" style="left:${(f.slot[0] * S - 3).toFixed(1)}px;width:${((f.slot[2] - f.slot[0]) * S + 6).toFixed(1)}px;height:${((f.slot[3] - f.slot[1]) * S + 6).toFixed(1)}px"></div>`).join("") : "";
  return `<div class="pg" id="pg-${p.id}"><img class="pc" src="${src}" style="height:${h.toFixed(1)}px"/>${covers}<div class="ph" style="height:${(330 * S).toFixed(1)}px"><img src="${src}"/></div></div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<canvas id="bg" width="1080" height="1920"></canvas>
<div id="hookScene">
  <div id="hookCard"><img src="${ph(HOOK.photo)}"/><div id="hookRing"><span class="disc"></span><svg width="132" height="132" style="position:absolute;inset:0;overflow:visible"><circle id="hookArc" cx="66" cy="66" r="56" fill="none" stroke="#E2C67C" stroke-width="9" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="${(2 * Math.PI * 56).toFixed(2)}"/></svg><b>99</b></div><div id="hookBadge">Exceptionnelle</div>
    <div class="ft"><div class="tt">${HOOK.title}</div><div class="st">${HOOK.brand}</div><div class="sp2"><i></i>${HOOK.spotted}</div></div></div>
  <div id="num"><small id="numk"></small><b id="numv"></b></div>
</div>
<canvas id="fx" width="1080" height="1920"></canvas>
<div id="brand"><svg class="layer" viewBox="0 0 1080 1920" width="1080" height="1920"><g id="ringg"></g></svg><div id="logoBox"><img src="file://${LOGO}"/><div id="logoShine"></div></div></div>
<div id="ctaScene"><div id="carousel">${CAROUSEL.map((id, i) => `<div class="cc" id="cc${i}"><img src="file://${ECR}/thumb-${id}.jpg"/></div>`).join("")}</div></div>
<div id="phoneLayer"><div id="phone"><div id="screen">${PAGES.map(pageHtml).join("")}<div id="sheen"></div></div><span class="di"></span><div id="pops"></div>${FLY.map((f, i) => `<img class="fly" id="fl${i}" src="${ph(f.n)}"/>`).join("")}<div class="ripple" id="ripple"></div><div class="tap" id="tap"></div></div></div>
<div class="sp notif" id="alert"><img src="file://${APPICON}"/><div style="flex:1;min-width:0"><div class="hd"><b>SELIO</b><span>maintenant</span></div><div class="ti">${ALERT.title}</div><div class="bo">${ALERT.body}</div></div></div>
<div class="ripple" id="ripple3"></div><div class="tap" id="tap3"></div>
<div class="layer" id="fchips">${FCHIPS.map(fchipHtml).join("")}</div>
<div class="layer" id="cta">
  <div class="sp btn" id="btn"><span class="shine" id="shine"></span>Rejoins la bêta gratuite</div>
  <div class="sp" id="bio" style="font:600 40px Inter;color:#F3E2B3;display:flex;align-items:center;gap:14px">Lien en bio <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F3E2B3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/></svg></div>
  <div class="sp small" id="legal" style="width:900px">Outil indépendant, non affilié à Vinted ni aux marques citées.<br>Chiffres de démonstration.</div>
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
console.log("scene.html + timeline.json écrits");
