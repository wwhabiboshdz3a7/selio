import { describe, expect, it } from "vitest";
import { APP_PATH_PATTERN, HUB_PATH, SPACES, SPACE_GROUPS, spaceForPath } from "./spaces";

describe("Selio et ses filiales", () => {
  it("rattache chaque adresse à son espace, et laisse les pages communes à l'espace courant", () => {
    expect(spaceForPath("/app")).toBe("selio");
    expect(spaceForPath("/app/items/item-001")).toBe("selio");
    expect(spaceForPath("/app/automatisation/negociation")).toBe("selio");
    expect(spaceForPath(HUB_PATH)).toBe("hub");
    expect(spaceForPath("/studio")).toBe("studio");
    expect(spaceForPath("/studio/performances")).toBe("studio");
    expect(spaceForPath("/agents/marque-blanche")).toBe("agents");
    expect(spaceForPath("/track")).toBe("track");
    expect(spaceForPath("/cloud")).toBe("cloud");
    expect(spaceForPath("/generateur")).toBe("generateur");
    expect(spaceForPath("/studiox")).toBe("selio");
    expect(spaceForPath("/app/settings/access")).toBeNull();
    expect(spaceForPath("/admin/acces")).toBeNull();
  });

  it("présente les filiales avec un état honnête et un menu propre ; Selio Global n'est plus un espace", () => {
    expect(SPACES.map((s) => s.id)).toEqual(["selio", "studio", "agents", "track", "cloud", "generateur"]);
    expect(SPACES.some((s) => /Global/.test(s.name))).toBe(false);
    expect(SPACES.find((s) => s.id === "agents")!.state).toBe("preview");
    // Selio Cloud a ses vraies pages (aperçu : actions légères seulement) ; Track et le générateur restent en développement.
    expect(SPACES.find((s) => s.id === "cloud")!.state).toBe("preview");
    for (const id of ["track", "generateur"]) expect(SPACES.find((s) => s.id === id)!.state).toBe("development");
    expect(SPACE_GROUPS.cloud[0]!.items.map((i) => i.to)).toEqual(["/cloud", "/cloud/comptes", "/cloud/journal", "/cloud/accord", "/cloud/reglages"]);
    for (const path of ["/cloud/accord", "/cloud/comptes", "/cloud/journal", "/cloud/reglages"]) {
      expect(spaceForPath(path)).toBe("cloud");
      expect(APP_PATH_PATTERN.test(path)).toBe(true);
    }
    for (const area of ["hub", "studio", "agents", "track", "cloud", "generateur"] as const) {
      const links = SPACE_GROUPS[area].flatMap((g) => g.items.map((i) => i.to));
      expect(links).toContain("/app/settings");
      expect(new Set(links).size).toBe(links.length);
    }
  });

  it("n'accepte après connexion que des adresses internes des espaces", () => {
    expect(APP_PATH_PATTERN.test("/studio/annonces")).toBe(true);
    expect(APP_PATH_PATTERN.test("/agents/clients")).toBe(true);
    expect(APP_PATH_PATTERN.test("/app/espaces")).toBe(true);
    expect(APP_PATH_PATTERN.test("/global")).toBe(false);
    expect(APP_PATH_PATTERN.test("//exemple.com")).toBe(false);
    expect(APP_PATH_PATTERN.test("/admin")).toBe(false);
  });
});
