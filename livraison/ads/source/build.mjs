// Génère tous les visuels publicitaires : node build.mjs [filtre]
// Le filtre (facultatif) garde les fichiers dont le nom contient ce texte, par ex. « studio » ou « 300x250 ».
// Sorties : ../visuels/{meta,google-display,google-bannieres,logos}/
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, ASSET, C, ICON, page, browser, render } from "./commun.mjs";
import { CONCEPTS } from "./concepts.mjs";

const CTA = "Essai gratuit 14 jours";
const NOTE = "Pour vendre sur Vinted. Selio est indépendant de Vinted.";
const arrow = (s) => ICON.arrow(s);

/* ---------------- Meta / Instagram ---------------- */

function metaVertical(c, w, h, f) {
  // f : réglages du format (marges, tailles de texte, zone sûre des stories)
  return `<div class="ad" style="width:${w}px;height:${h}px;padding:${f.top}px ${f.side}px ${f.bottom}px;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:2">
      <img class="logo" src="${ASSET.logoBlanc}" style="height:${f.logo}px"><span class="kicker" style="font-size:${f.kicker}px"><i></i>${c.produit}</span></div>
    <h1 style="font-size:${f.h1}px;margin-top:${f.gap}px;position:relative;z-index:2">${c.title}</h1>
    ${f.sub ? `<p class="sub" style="font-size:${f.sub}px;margin-top:${f.gap * 0.45}px;position:relative;z-index:2">${f.subText === "short" ? c.subShort : c.sub}</p>` : ""}
    <div class="fit" data-mode="width" data-max="${f.max}" data-ay="0" style="margin:${f.gap}px ${-f.side + f.bleed}px 0;-webkit-mask:linear-gradient(#000 ${f.fade}%,transparent 100%)">${c.scene("tall")}</div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:${f.bottom + f.ctaZone}px;background:linear-gradient(rgba(18,16,23,0),rgba(18,16,23,.97) 42%);z-index:3"></div>
    <div style="position:absolute;left:${f.side}px;right:${f.side}px;bottom:${f.bottom}px;display:flex;${f.center ? "flex-direction:column;align-items:center;gap:18px" : "justify-content:space-between;align-items:flex-end"};z-index:4">
      <span class="cta" style="font-size:${f.cta}px;padding:${f.cta * 0.72}px ${f.cta * 1.2}px">${CTA}${arrow(f.cta)}</span>
      <span class="note" style="font-size:${f.note}px;${f.center ? "text-align:center" : "text-align:right;max-width:330px"}">${NOTE}</span></div></div>`;
}

const META = [
  { name: "carre", w: 1080, h: 1080, f: { top: 60, side: 64, bottom: 52, logo: 44, kicker: 22, h1: 70, gap: 30, sub: 0, max: 1.1, bleed: 40, fade: 72, cta: 30, note: 18, ctaZone: 150 } },
  { name: "portrait", w: 1080, h: 1350, f: { top: 64, side: 64, bottom: 56, logo: 46, kicker: 23, h1: 78, gap: 34, sub: 30, subText: "short", max: 1.15, bleed: 40, fade: 74, cta: 32, note: 19, ctaZone: 170 } },
  // Story / Reel : on laisse libres ~250 px en haut et ~340 px en bas (interface d'Instagram et de Facebook).
  { name: "story", w: 1080, h: 1920, f: { top: 250, side: 72, bottom: 330, logo: 50, kicker: 25, h1: 92, gap: 40, sub: 34, max: 1.2, bleed: 50, fade: 70, cta: 36, note: 21, center: true, ctaZone: 280 } },
];

