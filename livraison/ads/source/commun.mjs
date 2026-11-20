// Outils communs : chemins, styles de la marque, composants HTML, rendu Chromium (Playwright).
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../../..");
export const OUT = resolve(HERE, "..");

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try { return require(p); } catch { /* suivant */ }
  }
  throw new Error("Playwright introuvable : npm i -g playwright, ou indiquer son chemin.");
}

export const file = (rel) => pathToFileURL(join(REPO, rel)).href;

export const ASSET = {
  logoBlanc: file("brand/selio-logo-blanc.png"),
  logoNoir: file("brand/selio-logo-noir.png"),
  iconeBlanc: file("brand/selio-icone-blanc.png"),
  iconeNoir: file("brand/selio-icone-noir.png"),
  appIcon: file("brand/selio-app-icon-noir.png"),
  ecran: (n) => file(`livraison/video/source/ecrans/${n}-full.png`),
  produit: (n) => file(`apps/web/src/marketing/assets/${n}.webp`),
  photo: (n) => file(`apps/web/public/demo/photos/${n}.webp`),
};

/** Couleurs de la charte (brand/GUIDELINES-DEV.md) et du fond des vidéos. */
export const C = { v700: "#5232B5", v600: "#6442D6", v500: "#7C5CEB", v300: "#B5A3FF", gold: "#E2C67C", gold5: "#C1933B", text: "#EEEBF3", muted: "#B4AFC0", surface: "#23202A", border: "#37333F", success: "#4CC38A" };

