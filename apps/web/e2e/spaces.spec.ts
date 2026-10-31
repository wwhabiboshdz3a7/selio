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

test.describe("Selio et ses filiales", () => {
  test("accueil central après /demo, sélecteur d'espace et menus propres", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openDemo(page, null);
    await expect(page.getByRole("heading", { name: "Selio et ses filiales" })).toBeVisible();
    for (const name of ["Selio", "Selio Studio", "Selio Agents", "Selio Track", "Selio Cloud", "Générateur de compte Vinted"]) await expect(page.getByRole("article", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Global" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Selio Agents" }).getByText("Aperçu", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("article", { name: "Selio Cloud" }).getByText("En développement", { exact: true })).toBeVisible();
    await expect(page.getByText("Comment les filiales s'enchaînent")).toBeVisible();
    // Chiffres de Selio calculés depuis les données de la démo (plus de tiret une fois chargés).
    await expect(page.getByRole("article", { name: "Selio", exact: true }).getByRole("definition").first()).not.toHaveText("—");
    await noHorizontalOverflow(page);

    await page.getByRole("link", { name: "Ouvrir Selio Studio" }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("heading", { name: "Générateur d'annonces" })).toBeVisible();

    await switchSpace(page, /^Selio Agents/);
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByRole("heading", { name: "Équipe et accès" })).toBeVisible();

    await switchSpace(page, /^Selio Track/);
    await expect(page).toHaveURL(/\/track$/);
    await expect(page.getByText("Top revendeurs")).toBeVisible();

    await switchSpace(page, /^Selio Cloud/);
    await expect(page).toHaveURL(/\/cloud$/);
    await expect(page.getByRole("heading", { name: "Comment ça marchera" })).toBeVisible();

    await switchSpace(page, /^Selio\b(?! Studio| Agents| Track| Cloud)/);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
    // Anciennes adresses : générateur → Studio, Agence → Agents, Global → accueil des filiales.
    await gotoApp(page, "/app/studio");
    await expect(page).toHaveURL(/\/studio$/);
    await gotoApp(page, "/agence/equipe");
    await expect(page).toHaveURL(/\/agents$/);
    await gotoApp(page, "/global/tailles");
    await expect(page).toHaveURL(/\/app\/espaces$/);
    await expect(page.getByText("Cette page a rencontré un problème")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("connexion : l'accueil central est la page d'arrivée", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByRole("button", { name: "Entrer dans la démonstration" }).click();
    await page.waitForURL((url) => url.pathname === "/app/espaces");
    await expect(page.getByRole("heading", { name: "Selio et ses filiales" })).toBeVisible();
    // Depuis n'importe quel espace, le sélecteur ramène à cet accueil.
    await page.goto("/generateur");
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

  test("Selio Agents : marque blanche en aperçu direct, enregistrée dans la démo ; comptes et accès dans l'administration", async ({ page }) => {
    await openDemo(page, "/agents/marque-blanche");
    await expect(page.getByText("Selio Agents est en aperçu")).toBeVisible();
    await page.getByLabel("Nom de l'agence").fill("Dépôt Lumière");
    await page.getByLabel("Logo texte").fill("dl");
    await page.getByRole("radio", { name: "Jade" }).click();
    await expect(page.getByRole("radio", { name: "Jade" })).toHaveAttribute("aria-checked", "true");
    const preview = page.getByLabel("Aperçu en direct de la marque blanche");
    await expect(preview.getByText("Dépôt Lumière").filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Marque blanche enregistrée dans la démonstration")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Nom de l'agence")).toHaveValue("Dépôt Lumière");
    await gotoApp(page, "/app/espaces");
    await expect(page.getByRole("article", { name: "Selio Agents" }).getByText("DL", { exact: true })).toBeVisible();
    await gotoApp(page, "/agents/facturation");
    await expect(page.getByText("Non facturé · aperçu").filter({ visible: true })).toHaveCount(5);
    await gotoApp(page, "/agents");
    await expect(page.getByRole("link", { name: /Gérer dans Paramètres/ })).toHaveAttribute("href", "/app/settings/access");
    // Comptes et accès : dans Paramètres et dans Opérateur › Administration.
    await gotoApp(page, "/admin/acces");
    await expect(page.getByRole("navigation", { name: "Sections de l'administration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Qui peut faire quoi" })).toBeVisible();
  });

  test("Automatisation : les quatre blocs, l'après-vente sans action manuelle et le stock automatique", async ({ page }) => {
    await openDemo(page, "/app/automatisation");
    await expect(page.getByRole("heading", { name: "Tout le parcours, automatisé" })).toBeVisible();
    for (const name of ["Messages aux favoris", "Réponse automatique", "Négociation automatique", "Message après-vente"]) await expect(page.getByRole("link", { name: new RegExp(name) }).filter({ visible: true }).first()).toBeVisible();
    await gotoApp(page, "/app/automatisation/apres-vente");
    await page.getByLabel("Impression automatique des bordereaux").check();
    await page.getByLabel("Imprimante").fill("Imprimante du bureau");
    await expect(page.getByText(/Commandé et imprimé sur « Imprimante du bureau »/)).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Réglages enregistrés", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Impression automatique des bordereaux")).toBeChecked();
    await gotoApp(page, "/app/automatisation/stock");
    await page.getByRole("switch", { name: /Remettre en ligne automatiquement/ }).click();
    await expect(page.getByText(/Remis en ligne automatiquement/).first()).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
