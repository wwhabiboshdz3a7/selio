import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { DEFAULT_SHORTCUTS, type ActivityEntry } from "@selio/contracts";
import { DemoClient } from "./client";

/** Journal d'activité, raccourcis et « Articles et stock » en démonstration : mêmes règles que le serveur. */

let client: DemoClient;
const NOW = new Date("2026-11-16T10:00:00Z");
beforeEach(async () => {
  client = new DemoClient(new MemoryDemoStorage(), () => NOW);
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
});

const line = (e: ActivityEntry) => `${e.actor.name} ${e.summary}`;

describe("journal d'activité (démonstration)", () => {
  it("raconte les actions de l'équipe et de Selio, le plus récent d'abord, avec un lien vers l'objet", async () => {
    const item = await client.createItem({ title: "Veste journal", purchasePriceCents: 1500, listedPriceCents: 4000, status: "in_stock" });
    await client.updateItem(item.id, { listedPriceCents: 3800 });
    await client.setItemStatus(item.id, "listed");
    const page = await client.listActivity({ mode: "manual", limit: 100 });
    const mine = page.entries.filter((e) => e.itemTitle === "Veste journal");
    expect(mine.map(line)).toEqual([
      "Marie Lefèvre a mis « Veste journal » en vente",
      "Marie Lefèvre a changé le prix de « Veste journal » : 40,00 € → 38,00 €",
      "Marie Lefèvre a ajouté l'article « Veste journal »",
    ]);
    expect(mine[0]!.link).toBe(`/app/items/${item.id}`);
    expect((await client.listActivity({ limit: 5 })).nextCursor).not.toBeNull();
    // Le jeu de démonstration contient aussi des actions automatiques (Selio, Studio).
    const auto = await client.listActivity({ mode: "auto", limit: 100 });
    expect(auto.entries.length).toBeGreaterThan(0);
    expect(auto.entries.every((e) => e.automatic && e.actor.kind !== "member")).toBe(true);
    expect(auto.entries.some((e) => e.actor.name === "Studio" && /a rédigé l'annonce/.test(e.summary))).toBe(true);
  });

  it("pagination par curseur sans doublon ni oubli ; filtres par type et par personne", async () => {
    const all = (await client.listActivity({ limit: 100 })).entries.map((e) => e.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const p = await client.listActivity({ limit: 7, cursor });
      seen.push(...p.entries.map((e) => e.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice(0, all.length)).toEqual(all);
    const orders = await client.listActivity({ category: "orders", limit: 100 });
    expect(orders.entries.length).toBeGreaterThan(0);
    expect(orders.entries.every((e) => e.category === "orders")).toBe(true);
    const session = await client.getSession();
    const mine = await client.listActivity({ actor: session!.user.id, limit: 100 });
    expect(mine.entries.every((e) => e.actor.userId === session!.user.id)).toBe(true);
    await expect(client.listActivity({ cursor: "nimporte" })).rejects.toMatchObject({ status: 400 });
  });

  it("Selio Bot (recordDemoActivity) ; prix d'achat retiré pour l'exécuteur ; contributeur photos refusé", async () => {
    client.recordDemoActivity({ verb: "bot.purchase", itemTitle: "Sac Longchamp", purchaseCents: 1200 });
    client.recordDemoActivity({ verb: "bot.offer_sent", counterpart: "Léa", priceCents: 2000 });
    expect((await client.listActivity({ category: "bot" })).entries.map(line)).toEqual(["Selio Bot a envoyé une offre à Léa : 20,00 €", "Selio Bot a acheté « Sac Longchamp » pour 12,00 €"]);
    await client.previewRole!("operator");
    const exec = await client.listActivity({ category: "bot" });
    expect(exec.entries.map(line)).toEqual(["Selio Bot a envoyé une offre à Léa : 20,00 €", "Selio Bot a acheté « Sac Longchamp »"]);
    expect(exec.entries[1]!.purchaseCents).toBeNull();
    await client.previewRole!("photographer");
    await expect(client.listActivity({})).rejects.toMatchObject({ status: 403 });
    await client.previewRole!(null);
  });
});

describe("raccourcis personnalisés (démonstration)", () => {
  it("par défaut, enregistrés, retrouvés après rechargement, retour au défaut ; refus d'un doublon", async () => {
    const storage = new MemoryDemoStorage();
    const a = new DemoClient(storage, () => NOW);
    await a.login({ email: "marie@demo.selio.local", password: "demo" });
    expect(await a.getPreferences()).toEqual({ shortcuts: null });
    await a.updatePreferences({ shortcuts: ["journal", "studio"] });
    const b = new DemoClient(storage, () => NOW);
    expect((await b.getPreferences()).shortcuts).toEqual(["journal", "studio"]);
    await expect(b.updatePreferences({ shortcuts: ["studio", "studio"] })).rejects.toMatchObject({ status: 400 });
    expect((await b.updatePreferences({ shortcuts: null })).shortcuts).toBeNull();
    expect(DEFAULT_SHORTCUTS.slice(0, 3)).toEqual(["items", "messages", "radar"]);
  });
});

describe("Articles et stock (démonstration)", () => {
  it("compteurs, filtres rapides (sans photo, marge, compte) et actions groupées (prix, ajustement, republication)", async () => {
    const nophoto = await client.createItem({ title: "Pull sans photo", purchasePriceCents: 2000, listedPriceCents: 1500, floorPriceCents: 1400, status: "listed" });
    const s = await client.itemSummary();
    expect(s.withoutPhoto).toBeGreaterThanOrEqual(1);
    expect(s.stockValueCents).toBeGreaterThan(0);
    expect(s.listed).toBeGreaterThan(0);
    expect((await client.listItems({ photos: "none" })).items.map((i) => i.title)).toContain("Pull sans photo");
    const negative = await client.listItems({ margin: "negative", pageSize: 200 });
    expect(negative.items.map((i) => i.id)).toContain(nophoto.id);
    expect(negative.items.every((i) => (i.listedPriceCents ?? 0) < i.purchasePriceCents + i.purchaseFeesCents)).toBe(true);

    expect((await client.bulkItems({ ids: [nophoto.id], action: "adjust_price", priceRate: -0.1 })).affected).toBe(1);
    // 15,00 € − 10 % = 13,50 €, mais jamais sous le plancher (14,00 €).
    expect((await client.getItem(nophoto.id)).listedPriceCents).toBe(1400);
    await client.bulkItems({ ids: [nophoto.id], action: "set_price", listedPriceCents: 2500 });
    expect((await client.getItem(nophoto.id)).listedPriceCents).toBe(2500);
    await expect(client.bulkItems({ ids: [nophoto.id], action: "set_price" })).rejects.toMatchObject({ status: 400 });
    expect((await client.bulkItems({ ids: [nophoto.id], action: "republish" })).affected).toBe(1);
    expect((await client.getItem(nophoto.id)).republications).toHaveLength(1);

    await client.previewRole!("operator");
    expect((await client.itemSummary()).stockValueCents).toBeNull();
    // Filtre par marge ignoré sans « finances.read ».
    expect((await client.listItems({ margin: "negative", pageSize: 200 })).total).toBe((await client.listItems({ pageSize: 200 })).total);
    await client.previewRole!(null);
  });
});
