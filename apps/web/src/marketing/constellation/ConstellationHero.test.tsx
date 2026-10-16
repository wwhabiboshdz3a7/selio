import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ConstellationHero } from "./ConstellationHero";
import { CONSTELLATION } from "./features";

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
    const list = screen.getByRole("list", { name: "Quatorze fonctionnalités, reliées entre elles" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(CONSTELLATION.length);
    CONSTELLATION.forEach((f, i) => expect(links[i]?.getAttribute("href")).toBe(f.href));
    expect(container.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("link", { name: /Créer un compte/ }).getAttribute("href")).toBe("/inscription");
    expect(screen.getByRole("link", { name: "Explorer la démo" }).getAttribute("href")).toBe("/demo");
  });

  it("mouvement réduit : composition fixe, texte visible d'emblée", () => {
    mockMotion(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(<MemoryRouter><ConstellationHero /></MemoryRouter>);
    const root = container.querySelector(".cst-root");
    expect(root?.getAttribute("data-mode")).toBe("static");
    expect(root?.getAttribute("data-intro")).toBe("done");
    expect(screen.queryByText("Passer la visite")).toBeNull();
  });

  it("mouvement autorisé : visite au défilement avec lien d'évitement", () => {
    mockMotion(false);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(<MemoryRouter><ConstellationHero /></MemoryRouter>);
    expect(container.querySelector(".cst-root")?.getAttribute("data-mode")).toBe("live");
    expect(screen.getByRole("link", { name: "Passer la visite" }).getAttribute("href")).toBe("#parcours");
  });
});
