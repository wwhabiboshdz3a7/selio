/**
 * Sphère céleste Selio : rendu Canvas 2D en vraie projection perspective,
 * orchestré par anime.js (intro, défilement, focus, inertie).
 *
 * Chargé en import dynamique par ConstellationHero : rien de ce fichier
 * (ni anime.js) n'entre dans le bundle initial.
 *
 * Performances : DPR plafonné à 2, aucune lecture de mise en page dans la
 * boucle (mesures uniquement au redimensionnement), composition additive sans
 * tri, boucle suspendue hors écran et onglet masqué.
 */
import { animate, createScope, createTimeline, onScroll, stagger, utils } from "animejs";
import type { JSAnimation, Scope, Timeline } from "animejs";
import { CONSTELLATION } from "./features";
import {
  STEPS,
  STEP_ANGLE,
  clamp01,
  distanceForRadius,
  dwell,
  easeInOutCubic,
  easeOutCubic,
  fibonacciPoint,
  focalLength,
  lerp,
  pairAngle,
  pairIndex,
  rotate,
  rotation,
  seeded,
  slotAngle,
  smoothstep,
  starAngle,
  wrapPi,
  type Mat3,
  type Vec3,
} from "./geometry";

export interface EngineOptions {
  mode: "live" | "still";
  onNavigate: (href: string) => void;
  onError?: (error: unknown) => void;
}

type Rgb = [number, number, number];

interface Star {
  bx: number; by: number; bz: number; // position finale (repère de la sphère)
  // Départ de l'intro, dans le repère de la caméra : écart latéral (multiplié
  // par la position finale) et profondeur. Les étoiles convergent vers la sphère.
  sx: number; sy: number; sz: number;
  size: number;
  tint: number;
  glow: number;
  tw: number;
  ph: number;
  k: number; // progression d'intro (animée par anime.js)
}

interface FeatureStar {
  x: number; y: number; z: number;
  ignite: number; // animé par anime.js
  gold: boolean;
  // Projection de la dernière image (pour le survol, les étiquettes, l'infobulle).
  px: number; py: number; vis: number; front: number; r: number;
}

interface CardSlot {
  el: HTMLElement;
  x: number; y: number; z: number;
  angle: number;
  last: { t: string; o: string; z: string; p: string };
}

const RS = 1; // rayon de la sphère d'étoiles
const RING = 1.2; // anneau d'or (écliptique)
const RC = 0.6; // anneau des cartes autour du lecteur
const CAM_IN = -0.34; // position de la caméra une fois entrée dans la sphère
const NEAR = 0.06;
const HERO_PITCH = -0.36;
const HERO_ROLL = 0.32;
const BELT_LAT = 0.3;
const TRAIL_ALPHA = [0.08, 0.18, 0.32, 0.5];
const TRAIL_WIDTH = [0.7, 1.2, 1.9];
/** Taille de référence du calque CSS du limbe (voir .cst-limb). */
const LIMB_PX = 512;

const hexRgx = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const rgbRgx = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

function parseColor(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  const hex = hexRgx.exec(v);
  if (hex) {
    let h = hex[1] ?? "";
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = rgbRgx.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function sprite(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) paint(ctx, size);
  return c;
}

function glowSprite(color: Rgb, core: Rgb): HTMLCanvasElement {
  return sprite(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, rgba(core, 1));
    g.addColorStop(0.07, rgba(core, 0.9));
    g.addColorStop(0.16, rgba(color, 0.42));
    g.addColorStop(0.4, rgba(color, 0.1));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function flareSprite(color: Rgb, core: Rgb): HTMLCanvasElement {
  return sprite(256, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, rgba(core, 1));
    g.addColorStop(0.035, rgba(core, 1));
    g.addColorStop(0.08, rgba(color, 0.65));
    g.addColorStop(0.22, rgba(color, 0.16));
    g.addColorStop(0.5, rgba(color, 0.04));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const spike = (angle: number, length: number, width: number, alpha: number) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      const lg = ctx.createLinearGradient(-length, 0, length, 0);
      lg.addColorStop(0, rgba(color, 0));
      lg.addColorStop(0.5, rgba(core, alpha));
      lg.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.lineTo(0, -width);
      ctx.lineTo(length, 0);
      ctx.lineTo(0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    spike(0, c * 0.98, 2.2, 0.85);
    spike(Math.PI / 2, c * 0.98, 2.2, 0.85);
    spike(Math.PI / 4, c * 0.42, 1.4, 0.35);
    spike(-Math.PI / 4, c * 0.42, 1.4, 0.35);
  });
}

/**
 * Segments regroupés par niveau d'opacité (quantifié sur une échelle quadratique) :
 * une douzaine de stroke() par image au lieu de plusieurs centaines.
 */
const LEVELS = 12;
class StrokeBatch {
  private readonly buckets: number[][] = Array.from({ length: LEVELS }, () => []);
  add(alpha: number, x1: number, y1: number, x2: number, y2: number) {
    const i = Math.round(Math.sqrt(Math.min(1, alpha)) * (LEVELS - 1));
    if (i > 0) this.buckets[i]?.push(x1, y1, x2, y2);
  }
  flush(ctx: CanvasRenderingContext2D, style: string, width: number) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    this.buckets.forEach((b, i) => {
      if (!b.length) return;
      ctx.globalAlpha = (i / (LEVELS - 1)) ** 2;
      ctx.beginPath();
      for (let j = 0; j < b.length; j += 4) {
        ctx.moveTo(b[j] ?? 0, b[j + 1] ?? 0);
        ctx.lineTo(b[j + 2] ?? 0, b[j + 3] ?? 0);
      }
      ctx.stroke();
      b.length = 0;
    });
  }
}