function metaLink(c, w, h) {
  return `<div class="ad" style="width:${w}px;height:${h}px;display:flex">
    <div style="width:560px;flex:none;padding:46px 0 40px 52px;display:flex;flex-direction:column;position:relative;z-index:2">
      <img class="logo" src="${ASSET.logoBlanc}" style="height:38px;align-self:flex-start">
      <span class="kicker" style="font-size:18px;margin-top:34px;align-self:flex-start"><i></i>${c.produit}</span>
      <h1 style="font-size:54px;margin-top:18px">${c.title}</h1>
      <p class="sub" style="font-size:22px;margin-top:16px">${c.subShort}</p>
      <div style="margin-top:auto"><span class="cta" style="font-size:24px;padding:17px 28px">${CTA}${arrow(24)}</span>
      <p class="note" style="font-size:14px;margin-top:14px">${NOTE}</p></div></div>
    <div class="fit" data-max="1.05" style="margin:34px 34px 34px 10px">${c.scene("focus")}</div></div>`;
}

/* ---------------- Google Display (annonces responsives : images sans texte ajouté) ---------------- */

const rda = (c, w, h, kind) => `<div class="ad" style="width:${w}px;height:${h}px;display:flex;padding:${kind === "tall" ? 70 : 40}px"><div class="fit" data-max="1.25">${c.scene(kind)}</div></div>`;

/* ---------------- Bannières Google (images importées, 150 Ko maximum) ---------------- */

function bannerRect(c, w, h) {
  const k = w / 300;
  return `<div class="ad" style="width:${w}px;height:${h}px;padding:${16 * k}px;display:flex;flex-direction:column">
    <img class="logo" src="${ASSET.logoBlanc}" style="height:${20 * k}px;align-self:flex-start;position:relative;z-index:2">
    <h1 style="font-size:${23 * k}px;margin-top:${12 * k}px;line-height:1.08;position:relative;z-index:2">${c.titleBanner}</h1>
    <div style="display:flex;align-items:flex-end;gap:${8 * k}px;margin-top:auto;position:relative;z-index:2">
      <span class="cta" style="font-size:${13 * k}px;padding:${9 * k}px ${13 * k}px">${CTA}</span>
      <div class="fit" data-max="1" data-ax="1" data-ay="1" style="height:${(h - 110 * k) | 0}px;max-height:${100 * k}px">${c.mini("rect")}</div></div></div>`;
}

const bannerLeader = (c, w, h) => `<div class="ad" style="width:${w}px;height:${h}px;display:flex;align-items:center;gap:22px;padding:0 22px">
  <img class="logo" src="${ASSET.logoBlanc}" style="height:30px;position:relative;z-index:2">
  <span style="width:1px;height:46px;background:rgba(255,255,255,.18)"></span>
  <h1 style="font-size:24px;flex:1;line-height:1.1;position:relative;z-index:2">${c.titleBanner}</h1>
  <span class="cta" style="font-size:16px;padding:12px 18px;position:relative;z-index:2">${CTA}${arrow(16)}</span></div>`;

const bannerSky = (c, w, h) => `<div class="ad" style="width:${w}px;height:${h}px;padding:18px 14px 14px;display:flex;flex-direction:column;align-items:flex-start">
  <img class="logo" src="${ASSET.logoBlanc}" style="height:24px;position:relative;z-index:2">
  <h1 style="font-size:23px;margin-top:18px;line-height:1.1;position:relative;z-index:2">${c.titleBanner}</h1>
  <div class="fit" data-max="1" style="width:100%;margin:16px 0">${c.mini("sky")}</div>
  <span class="cta" style="font-size:15px;line-height:1.15;padding:9px 10px;align-self:stretch;justify-content:center;text-align:center;white-space:normal;position:relative;z-index:2">Essai gratuit<br>14 jours</span>
  <p class="note" style="font-size:9.5px;margin-top:8px;position:relative;z-index:2">Selio est indépendant de Vinted.</p></div>`;

const bannerMobile = (c, w, h) => `<div class="ad" style="width:${w}px;height:${h}px;display:flex;align-items:center;gap:8px;padding:0 8px">
  <img src="${ASSET.iconeBlanc}" style="height:30px;position:relative;z-index:2">
  <h1 style="font-size:13.5px;flex:1;line-height:1.12;letter-spacing:-.01em;position:relative;z-index:2">${c.titleTiny}</h1>
  <span class="cta" style="font-size:11px;padding:7px 10px;position:relative;z-index:2;box-shadow:none">Essai gratuit</span></div>`;

