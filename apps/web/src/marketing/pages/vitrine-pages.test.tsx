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
import { PRODUCT_SHOTS } from "../productShots";
import Home from "./Home";
import Platform from "./Platform";
import Faq from "./Faq";
import { DataProvider } from "../../lib/data/provider";
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

describe("vitrine › pages de la gamme", () => {
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
      // Appel à l'essai de 14 jours (ou à la prestation pour Selio Comptes), jamais à la démonstration.
      if (product.slug === "comptes") expect(screen.getByRole("link", { name: "Demander une prestation" }).getAttribute("href")).toBe("/contact");
      else expect(screen.getByRole("link", { name: "Commencer l'essai gratuit de 14 jours" }).getAttribute("href")).toBe("/inscription");
      expect(container.querySelector('a[href^="/demo"]')).toBeNull();
      expect(container.textContent).not.toMatch(/démo/i);
      expect(screen.getByText(product.state.label)).toBeTruthy();
      // Capture en clair et en sombre, décrite pour les lecteurs d'écran (ou illustration, en attendant).
      if (PRODUCT_SHOTS[product.slug]) expect(screen.getAllByAltText(product.shot.alt)).toHaveLength(2);
      else expect(screen.getByRole("img", { name: `${product.name} : illustration, capture d'écran à venir` })).toBeTruthy();
      expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
      // Le reste de la gamme est relié ; la page courante ne l'est pas.
      const others = within(screen.getByRole("heading", { name: "Le reste de la gamme Selio" }).parentElement!);
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

  it("Selio Bot : sans prix séparé, inclus selon le forfait (Agence : Cloud inclus ; Starter et Pro : Cloud en option)", () => {
    mockMotion();
    renderAt("/produits/bot", "/produits/:slug", <Product />);
    expect(screen.getByText(/N'a pas de prix séparé/)).toBeTruthy();
    const note = screen.getByText(/Sans prix séparé\. Starter/);
    expect(note.textContent).toMatch(/Agence : relance automatique et Selio Cloud inclus/);
    expect(note.textContent).toMatch(/Pro : relance après 24 h proposée, Selio Cloud en option/);
  });

  it("Selio Cloud : le moteur de Selio Manager, de Selio Bot et des équipes Selio Agents", () => {
    mockMotion();
    renderAt("/produits/cloud", "/produits/:slug", <Product />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/24\sh\/24, ordinateur éteint/);
    expect(screen.getByText(/fait tourner Selio Manager, Selio Bot et les équipes de Selio Agents/)).toBeTruthy();
  });

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

describe("vitrine › accueil et plateforme", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPage(path: string, element: React.ReactNode) {
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
    return render(<DataProvider forceMode="demo"><MemoryRouter initialEntries={[path]}><Routes><Route path={path} element={element} /></Routes></MemoryRouter></DataProvider>);
  }

  it("accueil : le parcours de l'achat à l'étiquette, avec le sourcing auprès de fournisseurs partenaires (bientôt, sans nom)", () => {
    mockMotion();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = renderPage("/", <Home />);
    expect(screen.getByRole("heading", { level: 2, name: "De l'achat à l'étiquette, sans rien ressaisir" })).toBeTruthy();
    const steps = within(container.querySelector("#parcours ol")!).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(steps).toEqual(["Sourcing sur le marché", "Sourcing auprès de fournisseurs partenaires", "Achat", "Photos et annonce", "Vente et négociation", "Commande", "Étiquette et envoi", "Après-vente"]);
    expect(container.querySelector("#parcours")!.textContent).toMatch(/Aucun partenariat n'est encore signé/);
    // L'article suivi : une vraie photo d'annonce, à l'endroit.
    expect(within(container.querySelector("#parcours")!).getByRole("img").getAttribute("src")).toBe("/demo/photos/g-x4iv-1.webp");
    // La gamme, dans l'ordre, chaque carte vers sa page.
    const range = within(container.querySelector("#espaces")!).getAllByRole("article").map((a) => a.querySelector("h3")?.textContent);
    expect(range).toEqual(PRODUCTS.map((p) => p.name));
    expect(range[0]).toBe("Selio Manager");
    // Plus rien qui renvoie à la démonstration ; l'essai et la connexion à la place.
    expect(container.querySelector('a[href^="/demo"]')).toBeNull();
    expect(container.textContent).not.toMatch(/démo/i);
    expect(screen.getAllByRole("link", { name: /Commencer l'essai gratuit/ }).every((a) => a.getAttribute("href") === "/inscription")).toBe(true);
    expect(findForbiddenClaims(container.textContent ?? "")).toEqual([]);
  });

  it("FAQ de la vitrine : les questions sur la démonstration n'y figurent pas", () => {
    mockMotion();
    const { container } = renderPage("/faq", <Faq />);
    expect(container.querySelector("details#essai-decouverte")).toBeTruthy();
    for (const id of ["contenu-demo", "reinitialiser-demo", "demo-ou-connecte"]) expect(container.querySelector(`details#${id}`)).toBeNull();
    expect(container.querySelector('a[href^="/demo"]')).toBeNull();
    expect(screen.getByText(/Qu'est-ce que Selio Bot/)).toBeTruthy();
  });

  it("plateforme : toute la gamme, dans l'ordre, sans démonstration", () => {
    mockMotion();
    const { container } = renderPage("/plateforme", <Platform />);
    for (const p of PRODUCTS) expect(screen.getByRole("link", { name: `Découvrir ${p.name}` }).getAttribute("href")).toBe(p.path);
    expect(container.querySelector('a[href^="/demo"]')).toBeNull();
    expect(container.textContent).not.toMatch(/démo/i);
    expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
  });
});

describe("vitrine › /demo en production", () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock("../demoAccess");
    vi.resetModules();
  });

  it("avec une API configurée, /demo renvoie vers l'inscription", async () => {
    vi.resetModules();
    vi.doMock("../demoAccess", () => ({ demoEntryAllowed: () => false }));
    const router = await import("react-router");
    const { default: DemoEntry } = await import("./DemoEntry");
    render(
      <router.MemoryRouter initialEntries={["/demo?vers=/app"]}>
        <router.Routes>
          <router.Route path="/demo" element={<DemoEntry />} />
          <router.Route path="/inscription" element={<p>Page inscription</p>} />
        </router.Routes>
      </router.MemoryRouter>,
    );
    expect(await screen.findByText("Page inscription")).toBeTruthy();
  });
});
