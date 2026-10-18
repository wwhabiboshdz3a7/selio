import { expect, test, type Page } from "@playwright/test";
import { isMobile, openDemo } from "./helpers";

/**
 * Navigation interne (sans rechargement) dans un navigateur récent : depuis Chrome/Edge 149-150,
 * window.scrollTo(), scrollIntoView()… renvoient une promesse. On reproduit ce comportement quelle
 * que soit la version du Chromium de test : un effet qui renverrait cette valeur ferait planter
 * chaque changement de page (« S is not a function »).
 */
const PAGES: { href: string; heading: RegExp }[] = [
  { href: "/app/dressing", heading: /Dressing intelligent/ },
  { href: "/app/items", heading: /Articles/ },
  { href: "/app/messages", heading: /Messagerie/ },
  { href: "/app/orders", heading: /Commandes/ },
  { href: "/app/customers", heading: /Clients/ },
  { href: "/app/automatisation", heading: /Tout le parcours/ },
  { href: "/app/automatisation/favoris", heading: /Messages aux favoris/ },
  { href: "/app/automatisation/reponse", heading: /Réponse automatique/ },
  { href: "/app/automatisation/negociation", heading: /Négociation automatique/ },
  { href: "/app/automatisation/apres-vente", heading: /Après-vente et bordereaux/ },
  { href: "/app/automatisation/stock", heading: /Stock automatique/ },
  { href: "/app/automations", heading: /Journal des tâches/ },
  // Selio Track est une filiale : son menu propose ensuite les Bonnes affaires, qui ramènent dans Selio.
  { href: "/track", heading: /sourcing des comptes Vinted/ },
  { href: "/app/radar", heading: /Bonnes affaires/ },
  { href: "/app/purchase", heading: /À valider/ },
  { href: "/app/auto-buy", heading: /Achat auto/ },
  { href: "/app/accounts", heading: /Comptes Vinted/ },
  { href: "/app/analytics", heading: /Analyses/ },
  { href: "/app/help", heading: /^Aide$/ },
  { href: "/app/settings", heading: /Paramètres/ },
  { href: "/app", heading: /Bonjour/ },
  // Le générateur vit dans Selio Studio : le lien du menu de Selio y mène (et le menu devient celui de Studio).
  { href: "/studio", heading: /Générateur d'annonces/ },
  { href: "/studio/annonces", heading: /Annonces générées/ },
  { href: "/studio/performances", heading: /Ce qui performe/ },
];

async function clickNav(page: Page, href: string): Promise<void> {
  if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const scope = isMobile(page) ? page.getByRole("dialog", { name: "Menu" }) : page.getByRole("navigation", { name: "Navigation de l'application" });
  await scope.locator(`a[href="${href}"]`).first().click();
}

test("mobile : le tiroir se ferme aussi en touchant la page courante", async ({ page }) => {
  await openDemo(page);
  test.skip(!isMobile(page), "Menu en tiroir uniquement sur mobile");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await drawer.getByRole("link", { name: "Vue d'ensemble", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await drawer.locator('a[href="/app/items"]').first().click();
  await expect(page).toHaveURL(/\/app\/items$/);
  await expect(drawer).toHaveCount(0);
});

test("navigation interne sans erreur quand les méthodes de défilement renvoient une promesse", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const patch = (owner: object, name: string) => {
      const original = Reflect.get(owner, name) as (...args: unknown[]) => unknown;
      Reflect.set(owner, name, function (this: unknown, ...args: unknown[]) {
        original.apply(this, args);
        return Promise.resolve();
      });
    };
    for (const name of ["scrollTo", "scroll", "scrollBy"]) patch(window, name);
    for (const name of ["scrollIntoView", "scrollTo", "scroll", "scrollBy"]) patch(Element.prototype, name);
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  expect(await page.evaluate(() => Object.prototype.toString.call(window.scrollTo({ top: 0 })))).toBe("[object Promise]");
  for (const { href, heading } of PAGES) {
    await clickNav(page, href);
    await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, "\\/")}(\\/[a-z-]+)?$`));
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.getByText("Cette page a rencontré un problème")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
