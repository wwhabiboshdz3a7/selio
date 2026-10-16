import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AvailabilityBadge, CtaBand, MarketingSection, NightSky } from "./components";

function mockMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("composants de la vitrine", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("bandeau d'appel : vrais liens vers l'inscription et la démo, ciel décoratif masqué", () => {
    mockMotion(true);
    const { container } = render(<MemoryRouter><CtaBand title="Essayez" lead="Sans compte." /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 2, name: "Essayez" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Créer un compte/ }).getAttribute("href")).toBe("/inscription");
    expect(screen.getByRole("link", { name: "Explorer la démo" }).getAttribute("href")).toBe("/demo");
    const sky = container.querySelector("svg.mk-sky");
    expect(sky?.getAttribute("aria-hidden")).toBe("true");
    expect(sky?.querySelectorAll(".mk-sky-star").length).toBeGreaterThan(40);
  });

  it("ciel : composition identique d'un rendu à l'autre (graine fixe)", () => {
    mockMotion(true);
    const a = render(<NightSky seed={11} />).container.innerHTML;
    cleanup();
    const b = render(<NightSky seed={11} />).container.innerHTML;
    expect(a).toBe(b);
    cleanup();
    const noLines = render(<NightSky seed={11} lines={false} />).container;
    expect(noLines.querySelectorAll(".mk-sky-line")).toHaveLength(0);
  });

  it("en-tête de page : un seul h1, sur-titre étoilé", () => {
    mockMotion(true);
    render(<MarketingSection level={1} eyebrow="Tarifs" title="Trois plans" lead="Indicatif." />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Tarifs").closest(".mk-eyebrow")).toBeTruthy();
  });

  it("badges d'état : libellés honnêtes, aucune teinte d'avertissement orange", () => {
    const { container } = render(
      <>
        <AvailabilityBadge value="available" />
        <AvailabilityBadge value="demo" />
        <AvailabilityBadge value="experimental" />
        <AvailabilityBadge value="planned" />
      </>,
    );
    expect(screen.getByText("Démontré en simulation")).toBeTruthy();
    expect(screen.getByText("Expérimental, à valider")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/warning|amber|orange/);
  });
});
