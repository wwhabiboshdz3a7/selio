import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { isMobile, openDemo } from "./helpers";

/**
 * Robustesse avant lancement (docs/ROBUSTESSE.md), en démonstration : lien profond ouvert déconnecté, deux onglets,
 * noms très longs ou piégés, double clic, photos énormes ou illisibles, page inconnue. Aucun écran blanc, aucune
 * erreur technique à l'écran.
 */

/** Fichier de plusieurs centaines de Mo (creux, jamais committé), créé par le lanceur des tests : voir docs/ROBUSTESSE.md. */
const HUGE_FILE = process.env.ROBUSTESSE_HUGE_FILE ?? "";

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "débordement horizontal de la page").toBeLessThanOrEqual(1);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push(`boîte de dialogue inattendue : ${d.message()}`); void d.dismiss(); });
  return errors;
}

test("lien profond ouvert déconnecté : connexion, puis retour à la page demandée (paramètres compris)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/app/settings/usage?depuis=email#compteurs");
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByRole("button", { name: "Entrer dans la démonstration" }).click();
  await page.waitForURL((url) => url.pathname === "/app/settings/usage", { timeout: 20_000 });
  expect(new URL(page.url()).search).toBe("?depuis=email");
  expect(new URL(page.url()).hash).toBe("#compteurs");
  expect(errors).toEqual([]);
});

test("page inconnue ou article inexistant : message clair dans la mise en page, jamais d'écran blanc", async ({ page }) => {
  const errors = collectErrors(page);
  await openDemo(page);
  await page.goto("/app/items/article-qui-n-existe-pas");
  await expect(page.locator("#contenu-app, main").first()).toBeVisible();
  const text = (await page.locator("body").innerText()).trim();
  expect(text.length).toBeGreaterThan(50);
  expect(text).not.toMatch(/TypeError|undefined|Internal Server Error|Erreur \d{3}/);
  expect(errors).toEqual([]);
});

test("deux onglets : la déconnexion dans l'un ramène l'autre à la connexion", async ({ page, context }) => {
  await openDemo(page);
  const other = await context.newPage();
  await other.goto("/app/items");
  await expect(other.getByRole("heading", { name: "Articles et stock" })).toBeVisible();
  if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: /Marie Lefèvre/ }).last().click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(other).toHaveURL(/\/connexion$/, { timeout: 10_000 });
  await other.close();
});

