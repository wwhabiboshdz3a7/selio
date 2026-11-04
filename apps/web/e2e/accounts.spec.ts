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

    // Quota de l'offre (D18 : 3 comptes en Pro et pendant l'essai). La démo compte déjà 4 comptes
    // Vinted (D19, à trancher) : l'ajout est refusé proprement et l'alerte dit comment s'en sortir.
    const quotaLine = (used: number) => page.getByText(new RegExp(`^${used} comptes? Vinted sur 3 inclus dans votre abonnement`));
    await expect(quotaLine(4)).toBeVisible();
    await page.getByRole("button", { name: "Ajouter un compte" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Ajouter un compte Vinted" });
    await expect(dialog.getByText(/jamais utilisé par les automatisations/)).toBeVisible();
    const quotaAlert = dialog.getByRole("alert").filter({ hasText: "Quota de comptes atteint" });
    await expect(quotaAlert).toContainText("Votre abonnement inclut 3 compte(s) Vinted.");
    await expect(quotaAlert.getByRole("link", { name: "Changer d'abonnement" })).toHaveAttribute("href", "/app/settings/billing");
    await expect(dialog.getByRole("button", { name: "Ajouter le compte" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Annuler" }).click();
    await expect(dialog).toBeHidden();

    // Libérer une place en supprimant des comptes inutilisés : à 3 sur 3 l'ajout reste bloqué, à 2 il s'ouvre.
    for (const [label, left] of [["Compte perso", 3], ["Boutique vintage", 2]] as const) {
      await page.getByRole("button", { name: `Plus d'actions pour ${label}` }).click();
      await page.getByRole("menuitem", { name: "Supprimer" }).click();
      const confirm = page.getByRole("dialog", { name: new RegExp(`^Supprimer « ${label} »`) });
      await confirm.getByRole("button", { name: "Supprimer" }).click();
      await expect(confirm).toBeHidden();
      await expect(quotaLine(left)).toBeVisible();
      if (left === 3) {
        await page.getByRole("button", { name: "Ajouter un compte" }).first().click();
        await expect(quotaAlert).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Ajouter le compte" })).toBeDisabled();
        await dialog.getByRole("button", { name: "Annuler" }).click();
        await expect(dialog).toBeHidden();
      }
    }
    await expect(page.getByRole("article", { name: "Compte @secondemain.vintage" })).toHaveCount(0);

    // Ajout d'un compte : pseudo, nom interne, catégorie expliquée.
    await page.getByRole("button", { name: "Ajouter un compte" }).first().click();
    await expect(dialog.getByText(/jamais utilisé par les automatisations/)).toBeVisible();
    await expect(quotaAlert).toHaveCount(0);
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
    await expect(quotaLine(3)).toBeVisible();

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
