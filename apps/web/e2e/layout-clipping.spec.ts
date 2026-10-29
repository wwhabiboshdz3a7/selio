import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers";

/**
 * Contenu coupé sur petit écran : un élément plus large que l'écran, qui n'est pas dans une zone
 * qui défile horizontalement (tableau, rangée de filtres), est rogné sans moyen de le voir.
 * La page ne déborde pas (pas de défilement horizontal) : seul ce contrôle le repère.
 * Exemple corrigé : liste de la messagerie et « Dernières commandes » à 375 px.
 */
const PAGES = [
  "/app", "/app/espaces", "/app/onboarding", "/app/items", "/app/items/new", "/app/items/import", "/app/dressing",
  "/app/messages", "/app/customers", "/app/orders", "/app/analytics", "/app/automatisation",
  "/app/automatisation/favoris", "/app/automatisation/reponse", "/app/automatisation/negociation",
  "/app/automatisation/apres-vente", "/app/automatisation/stock", "/app/automations", "/app/radar",
  "/app/purchase", "/app/auto-buy", "/app/market", "/app/accounts", "/app/help", "/app/selling-rules",
  "/app/settings/organisation", "/app/settings/access", "/app/settings/members", "/app/settings/connections",
  "/app/settings/ai", "/app/settings/billing", "/app/settings/usage", "/app/settings/notifications", "/app/settings/security",
  "/app/settings/data", "/app/settings/status", "/studio", "/studio/annonces", "/studio/performances",
  "/agents", "/agents/clients", "/agents/marque-blanche", "/agents/facturation", "/track", "/cloud", "/generateur", "/admin",
];

test("aucun contenu coupé hors zone défilante (mobile et tablette)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "Contrôle réservé aux petits écrans");
  test.setTimeout(180_000);
  await openDemo(page);
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const clipped = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out: string[] = [];
      for (const el of document.querySelectorAll("main *")) {
        const b = el.getBoundingClientRect();
        if (!(b.width > 0 && b.right > vw + 1)) continue;
        if (el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1) continue;
        let a = el.parentElement, scrolls = false;
        while (a && a !== document.body) {
          const ox = getComputedStyle(a).overflowX;
          if ((ox === "auto" || ox === "scroll") && a.getBoundingClientRect().right <= vw + 1) { scrolls = true; break; }
          a = a.parentElement;
        }
        if (!scrolls) out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(" ").slice(0, 4).join(".")} (${Math.round(b.width)} px)`);
      }
      return out.slice(0, 3);
    });
    if (clipped.length) problems.push(`${path} : ${clipped.join(", ")}`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
