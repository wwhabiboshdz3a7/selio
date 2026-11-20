import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { PLAN_OFFERS, PRICING } from "@selio/demo-data";
import Landing from "./Landing";
import Home from "./Home";
import Pricing from "./Pricing";
import { DataProvider } from "../../lib/data/provider";
import { LANDINGS, landingFaq, landingProduct } from "../landings";
import { OBJECTIONS } from "../objections";
import { DEFAULT_OG_IMAGE, INDEPENDENCE_NOTICE, SEO_PAGES, SITE_ORIGIN, findForbiddenClaims, selioOffersJsonLd, seoPage } from "../seo";

const webRoot = join(__dirname, "..", "..", "..");

function mockBrowser() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
}

const head = (selector: string, attr = "content") => document.head.querySelector(selector)?.getAttribute(attr);
const jsonLd = () => Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')).flatMap((s) => [JSON.parse(s.textContent ?? "null")].flat());

describe("vitrine › pages d'atterrissage publicitaires", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("cinq pages, une intention chacune, toutes référencées dans SEO_PAGES avec une image de partage", () => {
    expect(LANDINGS.map((l) => l.path)).toEqual(["/logiciel-vinted", "/negociation-automatique-vinted", "/annonce-vinted-ia", "/prix-revente-vinted", "/bot-achat-vinted"]);
    for (const l of LANDINGS) {
      const seo = seoPage(l.path);
      expect(seo.ogImage, l.path).toMatch(/^\/og\/.+\.jpg$/);
      // Les doublons d'une page produit restent hors index, mais leurs liens sont suivis.
      if (!seo.indexable) expect(seo.noindexFollow, l.path).toBe(true);
    }
  });

  it("trois preuves par page, chacune une fonction réelle de la filiale (titre identique dans products.ts) ; limites reprises mot pour mot", () => {
    for (const l of LANDINGS) {
      const product = landingProduct(l);
      for (const proof of l.proofs) expect(product.does.map((f) => f.title), `${l.path} : ${proof}`).toContain(proof);
      for (const limit of l.limits) expect(product.doesNot, `${l.path} : ${limit}`).toContain(limit);
    }
  });

  for (const landing of LANDINGS) {
    it(`${landing.path} : mot-clé en titre, bénéfice, état réel, essai de 14 jours, preuves, FAQ, données structurées`, () => {
      mockBrowser();
      const { container } = render(
        <MemoryRouter initialEntries={[landing.path]}>
          <Routes>
            <Route path={landing.path} element={<Landing />} />
          </Routes>
        </MemoryRouter>,
      );
      const product = landingProduct(landing);
      const seo = seoPage(landing.path);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(landing.title);
      expect(screen.getByText(landing.lead)).toBeTruthy();
      // L'état réel de la filiale, et sa note quand une partie est simulée.
      const state = screen.getByTestId("landing-state");
      expect(state.textContent).toContain(product.state.label);
      if (product.state.value !== "available") expect(state.textContent).toContain(product.state.note);
      expect(screen.getByRole("link", { name: "Commencer l'essai gratuit de 14 jours" }).getAttribute("href")).toBe("/inscription");
      expect(container.querySelector('a[href^="/demo"]')).toBeNull();
      const proofs = within(screen.getByTestId("landing-proofs")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(proofs).toEqual(landing.proofs);
      // Capture (sauf filiale sans capture), en AVIF et WebP, chargée en priorité.
      const img = screen.getByAltText(product.shot.alt);
      expect(img.getAttribute("loading")).toBe("eager");
      expect(img.closest("picture")?.querySelector('source[type="image/avif"]')).toBeTruthy();
      for (const q of landingFaq(landing)) expect(screen.getByText(q.question)).toBeTruthy();
      expect(screen.getByTestId("independence-notice").textContent).toBe(INDEPENDENCE_NOTICE);
      // Référencement : titre, description, indexation, adresse canonique sur le domaine public, partage.
      expect(document.title).toContain(seo.title);
      expect(head('meta[name="description"]')).toBe(seo.description);
      expect(head('meta[name="robots"]')).toBe(seo.indexable ? "index, follow" : "noindex, follow");
      expect(head('link[rel="canonical"]', "href")).toBe(`${SITE_ORIGIN}${landing.path}`);
      expect(head('meta[property="og:image"]')).toBe(`${SITE_ORIGIN}${seo.ogImage}`);
      expect(head('meta[name="twitter:card"]')).toBe("summary_large_image");
      const ld = jsonLd();
      expect(ld.map((d) => d["@type"])).toEqual(["SoftwareApplication", "BreadcrumbList", "FAQPage"]);
      expect(ld[2].mainEntity.map((q: { name: string }) => q.name)).toEqual(landingFaq(landing).map((q) => q.question));
      expect(ld[0].aggregateRating).toBeUndefined();
      if (landing.offers) expect(ld[0].offers.map((o: { price: string }) => o.price)).toEqual(["0", ...PLAN_OFFERS.map((p) => (p.indicativeMonthlyCents / 100).toFixed(2))]);
      else expect(ld[0].offers).toBeUndefined();
      expect(findForbiddenClaims(container.textContent ?? "")).toEqual([]);
    });
  }

  it("adresse inconnue : retour à l'accueil", () => {
    mockBrowser();
    render(
      <MemoryRouter initialEntries={["/inconnue"]}>
        <Routes>
          <Route path="/inconnue" element={<Landing />} />
          <Route path="/" element={<p>Accueil</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Accueil")).toBeTruthy();
  });
});

describe("vitrine › offres dans les données structurées", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("prix lus dans PRICING (essai à 0 €, puis Starter, Pro, Agence au mois) ; rien si l'affichage des prix est masqué", () => {
    const offers = selioOffersJsonLd(true);
    expect(offers.map((o) => o.name)).toEqual(["Essai 14 jours", "Starter", "Pro", "Agence"]);
    expect(offers.map((o) => o.price)).toEqual(["0", ...(["starter", "pro", "agence"] as const).map((k) => (PRICING.monthlyCents[k] / 100).toFixed(2))]);
    for (const o of offers) expect(o.priceCurrency).toBe("EUR");
    expect(selioOffersJsonLd(false)).toEqual([]);
  });

  it("accueil : logiciel avec ses offres et les objections en FAQPage ; tarifs : logiciel avec ses offres", () => {
    mockBrowser();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<DataProvider forceMode="demo"><MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<Home />} /></Routes></MemoryRouter></DataProvider>);
    const home = jsonLd();
    expect(home.find((d) => d["@type"] === "SoftwareApplication").offers).toHaveLength(4);
    const faq = home.find((d) => d["@type"] === "FAQPage");
    for (const q of faq.mainEntity) expect(OBJECTIONS.map((o) => o.question)).toContain(q.name);
    expect(screen.getByRole("heading", { name: "Les questions qu'on nous pose avant de commencer" })).toBeTruthy();
    cleanup();
    render(<DataProvider forceMode="demo"><MemoryRouter initialEntries={["/tarifs"]}><Routes><Route path="/tarifs" element={<Pricing />} /></Routes></MemoryRouter></DataProvider>);
    expect(jsonLd().find((d) => d["@type"] === "SoftwareApplication").offers).toHaveLength(4);
  });
});

