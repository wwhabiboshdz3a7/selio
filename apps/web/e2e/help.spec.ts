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

  test("abonnement : essai de 14 jours, trois offres, et « Mon utilisation » avec une jauge par compteur", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/billing");
    await expect(page.getByText("Essai 14 jours")).toBeVisible();
    await expect(page.getByText(/jours? d'essai restants?/)).toBeVisible();
    // Ce que l'offre donne : comptes, équipe, stock ; puis les trois offres et le « sur devis ».
    await expect(page.getByRole("progressbar")).toHaveCount(3);
    await expect(page.getByRole("progressbar", { name: "Comptes Vinted" })).toBeVisible();
    for (const name of ["Starter", "Pro", "Agence"]) await expect(page.getByText(new RegExp(`^${name}`)).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Choisir (test)" })).toHaveCount(3);
    await expect(page.getByText("Plus de 10 comptes Vinted")).toBeVisible();
    // Mon utilisation : une jauge par compteur, « utilisé / quota », date de remise à zéro, alerte à 80 %.
    await page.getByRole("link", { name: "Mon utilisation du mois" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/usage$/);
    await expect(page.getByRole("heading", { name: "Mon utilisation" })).toBeVisible();
    await expect(page.getByText(/remise à zéro le/)).toBeVisible();
    for (const name of ["Réponses de mon IA perso", "Actions automatiques aujourd'hui", "Annonces Studio", "Photos portées", "Scans de niche", "Recherches par photo", "Actions Cloud aujourd'hui"]) {
      await expect(page.getByRole("progressbar", { name })).toBeVisible();
    }
    await expect(page.getByRole("progressbar", { name: "Annonces Studio" })).toHaveAttribute("aria-valuetext", /sur 20\)$/);
  });
});
