import { describe, expect, it } from "vitest";
import { APP_PATH_PATTERN, HUB_PATH, SPACES, SPACE_GROUPS, spaceForPath } from "./spaces";
import { MARKETPLACES, MARKETS, SIZE_CHARTS, convertSize } from "./global-data";

describe("espaces Selio", () => {
  it("rattache chaque adresse à son espace, et laisse les pages communes à l'espace courant", () => {
    expect(spaceForPath("/app")).toBe("selio");
    expect(spaceForPath("/app/items/item-001")).toBe("selio");
    expect(spaceForPath(HUB_PATH)).toBe("hub");
    expect(spaceForPath("/studio")).toBe("studio");
    expect(spaceForPath("/studio/performances")).toBe("studio");
    expect(spaceForPath("/agence/marque-blanche")).toBe("agence");
    expect(spaceForPath("/global/tailles")).toBe("global");
    expect(spaceForPath("/studiox")).toBe("selio");
    expect(spaceForPath("/app/settings/access")).toBeNull();
    expect(spaceForPath("/admin")).toBeNull();
  });

  it("présente quatre espaces avec un état honnête et un menu propre", () => {
    expect(SPACES.map((s) => s.id)).toEqual(["selio", "studio", "agence", "global"]);
    expect(SPACES.find((s) => s.id === "agence")!.state).toBe("preview");
    expect(SPACES.find((s) => s.id === "global")!.state).toBe("planned");
    for (const area of ["hub", "studio", "agence", "global"] as const) {
      const links = SPACE_GROUPS[area].flatMap((g) => g.items.map((i) => i.to));
      expect(links).toContain("/app/settings");
      expect(new Set(links).size).toBe(links.length);
    }
  });

  it("n'accepte après connexion que des adresses internes des espaces", () => {
    expect(APP_PATH_PATTERN.test("/studio/annonces")).toBe(true);
    expect(APP_PATH_PATTERN.test("/app/espaces")).toBe(true);
    expect(APP_PATH_PATTERN.test("//exemple.com")).toBe(false);
    expect(APP_PATH_PATTERN.test("/admin")).toBe(false);
  });
});

describe("Selio Global", () => {
  it("convertit une taille d'un système à l'autre", () => {
    const women = SIZE_CHARTS.find((c) => c.id === "women")!;
    expect(convertSize(women, "FR", "38")).toMatchObject({ UK: "10", US: "6", IT: "42", DE: "36" });
    expect(convertSize(women, "UK", "14")?.FR).toBe("42");
    expect(convertSize(women, "FR", "39")).toBeNull();
    // Chaque ligne renseigne tous les systèmes de sa table.
    for (const chart of SIZE_CHARTS) for (const row of chart.rows) for (const s of chart.systems) expect(row[s.key]).toBeTruthy();
  });

  it("n'ouvre que la France et Vinted ; le reste est en préparation, dans l'ordre annoncé", () => {
    expect(MARKETS.filter((m) => m.state === "available").map((m) => m.code)).toEqual(["FR"]);
    expect(MARKETPLACES.map((m) => m.id)).toEqual(["vinted", "leboncoin", "ebay", "etsy", "shopify"]);
    expect(MARKETPLACES.filter((m) => m.state === "active").map((m) => m.id)).toEqual(["vinted"]);
  });
});
