/**
 * Gradient boosting d'arbres de régression, écrit à la main, sur le processeur, sans dépendance.
 *
 * - Variables discrétisées en histogrammes : au plus 64 classes par variable numérique (bornes aux
 *   quantiles de l'entraînement, ou valeurs exactes s'il y en a moins) ; les variables modales
 *   (`onehot`) gardent un code par modalité et chaque séparation isole une modalité contre toutes
 *   les autres, ce qui équivaut à une variable binaire par modalité (one-hot) sans en payer le coût.
 * - Perte quantile (pinball) pour τ donné : chaque arbre est ajusté aux pseudo-résidus (τ ou τ − 1,
 *   gain des moindres carrés), puis la valeur de chaque feuille est le τ-quantile des résidus de ses
 *   lignes (recherche linéaire, comme scikit-learn), multipliée par le taux d'apprentissage.
 * - Croissance en profondeur (4 à 6), effectif minimal par feuille, sous-échantillonnage des lignes
 *   à chaque arbre, soustraction d'histogrammes (le plus grand enfant = parent − le plus petit).
 * - Arrêt anticipé sur un jeu de validation : on garde les arbres jusqu'au meilleur score.
 * - Déterminisme : tout tirage passe par un générateur à graine (`createRng`), jamais Math.random.
 * - Sérialisation exacte : la prédiction parcourt les seuils bruts (x ≤ seuil, ou x = modalité),
 *   cohérents par construction avec les classes de l'entraînement ; les valeurs des feuilles sont
 *   arrondies pendant l'entraînement, et les sommes faites dans le même ordre. Une prédiction après
 *   `JSON.parse(JSON.stringify(modèle))` est identique au bit près.
 */
import type { FeatureSpec, SerializedGbm, SerializedTree } from "./types";

// ------------------------------------------------------------------ hasard à graine

/** Générateur pseudo-aléatoire à graine (mulberry32) : nombres dans [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tirage gaussien (Box-Muller) à partir d'un générateur à graine. */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------------ outils

/** τ-quantile (interpolation linéaire, type 7) d'un tableau trié. */
export function quantileSorted(sorted: ArrayLike<number>, tau: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * tau;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Perte quantile (pinball) moyenne. */
export function pinballLoss(y: ArrayLike<number>, pred: ArrayLike<number>, tau: number): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const d = y[i]! - pred[i]!;
    s += d >= 0 ? tau * d : (tau - 1) * d;
  }
  return y.length ? s / y.length : 0;
}

const roundLeaf = (v: number) => Math.round(v * 1e9) / 1e9;

// ------------------------------------------------------------------ données

/** Jeu de données en colonnes (une Float64Array par variable, même longueur). */
export interface GbmDataset {
  n: number;
  columns: Float64Array[];
}

export interface GbmOptions {
  features: FeatureSpec[];
  /** Quantile visé (0,25 ; 0,5 ; 0,75). */
  alpha: number;
  trees: number;
  learningRate: number;
  maxDepth: number;
  minLeaf: number;
  subsample: number;
  maxBins: number;
  earlyStoppingRounds: number;
  seed: number;
}

interface Binning {
  /** Bornes des classes des variables numériques (x ≤ bornes[b] ⇒ classe ≤ b) ; vide pour une variable modale. */
  edges: Float64Array[];
  /** Nombre de classes par variable. */
  nBins: Int32Array;
}

function buildBinning(X: GbmDataset, features: FeatureSpec[], maxBins: number): Binning {
  const F = features.length;
  const edges: Float64Array[] = [];
  const nBins = new Int32Array(F);
  for (let j = 0; j < F; j++) {
    const col = X.columns[j]!;
    if (features[j]!.kind === "onehot") {
      let max = -1;
      for (let i = 0; i < X.n; i++) {
        const c = col[i]!;
        if (!Number.isInteger(c) || c < 0) throw new Error(`Variable modale « ${features[j]!.name} » : code invalide ${c}`);
        if (c > max) max = c;
      }
      if (max + 1 > maxBins) throw new Error(`Variable modale « ${features[j]!.name} » : ${max + 1} modalités, ${maxBins} au plus`);
      edges.push(new Float64Array(0));
      nBins[j] = Math.max(1, max + 1);
      continue;
    }
    const sorted = Float64Array.from(col.subarray(0, X.n)).filter((v) => !Number.isNaN(v)).sort();
    const unique: number[] = [];
    for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) unique.push(sorted[i]!);
    let e: number[];
    if (unique.length <= maxBins) e = unique.slice(0, -1);
    else {
      e = [];
      for (let b = 1; b < maxBins; b++) {
        const v = sorted[Math.min(sorted.length - 1, Math.floor((b * sorted.length) / maxBins))]!;
        if (e.length === 0 || v > e[e.length - 1]!) e.push(v);
      }
      if (e.length > 0 && e[e.length - 1]! >= unique[unique.length - 1]!) e.pop();
    }
    edges.push(Float64Array.from(e));
    nBins[j] = e.length + 1;
  }
  return { edges, nBins };
}

