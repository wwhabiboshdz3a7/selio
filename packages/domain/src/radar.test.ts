import { describe, expect, it } from "vitest";
import { RADAR_ALERT_MIN_SCORE_DEFAULT, orgSettings, purchaseRequest, radarAlertPayload, radarCatalogItem, radarSearchCreate, type InventoryItem, type Order } from "@selio/contracts";
import { REVIEW_THRESHOLD } from "./buying";
import { comparableText, cosineSimilarity, describeEstimate, estimateResale, estimateResaleFromSimilar, nearestComparables, scoreOpportunity, titledComparablesFromSales } from "./radar";

describe("radar", () => {
  const comps = [
    { brand: "Nike", category: "shoes", condition: "good" as const, salePriceCents: 5000 },
    { brand: "Nike", category: "shoes", condition: "good" as const, salePriceCents: 6000 },
    { brand: "Nike", category: "shoes", condition: "very_good" as const, salePriceCents: 7000 },
  ];
  it("estime par médiane des comparables et annonce la méthode", () => {
    const e = estimateResale({ priceCents: 2000, brand: "nike", category: "shoes", condition: "very_good" }, comps);
    expect(e.resalePriceCents).toBe(6000);
    expect(e.confidence).toBe("high");
    expect(e.comparableCount).toBe(3);
  });
  it("se replie prudemment sans comparables", () => {
    const e = estimateResale({ priceCents: 2000, brand: "Inconnue", category: "bags", condition: null }, comps);
    expect(e.confidence).toBe("low");
    expect(e.comparableCount).toBe(0);
  });
  it("score expliqué, plafonné quand la marge est négative", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const good = scoreOpportunity({ priceCents: 2000, shippingCents: 300, seenAt: "2026-10-08T11:00:00Z" }, { resalePriceCents: 6000, confidence: "high", method: "", comparableCount: 3 }, { budgetCents: 5000, targetMarginCents: 2000, targetMarginRate: 0.4 }, 0, now);
    expect(good.score).toBeGreaterThan(70);
    expect(good.reasons.length).toBeGreaterThan(3);
    const bad = scoreOpportunity({ priceCents: 7000, shippingCents: 0, seenAt: "2026-10-01T11:00:00Z" }, { resalePriceCents: 6000, confidence: "low", method: "", comparableCount: 0 }, { budgetCents: 5000, targetMarginCents: 2000, targetMarginRate: 0.4 }, 0, now);
    expect(bad.score).toBeLessThanOrEqual(10);
  });
});

