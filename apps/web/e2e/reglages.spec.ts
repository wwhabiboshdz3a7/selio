import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

test.describe("réglages : négociation, comptes et accès, assistant IA", () => {
  test("négociation automatique : parcours vertical sans profil tout fait, illustrations qui suivent les réglages", async ({ page }) => {
    await openDemo(page);
    // On y arrive depuis la négociation elle-même, dans la Messagerie ; l'ancienne adresse redirige.
    await gotoApp(page, "/app/messages/conv-001");
    await page.getByRole("link", { name: /Calculé avec vos règles de négociation/ }).click();
    await expect(page).toHaveURL(/\/app\/automatisation\/negociation$/);
    await expect(page.getByRole("heading", { name: "Négociation automatique", level: 1 })).toBeVisible();
    await gotoApp(page, "/app/selling-rules");
    await expect(page).toHaveURL(/\/app\/automatisation\/negociation$/);
    // Plus de profils « Prudent / Équilibré / Écouler vite » : dix étapes, de haut en bas.
    await expect(page.getByRole("radio", { name: /Prudent|Équilibré|Écouler vite/ })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Étapes de la négociation automatique" }).getByRole("heading", { level: 2 })).toHaveCount(10);

    // Article d'exemple à 15 € : tranche 10 à 19,99 €, marge 15 % → jamais sous 12,50 €.
    const step1 = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /Règles de négociation/ }) });
    await expect(step1.getByText(/jamais sous/)).toContainText("12,50");
    await page.getByLabel("Marge de la tranche 2 (%)").fill("30");
    await expect(step1.getByText(/jamais sous/)).toContainText("10,50");
    await expect(page.getByText("Modifications non enregistrées.")).toBeVisible();

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Négociation enregistrée", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Marge de la tranche 2 (%)")).toHaveValue("30");
  });

  test("organisation : réglages généraux seulement, avec renvoi vers les règles de vente et d'achat", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/organisation");
    await expect(page.getByLabel("Fuseau horaire")).toBeVisible();
    await expect(page.getByText("Règles de marge et de négociation")).toHaveCount(0);
    await expect(page.getByLabel("Remise maximale (%)")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Achat auto/ }).last()).toHaveAttribute("href", "/app/auto-buy");
    await page.getByRole("link", { name: /Négociation automatique · Automatisation/ }).click();
    await expect(page).toHaveURL(/\/app\/automatisation\/negociation$/);
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