function q(root: HTMLElement, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-cst="${name}"]`);
}

export function mountConstellation(root: HTMLElement, opts: EngineOptions): () => void {
  const live = opts.mode === "live";
  const stage = q(root, "stage");
  const scene = q(root, "scene");
  const canvas = root.querySelector<HTMLCanvasElement>('canvas[data-cst="canvas"]');
  const ctx = canvas?.getContext("2d", { alpha: true }) ?? null;
  if (!stage || !scene || !canvas || !ctx) throw new Error("Constellation : structure incomplète");

  const track = q(root, "track") ?? root;
  const hero = q(root, "hero");
  const heroText = q(root, "hero-text");
  const nebula = q(root, "nebula");
  const limbEl = q(root, "limb");
  const hud = q(root, "hud");
  const counter = q(root, "counter");
  const bar = q(root, "bar");
  const tip = q(root, "tip");
  const tipInner = q(root, "tip-inner");
  const tipTitle = q(root, "tip-title");
  const tipText = q(root, "tip-text");
  const cardEls = Array.from(root.querySelectorAll<HTMLElement>("[data-cst-card]"));

  // ---- Palette lue dans les jetons de la charte (aucune couleur en dur) ----
  const css = getComputedStyle(document.documentElement);
  const tok = (name: string, fb: Rgb) => parseColor(css.getPropertyValue(name), fb);
  const W0: Rgb = [255, 255, 255];
  const C = {
    white: tok("--violet-50", W0),
    v100: tok("--violet-100", W0),
    v200: tok("--violet-200", W0),
    v300: tok("--violet-300", W0),
    v400: tok("--violet-400", W0),
    g50: tok("--gold-50", W0),
    g200: tok("--gold-200", W0),
    g300: tok("--gold-300", W0),
    g400: tok("--gold-400", W0),
  };
  const tints: Rgb[] = [C.white, C.v200, C.v400, C.g200, C.g400];
  const glow = tints.map((t) => glowSprite(t, C.white));
  const flareViolet = flareSprite(C.v400, C.white);
  const flareGold = flareSprite(C.g300, C.g50);
  const tintStroke = tints.map((t) => rgba(t, 1));
  const goldStroke = rgba(C.g300, 1);
  const meridianStroke = rgba(C.v300, 1);
  const arcStroke = rgba(C.v200, 1);
  const ringBatch = new StrokeBatch();
  const arcBatch = new StrokeBatch();

  // ---- Ciel : étoiles déterministes ----
  const rnd = seeded(20261016);
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 600;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const total = smallScreen ? 240 : 520;
  const stars: Star[] = [];
  const nShell = Math.round(total * 0.6);
  for (let i = 0; i < total; i++) {
    let p: Vec3;
    let size: number;
    if (i < nShell) {
      p = fibonacciPoint(i, nShell);
      const j = 0.06;
      p = { x: p.x + (rnd() - 0.5) * j, y: p.y + (rnd() - 0.5) * j, z: p.z + (rnd() - 0.5) * j };
      const len = Math.hypot(p.x, p.y, p.z) || 1;
      const rad = RS * (0.93 + rnd() * 0.14);
      p = { x: (p.x / len) * rad, y: (p.y / len) * rad, z: (p.z / len) * rad };
      size = 0.55 + rnd() ** 3 * 1.3;
    } else if (i < total * 0.74) {
      const u = fibonacciPoint(Math.floor(rnd() * 997), 997);
      const rad = RS * (0.2 + rnd() * 0.7);
      p = { x: u.x * rad, y: u.y * rad, z: u.z * rad };
      size = 0.5 + rnd() ** 2 * 0.9;
    } else {
      const u = fibonacciPoint(Math.floor(rnd() * 1999), 1999);
      const rad = 3.4 + rnd() * 4;
      p = { x: u.x * rad, y: u.y * rad, z: u.z * rad };
      size = 1.3 + rnd() ** 2 * 2.2;
    }
    const roll = rnd();
    const tint = roll < 0.56 ? 0 : roll < 0.76 ? 1 : roll < 0.89 ? 2 : roll < 0.97 ? 3 : 4;
    stars.push({
      bx: p.x, by: p.y, bz: p.z,
      // Elles arrivent de tout le champ de vision, en avant de la sphère,
      // et filent vers leur place : la constellation se rassemble.
      sx: 2.1 + rnd() * 1.6,
      sy: (rnd() - 0.5) * 0.9,
      sz: 0.8 + rnd() * 1.5,
      size,
      tint,
      glow: 0.35 + rnd() * 0.5,
      tw: 0.5 + rnd() * 2,
      ph: rnd() * Math.PI * 2,
      k: live ? 0 : 1,
    });
  }

  // ---- Les 14 étoiles-fonctionnalités, sur une ceinture en zigzag ----
  const features: FeatureStar[] = CONSTELLATION.map((f, i) => {
    const th = starAngle(i) + (rnd() - 0.5) * 0.05;
    const lat = (i % 2 === 0 ? 1 : -1) * BELT_LAT + (rnd() - 0.5) * 0.1;
    return {
      x: Math.cos(lat) * Math.sin(th) * RS,
      y: Math.sin(lat) * RS,
      z: Math.cos(lat) * Math.cos(th) * RS,
      ignite: live ? 0 : 1,
      gold: f.tone === "gold",
      px: 0, py: 0, vis: 0, front: 0, r: 0,
    };
  });

  // Arcs de grand cercle entre étoiles consécutives (boucle fermée).
  const SUB = 10;
  const arcs: Vec3[][] = features.map((a, i) => {
    const b = features[(i + 1) % features.length] ?? a;
    const pts: Vec3[] = [];
    for (let s = 0; s <= SUB; s++) {
      const t = s / SUB;
      const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), z = lerp(a.z, b.z, t);
      const l = Math.hypot(x, y, z) || 1;
      pts.push({ x: (x / l) * RS, y: (y / l) * RS, z: (z / l) * RS });
    }
    return pts;
  });

  // ---- État animé (anime.js écrit dans ces objets, le rendu les lit) ----
  const intro = { rings: live ? 0 : 1, lines: live ? 0 : 1, labels: live ? 0 : 1, flash: live ? 0 : 1 };
  let introDone = !live;
  // Étoile filante occasionnelle (héros uniquement, après l'intro).
  const meteor = { t: -1, x: 0, y: 0, dx: 0, dy: 0, speed: 0, len: 0, life: 1, gold: false };
  let nextMeteor = 5 + rnd() * 3;
  const cam = { dive: 0, ring: 0, exit: 0 };
  const view = { yaw: 0, pitch: 0 };
  const focus = { amount: 0 };
  // Vitesse de rotation propre : rapide à l'intro, puis apaisée (animée par anime.js).
  const spin = { speed: live ? 0.9 : 0 };
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  let focusIndex = -1;
  let ambient = live ? -0.5 : 0.42;

  // ---- Mise en page (lue au redimensionnement uniquement) ----
  let W = 1, H = 1, dpr = 1, f = 600, D0 = 3, compact = false;
  // Canevas fait de halos doux : 1,5 suffit sur écran tactile. L'intro (la plus
  // chargée, en mouvement rapide) se joue à 1,25 au plus ; la pleine définition
  // (≤ 2) vient ensuite si la machine suit, et redescend si les images tardent.
  const dprTarget = Math.min(coarse || smallScreen ? 1.5 : 2, window.devicePixelRatio || 1);
  let dprMax = live ? Math.min(dprTarget, 1.25) : dprTarget;
  let upgraded = false;
  const perf = { ema: 16.7, frames: 0 };
  let heroOx = 0, heroOy = 0, ringOy = 0, zRef = RC - CAM_IN, starK = 2;
  let tipW = 280, tipH = 120;
  const textBox = { l: 0, t: 0, r: 0, b: 0 };
  let stickyTop = 0;
  const slots: CardSlot[] = cardEls.map((el) => ({ el, x: 0, y: 0, z: 0, angle: 0, last: { t: "", o: "", z: "", p: "" } }));

  function sizeCanvas() {
    dpr = Math.min(dprMax, window.devicePixelRatio || 1);
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
  }

  function measure() {
    // Le canevas couvre la scène : plein écran en mode visite, zone du héros en mode fixe.
    const rect = scene!.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    sizeCanvas();
    compact = W < 1024 || W / H < 1.12;
    f = focalLength(W, H);
    let rHero: number;
    if (!compact) {
      rHero = Math.min(H * 0.34, W * 0.24);
      heroOx = Math.min(W * 0.71, W - rHero * 1.25);
      heroOy = H * 0.5;
    } else {
      const tb = heroText ? heroText.getBoundingClientRect().bottom - rect.top : H * 0.5;
      const avail = Math.max(120, H - tb);
      rHero = Math.max(80, Math.min(W * 0.42, avail * 0.4));
      heroOx = W / 2;
      heroOy = tb + avail * 0.5;
    }
    if (heroText) {
      const tr = heroText.getBoundingClientRect();
      textBox.l = tr.left - rect.left;
      textBox.t = tr.top - rect.top;
      textBox.r = tr.right - rect.left;
      textBox.b = tr.bottom - rect.top;
    }
    D0 = distanceForRadius(RING, f, rHero);
    starK = Math.max(f, 560) * 0.0046;
    stickyTop = parseFloat(getComputedStyle(stage!).top) || 0;
    // Cartes : taille réelle, puis position sur l'anneau.
    let cardH = 0;
    for (const s of slots) cardH = Math.max(cardH, s.el.offsetHeight);
    const yOffPx = cardH / 2 + (compact ? 9 : 18);
    ringOy = H / 2 + (compact ? 14 : 28);
    zRef = RC - CAM_IN;
    const yW = (yOffPx * zRef) / f;
    slots.forEach((s, i) => {
      const a = slotAngle(i, compact);
      s.angle = a;
      s.x = Math.sin(a) * RC;
      s.z = Math.cos(a) * RC;
      s.y = (i % 2 === 0 ? 1 : -1) * yW;
    });
    if (tip) {
      tipW = tip.offsetWidth || tipW;
      tipH = tip.offsetHeight || tipH;
    }
  }

  // ---- Rendu ----
  const v: Vec3 = { x: 0, y: 0, z: 0 };
  const v2: Vec3 = { x: 0, y: 0, z: 0 };
  const trails: number[][] = Array.from({ length: tints.length * 12 }, () => []);
  let last = performance.now();
  let time = 0;
  let prevCamZ = Number.NaN;
  const labelWidth: number[] = new Array<number>(CONSTELLATION.length).fill(0);
  let lastHero = "", lastHud = "", lastHudP = "", lastBar = "", lastNebula = "", lastTip = "", lastLimb = "", lastPair = -1;

  function setStyle(el: HTMLElement | null, key: "opacity" | "transform" | "pointerEvents" | "zIndex", value: string, cacheKey: string): string {
    if (el && cacheKey !== value) el.style[key] = value;
    return value;
  }

  function drawMeteor(dt: number) {
    if (meteor.t < 0) {
      if (time < nextMeteor || focusIndex >= 0) return;
      // Départ dans le ciel au-dessus de la sphère, jamais sur le texte du héros.
      const left = compact ? 0 : textBox.r + 40;
      meteor.x = left + rnd() * Math.max(40, W - left - 40);
      meteor.y = H * (0.04 + rnd() * 0.3);
      const ang = Math.PI * (0.7 + rnd() * 0.12);
      meteor.dx = Math.cos(ang);
      meteor.dy = Math.sin(ang);
      meteor.speed = Math.max(420, Math.min(W, H) * 1.1);
      meteor.len = Math.min(220, Math.max(90, W * 0.12));
      meteor.life = 0.95;
      meteor.gold = rnd() < 0.35;
      meteor.t = 0;
    }
    meteor.t += dt;
    const p = meteor.t / meteor.life;
    if (p >= 1) {
      meteor.t = -1;
      nextMeteor = time + 7 + rnd() * 7;
      return;
    }
    const hx = meteor.x + meteor.dx * meteor.speed * meteor.t;
    const hy = meteor.y + meteor.dy * meteor.speed * meteor.t;
    const l = meteor.len * Math.min(1, p * 2.5);
    const tx = hx - meteor.dx * l;
    const ty = hy - meteor.dy * l;
    const col = meteor.gold ? C.g200 : C.white;
    const grad = ctx!.createLinearGradient(tx, ty, hx, hy);
    grad.addColorStop(0, rgba(col, 0));
    grad.addColorStop(1, rgba(col, 0.9));
    ctx!.globalAlpha = Math.sin(Math.PI * p) * (1 - focus.amount);
    ctx!.strokeStyle = grad;
    ctx!.lineWidth = 1.3;
    ctx!.beginPath();
    ctx!.moveTo(tx, ty);
    ctx!.lineTo(hx, hy);
    ctx!.stroke();
  }

  function render(now: number) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    const d = cam.dive, rr = cam.ring, ex = easeInOutCubic(cam.exit);
    if (live && d < 0.002 && !drag.active) ambient += dt * spin.speed * (1 - 0.85 * focus.amount);

    const heroYaw = ambient + view.yaw;
    const align = easeInOutCubic(smoothstep(0, 0.82, d));
    const rho0 = pairAngle(0, compact);
    const rho = rho0 + dwell(rr) * STEP_ANGLE;
    const targetYaw = heroYaw + wrapPi(-rho0 - heroYaw);
    const yaw = lerp(heroYaw, targetYaw, align) - (rho - rho0) + ex * 0.5;
    const pitch = lerp(HERO_PITCH + view.pitch, 0, align) + ex * HERO_PITCH * 0.8;
    const roll = lerp(HERO_ROLL, 0, align) + ex * HERO_ROLL * 0.6;
    const m: Mat3 = rotation(yaw, pitch, roll);
    let camZ = lerp(-D0, CAM_IN, easeInOutCubic(d));
    camZ = lerp(camZ, -D0 * 1.18, ex);
    const centerMix = smoothstep(0.04, 0.6, d);
    const ox = lerp(heroOx, W / 2, centerMix);
    const oy = lerp(heroOy, ringOy, centerMix) + ex * (H / 2 - ringOy);
    const focusDepth = Math.max(0.6, -camZ);
    const speed = Number.isNaN(prevCamZ) ? 0 : Math.abs(camZ - prevCamZ) / Math.max(dt, 1 / 120);
    const streak = live ? smoothstep(0.35, 2.2, speed) : 0;
    const streakDz = (camZ - (Number.isNaN(prevCamZ) ? camZ : prevCamZ)) * 5;
    prevCamZ = camZ;
    const dimOthers = 1 - 0.55 * focus.amount;
    // Parallaxe amortie (indépendante de la cadence d'images).
    const damp = 1 - Math.exp(-dt * 3.2);
    parallax.x += (parallax.tx - parallax.x) * damp;
    parallax.y += (parallax.ty - parallax.y) * damp;
    const camX = parallax.x * lerp(0.16, 0.07, smoothstep(0.3, 1, d));
    const camY = parallax.y * lerp(0.1, 0.045, smoothstep(0.3, 1, d));
    const outside = clamp01((-camZ - 1.15) / 0.7);
    const heroMask = live ? 1 - smoothstep(0.02, 0.3, d) : 1;
    const textFade = (px: number, py: number) => {
      if (heroMask <= 0) return 1;
      const dx = Math.max(textBox.l - px, 0, px - textBox.r);
      const dy = Math.max(textBox.t - py, 0, py - textBox.b);
      if (dx > 90 || dy > 90) return 1;
      return 1 - 0.72 * heroMask * (1 - smoothstep(0, 90, Math.hypot(dx, dy)));
    };

    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, W, H);
    ctx!.globalCompositeOperation = "lighter";

    // Limbe : la sphère se lit comme un globe de verre vu de l'extérieur.
    // C'est un calque CSS (composé par le GPU) : seul son placement change.
    const dist = -camZ;
    const sphereR = (f * RS) / Math.sqrt(Math.max(0.01, dist * dist - RS * RS));
    const cx = ox - (f * camX) / dist;
    const cy = oy + (f * camY) / dist;
    if (limbEl) {
      const rad = sphereR * 1.04;
      const big = Math.max(W, H);
      // Au-delà de l'écran, le limbe coûterait cher pour rien : il s'efface avant.
      const fade = outside * Math.min(1, intro.rings * 1.4) * (1 - smoothstep(big * 0.5, big * 0.85, rad));
      const key = fade > 0.005 ? `${(cx - rad).toFixed(1)}|${(cy - rad).toFixed(1)}|${((rad * 2) / LIMB_PX).toFixed(4)}|${fade.toFixed(3)}` : "0";
      if (key !== lastLimb) {
        limbEl.style.opacity = fade > 0.005 ? fade.toFixed(3) : "0";
        if (fade > 0.005) limbEl.style.transform = `translate3d(${(cx - rad).toFixed(1)}px, ${(cy - rad).toFixed(1)}px, 0) scale(${((rad * 2) / LIMB_PX).toFixed(4)})`;
        lastLimb = key;
      }
    }

    // Étoiles : traînées (intro et plongée) regroupées par teinte.
    for (const t of trails) t.length = 0;
    const margin = 60;
    const trailMax = Math.max(W, H) * 0.14;
    for (const s of stars) {
      const k = s.k;
      if (k <= 0.001) continue;
      const kk = 1 - k;
      rotate(m, s.bx, s.by, s.bz, v);
      const fx = v.x, fy = v.y, fz = v.z;
      if (kk > 0.0005) {
        // Intro : depuis tout le champ, en avant de la sphère, vers sa place.
        v.x = fx + (fx * s.sx - fx) * kk;
        v.y = fy + (fy * s.sx + s.sy - fy) * kk;
        v.z = fz + (camZ + s.sz - fz) * kk;
      }
      const z = v.z - camZ;
      if (z < NEAR) continue;
      const inv = 1 / z;
      const px = ox + f * (v.x - camX) * inv;
      const py = oy - f * (v.y - camY) * inv;
      if (px < -margin || px > W + margin || py < -margin || py > H + margin) continue;
      let r = s.size * starK * inv;
      let a = (0.62 + 0.38 * Math.sin(time * s.tw + s.ph)) * Math.min(1, k * 1.6);
      a *= smoothstep(NEAR, 0.5, z);
      // Hémisphère arrière plus discret : profondeur lisible de l'extérieur.
      if (outside > 0 && z < 5) a *= 1 - 0.55 * outside * smoothstep(-0.3, 0.9, v.z);
      a *= textFade(px, py);
      if (z > 5) a *= 1 - smoothstep(5, 11, z) * 0.6;
      const b = Math.max(0, (focusDepth * 0.8 - z) / focusDepth);
      if (b > 0) {
        r *= 1 + b * 2.4;
        a /= 1 + b * 3.2;
      }
      if (r > 6) r = 6;
      a *= dimOthers;
      if (a < 0.01) continue;
      const g = glow[s.tint] ?? glow[0]!;
      // En vol (intro), une tête de comète fine : plus élégant, et bien moins de pixels.
      const hs = Math.min(kk > 0.04 ? 14 : 44, Math.max(2.2, r * 7) * s.glow * 1.6);
      ctx!.globalAlpha = Math.min(1, a);
      ctx!.drawImage(g, px - hs / 2, py - hs / 2, hs, hs);
      if ((k < 0.97 && kk > 0.02) || streak > 0.02) {
        const ta = Math.min(1, a) * (k < 0.97 ? 0.5 : 0.45 * streak);
        const ab = ta < 0.12 ? 0 : ta < 0.25 ? 1 : ta < 0.4 ? 2 : 3;
        const wb = r < 1.4 ? 0 : r < 2.6 ? 1 : 2;
        const trail = ta > 0.02 ? trails[s.tint * 12 + ab * 3 + wb] : undefined;
        if (trail) {
          // Position un instant plus tôt : l'intro suit une courbe outQuart
          // (kk = (1 - t)^4), la traînée est donc proportionnelle à la vitesse.
          let x2 = v.x, y2 = v.y, z2: number;
          if (k < 0.97) {
            const kk2 = Math.min(1, (Math.sqrt(Math.sqrt(kk)) + 0.035) ** 4);
            x2 = fx + (fx * s.sx - fx) * kk2;
            y2 = fy + (fy * s.sx + s.sy - fy) * kk2;
            z2 = fz + (camZ + s.sz - fz) * kk2 - camZ;
          } else {
            z2 = v.z - (camZ - streakDz * streak);
          }
          if (z2 > NEAR) {
            // Traînée plafonnée : plus nette, et bien moins coûteuse à tracer.
            let tx = ox + (f * (x2 - camX)) / z2 - px;
            let ty = oy - (f * (y2 - camY)) / z2 - py;
            const tl = Math.hypot(tx, ty);
            if (tl > trailMax) {
              tx *= trailMax / tl;
              ty *= trailMax / tl;
            }
            trail.push(px, py, px + tx, py + ty);
          }
        }
      }
    }
    // Une seule passe de tracé par teinte × opacité × épaisseur (au plus 60 tracés).
    ctx!.lineCap = "round";
    trails.forEach((t, key) => {
      if (!t.length) return;
      const ti = Math.floor(key / 12);
      const ab = Math.floor((key % 12) / 3);
      const wb = key % 3;
      ctx!.strokeStyle = tintStroke[ti] ?? "";
      ctx!.globalAlpha = TRAIL_ALPHA[ab] ?? 0.1;
      ctx!.lineWidth = TRAIL_WIDTH[wb] ?? 1;
      ctx!.beginPath();
      for (let i = 0; i < t.length; i += 4) {
        ctx!.moveTo(t[i] ?? 0, t[i + 1] ?? 0);
        ctx!.lineTo(t[i + 2] ?? 0, t[i + 3] ?? 0);
      }
      ctx!.stroke();
    });

    // Anneau d'or (écliptique) et méridien violet, dessinés en balayage à l'intro.
    // Vu de l'intérieur, l'anneau se réduit à une ligne d'horizon : il s'efface.
    const ringSweep = intro.rings * Math.PI * 2;
    const beltFade = 1 - 0.9 * align * (1 - ex);
    const drawRing = (axis: "belt" | "meridian", batch: StrokeBatch, baseAlpha: number, ticks: boolean) => {
      const N = 120;
      let ok0 = false, x0 = 0, y0 = 0, fr0 = 0;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        if (a > ringSweep + 1e-6) break;
        const lx = axis === "belt" ? Math.sin(a) * RING : 0;
        const ly = axis === "belt" ? 0 : Math.sin(a) * RING;
        const lz = Math.cos(a) * RING;
        rotate(m, lx, ly, lz, v);
        const z = v.z - camZ;
        const ok = z > NEAR;
        const x = ok ? ox + (f * (v.x - camX)) / z : 0;
        const y = ok ? oy - (f * (v.y - camY)) / z : 0;
        const fr = clamp01(0.5 - v.z / (RING * 2));
        if (i > 0 && ok0 && ok) {
          const al = baseAlpha * (0.25 + 0.75 * ((fr + fr0) / 2)) * smoothstep(NEAR, 0.4, z) * dimOthers;
          batch.add(al, x0, y0, x, y);
          if (ticks && i % 5 === 0) {
            const major = i % 15 === 0;
            const out = major ? 1.075 : 1.035;
            rotate(m, lx * out, ly, lz * out, v2);
            const z2 = v2.z - camZ;
            if (z2 > NEAR) batch.add(al * (major ? 1 : 0.7), x, y, ox + (f * (v2.x - camX)) / z2, oy - (f * (v2.y - camY)) / z2);
          }
        }
        ok0 = ok; x0 = x; y0 = y; fr0 = fr;
      }
    };
    if (beltFade > 0.01) {
      drawRing("belt", ringBatch, 0.5 * beltFade, beltFade > 0.5);
      ringBatch.flush(ctx!, goldStroke, 1);
    }
    if (outside > 0.01) {
      drawRing("meridian", ringBatch, 0.16 * outside, false);
      ringBatch.flush(ctx!, meridianStroke, 1);
    }

    // Projection des étoiles-fonctionnalités.
    features.forEach((fs) => {
      rotate(m, fs.x, fs.y, fs.z, v);
      const z = v.z - camZ;
      fs.vis = z > NEAR ? 1 : 0;
      if (!fs.vis) return;
      fs.px = ox + (f * (v.x - camX)) / z;
      fs.py = oy - (f * (v.y - camY)) / z;
      fs.front = clamp01(0.5 - v.z / (RS * 1.6));
      fs.r = Math.min(24, (f * 0.07) / z);
    });

    // Lignes de constellation (arcs collés à la sphère), tracées dans l'ordre.
    const linesDone = intro.lines * arcs.length;
    arcs.forEach((pts, i) => {
      const part = clamp01(linesDone - i);
      if (part <= 0) return;
      const fa = features[i];
      const fb = features[(i + 1) % features.length];
      const touched = focusIndex === i || focusIndex === (i + 1) % features.length;
      const lit = touched ? 1 : dimOthers;
      const steps = Math.max(1, Math.ceil(part * SUB));
      let px = 0, py = 0, ok = false;
      for (let s = 0; s <= steps; s++) {
        const t = Math.min(s, part * SUB) / SUB;
        const idx = Math.min(SUB - 1, Math.floor(t * SUB));
        const p0 = pts[idx]!, p1 = pts[idx + 1]!;
        const u = t * SUB - idx;
        rotate(m, lerp(p0.x, p1.x, u), lerp(p0.y, p1.y, u), lerp(p0.z, p1.z, u), v);
        const z = v.z - camZ;
        const nok = z > NEAR;
        const x = nok ? ox + (f * (v.x - camX)) / z : 0;
        const y = nok ? oy - (f * (v.y - camY)) / z : 0;
        if (ok && nok) {
          const fr = clamp01(0.5 - v.z / (RS * 1.6));
          arcBatch.add((0.12 + 0.42 * fr) * lit * Math.min(fa?.ignite ?? 1, fb?.ignite ?? 1, 1) * smoothstep(NEAR, 0.35, z) * (touched ? 1.6 : 1), px, py, x, y);
        }
        px = x; py = y; ok = nok;
      }
    });
    arcBatch.flush(ctx!, arcStroke, 1.1);

    // Étoiles-fonctionnalités : halo, cœur et aigrettes.
    features.forEach((fs, i) => {
      if (!fs.vis || fs.ignite <= 0.001) return;
      const focused = i === focusIndex;
      const pulse = 1 + 0.06 * Math.sin(time * 1.7 + i);
      const size = fs.r * pulse * Math.max(0, fs.ignite) * (focused ? 1 + 0.55 * focus.amount : 1) * 6;
      let a = (0.35 + 0.65 * fs.front) * Math.min(1, fs.ignite) * (focused ? 1 : dimOthers);
      if (live) a *= 1 - 0.45 * smoothstep(0.75, 1, d) * (1 - ex);
      ctx!.globalAlpha = clamp01(a);
      const spr = fs.gold ? flareGold : flareViolet;
      ctx!.drawImage(spr, fs.px - size / 2, fs.py - size / 2, size, size);
    });

    // Étoile en focus : un anneau fin la désigne (survol ou toucher).
    const sel = focusIndex >= 0 ? features[focusIndex] : undefined;
    if (sel && sel.vis && focus.amount > 0.01) {
      ctx!.globalAlpha = 0.75 * focus.amount;
      ctx!.strokeStyle = sel.gold ? goldStroke : arcStroke;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.arc(sel.px, sel.py, 9 + sel.r * 0.9 + 4 * (1 - focus.amount), 0, Math.PI * 2);
      ctx!.stroke();
    }

    // Éclat or de fin d'intro : une onde quitte la sphère, l'étoile d'or la plus
    // en avant scintille fort, une fois.
    const fl = intro.flash;
    if (fl > 0.001 && fl < 0.999) {
      ctx!.globalAlpha = (1 - fl) ** 2 * 0.6;
      ctx!.strokeStyle = goldStroke;
      ctx!.lineWidth = 1 + 1.6 * (1 - fl);
      ctx!.beginPath();
      ctx!.arc(cx, cy, sphereR * (1.02 + 0.6 * easeOutCubic(fl)), 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.globalAlpha = (1 - fl) ** 3 * 0.35;
      ctx!.beginPath();
      ctx!.arc(cx, cy, sphereR * (1.02 + 0.32 * easeOutCubic(fl)), 0, Math.PI * 2);
      ctx!.stroke();
      let best: FeatureStar | null = null;
      for (const fs of features) if (fs.gold && fs.vis && (!best || fs.front > best.front)) best = fs;
      if (best) {
        const g = Math.sin(Math.PI * Math.min(1, fl * 1.25));
        const size = sphereR * 1.5 * g;
        ctx!.globalAlpha = 0.95 * g;
        ctx!.drawImage(flareGold, best.px - size / 2, best.py - size / 2, size, size);
      }
    }

    if (live && introDone && d < 0.02) drawMeteor(dt);

    // Étiquettes du ciel (écran large, vue extérieure uniquement).
    ctx!.globalCompositeOperation = "source-over";
    const labelAlpha = intro.labels * (1 - smoothstep(0.02, 0.2, d)) * (1 - ex);
    if (!compact && labelAlpha > 0.01) {
      if (document.fonts?.status === "loading") labelWidth.fill(0);
      ctx!.font = '500 12px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx!.textBaseline = "middle";
      features.forEach((fs, i) => {
        if (!fs.vis || fs.front < 0.55) return;
        const focused = i === focusIndex;
        const a = labelAlpha * smoothstep(0.55, 0.8, fs.front) * (focused ? 1 : 0.78 * dimOthers);
        if (a < 0.02) return;
        const label = CONSTELLATION[i]?.title ?? "";
        const w = labelWidth[i] || (labelWidth[i] = ctx!.measureText(label).width);
        let left = fs.px < ox;
        if (!left && fs.px + 16 + w > W - 12) left = true;
        if (left && fs.px - 16 - w < textBox.r + 12) left = false;
        ctx!.textAlign = left ? "right" : "left";
        ctx!.globalAlpha = a;
        ctx!.fillStyle = rgba(fs.gold ? C.g200 : C.v100, 1);
        ctx!.fillText(label, fs.px + (left ? -16 : 16), fs.py);
      });
    }
    ctx!.globalAlpha = 1;

    // Infobulle de l'étoile survolée.
    if (tip && focusIndex >= 0) {
      const fs = features[focusIndex];
      if (fs && fs.vis) {
        let tx: number;
        let ty: number;
        if (compact) {
          // En bas de la scène, sous l'étoile amenée au-dessus du centre ; au-dessus
          // d'elle si elle est trop basse, sans jamais recouvrir le texte du héros.
          tx = Math.min(Math.max(12, (W - tipW) / 2), W - tipW - 12);
          ty = H - tipH - 12;
          if (fs.py + 22 > ty) ty = Math.max(textBox.b + 8, fs.py - 28 - tipH);
        } else {
          let right = fs.px >= ox;
          if (right && fs.px + 22 + tipW > W - 16) right = false;
          if (!right && fs.px - 22 - tipW < textBox.r + 8) right = true;
          tx = right ? fs.px + 22 : fs.px - 22 - tipW;
          tx = Math.min(Math.max(12, tx), W - tipW - 12);
          ty = Math.min(Math.max(12, fs.py - tipH / 2), H - tipH - 12);
        }
        lastTip = setStyle(tip, "transform", `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`, lastTip);
      }
    }

    if (!live) return;

    // Héro : s'efface quand la caméra plonge.
    const heroA = 1 - smoothstep(0.03, 0.28, d);
    const heroKey = `${heroA.toFixed(3)}|${(d * 90).toFixed(1)}`;
    if (hero && heroKey !== lastHero) {
      hero.style.opacity = heroA.toFixed(3);
      hero.style.transform = `translate3d(0, ${(-d * 90).toFixed(1)}px, 0)`;
      hero.style.pointerEvents = heroA < 0.4 ? "none" : "";
      lastHero = heroKey;
    }
    if (nebula) {
      // Pendant la visite, la nébuleuse s'efface (un calque plein écran de moins
      // à composer à chaque image) ; le fond de la scène garde un halo violet.
      const nebA = 1 - smoothstep(0.6, 0.95, d) * (1 - smoothstep(0, 0.6, cam.exit));
      const nk = `${centerMix.toFixed(3)}|${d.toFixed(3)}|${ex.toFixed(3)}|${nebA.toFixed(3)}`;
      if (nk !== lastNebula) {
        nebula.style.transform = `translate3d(${((ox - W / 2) * 0.55).toFixed(1)}px, ${((oy - H / 2) * 0.4).toFixed(1)}px, 0) scale(${(1 + easeInOutCubic(d) * 0.9 - ex * 0.5).toFixed(3)})`;
        nebula.style.opacity = nebA.toFixed(3);
        lastNebula = nk;
      }
    }

    // Cartes : chaque fonctionnalité sort de son étoile.
    const gate = smoothstep(0.66, 0.98, d) * (1 - smoothstep(0, 0.55, cam.exit));
    slots.forEach((s, i) => {
      const fs = features[i]!;
      const ang = wrapPi(s.angle + yaw);
      // Mobile : une carte occupe presque toute la largeur, la paire sortante
      // s'efface avant que l'entrante n'arrive (pas de textes superposés).
      const em = gate * (1 - smoothstep(compact ? 0.14 : 0.62, compact ? 0.44 : 1.2, Math.abs(ang)));
      const st = s.last;
      if (em <= 0.002) {
        st.o = setStyle(s.el, "opacity", "0", st.o);
        st.p = setStyle(s.el, "pointerEvents", "none", st.p);
        return;
      }
      const e = easeOutCubic(em);
      rotate(m, fs.x, fs.y, fs.z, v);
      rotate(m, s.x, s.y, s.z, v2);
      const bob = Math.sin(time * 0.9 + i * 1.7) * 0.006 * e;
      const wx = lerp(v.x, v2.x, e), wy = lerp(v.y, v2.y, e) + bob, wz = lerp(v.z, v2.z, e);
      const z = wz - camZ;
      if (z < NEAR * 2) {
        st.o = setStyle(s.el, "opacity", "0", st.o);
        return;
      }
      const px = ox + (f * (wx - camX)) / z;
      const py = oy - (f * (wy - camY)) / z;
      const scale = Math.min(1, zRef / z) * lerp(0.08, 1, e);
      const deg = (-ang * 0.9 * 180) / Math.PI;
      const side = compact ? 1 : 1 - 0.4 * smoothstep(0.3, 0.75, Math.abs(ang));
      const o = clamp01(em * 1.35 - 0.25) * side;
      st.t = setStyle(s.el, "transform", `translate3d(${(px - W / 2).toFixed(1)}px, ${(py - H / 2).toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(4)}) perspective(1100px) rotateY(${deg.toFixed(2)}deg)`, st.t);
      st.o = setStyle(s.el, "opacity", o.toFixed(3), st.o);
      st.z = setStyle(s.el, "zIndex", String(1000 - Math.round(z * 100)), st.z);
      st.p = setStyle(s.el, "pointerEvents", o > 0.45 ? "auto" : "none", st.p);
    });

    // Repères de visite.
    const hudA = smoothstep(0.72, 0.95, d) * (1 - smoothstep(0.15, 0.7, cam.exit));
    lastHud = setStyle(hud, "opacity", hudA.toFixed(3), lastHud);
    lastHudP = setStyle(hud, "pointerEvents", hudA > 0.5 ? "auto" : "none", lastHudP);
    const progress = clamp01(dwell(rr) / (STEPS - 1));
    lastBar = setStyle(bar, "transform", `scaleX(${progress.toFixed(4)})`, lastBar);
    const pair = pairIndex(rr);
    if (counter && pair !== lastPair) {
      const a = String(pair * 2 + 1).padStart(2, "0");
      const b = String(pair * 2 + 2).padStart(2, "0");
      counter.textContent = `${a}–${b}`;
      lastPair = pair;
    }
    if (d > 0.05 && focusIndex >= 0 && !focusLeaving) setFocus(-1);
  }

  // ---- Boucle, visibilité, onglet ----
  let raf = 0;
  let inView = true;
  let destroyed = false;

  /** Dessine une image ; une erreur bascule la section en affichage statique. */
  const paint = (now: number) => {
    try {
      render(now);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };
  /**
   * Définition adaptative. Redimensionner efface le canevas : on le fait donc
   * toujours avant de dessiner, jamais entre un dessin et l'affichage.
   */
  const adaptQuality = (dtMs: number) => {
    if (++perf.frames > 12) perf.ema = lerp(perf.ema, Math.min(100, dtMs), 0.08);
    if (perf.frames > 40 && perf.ema > 19 && dpr > 1) {
      dprMax = Math.max(1, dpr - 0.25);
      // Une baisse pendant l'intro n'interdit pas la remontée une fois au calme.
      if (introDone) upgraded = true;
      sizeCanvas();
      perf.frames = 0;
      perf.ema = 16.7;
    } else if (!upgraded && introDone && perf.frames > 60 && perf.ema < 15 && dprMax < dprTarget) {
      upgraded = true;
      dprMax = dprTarget;
      sizeCanvas();
      perf.frames = 0;
      perf.ema = 16.7;
    }
  };
  const frame = (now: number) => {
    raf = 0;
    if (destroyed) return;
    adaptQuality(now - last);
    if (!paint(now)) return;
    if (live && inView && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (!live || raf || destroyed || !inView || document.hidden) return;
    last = performance.now();
    perf.frames = 0;
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const drawOnce = () => {
    if (destroyed || raf) return;
    raf = requestAnimationFrame((now) => {
      raf = 0;
      if (destroyed) return;
      try {
        render(now);
      } catch (error) {
        fail(error);
      }
    });
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) inView = e.isIntersecting;
    if (inView) start();
    else stop();
  });
  io.observe(live ? track : scene);
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);

  const ro = new ResizeObserver(() => {
    measure();
    if (!live) {
      drawOnce();
      return;
    }
    // Le canevas vient d'être effacé : on le redessine avant l'affichage.
    if (inView && !document.hidden) paint(last);
    start();
  });
  ro.observe(scene);

  // ---- Focus d'une étoile (survol, toucher) ----
  let focusAnim: JSAnimation | null = null;
  let tipAnim: JSAnimation | null = null;
  let cameraAnim: JSAnimation | null = null;
  let focusLeaving = false;

  function setFocus(i: number) {
    if (!live) return;
    if (i === focusIndex && !focusLeaving) return;
    focusAnim?.cancel();
    tipAnim?.cancel();
    if (i >= 0) {
      const feat = CONSTELLATION[i];
      if (!feat) return;
      focusIndex = i;
      focusLeaving = false;
      if (tipTitle) tipTitle.textContent = feat.title;
      if (tipText) tipText.textContent = feat.text;
      if (tip) {
        tip.dataset.tone = feat.tone;
        tip.style.pointerEvents = "auto";
        tipW = tip.offsetWidth || tipW;
        tipH = tip.offsetHeight || tipH;
      }
      focusAnim = animate(focus, { amount: 1, duration: 520, ease: "outCubic" });
      if (tipInner) tipAnim = animate(tipInner, { opacity: [0, 1], translateY: [10, 0], scale: [0.96, 1], duration: 420, ease: "outExpo" });
    } else if (focusIndex >= 0) {
      focusLeaving = true;
      if (tip) tip.style.pointerEvents = "none";
      focusAnim = animate(focus, {
        amount: 0,
        duration: 380,
        ease: "outQuad",
        onComplete: () => {
          if (focusLeaving) {
            focusIndex = -1;
            focusLeaving = false;
          }
        },
      });
      if (tipInner) tipAnim = animate(tipInner, { opacity: 0, translateY: 6, duration: 240, ease: "outQuad" });
    }
  }

  function hitTest(x: number, y: number, radius: number): number {
    let best = -1;
    let bestD = radius * radius;
    features.forEach((fs, i) => {
      if (!fs.vis || fs.front < 0.35 || fs.ignite < 0.5) return;
      const dx = fs.px - x, dy = fs.py - y;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best;
  }

  /**
   * Transition de caméra : amène l'étoile i face au lecteur. Sur écran compact,
   * l'étoile se place au-dessus du centre, juste au-dessus de l'infobulle.
   */
  function bringToFront(i: number) {
    const fs = features[i];
    if (!fs) return;
    const targetY = compact ? RS * 0.42 : 0;
    const theta = Math.atan2(fs.x, fs.z);
    const baseYaw = view.yaw + wrapPi(-theta - (ambient + view.yaw));
    let bestYaw = baseYaw, bestPitch = 0, best = Infinity;
    for (let a = -0.6; a <= 0.6; a += 0.04) {
      for (let p = -0.5; p <= 0.5; p += 0.04) {
        rotate(rotation(ambient + baseYaw + a, HERO_PITCH + p, HERO_ROLL), fs.x, fs.y, fs.z, v2);
        if (v2.z > 0) continue;
        const e = v2.x * v2.x + (v2.y - targetY) ** 2;
        if (e < best) {
          best = e;
          bestYaw = baseYaw + a;
          bestPitch = p;
        }
      }
    }
    cameraAnim?.cancel();
    cameraAnim = animate(view, { yaw: bestYaw, pitch: bestPitch, duration: 1100, ease: "inOutCubic" });
  }

  // ---- Glisser pour tourner (inertie confiée à anime.js) ----
  const drag = { active: false, down: false, id: -1, x: 0, y: 0, sx: 0, sy: 0, t: 0, vel: 0, type: "mouse" };
  let inertia: JSAnimation | null = null;

  const local = (e: PointerEvent) => {
    const r = canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent) => {
    if (cam.dive > 0.08 || e.button > 0) return;
    drag.down = true;
    drag.active = false;
    drag.id = e.pointerId;
    drag.type = e.pointerType;
    drag.x = drag.sx = e.clientX;
    drag.y = drag.sy = e.clientY;
    drag.t = performance.now();
    drag.vel = 0;
  };
  const onMove = (e: PointerEvent) => {
    if (drag.down && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.active && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
        drag.active = true;
        inertia?.cancel();
        cameraAnim?.cancel();
        canvas!.setPointerCapture?.(e.pointerId);
        root.dataset.dragging = "true";
        setFocus(-1);
      }
      if (drag.active) {
        const now = performance.now();
        const dtm = Math.max(1, now - drag.t);
        view.yaw += dx * 0.0065;
        if (drag.type === "mouse") view.pitch = Math.max(-0.5, Math.min(0.5, view.pitch + dy * 0.004));
        drag.vel = lerp(drag.vel, (dx * 0.0065 * 1000) / dtm, 0.35);
        drag.t = now;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    if (e.pointerType === "mouse" && cam.dive < 0.03) {
      const p = local(e);
      const hit = hitTest(p.x, p.y, 30);
      canvas!.style.cursor = hit >= 0 ? "pointer" : "grab";
      if (hit >= 0) setFocus(hit);
      else if (focusIndex >= 0 && !focusLeaving) setFocus(-1);
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!drag.down || e.pointerId !== drag.id) return;
    drag.down = false;
    if (drag.active) {
      drag.active = false;
      delete root.dataset.dragging;
      const vel = Math.max(-6, Math.min(6, drag.vel));
      inertia = animate(view, { yaw: view.yaw + vel * 0.42, pitch: 0, duration: 900 + Math.abs(vel) * 260, ease: "outQuart" });
      return;
    }
    const p = local(e);
    const hit = hitTest(p.x, p.y, e.pointerType === "mouse" ? 30 : 40);
    if (hit >= 0) {
      const feat = CONSTELLATION[hit];
      if (e.pointerType === "mouse" && feat) opts.onNavigate(feat.href);
      else {
        setFocus(hit);
        bringToFront(hit);
      }
    } else setFocus(-1);
  };
  const onCancel = () => {
    drag.down = false;
    drag.active = false;
    delete root.dataset.dragging;
  };
  const onStageMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const r = stage!.getBoundingClientRect();
    parallax.tx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    parallax.ty = -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
  };
  const onStageLeave = () => {
    parallax.tx = 0;
    parallax.ty = 0;
  };
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !drag.down) setFocus(-1);
  };
  const onTipClick = () => {
    const feat = CONSTELLATION[focusIndex];
    if (feat && focus.amount > 0.3) opts.onNavigate(feat.href);
  };

  // ---- Clavier : la caméra suit le focus ----
  const scrollToProgress = (p: number) => {
    if (!scrollObserver) return;
    const top = scrollObserver.offsetStart + clamp01(p) * scrollObserver.distance;
    window.scrollTo({ top, behavior: "instant" });
  };
  const onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !live) return;
    const card = target.closest<HTMLElement>("[data-cst-card]");
    if (card) {
      if (!target.matches(":focus-visible")) return;
      const i = cardEls.indexOf(card);
      if (i >= 0) scrollToProgress((230 + (Math.floor(i / 2) / (STEPS - 1)) * 680) / 1000);
      return;
    }
    if (hero && hero.contains(target) && cam.dive > 0.05) scrollToProgress(0);
  };

  if (live) {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    tip?.addEventListener("click", onTipClick);
    root.addEventListener("focusin", onFocusIn);
    stage.addEventListener("pointermove", onStageMove);
    stage.addEventListener("pointerleave", onStageLeave);
  }

  // ---- Orchestration anime.js : intro et défilement ----
  let scope: Scope | null = null;
  let scrollObserver: ReturnType<typeof onScroll> | null = null;
  let introTl: Timeline | null = null;

  measure();

  if (live) {
    const pick = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-cst-intro="${name}"]`));
    scope = createScope({ root });
    scope.add(() => {
      root.dataset.intro = "playing";
      introTl = createTimeline({
        defaults: { ease: "outExpo" },
        onComplete: () => {
          introDone = true;
          root.dataset.intro = "done";
          if (introTl) utils.cleanInlineStyles(introTl);
        },
      });
      introTl
        .add(stars, { k: [0, 1], duration: 2100, ease: "outQuart", delay: stagger(smallScreen ? 2.6 : 1.5, { from: "random", seed: 11 }) }, 0)
        .add(intro, { rings: [0, 1], duration: 2000, ease: "inOutCubic" }, 450)
        .add(features, { ignite: [0, 1], duration: 1000, ease: "outBack(1.8)", delay: stagger(75) }, 850)
        .add(intro, { lines: [0, 1], duration: 1700, ease: "inOutSine" }, 1150)
        .add(intro, { labels: [0, 1], duration: 900, ease: "outCubic" }, 2300)
        .add(spin, { speed: [0.9, 0.07], duration: 3400, ease: "outCubic" }, 0)
        .add(pick("eyebrow"), { opacity: [0, 1], translateY: [10, 0], duration: 900 }, 120)
        .add(pick("word"), { opacity: [0, 1], translateY: ["0.5em", "0em"], filter: ["blur(8px)", "blur(0px)"], duration: 1200, delay: stagger(65) }, 220)
        .add(pick("lead"), { opacity: [0, 1], translateY: [16, 0], duration: 1100 }, 850)
        .add(pick("cta"), { opacity: [0, 1], translateY: [16, 0], duration: 1000, delay: stagger(110) }, 1050)
        .add(pick("note"), { opacity: [0, 1], duration: 1000, delay: stagger(120) }, 1500)
        .add(intro, { flash: [0, 1], duration: 1700, ease: "outSine" }, 2650)
        .add(Array.from(root.querySelectorAll<HTMLElement>(".cst-word-glow")), { backgroundPosition: ["100% 0%, 0% 0%", "0% 0%, 0% 0%"], duration: 1500, ease: "inOutSine" }, 2700);

      const scrollTl = createTimeline({
        autoplay: (scrollObserver = onScroll({
          target: track,
          enter: { container: stickyTop, target: "top" },
          leave: { container: "bottom", target: "bottom" },
          sync: 0.22,
        })),
      });
      scrollTl
        .add(cam, { dive: [0, 1], duration: 220, ease: "inOutSine" }, 0)
        .add(cam, { ring: [0, STEPS - 1], duration: 680, ease: "linear" }, 230)
        .add(cam, { exit: [0, 1], duration: 90, ease: "inOutSine" }, 910);
    });
    start();
  } else {
    root.dataset.intro = "done";
    drawOnce();
    document.fonts?.ready.then(() => {
      if (!destroyed) drawOnce();
    }).catch(() => undefined);
  }

  function clearInline() {
    for (const s of slots) {
      s.el.style.removeProperty("transform");
      s.el.style.removeProperty("opacity");
      s.el.style.removeProperty("z-index");
      s.el.style.removeProperty("pointer-events");
    }
    for (const el of [hero, hud, nebula, tip, tipInner, bar, limbEl]) {
      el?.style.removeProperty("transform");
      el?.style.removeProperty("opacity");
      el?.style.removeProperty("pointer-events");
    }
    canvas?.style.removeProperty("cursor");
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    io.disconnect();
    ro.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    canvas!.removeEventListener("pointerdown", onDown);
    canvas!.removeEventListener("pointermove", onMove);
    canvas!.removeEventListener("pointerup", onUp);
    canvas!.removeEventListener("pointercancel", onCancel);
    canvas!.removeEventListener("pointerleave", onLeave);
    tip?.removeEventListener("click", onTipClick);
    root.removeEventListener("focusin", onFocusIn);
    stage!.removeEventListener("pointermove", onStageMove);
    stage!.removeEventListener("pointerleave", onStageLeave);
    for (const a of [focusAnim, tipAnim, inertia, cameraAnim]) a?.revert();
    scope?.revert();
    scrollObserver?.revert();
    clearInline();
    delete root.dataset.dragging;
    root.dataset.intro = "done";
    // Libère la mémoire du canevas.
    canvas!.width = 0;
    canvas!.height = 0;
  }

  function fail(error: unknown) {
    destroy();
    opts.onError?.(error);
  }

  return destroy;
}
