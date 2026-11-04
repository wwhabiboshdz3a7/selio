import { createRng, gaussian, pinballLoss, predictGbm, quantileSorted, trainGbm, validateGbm, type GbmDataset, type GbmOptions } from "./gbm";
import type { FeatureSpec } from "./types";

const FEATURES: FeatureSpec[] = [
  { name: "x", kind: "numeric" },
  { name: "colour", kind: "onehot" },
  { name: "noise", kind: "numeric" },
];

/** y = 2·1[x > 0,5] + 1[couleur = 2] + bruit gaussien σ = 0,3. */
function makeData(n: number, seed: number): { X: GbmDataset; y: Float64Array; rows: number[][] } {
  const rng = createRng(seed);
  const cols = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const y = new Float64Array(n);
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = rng();
    const c = Math.floor(rng() * 4);
    const z = rng();
    cols[0]![i] = x;
    cols[1]![i] = c;
    cols[2]![i] = z;
    y[i] = 2 * (x > 0.5 ? 1 : 0) + (c === 2 ? 1 : 0) + gaussian(rng) * 0.3;
    rows.push([x, c, z]);
  }
  return { X: { n, columns: cols }, y, rows };
}

const OPTS: Omit<GbmOptions, "alpha" | "seed"> = { features: FEATURES, trees: 150, learningRate: 0.05, maxDepth: 4, minLeaf: 20, subsample: 0.8, maxBins: 64, earlyStoppingRounds: 30 };

describe("hasard à graine", () => {
  it("est reproductible et dans [0, 1)", () => {
    const a = createRng(123);
    const b = createRng(123);
    const sa = Array.from({ length: 1000 }, () => a());
    expect(sa).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...sa)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...sa)).toBeLessThan(1);
    expect(createRng(124)()).not.toBe(createRng(123)());
  });
});

describe("outils", () => {
  it("quantile interpolé et perte pinball", () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(quantileSorted([7], 0.9)).toBe(7);
    expect(pinballLoss([10], [8], 0.75)).toBeCloseTo(1.5);
    expect(pinballLoss([10], [12], 0.75)).toBeCloseTo(0.5);
  });
});

describe("trainGbm", () => {
  const train = makeData(4000, 1);
  const valid = makeData(1000, 2);
  const test = makeData(2000, 3);

  it("apprend une marche numérique et une modalité (one-hot)", () => {
    const m = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.5, seed: 9 });
    expect(predictGbm(m, [0.9, 2, 0.5])).toBeCloseTo(3, 0);
    expect(predictGbm(m, [0.1, 0, 0.5])).toBeCloseTo(0, 0);
    expect(predictGbm(m, [0.9, 1, 0.5])).toBeCloseTo(2, 0);
    // Une modalité jamais vue part du côté « autre ».
    expect(predictGbm(m, [0.9, 17, 0.5])).toBeCloseTo(2, 0);
    let err = 0;
    for (let i = 0; i < test.X.n; i++) err += Math.abs(predictGbm(m, test.rows[i]!) - (2 * (test.rows[i]![0]! > 0.5 ? 1 : 0) + (test.rows[i]![1] === 2 ? 1 : 0)));
    expect(err / test.X.n).toBeLessThan(0.15);
  });

  it("perte quantile : environ 25 % et 75 % des valeurs sous P25 et P75", () => {
    const q25 = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.25, seed: 1 });
    const q75 = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.75, seed: 2 });
    let below25 = 0;
    let below75 = 0;
    for (let i = 0; i < test.X.n; i++) {
      if (test.y[i]! <= predictGbm(q25, test.rows[i]!)) below25++;
      if (test.y[i]! <= predictGbm(q75, test.rows[i]!)) below75++;
    }
    expect(below25 / test.X.n).toBeGreaterThan(0.18);
    expect(below25 / test.X.n).toBeLessThan(0.32);
    expect(below75 / test.X.n).toBeGreaterThan(0.68);
    expect(below75 / test.X.n).toBeLessThan(0.82);
  });

  it("au plus 64 classes par variable numérique, et la profondeur demandée", () => {
    const m = trainGbm({ X: train.X, y: train.y }, null, { ...OPTS, alpha: 0.5, seed: 3, trees: 20, maxDepth: 5 });
    const thresholds = new Set<number>();
    for (const t of m.trees) {
      t.feature.forEach((f, k) => {
        if (f === 0) thresholds.add(t.threshold[k]!);
      });
      // profondeur ≤ 5 : au plus 2^6 − 1 nœuds
      expect(t.feature.length).toBeLessThanOrEqual(63);
    }
    expect(thresholds.size).toBeLessThanOrEqual(63);
    expect(m.trees).toHaveLength(20);
    expect(m.validationLoss).toBeNull();
  });

  it("déterministe à graine égale, différent à graine différente", () => {
    const a = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.5, seed: 5, trees: 40 });
    const b = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.5, seed: 5, trees: 40 });
    const c = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.5, seed: 6, trees: 40 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("sérialisation JSON exacte : prédictions identiques au bit près après rechargement", () => {
    const m = trainGbm({ X: train.X, y: train.y }, { X: valid.X, y: valid.y }, { ...OPTS, alpha: 0.75, seed: 8 });
    const reloaded = JSON.parse(JSON.stringify(m)) as typeof m;
    validateGbm(reloaded);
    for (let i = 0; i < 500; i++) expect(predictGbm(reloaded, test.rows[i]!)).toBe(predictGbm(m, test.rows[i]!));
  });

  it("arrêt anticipé : sur une cible de pur bruit, peu d'arbres sont gardés", () => {
    const rng = createRng(77);
    const yNoise = Float64Array.from({ length: train.X.n }, () => gaussian(rng));
    const vNoise = Float64Array.from({ length: valid.X.n }, () => gaussian(rng));
    const m = trainGbm({ X: train.X, y: yNoise }, { X: valid.X, y: vNoise }, { ...OPTS, alpha: 0.5, seed: 4, trees: 400, earlyStoppingRounds: 20 });
    expect(m.triedIterations).toBeLessThan(400);
    expect(m.trees.length).toBe(m.bestIteration);
    expect(m.bestIteration).toBeLessThan(m.triedIterations);
  });

  it("refuse un code modal invalide et un modèle mal formé", () => {
    const bad = makeData(100, 4);
    bad.X.columns[1]![0] = 1.5;
    expect(() => trainGbm({ X: bad.X, y: bad.y }, null, { ...OPTS, alpha: 0.5, seed: 1 })).toThrow(/code invalide/);
    const m = trainGbm({ X: train.X, y: train.y }, null, { ...OPTS, alpha: 0.5, seed: 1, trees: 5 });
    const broken = JSON.parse(JSON.stringify(m)) as typeof m;
    const t = broken.trees.find((tr) => tr.feature.length > 1)!;
    t.left[0] = 0; // cycle
    expect(() => validateGbm(broken)).toThrow(/enfants/);
  });
});
