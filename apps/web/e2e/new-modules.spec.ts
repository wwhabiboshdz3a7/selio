import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

// PNG 1×1 valide : le navigateur doit pouvoir le décoder pour le compresser.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test.describe("nouveaux modules", () => {
  test("générateur d'annonces : photos → annonce → publication", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/studio");
    await expect(page.getByRole("heading", { name: "Générateur d'annonces" })).toBeVisible();
    await page.getByLabel("Choisir des photos").setInputFiles([{ name: "ralph-lauren-pull-bleu-marine-M.png", mimeType: "image/png", buffer: PNG }]);
    await expect(page.getByText("Couverture", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Générer l'annonce" }).click();
    await expect(page.getByText("Annonce proposée")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/Titre/).first()).toHaveValue(/Ralph Lauren/);
    await page.getByRole("button", { name: "Publier directement" }).click();
    await expect(page.getByRole("heading", { name: "Annonce mise en vente" })).toBeVisible();
  });

  test("dressing intelligent : à republier, variantes pré-faites, republication enregistrée", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/dressing");
    await expect(page.getByRole("heading", { name: "Dressing intelligent" })).toBeVisible();
    await page.getByRole("radio", { name: /À republier/ }).click();
    await page.getByRole("button", { name: "Republier" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Conseillée : variante/)).toBeVisible();
    expect(await dialog.getByRole("button", { name: "J'ai republié avec cette variante" }).count()).toBeGreaterThanOrEqual(8);
    await dialog.getByRole("button", { name: "J'ai republié avec cette variante" }).first().click();
    await expect(page.getByText(/Republication enregistrée/)).toBeVisible();
  });

  test("analyse des revendeurs, achat auto et galerie de graphiques", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/track");
    await expect(page.getByText("Top revendeurs")).toBeVisible();
    await expect(page.getByText("Opportunités de niche")).toBeVisible();
    await gotoApp(page, "/app/auto-buy");
    await expect(page.getByText("Garde-fous")).toBeVisible();
    await page.getByRole("button", { name: "Annuler l'achat" }).first().click();
    await expect(page.getByText("Achat automatique annulé")).toBeVisible();
    await gotoApp(page, "/app");
    await page.getByRole("radio", { name: "Ce mois-ci" }).click();
    await page.getByRole("button", { name: "Personnaliser" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Heures des ventes/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Terminé" }).click();
    await expect(page.getByRole("heading", { name: "Heures des ventes" })).toBeVisible();
  });

  test("menu latéral : suit le défilement, bloc compte toujours visible", async ({ page }) => {
    await openDemo(page);
    test.skip(isMobile(page), "Menu en tiroir sur mobile");
    await gotoApp(page, "/app/radar");
    const account = page.getByRole("button", { name: /Marie Lefèvre/ });
    await expect(account).toBeInViewport();
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(300);
    await expect(account).toBeInViewport();
    await expect(page.getByRole("link", { name: "Générer une annonce" }).first()).toBeInViewport();
  });
});
