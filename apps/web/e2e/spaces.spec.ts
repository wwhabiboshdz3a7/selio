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
    // Selio Cloud est devenu un vrai espace (/cloud) en aperçu dans la démo : plus « En développement ».
    const cloud = page.getByRole("article", { name: "Selio Cloud" });
    await expect(cloud.getByText("Aperçu", { exact: true }).first()).toBeVisible();
    await expect(cloud.getByText("En développement", { exact: true })).toHaveCount(0);
    await expect(cloud.getByRole("link", { name: "Ouvrir Selio Cloud" })).toHaveAttribute("href", "/cloud");
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
    // Track remplace l'ancienne page Marché : tableau de bord des filtres suivis (simulateur signalé).
    await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Filtres suivis" })).toBeVisible();
    await expect(page.getByText("Scans de niche du mois")).toBeVisible();
    await expect(page.getByText(/^Données de démonstration : le simulateur remplace la lecture des pages/)).toBeVisible();

    await switchSpace(page, /^Selio Cloud/);
    await expect(page).toHaveURL(/\/cloud$/);
    // Selio Cloud est un vrai espace : son tableau de bord (plafond de 10 comptes), plus la page « Comment ça marchera ».
    await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByText("10 comptes maximum par organisation")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Comment ça marchera" })).toHaveCount(0);

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

  test("Selio Studio : photos d'exemple triées par article, étiquette et mètre ruban lus avec leur provenance, série d'annonces, historique noté, ce qui performe", async ({ page }) => {
    test.setTimeout(120_000);
    await openDemo(page, "/studio");
    // Photos d'exemple de la démonstration : un jean (face, dos, étiquette, mètre ruban) et un pull (face, étiquette peu lisible).
    await page.getByRole("button", { name: "Essayer avec des photos d'exemple" }).click();
    await expect(page.getByText("Couverture", { exact: true })).toBeVisible();
    await expect(page.getByText(/6\/12/)).toBeVisible();
    await page.getByRole("button", { name: "Préparer l'annonce" }).click();
    await expect(page.getByRole("heading", { name: "Tri des photos" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/6 photos rangées en 2 articles/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Article 1" })).toContainText("4 photos");
    await expect(page.getByLabel("Rôle de jean-etiquette.jpg")).toHaveValue("label");
    await expect(page.getByLabel("Rôle de jean-metre-ruban.jpg")).toHaveValue("tape");
    await page.getByRole("button", { name: "Continuer vers l'étiquette" }).click();
    // Étiquette du jean : lue avec sa confiance ; rien n'est déduit du style.
    await expect(page.getByRole("heading", { name: "Étiquette" })).toBeVisible();
    await expect(page.getByLabel("Marque", { exact: true })).toHaveValue("Levi's");
    await expect(page.getByText("Lue sur l'étiquette · confiance 92 %").first()).toBeVisible();
    await expect(page.getByLabel("Référence", { exact: true })).toHaveValue("501");
    await page.getByRole("button", { name: "Continuer vers les mesures" }).click();
    // Mesures : tour de taille lu sur le ruban, entrejambe retrouvé par la référence ; chaque valeur dit d'où elle vient.
    await expect(page.getByText("Jamais de mesure inventée")).toBeVisible();
    await expect(page.getByLabel("Tour de taille")).toHaveValue("41");
    await expect(page.getByText("Lue sur le mètre ruban · confiance 88 %")).toBeVisible();
    await expect(page.getByLabel("Entrejambe")).toHaveValue("81");
    await expect(page.getByText("Base des références", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Générer l'annonce" }).click();
    await expect(page.getByText("Annonce proposée")).toBeVisible({ timeout: 20_000 });
    const title = await page.getByLabel(/Titre/).first().inputValue();
    expect(title).toContain("Levi's");
    await expect(page.getByLabel("Description").first()).toHaveValue(/Mesures à plat : tour de taille 41 cm, entrejambe 81 cm/);
    await page.getByRole("button", { name: "Publier directement" }).click();
    await expect(page.getByRole("heading", { name: "Annonce mise en vente" })).toBeVisible();
    await expect(page.getByText("Encore 1 article dans cet envoi.")).toBeVisible();
    const series = page.getByRole("region", { name: "Série en cours" });
    await expect(series).toContainText("1 annonce");
    // Article suivant du même envoi : le pull, dont l'étiquette peu lisible est « à confirmer », jamais tenue pour sûre.
    await page.getByRole("button", { name: "Article suivant" }).click();
    await expect(page.getByRole("heading", { name: "Étiquette" })).toBeVisible();
    await expect(page.getByLabel("Marque", { exact: true })).toHaveValue("Sézane");
    await expect(page.getByText("Lue sur l'étiquette · confiance 62 % · à confirmer").first()).toBeVisible();
    await expect(series).toBeVisible();
    // Le silence ne vaut pas confirmation : « Générer l'annonce » reste fermé tant que les lectures peu sûres ne sont ni confirmées ni corrigées.
    await expect(page.getByText("À confirmer avant de générer")).toBeVisible();
    await page.getByRole("button", { name: "Continuer vers les mesures" }).click();
    await expect(page.getByRole("button", { name: "Générer l'annonce" })).toBeDisabled();
    await page.getByRole("button", { name: "Retour à l'étiquette" }).click();
    await page.getByRole("button", { name: "Confirmer « Sézane »" }).click();
    await page.getByRole("button", { name: "Confirmer « M »" }).click();
    await page.getByLabel("Matière", { exact: true }).fill("100 % laine");
    await expect(page.getByText("À confirmer avant de générer")).toHaveCount(0);
    await expect(page.getByText("Confirmée par vous").first()).toBeVisible();
    await page.getByRole("button", { name: "Continuer vers les mesures" }).click();
    await expect(page.getByRole("button", { name: "Générer l'annonce" })).toBeEnabled();
    await page.getByRole("button", { name: "Générer l'annonce" }).click();
    await expect(page.getByText("Annonce proposée")).toBeVisible({ timeout: 20_000 });
    // La provenance de l'annonce dit que ces valeurs viennent du vendeur (confirmées ou corrigées), pas d'une lecture tenue pour sûre.
    await expect(page.getByLabel("Marque", { exact: true })).toHaveValue("Sézane");
    const provenance = page.getByRole("region", { name: "Provenance des champs" });
    await expect(provenance).toContainText("Indiquée par le vendeur");
    await expect(provenance).toContainText("Aucune mesure connue : l'annonce n'en cite aucune.");

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

  test("Selio Studio : photos portées en file de nuit, aucun fournisseur choisi, dépassement proposé mais fermé, annulation qui rend la place", async ({ page }) => {
    // Entre 22 h et 6 h (heure de Paris), la démonstration refuse aussitôt la demande (aucun fournisseur) au lieu
    // de la garder en file : l'horloge du navigateur est figée en journée (11 h à Paris), les minuteries restent réelles.
    await page.clock.setFixedTime(new Date("2026-11-07T10:00:00Z"));
    await openDemo(page, "/studio/photos-portees");
    await expect(page.getByRole("heading", { name: "Photos portées" })).toBeVisible();
    await expect(page.getByText("Aucun fournisseur configuré : décision à prendre")).toBeVisible();
    const meter = page.getByRole("progressbar", { name: "Photos portées ce mois-ci" });
    await expect(meter).toHaveAttribute("aria-valuetext", "0 % (0 sur 10)");
    await expect(page.getByText("Proposition, prix à décider")).toBeVisible();
    // Dépassement à 0,25 € : réglage serveur fermé (WORN_OVERAGE_ENABLED=false) → la case d'accord est désactivée.
    await expect(page.getByRole("checkbox", { name: /J'accepte de payer 0,25/ })).toBeDisabled();
    await expect(page.getByText(/Désactivé sur ce serveur/)).toBeVisible();
    await expect(page.getByText(/File de nuit, entre 22 h et 6 h \(heure de Paris\)/)).toBeVisible();
    await page.getByLabel("Photo de l'article pour la photo portée").setInputFiles([{ name: "pull-a-plat.png", mimeType: "image/png", buffer: PNG }]);
    await page.getByRole("button", { name: "Mettre en file pour la nuit" }).click();
    const list = page.getByRole("list", { name: "Demandes de photos portées" });
    await expect(list).toContainText("En file pour la nuit");
    await expect(list).toContainText(/Prévue (ce soir|demain|le \d+|dès que possible)/);
    await expect(meter).toHaveAttribute("aria-valuetext", "10 % (1 sur 10)");
    await page.getByRole("button", { name: "Annuler la demande" }).click();
    await expect(page.getByText("Aucune demande")).toBeVisible();
    await expect(meter).toHaveAttribute("aria-valuetext", "0 % (0 sur 10)");
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
