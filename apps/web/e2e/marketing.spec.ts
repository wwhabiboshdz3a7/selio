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
    await expect(page.getByText("Montants indicatifs")).toBeVisible();
    await page.goto("/faq");
    await expect(page.getByText("Selio est-il affilié à Vinted ?")).toBeVisible();
    await page.goto("/mentions-legales");
    await expect(page.getByRole("alert").filter({ hasText: "Brouillon" })).toBeVisible();
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });

  test("plateforme : les quatre espaces, chacun avec son état honnête", async ({ page }) => {
    await page.goto("/plateforme");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Une plateforme, puis des filiales");
    for (const name of ["Selio", "Selio Studio", "Selio Agence", "Selio Global"]) await expect(page.getByRole("article", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Agence" }).getByText("Aperçu dans la démo")).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Global" }).getByText("En préparation")).toBeVisible();
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
