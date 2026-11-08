import { expect, test, type Page } from "@playwright/test";
import { gotoApp, isMobile, openDemo } from "./helpers";

/** Nombre de surfaces de verre (composant GlassSurface) dans la page. */
async function glassCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll(".glass-surface, [data-glass]").length);
}

async function setGlass(page: Page, on: boolean): Promise<void> {
  await gotoApp(page, "/app/settings/apparence");
  const toggle = page.getByRole("switch", { name: /Essai : verre liquide/ });
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

test.describe("essai « verre liquide » (§6)", () => {
  test("désactivé par défaut : aucune surface de verre ni dock, sur l'application et le Radar (non-régression)", async ({ page }) => {
    await openDemo(page);
    expect(await glassCount(page)).toBe(0);
    await expect(page.getByTestId("mobile-dock")).toHaveCount(0);
    await gotoApp(page, "/app/radar");
    await expect(page.getByRole("heading", { name: "Bonnes affaires", level: 1 })).toBeVisible();
    await expect(page.locator("main article, main .card").first()).toBeVisible();
    expect(await glassCount(page)).toBe(0);
    await gotoApp(page, "/app/settings/apparence");
    await expect(page.getByRole("switch", { name: /Essai : verre liquide/ })).toHaveAttribute("aria-checked", "false");
    expect(await glassCount(page)).toBe(0);
  });

  test("activé : dock flottant sur mobile, carte d'alerte Radar en verre, réglage mémorisé ; désactivé : tout redevient comme avant", async ({ page }) => {
    await openDemo(page);
    await setGlass(page, true);
    await gotoApp(page, "/app");
    const dock = page.getByTestId("mobile-dock");
    if (isMobile(page)) {
      await expect(dock).toBeVisible();
      const box = (await dock.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.height).toBeLessThanOrEqual(64);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      expect(await dock.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
      await expect(dock.getByRole("link")).toHaveCount(5);
      await expect(dock.getByRole("link", { name: "Générer" })).toHaveAttribute("href", "/studio");
      for (const name of ["Accueil", "Articles", "Messages", "Affaires"]) await expect(dock.getByRole("link", { name })).toBeVisible();
      // Le contenu garde un espace équivalent : rien n'est caché sous le dock en bas de page.
      const padding = await page.locator("#contenu-app").evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));
      expect(padding).toBeGreaterThanOrEqual(box.height);
      await dock.getByRole("link", { name: "Articles" }).click();
      await expect(page).toHaveURL(/\/app\/items$/);
    } else {
      // Écran large : le dock n'est pas affiché (menu latéral inchangé).
      await expect(dock).toBeHidden();
    }
    // Carte d'alerte Radar : en verre (ou en surface opaque de repli), sur la liste et la page « 1 clic ».
    await gotoApp(page, "/app/radar");
    const card = page.getByTestId("radar-alert-card").first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-glass", /^(glass|opaque)$/);
    await card.getByRole("link", { name: "Ouvrir l'affaire" }).click();
    await expect(page).toHaveURL(/\/app\/radar\/affaires\//);
    const oneClick = page.getByRole("region", { name: "Acheter en un clic" });
    await expect(oneClick).toBeVisible();
    await expect(oneClick).toHaveAttribute("data-glass", /^(glass|opaque)$/);
    // Mémorisé pour l'utilisateur.
    await page.reload();
    await expect(page.getByRole("region", { name: "Acheter en un clic" })).toBeVisible();
    // Désactivé : plus aucune surface de verre.
    await setGlass(page, false);
    expect(await glassCount(page)).toBe(0);
    await gotoApp(page, "/app/radar");
    await expect(page.getByRole("heading", { name: "Bonnes affaires", level: 1 })).toBeVisible();
    expect(await glassCount(page)).toBe(0);
    await expect(page.getByTestId("mobile-dock")).toHaveCount(0);
  });

  test("dock actif : la barre « Enregistrer » collante et l'onglet actif restent au-dessus du dock et lisibles", async ({ page }) => {
    await openDemo(page);
    await setGlass(page, true);
    await gotoApp(page, "/app/automatisation/favoris");
    const dock = page.getByTestId("mobile-dock");
    // Une modification rend la barre collante en bas de l'écran.
    await page.getByRole("switch", { name: "Une seule fois par acheteur" }).click();
    const save = page.getByRole("button", { name: "Enregistrer", exact: true });
    await expect(save).toBeVisible();
    if (!isMobile(page)) {
      // Écran large : pas de dock, la barre reste à sa place habituelle (aucun décalage).
      await expect(dock).toBeHidden();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dock-offset").trim())).toBe("");
      return;
    }
    await expect(dock).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const dockBox = (await dock.boundingBox())!;
    const saveBox = (await save.boundingBox())!;
    // Le bouton est entièrement au-dessus du dock (rien n'est recouvert).
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(dockBox.y);
    // L'onglet actif du dock porte un repère non textuel (pastille) en plus de la couleur.
    await gotoApp(page, "/app/items");
    const active = dock.getByRole("link", { name: "Articles" });
    await expect(active).toHaveAttribute("aria-current", "page");
    const marker = await active.evaluate((el) => getComputedStyle(el, "::after").content);
    expect(marker).not.toBe("none");
  });

  test("plus de contraste demandé : surface opaque, liseré du texte", async ({ page }) => {
    await page.emulateMedia({ contrast: "more" } as Parameters<Page["emulateMedia"]>[0]);
    await openDemo(page);
    await setGlass(page, true);
    await gotoApp(page, "/app/radar");
    const card = page.getByTestId("radar-alert-card").first();
    await expect(card).toHaveAttribute("data-glass", "opaque");
    await expect(card).toHaveAttribute("data-glass-fallback", "more-contrast");
  });
});
