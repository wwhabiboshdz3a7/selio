import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import Product from "./Product";
import SelioOrBleam from "./SelioOrBleam";
import AlternativeBleam from "./AlternativeBleam";
import ExtensionPrivacy from "./ExtensionPrivacy";
import Extension from "./Extension";
import Legal from "./Legal";
import Contact from "./Contact";
import { MANAGER_BOT_DISTINCTION, MANAGER_FEATURES, MANAGER_KEY_MESSAGE, PRODUCTS, PRODUCT_PAGES } from "../products";
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

  it("cinq filiales dans l'ordre officiel ; Selio Cloud et Selio Agent sont des fonctionnalités de Selio Manager", () => {
    expect(PRODUCTS.map((p) => p.name)).toEqual(["Selio Manager", "Selio Studio", "Selio Track", "Selio Bot", "Selio Compte"]);
    expect(PRODUCTS.every((p) => p.kind === "subsidiary")).toBe(true);
    expect(MANAGER_FEATURES.map((p) => [p.name, p.kind])).toEqual([["Selio Cloud", "feature"], ["Selio Agent", "feature"]]);
    // Plus de « Selio Radar », « Selio Agents » ni « Selio Comptes » (au pluriel) dans les textes des pages.
    const all = JSON.stringify(PRODUCT_PAGES.map(({ shot: _shot, ...rest }) => rest));
    expect(all).not.toMatch(/Selio Radar|Selio Agents|Selio Comptes/);
  });

  for (const product of PRODUCT_PAGES) {
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
      // Appel à l'essai de 14 jours (ou au devis pour Selio Compte), jamais à la démonstration.
      if (product.slug === "compte") expect(screen.getByRole("link", { name: "Demander un devis" }).getAttribute("href")).toBe("/contact");
      else expect(screen.getByRole("link", { name: "Commencer l'essai gratuit de 14 jours" }).getAttribute("href")).toBe("/inscription");
      expect(container.querySelector('a[href^="/demo"]')).toBeNull();
      expect(container.textContent).not.toMatch(/démo/i);
      expect(screen.getByText(product.state.label)).toBeTruthy();
      // Capture en clair et en sombre, décrite pour les lecteurs d'écran (ou illustration, en attendant).
      if (PRODUCT_SHOTS[product.slug]) expect(screen.getAllByAltText(product.shot.alt)).toHaveLength(2);
      else expect(screen.getByRole("img", { name: `${product.name} : illustration, capture d'écran à venir` })).toBeTruthy();
      expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
      // Les autres filiales sont reliées ; la page courante ne l'est pas. Une fonctionnalité relie les cinq.
      const feature = product.kind === "feature";
      const others = within(screen.getByRole("heading", { name: feature ? "Les cinq filiales Selio" : "Les autres filiales Selio" }).parentElement!);
      expect(others.getAllByRole("link").map((a) => a.textContent)).toEqual(PRODUCTS.filter((p) => p.slug !== product.slug).map((p) => p.name));
      // Référencement : titre, description, indexation, données structurées sans prix ni note.
      expect(document.title).toContain(product.name);
      expect(description()).toBe(seoPage(product.path).description);
      expect(robots()).toBe("index, follow");
      const app = jsonLd().find((d) => d["@type"] === "SoftwareApplication");
      const crumbs = jsonLd().find((d) => d["@type"] === "BreadcrumbList").itemListElement.map((it: { name: string }) => it.name);
      if (feature) {
        // Une fonctionnalité de Selio Manager n'est pas présentée comme un produit indépendant.
        expect(app).toBeUndefined();
        expect(crumbs).toEqual(["Accueil", "Plateforme", "Selio Manager", product.name]);
        expect(within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getByRole("link", { name: "Selio Manager" }).getAttribute("href")).toBe("/produits/manager");
        expect(screen.getByText(`${product.name} · fonctionnalité de Selio Manager`)).toBeTruthy();
      } else {
        expect(app.name).toBe(product.name);
        expect(app.url).toMatch(new RegExp(`${product.path}$`));
        expect(app.offers).toBeUndefined();
        expect(app.aggregateRating).toBeUndefined();
        expect(crumbs).toEqual(["Accueil", "Plateforme", product.name]);
      }
      expect(findForbiddenClaims(container.textContent ?? "")).toEqual([]);
    });
  }

  it("Selio Manager : message clé, Selio Cloud et Selio Agent en fonctionnalités intégrées, distinction avec Selio Bot", () => {
    mockMotion();
    const { container } = renderAt("/produits/manager", "/produits/:slug", <Product />);
    expect(container.textContent).toContain(MANAGER_KEY_MESSAGE);
    expect(screen.getByTestId("manager-bot-distinction").textContent).toBe(MANAGER_BOT_DISTINCTION);
    const section = container.querySelector("#fonctionnalites-integrees")!;
    expect(within(section as HTMLElement).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Selio Cloud", "Selio Agent"]);
    expect(within(section as HTMLElement).getByRole("link", { name: "Découvrir Selio Cloud" }).getAttribute("href")).toBe("/produits/cloud");
    expect(within(section as HTMLElement).getByRole("link", { name: "Découvrir Selio Agent" }).getAttribute("href")).toBe("/produits/agent");
    for (const title of ["Gestion du stock centralisée", "Dressing intelligent", "Remise en ligne", "Messagerie automatisée", "Négociation par IA", "Relances automatiques", "Suivi des commandes et des ventes", "Gestion des marges", "Automatisations", "Multi-comptes"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeTruthy();
    }
  });

  it("Selio Bot : recherche et achat, avec la distinction Manager / Bot", () => {
    mockMotion();
    renderAt("/produits/bot", "/produits/:slug", <Product />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Rechercher, repérer et acheter/);
    expect(screen.getByTestId("manager-bot-distinction").textContent).toBe(MANAGER_BOT_DISTINCTION);
    for (const title of ["Recherche selon vos critères", "Surveillance des annonces", "Alertes", "Bonnes affaires notées sur 100", "Prix de revente et potentiel de marge", "Limites de dépenses", "Historique des achats", "Achat rapide ou automatisé"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeTruthy();
    }
  });

  it("Selio Track analyse et identifie ; il n'achète pas", () => {
    mockMotion();
    renderAt("/produits/track", "/produits/:slug", <Product />);
    expect(screen.getByText(/Track analyse et identifie ; il n'achète pas\./)).toBeTruthy();
  });

  it("Selio Compte : les sept services, devis vers Contact, sans promesse de déblocage", () => {
    mockMotion();
    const { container } = renderAt("/produits/compte", "/produits/:slug", <Product />);
    const titles = ["Création de comptes Vinted", "Comptes préparés ou non préparés", "Commandes en volume", "Configuration personnalisée de Selio Manager", "Messages et négociation optimisés", "Accompagnement pendant 30 jours", "Accompagnement en cas de restriction"];
    for (const title of titles) expect(screen.getByRole("heading", { level: 3, name: title })).toBeTruthy();
    expect(container.textContent).toContain("sans promesse de déblocage garanti");
    expect(screen.getByRole("link", { name: "Demander un devis" }).getAttribute("href")).toBe("/contact");
  });

  it("Selio Cloud : fonctionnalité de Selio Manager, ordinateur éteint, jamais un produit séparé", () => {
    mockMotion();
    renderAt("/produits/cloud", "/produits/:slug", <Product />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/ordinateur éteint/);
    expect(screen.getByText(/Selio Cloud est une fonctionnalité de Selio Manager/)).toBeTruthy();
    expect(screen.getByText("N'est pas un produit séparé : Selio Cloud fait partie de Selio Manager.")).toBeTruthy();
  });

  for (const [from, to] of [["radar", "bot"], ["comptes", "compte"], ["agents", "agent"]] as const) {
    it(`ancienne adresse /produits/${from} : redirigée vers /produits/${to}`, () => {
      mockMotion();
      renderAt(`/produits/${from}`, "/produits/:slug", <Product />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(PRODUCT_PAGES.find((p) => p.slug === to)!.promise);
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
    expect(steps).toEqual(["Sourcing et analyse", "Sourcing auprès de fournisseurs partenaires", "Recherche et achat", "Photos et annonce", "Vente, négociation et relances", "Commande, étiquette et envoi", "Après-vente"]);
    const owners = Array.from(container.querySelectorAll("#parcours ol > li")).map((li) => li.querySelector("h3 + p")?.textContent);
    expect(owners).toEqual(["Selio Track", "Bientôt", "Selio Bot", "Selio Studio", "Selio Manager", "Selio Manager", "Selio Manager"]);
    expect(container.querySelector("#parcours")!.textContent).toMatch(/Aucun partenariat n'est encore signé/);
    // L'article suivi : une vraie photo d'annonce, à l'endroit.
    expect(within(container.querySelector("#parcours")!).getByRole("img").getAttribute("src")).toBe("/demo/photos/g-x4iv-1.webp");
    // Les cinq filiales, dans l'ordre, chaque carte vers sa page ; Selio Cloud et Selio Agent sous Selio Manager.
    const range = within(container.querySelector("#espaces")!).getAllByRole("article").map((a) => a.querySelector("h3")?.textContent);
    expect(range).toEqual(["Selio Manager", "Selio Studio", "Selio Track", "Selio Bot", "Selio Compte"]);
    const managerFeatures = within(within(container.querySelector("#espaces")!).getAllByRole("article")[0]!).getByTestId("manager-features");
    expect(within(managerFeatures).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/produits/cloud", "/produits/agent"]);
    expect(container.textContent).not.toMatch(/Selio Radar|Selio Agents|Selio Comptes/);
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
    for (const q of ["Quelles sont les filiales de Selio ?", "Selio Cloud et Selio Agent, c'est quoi ?", "Quelle différence entre Selio Manager et Selio Bot ?", "Quelle différence entre Selio Track et Selio Bot ?"]) expect(screen.getByText(q)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Selio Agents|Selio Comptes/);
  });

  it("plateforme : les cinq filiales, dans l'ordre, chacune en une phrase, sans démonstration", () => {
    mockMotion();
    const { container } = renderPage("/plateforme", <Platform />);
    for (const p of PRODUCTS) expect(screen.getByRole("link", { name: `Découvrir ${p.name}` }).getAttribute("href")).toBe(p.path);
    const summary = screen.getByRole("list", { name: "Les cinq filiales, en une phrase" });
    expect(within(summary).getAllByRole("listitem").map((li) => li.textContent)).toEqual(PRODUCTS.map((p, i) => `${i + 1}.${p.name} — ${p.tagline}`));
    expect(container.textContent).toContain(MANAGER_KEY_MESSAGE);
    expect(screen.getByRole("img", { name: /Selio Manager au centre, avec ses fonctionnalités intégrées Selio Cloud et Selio Agent, relié à Selio Studio, Selio Track, Selio Bot, Selio Compte/ })).toBeTruthy();
    expect(container.querySelector('a[href^="/demo"]')).toBeNull();
    expect(container.textContent).not.toMatch(/démo/i);
    expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
  });
});

describe("vitrine › contact", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("le sujet « Selio Compte » se choisit par l'adresse (?sujet=compte, ou l'ancien ?sujet=comptes)", () => {
    mockMotion();
    for (const sujet of ["compte", "comptes"]) {
      renderAt(`/contact?sujet=${sujet}`, "/contact", <Contact />);
      expect((screen.getByLabelText("Sujet") as HTMLSelectElement).value).toBe("compte");
      expect(screen.getByRole("option", { name: "Selio Compte : prestation ou devis" })).toBeTruthy();
      cleanup();
    }
    renderAt("/contact?sujet=inconnu", "/contact", <Contact />);
    expect((screen.getByLabelText("Sujet") as HTMLSelectElement).value).toBe("question");
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
