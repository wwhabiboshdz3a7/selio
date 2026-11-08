import { expect, test, type Page } from "@playwright/test";
import { gotoApp, openDemo } from "./helpers";

// PNG 1×1 valide.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** Essai de rôle de la démonstration, depuis Paramètres › Comptes et accès. */
async function previewAs(page: Page, roleValue: string, label: string): Promise<void> {
  await gotoApp(page, "/app/settings/access");
  await page.getByLabel("Voir comme").selectOption(roleValue);
  await page.getByRole("button", { name: "Voir comme ce rôle" }).click();
  await expect(page.getByTestId("role-preview-banner")).toContainText(label);
}

async function backToOwnRole(page: Page): Promise<void> {
  await page.getByTestId("role-preview-banner").getByRole("button", { name: "Revenir à mon rôle" }).click();
  await expect(page.getByTestId("role-preview-banner")).toHaveCount(0);
}

test.describe("équipe : rôles, finances masquées, contributeur photos, parrainage, Selio Comptes, supervision", () => {
  test("exécuteur : publie et répond, mais les finances sont masquées dans l'interface", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByText("Chiffre d'affaires").first()).toBeVisible();
    await expect(page.locator("[data-finance-masked]")).toHaveCount(0);
    await previewAs(page, "operator", "Exécuteur");
    await gotoApp(page, "/app");
    await expect(page.getByTestId("finance-masked-note")).toBeVisible();
    await expect(page.locator("[data-finance-masked]").first()).toBeVisible();
    await gotoApp(page, "/app/items");
    await expect(page.getByRole("button", { name: /Exporter CSV/ })).toHaveCount(0);
    await expect(page.locator("[data-finance-masked]").first()).toBeAttached();
    await gotoApp(page, "/app/settings/billing");
    await expect(page.getByTestId("finance-route-blocked")).toBeVisible();
    // Il garde la messagerie et les commandes.
    await gotoApp(page, "/app/messages");
    await expect(page.getByRole("heading", { name: "Messagerie", level: 1 })).toBeVisible();
    await backToOwnRole(page);
    await gotoApp(page, "/app");
    await expect(page.locator("[data-finance-masked]")).toHaveCount(0);
  });

  test("contributeur photos : vue réduite (articles → photos, Studio), ajout d'une photo, le reste refusé", async ({ page }) => {
    await openDemo(page);
    await previewAs(page, "photographer", "Contributeur photos");
    await gotoApp(page, "/app");
    await expect(page).toHaveURL(/\/app\/items\/photos$/);
    await expect(page.getByRole("heading", { name: "Articles à photographier", level: 1 })).toBeVisible();
    const first = page.getByRole("list", { name: "Articles à photographier" }).getByRole("link").first();
    const before = Number((await first.textContent())!.match(/(\d+) \/ 12 photos/)![1]);
    await first.click();
    await expect(page).toHaveURL(/\/app\/items\/[^/]+\/photos$/);
    await page.getByLabel("Ajouter des photos").setInputFiles([{ name: "dos.png", mimeType: "image/png", buffer: PNG }]);
    await page.getByRole("button", { name: /Enregistrer 1 photo/ }).click();
    await expect(page.getByText(`Photos ajoutées : ${before + 1} au total`)).toBeVisible();
    await gotoApp(page, "/studio");
    await expect(page.getByRole("heading", { name: "Générateur d'annonces" })).toBeVisible();
    await gotoApp(page, "/app/orders");
    await expect(page.getByTestId("reduced-view-blocked")).toBeVisible();
    await backToOwnRole(page);
  });

  test("parrainage : code et lien à copier, filleules, « un mois offert aux deux » en proposition", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/settings/parrainage");
    await expect(page.getByRole("heading", { name: "Un mois offert aux deux" })).toBeVisible();
    await expect(page.getByTestId("referral-proposal")).toHaveText("Proposition");
    await expect(page.getByLabel("Votre code")).toHaveValue(/^[A-Z2-9]{6}$/);
    await expect(page.getByLabel("Lien d'inscription à partager")).toHaveValue(/\/inscription\?parrain=[A-Z2-9]{6}$/);
    // En attente, qualifiée, mois appliqués, refusée (contrôle d'auto-parrainage au premier paiement).
    await expect(page.getByRole("list", { name: "Filleules par statut" }).getByRole("listitem")).toHaveCount(4);
  });

  test("inscription par le lien partagé : code prérempli depuis ?parrain=, transmis, réponse affichée", async ({ page }) => {
    await page.goto("/inscription?parrain=ab3-k7q");
    const field = page.getByLabel("Code de parrainage");
    await expect(field).toHaveValue("AB3K7Q");
    await page.getByLabel("Votre nom").fill("Inès Test");
    await page.getByLabel("Nom de l'organisation").fill("Boutique Inès");
    await page.getByLabel("Email").fill("ines@exemple.test");
    await page.getByLabel("Mot de passe").fill("motdepasse-solide-1");
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await page.waitForURL((url) => url.pathname === "/app/onboarding", { timeout: 20_000 });
    await expect(page.getByTestId("referral-message")).toContainText("AB3K7Q");
    await expect(page.getByTestId("referral-message")).toContainText("aucun mois offert");
  });

  test("Selio Comptes : /generateur redirigé, bandeau, checklist cochée gardée, textes à copier", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/generateur");
    await expect(page).toHaveURL(/\/comptes$/);
    await expect(page.getByTestId("comptes-notice")).toHaveText("Selio ne crée aucun compte à votre place : vous suivez la checklist dans Vinted.");
    await page.getByRole("checkbox", { name: /Confirmer l'adresse email/ }).check();
    await expect(page.getByTestId("comptes-progress")).toContainText("1 /");
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Confirmer l'adresse email/ })).toBeChecked();
    await page.getByLabel("Délai d'expédition (jours ouvrés)").fill("3");
    await expect(page.getByRole("textbox", { name: "Règles d'envoi" })).toHaveValue(/Expédition sous 3 jours ouvrés/);
    await expect(page.getByRole("button", { name: "Copier « Présentation »" })).toBeVisible();
  });

  test("Admin › Supervision : état de l'API, cibles et alertes", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/admin/supervision");
    await expect(page.getByRole("navigation", { name: "Sections de l'administration" }).getByRole("link", { name: "Supervision" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Cibles vérifiées chaque minute" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Alertes de supervision" }).getByRole("listitem")).toHaveCount(3);
  });
});
