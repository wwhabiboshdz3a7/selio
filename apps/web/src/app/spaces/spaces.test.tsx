import { describe, expect, it } from "vitest";
import { APP_PATH_PATTERN, HUB_PATH, MANAGER_FEATURES, SPACES, SPACE_GROUPS, featureForPath, spaceForPath } from "./spaces";

describe("la gamme Selio", () => {
  it("rattache chaque adresse à son espace, et laisse les pages communes à l'espace courant", () => {
    expect(spaceForPath("/app")).toBe("selio");
    expect(spaceForPath("/app/items/item-001")).toBe("selio");
    expect(spaceForPath("/app/automatisation/negociation")).toBe("selio");
    expect(spaceForPath(HUB_PATH)).toBe("hub");
    expect(spaceForPath("/studio")).toBe("studio");
    expect(spaceForPath("/studio/performances")).toBe("studio");
    // Selio Cloud et Selio Agent : intégrés à Selio Manager (menu du Manager), pas des filiales.
    expect(spaceForPath("/agents/marque-blanche")).toBe("selio");
    expect(featureForPath("/agents/marque-blanche")).toBe("agents");
    expect(spaceForPath("/cloud")).toBe("selio");
    expect(featureForPath("/cloud")).toBe("cloud");
    expect(featureForPath("/cloudy")).toBeNull();
    expect(spaceForPath("/track")).toBe("track");
    expect(spaceForPath("/bot")).toBe("bot");
    expect(spaceForPath("/bot/achat-auto")).toBe("bot");
    // Les écrans historiques du radar appartiennent à Selio Bot (recherche et achat), adresses gardées.
    expect(spaceForPath("/app/radar")).toBe("bot");
    expect(spaceForPath("/app/radar/affaires/opp-1")).toBe("bot");
    expect(spaceForPath("/app/purchase")).toBe("bot");
    expect(spaceForPath("/app/auto-buy")).toBe("bot");
    expect(spaceForPath("/app/radarx")).toBe("selio");
    expect(spaceForPath("/botte")).toBe("selio");
    // Selio Compte (identifiant historique « generateur ») vit sous /comptes.
    expect(spaceForPath("/comptes")).toBe("generateur");
    expect(spaceForPath("/app/accounts")).toBe("selio");
    expect(spaceForPath("/studiox")).toBe("selio");
    expect(spaceForPath("/app/settings/access")).toBeNull();
    expect(spaceForPath("/admin/acces")).toBeNull();
  });

  it("présente les cinq filiales dans l'ordre officiel ; Cloud et Agent sont intégrés au Manager ; Selio Global n'est plus un espace", () => {
    // Ordre officiel : Manager, Studio, Track, Bot, Compte.
    expect(SPACES.map((s) => s.name)).toEqual(["Selio Manager", "Selio Studio", "Selio Track", "Selio Bot", "Selio Compte"]);
    expect(SPACES.map((s) => s.id)).toEqual(["selio", "studio", "track", "bot", "generateur"]);
    // « Selio » est la marque ; l'outil de gestion s'appelle Selio Manager (identifiant « selio » gardé).
    expect(SPACES[0]).toMatchObject({ id: "selio", name: "Selio Manager", short: "Manager", home: "/app" });
    expect(SPACES.every((s) => s.name.startsWith("Selio ") && s.name !== "Selio")).toBe(true);
    expect(SPACES.some((s) => /Global|Cloud|Agent/.test(s.name))).toBe(false);
    // Selio Bot : recherche et achat d'articles.
    expect(SPACES.find((s) => s.id === "bot")).toMatchObject({ name: "Selio Bot", home: "/bot", state: "available", tagline: "Recherche et achat d'articles" });
    expect(APP_PATH_PATTERN.test("/bot")).toBe(true);
    const botLinks = SPACE_GROUPS.bot.flatMap((g) => g.items.map((i) => i.to));
    expect(botLinks).toEqual(expect.arrayContaining(["/bot", "/app/radar", "/app/purchase", "/bot/achat-auto"]));
    // Plus aucune automatisation de compte dans le menu de Selio Bot.
    expect(botLinks.some((to) => /negociation|relance|reponse|republication|apres-vente/.test(to))).toBe(false);
    expect(SPACES.find((s) => s.id === "track")!.state).toBe("development");
    // Selio Compte : services liés aux comptes et accompagnement (identifiant historique « generateur »).
    const compte = SPACES.find((s) => s.id === "generateur")!;
    expect(compte).toMatchObject({ name: "Selio Compte", home: "/comptes", state: "available", tagline: "Services liés aux comptes et accompagnement" });
    expect(SPACE_GROUPS.generateur[0]!.items.map((i) => i.to)).toEqual(["/comptes"]);
    expect(APP_PATH_PATTERN.test("/comptes")).toBe(true);
    // Selio Cloud et Selio Agent (au singulier) : fonctionnalités intégrées, avec leurs pages en sous-menu.
    expect(MANAGER_FEATURES.map((f) => f.name)).toEqual(["Selio Cloud", "Selio Agent"]);
    expect(MANAGER_FEATURES[0]!.nav.map((i) => i.to)).toEqual(["/cloud", "/cloud/comptes", "/cloud/journal", "/cloud/accord", "/cloud/reglages"]);
    for (const path of ["/cloud/accord", "/cloud/comptes", "/cloud/journal", "/cloud/reglages"]) {
      expect(spaceForPath(path)).toBe("selio");
      expect(APP_PATH_PATTERN.test(path)).toBe(true);
    }
    expect(SPACE_GROUPS.hub.find((g) => g.title === "Intégrés à Selio Manager")!.items.map((i) => i.to)).toEqual(["/cloud", "/agents"]);
    for (const area of ["hub", "studio", "track", "bot", "generateur"] as const) {
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
