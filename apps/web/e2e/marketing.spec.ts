import { expect, test, type Page } from "@playwright/test";
import { isMobile } from "./helpers";
import { MANAGER_FEATURES, PRODUCTS, PRODUCT_PAGES } from "../src/marketing/products";
import { ELIAS_PLACEHOLDER } from "../src/marketing/comparison";
import { COMPARISON_READY, INDEPENDENCE_NOTICE, SEO_PAGES, findForbiddenClaims } from "../src/marketing/seo";

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test.describe("vitrine", () => {
  test("accueil : proposition de valeur, parcours, CTA et transparence", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Selio/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos articles, vos conversations et votre marge");
    await expect(page.getByRole("link", { name: /Commencer l'essai gratuit/ }).first()).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Se connecter" }).first()).toBeVisible();
    // Plus aucun renvoi vers la démonstration depuis la vitrine.
    await expect(page.locator('a[href^="/demo"]')).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/démo/i);
    await expect(page.getByText("Ce qui est disponible aujourd'hui")).toBeVisible();
    // Le parcours, de l'achat à l'étiquette, avec les fournisseurs partenaires annoncés honnêtement.
    const journey = page.locator("#parcours");
    await expect(journey.getByRole("heading", { name: "De l'achat à l'étiquette, sans rien ressaisir" })).toBeVisible();
    await expect(journey.getByRole("heading", { level: 3 })).toHaveCount(7);
    await expect(journey.getByRole("heading", { name: "Recherche et achat" })).toBeVisible();
    await expect(journey.getByRole("heading", { name: "Sourcing auprès de fournisseurs partenaires" })).toBeVisible();
    await expect(journey.getByText("Aucun partenariat n'est encore signé.", { exact: false })).toBeVisible();
    // Les cinq filiales, dans l'ordre ; Selio Cloud et Selio Agent sous Selio Manager.
    const range = page.locator("#espaces");
    await expect(range.getByRole("article")).toHaveCount(5);
    await expect(range.getByRole("article").locator("h3")).toHaveText(PRODUCTS.map((p) => p.name));
    await expect(range.getByTestId("manager-features").getByRole("link")).toHaveText(MANAGER_FEATURES.map((f) => f.name));
    // Mention d'indépendance, mot pour mot, dans le pied de page.
    await expect(page.getByTestId("footer-independence")).toHaveText(INDEPENDENCE_NOTICE);
    // Une seule règle d'action : la conversion (« Créer un compte ») est toujours en
    // accent violet, et un lien n'enveloppe jamais un bouton.
    const signups = page.locator('main a[href="/inscription"]');
    expect(await signups.count()).toBeGreaterThan(0);
    for (const a of await signups.all()) await expect(a).toHaveClass(/bg-accent/);
    expect(await page.locator("a button").count()).toBe(0);
  });

  test("navigation : fonctionnalités, tarifs indicatifs, FAQ, mentions légales en version provisoire", async ({ page }) => {
    await page.goto("/fonctionnalites");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/tarifs");
    // Avertissement des tarifs, renommé « Montants non définitifs » avec les offres 1 / 3 / 10.
    await expect(page.getByText("Montants non définitifs", { exact: true })).toBeVisible();
    await page.goto("/faq");
    await expect(page.getByText("Selio est-il affilié à Vinted ?")).toBeVisible();
    await page.goto("/mentions-legales");
    await expect(page.getByRole("alert").filter({ hasText: "Version provisoire" })).toContainText("définitive après l'avocat");
    await expect(page.getByText(INDEPENDENCE_NOTICE).first()).toBeVisible();
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });

  test("tarifs : essai de 14 jours, trois offres, annuel, fondateurs, filiales au curseur, comparatif à quatre colonnes", async ({ page }) => {
    await page.goto("/tarifs");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("14 jours pour essayer");
    const trial = page.getByRole("article", { name: "Essai 14 jours" });
    await expect(trial).toContainText("Gratuit pendant 14 jours");
    await expect(trial).toContainText("rien débité avant la fin");
    await expect(trial.getByRole("link", { name: "Commencer l'essai de 14 jours" })).toHaveAttribute("href", "/inscription");
    // Trois offres, à partir de la configuration (montants indicatifs).
    await expect(page.getByRole("article", { name: "Starter" })).toContainText("6,99 €");
    await expect(page.getByRole("article", { name: "Pro" }).getByText("Le revendeur régulier")).toBeVisible();
    await expect(page.getByRole("article", { name: "Agence" })).toContainText("49,99 €");
    await page.getByRole("radio", { name: /À l'année/ }).click();
    await expect(page.getByRole("article", { name: "Pro" })).toContainText("2 mois offerts");
    await expect(page.getByText("Offre fondateurs", { exact: true })).toBeVisible();
    await expect(page.getByText("Plus de 10 comptes : sur devis", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: "Montants non définitifs" })).toBeVisible();
    // Les autres filiales : Studio seul au curseur, Selio Bot et son option, Selio Cloud en option, Selio Compte.
    const studio = page.getByRole("article", { name: "Selio Studio seul" });
    await expect(studio).toContainText("0,02 € la photo");
    await expect(studio).toContainText("4,99 € minimum");
    await studio.getByRole("button", { name: /1 200 photos/ }).click();
    await expect(studio).toContainText("29,99 €");
    const monthlyRows = page.getByRole("list", { name: "Selio Bot et Selio Cloud au mois" });
    await expect(monthlyRows).toContainText("14,99 €");
    await expect(page.getByText("Option achat automatique de Selio Bot", { exact: true })).toBeVisible();
    await expect(page.getByText("Selio Cloud en option", { exact: true })).toBeVisible();
    await expect(page.getByText(/Selio Radar/)).toHaveCount(0);
    // Automatisations de Selio Manager incluses selon le forfait ; Selio Compte : prestations payées une fois, et devis.
    await expect(page.getByRole("article", { name: "Automatisations de Selio Manager" })).toContainText("Incluses");
    const compte = page.getByRole("list", { name: "Prestations Selio Compte" });
    await expect(compte).toContainText("19,00 €");
    await expect(compte).toContainText("49,00 €");
    await expect(compte).toContainText("89,00 €");
    await expect(page.getByRole("article", { name: "Sur devis" }).getByRole("link", { name: "Demander un devis" })).toHaveAttribute("href", "/contact");
    // Comparatif : l'essai et les trois offres, « — » pour ce qui n'est pas inclus.
    const table = page.getByRole("table");
    const columns = ["Essai 14 jours", "Starter", "Pro", "Agence"];
    if (isMobile(page)) {
      // Sur mobile, une offre à la fois (Pro par défaut) : l'offre affichée se choisit au-dessus du tableau.
      await expect(table.getByRole("columnheader", { name: /^Pro\b/ })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: /^Agence\b/ })).toBeHidden();
      await page.getByRole("radiogroup", { name: "Offre affichée" }).getByRole("radio", { name: "Agence" }).click();
      await expect(table.getByRole("columnheader", { name: /^Agence\b/ })).toBeVisible();
      for (const name of columns.filter((c) => c !== "Agence")) await expect(table.getByRole("columnheader", { name: new RegExp(`^${name}\\b`) })).toBeHidden();
    } else {
      for (const name of columns) await expect(table.getByRole("columnheader", { name: new RegExp(`^${name}\\b`) })).toBeVisible();
    }
    await expect(table.getByRole("rowheader", { name: /Comptes Vinted connectés/ })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: /Annonces rédigées/ })).toBeVisible();
    for (const group of ["Selio Manager", "Selio Cloud (fonctionnalité de Selio Manager)", "Selio Agent (fonctionnalité de Selio Manager)", "Selio Studio", "Selio Track", "Selio Bot", "Selio Compte"]) await expect(table.getByRole("columnheader", { name: group, exact: true })).toBeVisible();
    // L'inscription n'offre plus de choix de durée : 14 jours, carte enregistrée, rien débité.
    await page.goto("/inscription");
    await expect(page.getByTestId("trial-terms")).toContainText("14 jours d'essai, carte enregistrée, rien n'est débité avant la fin");
    await expect(page.getByTestId("trial-terms")).toContainText("elle vous sera demandée à la première ouverture de l'application");
    await expect(page.getByRole("radiogroup", { name: /Durée de l'essai/ })).toHaveCount(0);
  });

  test("FAQ : recherche instantanée, ancre partageable et question à l'assistant (réponse tirée de la FAQ)", async ({ page }) => {
    await page.goto("/faq#achat-reel");
    await expect(page.locator("details#achat-reel")).toHaveAttribute("open", "");
    await expect(page.locator("details#achat-reel")).toBeInViewport();
    expect(await page.locator("details").count()).toBeGreaterThanOrEqual(40);

    await page.getByLabel("Rechercher dans l'aide").fill("supprimer mes données");
    await expect(page.getByText(/réponses? pour « supprimer mes données »/)).toBeVisible();
    await expect(page.locator("details").first()).toHaveAttribute("id", "supprimer-organisation");

    await page.getByLabel("Votre question").fill("Combien de temps dure l'essai gratuit ?");
    await page.getByRole("button", { name: "Demander" }).click();
    await expect(page.getByTestId("help-origin")).toHaveText("Réponse tirée de la FAQ");
    await page.getByRole("link", { name: /Comment fonctionne l.essai gratuit de\s14\sjours\s\?/ }).click();
    await expect(page).toHaveURL(/\/faq#essai-decouverte$/);
    await expect(page.locator("details#essai-decouverte")).toHaveAttribute("open", "");
  });

  test("plateforme : les cinq filiales dans l'ordre, chacune avec son état honnête ; Cloud et Agent sous Manager", async ({ page }) => {
    await page.goto("/plateforme");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Une plateforme, cinq filiales");
    for (const p of PRODUCTS) await expect(page.getByRole("article", { name: p.name, exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(5);
    await expect(page.getByRole("article", { name: "Selio Global" })).toHaveCount(0);
    // Selio Cloud et Selio Agent ne sont pas des filiales : ni carte à eux, ni sixième ou septième produit.
    await expect(page.getByRole("article", { name: "Selio Cloud" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Selio Agent" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Selio Manager", exact: true }).getByRole("link", { name: "Selio Cloud" })).toHaveAttribute("href", "/produits/cloud");
    await expect(page.getByRole("article", { name: "Selio Bot" }).getByText("Aperçu")).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Track" }).getByText("En développement")).toBeVisible();
    await expect(page.locator('a[href^="/demo"]')).toHaveCount(0);
    await expect(page.getByText(/ni affilié, ni approuvé, ni sponsorisé par Vinted/).first()).toBeVisible();
    // Chaque produit mène à sa page.
    await expect(page.getByRole("link", { name: "Découvrir Selio Studio" })).toHaveAttribute("href", "/produits/studio");
    await expect(page.getByRole("article", { name: "Selio Compte", exact: true }).getByText("Sur devis")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });

  test("filiales : une page par filiale et par fonctionnalité de Selio Manager, même structure, prix « voir tarifs », indépendance et données structurées", async ({ page }) => {
    for (const product of PRODUCT_PAGES) {
      await page.goto(product.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(product.promise);
      await expect(page).toHaveTitle(new RegExp(product.name));
      await expect(page.getByRole("heading", { level: 2, name: `Ce que fait ${product.name}` })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: `Ce que ${product.name} ne fait pas` })).toBeVisible();
      await expect(page.getByText(product.doesNot[0]!)).toBeVisible();
      await expect(page.getByText("Prix : voir les tarifs")).toBeVisible();
      await expect(page.getByRole("link", { name: "Voir les tarifs" }).first()).toHaveAttribute("href", /^\/tarifs/);
      if (product.slug === "compte") await expect(page.getByRole("link", { name: "Demander un devis" })).toHaveAttribute("href", "/contact");
      else await expect(page.getByRole("link", { name: "Commencer l'essai gratuit de 14 jours" })).toHaveAttribute("href", "/inscription");
      await expect(page.locator('a[href^="/demo"]')).toHaveCount(0);
      await expect(page.getByTestId("independence-notice")).toHaveText(INDEPENDENCE_NOTICE);
      // Capture d'écran (ou illustration), décrite pour les lecteurs d'écran.
      await expect(page.locator("figure").getByRole("img").filter({ visible: true }).first()).toBeVisible();
      expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("index, follow");
      expect((await page.locator('meta[name="description"]').getAttribute("content"))?.length).toBeLessThanOrEqual(160);
      const ld = await page.locator('script[type="application/ld+json"][data-selio-jsonld]').allTextContents();
      const types = ld.flatMap((t) => [JSON.parse(t)].flat()).map((d: { "@type": string }) => d["@type"]);
      if (product.kind === "feature") {
        // Fonctionnalité de Selio Manager : fil d'Ariane « Selio Manager › … », pas de fiche produit.
        await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Selio Manager" })).toHaveAttribute("href", "/produits/manager");
        expect(types).not.toContain("SoftwareApplication");
        expect(types).toContain("BreadcrumbList");
      } else expect(types).toEqual(expect.arrayContaining(["SoftwareApplication", "BreadcrumbList"]));
      expect(await noOverflow(page)).toBe(true);
    }
    // Le pied de page relie les cinq filiales, Cloud et Agent sous Manager ; plus de Selio Radar.
    const footer = page.getByRole("contentinfo");
    for (const p of PRODUCT_PAGES) await expect(footer.getByRole("link", { name: new RegExp(`^(↳ )?${p.name}\\b`) })).toHaveAttribute("href", p.path);
    await expect(footer.getByRole("link", { name: /Selio Radar/ })).toHaveCount(0);
    // Anciennes adresses : Radar mène à Selio Bot, Comptes à Selio Compte, Agents à Selio Agent.
    for (const [from, to] of [["radar", "bot"], ["comptes", "compte"], ["agents", "agent"]]) {
      await page.goto(`/produits/${from}`);
      await expect(page).toHaveURL(new RegExp(`/produits/${to}$`));
    }
    // Une adresse inconnue ramène à la plateforme.
    await page.goto("/produits/inconnue");
    await expect(page).toHaveURL(/\/plateforme$/);
  });

  test("comparatifs Bleam : structure complète, textes d'Elias marqués, sources, non référencés avant validation", async ({ page }) => {
    await page.goto("/selio-ou-bleam");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Selio ou Bleam ?");
    await expect(page.getByText(ELIAS_PLACEHOLDER, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Mot de passe Vinted" })).toBeVisible();
    await expect(page.getByText(/Source : fiche App Store de Bleam/)).toBeVisible();
    await expect(page.getByTestId("independence-notice")).toHaveText(INDEPENDENCE_NOTICE);
    if (!COMPARISON_READY) {
      await expect(page.getByRole("status").filter({ hasText: "Page en préparation" })).toBeVisible();
      expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
    }
    expect(await noOverflow(page)).toBe(true);
    await page.getByRole("link", { name: /Une alternative à Bleam/ }).click();
    await expect(page).toHaveURL(/\/alternative-bleam$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("alternative à Bleam, V-Tools ou Clemz");
    await expect(page.getByRole("link", { name: "En savoir plus sur Selio Bot" })).toHaveAttribute("href", "/produits/bot");
    if (!COMPARISON_READY) expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
    expect(await noOverflow(page)).toBe(true);
  });

  test("extension : fiche, politique de confidentialité provisoire et mention d'indépendance", async ({ page }) => {
    await page.goto("/extension");
    await expect(page.getByText(/Pas encore publiée sur le Chrome Web Store/)).toBeVisible();
    await expect(page.getByTestId("independence-notice")).toHaveText(INDEPENDENCE_NOTICE);
    await page.getByRole("link", { name: /Confidentialité de l'extension : ce qu'elle lit/ }).click();
    await expect(page).toHaveURL(/\/extension\/confidentialite$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité de l'extension Selio");
    await expect(page.getByRole("alert").filter({ hasText: "Version provisoire" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ce que l'extension ne fait jamais" })).toBeVisible();
    await expect(page.getByTestId("independence-notice")).toHaveText(INDEPENDENCE_NOTICE);
  });

  test("référencement : sitemap.xml et robots.txt servis, cohérents avec les pages", async ({ page, request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const p of SEO_PAGES.filter((x) => x.indexable)) expect(sitemap).toContain(`${p.path}</loc>`);
    if (!COMPARISON_READY) expect(sitemap).not.toContain("/selio-ou-bleam");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/^Sitemap: https:\/\/.+\/sitemap\.xml$/m);
    expect(robots).toMatch(/^Disallow: \/app$/m);
    await page.goto("/");
    const ld = await page.locator('head script[type="application/ld+json"]').textContent();
    expect(JSON.parse(ld ?? "{}")["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite"]);
  });

  test("aucune promesse interdite sur les pages publiques (classement Google, zéro risque, 100 % légal, partenaire Vinted)", async ({ page }) => {
    for (const p of SEO_PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const text = await page.locator("body").innerText();
      expect(findForbiddenClaims(text), p.path).toEqual([]);
    }
  });

  test("mode sombre et mobile : bascule sans débordement", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /Passer en mode sombre|Passer en mode clair/ });
    await toggle.click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toMatch(/dark|light/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });

  test("connexion : mode démonstration explicite, mode connecté honnête sans API", async ({ page }) => {
    await page.goto("/connexion");
    await expect(page.getByText(/identifiants pré-remplis suffisent/)).toBeVisible();
    await page.getByRole("radio", { name: "Compte connecté" }).click();
    await expect(page.getByText(/Aucune API configurée|Vérifiez|serveur/)).toBeVisible();
  });
});
