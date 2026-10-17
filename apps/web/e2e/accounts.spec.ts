import { expect, test } from "@playwright/test";
import { gotoApp, openDemo } from "./helpers";

test.describe("comptes Vinted", () => {
  test("comptes catégorisés : filtres, changement de catégorie en un clic, ajout, extension repliée", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/accounts");
    await expect(page.getByRole("heading", { name: "Comptes Vinted" })).toBeVisible();
    await expect(page.getByText(/aucun mot de passe|sans jamais demander ni stocker votre mot de passe/).first()).toBeVisible();

    // Filtres par catégorie, avec compteurs ; l'onglet se retrouve dans l'adresse.
    const tabs = page.getByRole("tablist", { name: "Catégories de comptes" });
    await tabs.getByRole("tab", { name: /Achat/ }).click();
    await expect(page).toHaveURL(/categorie=achat/);
    await expect(page.getByRole("article", { name: "Compte @marie.chineuse" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Compte @atelier.secondemain" })).toHaveCount(0);
    await tabs.getByRole("tab", { name: /Tous/ }).click();
    await expect(page.getByRole("article", { name: "Compte @atelier.secondemain" })).toBeVisible();

    // Catégorie modifiable en un clic.
    await page.getByRole("radiogroup", { name: "Catégorie du compte Boutique vintage" }).getByRole("radio", { name: "Perso" }).click();
    await expect(page.getByText("« Boutique vintage » classé en Perso : aucune automatisation ne l'utilisera")).toBeVisible();
    await tabs.getByRole("tab", { name: /Perso/ }).click();
    await expect(page.getByRole("article", { name: "Compte @secondemain.vintage" })).toBeVisible();
    await tabs.getByRole("tab", { name: /Tous/ }).click();

    // Ajout d'un compte : pseudo, nom interne, catégorie expliquée.
    await page.getByRole("button", { name: "Ajouter un compte" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Ajouter un compte Vinted" });
    await expect(dialog.getByText(/jamais utilisé par les automatisations/)).toBeVisible();
    await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
    await expect(dialog.getByText("Indiquez le pseudo du compte Vinted.")).toBeVisible();
    await dialog.getByLabel("Pseudo Vinted").fill("@nouvelle.boutique");
    await dialog.getByLabel("Nom interne").fill("Boutique d'essai");
    await dialog.getByRole("radio", { name: /^Achat/ }).check();
    await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
    await expect(page.getByText(/Compte ajouté/)).toBeVisible();
    const added = page.getByRole("article", { name: "Compte @nouvelle.boutique" });
    await expect(added).toBeVisible();
    await expect(added.getByRole("radio", { name: "Achat" })).toBeChecked();

    // Jetons d'extension : repliés par défaut, accessibles dans « Avancé ».
    await expect(page.getByRole("button", { name: "Créer un jeton" })).toBeHidden();
    await page.getByText("Avancé — relier l'extension Selio").click();
    await expect(page.getByRole("button", { name: "Créer un jeton" })).toBeVisible();
  });

  test("le générateur d'annonces ne propose pas le compte Achat", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/studio");
    const select = page.getByLabel("Compte Vinted");
    const options = await select.locator("option").allTextContents();
    expect(options.some((o) => o.includes("@atelier.secondemain"))).toBe(true);
    expect(options.some((o) => o.includes("marie.chineuse"))).toBe(false);
    expect(options.at(-1)).toMatch(/\(perso\)$/);
  });
});
