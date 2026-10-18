import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

test.describe("aide de l'application", () => {
  test("menu « Aide », question à l'assistant (démonstration signalée) et sources cliquables", async ({ page }) => {
    await openDemo(page);
    if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    const nav = isMobile(page) ? page.getByRole("dialog", { name: "Menu" }) : page.getByRole("navigation", { name: "Navigation de l'application" });
    await nav.locator('a[href="/app/help"]').click();
    await expect(page).toHaveURL(/\/app\/help$/);
    await expect(page.getByRole("heading", { name: "Aide", exact: true })).toBeVisible();
    await expect(page.getByText("Démonstration : réponses tirées de la FAQ")).toBeVisible();

    await page.getByLabel("Votre question").fill("Puis-je connecter plusieurs comptes Vinted ?");
    await page.getByRole("button", { name: "Demander" }).click();
    await expect(page.getByTestId("help-origin")).toHaveText("Réponse tirée de la FAQ");
    await expect(page.getByText(/jusqu'à\s5\savec Pro/).first()).toBeVisible();
    await page.getByRole("link", { name: /Puis-je connecter plusieurs comptes Vinted\s\?\s·\sComptes Vinted et extension/ }).click();
    await expect(page).toHaveURL(/\/app\/help#plusieurs-comptes$/);
    const entry = page.locator("details#plusieurs-comptes");
    await expect(entry).toHaveAttribute("open", "");
    // Dans l'application, la réponse mène à la page où agir.
    await expect(entry.getByRole("link", { name: "Comptes Vinted" })).toHaveAttribute("href", "/app/accounts");

    // Hors du champ de l'aide : aucune invention.
    await page.getByLabel("Votre question").fill("Quel temps fera-t-il demain à Lyon ?");
    await page.getByRole("button", { name: "Demander" }).click();
    await expect(page.getByTestId("help-origin")).toHaveText("Aucune réponse dans la FAQ");
  });

  test("abonnement : essai Découverte et consommation en pourcentage", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/billing");
    await expect(page.getByText("Essai Découverte")).toBeVisible();
    await expect(page.getByText(/jours? d'essai restants?/)).toBeVisible();
    const meters = page.getByRole("progressbar");
    await expect(meters).toHaveCount(4);
    await expect(page.getByRole("progressbar", { name: "Comptes Vinted" })).toHaveAttribute("aria-valuenow", "80");
    await expect(page.getByText("4 sur 5")).toBeVisible();
  });
});