describe("comparables par similarité (modèle 2)", () => {
  const pool = [
    { ref: "o1", vector: [1, 0, 0], comparable: { brand: "Ralph Lauren", category: "men", condition: "very_good" as const, salePriceCents: 4000 } },
    { ref: "o2", vector: [0.95, 0.05, 0], comparable: { brand: "Ralph Lauren", category: "men", condition: "good" as const, salePriceCents: 5000 } },
    { ref: "o3", vector: [0.9, 0.1, 0], comparable: { brand: "Ralph Lauren", category: "men", condition: "good" as const, salePriceCents: 6000 } },
    { ref: "o4", vector: [0, 1, 0], comparable: { brand: "Levi's", category: "men", condition: "good" as const, salePriceCents: 9000 } },
    { ref: "o5", vector: [0, 0, 0], comparable: { brand: null, category: null, condition: null, salePriceCents: 100 } },
  ];

  it("similarité cosinus : identique 1, orthogonale 0, tailles différentes ou vecteur nul 0", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([Number.NaN, 1], [1, 1])).toBe(0);
  });

  it("garde les k plus proches au-dessus du seuil, du plus proche au moins proche", () => {
    const near = nearestComparables([1, 0, 0], pool, { k: 8, minSimilarity: 0.6 });
    expect(near.map((n) => n.ref)).toEqual(["o1", "o2", "o3"]);
    expect(nearestComparables([1, 0, 0], pool, { k: 2 }).map((n) => n.ref)).toEqual(["o1", "o2"]);
    expect(nearestComparables([0, 0, 1], pool)).toEqual([]);
  });

  it("estime par la médiane des ventes proches, méthode « embeddings », sinon null (repli marque et catégorie)", () => {
    const near = nearestComparables([1, 0, 0], pool);
    const e = estimateResaleFromSimilar({ condition: "very_good" }, near)!;
    expect(e).toEqual({ resalePriceCents: 5000, confidence: "medium", method: "embeddings", comparableCount: 3 });
    expect(estimateResaleFromSimilar({ condition: null }, near.slice(0, 1))).toBeNull();
    expect(describeEstimate(e)).toMatch(/3 vente\(s\) proche\(s\)/);
    expect(describeEstimate({ method: "brand_category", comparableCount: 0 })).toMatch(/×1,6/);
  });

  it("texte vectorisé : marque ajoutée seulement si le titre ne la contient pas ; ventes annulées écartées", () => {
    expect(comparableText("Pull Ralph Lauren M", "Ralph Lauren")).toBe("Pull Ralph Lauren M");
    expect(comparableText("Pull torsadé  bleu", "Ralph Lauren")).toBe("Ralph Lauren Pull torsadé bleu");
    const item = (id: string, title: string) => ({ id, title, brand: "Nike", category: "shoes", condition: "good" }) as unknown as InventoryItem;
    const order = (id: string, itemId: string, status: string, createdAt: string) => ({ id, itemId, status, salePriceCents: 3000, createdAt }) as unknown as Order;
    const items = new Map([["i1", item("i1", "Air Max 90")], ["i2", item("i2", "Air Force 1")]]);
    const out = titledComparablesFromSales([order("a", "i1", "completed", "2026-10-01T10:00:00Z"), order("b", "i2", "cancelled", "2026-10-02T10:00:00Z"), order("c", "i2", "paid", "2026-10-03T10:00:00Z")], items);
    expect(out.map((c) => [c.ref, c.text])).toEqual([["c", "Nike Air Force 1"], ["a", "Nike Air Max 90"]]);
  });

  it("le seuil d'alerte par défaut des réglages Radar est le seuil « À valider »", () => {
    expect(RADAR_ALERT_MIN_SCORE_DEFAULT).toBe(REVIEW_THRESHOLD);
    expect(orgSettings.parse({}).radar).toEqual({ alertsEnabled: true, alertMinScore: REVIEW_THRESHOLD, quietHours: null, maxPagesPerMinute: 10 });
    expect(orgSettings.parse({}).autoBuy).toMatchObject({ enabled: false, maxItemCents: 6000 });
    expect(orgSettings.parse({}).autoBuy.enabledAt ?? null).toBeNull();
  });

  it("contrats : recherche en direct, champs de lecture fixés par le serveur, statut 3-D Secure", () => {
    const created = radarSearchCreate.parse({ name: "Pulls", source: "cloud", priority: true, slowdownFactor: 8, pagesRead: 99 });
    expect(created).toMatchObject({ source: "cloud", priority: true, connectionId: null });
    expect(created).not.toHaveProperty("slowdownFactor");
    expect(created).not.toHaveProperty("pagesRead");
    expect(radarSearchCreate.parse({ name: "Démo" }).source).toBe("demo");
    expect(purchaseRequest.shape.status.safeParse("awaiting_3ds").success).toBe(true);
    expect(radarCatalogItem.safeParse({ title: "Pull", priceCents: 1200, externalRef: "123456" }).success).toBe(true);
    expect(radarCatalogItem.safeParse({ title: "Pull", priceCents: 1200, externalRef: "javascript:1" }).success).toBe(false);
    expect(radarAlertPayload.safeParse({ title: "t", body: "b", url: "https://evil.example" }).success).toBe(false);
  });
});
