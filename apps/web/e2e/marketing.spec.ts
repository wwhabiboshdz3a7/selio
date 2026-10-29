import { expect, test } from "@playwright/test";

test.describe("vitrine", () => {
  test("accueil : proposition de valeur, parcours, CTA et transparence", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Selio/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos articles, vos conversations et votre marge");
    await expect(page.getByRole("link", { name: "Créer un compte" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Explorer la démo" }).first()).toBeVisible();
    await expect(page.getByText("Ce qui est disponible aujourd'hui")).toBeVisible();
    await expect(page.getByText(/ni affilié à Vinted/)).toBeVisible();
    // Une seule règle d'action : la conversion (« Créer un compte ») est toujours en
    // accent violet, et un lien n'enveloppe jamais un bouton.
    const signups = page.locator('main a[href="/inscription"]');
    expect(await signups.count()).toBeGreaterThan(0);
    for (const a of await signups.all()) await expect(a).toHaveClass(/bg-accent/);
    expect(await page.locator("a button").count()).toBe(0);
  });

  test("navigation : fonctionnalités, tarifs indicatifs, FAQ, mentions légales en brouillon", async ({ page }) => {
    await page.goto("/fonctionnalites");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/tarifs");
    await expect(page.getByText("Montants indicatifs", { exact: true })).toBeVisible();
    await page.goto("/faq");
    await expect(page.getByText("Selio est-il affilié à Vinted ?")).toBeVisible();
    await page.goto("/mentions-legales");
    await expect(page.getByRole("alert").filter({ hasText: "Brouillon" })).toBeVisible();
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });

  test("tarifs : essai de 14 jours, trois offres, annuel, fondateurs, filiales au curseur, comparatif à quatre colonnes", async ({ page }) => {
    await page.goto("/tarifs");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("14 jours pour essayer");
    const trial = page.getByRole("article", { name: "Essai 14 jours" });
    await expect(trial).toContainText("Gratuit pendant 14 jours");
    await expect(trial).toContainText("carte enregistrée, rien débité avant la fin");
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
    // Les autres filiales : Studio seul au curseur, Radar, Radar Auto, Cloud en option, Selio Comptes.
    const studio = page.getByRole("article", { name: "Selio Studio seul" });
    await expect(studio).toContainText("0,02 € la photo");
    await expect(studio).toContainText("4,99 € minimum");
    await studio.getByRole("button", { name: /1 200 photos/ }).click();
    await expect(studio).toContainText("29,99 €");
    await expect(page.getByText("Selio Radar Auto", { exact: true })).toBeVisible();
    await expect(page.getByText("Selio Cloud en option", { exact: true })).toBeVisible();
    // Comparatif : l'essai et les trois offres, « — » pour ce qui n'est pas inclus.
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: /Agence/ })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: /Comptes Vinted connectés/ })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: /Annonces rédigées/ })).toBeVisible();
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

  test("plateforme : Selio et ses filiales, chacune avec son état honnête", async ({ page }) => {
    await page.goto("/plateforme");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Une plateforme, puis des filiales");
    for (const name of ["Selio", "Selio Studio", "Selio Agents", "Selio Track", "Selio Cloud", "Générateur de compte Vinted"]) await expect(page.getByRole("article", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Global" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Selio Agents" }).getByText("Aperçu dans la démo")).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Cloud" }).getByText("En développement")).toBeVisible();
    await expect(page.getByRole("link", { name: /Ouvrir Selio Studio dans la démo/ })).toHaveAttribute("href", "/demo?vers=/studio");
    await expect(page.getByText(/ni affilié à Vinted/).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
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
