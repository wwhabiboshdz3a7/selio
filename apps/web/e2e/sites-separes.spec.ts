import { expect, test } from "@playwright/test";
import { gotoApp, openDemo } from "./helpers";

/**
 * Site public (cible « public ») : Selio Admin n'y existe pas (site séparé), l'extension s'installe depuis
 * l'application, pas à pas.
 */
test.describe("site public sans Selio Admin", () => {
  test("/admin et ses pages : la page 404 de la vitrine", async ({ page }) => {
    for (const path of ["/admin", "/admin/comptes", "/admin/supervision"]) {
      await page.goto(path);
      await expect(page.getByTestId("page-404")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Sections de l'administration" })).toHaveCount(0);
    }
  });

  test("une opératrice (Marie, démo) n'a aucun lien « Administration » dans l'application", async ({ page }) => {
    await openDemo(page, "/app/espaces");
    await expect(page.getByRole("link", { name: /Administration/ })).toHaveCount(0);
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  });
});

test.describe("installation guidée de l'extension", () => {
  test("Démarrage : télécharger, installer (schémas), relier avec un jeton, ajouter ses comptes Vinted", async ({ page }) => {
    await openDemo(page, "/app/onboarding");
    await page.getByRole("button", { name: /Extension et comptes Vinted/ }).click();
    const guide = page.getByTestId("extension-guide");
    await expect(guide).toBeVisible();
    for (const step of ["Télécharger l'extension", "L'installer dans le navigateur", "Relier l'extension à votre compte Selio", "Ajouter vos comptes Vinted"]) {
      await expect(guide.getByRole("heading", { name: step })).toBeVisible();
    }
    // Ce build de test n'a pas l'archive (construite au build Netlify) : le dire clairement plutôt qu'un lien cassé.
    await expect(page.getByTestId("extension-unavailable").or(page.getByTestId("extension-download"))).toBeVisible();
    await expect(guide.getByText("chrome://extensions")).toBeVisible();
    await expect(page.getByTestId("schema-page-extensions")).toBeVisible();
    await expect(page.getByTestId("schema-epingler")).toBeVisible();
    // L'adresse de Selio, pré-remplie dans l'extension, est rappelée.
    await expect(page.getByTestId("extension-api-address")).toHaveText(/^https?:\/\//);
    // Jeton créé ici, affiché une fois, à copier.
    await guide.getByLabel("Nom de ce navigateur").fill("Chrome — PC de test");
    await guide.getByRole("button", { name: "Créer un jeton" }).click();
    await expect(page.getByTestId("extension-token")).toContainText("Chrome — PC de test");
    await expect(guide.getByRole("button", { name: "Copier le jeton" })).toBeVisible();
    // Jamais de mot de passe Vinted demandé.
    await expect(guide).toContainText("ne vous demande jamais votre mot de passe Vinted");
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await guide.getByRole("link", { name: "Ajouter un compte Vinted" }).click();
    await expect(page.getByRole("dialog", { name: "Ajouter un compte Vinted" })).toBeVisible();
  });

  test("Comptes Vinted : le même parcours, avec la configuration de départ", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/accounts");
    const section = page.getByTestId("extension-install-section");
    await expect(section).toBeVisible();
    if (!(await section.getAttribute("open"))) await section.getByText("Installer l'extension Selio, pas à pas").click();
    await expect(section.getByRole("heading", { name: "Configuration de départ" })).toBeVisible();
    await expect(section.getByRole("link", { name: "Marges et négociation" })).toHaveAttribute("href", "/app/automatisation/negociation");
  });
});
