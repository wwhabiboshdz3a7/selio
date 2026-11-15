import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

/**
 * Selio Manager : journal d'activité, raccourcis personnalisés et « Articles et stock » plus ergonomique
 * (recherche instantanée, édition rapide, actions groupées, raccourcis clavier), en démonstration.
 */
test.describe("Selio Manager", () => {
  test("journal d'activité : une action de l'équipe y apparaît, filtres, lien vers l'objet", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByRole("region", { name: "Dernières actions" })).toBeVisible();
    const title = `Jean journal ${Date.now().toString(36)}`;
    await gotoApp(page, "/app/items/new");
    await page.getByLabel("Titre", { exact: false }).first().fill(title);
    await page.getByRole("button", { name: "Créer l'article" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await gotoApp(page, "/app/journal");
    await expect(page.getByRole("heading", { name: "Journal d'activité", level: 1 })).toBeVisible();
    const line = page.getByRole("link", { name: new RegExp(`a ajouté l'article « ${title} »`) });
    await expect(line).toBeVisible();
    await page.getByRole("radio", { name: /Automatique/ }).click();
    await expect(page).toHaveURL(/mode=auto/);
    await expect(page.getByText(title)).toHaveCount(0);
    await page.getByRole("radio", { name: "Tout", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(`a ajouté l'article « ${title} »`) }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("raccourcis : modifier, enregistrer, retrouvés après rechargement, retour aux raccourcis par défaut", async ({ page }) => {
    await openDemo(page);
    const nav = page.getByRole("navigation", { name: "Raccourcis" });
    await expect(nav.getByRole("link")).toHaveCount(8);
    await nav.getByRole("button", { name: "Modifier les raccourcis" }).click();
    const dialog = page.getByRole("dialog", { name: "Personnaliser les raccourcis" });
    await dialog.getByRole("button", { name: "Ajouter Journal d'activité" }).click();
    await dialog.getByRole("button", { name: "Monter Journal d'activité" }).click();
    await dialog.getByRole("button", { name: "Retirer Selio Track" }).click();
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(nav.getByRole("link").nth(6)).toHaveAttribute("href", "/app/journal");
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Raccourcis" }).getByRole("link").nth(6)).toHaveAttribute("href", "/app/journal");
    await page.getByRole("button", { name: "Modifier les raccourcis" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Raccourcis par défaut" }).click();
    await expect(page.getByRole("navigation", { name: "Raccourcis" }).getByRole("link").last()).toHaveAttribute("href", "/track");
  });

  test("articles : « / » pour chercher, prix modifié sur place, sélection et suppression confirmée dans la page", async ({ page }) => {
    await openDemo(page);
    const title = `Pull ergonomie ${Date.now().toString(36)}`;
    await gotoApp(page, "/app/items/new");
    await page.getByLabel("Titre", { exact: false }).first().fill(title);
    await page.getByLabel("Prix affiché").fill("20");
    await page.getByRole("button", { name: "Créer l'article" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await gotoApp(page, "/app/items");
    await expect(page.getByText("Vendus ce mois")).toBeVisible();
    if (!isMobile(page)) {
      await page.locator("body").press("/");
      await expect(page.getByLabel("Recherche")).toBeFocused();
    }
    await page.getByLabel("Recherche").fill(title.slice(0, 18));
    await expect(page).toHaveURL(/q=/);
    await page.getByRole("button", { name: `Modifier le prix de ${title}` }).filter({ visible: true }).first().click();
    const input = page.getByRole("textbox", { name: `Nouveau prix de ${title}` }).filter({ visible: true }).first();
    await input.fill("23,5");
    await input.press("Enter");
    await expect(page.getByText("23,50 €").filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("checkbox", { name: `Sélectionner ${title}` }).filter({ visible: true }).first().check();
    const bar = page.getByRole("region", { name: "Actions groupées" });
    await bar.getByRole("button", { name: "Supprimer", exact: true }).click();
    await bar.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(page.getByText("Aucun article ne correspond")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
