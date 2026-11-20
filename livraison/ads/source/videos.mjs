// Versions 16:9 (1920 × 1080) des vidéos verticales, pour YouTube et Performance Max :
// la vidéo 9:16 d'origine au centre, un fond de marque avec titre et appel à l'action de part et d'autre.
// node videos.mjs   (ffmpeg requis) → ../videos/
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { OUT, REPO, ASSET, ICON, page, browser, render } from "./commun.mjs";

const VIDEOS = [
  { src: "Selio-Studio-27s.mp4", produit: "Selio Studio", title: "Tes photos deviennent <em>une&nbsp;annonce.</em>", sub: "Titre, description et prix conseillé, rédigés à partir de tes photos. Tu relis, tu publies." },
  { src: "Selio-Bot-29s.mp4", produit: "Selio Manager", title: "Il négocie et relance <em>selon tes règles.</em>", sub: "Contre-offres et relances préparées par Selio, avec tes prix planchers. Tu gardes la main." },
  { src: "Selio-Track-24s.mp4", produit: "Selio Track", title: "Sache <em>quoi acheter.</em>", sub: "Niches notées sur 100, prix de revente, recherche par photo. Chiffres de la vidéo : exemple." },
];

const bg = (v) => `<div class="ad" style="width:1920px;height:1080px">
  <div style="position:absolute;left:90px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;z-index:2">
    <img src="${ASSET.logoBlanc}" style="height:56px;align-self:flex-start">
    <span class="kicker" style="font-size:24px;margin-top:56px;align-self:flex-start"><i></i>${v.produit}</span>
    <h1 style="font-size:76px;margin-top:26px">${v.title}</h1>
    <p class="sub" style="font-size:30px;margin-top:24px">${v.sub}</p></div>
  <div style="position:absolute;left:656px;top:0;width:608px;height:1080px;background:#000;box-shadow:0 0 120px rgba(124,92,235,.45);z-index:2"></div>
  <div style="position:absolute;right:90px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;z-index:2">
    <p style="font-size:34px;font-weight:600;line-height:1.3">Gestion, annonces, marché et achats :<br><span style="color:#B5A3FF">l'écosystème des revendeurs.</span></p>
    <span class="cta" style="font-size:34px;padding:26px 42px;margin-top:44px">Essai gratuit 14 jours${ICON.arrow(34)}</span>
    <p class="note" style="font-size:22px;margin-top:22px">seliovprod.netlify.app<br>Pour vendre sur Vinted. Selio est indépendant de Vinted.</p></div></div>`;

const dir = join(OUT, "videos");
mkdirSync(dir, { recursive: true });
const b = await browser();
for (const v of VIDEOS) {
  const png = join(dir, `.fond-${v.src.replace(".mp4", "")}.png`);
  await render(b, { html: page(1920, 1080, bg(v)), w: 1920, h: 1080, out: png, type: "png" });
  const out = join(dir, v.src.replace(".mp4", "-16x9.mp4"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-i", join(REPO, "livraison/video", v.src),
    "-filter_complex", "[1:v]scale=608:1080:flags=lanczos[v];[0:v][v]overlay=656:0:shortest=1,format=yuv420p[o]",
    "-map", "[o]", "-map", "1:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30", "-c:a", "copy", "-movflags", "+faststart", out]);
  execFileSync("rm", ["-f", png]);
  console.log(out.replace(OUT + "/", ""));
}
await b.close();
