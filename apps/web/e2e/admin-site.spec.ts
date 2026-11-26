import { expect, test, type Page } from "@playwright/test";
import { isMobile } from "./helpers";

/**
 * Site Selio Admin (build séparé, cible « admin », lancé par playwright.admin.config.ts) en mode démonstration :
 * connexion sobre, puis /admin et ses pages ; ni vitrine, ni espace client, jamais indexé.
 */
async function loginAdmin(page: Page, path = "/admin"): Promise<void> {
  await page.goto(path);
  await page.waitForURL((url) => url.pathname === "/connexion", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Selio Admin" })).toBeVisible();
  // Démonstration (build sans API) : identifiants fictifs pré-remplis.
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/admin"), { timeout: 20_000 });
}

async function openAdminMenu(page: Page): Promise<void> {
  // Sur téléphone, le menu de Selio Admin est derrière le bouton « Ouvrir le menu ».
  if (isMobile(page)) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
}

test.describe("site Selio Admin", () => {
  test("la racine mène à la connexion « Selio Admin », jamais indexée, sans vitrine", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL((url) => url.pathname === "/connexion");
    await expect(page).toHaveTitle(/Selio Admin/);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("form", { name: "Connexion à Selio Admin" })).toBeVisible();
    // Aucun lien de la vitrine ni de l'espace client.
    await expect(page.getByRole("link", { name: /Essai gratuit|Tarifs|Créer un compte/ })).toHaveCount(0);
  });

  test("robots.txt interdit tout, pas de sitemap ni de manifeste d'application", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Disallow: /");
    expect(await robots.text()).not.toContain("Sitemap");
    for (const path of ["/sitemap.xml", "/manifest.webmanifest", "/sw.js"]) {
      const res = await request.get(path);
      // Fichier absent : le serveur renvoie la page de l'application (HTML) ou une 404, jamais le fichier.
      expect((await res.text()).startsWith("<?xml") || (res.headers()["content-type"] ?? "").includes("manifest") || (res.headers()["content-type"] ?? "").includes("javascript"), path).toBe(false);
    }
  });

  test("connexion, tableau de bord, sections selon le rôle, aucun lien vers l'espace client", async ({ page }) => {
    await loginAdmin(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
    await openAdminMenu(page);
    const nav = page.getByRole("navigation", { name: "Sections de l'administration" });
    await expect(nav.getByRole("link", { name: "Comptes" })).toBeVisible();
    await expect(page.locator('a[href^="/app"]')).toHaveCount(0);
  });

  test("Supervision : état de l'API, cibles et alertes", async ({ page }) => {
    await loginAdmin(page, "/admin/supervision");
    await expect(page).toHaveURL(/\/admin\/supervision$/);
    await openAdminMenu(page);
    await expect(page.getByRole("navigation", { name: "Sections de l'administration" }).getByRole("link", { name: "Supervision" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Cibles vérifiées chaque minute" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Alertes de supervision" }).getByRole("listitem")).toHaveCount(3);
  });

  test("Accès de l'équipe et adresse inconnue (dont /app) : retour à l'administration", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/acces");
    await expect(page.getByRole("heading", { name: "Accès de l'équipe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Qui peut faire quoi" })).toBeVisible();
    for (const path of ["/app", "/inscription", "/tarifs"]) {
      await page.goto(path);
      await page.waitForURL((url) => url.pathname === "/admin");
    }
  });

  test("aucun contenu coupé sur petit écran", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "Contrôle réservé aux petits écrans");
    await loginAdmin(page);
    const problems: string[] = [];
    for (const path of ["/admin", "/admin/comptes", "/admin/offres", "/admin/track", "/admin/acces", "/admin/sante", "/admin/supervision"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${path} : ${overflow} px de trop`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
