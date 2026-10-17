import { describe, expect, it } from "vitest";
import { CONSTELLATION } from "./features";
import { STEPS, TAU, distanceForRadius, dwell, fibonacciPoint, focalLength, pairAngle, pairIndex, rotate, rotation, seeded, slotAngle, wrapPi } from "./geometry";

describe("géométrie de la constellation", () => {
  it("14 fonctionnalités, 7 paires, liens internes uniquement", () => {
    expect(CONSTELLATION).toHaveLength(14);
    expect(STEPS * 2).toBe(CONSTELLATION.length);
    for (const f of CONSTELLATION) expect(f.href.startsWith("/")).toBe(true);
    // L'or reste un rehaut : minorité d'étoiles dorées.
    expect(CONSTELLATION.filter((f) => f.tone === "gold").length).toBeLessThanOrEqual(4);
  });

  it("wrapPi ramène tout angle dans ]-π, π]", () => {
    for (const a of [-10, -Math.PI, 0, 1, Math.PI, 7, 100]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-9);
    }
  });

  it("dwell marque une pause sur chaque paire et reste monotone", () => {
    expect(dwell(0)).toBe(0);
    expect(dwell(3)).toBeCloseTo(3, 9);
    // Pente nulle autour des entiers : un peu de défilement ne bouge presque pas l'anneau.
    expect(dwell(2.05) - 2).toBeLessThan(0.002);
    let prev = -1;
    for (let r = 0; r <= STEPS - 1; r += 0.01) {
      const v = dwell(r);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it("la rotation est orthonormée", () => {
    const m = rotation(0.7, -0.3, 0.4);
    const out = { x: 0, y: 0, z: 0 };
    for (const p of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0.3, y: -0.4, z: 0.866 }]) {
      rotate(m, p.x, p.y, p.z, out);
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(Math.hypot(p.x, p.y, p.z), 9);
    }
  });

  it("chaque paire est centrée face au lecteur quand l'anneau s'y arrête", () => {
    for (const compact of [false, true]) {
      for (let k = 0; k < STEPS; k++) {
        const rho = pairAngle(k, compact);
        const a = wrapPi(slotAngle(2 * k, compact) - rho);
        const b = wrapPi(slotAngle(2 * k + 1, compact) - rho);
        expect(a + b).toBeCloseTo(0, 9);
        expect(Math.abs(a)).toBeLessThan(TAU / 14);
      }
    }
    expect(pairIndex(-1)).toBe(0);
    expect(pairIndex(2.6)).toBe(3);
    expect(pairIndex(99)).toBe(STEPS - 1);
  });

  it("distanceForRadius donne le rayon apparent demandé", () => {
    const f = focalLength(1440, 844);
    const d = distanceForRadius(1.2, f, 300);
    // Rayon apparent d'une sphère : f·R / √(d² − R²)
    expect((f * 1.2) / Math.sqrt(d * d - 1.44)).toBeCloseTo(300, 6);
  });

  it("ciel déterministe et points sur la sphère unité", () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    for (let i = 0; i < 50; i++) {
      const p = fibonacciPoint(i, 50);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    }
  });
});