test("deux onglets : un article modifié dans l'un est signalé dans l'autre, jamais écrasé en silence", async ({ page, context }) => {
  await openDemo(page);
  const id = await page.evaluate(() => (JSON.parse(localStorage.getItem("selio.demo.v1") ?? "{}").items as { id: string; status: string }[]).find((i) => i.status !== "archived")!.id);
  const other = await context.newPage();
  await other.goto(`/app/items/${id}/edit`);
  await page.goto(`/app/items/${id}/edit`);
  const title = page.getByRole("textbox", { name: "Titre" });
  await title.fill("Modifié dans le premier onglet");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL((url) => url.pathname === `/app/items/${id}`);
  // Le second onglet, ouvert avant, est prévenu…
  await expect(other.getByText("Article modifié entre-temps")).toBeVisible({ timeout: 10_000 });
  // … et son enregistrement est refusé clairement (sa saisie n'écrase pas celle du premier).
  await other.getByRole("textbox", { name: "Titre" }).fill("Modifié dans le second onglet");
  await other.getByRole("button", { name: "Enregistrer" }).click();
  await expect(other.getByText(/modifié entre-temps \(dans un autre onglet/)).toBeVisible();
  const saved = await page.evaluate((itemId) => (JSON.parse(localStorage.getItem("selio.demo.v1") ?? "{}").items as { id: string; title: string }[]).find((i) => i.id === itemId)!.title, id);
  expect(saved).toBe("Modifié dans le premier onglet");
  await other.close();
});

test("inscription : noms limités sous le champ, puis noms très longs ou piégés sans débordement ni injection", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/inscription");
  const name = page.getByRole("textbox", { name: "Votre nom" });
  const org = page.getByRole("textbox", { name: "Nom de l'organisation" });
  // Espaces seuls : message sous le champ.
  await name.fill("     ");
  await org.fill("Boutique");
  await page.getByRole("textbox", { name: "Email" }).fill("long@demo.selio.local");
  await page.getByLabel("Mot de passe").fill("motdepasse-long");
  await page.getByRole("button", { name: "Créer le compte et commencer l'essai" }).click();
  await expect(page.getByText("Champ requis.").first()).toBeVisible();
  // 500 caractères tapés : le champ s'arrête à 80.
  await name.fill("W".repeat(500));
  expect((await name.inputValue()).length).toBe(80);
  await name.fill(`<img src=x onerror="alert('nom')">${"W".repeat(40)}`);
  await org.fill(`🛍️${"W".repeat(200)}`);
  expect((await org.inputValue()).length).toBe(120);
  await page.getByRole("button", { name: "Créer le compte et commencer l'essai" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/app"), { timeout: 20_000 });
  for (const path of ["/app/espaces", "/app", "/app/settings/organisation", "/app/settings/access"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noHorizontalOverflow(page);
  }
  // Le nom est affiché comme du texte : aucune image injectée, aucun script exécuté.
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(errors).toEqual([]);
});

test("double clic sur « Créer l'article » : un seul article créé", async ({ page }) => {
  await openDemo(page);
  await page.goto("/app/items/new");
  await page.getByRole("textbox", { name: "Titre" }).fill("Robustesse double clic");
  await page.getByRole("button", { name: "Créer l'article" }).dblclick();
  await page.waitForURL((url) => /^\/app\/items\/[^/]+$/.test(url.pathname) && url.pathname !== "/app/items/new");
  await page.waitForTimeout(500);
  const count = await page.evaluate(() => (JSON.parse(localStorage.getItem("selio.demo.v1") ?? "{}").items as { title: string }[]).filter((i) => i.title === "Robustesse double clic").length);
  expect(count).toBe(1);
});

test("article : prix absurde et date d'achat future refusés sous le champ, rien n'est créé", async ({ page }) => {
  await openDemo(page);
  await page.goto("/app/items/new");
  await page.getByRole("textbox", { name: "Titre" }).fill("Robustesse prix absurde");
  await page.getByRole("textbox", { name: "Prix affiché" }).fill("1000000");
  const next = new Date(Date.now() + 10 * 86_400_000);
  await page.getByLabel("Date d'achat").fill(next.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Créer l'article" }).click();
  await expect(page.getByText("Montant trop élevé : 100 000 € au plus.")).toBeVisible();
  await expect(page.getByText("La date d'achat ne peut pas être dans le futur.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/items\/new$/);
});

test("photos : PDF renommé, HEIC, fichier vide et fichier de plusieurs centaines de Mo refusés avant tout envoi", async ({ page }) => {
  await openDemo(page);
  await page.goto("/app/items/new");
  const input = page.locator('input[type="file"][aria-label="Ajouter des photos"]');
  const cases: [{ name: string; mimeType: string; buffer: Buffer }, RegExp][] = [
    [{ name: "facture.jpg", mimeType: "image/jpeg", buffer: Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj") }, /« facture\.jpg » est un document PDF/],
    [{ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]) }, /HEIC \(iPhone\)/],
    [{ name: "vide.png", mimeType: "image/png", buffer: Buffer.alloc(0) }, /« vide\.png » est vide/],
  ];
  for (const [file, pattern] of cases) {
    await input.setInputFiles(file);
    await expect(page.getByRole("alert").filter({ hasText: pattern })).toBeVisible();
  }
  // Aucune image cassée ajoutée.
  expect(await page.locator("form img").count()).toBe(0);
  test.skip(!HUGE_FILE || !existsSync(HUGE_FILE), "fichier volumineux absent (ROBUSTESSE_HUGE_FILE)");
  await input.setInputFiles(HUGE_FILE);
  await expect(page.getByRole("alert").filter({ hasText: /est trop lourde \([\d,]+ Mo\) : 1,5 Mo au maximum/ })).toBeVisible();
  // Studio : la photo n'est jamais décodée au-delà de 40 Mo.
  await page.goto("/studio");
  await page.locator('input[type="file"][aria-label="Choisir des photos"]').setInputFiles(HUGE_FILE);
  await expect(page.getByText(/trop lourde pour être ouverte \([\d,]+ Mo\) : 40 Mo au maximum/)).toBeVisible();
});
