import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ConstellationHero } from "./ConstellationHero";
import { CONSTELLATION } from "./features";
import { MODULES } from "../catalog";

function mockMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("ConstellationHero", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("expose les 14 fonctionnalités en vrais liens, hors du canevas décoratif", () => {
    mockMotion(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(<MemoryRouter><ConstellationHero /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Vos articles, vos conversations et votre marge");
    const list = screen.getByRole("list", { name: "Quatorze modules, reliés entre eux" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(CONSTELLATION.length);
    CONSTELLATION.forEach((f, i) => expect(links[i]?.getAttribute("href")).toBe(f.href));
    // Nom accessible court : le titre ; l'état et le résumé en description.
    expect(links[0]?.getAttribute("aria-labelledby")).toBe(`cst-t-${CONSTELLATION[0]?.id}`);
    expect(within(list).getByRole("link", { name: CONSTELLATION[0]?.title })).toBeTruthy();
    for (const c of Array.from(container.querySelectorAll("canvas"))) expect(c.getAttribute("aria-hidden")).toBe("true");
    // Aucun bouton imbriqué dans un lien.
    expect(container.querySelectorAll("a button")).toHaveLength(0);
    for (const a of screen.getAllByRole("link", { name: /Créer un compte/ })) expect(a.getAttribute("href")).toBe("/inscription");
    for (const a of screen.getAllByRole("link", { name: "Explorer la démo" })) expect(a.getAttribute("href")).toBe("/demo");
    // Quinzième carte : la fin de la visite porte les deux actions.
    expect(screen.getByRole("heading", { level: 3, name: "Votre constellation commence ici" })).toBeTruthy();
  });

  it("mouvement réduit : composition fixe, texte visible d'emblée", () => {
    mockMotion(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(<MemoryRouter><ConstellationHero /></MemoryRouter>);
    const root = container.querySelector(".cst-root");
    expect(root?.getAttribute("data-mode")).toBe("static");
    expect(root?.getAttribute("data-intro")).toBe("done");
    expect(screen.queryByText("Passer la visite des fonctionnalités")).toBeNull();
    expect(root?.getAttribute("data-text")).toBe("still");
  });

  it("mouvement autorisé : visite au défilement avec lien d'évitement", () => {
    mockMotion(false);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(<MemoryRouter><ConstellationHero /></MemoryRouter>);
    expect(container.querySelector(".cst-root")?.getAttribute("data-mode")).toBe("live");
    // Lien d'évitement clavier hors du HUD (visible au focus), vers la section suivante.
    expect(screen.getByRole("link", { name: "Passer la visite des fonctionnalités" }).getAttribute("href")).toBe("#application");
    // Le doublon du HUD (souris) n'est ni tabulable ni annoncé.
    const hudSkip = container.querySelector(".cst-skip");
    expect(hudSkip?.getAttribute("tabindex")).toBe("-1");
    expect(hudSkip?.getAttribute("aria-hidden")).toBe("true");
  });

  it("mêmes quatorze modules que la page Fonctionnalités (source unique)", () => {
    expect(CONSTELLATION.map((f) => f.id)).toEqual(MODULES.map((m) => m.id));
    expect(CONSTELLATION.map((f) => f.title)).toEqual(MODULES.map((m) => m.title));
    expect(CONSTELLATION.map((f) => f.status)).toEqual(MODULES.map((m) => m.status));
  });
});
