import { expect, test, type Page } from "@playwright/test";
import { isMobile, openDemo } from "./helpers";

/** Ouvre le menu du compte (en pied de menu latéral, ou du tiroir sur mobile). */
async function openAccountMenu(page: Page): Promise<void> {
  if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: /Marie Lefèvre/ }).last().click();
}

test("menu du compte : entièrement visible, déconnexion sans erreur", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  await openAccountMenu(page);
  const logout = page.getByRole("menuitem", { name: "Se déconnecter" });
  // Le menu s'ouvrait sous le bas de l'écran : « Se déconnecter » était inaccessible.
  const box = await logout.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height <= viewport.height).toBeTruthy();
  await logout.click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByText("Cette page a rencontré un problème")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("suppression de l'organisation de démonstration sans écran d'erreur", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  await page.goto("/app/settings/data");
  const orgName = await page.evaluate(() => JSON.parse(localStorage.getItem("selio.demo.v1") ?? "{}").org?.name as string);
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input").first().fill(orgName);
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page).not.toHaveURL(/\/app/);
  await expect(page.getByText("Cette page a rencontré un problème")).toHaveCount(0);
  expect(errors).toEqual([]);
});