const BANNERS = [
  { w: 300, h: 250, fn: bannerRect },
  { w: 336, h: 280, fn: bannerRect },
  { w: 728, h: 90, fn: bannerLeader },
  { w: 160, h: 600, fn: bannerSky },
  { w: 320, h: 50, fn: bannerMobile },
];

/* ---------------- Logos ---------------- */

const LOGOS = [
  { out: "selio-logo-carre-fond-blanc-1200x1200.png", w: 1200, h: 1200, html: `<div style="width:1200px;height:1200px;background:#fff;display:flex;align-items:center;justify-content:center"><img src="${ASSET.iconeNoir}" style="width:720px"></div>` },
  { out: "selio-logo-carre-fond-sombre-1200x1200.png", w: 1200, h: 1200, html: `<div class="ad" style="width:1200px;height:1200px;display:flex;align-items:center;justify-content:center"><img src="${ASSET.iconeBlanc}" style="width:720px;position:relative;z-index:2"></div>` },
  { out: "selio-logo-paysage-fond-blanc-1200x300.png", w: 1200, h: 300, html: `<div style="width:1200px;height:300px;background:#fff;display:flex;align-items:center;justify-content:center"><img src="${ASSET.logoNoir}" style="height:190px"></div>` },
  { out: "selio-logo-paysage-fond-sombre-1200x300.png", w: 1200, h: 300, html: `<div class="ad" style="width:1200px;height:300px;display:flex;align-items:center;justify-content:center"><img src="${ASSET.logoBlanc}" style="height:190px;position:relative;z-index:2"></div>` },
];

/* ---------------- Rendu ---------------- */

const filter = process.argv[2] ?? "";
const jobs = [];
const dir = (d) => { const p = join(OUT, "visuels", d); mkdirSync(p, { recursive: true }); return p; };

for (const c of CONCEPTS) {
  const base = `selio-${c.key}-${c.slug}`;
  for (const m of META) jobs.push({ out: join(dir("meta"), `${base}-meta-${m.name}-${m.w}x${m.h}.jpg`), w: m.w, h: m.h, html: page(m.w, m.h, metaVertical(c, m.w, m.h, m.f)), quality: 90 });
  jobs.push({ out: join(dir("meta"), `${base}-meta-lien-1200x628.jpg`), w: 1200, h: 628, html: page(1200, 628, metaLink(c, 1200, 628)), quality: 90 });
  jobs.push({ out: join(dir("google-display"), `${base}-display-paysage-1200x628.jpg`), w: 1200, h: 628, html: page(1200, 628, rda(c, 1200, 628, "wide")), quality: 90 });
  jobs.push({ out: join(dir("google-display"), `${base}-display-carre-1200x1200.jpg`), w: 1200, h: 1200, html: page(1200, 1200, rda(c, 1200, 1200, "tall")), quality: 90 });
  jobs.push({ out: join(dir("google-display"), `${base}-display-portrait-960x1200.jpg`), w: 960, h: 1200, html: page(960, 1200, rda(c, 960, 1200, "tall")), quality: 90 });
  for (const b of BANNERS) jobs.push({ out: join(dir("google-bannieres"), `${base}-banniere-${b.w}x${b.h}.jpg`), w: b.w, h: b.h, html: page(b.w, b.h, b.fn(c, b.w, b.h)), quality: 92, maxBytes: 150_000 });
}
for (const l of LOGOS) jobs.push({ out: join(dir("logos"), l.out), w: l.w, h: l.h, html: page(l.w, l.h, l.html), type: "png" });

const todo = jobs.filter((j) => j.out.includes(filter));
const b = await browser();
const report = [];
for (const j of todo) {
  const r = await render(b, j);
  report.push(`${j.out.replace(OUT + "/", "")}  ${j.w}×${j.h}  ${(r.bytes / 1024).toFixed(0)} Ko${r.quality ? `  (JPEG ${r.quality})` : ""}`);
  if (process.env.HTML_DEBUG) writeFileSync(j.out.replace(/\.(jpg|png)$/, ".html"), j.html);
}
await b.close();
console.log(report.join("\n"));
console.log(`${todo.length} visuel(s) rendu(s).`);