/** Classe d'une valeur numérique : première borne ≥ x (NaN → dernière classe, comme x ≤ seuil faux). */
function binOf(edges: Float64Array, x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x <= edges[mid]!) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function binDataset(X: GbmDataset, features: FeatureSpec[], binning: Binning): Uint8Array {
  const F = features.length;
  const out = new Uint8Array(X.n * F);
  for (let j = 0; j < F; j++) {
    const col = X.columns[j]!;
    const onehot = features[j]!.kind === "onehot";
    const e = binning.edges[j]!;
    const nb = binning.nBins[j]!;
    for (let i = 0; i < X.n; i++) {
      const v = col[i]!;
      // Une modalité inconnue de l'entraînement (validation) reçoit une classe hors de toute séparation.
      out[i * F + j] = onehot ? (Number.isInteger(v) && v >= 0 && v < nb ? v : 255) : binOf(e, v);
    }
  }
  return out;
}

// ------------------------------------------------------------------ arbre

interface BuildTree {
  feature: number[];
  /** Classe de séparation (pendant l'entraînement). */
  bin: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

interface Ctx {
  F: number;
  B: number;
  bins: Uint8Array;
  grad: Float64Array;
  resid: Float64Array;
  binning: Binning;
  onehot: Uint8Array;
  opts: GbmOptions;
}

function histogram(ctx: Ctx, rows: Int32Array): { g: Float64Array; c: Float64Array } {
  const { F, B, bins, grad } = ctx;
  const g = new Float64Array(F * B);
  const c = new Float64Array(F * B);
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k]!;
    const gi = grad[i]!;
    const base = i * F;
    for (let j = 0; j < F; j++) {
      const idx = j * B + bins[base + j]!;
      g[idx]! += gi;
      c[idx]!++;
    }
  }
  return { g, c };
}

function bestSplit(ctx: Ctx, g: Float64Array, c: Float64Array, nRows: number): { j: number; b: number; gain: number } | null {
  const { F, B, binning, onehot, opts } = ctx;
  let G = 0;
  for (let b = 0; b < binning.nBins[0]!; b++) G += g[b]!;
  const parent = (G * G) / nRows;
  let best: { j: number; b: number; gain: number } | null = null;
  for (let j = 0; j < F; j++) {
    const nb = binning.nBins[j]!;
    if (nb < 2) continue;
    const off = j * B;
    if (onehot[j]) {
      for (let b = 0; b < nb; b++) {
        const nl = c[off + b]!;
        const nr = nRows - nl;
        if (nl < opts.minLeaf || nr < opts.minLeaf) continue;
        const gl = g[off + b]!;
        const gain = (gl * gl) / nl + ((G - gl) * (G - gl)) / nr - parent;
        if (gain > 1e-9 && (!best || gain > best.gain)) best = { j, b, gain };
      }
      continue;
    }
    let gl = 0;
    let nl = 0;
    for (let b = 0; b < nb - 1; b++) {
      gl += g[off + b]!;
      nl += c[off + b]!;
      if (nl < opts.minLeaf) continue;
      const nr = nRows - nl;
      if (nr < opts.minLeaf) break;
      const gain = (gl * gl) / nl + ((G - gl) * (G - gl)) / nr - parent;
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { j, b, gain };
    }
  }
  return best;
}

function leafValue(ctx: Ctx, rows: Int32Array): number {
  const r = new Float64Array(rows.length);
  for (let k = 0; k < rows.length; k++) r[k] = ctx.resid[rows[k]!]!;
  r.sort();
  return roundLeaf(ctx.opts.learningRate * quantileSorted(r, ctx.opts.alpha));
}

