import { buildSearchUrl } from "@selio/connectors/vinted-adapter";
import { describe, expect, it } from "vitest";
import type { CloudLogger } from "../types";
import { RadarReader } from "./reader";
import type { FetchPageInput, FetchPageOutcome, PageFetcher } from "./types";

/**
 * Adaptateur v2 du catalogue : la première lecture réelle de Selio Track a rendu une page sans la grille du v1
 * (`page_changed`, 0 annonce). Ces pages sont SYNTHÉTIQUES (aucune page de Vinted n'est stockée ici) et
 * couvrent les formes possibles : liste JSON chargée par la page, cartes hors grille, liens décrits.
 */
const now = new Date("2026-11-27T10:00:00Z");
const url = buildSearchUrl({ keywords: ["levis 501"] });

function fetcher(outcome: Partial<Extract<FetchPageOutcome, { ok: true }>>): PageFetcher & { inputs: FetchPageInput[] } {
  const inputs: FetchPageInput[] = [];
  return {
    inputs,
    async fetchPage(input) {
      inputs.push(input);
      return { ok: true, html: "<html><body><main></main></body></html>", finalUrl: input.url, status: 200, durationMs: 5, ...outcome };
    },
  };
}

function logs() {
  const entries: { level: string; message: string; data?: Record<string, unknown> }[] = [];
  const logger: CloudLogger = { info: (message, data) => entries.push({ level: "info", message, data }), warn: (message, data) => entries.push({ level: "warn", message, data }) };
  return { entries, logger };
}

const apiPayload = JSON.stringify({
  items: [
    { id: 4821000001, title: "Jean Levi's 501 bleu", price: { amount: "25.0", currency_code: "EUR" }, brand_title: "Levi's", size_title: "W32", status: "Très bon état", url: "https://www.vinted.fr/items/4821000001-jean-levis-501", photo: { url: "https://images1.vinted.net/t/abc.jpeg", high_resolution: { timestamp: 1795773000 } }, user: { login: "vendeuse_test" } },
    { id: 4821000002, title: "Levi's 501 noir", price: "18.5", brand_title: "Levi's", size_title: "W30", status: "Bon état", path: "/items/4821000002-levis-501-noir" },
    { id: 4821000003, title: "Prix en dollars", price: { amount: "10", currency_code: "USD" } },
    { id: "pas-un-id", title: "Sans identifiant", price: "5" },
  ],
});

describe("RadarReader — adaptateur v2 du catalogue", () => {
  it("lit la liste d'annonces chargée par la page quand la grille v1 est absente", async () => {
    const { entries, logger } = logs();
    const f = fetcher({ catalogPayloads: [apiPayload] });
    const r = await new RadarReader({ fetcher: f, now: () => now, logger }).readSearch({ session: null, url, publicPage: true });
    expect(r).toMatchObject({ outcome: "ok", pageOk: true, seenCount: 2, adapterVersion: "vinted-catalog-v2" });
    expect(r.items[0]).toMatchObject({ externalRef: "4821000001", url: "https://www.vinted.fr/items/4821000001-jean-levis-501", priceCents: 2500, brand: "Levi's", size: "W32", condition: "very_good", photoUrl: "https://images1.vinted.net/t/abc.jpeg", publishedAtSource: "absolute" });
    expect(r.items[1]).toMatchObject({ externalRef: "4821000002", priceCents: 1850, condition: "good", publishedAt: null });
    expect(entries.map((e) => e.message)).toEqual(["radar.read.v2"]);
    // La grille v1 ET les repères v2 sont attendus avant la lecture.
    expect(f.inputs[0]!.waitForSelectors).toEqual(expect.arrayContaining(['[data-testid="catalog-grid"]', '[data-testid^="product-item-id-"]', 'a[href*="/items/"]']));
  });

  it("lit les cartes product-item-id où qu'elles soient dans la page", async () => {
    const html = `<html><body><div class="new-feed">
      <div data-testid="product-item-id-4821000010"><a data-testid="product-item-id-4821000010--overlay-link" href="/items/4821000010-pull" title="Pull marin, marque: Armor Lux, état: Très bon état, taille: M, 22,00 €, 23,80 € inclut la Protection acheteurs"></a>
        <p data-testid="product-item-id-4821000010--price-text">22,00 €</p><p data-testid="product-item-id-4821000010--description-title">Armor Lux</p></div>
    </div></body></html>`;
    const r = await new RadarReader({ fetcher: fetcher({ html }), now: () => now }).readSearch({ session: null, url, publicPage: true });
    expect(r).toMatchObject({ outcome: "ok", seenCount: 1, adapterVersion: "vinted-catalog-v2" });
    expect(r.items[0]).toMatchObject({ externalRef: "4821000010", priceCents: 2200, brand: "Armor Lux", title: "Pull marin" });
  });

  it("à défaut, lit les liens d'annonce décrits par leur intitulé (premier montant = prix de l'article)", async () => {
    const html = `<html><body><section>
      <a href="https://www.vinted.fr/items/4821000020-veste" title="Veste en jean, marque: Levi's, état: Bon état, taille: L, 30,00 €, 32,20 € inclut la Protection acheteurs"><img alt="Veste"></a>
      <a href="https://evil.example/items/4821000021" title="Hors Vinted, 5,00 €"></a>
    </section></body></html>`;
    const r = await new RadarReader({ fetcher: fetcher({ html }), now: () => now }).readSearch({ session: null, url, publicPage: true });
    expect(r.outcome).toBe("ok");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ externalRef: "4821000020", priceCents: 3000, brand: "Levi's", size: "L", condition: "good" });
  });

  it("toujours rien : page_changed, avec un diagnostic de STRUCTURE sans aucun texte de la page", async () => {
    const { entries, logger } = logs();
    const html = `<html><head><title>Résultats</title></head><body><div data-testid="search-header-123">Bonjour vendeuse_secrete 99,00 €</div></body></html>`;
    const r = await new RadarReader({ fetcher: fetcher({ html }), now: () => now, logger }).readSearch({ session: null, url, publicPage: true });
    expect(r.outcome).toBe("page_changed");
    const warn = entries.find((e) => e.message === "radar.read.page_changed")!;
    expect(warn.data).toMatchObject({ missing: "catalog-grid", productRoots: 0, itemLinks: 0, payloads: 0 });
    expect(String(warn.data!.testids)).toContain("search-header-#");
    // Aucun texte, pseudo ou prix de la page dans le journal.
    expect(JSON.stringify(warn.data)).not.toMatch(/vendeuse_secrete|99,00|Bonjour/);
  });

  it("une liste JSON illisible ou vide ne remplace pas la lecture du HTML", async () => {
    const r = await new RadarReader({ fetcher: fetcher({ catalogPayloads: ["pas du json", JSON.stringify({ items: [] })] }), now: () => now }).readSearch({ session: null, url, publicPage: true });
    expect(r.outcome).toBe("page_changed");
  });
});
