import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import * as ui from "../index";
import { GlassSurface } from "./GlassSurface";
import { useGlassCapabilities } from "../hooks/useGlassCapabilities";

const read = (relative: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relative), "utf8");
const HEX = /#[0-9a-fA-F]{3,8}\b/;

type Listener = () => void;

/** Simule le navigateur : CSS.supports, matchMedia (avec événements « change ») et Client Hints. */
function fakeBrowser({
  backdrop = true,
  urlFilters = false,
  chromium = false,
  media = [] as string[],
}: { backdrop?: boolean; urlFilters?: boolean; chromium?: boolean; media?: string[] } = {}) {
  const active = new Set(media);
  const listeners = new Set<Listener>();
  vi.stubGlobal("CSS", {
    supports: (property: string, value: string) => {
      if (value.startsWith("url(")) return urlFilters;
      if (property.includes("backdrop-filter")) return backdrop;
      if (value.startsWith("color-mix(")) return true;
      return false;
    },
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: active.has(query),
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }));
  Object.defineProperty(window.navigator, "userAgentData", {
    value: chromium ? { brands: [{ brand: "Chromium", version: "130" }] } : undefined,
    configurable: true,
  });
  return {
    listeners,
    set(query: string, on: boolean) {
      if (on) active.add(query);
      else active.delete(query);
      for (const l of [...listeners]) l();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, "userAgentData", {
    value: undefined,
    configurable: true,
  });
});

const surface = () => screen.getByTestId("verre");