function growTree(ctx: Ctx, rows: Int32Array): BuildTree {
  const tree: BuildTree = { feature: [], bin: [], threshold: [], left: [], right: [], value: [] };
  const addLeaf = (v: number) => {
    tree.feature.push(-1);
    tree.bin.push(-1);
    tree.threshold.push(0);
    tree.left.push(-1);
    tree.right.push(-1);
    tree.value.push(v);
    return tree.feature.length - 1;
  };
  const grow = (nodeRows: Int32Array, depth: number, hist: { g: Float64Array; c: Float64Array }): number => {
    const split = depth < ctx.opts.maxDepth && nodeRows.length >= 2 * ctx.opts.minLeaf ? bestSplit(ctx, hist.g, hist.c, nodeRows.length) : null;
    if (!split) return addLeaf(leafValue(ctx, nodeRows));
    const { j, b } = split;
    const isOnehot = ctx.onehot[j] === 1;
    const goesLeft = (i: number) => {
      const v = ctx.bins[i * ctx.F + j]!;
      return isOnehot ? v === b : v <= b;
    };
    let nLeft = 0;
    for (let k = 0; k < nodeRows.length; k++) if (goesLeft(nodeRows[k]!)) nLeft++;
    const leftRows = new Int32Array(nLeft);
    const rightRows = new Int32Array(nodeRows.length - nLeft);
    for (let k = 0, l = 0, r = 0; k < nodeRows.length; k++) {
      const i = nodeRows[k]!;
      if (goesLeft(i)) leftRows[l++] = i;
      else rightRows[r++] = i;
    }
    const node = tree.feature.length;
    tree.feature.push(j);
    tree.bin.push(b);
    tree.threshold.push(isOnehot ? b : ctx.binning.edges[j]![b]!);
    tree.left.push(-1);
    tree.right.push(-1);
    tree.value.push(0);
    // Soustraction d'histogrammes : on ne compte que le plus petit enfant.
    const smallIsLeft = leftRows.length <= rightRows.length;
    const small = histogram(ctx, smallIsLeft ? leftRows : rightRows);
    const large = { g: new Float64Array(hist.g.length), c: new Float64Array(hist.c.length) };
    for (let k = 0; k < hist.g.length; k++) {
      large.g[k] = hist.g[k]! - small.g[k]!;
      large.c[k] = hist.c[k]! - small.c[k]!;
    }
    const leftHist = smallIsLeft ? small : large;
    const rightHist = smallIsLeft ? large : small;
    const l = grow(leftRows, depth + 1, leftHist);
    const r = grow(rightRows, depth + 1, rightHist);
    tree.left[node] = l;
    tree.right[node] = r;
    return node;
  };
  grow(rows, 0, histogram(ctx, rows));
  return tree;
}

/** Feuille atteinte par la ligne `i` d'un jeu discrétisé. */
function leafByBins(tree: BuildTree, bins: Uint8Array, F: number, onehot: Uint8Array, i: number): number {
  let n = 0;
  while (tree.feature[n]! !== -1) {
    const j = tree.feature[n]!;
    const v = bins[i * F + j]!;
    const left = onehot[j] ? v === tree.bin[n] : v <= tree.bin[n]!;
    n = left ? tree.left[n]! : tree.right[n]!;
  }
  return n;
}

// ------------------------------------------------------------------ entraînement

/**
 * Entraîne un ensemble d'arbres en perte quantile `alpha`. `valid` sert à l'arrêt anticipé
 * (sans lui, tous les arbres sont gardés). Les colonnes de `valid` suivent `options.features`.
 */