export const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#121017}
body{font-family:Inter,"Inter Display",system-ui,sans-serif;color:${C.text};-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
.ad{position:relative;overflow:hidden;background:
  radial-gradient(ellipse 70% 55% at 85% 8%,rgba(124,92,235,.38),transparent 70%),
  radial-gradient(ellipse 60% 45% at 5% 100%,rgba(193,147,59,.13),transparent 70%),
  linear-gradient(160deg,#121017 0%,#1B1625 45%,#2A2042 100%)}
.ad::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.035) 1px,transparent 1px);background-size:22px 22px}
em{font-style:normal;color:${C.gold}}
.logo{display:block;height:auto}
.kicker{display:inline-flex;align-items:center;gap:.5em;padding:.38em .9em;border-radius:99px;border:1px solid rgba(181,163,255,.45);background:rgba(124,92,235,.16);color:#D8CEFF;font-weight:600;letter-spacing:.01em;white-space:nowrap}
.kicker i{width:.5em;height:.5em;border-radius:50%;background:${C.v300};display:inline-block}
h1{font-weight:700;letter-spacing:-.025em;line-height:1.04}
.sub{color:#CFCAD9;font-weight:400;line-height:1.35}
.cta{display:inline-flex;align-items:center;gap:.5em;border-radius:99px;background:linear-gradient(90deg,${C.v700},${C.v500});color:#fff;font-weight:700;white-space:nowrap;box-shadow:0 10px 34px rgba(100,66,214,.5),inset 0 0 0 1.5px rgba(255,255,255,.18)}
.cta b{font-weight:700;opacity:.9}
.note{color:#9F99AD;font-weight:400;line-height:1.3}
.fit{position:relative;flex:1 1 auto;min-height:0;min-width:0;z-index:1}
.fit>.scene{position:absolute;transform-origin:0 0}
.scene{position:relative}
.card{background:${C.surface};border:1px solid ${C.border};border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.crop{position:relative;overflow:hidden;border-radius:16px;border:1px solid ${C.border};box-shadow:0 24px 60px rgba(0,0,0,.5);background:#1A1820}
.crop img{position:absolute;max-width:none;display:block}
.ex{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:99px;border:1px solid rgba(226,198,124,.55);background:rgba(25,20,30,.85);color:${C.gold};font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.ex::before{content:"";width:7px;height:7px;border-radius:50%;background:${C.gold}}
.chip{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:99px;background:rgba(35,32,42,.92);border:1px solid ${C.border};color:${C.text};font-size:18px;font-weight:500;white-space:nowrap;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.chip svg{flex:none}
.muted{color:${C.muted}}
`;

/** Recadrage d'une capture : (x, y, w, h) en pixels de l'image source, affiché sur `width` pixels. */
export function crop(src, srcW, { x, y, w, h }, width, extra = "") {
  const k = width / w;
  return `<div class="crop" style="width:${width}px;height:${Math.round(h * k)}px;${extra}"><img src="${src}" style="width:${srcW * k}px;left:${-x * k}px;top:${-y * k}px"></div>`;
}

/** Anneau de note sur 100 (or pour une note excellente, comme dans l'application). */
export function ring(score, size = 120, { color = C.gold, label = "sur 100", stroke } = {}) {
  const sw = stroke ?? Math.max(4, size * 0.085);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return `<div style="position:relative;width:${size}px;height:${size}px;flex:none">
    <svg width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="${sw}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}"/></svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1">
      <b style="font-size:${size * 0.36}px;font-weight:700;letter-spacing:-.02em">${score}</b>${label ? `<small style="font-size:${Math.max(10, size * 0.11)}px;color:${C.muted};margin-top:${size * 0.03}px">${label}</small>` : ""}</div></div>`;
}

export const ICON = {
  check: (s = 18, c = C.success) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  spark: (s = 22, c = C.gold) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`,
  bell: (s = 20, c = C.v300) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/></svg>`,
  shield: (s = 20, c = C.v300) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>`,
  hand: (s = 20, c = C.v300) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5a1.5 1.5 0 013 0v5m0-1V4a1.5 1.5 0 013 0v6m0-1.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-5-2.7L4 15a1.6 1.6 0 012.6-1.8L9 15"/></svg>`,
  camera: (s = 20, c = C.v300) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  arrow: (s = 22, c = "#fff") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
};

/** Script injecté : met chaque `.scene` à l'échelle de son conteneur `.fit` (centrée). */
const FIT_SCRIPT = `
for (const box of document.querySelectorAll('.fit')) {
  const s = box.querySelector(':scope>.scene'); if (!s) continue;
  const r0 = s.getBoundingClientRect(); let sw = s.offsetWidth, sh = 0;
  for (const ch of s.children) { const r = ch.getBoundingClientRect(); sw = Math.max(sw, r.right - r0.left); sh = Math.max(sh, r.bottom - r0.top); }
  sh = Math.max(sh, 1); const max = +(box.dataset.max || 1.5);
  const k = box.dataset.mode === 'width' ? Math.min(box.clientWidth / sw, max) : Math.min(box.clientWidth / sw, box.clientHeight / sh, max);
  s.style.transform = 'scale(' + k + ')';
  const ax = box.dataset.ax ?? .5, ay = box.dataset.ay ?? .5;
  s.style.left = ((box.clientWidth - sw * k) * ax) + 'px';
  s.style.top = ((box.clientHeight - sh * k) * ay) + 'px';
}`;

export function page(w, h, body, css = "") {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body style="width:${w}px;height:${h}px">${body}</body></html>`;
}

const TMP = mkdtempSync(join(tmpdir(), "selio-ads-"));
let n = 0;

export async function browser() {
  const { chromium } = loadPlaywright();
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

/**
 * Rend une page HTML en image. `type` : png | jpeg. `maxBytes` : baisse la qualité JPEG jusqu'à tenir
 * sous la limite (150 Ko pour les bannières Google).
 */
export async function render(b, { html, w, h, out, type = "jpeg", quality = 92, maxBytes, transparent = false }) {
  const path = join(TMP, `p${++n}.html`);
  writeFileSync(path, html);
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(pathToFileURL(path).href, { waitUntil: "load" });
  await p.evaluate(async () => { await document.fonts.ready; });
  await p.evaluate(FIT_SCRIPT);
  let q = quality;
  for (;;) {
    await p.screenshot({ path: out, type, ...(type === "jpeg" ? { quality: q } : { omitBackground: transparent }), clip: { x: 0, y: 0, width: w, height: h } });
    const size = statSync(out).size;
    if (!maxBytes || size <= maxBytes || type !== "jpeg" || q <= 50) break;
    q -= 5;
  }
  await p.close();
  return { out, quality: type === "jpeg" ? q : null, bytes: statSync(out).size };
}