describe("GlassSurface", () => {
  it("rend une surface opaque quand backdrop-filter n'est pas géré", () => {
    fakeBrowser({ backdrop: false });
    render(<GlassSurface data-testid="verre">Bonjour</GlassSurface>);
    expect(surface()).toHaveProperty("dataset.glass", "opaque");
    expect(surface().getAttribute("data-glass-fallback")).toBe("no-backdrop");
    expect(
      surface().querySelector(".glass-surface__content")?.getAttribute("data-glass-scrim"),
    ).toBe("off");
    expect(surface().querySelector("filter")).toBeNull();
  });

  it("passe en verre quand backdrop-filter est géré, avec les attributs data-glass", () => {
    fakeBrowser({ backdrop: true });
    render(
      <GlassSurface
        data-testid="verre"
        tone="dark"
        intensity="soft"
        className="p-3"
        contentClassName="flex"
      >
        <span>Affaire du jour</span>
      </GlassSurface>,
    );
    const el = surface();
    expect(el.className).toBe("glass-surface p-3");
    expect(el.getAttribute("data-glass")).toBe("glass");
    expect(el.getAttribute("data-glass-tone")).toBe("dark");
    expect(el.getAttribute("data-glass-intensity")).toBe("soft");
    expect(el.getAttribute("data-glass-motion")).toBe("on");
    expect(el.getAttribute("data-glass-refraction")).toBe("off");
    expect(el.hasAttribute("data-glass-fallback")).toBe(false);
    const content = el.querySelector(".glass-surface__content");
    expect(content?.className).toBe("glass-surface__content flex");
    expect(content?.getAttribute("data-glass-scrim")).toBe("on");
    expect(content?.textContent).toBe("Affaire du jour");
  });

  it("a des valeurs par défaut : ton auto, intensité normale, élément div", () => {
    fakeBrowser();
    render(<GlassSurface data-testid="verre">x</GlassSurface>);
    expect(surface().tagName).toBe("DIV");
    expect(surface().getAttribute("data-glass-tone")).toBe("auto");
    expect(surface().getAttribute("data-glass-intensity")).toBe("regular");
  });

  it("respecte la prop as et transmet les attributs (aria, rôle)", () => {
    fakeBrowser();
    render(
      <GlassSurface as="nav" aria-label="Navigation principale" data-testid="verre">
        <a href="/">Accueil</a>
      </GlassSurface>,
    );
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBe(surface());
  });

  it.each([
    ["(prefers-reduced-transparency: reduce)", "reduced-transparency"],
    ["(prefers-contrast: more)", "more-contrast"],
  ])("revient à l'opaque avec %s", (query, reason) => {
    fakeBrowser({ media: [query] });
    render(<GlassSurface data-testid="verre">x</GlassSurface>);
    expect(surface().getAttribute("data-glass")).toBe("opaque");
    expect(surface().getAttribute("data-glass-fallback")).toBe(reason);
  });

  it("coupe l'animation du reflet avec prefers-reduced-motion, sans couper le verre", () => {
    fakeBrowser({ media: ["(prefers-reduced-motion: reduce)"] });
    render(<GlassSurface data-testid="verre">x</GlassSurface>);
    expect(surface().getAttribute("data-glass")).toBe("glass");
    expect(surface().getAttribute("data-glass-motion")).toBe("off");
  });

  it("suit en direct un changement de préférence système", () => {
    const browser = fakeBrowser();
    render(<GlassSurface data-testid="verre">x</GlassSurface>);
    expect(surface().getAttribute("data-glass")).toBe("glass");
    act(() => browser.set("(prefers-reduced-transparency: reduce)", true));
    expect(surface().getAttribute("data-glass")).toBe("opaque");
    act(() => browser.set("(prefers-reduced-transparency: reduce)", false));
    expect(surface().getAttribute("data-glass")).toBe("glass");
  });

  it("force l'opaque avec la prop opaque (comparaison avant / après)", () => {
    fakeBrowser();
    render(
      <GlassSurface data-testid="verre" opaque>
        x
      </GlassSurface>,
    );
    expect(surface().getAttribute("data-glass")).toBe("opaque");
    expect(surface().getAttribute("data-glass-fallback")).toBe("forced");
  });

  it("n'ajoute la réfraction (feDisplacementMap) que sur Chromium avec filtres url() gérés", () => {
    fakeBrowser({ urlFilters: true, chromium: true });
    render(<GlassSurface data-testid="verre">x</GlassSurface>);
    const el = surface();
    expect(el.getAttribute("data-glass-refraction")).toBe("on");
    const filter = el.querySelector("filter");
    expect(filter).not.toBeNull();
    const turbulence = filter!.querySelector("feTurbulence");
    expect(turbulence).not.toBeNull();
    // Très basse fréquence : une ondulation large, pas un grain.
    for (const f of turbulence!.getAttribute("baseFrequency")!.split(" "))
      expect(Number(f)).toBeLessThan(0.02);
    expect(filter!.querySelector("feDisplacementMap")).not.toBeNull();
    const id = filter!.getAttribute("id")!;
    expect(id).toMatch(/^selio-glass-refraction-[\w-]+$/);
    expect(el.style.getPropertyValue("--_glass-refraction")).toBe(`url(#${id})`);
    expect(el.querySelector(".glass-surface__rim")).not.toBeNull();
  });

  it("n'ajoute pas de réfraction hors Chromium, ni quand la prop refraction est fausse", () => {
    fakeBrowser({ urlFilters: true, chromium: false });
    const { unmount } = render(<GlassSurface data-testid="verre">x</GlassSurface>);
    expect(surface().getAttribute("data-glass-refraction")).toBe("off");
    expect(surface().querySelector("filter")).toBeNull();
    unmount();
    fakeBrowser({ urlFilters: true, chromium: true });
    render(
      <GlassSurface data-testid="verre" refraction={false}>
        x
      </GlassSurface>,
    );
    expect(surface().getAttribute("data-glass-refraction")).toBe("off");
    expect(surface().querySelector("filter")).toBeNull();
  });

  it("donne des identifiants de filtre distincts à deux instances", () => {
    fakeBrowser({ urlFilters: true, chromium: true });
    render(
      <>
        <GlassSurface>a</GlassSurface>
        <GlassSurface>b</GlassSurface>
      </>,
    );
    const ids = [...document.querySelectorAll("filter")].map((f) => f.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("rend une surface opaque au rendu serveur (valeurs sûres)", () => {
    fakeBrowser();
    const html = renderToString(<GlassSurface>Serveur</GlassSurface>);
    expect(html).toContain('data-glass="opaque"');
    expect(html).toContain('data-glass-motion="off"');
    expect(html).not.toContain("<filter");
  });
});

describe("useGlassCapabilities", () => {
  it("renvoie les capacités du navigateur et garde la même référence tant que rien ne change", () => {
    fakeBrowser({ urlFilters: true, chromium: true, media: ["(prefers-contrast: more)"] });
    const { result, rerender } = renderHook(() => useGlassCapabilities());
    expect(result.current).toEqual({
      backdrop: true,
      reducedTransparency: false,
      reducedMotion: false,
      moreContrast: true,
      refraction: true,
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("se désabonne des requêtes média au démontage", () => {
    const browser = fakeBrowser();
    const { unmount } = renderHook(() => useGlassCapabilities());
    expect(browser.listeners.size).toBeGreaterThan(0);
    unmount();
    expect(browser.listeners.size).toBe(0);
  });
});

describe("fichiers du verre", () => {
  it("aucune couleur hexadécimale dans le composant, ses styles ni sa page d'exemple", () => {
    for (const file of [
      "./GlassSurface.tsx",
      "./GlassSurface.example.tsx",
      "../styles/glass.css",
      "../hooks/useGlassCapabilities.ts",
      "../lib/glass.ts",
    ]) {
      expect(read(file), file).not.toMatch(HEX);
    }
  });

  it("le composant n'utilise que des rôles et tokens (var(--…)) dans ses styles", () => {
    const css = read("../styles/glass.css");
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
    for (const role of [
      "var(--surface)",
      "var(--text)",
      "var(--border)",
      "var(--glass-bg)",
      "var(--glass-border)",
      "var(--glass-highlight)",
      "var(--glass-shadow)",
    ]) {
      expect(css, role).toContain(role);
    }
  });

  it("les replis sont écrits en CSS (@supports et media queries), pas seulement en JS", () => {
    const css = read("../styles/glass.css");
    expect(css).toMatch(
      /@supports \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/,
    );
    expect(css).toContain(
      "-webkit-backdrop-filter: blur(var(--_glass-blur)) saturate(var(--_glass-saturate));",
    );
    expect(css).toContain(
      "backdrop-filter: blur(var(--_glass-blur)) saturate(var(--_glass-saturate));",
    );
    expect(css).toContain("--_glass-blur: 18px;");
    expect(css).toContain("--_glass-saturate: 160%;");
    expect(css).toMatch(
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)/,
    );
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;/);
    expect(css).toMatch(/@supports \(backdrop-filter: url\(#selio-glass\)\)/);
    // Hors @supports, la surface par défaut est opaque (var(--surface) via --_glass-surface).
    const defaultRule = /\.glass-surface::before \{[\s\S]*?\}/.exec(css)?.[0] ?? "";
    expect(defaultRule).toContain("background-color: var(--_glass-surface);");
    expect(defaultRule).not.toContain("backdrop-filter");
  });

  it("base.css importe les styles du verre et le paquet les exporte", () => {
    expect(read("../styles/base.css")).toContain('@import "./glass.css";');
    expect(JSON.parse(read("../../package.json")).exports["./styles/glass.css"]).toBe(
      "./src/styles/glass.css",
    );
  });

  it("index.ts exporte le composant, le hook et les fonctions de contraste, pas la page d'exemple", () => {
    expect(ui.GlassSurface).toBe(GlassSurface);
    expect(ui.useGlassCapabilities).toBe(useGlassCapabilities);
    expect(typeof ui.contrastRatio).toBe("function");
    expect(typeof ui.scrimAlphaFor).toBe("function");
    expect(typeof ui.detectGlassCapabilities).toBe("function");
    expect(read("../index.ts")).not.toContain("GlassSurface.example");
    expect("GlassSurfaceExample" in ui).toBe(false);
  });
});

describe("GlassSurfaceExample (page d'exemple)", () => {
  it("se rend sans erreur, avec les fonds de test et la maquette du dock", async () => {
    fakeBrowser();
    const { GlassSurfaceExample } = await import("./GlassSurface.example");
    render(<GlassSurfaceExample />);
    expect(screen.getByRole("heading", { name: "Essai : verre liquide" })).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Navigation principale (exemple)" }),
    ).toBeTruthy();
    expect(document.querySelectorAll(".glass-surface").length).toBeGreaterThan(8);
  });
});
