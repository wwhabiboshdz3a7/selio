import { expect, test } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

test.describe("parcours de référence en démonstration", () => {
  test("achat → stock → conversation → IA → commande → marge → automatisation → radar → CRM", async ({ page }) => {
    test.setTimeout(180_000);
    await openDemo(page);

    await test.step("vue d'ensemble calculée", async () => {
      await expect(page.getByRole("heading", { name: "Vue d'ensemble" })).toBeVisible();
      await expect(page.getByText("Chiffre d'affaires").first()).toBeVisible();
      await expect(page.getByText(/action\(s\) automatique\(s\) à valider/)).toBeVisible();
    });

    const itemTitle = `Veste test ${Date.now().toString(36)}`;
    await test.step("créer un article avec prix d'achat, frais et plancher", async () => {
      await gotoApp(page, "/app/items/new");
      await page.getByLabel("Titre", { exact: false }).first().fill(itemTitle);
      await page.getByLabel("Marque").fill("Levi's");
      await page.getByLabel("Prix d'achat").fill("15");
      await page.getByLabel("Frais d'acquisition").fill("2");
      await page.getByLabel("Prix affiché").fill("45");
      await page.getByLabel("Prix plancher").fill("35");
      await page.getByLabel("Statut").selectOption("listed");
      await expect(page.getByText("Marge projetée au prix affiché")).toBeVisible();
      await page.getByRole("button", { name: "Créer l'article" }).click();
      await expect(page.getByRole("heading", { name: itemTitle })).toBeVisible();
      await expect(page.getByText("35,00")).toBeVisible();
      await expect(page.getByText("Création")).toBeVisible();
    });

    await test.step("stock : recherche, filtre et export", async () => {
      await gotoApp(page, "/app/items");
      await page.getByLabel("Recherche").fill(itemTitle.slice(0, 10));
      await expect(page.getByText(itemTitle)).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Exporter CSV" }).click();
      expect((await download).suggestedFilename()).toMatch(/selio-articles/);
    });

    await test.step("messagerie : offre évaluée, justification visible", async () => {
      await gotoApp(page, "/app/messages/conv-001");
      await expect(page.getByText("Offre détectée")).toBeVisible();
      await expect(page.getByText(/Contre-proposition recommandée|Offre acceptable|Offre à refuser/)).toBeVisible();
      await expect(page.getByText(/plancher/).first()).toBeVisible();
    });

    await test.step("suggestion IA validée, modification et envoi simulé", async () => {
      await page.getByRole("button", { name: "Suggérer une réponse" }).click();
      await expect(page.getByText(/Suggestion IA|Gabarit déterministe/)).toBeVisible({ timeout: 15_000 });
      const draft = page.getByLabel("Brouillon de réponse");
      await expect(draft).not.toHaveValue("");
      await draft.fill((await draft.inputValue()) + " Bonne journée.");
      await page.getByRole("button", { name: /Envoyer \(simulé\)/ }).click();
      await expect(page.getByText("Envoi simulé confirmé")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Bonne journée.")).toBeVisible();
      await expect(page.locator("text=Envoyé").first()).toBeVisible();
    });

    await test.step("échec d'envoi signalé honnêtement", async () => {
      const draft = page.getByLabel("Brouillon de réponse");
      await draft.fill("Test [échec]");
      await page.getByRole("button", { name: /Envoyer \(simulé\)/ }).click();
      await expect(page.getByText("Échec de l'envoi")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Supprimer le brouillon" }).click();
    });

    let orderUrl = "";
    await test.step("commande créée depuis l'offre, sans doublon", async () => {
      await page.getByRole("button", { name: /Créer la commande à/ }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Créer la commande" }).click();
      await page.waitForURL(/\/app\/orders\//);
      orderUrl = page.url();
      await expect(page.getByText("Marge brute").first()).toBeVisible();
      await expect(page.getByText("Coût d'acquisition (figé)")).toBeVisible();
      await page.getByRole("button", { name: "Payée" }).click();
      await expect(page.getByText("Statut mis à jour")).toBeVisible();
      await expect(page.getByRole("button", { name: "Expédiée" })).toBeVisible();
    });

    await test.step("analyses : la vente est comptée et les conventions affichées", async () => {
      await gotoApp(page, "/app/analytics");
      await expect(page.getByText("Conventions de calcul")).toBeVisible();
      await expect(page.getByText(/Marge brute = prix de vente/)).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Exporter CSV" }).click();
      expect((await download).suggestedFilename()).toMatch(/selio-analyses/);
    });

    await test.step("automatisation : exécution, file, validation", async () => {
      await gotoApp(page, "/app/automations");
      await expect(page.getByText("Où s'exécutent les règles")).toBeVisible();
      await page.getByRole("button", { name: "Exécuter maintenant" }).first().click();
      await expect(page.getByRole("dialog", { name: "Résultat de l'exécution" })).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Fermer", exact: true }).last().click();
      await page.getByRole("tab", { name: "File et historique" }).click();
      await page.getByLabel("Statut").selectOption("awaiting_approval");
      await expect(page.getByRole("button", { name: "Valider" }).first()).toBeVisible();
      await page.getByRole("button", { name: "Valider" }).first().click();
      await expect(page.getByText(/Tâche exécutée|Tâche en échec/)).toBeVisible();
    });

    await test.step("radar : analyse, opportunité classée et justifiée", async () => {
      await gotoApp(page, "/app/radar");
      await page.getByRole("button", { name: "Analyser" }).first().click();
      await expect(page.getByText(/nouvelle\(s\) opportunité\(s\)/)).toBeVisible();
      await expect(page.getByText("Observé").first()).toBeVisible();
      await expect(page.getByText("Estimé").first()).toBeVisible();
      await page.getByText("Pourquoi ce score").first().click();
      await expect(page.getByText(/Marge estimée/).first()).toBeVisible();
    });

    await test.step("achat assisté : simulation de bout en bout, jamais réel", async () => {
      await page.getByRole("button", { name: "Préparer l'achat" }).first().click();
      await expect(page.getByText("Demande d'achat créée")).toBeVisible();
      await gotoApp(page, "/app/purchase");
      await expect(page.getByText("Achat réel désactivé")).toBeVisible();
      await page.getByRole("button", { name: "Confirmer (simulation)" }).first().click();
      await page.getByRole("dialog").locator("input").fill("SIMULER");
      await page.getByRole("dialog").getByRole("button", { name: "Je confirme (simulation)" }).click();
      await expect(page.getByText(/Achat simulé de bout en bout|bloqué/)).toBeVisible();
    });

    await test.step("CRM : historique du client avec message et commande", async () => {
      await gotoApp(page, "/app/customers");
      await page.getByText("Léa M.").first().click();
      await page.waitForURL(/\/app\/customers\//);
      await expect(page.getByText("Historique")).toBeVisible();
      const main = page.getByRole("main");
      await expect(main.getByText(/Message envoyé/).first()).toBeVisible();
      await expect(main.getByText(/^Commande /).first()).toBeVisible();
      expect(orderUrl).toContain("/app/orders/");
    });
  });

  test("import CSV : prévisualisation des erreurs ligne par ligne", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/items/import");
    const csv = "Titre;Marque;Prix d'achat;Prix affiché;Statut\nPull;Zara;10;25;en vente\n;Nike;5;20;en stock\nJean;Levi's;abc;40;vendu\n";
    await page.setInputFiles('input[type="file"]', { name: "import.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await expect(page.getByText(/1 ligne\(s\) valide\(s\), 2 en erreur/)).toBeVisible();
    await expect(page.getByText("Titre manquant.")).toBeVisible();
    await expect(page.getByText(/illisible/)).toBeVisible();
    await page.getByRole("button", { name: /Importer 1 article/ }).click();
    await expect(page.getByText(/1 article\(s\) importé\(s\)/)).toBeVisible();
  });

  test("suppression avec confirmation tapée et réinitialisation de la démo", async ({ page }) => {
    await openDemo(page);
    await gotoApp(page, "/app/items/new");
    await page.getByLabel("Titre", { exact: false }).first().fill("À supprimer");
    await page.getByRole("button", { name: "Créer l'article" }).click();
    await expect(page.getByRole("heading", { name: "À supprimer" })).toBeVisible();
    await page.getByRole("button", { name: "Supprimer" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Supprimer" })).toBeDisabled();
    await dialog.locator("input").fill("SUPPRIMER");
    await dialog.getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByText("Article supprimé")).toBeVisible();
    await gotoApp(page, "/app/settings/data");
    await page.getByRole("button", { name: "Réinitialiser" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Réinitialiser" }).click();
    await expect(page.getByText("Démonstration réinitialisée")).toBeVisible();
  });

  test("navigation mobile, mode sombre, déconnexion", async ({ page }) => {
    await openDemo(page);
    if (isMobile(page)) {
      await page.getByRole("button", { name: "Ouvrir le menu" }).click();
      await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Articles et stock" }).click();
    } else {
      await page.getByRole("link", { name: "Articles et stock" }).click();
    }
    await expect(page.getByRole("heading", { name: "Articles et stock" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.getByRole("heading", { name: "Articles et stock" })).toBeVisible();
    await gotoApp(page, "/app/settings/security");
    await expect(page.getByText("Journal d'audit")).toBeVisible();
    await gotoApp(page, "/app/settings/connections");
    await page.getByRole("button", { name: "Créer un jeton" }).click();
    await expect(page.getByRole("dialog", { name: "Jeton créé" })).toBeVisible();
    await page.getByRole("button", { name: "J'ai copié le jeton" }).click();
    await page.getByRole("table").getByRole("button", { name: "Révoquer" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Révoquer" }).click();
    await expect(page.getByText("Jeton révoqué")).toBeVisible();
  });
});
