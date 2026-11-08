import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import Product from "./Product";
import SelioOrBleam from "./SelioOrBleam";
import AlternativeBleam from "./AlternativeBleam";
import ExtensionPrivacy from "./ExtensionPrivacy";
import Extension from "./Extension";
import Legal from "./Legal";
import { PRODUCTS } from "../products";
import { COMPARISON_ROWS, ELIAS_PLACEHOLDER, UNSOURCED_PLACEHOLDER } from "../comparison";
import { COMPARISON_READY, INDEPENDENCE_NOTICE, LEGAL_DRAFT_NOTICE, findForbiddenClaims, seoPage } from "../seo";

function mockMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

function renderAt(path: string, routePath: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="/plateforme" element={<p>Page plateforme</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;
const description = () => document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content;
const jsonLd = () => Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')).flatMap((s) => [JSON.parse(s.textContent ?? "null")].flat());

describe("vitrine › pages des filiales", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  for (const product of PRODUCTS) {
    it(`${product.name} : promesse, ce qu'il fait, ce qu'il ne fait pas, prix « voir tarifs », indépendance, SEO`, () => {
      mockMotion();
      const { container } = renderAt(product.path, "/produits/:slug", <Product />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(product.promise);
      expect(screen.getByRole("heading", { level: 2, name: `Ce que fait ${product.name}` })).toBeTruthy();
      expect(screen.getByRole("heading", { level: 2, name: `Ce que ${product.name} ne fait pas` })).toBeTruthy();
      for (const f of product.does) expect(screen.getByRole("heading", { level: 3, name: f.title })).toBeTruthy();
      for (const n of product.doesNot) expect(screen.getByText(n)).toBeTruthy();
      expect(screen.getByText("Prix : voir les tarifs")).toBeTruthy();
      expect(screen.getAllByRole("link", { name: /Voir les tarifs/ }).map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/tarifs", product.pricingHref]));
      expect(screen.getByRole("link", { name: `Voir ${product.name} dans la démo` }).getAttribute("href")).toBe(`/demo?vers=${product.demoPath}`);
      expect(screen.getByText(product.state.label)).toBeTruthy();
      // Capture de la démonstration en clair et en sombre, décrite pour les lecteurs d'écran.
      expect(screen.getAllByAltText(product.shot.alt)).toHaveLength(2);
      expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
      // Les autres filiales sont reliées ; la page courante ne l'est pas.
      const others = within(screen.getByRole("heading", { name: "Les autres filiales" }).parentElement!);
      expect(others.getAllByRole("link")).toHaveLength(PRODUCTS.length - 1);
      // Référencement : titre, description, indexation, données structurées sans prix ni note.
      expect(document.title).toContain(product.name);
      expect(description()).toBe(seoPage(product.path).description);
      expect(robots()).toBe("index, follow");
      const app = jsonLd().find((d) => d["@type"] === "SoftwareApplication");
      expect(app.name).toBe(product.name);
      expect(app.url).toMatch(new RegExp(`${product.path}$`));
      expect(app.offers).toBeUndefined();
      expect(app.aggregateRating).toBeUndefined();
      expect(jsonLd().some((d) => d["@type"] === "BreadcrumbList")).toBe(true);
      expect(findForbiddenClaims(container.textContent ?? "")).toEqual([]);
    });
  }

  it("filiale inconnue : retour à la plateforme", () => {
    mockMotion();
    renderAt("/produits/inconnue", "/produits/:slug", <Product />);
    expect(screen.getByText("Page plateforme")).toBeTruthy();
  });
});

describe("vitrine › comparatifs Bleam (textes d'Elias attendus)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Selio ou Bleam ? : structure complète, emplacements marqués, chaque affirmation sur Bleam sourcée", () => {
    mockMotion();
    const { container } = renderAt("/selio-ou-bleam", "/selio-ou-bleam", <SelioOrBleam />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Selio ou Bleam ?");
    expect(container.querySelectorAll("[data-placeholder]").length).toBeGreaterThanOrEqual(5);
    expect(container.textContent).toContain(ELIAS_PLACEHOLDER);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(COMPARISON_ROWS.length);
    rows.forEach((row, i) => {
      const cells = within(row).getAllByRole("cell");
      const bleam = cells[1]!.textContent ?? "";
      if (COMPARISON_ROWS[i]!.bleam) expect(bleam).toMatch(/Source : .+, relevé du/);
      else expect(bleam).toBe(UNSOURCED_PLACEHOLDER);
    });
    for (const h of ["Ce que Selio fait différemment", "Passer de Bleam à Selio, sans donner vos identifiants", "Quand Bleam peut rester le bon choix", "Questions fréquentes", "Sources et méthode"]) expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    expect(container.textContent).toContain("Selio ne se connecte jamais à l'autre outil");
    expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
    if (!COMPARISON_READY) {
      expect(screen.getByText("Page en préparation")).toBeTruthy();
      expect(robots()).toBe("noindex, nofollow");
    }
    expect(findForbiddenClaims(container.textContent ?? "")).toEqual([]);
  });

  it("Alternative à Bleam : les filiales reliées, principes, migration, aucun comparatif non sourcé", () => {
    mockMotion();
    const { container } = renderAt("/alternative-bleam", "/alternative-bleam", <AlternativeBleam />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("alternative à Bleam");
    expect(container.textContent).toContain(ELIAS_PLACEHOLDER);
    for (const p of PRODUCTS) expect(screen.getByRole("link", { name: `En savoir plus sur ${p.name}` }).getAttribute("href")).toBe(p.path);
    expect(screen.getByRole("link", { name: /Selio ou Bleam/ }).getAttribute("href")).toBe("/selio-ou-bleam");
    expect(container.textContent).toContain("Aucun comparatif avec V-Tools ou Clemz n'est publié tant qu'il n'est pas sourcé");
    expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
    if (!COMPARISON_READY) expect(robots()).toBe("noindex, nofollow");
    expect(findForbiddenClaims(container.textContent ?? "")).toEqual([]);
  });
});

describe("vitrine › extension et pages légales", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("confidentialité de l'extension : version provisoire, ce qui est lu, envoyé et jamais collecté", () => {
    mockMotion();
    const { container } = renderAt("/extension/confidentialite", "/extension/confidentialite", <ExtensionPrivacy />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Confidentialité de l'extension Selio");
    expect(screen.getByRole("alert").textContent).toContain(LEGAL_DRAFT_NOTICE);
    for (const h of ["Ce que l'extension lit", "Ce qui est envoyé à Selio, et quand", "Ce que l'extension ne fait jamais"]) expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    expect(container.textContent).toContain("ne lit ni ne stocke votre mot de passe");
    expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
  });

  it("page Extension : pas encore publiée, lien vers la politique, indépendance", () => {
    mockMotion();
    renderAt("/extension", "/extension", <Extension />);
    expect(screen.getByText(/Pas encore publiée sur le Chrome Web Store/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Confidentialité de l'extension/ }).getAttribute("href")).toBe("/extension/confidentialite");
    expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
  });

  for (const path of ["/mentions-legales", "/confidentialite", "/conditions"]) {
    it(`${path} : version provisoire, définitive après l'avocat, mention d'indépendance, non indexée`, () => {
      mockMotion();
      const { container } = renderAt(path, path, <Legal />);
      expect(screen.getByRole("alert").textContent).toContain(LEGAL_DRAFT_NOTICE);
      expect(container.textContent).toContain(INDEPENDENCE_NOTICE);
      expect(robots()).toBe("noindex, nofollow");
    });
  }
});
