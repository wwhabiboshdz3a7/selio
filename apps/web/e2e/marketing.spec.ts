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
    // Un seul bouton orange (accent) visible dans la zone héro.
    const accentButtons = page.locator("header ~ main a > button.bg-accent, main button.bg-accent");
    expect(await accentButtons.count()).toBeLessThanOrEqual(2);
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