describe("vitrine › images de partage et réassurance", () => {
  it("chaque image de partage existe (1200 × 630, JPEG) et index.html annonce la grande carte", () => {
    const images = new Set([DEFAULT_OG_IMAGE, ...SEO_PAGES.map((p) => p.ogImage).filter((x): x is string => Boolean(x))]);
    for (const img of images) {
      const file = join(webRoot, "public", img);
      expect(existsSync(file), img).toBe(true);
      const buf = readFileSync(file);
      // En-tête JPEG, puis dimensions lues dans le segment SOF.
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
      let i = 2;
      let size: [number, number] | null = null;
      while (i < buf.length) {
        const marker = buf[i + 1]!;
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc2) {
          size = [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
          break;
        }
        i += 2 + len;
      }
      expect(size, img).toEqual([1200, 630]);
    }
    const html = readFileSync(join(webRoot, "index.html"), "utf8");
    expect(html).toContain(`<meta property="og:image" content="${SITE_ORIGIN}${DEFAULT_OG_IMAGE}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("les objections ne promettent rien d'interdit et ne disent jamais « sans risque »", () => {
    for (const o of OBJECTIONS) expect(findForbiddenClaims(`${o.question} ${o.answer}`), o.id).toEqual([]);
    expect(OBJECTIONS.find((o) => o.id === "carte-essai")!.answer).toMatch(/aucune carte n'est demandée à l'inscription/);
  });
});
