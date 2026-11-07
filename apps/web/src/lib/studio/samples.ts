import type { DemoPhotoContent } from "../data/types";
import { browserImageDeps, type ImageReduceDeps, type ReducedPhoto } from "./reduce";
import { STUDIO_MODEL_JPEG_QUALITY } from "@selio/contracts";
import { base64ByteLength, checkModelImage, newId } from "@selio/domain";

/**
 * Photos d'exemple de la démonstration (Studio façon Kavis) : dessinées dans le navigateur, avec ce qui
 * est « visible » dessus décrit au simulateur (rôle, article, texte de l'étiquette, mesures lisibles sur
 * le mètre ruban). Le simulateur ne voit pas les images : sans ces descriptions, il ne lit rien.
 * Toutes les marques, références et mesures sont des exemples fictifs.
 *
 * Couleurs : contenu des photos dessinées (tissu, étiquette, ruban), pas des couleurs d'interface.
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface SampleSpec {
  name: string;
  content: DemoPhotoContent;
  draw: Draw;
}

const W = 768;
const H = 1024;
const INK = "#2b2a30";
const BACKDROP = "#ecebe7";

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, w, h);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = INK, weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}

const DENIM = "#3d5a80";
const DENIM_DARK = "#2c4463";
const KNIT = "#6f8f72";

function jeans(ctx: CanvasRenderingContext2D, w: number, h: number, back = false) {
  const cx = w / 2;
  ctx.fillStyle = DENIM;
  ctx.beginPath();
  ctx.moveTo(cx - 190, 170);
  ctx.lineTo(cx + 190, 170);
  ctx.lineTo(cx + 230, h - 110);
  ctx.lineTo(cx + 40, h - 110);
  ctx.lineTo(cx, 430);
  ctx.lineTo(cx - 40, h - 110);
  ctx.lineTo(cx - 230, h - 110);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = DENIM_DARK;
  ctx.fillRect(cx - 190, 170, 380, 46);
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  if (back) {
    ctx.strokeRect(cx - 160, 260, 120, 130);
    ctx.strokeRect(cx + 40, 260, 120, 130);
  } else {
    ctx.moveTo(cx, 216);
    ctx.lineTo(cx, 420);
    ctx.moveTo(cx - 180, 230);
    ctx.quadraticCurveTo(cx - 110, 300, cx - 70, 240);
    ctx.moveTo(cx + 180, 230);
    ctx.quadraticCurveTo(cx + 110, 300, cx + 70, 240);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function sweater(ctx: CanvasRenderingContext2D, w: number) {
  const cx = w / 2;
  ctx.fillStyle = KNIT;
  ctx.beginPath();
  ctx.moveTo(cx - 120, 200);
  ctx.lineTo(cx - 300, 330);
  ctx.lineTo(cx - 250, 640);
  ctx.lineTo(cx - 190, 620);
  ctx.lineTo(cx - 190, 880);
  ctx.lineTo(cx + 190, 880);
  ctx.lineTo(cx + 190, 620);
  ctx.lineTo(cx + 250, 640);
  ctx.lineTo(cx + 300, 330);
  ctx.lineTo(cx + 120, 200);
  ctx.quadraticCurveTo(cx, 280, cx - 120, 200);
  ctx.fill();
  ctx.strokeStyle = "#5b7a5e";
  ctx.lineWidth = 4;
  for (let x = cx - 160; x <= cx + 160; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 300);
    ctx.lineTo(x, 870);
    ctx.stroke();
  }
}

function careLabel(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[], blur = false) {
  ctx.save();
  if (blur) ctx.filter = "blur(2px)";
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(x, y, 340, 70 + lines.length * 58);
  ctx.strokeStyle = "#d8d4ca";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, 340, 70 + lines.length * 58);
  lines.forEach((l, i) => text(ctx, l, x + 170, y + 60 + i * 58, i === 0 ? 44 : 34, INK, i === 0 ? 600 : 500));
  ctx.restore();
}

function tape(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, fromCm: number) {
  ctx.fillStyle = "#f2c94c";
  ctx.fillRect(x, y, length, 64);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2;
  const pxPerCm = length / 45;
  for (let cm = 0; cm <= 45; cm++) {
    const px = x + cm * pxPerCm;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + (cm % 5 === 0 ? 30 : 16));
    ctx.stroke();
    if (cm % 5 === 0) {
      ctx.font = "500 18px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(fromCm + cm), px, y + 48);
    }
  }
}

/** Jeu d'exemple : un jean (face, dos, étiquette, mètre ruban posé à la taille) et un pull (face, étiquette peu lisible). */
export const DEMO_SAMPLE_SET: readonly SampleSpec[] = [
  { name: "jean-face.jpg", content: { name: "jean-face.jpg", role: "front", group: 1 }, draw: (ctx, w, h) => { backdrop(ctx, w, h); jeans(ctx, w, h); } },
  { name: "jean-dos.jpg", content: { name: "jean-dos.jpg", role: "back", group: 1 }, draw: (ctx, w, h) => { backdrop(ctx, w, h); jeans(ctx, w, h, true); } },
  {
    name: "jean-etiquette.jpg",
    content: { name: "jean-etiquette.jpg", role: "label", group: 1, label: { brand: "Levi's", size: "W32 L32", material: "100 % coton", reference: "501", confidence: 0.92 } },
    draw: (ctx, w, h) => {
      backdrop(ctx, w, h);
      ctx.fillStyle = DENIM;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#a9825a";
      ctx.fillRect(w / 2 - 230, 150, 460, 300);
      text(ctx, "LEVI'S", w / 2, 240, 76, "#3b2a1a");
      text(ctx, "501", w / 2, 320, 54, "#3b2a1a");
      text(ctx, "W32 L32", w / 2, 395, 44, "#3b2a1a", 500);
      careLabel(ctx, w / 2 - 170, 560, ["100 % COTON", "Lavage 30 °C", "Fabriqué au Mexique"]);
    },
  },
  {
    name: "jean-metre-ruban.jpg",
    content: { name: "jean-metre-ruban.jpg", role: "tape", group: 1, tape: { waist: 41, confidence: 0.88 } },
    draw: (ctx, w, h) => {
      backdrop(ctx, w, h);
      jeans(ctx, w, h);
      tape(ctx, w / 2 - 190, 150, 380 * (45 / 41), 0);
    },
  },
  { name: "pull-face.jpg", content: { name: "pull-face.jpg", role: "front", group: 2 }, draw: (ctx, w, h) => { backdrop(ctx, w, h); sweater(ctx, w); } },
  {
    name: "pull-etiquette.jpg",
    content: { name: "pull-etiquette.jpg", role: "label", group: 2, label: { brand: "Sézane", size: "M", material: "70 % laine, 30 % alpaga", confidence: 0.62 } },
    draw: (ctx, w, h) => {
      backdrop(ctx, w, h);
      ctx.fillStyle = KNIT;
      ctx.fillRect(0, 0, w, h);
      careLabel(ctx, w / 2 - 170, 300, ["SÉZANE", "M", "70 % laine", "30 % alpaga"], true);
    },
  },
];

export type SamplePhoto = ReducedPhoto & { content: DemoPhotoContent };

/** Dessine les photos d'exemple (768 × 1 024 px, JPEG 0,8), vérifiées comme une photo réduite du vendeur. */
export async function renderSamplePhotos(deps: Pick<ImageReduceDeps, "createCanvas"> = browserImageDeps, specs: readonly SampleSpec[] = DEMO_SAMPLE_SET): Promise<SamplePhoto[]> {
  return specs.map((spec) => {
    const canvas = deps.createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Dessin des photos d'exemple indisponible dans ce navigateur.");
    spec.draw(ctx as CanvasRenderingContext2D, W, H);
    const url = canvas.toDataURL("image/jpeg", STUDIO_MODEL_JPEG_QUALITY);
    const check = checkModelImage(url);
    if (!check.ok) throw new Error(`Photo d'exemple ${spec.name} : ${check.reason}`);
    return { id: newId(), url, alt: spec.name, width: check.width, height: check.height, bytes: base64ByteLength(url.slice(url.indexOf(",") + 1)), originalWidth: W, originalHeight: H, quality: STUDIO_MODEL_JPEG_QUALITY, content: spec.content };
  });
}