export function trainGbm(
  train: { X: GbmDataset; y: Float64Array },
  valid: { X: GbmDataset; y: Float64Array } | null,
  options: GbmOptions,
): SerializedGbm {
  const { features, alpha } = options;
  const F = features.length;
  const n = train.X.n;
  if (n === 0) throw new Error("Entraînement impossible : aucune ligne");
  if (train.X.columns.length !== F) throw new Error("Nombre de colonnes différent du nombre de variables");
  if (options.maxBins > 255 || options.maxBins < 2) throw new Error("maxBins doit être entre 2 et 255");
  const rng = createRng(options.seed);
  const binning = buildBinning(train.X, features, options.maxBins);
  const bins = binDataset(train.X, features, binning);
  const onehot = Uint8Array.from(features.map((f) => (f.kind === "onehot" ? 1 : 0)));
  const B = Math.max(...Array.from(binning.nBins), 1);

  const sortedY = Float64Array.from(train.y).sort();
  const base = roundLeaf(quantileSorted(sortedY, alpha));
  const pred = new Float64Array(n).fill(base);
  const grad = new Float64Array(n);
  const resid = new Float64Array(n);
  const ctx: Ctx = { F, B, bins, grad, resid, binning, onehot, opts: options };

  const useValid = valid !== null && valid.X.n > 0;
  const vBins = useValid ? binDataset(valid.X, features, binning) : null;
  const vPred = useValid ? new Float64Array(valid.X.n).fill(base) : null;

  const trees: BuildTree[] = [];
  let bestLoss = useValid ? pinballLoss(valid.y, vPred!, alpha) : Infinity;
  let bestIteration = 0;
  const all = new Int32Array(n);
  for (let i = 0; i < n; i++) all[i] = i;

  for (let t = 0; t < options.trees; t++) {
    for (let i = 0; i < n; i++) {
      const r = train.y[i]! - pred[i]!;
      resid[i] = r;
      grad[i] = r > 0 ? alpha : alpha - 1;
    }
    let rows = all;
    if (options.subsample < 1) {
      const picked: number[] = [];
      for (let i = 0; i < n; i++) if (rng() < options.subsample) picked.push(i);
      rows = picked.length >= 2 * options.minLeaf ? Int32Array.from(picked) : all;
    }
    const tree = growTree(ctx, rows);
    trees.push(tree);
    for (let i = 0; i < n; i++) pred[i]! += tree.value[leafByBins(tree, bins, F, onehot, i)]!;
    if (useValid) {
      for (let i = 0; i < valid.X.n; i++) vPred![i]! += tree.value[leafByBins(tree, vBins!, F, onehot, i)]!;
      const loss = pinballLoss(valid.y, vPred!, alpha);
      if (loss < bestLoss - 1e-12) {
        bestLoss = loss;
        bestIteration = t + 1;
      } else if (t + 1 - bestIteration >= options.earlyStoppingRounds) break;
    } else bestIteration = t + 1;
  }

  const kept = trees.slice(0, bestIteration);
  return {
    objective: { type: "quantile", alpha },
    base,
    learningRate: options.learningRate,
    trees: kept.map(({ feature, threshold, left, right, value }): SerializedTree => ({ feature, threshold, left, right, value })),
    bestIteration,
    triedIterations: trees.length,
    validationLoss: useValid ? bestLoss : null,
    features: features.map((f) => ({ ...f })),
  };
}

// ------------------------------------------------------------------ prédiction

/** Prédiction d'une ligne de variables brutes (même ordre que `model.features`). */
export function predictGbm(model: SerializedGbm, row: ArrayLike<number>): number {
  const onehot = model.features.map((f) => f.kind === "onehot");
  let s = model.base;
  for (const t of model.trees) {
    let n = 0;
    while (t.feature[n]! !== -1) {
      const j = t.feature[n]!;
      const x = row[j]!;
      const left = onehot[j] ? x === t.threshold[n] : x <= t.threshold[n]!;
      n = left ? t.left[n]! : t.right[n]!;
    }
    s += t.value[n]!;
  }
  return s;
}

/** Vérifie la forme d'un ensemble d'arbres rechargé (indices, longueurs, variables). */
export function validateGbm(model: SerializedGbm): void {
  if (!Array.isArray(model.trees) || !Array.isArray(model.features)) throw new Error("Modèle invalide : arbres ou variables absents");
  const F = model.features.length;
  if (!Number.isFinite(model.base)) throw new Error("Modèle invalide : score initial");
  for (const t of model.trees) {
    const m = t.feature.length;
    if (m === 0 || t.threshold.length !== m || t.left.length !== m || t.right.length !== m || t.value.length !== m) throw new Error("Modèle invalide : arbre mal formé");
    for (let k = 0; k < m; k++) {
      const f = t.feature[k]!;
      if (f === -1) {
        if (!Number.isFinite(t.value[k]!)) throw new Error("Modèle invalide : feuille");
        continue;
      }
      if (!Number.isInteger(f) || f < 0 || f >= F) throw new Error("Modèle invalide : variable");
      const l = t.left[k]!;
      const r = t.right[k]!;
      // Les enfants suivent toujours leur parent : aucun cycle possible.
      if (!(l > k && l < m && r > k && r < m)) throw new Error("Modèle invalide : enfants");
    }
  }
}
