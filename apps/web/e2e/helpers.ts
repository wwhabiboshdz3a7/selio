import { expect, type Page } from "@playwright/test";

/** Ouvre la démonstration (jeu de données fictif réinitialisé pour ce contexte). */
export async function openDemo(page: Page): Promise<void> {
  await page.goto("/demo");
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "Démonstration" })).toBeVisible();
}

export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export function isMobile(page: Page): boolean {
  const vp = page.viewportSize();
  return Boolean(vp && vp.width < 768);
}
