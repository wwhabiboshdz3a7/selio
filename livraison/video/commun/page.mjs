// Assemble la page scene.html (rendue image par image) et timeline.json (sous-titres et bruitages pour l'audio et le SRT).
// Commun à toutes les vidéos : chaque build.mjs fournit sa timeline, son CSS, son HTML et son scene.js.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

export const COMMUN = new URL(".", import.meta.url).pathname;
export const ROOT = process.env.SELIO_ROOT || new URL("../../../", import.meta.url).pathname; // racine du dépôt
export const FONT = dirname(createRequire(`${ROOT}apps/web/package.json`).resolve("@fontsource/inter/package.json")) + "/files";
export const PHOTOS = `${ROOT}apps/web/public/demo/photos`;
export const LOGO = `${ROOT}brand/selio-logo-blanc.png`;
export const ph = (n) => `file://${PHOTOS}/${n}.webp`;
const dataUri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;

const BASE_CSS = `
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
.caret { display: inline-block; width: 3px; height: 1em; margin-left: 2px; vertical-align: -3px; background: currentColor; }
/* Cartes façon application Selio (mode sombre) */
.card { border-radius: 36px; background: rgba(28,25,36,.94); border: 2px solid rgba(255,255,255,.10); box-shadow: 0 50px 120px rgba(0,0,0,.55), 0 0 0 1px rgba(124,92,235,.12); color: #F3F1F8; }
.kicker { font: 700 22px Inter; letter-spacing: .14em; text-transform: uppercase; color: #B9A6FF; }
.chip { display: inline-flex; align-items: center; gap: 14px; padding: 16px 26px 16px 18px; border-radius: 26px; background: rgba(32,28,44,.92); border: 2px solid rgba(185,166,255,.35); box-shadow: 0 24px 60px rgba(0,0,0,.45); white-space: nowrap; }
.chip .ic { width: 52px; height: 52px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: rgba(124,92,235,.3); flex: none; }
.chip small { display: block; font: 500 21px Inter; color: rgba(255,255,255,.6); } .chip b { display: block; font: 700 31px Inter; color: #fff; }
.chip.gold { border-color: rgba(226,198,124,.7); } .chip.gold .ic { background: rgba(226,198,124,.22); } .chip.gold b { color: #F3E2B3; }
.chip.green { border-color: rgba(74,222,128,.55); } .chip.green .ic { background: rgba(74,222,128,.18); } .chip.green b { color: #BBF7D0; }
.badge { display: inline-flex; align-items: center; gap: 10px; padding: 10px 20px; border-radius: 99px; font: 700 22px Inter; letter-spacing: .06em; text-transform: uppercase; background: rgba(226,198,124,.16); border: 2px solid rgba(226,198,124,.7); color: #F3E2B3; white-space: nowrap; }
.tap { position: absolute; left: 0; top: 0; width: 84px; height: 84px; border-radius: 50%; background: rgba(255,255,255,.35); border: 3px solid rgba(255,255,255,.75); }
/* Sous-titres */
.cap { position: absolute; text-align: center; font-weight: 700; letter-spacing: -0.03em; line-height: 1.08; text-shadow: 0 6px 34px rgba(0,0,0,.6); }
.cap .w { display: inline-block; background-repeat: no-repeat; background-position: 0 86%; background-image: linear-gradient(rgba(226,198,124,.3), rgba(226,198,124,.3)); background-size: 0% 30%; }
#capband { position: absolute; left: 0; right: 0; top: 0; height: 720px; background: linear-gradient(180deg, rgba(14,12,19,.9) 0, rgba(14,12,19,.78) 480px, rgba(14,12,19,0) 720px); }
/* Logo + filiale */
.brand { position: absolute; left: 0; top: 0; width: 720px; height: 340px; transform-origin: 360px 170px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; }
.brand .lb { position: relative; width: 600px; height: 186px; }
.brand .lb img, .brand .shine { position: absolute; inset: 0; width: 600px; height: 186px; }
.brand .shine { -webkit-mask: url("${dataUri(LOGO)}") 0 0 / 100% 100% no-repeat; background: linear-gradient(105deg, transparent 0 38%, rgba(255,246,220,.95) 50%, transparent 62% 100%) no-repeat; background-size: 300% 100%; }
.brand .sub { padding: 14px 40px; border-radius: 99px; font: 800 52px Inter; letter-spacing: .2em; text-transform: uppercase; color: #F3E2B3; background: rgba(226,198,124,.12); border: 3px solid rgba(226,198,124,.75); box-shadow: 0 0 60px rgba(226,198,124,.25); }
/* Final */
.btn { padding: 36px 66px; border-radius: 99px; background: linear-gradient(90deg, #5232B5, #7C5CEB); font: 700 48px Inter; white-space: nowrap; box-shadow: 0 20px 60px rgba(100,66,214,.6), inset 0 0 0 2px rgba(255,255,255,.18); overflow: hidden; }
.btn #shine { position: absolute; top: 0; bottom: 0; width: 140px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent); transform: skewX(-20deg); }
.small { font: 500 25px/1.4 Inter; color: rgba(255,255,255,.55); text-align: center; }
#flash { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 540px 960px, #fff, rgba(214,200,255,.75) 30%, rgba(124,92,235,0) 70%); opacity: 0; }
#vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse 75% 60% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%); }
#grain { mix-blend-mode: overlay; opacity: .08; }
`;

/** Écrit scene.html et timeline.json dans `here`. */
export function buildPage({ here, TL, css, body, sceneJs }) {
  const brands = (TL.BRANDS || []).map((b, i) => `<div class="brand" id="brand${i}"><div class="lb"><img src="file://${LOGO}"/><div class="shine"></div></div>${b.sub ? `<div class="sub">${b.sub}</div>` : ""}</div>`).join("");
  const cta = TL.CTA
    ? `<div class="layer" id="cta" style="display:none">
  <div class="sp btn" id="btn"><span id="shine"></span>${TL.CTA.btn}</div>
  <div class="sp" id="bio" style="font:600 40px Inter;color:#F3E2B3;display:flex;align-items:center;gap:14px">${TL.CTA.bio} <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#F3E2B3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/></svg></div>
  <div class="sp small" id="legal" style="width:940px">${TL.CTA.legal}</div>
</div>`
    : "";
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>
<canvas id="bg" width="1080" height="1920"></canvas>
${body}
<canvas id="fx" width="1080" height="1920"></canvas>
<div class="layer" id="brands">${brands}</div>
${cta}
<div id="capband"></div>
<div class="layer" id="caps"></div>
<div id="flash"></div>
<div id="vignette"></div>
<canvas id="grain" width="1080" height="1920"></canvas>
<script>
const TL = ${JSON.stringify(TL)};
${readFileSync(`${COMMUN}moteur.js`, "utf8")}
${sceneJs}
</script></body></html>`;
  writeFileSync(`${here}scene.html`, page);
  writeFileSync(`${here}timeline.json`, JSON.stringify(TL, null, 1));
  console.log("scene.html + timeline.json écrits");
}
