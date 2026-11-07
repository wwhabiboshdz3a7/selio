import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

// PNG 1×1 valide : le navigateur doit pouvoir le décoder pour le compresser.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test.describe("nouveaux modules", () => {
  test("générateur d'annonces : photos → préparation (tri, étiquette, mesures) → annonce → publication", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/studio");
    await expect(page.getByRole("heading", { name: "Générateur d'annonces" })).toBeVisible();
    await page.getByLabel("Choisir des photos").setInputFiles([{ name: "ralph-lauren-pull-bleu-marine-M.png", mimeType: "image/png", buffer: PNG }]);
    await expect(page.getByText("Couverture", { exact: true })).toBeVisible();
    // La marque vient du vendeur : rien n'est lu sur une vraie photo par le simulateur, rien n'est déduit du nom du fichier.
    await page.getByLabel("Marque (facultatif)").fill("Ralph Lauren");
    await page.getByRole("button", { name: "Préparer l'annonce" }).click();
    await expect(page.getByRole("heading", { name: "Tri des photos" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1 photo rangée en 1 article/)).toBeVisible();
    await page.getByRole("button", { name: "Continuer vers l'étiquette" }).click();
    await expect(page.getByRole("heading", { name: "Étiquette" })).toBeVisible();
    await expect(page.getByLabel("Marque", { exact: true })).toHaveValue("Ralph Lauren");
    await expect(page.getByText("Indiquée par le vendeur").first()).toBeVisible();
    // Taille et matière : illisibles → champs vides avec leur question, jamais « M » deviné d'après le nom du fichier.
    await expect(page.getByLabel("Taille", { exact: true })).toHaveValue("");
    await expect(page.getByText("À renseigner").first()).toBeVisible();
    await expect(page.getByText(/Quelle taille est indiquée sur l'étiquette/)).toBeVisible();
    await page.getByRole("button", { name: "Continuer vers les mesures" }).click();
    await expect(page.getByText("Jamais de mesure inventée")).toBeVisible();
    await expect(page.getByText(/Aucune photo avec un mètre ruban pour cet article/)).toBeVisible();
    await page.getByRole("button", { name: "Générer l'annonce" }).click();
    await expect(page.getByText("Annonce proposée")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/Titre/).first()).toHaveValue(/Ralph Lauren/);
    await expect(page.getByRole("region", { name: "Provenance des champs" })).toContainText("Indiquée par le vendeur");
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

  test("Selio Track, achat auto et galerie de graphiques", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/track");
    // Statistiques seulement : filtres suivis, quotas du mois et source des données (simulateur en démonstration).
    await expect(page.getByRole("heading", { name: "Filtres suivis" })).toBeVisible();
    await expect(page.getByText("Source des données")).toBeVisible();
    await expect(page.getByText("Simulateur", { exact: true })).toBeVisible();
    await gotoApp(page, "/app/auto-buy");
    await expect(page.getByText("Garde-fous")).toBeVisible();
    await page.getByRole("button", { name: "Annuler l'achat" }).first().click();
    // Le toast (exact) ; la ligne de l'achat affiche aussi sa note « Achat automatique annulé dans le délai… ».
    await expect(page.getByText("Achat automatique annulé", { exact: true })).toBeVisible();
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
