import { expect, test, type Page } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

// PNG 1×1 valide : le navigateur doit pouvoir le décoder pour le compresser.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** Ouvre le sélecteur d'espace (dans le tiroir sur mobile) et choisit un espace. */
async function switchSpace(page: Page, name: RegExp): Promise<void> {
  if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: /Changer d'espace/ }).last().click();
  await page.getByRole("navigation", { name: "Changer d'espace" }).getByRole("link", { name }).click();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

test.describe("espaces Selio", () => {
  test("accueil central après /demo, sélecteur d'espace et menus propres", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openDemo(page, null);
    await expect(page.getByRole("heading", { name: "Vos espaces Selio" })).toBeVisible();
    for (const name of ["Selio", "Selio Studio", "Selio Agence", "Selio Global"]) await expect(page.getByRole("article", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Agence" }).getByText("Aperçu", { exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Global" }).getByText("En préparation", { exact: true })).toBeVisible();
    await expect(page.getByText("Comment les espaces s'enchaînent")).toBeVisible();
    // Chiffres de Selio calculés depuis les données de la démo (plus de tiret une fois chargés).
    await expect(page.getByRole("article", { name: "Selio", exact: true }).getByRole("definition").first()).not.toHaveText("—");
    await noHorizontalOverflow(page);

    await page.getByRole("link", { name: "Ouvrir Selio Studio" }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("heading", { name: "Générateur d'annonces" })).toBeVisible();

    await switchSpace(page, /^Selio Agence/);
    await expect(page).toHaveURL(/\/agence$/);
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    // Tableau sur grand écran, cartes sur mobile : on vérifie ce qui est affiché.
    await expect(page.getByText("Exemple fictif", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("Vos données", { exact: true }).filter({ visible: true })).toHaveCount(1);

    await switchSpace(page, /^Selio Global/);
    await expect(page).toHaveURL(/\/global$/);
    await expect(page.getByRole("heading", { name: "Marchés" })).toBeVisible();

    await switchSpace(page, /^Selio\b(?! Studio| Agence| Global)/);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
    // L'ancienne adresse du générateur mène à Selio Studio.
    await gotoApp(page, "/app/studio");
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByText("Cette page a rencontré un problème")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("connexion : l'accueil central est la page d'arrivée", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByRole("button", { name: "Entrer dans la démonstration" }).click();
    await page.waitForURL((url) => url.pathname === "/app/espaces");
    await expect(page.getByRole("heading", { name: "Vos espaces Selio" })).toBeVisible();
    // Depuis n'importe quel espace, le sélecteur ramène à cet accueil.
    await page.goto("/global/tailles");
    if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await page.getByRole("button", { name: /Changer d'espace/ }).last().click();
    await page.getByRole("link", { name: /accueil central/ }).click();
    await expect(page).toHaveURL(/\/app\/espaces$/);
  });

  test("Selio Studio : série d'annonces, historique noté, ce qui performe", async ({ page }) => {
    await openDemo(page, "/studio");
    await page.getByLabel("Choisir des photos").setInputFiles([{ name: "ralph-lauren-pull-bleu-marine-M.png", mimeType: "image/png", buffer: PNG }]);
    await page.getByRole("button", { name: "Générer l'annonce" }).click();
    await expect(page.getByText("Annonce proposée")).toBeVisible({ timeout: 15_000 });
    const title = await page.getByLabel(/Titre/).first().inputValue();
    await page.getByRole("button", { name: "Publier directement" }).click();
    await expect(page.getByRole("heading", { name: "Annonce mise en vente" })).toBeVisible();
    const series = page.getByRole("region", { name: "Série en cours" });
    await expect(series).toContainText("1 annonce");
    await page.getByRole("button", { name: "Article suivant" }).click();
    await expect(page.getByText("Glissez vos photos ici")).toBeVisible();
    await expect(series).toBeVisible();

    await gotoApp(page, "/studio/annonces");
    await expect(page.getByRole("heading", { name: "Annonces générées" })).toBeVisible();
    const list = page.getByRole("list", { name: "Annonces générées" });
    await expect(list.getByText(title).first()).toBeVisible();
    await expect(list.getByRole("img", { name: /Note du dressing \d+ sur 100/ }).first()).toBeVisible();
    await page.getByRole("radio", { name: /Vendues/ }).click();
    await expect(list.getByText(/Vendue en \d+ j/).first()).toBeVisible();

    await gotoApp(page, "/studio/performances");
    await expect(page.getByRole("heading", { name: "Ce qui performe" })).toBeVisible();
    await expect(page.getByText(/calculé sur vos \d+ annonces mises en ligne/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quelle longueur de titre se vend le mieux ?" })).toBeVisible();
    await expect(page.getByText(/Échantillon modeste/)).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test("Selio Agence : marque blanche en aperçu direct, enregistrée dans la démo", async ({ page }) => {
    await openDemo(page, "/agence/marque-blanche");
    await expect(page.getByText("Selio Agence est en aperçu")).toBeVisible();
    await page.getByLabel("Nom de l'agence").fill("Dépôt Lumière");
    await page.getByLabel("Logo texte").fill("dl");
    await page.getByRole("radio", { name: "Jade" }).click();
    await expect(page.getByRole("radio", { name: "Jade" })).toHaveAttribute("aria-checked", "true");
    const preview = page.getByLabel("Aperçu en direct de la marque blanche");
    await expect(preview.getByText("Dépôt Lumière").filter({ visible: true }).first()).toBeVisible();
    await expect(preview.getByText("DL", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Marque blanche enregistrée dans la démonstration")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Nom de l'agence")).toHaveValue("Dépôt Lumière");
    await expect(page.getByText(/Enregistrée le/)).toBeVisible();
    await gotoApp(page, "/app/espaces");
    // L'accueil central reprend la marque enregistrée (logo texte et nom).
    const agencyCard = page.getByRole("article", { name: "Selio Agence" });
    await expect(agencyCard.getByText("Dépôt Lumière").first()).toBeVisible();
    await expect(agencyCard.getByText("DL", { exact: true })).toBeVisible();
    await gotoApp(page, "/agence/facturation");
    await expect(page.getByText("Non facturé · aperçu").filter({ visible: true })).toHaveCount(5);
    await expect(page.getByText("Total du mois (exemple)").filter({ visible: true })).toHaveCount(1);
    await gotoApp(page, "/agence/equipe");
    await expect(page.getByRole("link", { name: /Gérer dans Paramètres/ })).toHaveAttribute("href", "/app/settings/access");
  });

  test("Selio Global : convertisseur de tailles et places de marché dans l'ordre", async ({ page }) => {
    await openDemo(page, "/global/tailles");
    await expect(page.getByRole("heading", { name: "Convertisseur de tailles" })).toBeVisible();
    await page.getByLabel("Système de la taille").selectOption("UK");
    await page.getByLabel("Taille", { exact: true }).selectOption("14");
    await expect(page.getByText("UK 14 correspond à :")).toBeVisible();
    const fr = page.locator("li", { has: page.getByText("FR", { exact: true }) });
    await expect(fr.getByText("42", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Chaussures homme" }).click();
    await expect(page.getByText("EU 41 correspond à :")).toBeVisible();
    await expect(page.locator("li", { has: page.getByText("US", { exact: true }) }).getByText("8", { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await gotoApp(page, "/global/places-de-marche");
    const names = await page.getByRole("list", { name: "Places de marché, dans l'ordre prévu" }).getByRole("heading").allTextContents();
    expect(names).toEqual(["Vinted", "Leboncoin", "eBay", "Etsy", "Shopify"]);
    await expect(page.getByText("Prévu", { exact: true })).toHaveCount(4);
  });
});
