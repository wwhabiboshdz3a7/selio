import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

test.describe("réglages : négociation, comptes et accès, assistant IA", () => {
  test("négociation et marges : préréglage, simulateur branché sur le moteur, enregistrement", async ({ page }) => {
    await openDemo(page);
    // On y arrive depuis la négociation elle-même, dans la Messagerie.
    await gotoApp(page, "/app/messages/conv-001");
    await page.getByRole("link", { name: /Calculé avec vos règles de négociation/ }).click();
    await expect(page).toHaveURL(/\/app\/selling-rules$/);
    await expect(page.getByRole("heading", { name: "Négociation et marges", level: 1 })).toBeVisible();

    await page.getByRole("radio", { name: /Prudent/ }).click();
    await expect(page.getByRole("radio", { name: /Prudent/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Remise maximale (%)")).toHaveValue("10");
    await expect(page.getByText("Modifications non enregistrées.")).toBeVisible();

    // Veste à 40 € achetée 15 €, offre à 25 € : remise de 37,5 % > 10 % → contre-proposition à 40 € − 4 %.
    await page.getByLabel("Offre de l'acheteur").fill("25");
    const result = page.getByTestId("simulation-result");
    await expect(result).toContainText(/Contre-proposition à 38,40\s€/);
    await expect(result).toContainText(/Acceptée d'office dès\s*36,00\s€/);
    await expect(page.getByText("L'offre vous est confiée", { exact: true })).toBeVisible();

    // Une règle écrite en phrase se modifie directement et le simulateur suit.
    await page.getByLabel("Remise maximale (%)").fill("40");
    await expect(result).toContainText("Offre acceptée");

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Règles de négociation enregistrées")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Remise maximale (%)")).toHaveValue("40");
    await expect(page.getByLabel("Marge minimale (%)")).toHaveValue("35");
  });

  test("organisation : réglages généraux seulement, avec renvoi vers les règles de vente et d'achat", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/organisation");
    await expect(page.getByLabel("Fuseau horaire")).toBeVisible();
    await expect(page.getByText("Règles de marge et de négociation")).toHaveCount(0);
    await expect(page.getByLabel("Remise maximale (%)")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Achat auto/ }).last()).toHaveAttribute("href", "/app/auto-buy");
    await page.getByRole("link", { name: /Négociation et marges · Vendre/ }).click();
    await expect(page).toHaveURL(/\/app\/selling-rules$/);
  });

  test("comptes et accès : rôles expliqués, matrice issue des permissions, ancienne adresse redirigée", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/members");
    await expect(page).toHaveURL(/\/app\/settings\/access$/);
    await expect(page.getByText("Pour votre comptable ou un observateur")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Qui peut faire quoi" })).toBeVisible();
    const row = page.getByRole("row", { name: /Confirmer un achat réel/ });
    if (isMobile(page)) {
      // Sur mobile, un rôle à la fois.
      await expect(row.getByLabel("Autorisé", { exact: true }).filter({ visible: true })).toHaveCount(1);
      await page.getByLabel("Rôle affiché").selectOption("viewer");
      await expect(row.getByLabel("Non autorisé", { exact: true }).filter({ visible: true })).toHaveCount(1);
    } else {
      await expect(row.getByLabel("Autorisé", { exact: true })).toHaveCount(1);
      await expect(row.getByLabel("Non autorisé", { exact: true })).toHaveCount(3);
    }
    await page.getByLabel("Rôle de Karim Benali").selectOption("viewer");
    await expect(page.getByText("Rôle mis à jour")).toBeVisible();
  });

  test("assistant IA : état en pourcentages, sans compteur de jetons", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/ai");
    await expect(page.getByRole("heading", { name: "État de l'assistant" })).toBeVisible();
    for (const label of ["Disponibilité", "Quota du mois", "Brouillons validés", "Refus et replis"]) {
      await expect(page.getByRole("img", { name: new RegExp(`^${label} : \\d+ %$`) })).toBeVisible();
    }
    await expect(page.getByText("Disjoncteur", { exact: true })).toBeVisible();
    await expect(page.getByText(/Délai maximal \d/).first()).toBeVisible();
    await expect(page.getByText(/simulateur déterministe/)).toBeVisible();
    await expect(page.getByText(/jetons?|tokens?/i)).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Réponse à un message" }).first()).toBeVisible();
    await page.getByText("Détails techniques").click();
    await expect(page.getByText("Délai maximal par requête")).toBeVisible();
  });
});
