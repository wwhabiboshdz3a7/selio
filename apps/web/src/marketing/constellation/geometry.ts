/**
 * Géométrie de la sphère céleste : fonctions pures (testées), sans DOM.
 * Repère : x vers la droite, y vers le haut, z vers l'avant (loin de la caméra).
 */
export const TAU = Math.PI * 2;
/** 14 fonctionnalités, 7 paires montrées tour à tour pendant la visite. */
export const STEPS = 7;
export const STEP_ANGLE = TAU / STEPS;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Ramène un angle dans ]-π, π]. */
export function wrapPi(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

/**
 * Escalier adouci : la valeur marque une pause autour de chaque entier
 * (dérivée nulle), ce qui laisse le temps de lire chaque paire de cartes.
 */
export function dwell(r: number): number {
  const k = Math.floor(r);
  const x = r - k;
  return k + x - Math.sin(TAU * x) / TAU;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même ciel à chaque visite. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Point i sur n réparti uniformément sur la sphère unité (spirale de Fibonacci). */
export function fibonacciPoint(i: number, n: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
}

/** Matrice 3×3 (lignes) de R = Rx(pitch) · Rz(roll) · Ry(yaw). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function rotation(yaw: number, pitch: number, roll: number): Mat3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // Rz · Ry
  const a00 = cr * cy, a01 = -sr, a02 = cr * sy;
  const a10 = sr * cy, a11 = cr, a12 = sr * sy;
  const a20 = -sy, a21 = 0, a22 = cy;
  // Rx · (Rz · Ry)
  return [
    a00, a01, a02,
    cp * a10 - sp * a20, cp * a11 - sp * a21, cp * a12 - sp * a22,
    sp * a10 + cp * a20, sp * a11 + cp * a21, sp * a12 + cp * a22,
  ];
}

export function rotate(m: Mat3, x: number, y: number, z: number, out: Vec3): Vec3 {
  out.x = m[0] * x + m[1] * y + m[2] * z;
  out.y = m[3] * x + m[4] * y + m[5] * z;
  out.z = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** Angle de l'étoile i sur la ceinture (zodiaque Selio), identique sur tous les écrans. */
export const starAngle = (i: number) => (i * TAU) / 14;

/**
 * Angle de la carte i sur l'anneau qui entoure le lecteur.
 * Large : zigzag (rang haut / rang bas décalés d'un demi-pas).
 * Compact (mobile) : la paire est alignée verticalement, une carte au-dessus de l'autre.
 */
export const slotAngle = (i: number, compact: boolean) => (compact ? Math.floor(i / 2) * STEP_ANGLE : (i * TAU) / 14);

/** Rotation de l'anneau qui place la paire k face au lecteur. */
export const pairAngle = (k: number, compact: boolean) => (compact ? k * STEP_ANGLE : ((2 * k + 0.5) * TAU) / 14);

/** Indice de la paire visible pour une progression d'anneau r ∈ [0, STEPS - 1]. */
export const pairIndex = (r: number) => Math.max(0, Math.min(STEPS - 1, Math.round(r)));

/**
 * Distance caméra-centre qui donne à la sphère de rayon `radius` un rayon
 * apparent de `screenRadius` pixels avec la focale `focal`.
 */
export function distanceForRadius(radius: number, focal: number, screenRadius: number): number {
  const k = (focal * radius) / Math.max(1, screenRadius);
  return Math.sqrt(k * k + radius * radius);
}

/** Focale (px) : champ vertical de 56° plafonné par un champ horizontal de 74° (portrait). */
export function focalLength(width: number, height: number): number {
  return Math.min(height / 2 / Math.tan((28 * Math.PI) / 180), width / 2 / Math.tan((37 * Math.PI) / 180));
}
