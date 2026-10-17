import { afterEach, describe, expect, it } from "vitest";
import { buildDemoState } from "./seed";
import { DEMO_STORAGE_KEY, LocalDemoStorage, lightenDemoState } from "./state";

/** localStorage minimal avec un quota (en caractères), comme celui des navigateurs (~5 Mo). */
function quotaStorage(quota: number) {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const others = [...data].filter(([key]) => key !== k).reduce((n, [key, val]) => n + key.length + val.length, 0);
      if (others + k.length + v.length > quota) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
}

const photo = (id: string, chars: number) => ({ id, url: `data:image/jpeg;base64,${"A".repeat(chars)}`, alt: "", position: 0 });

describe("stockage local de la démo", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("garde les modifications quand les photos importées dépassent le quota du navigateur", () => {
    const base = buildDemoState(new Date("2026-10-08T12:00:00Z"));
    const baseSize = JSON.stringify(base).length;
    (globalThis as { localStorage?: unknown }).localStorage = quotaStorage(baseSize + 600_000);
    const storage = new LocalDemoStorage();
    const state = structuredClone(base);
    const target = state.items[0]!;
    target.title = "Article du générateur";
    // 8 photos d'environ 300 Ko (base64) : bien au-delà du quota restant.
    target.photos = Array.from({ length: 8 }, (_, i) => photo(`p${i}`, 300_000));
    storage.save(state);

    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    // Avant le correctif, l'enregistrement échouait en silence : la modification était perdue.
    expect(loaded!.items[0]!.title).toBe("Article du générateur");
    // La couverture est conservée, les autres photos importées sont retirées.
    expect(loaded!.items[0]!.photos.map((p) => p.id)).toEqual(["p0"]);
    expect(localStorage.getItem(DEMO_STORAGE_KEY)!.length).toBeLessThan(baseSize + 600_000);
  });

  it("n'allège jamais les photos du catalogue de la démo", () => {
    const base = buildDemoState(new Date("2026-10-08T12:00:00Z"));
    const light = lightenDemoState(base, false);
    expect(light.items.map((i) => i.photos.length)).toEqual(base.items.map((i) => i.photos.length));
  });
});
