import { expect, type Page } from "@playwright/test";

/**
 * Ouvre la démonstration (jeu de données fictif réinitialisé pour ce contexte).
 * Sans destination, /demo mène à l'accueil central des espaces ; les parcours
 * existants partent de la vue d'ensemble de Selio (`vers` = "/app").
 */
export async function openDemo(page: Page, vers: string | null = "/app"): Promise<void> {
  await page.goto(vers ? `/demo?vers=${vers}` : "/demo");
  // On attend le CHEMIN d'arrivée : « /demo?vers=/app » se termine déjà par « /app ».
  const target = vers ?? "/app/espaces";
  await page.waitForURL((url) => url.pathname === target, { timeout: 20_000 });
  // Le bandeau de la démo (d'autres pages ont leur propre encart « démonstration »).
  await expect(page.getByRole("status").filter({ hasText: "Démonstration — données fictives" })).toBeVisible();
}

export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export function isMobile(page: Page): boolean {
  const vp = page.viewportSize();
  return Boolean(vp && vp.width < 768);
}
